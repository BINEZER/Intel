/**
 * Performance measurement for the whole workforce, not just the service desk.
 *
 * THE GAP THIS CLOSES
 *
 *   The original KPI model measured callouts, SLA windows and preventive
 *   visits — everything a service technician does and nothing an installation
 *   crew does. An installer who delivered four shafts on time scored `null`
 *   across the board, which reads as "unmeasured" and amounts to invisible.
 *
 *   Installation work is judged on different evidence: stages finished, finished
 *   on time, and whether the authority passed the job first time. Subcontractors
 *   are judged on a third set again — delivery against their scope, cost against
 *   what was agreed, and whether they can produce a TIN.
 *
 * Each discipline is scored on its own evidence and nothing is scored on
 * evidence it cannot produce.
 */

import { daysBetween, rateBps } from './kpi.js';
import type { RateBps } from './schema.js';

export type Discipline = 'installation' | 'service' | 'both';

// ---------------------------------------------------------------------------
// Installation
// ---------------------------------------------------------------------------

export interface StageOutcomeInput {
  projectId: string;
  stageKey: string;
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed';
  plannedEnd: Date | null;
  actualEnd: Date | null;
  /** Only stages this crew is accountable for — see `isOurs` in stages.ts. */
  ours: boolean;
}

export interface InspectionOutcomeInput {
  projectId: string;
  result: 'pending' | 'passed' | 'failed_rework' | 'not_applicable';
  attempts: number;
}

export interface InstallationKpi {
  projectsWorked: number;
  stagesCompleted: number;
  stagesInProgress: number;
  /** Completed on or before the planned end date. */
  onTimeStageBps: RateBps;
  /** Mean days late across completed stages; negative means early. */
  avgStageVarianceDays: number | null;
  /** Stages finished late, for the count behind the rate. */
  lateStages: number;
  /** Authority inspections passed first time, on projects this crew worked. */
  firstPassInspectionBps: RateBps;
  inspectionsJudged: number;
  /** Stages currently blocked on this crew's projects. */
  blockedStages: number;
}

/**
 * Installation performance.
 *
 * Stages owned by the client, a supplier or the authority are excluded before
 * anything is counted. Marking a crew down because customs held a shipment is
 * the fastest way to make a scorecard ignored.
 */
export function computeInstallationKpi(
  stages: readonly StageOutcomeInput[],
  inspections: readonly InspectionOutcomeInput[],
): InstallationKpi {
  const mine = stages.filter((s) => s.ours);
  const completed = mine.filter((s) => s.status === 'completed' && s.actualEnd !== null);
  const judged = completed.filter((s) => s.plannedEnd !== null);

  const variances = judged.map((s) => daysBetween(s.plannedEnd as Date, s.actualEnd as Date));
  const onTime = variances.filter((days) => days <= 0).length;

  const inspectionsJudged = inspections.filter(
    (i) => i.result === 'passed' || i.result === 'failed_rework',
  );

  return {
    projectsWorked: new Set(mine.map((s) => s.projectId)).size,
    stagesCompleted: completed.length,
    stagesInProgress: mine.filter((s) => s.status === 'in_progress').length,
    onTimeStageBps: rateBps(onTime, judged.length),
    avgStageVarianceDays:
      variances.length === 0
        ? null
        : Math.round(variances.reduce((a, b) => a + b, 0) / variances.length),
    lateStages: variances.filter((days) => days > 0).length,
    firstPassInspectionBps: rateBps(
      inspectionsJudged.filter((i) => i.result === 'passed' && i.attempts <= 1).length,
      inspectionsJudged.length,
    ),
    inspectionsJudged: inspectionsJudged.length,
    blockedStages: mine.filter((s) => s.status === 'blocked').length,
  };
}

// ---------------------------------------------------------------------------
// Subcontractors
// ---------------------------------------------------------------------------

export interface SubcontractorWorkInput {
  projectId: string;
  phaseName: string;
  /** Committed cost, VAT-exclusive. */
  netSantim: number;
  whtSantim: number;
  status: 'draft' | 'approved' | 'paid' | 'rejected' | 'void';
  /** When their invoice was raised and when we actually paid. */
  invoicedAt: Date;
  paidAt: Date | null;
}

