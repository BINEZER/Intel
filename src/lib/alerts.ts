/**
 * Alerts: the things that stop being fixable if nobody looks today.
 *
 * WHAT EARNS A PLACE HERE
 *   Only something with a DEADLINE and an ACTION. A contract expiring in three
 *   weeks earns a place because an extension letter written today still works
 *   and one written in four weeks does not. A project that is merely large does
 *   not: nothing about it changes by being ignored for a day.
 *
 *   This is the discipline that keeps an alert list worth opening. A list that
 *   shows everything gets read once.
 *
 * Every alert names what to do, not just what is wrong. "MC-2026-004 expires in
 * 23 days — write the extension letter" is actionable; "contract expiring" is
 * a notification, and notifications get dismissed.
 */

import { formatETB } from './money.js';
import { renewalView, type RenewalStatus } from './renewal.js';
import { daysBetween } from './kpi.js';
import type { RiskFlag, RiskSeverity } from './schema.js';

export type AlertKind =
  | 'contract_expiring'
  | 'contract_lapsed'
  | 'warranty_expiring'
  | 'warranty_expired'
  | 'reminder_due'
  | 'reminder_overdue'
  | 'project_in_danger'
  | 'certificate_expiring'
  | 'certificate_expired'
  | 'unit_needs_attention';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: RiskSeverity;
  /** The subject, as a person would name it: "MC-2026-004 · Sheger Mall". */
  subject: string;
  /** What is happening, with the number that makes it urgent. */
  message: string;
  /** What to do about it. */
  action: string;
  /** Where in the app to go and do it. */
  href: string;
  /** Negative once the deadline has passed. Null where there is no date. */
  daysRemaining: number | null;
  amountSantim?: number;
}

const SEVERITY_ORDER: Record<RiskSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Most urgent first: severity, then how little time is left.
 *
 * Something already overdue sorts above something due tomorrow at the same
 * severity, because the overdue one has been ignored at least once already.
 */
export function sortAlerts(alerts: readonly Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const left = a.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    const right = b.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface AlertContract {
  id: string;
  contractNo: string;
  clientName: string;
  type: string;
  endDate: Date;
  renewalWindowDays: number;
  renewalStatus: RenewalStatus;
  status: 'draft' | 'active' | 'suspended' | 'completed' | 'terminated' | 'expired';
  valueGrossSantim: number;
}

export interface AlertProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  status: string;
  inDanger: boolean;
  severity: RiskSeverity | 'none';
  flags: readonly RiskFlag[];
  plannedEnd: Date;
}

export interface AlertUnit {
  id: string;
  unitCode: string;
  tag: string;
  siteName: string;
  verdict: 'healthy' | 'watch' | 'problem' | 'unknown';
  reasons: readonly string[];
  certificateExpiresOn: Date | null;
}

export interface AlertThresholds {
  /** A certificate inside this many days of expiry is worth chasing. */
  certificateWarningDays: number;
}

export const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = { certificateWarningDays: 60 };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Contracts inside their renewal window.
 *
 * A contract already marked renewed or in negotiation is NOT an alert — someone
 * is on it, and repeating it every day is how a person learns to scroll past the
 * whole list. A lapsed one stays, at critical, because lapsed revenue does not
 * quietly resume.
 */
export function contractAlerts(contracts: readonly AlertContract[], asOf: Date): Alert[] {
  const alerts: Alert[] = [];

  for (const contract of contracts) {
    if (contract.status !== 'active') continue;

    const view = renewalView(
      {
        endDate: contract.endDate,
        renewalWindowDays: contract.renewalWindowDays,
        storedStatus: contract.renewalStatus,
        contractStatus: contract.status,
      },
      asOf,
    );

    if (view.status === 'renewed' || view.status === 'in_negotiation') continue;
    if (!view.inWindow && view.daysUntilExpiry >= 0) continue;

    const subject = `${contract.contractNo} · ${contract.clientName}`;
    const lapsed = view.daysUntilExpiry < 0;

    alerts.push({
      id: `contract-${contract.id}`,
      kind: lapsed ? 'contract_lapsed' : 'contract_expiring',
      severity: lapsed ? 'critical' : view.urgency,
      subject,
      message: lapsed
        ? `Expired ${Math.abs(view.daysUntilExpiry)} days ago and has not been renewed. ${formatETB(contract.valueGrossSantim)} a year of recurring revenue has stopped.`
        : `Expires in ${view.daysUntilExpiry} days. ${formatETB(contract.valueGrossSantim)} a year is up for renewal.`,
      action: lapsed
        ? 'Contact the client before another provider does, and record the outcome against the contract.'
        : 'Write the extension letter and record it as in negotiation.',
      href: `/contracts?contract=${contract.id}`,
      daysRemaining: view.daysUntilExpiry,
      amountSantim: contract.valueGrossSantim,
    });
  }

  return alerts;
}