export interface SubcontractorKpi {
  projects: number;
  vouchers: number;
  /** Total committed, VAT-exclusive. */
  committedNetSantim: number;
  paidNetSantim: number;
  whtWithheldSantim: number;
  /** Mean days from their invoice to our payment — how we treat them. */
  avgDaysToPaySantim: number | null;
  /** Vouchers approved but not yet paid. */
  outstandingVouchers: number;
  outstandingNetSantim: number;
  /** Rejected vouchers as a share of all submitted — a quality and paperwork signal. */
  rejectionBps: RateBps;
  /** No TIN means withholding at the 30% penalty rate and a compliance problem. */
  hasTin: boolean;
  /** Stages owned by this subcontractor that finished on time. */
  onTimeStageBps: RateBps;
}

/**
 * Subcontractor performance.
 *
 * `avgDaysToPay` measures US, not them. It is reported on their card on purpose:
 * a subcontractor who is paid ninety days late and still turns up is performing
 * well, and reading their delivery figures without that context is unfair.
 */
export function computeSubcontractorKpi(
  work: readonly SubcontractorWorkInput[],
  stages: readonly StageOutcomeInput[],
  hasTin: boolean,
): SubcontractorKpi {
  const live = work.filter((w) => w.status !== 'void');
  const committed = live.filter((w) => w.status === 'approved' || w.status === 'paid');
  const paid = live.filter((w) => w.status === 'paid' && w.paidAt !== null);

  const payDelays = paid.map((w) => daysBetween(w.invoicedAt, w.paidAt as Date));

  const completed = stages.filter((s) => s.status === 'completed' && s.actualEnd !== null);
  const judged = completed.filter((s) => s.plannedEnd !== null);
  const onTime = judged.filter(
    (s) => daysBetween(s.plannedEnd as Date, s.actualEnd as Date) <= 0,
  ).length;

  return {
    projects: new Set(committed.map((w) => w.projectId)).size,
    vouchers: live.length,
    committedNetSantim: committed.reduce((a, w) => a + w.netSantim, 0),
    paidNetSantim: paid.reduce((a, w) => a + w.netSantim, 0),
    whtWithheldSantim: committed.reduce((a, w) => a + w.whtSantim, 0),
    avgDaysToPaySantim:
      payDelays.length === 0
        ? null
        : Math.round(payDelays.reduce((a, b) => a + b, 0) / payDelays.length),
    outstandingVouchers: committed.filter((w) => w.status === 'approved').length,
    outstandingNetSantim: committed
      .filter((w) => w.status === 'approved')
      .reduce((a, w) => a + w.netSantim, 0),
    rejectionBps: rateBps(live.filter((w) => w.status === 'rejected').length, live.length),
    hasTin,
    onTimeStageBps: rateBps(onTime, judged.length),
  };
}

// ---------------------------------------------------------------------------
// One row per worker, whatever they do
// ---------------------------------------------------------------------------

export type WorkforceKind = 'technician' | 'subcontractor';

export interface WorkforceRow {
  id: string;
  name: string;
  kind: WorkforceKind;
  discipline: Discipline | null;
  /** Present for anyone doing installation work. */
  installation: InstallationKpi | null;
  /** Present for anyone doing service work. */
  service: {
    calloutsHandled: number;
    firstTimeFixBps: RateBps;
    repeatCalloutBps: RateBps;
    slaResponseComplianceBps: RateBps;
    pmComplianceBps: RateBps;
  } | null;
  /** Present for subcontractors. */
  subcontractor: SubcontractorKpi | null;
  certificationsExpired: number;
  certificationsExpiringSoon: number;
  /** 0-10000, or null when there is nothing to score. */
  scoreBps: number | null;
  /** How much of the intended weight had data behind it. */
  coverageBps: number;
}

/**
 * Headline figures for a workforce listing, chosen per discipline so the same
 * table can show an installer, a service technician and a subcontractor without
 * pretending they are measured alike.
 */
export function headlineMetrics(row: WorkforceRow): { label: string; value: RateBps }[] {
  if (row.kind === 'subcontractor' && row.subcontractor !== null) {
    return [
      { label: 'On-time stages', value: row.subcontractor.onTimeStageBps },
      { label: 'Rejected vouchers', value: row.subcontractor.rejectionBps },
    ];
  }

  const metrics: { label: string; value: RateBps }[] = [];
  if (row.installation !== null) {
    metrics.push({ label: 'On-time stages', value: row.installation.onTimeStageBps });
    metrics.push({ label: 'First-pass inspection', value: row.installation.firstPassInspectionBps });
  }
  if (row.service !== null) {
    metrics.push({ label: 'First-time fix', value: row.service.firstTimeFixBps });
    metrics.push({ label: 'Response SLA', value: row.service.slaResponseComplianceBps });
  }
  return metrics;
}