/** Projects the risk engine has already judged to be in trouble. */
export function projectAlerts(projects: readonly AlertProject[], asOf: Date): Alert[] {
  const alerts: Alert[] = [];

  for (const project of projects) {
    if (!project.inDanger || project.severity === 'none') continue;
    if (project.status === 'completed' || project.status === 'cancelled') continue;

    // The worst flag is the headline; the rest are on the project page. An alert
    // that lists six problems is a report, and gets read like one.
    const worst = [...project.flags].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    )[0];

    alerts.push({
      id: `project-${project.id}`,
      kind: 'project_in_danger',
      severity: project.severity,
      subject: `${project.projectNo} · ${project.title}`,
      message:
        worst === undefined
          ? `Flagged as in danger for ${project.clientName}.`
          : `${worst.message}${project.flags.length > 1 ? ` (and ${project.flags.length - 1} more)` : ''}`,
      action: 'Open the project, agree the recovery step, and put a date on it.',
      href: `/projects/${project.id}`,
      daysRemaining: daysBetween(asOf, project.plannedEnd),
      ...(worst?.amountSantim === undefined ? {} : { amountSantim: worst.amountSantim }),
    });
  }

  return alerts;
}

/**
 * Lifts whose certificate is running out, or that the service record says are
 * in trouble.
 *
 * An expired certificate is critical and not negotiable: an uncertified lift in
 * service is a regulatory problem before it is a commercial one.
 */
export function unitAlerts(
  units: readonly AlertUnit[],
  asOf: Date,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): Alert[] {
  const alerts: Alert[] = [];

  for (const unit of units) {
    const subject = `${unit.tag} · ${unit.siteName}`;

    if (unit.certificateExpiresOn !== null) {
      const days = daysBetween(asOf, unit.certificateExpiresOn);
      if (days < 0) {
        alerts.push({
          id: `cert-${unit.id}`,
          kind: 'certificate_expired',
          severity: 'critical',
          subject,
          message: `Authority certificate expired ${Math.abs(days)} days ago and the lift is still in service.`,
          action: 'Apply for re-inspection now.',
          href: `/units/${unit.id}`,
          daysRemaining: days,
        });
      } else if (days <= thresholds.certificateWarningDays) {
        alerts.push({
          id: `cert-${unit.id}`,
          kind: 'certificate_expiring',
          severity: days <= 21 ? 'high' : 'medium',
          subject,
          message: `Authority certificate expires in ${days} days.`,
          action: 'Book the inspection — the lead time is rarely shorter than the notice.',
          href: `/units/${unit.id}`,
          daysRemaining: days,
        });
      }
    }

    if (unit.verdict === 'problem') {
      alerts.push({
        id: `unit-${unit.id}`,
        kind: 'unit_needs_attention',
        severity: 'high',
        subject,
        message: unit.reasons[0] ?? 'The service record on this unit is deteriorating.',
        action: 'Review the history and decide whether this is a repair or a modernisation quote.',
        href: `/units/${unit.id}`,
        daysRemaining: null,
      });
    }
  }

  return alerts;
}

/**
 * Warranty, and every date somebody asked to be warned about.
 *
 * These arrive already resolved — the caller has turned stored dual dates into
 * real ones and worked out what is due — because the alert engine's job is to
 * rank and phrase, not to recompute what `lib/reminders` already knows.
 */
export interface AlertWarranty {
  contractId: string;
  contractNo: string;
  clientName: string;
  endsOn: Date;
  state: 'active' | 'expiring' | 'expired';
  message: string;
}

export interface AlertReminder {
  id: string;
  label: string;
  message: string;
  daysRemaining: number;
  state: 'due' | 'overdue';
  sourceKind: 'contract' | 'project';
  sourceId: string;
  sourceLabel: string;
}

/**
 * A warranty running out is the moment to inspect, not the moment to discover a
 * claim: every defect found the week after is a chargeable repair we do for
 * free anyway, or an argument with a client we would rather keep.
 */
export function warrantyAlerts(warranties: readonly AlertWarranty[]): Alert[] {
  return warranties
    .filter((w) => w.state !== 'active')
    .map((w) => ({
      id: `warranty-${w.contractId}`,
      kind: (w.state === 'expired' ? 'warranty_expired' : 'warranty_expiring') as AlertKind,
      severity: (w.state === 'expired' ? 'medium' : 'high') as RiskSeverity,
      subject: `${w.contractNo} · ${w.clientName}`,
      message: w.message,
      action:
        w.state === 'expired'
          ? 'Anything found now is chargeable. Close the file, or agree a goodwill position deliberately rather than by default.'
          : 'Book the end-of-warranty inspection while defects are still ours to fix for free.',
      href: `/contracts?contract=${w.contractId}`,
      daysRemaining: Math.round((w.endsOn.getTime() - Date.now()) / 86_400_000),
    }));
}

/** Dates somebody put in deliberately. They outrank nothing and are never noise. */
export function reminderAlerts(reminders: readonly AlertReminder[]): Alert[] {
  return reminders.map((reminder) => ({
    id: `reminder-${reminder.id}`,
    kind: (reminder.state === 'overdue' ? 'reminder_overdue' : 'reminder_due') as AlertKind,
    // Somebody set this date on purpose. Overdue is high; approaching is medium
    // — loud enough to see, quiet enough not to bury a lapsed contract.
    severity: (reminder.state === 'overdue' ? 'high' : 'medium') as RiskSeverity,
    subject: reminder.sourceLabel,
    message: reminder.message,
    action:
      reminder.state === 'overdue'
        ? 'Deal with it or mark it done — a reminder nobody closes teaches everyone to ignore the list.'
        : 'Act on it now, while there is still time for it to matter.',
    href: reminder.sourceKind === 'project' ? `/projects/${reminder.sourceId}` : `/contracts?contract=${reminder.sourceId}`,
    daysRemaining: reminder.daysRemaining,
  }));
}

export interface AlertInputs {
  contracts: readonly AlertContract[];
  projects: readonly AlertProject[];
  units: readonly AlertUnit[];
  warranties?: readonly AlertWarranty[];
  reminders?: readonly AlertReminder[];
}

export function buildAlerts(
  inputs: AlertInputs,
  asOf: Date,
  thresholds: AlertThresholds = DEFAULT_ALERT_THRESHOLDS,
): Alert[] {
  return sortAlerts([
    ...contractAlerts(inputs.contracts, asOf),
    ...warrantyAlerts(inputs.warranties ?? []),
    ...reminderAlerts(inputs.reminders ?? []),
    ...projectAlerts(inputs.projects, asOf),
    ...unitAlerts(inputs.units, asOf, thresholds),
  ]);
}

export function countBySeverity(alerts: readonly Alert[]): Record<RiskSeverity, number> {
  const counts: Record<RiskSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const alert of alerts) counts[alert.severity] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// The extension letter
// ---------------------------------------------------------------------------

export interface ExtensionLetterInput {
  companyName: string;
  companyAddress: string;
  contractNo: string;
  clientName: string;
  clientAddress: string;
  siteName: string;
  units: number;
  endDate: Date;
  proposedEndDate: Date;
  currentValueGrossSantim: number;
  proposedValueGrossSantim: number;
  signatoryName: string;
  signatoryTitle: string;
  /** Both calendars, because an Ethiopian business letter carries both. */
  formatDate: (date: Date) => string;
}

/**
 * A first draft of the renewal letter, not a finished one.
 *
 * It exists so that "write the extension letter" is a five-minute edit instead
 * of a blank page, which is the difference between a contract renewed in the
 * window and one renewed after it lapsed. The uplift is stated as a figure and
 * a reason, because a renewal letter that only asks for more money invites a
 * negotiation the client did not otherwise intend to have.
 */
export function draftExtensionLetter(input: ExtensionLetterInput): string {
  const uplift = input.proposedValueGrossSantim - input.currentValueGrossSantim;
  const upliftBps =
    input.currentValueGrossSantim === 0
      ? null
      : Math.round((uplift / input.currentValueGrossSantim) * 10_000);

  const priceParagraph =
    uplift === 0
      ? `We propose to continue at the current annual value of ${formatETB(input.currentValueGrossSantim)}, inclusive of 15% VAT, with no increase.`
      : `We propose an annual value of ${formatETB(input.proposedValueGrossSantim)}, inclusive of 15% VAT` +
        `${upliftBps === null ? '' : ` — an adjustment of ${(upliftBps / 100).toFixed(1)}% on the current ${formatETB(input.currentValueGrossSantim)}`}` +
        `. The adjustment reflects movement in spare part and transport costs over the contract period.`;

  return [
    input.companyName,
    input.companyAddress,
    '',
    input.formatDate(new Date()),
    '',
    'To:',
    input.clientName,
    input.clientAddress,
    '',
    `Subject: Extension of lift maintenance contract ${input.contractNo} — ${input.siteName}`,
    '',
    'Dear Sir or Madam,',
    '',
    `Our maintenance contract ${input.contractNo}, covering ${input.units} lift${input.units === 1 ? '' : 's'} ` +
      `at ${input.siteName}, expires on ${input.formatDate(input.endDate)}. We are writing in good time so that ` +
      `service continues without interruption.`,
    '',
    `We would be pleased to extend the contract to ${input.formatDate(input.proposedEndDate)} on the same scope: ` +
      `scheduled preventive maintenance, emergency callout attendance within the agreed response time, and ` +
      `statutory inspection support.`,
    '',
    priceParagraph,
    '',
    'A summary of the service provided during the current period — visits completed, callouts attended and ' +
      'response times achieved — is attached for your records.',
    '',
    'If these terms are acceptable, kindly confirm in writing and we will issue the extension agreement for ' +
      'signature. Should you wish to discuss any part of the scope or the value, we would welcome a meeting ' +
      'before the expiry date.',
    '',
    'Yours faithfully,',
    '',
    '',
    input.signatoryName,
    input.signatoryTitle,
    input.companyName,
  ].join('\n');
}
