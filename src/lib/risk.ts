/**
 * Project risk assessment — the "in danger" alerts.
 *
 * Rules, not a model. Every flag names the number that triggered it and the ETB
 * at stake where there is any, because a manager who cannot see why a project
 * turned red will stop trusting the colour. There is deliberately no learned
 * scoring here: an alert that cannot be explained cannot be acted on.
 */

import { formatBps } from './kpi.js';
import type { ProjectKpiResult } from './kpi.js';
import { formatETB } from './money.js';
import type { RiskAssessment, RiskFlag, RiskSeverity } from './schema.js';
import type { ProjectStatusValue } from './status.js';

export interface RiskInput {
  kpi: ProjectKpiResult;
  status: ProjectStatusValue;
  /** Invoiced, unpaid, past due. */
  overdueReceivableSantim: number;
  /** Age of the oldest unpaid invoice, in days. */
  oldestOverdueDays: number | null;
  /** Active technicians assigned. */
  assignedTechnicians: number;
  /** Expired certifications across the assigned crew. */
  expiredCertifications: number;
  /** Team repeat-callout rate, inherited from the crew. */
  teamRepeatCalloutBps: number | null;
  /** Days since progress last moved. Null when never updated. */
  daysSinceProgressChange: number | null;
}

export interface RiskThresholds {
  /** Schedule variance at or below this is a slip. */
  scheduleSlipBps: number;
  /** Under-billing above this is severe. */
  severeUnderBillingBps: number;
  /** Margin below this is eroding. */
  marginWarningBps: number;
  /** AR older than this is critical. */
  criticalOverdueDays: number;
  /** AR older than this is worth flagging at all. */
  overdueDays: number;
  /** Team repeat-callout rate above this is a quality alarm. */
  repeatCalloutBps: number;
  /** No progress movement for this long on a live project is a stall. */
  stalledDays: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskThresholds = {
  scheduleSlipBps: -500,
  severeUnderBillingBps: 1500,
  marginWarningBps: 1500,
  criticalOverdueDays: 90,
  overdueDays: 30,
  repeatCalloutBps: 2000,
  stalledDays: 21,
};

const SEVERITY_SCORE: Record<RiskSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function assessProjectRisk(
  input: RiskInput,
  thresholds: RiskThresholds = DEFAULT_RISK_THRESHOLDS,
): RiskAssessment {
  const flags: RiskFlag[] = [];
  const { kpi } = input;

  // A finished or cancelled project cannot be rescued, only accounted for —
  // except for money still owed, which is chased regardless.
  const live = input.status === 'in_progress' || input.status === 'on_hold';

  // --- cash ---------------------------------------------------------------
  if (input.overdueReceivableSantim > 0 && input.oldestOverdueDays !== null) {
    if (input.oldestOverdueDays >= thresholds.criticalOverdueDays) {
      flags.push({
        code: 'overdue_receivable',
        severity: 'critical',
        message:
          `${formatETB(input.overdueReceivableSantim)} unpaid, oldest ` +
          `${input.oldestOverdueDays} days past due.`,
        amountSantim: input.overdueReceivableSantim,
      });
    } else if (input.oldestOverdueDays >= thresholds.overdueDays) {
      flags.push({
        code: 'overdue_receivable',
        severity: 'high',
        message:
          `${formatETB(input.overdueReceivableSantim)} past due by ` +
          `${input.oldestOverdueDays} days.`,
        amountSantim: input.overdueReceivableSantim,
      });
    }
  }

  if (live && kpi.underBillingBps !== null && kpi.underBillingBps > thresholds.severeUnderBillingBps) {
    // Work built but not invoiced is cash we have already spent and not asked for.
    const atStake = Math.round((kpi.contractNetSantim * kpi.underBillingBps) / 10_000);
    flags.push({
      code: 'severe_under_billing',
      severity: 'high',
      message:
        `${formatBps(kpi.underBillingBps)} of the contract is built but not invoiced ` +
        `(about ${formatETB(atStake)}).`,
      amountSantim: atStake,
    });
  }

  if (kpi.collectionRateBps !== null && kpi.collectionRateBps < 5_000 && kpi.invoicedBps !== null) {
    flags.push({
      code: 'poor_collection',
      severity: 'medium',
      message: `Only ${formatBps(kpi.collectionRateBps)} of invoiced value has been collected.`,
    });
  }

  // --- margin -------------------------------------------------------------
  if (kpi.grossMarginBps !== null) {
    if (kpi.grossMarginBps < 0) {
      flags.push({
        code: 'margin_negative',
        severity: 'critical',
        message:
          `Subcontract cost exceeds contract value — margin ${formatBps(kpi.grossMarginBps)} ` +
          `(${formatETB(kpi.grossMarginSantim)}).`,
        amountSantim: kpi.grossMarginSantim,
      });
    } else if (kpi.grossMarginBps < thresholds.marginWarningBps) {
      flags.push({
        code: 'margin_erosion',
        severity: 'high',
        message: `Gross margin down to ${formatBps(kpi.grossMarginBps)}.`,
        amountSantim: kpi.grossMarginSantim,
      });
    }
  }

  // --- schedule -----------------------------------------------------------
  if (live && kpi.overdue) {
    flags.push({
      code: 'overdue_delivery',
      severity: 'critical',
      message: `Past the planned handover by ${Math.abs(kpi.daysToPlannedEnd ?? 0)} days and still open.`,
    });
  } else if (live && kpi.scheduleVarianceBps <= thresholds.scheduleSlipBps) {
    flags.push({
      code: 'schedule_slip',
      severity: kpi.scheduleVarianceBps <= thresholds.scheduleSlipBps * 3 ? 'high' : 'medium',
      message:
        `${formatBps(kpi.progressBps, 0)} built against ${formatBps(kpi.expectedProgressBps, 0)} planned ` +
        `by now.`,
    });
  }

  if (
    live &&
    input.daysSinceProgressChange !== null &&
    input.daysSinceProgressChange >= thresholds.stalledDays
  ) {
    flags.push({
      code: 'stalled_progress',
      severity: 'high',
      message: `No progress recorded for ${input.daysSinceProgressChange} days.`,
    });
  }

  // --- delivery quality ---------------------------------------------------
  if (kpi.inspectionFirstPass === false) {
    flags.push({
      code: 'inspection_failed',
      severity: 'high',
      message: `Authority inspection needed ${kpi.inspectionAttempts} attempts — handover is gated on it.`,
    });
  }

  // --- team ---------------------------------------------------------------
  if (live && input.assignedTechnicians === 0) {
    flags.push({
      code: 'no_team_assigned',
      severity: 'high',
      message: 'No technician is assigned, so nobody owns delivery.',
    });
  }

  if (input.expiredCertifications > 0) {
    flags.push({
      code: 'expired_certification',
      severity: 'critical',
      message:
        `${input.expiredCertifications} expired certification` +
        `${input.expiredCertifications === 1 ? '' : 's'} on the assigned crew — certified work cannot proceed.`,
    });
  }

  if (
    input.teamRepeatCalloutBps !== null &&
    input.teamRepeatCalloutBps > thresholds.repeatCalloutBps
  ) {
    flags.push({
      code: 'repeat_callouts',
      severity: 'medium',
      message: `Crew repeat-callout rate is ${formatBps(input.teamRepeatCalloutBps)} — first fixes are not holding.`,
    });
  }

  return summarise(flags);
}

/**
 * Roll flags into an overall level.
 *
 * The level is the WORST flag, not an average — three medium warnings do not
 * add up to a crisis, and one critical is not softened by good news elsewhere.
 * The score is a saturating sum, used only to break ties in the ranking.
 */
export function summarise(flags: readonly RiskFlag[]): RiskAssessment {
  if (flags.length === 0) {
    return { level: 'none', inDanger: false, flags: [], riskScoreBps: 0 };
  }

  const worst = flags.reduce<RiskSeverity>(
    (acc, f) => (SEVERITY_SCORE[f.severity] > SEVERITY_SCORE[acc] ? f.severity : acc),
    'low',
  );

  const raw = flags.reduce((a, f) => a + SEVERITY_SCORE[f.severity], 0);
  // Saturating: eight severity points is already "as bad as it gets" for ranking.
  const riskScoreBps = Math.min(10_000, Math.round((raw * 10_000) / 8));

  return {
    level: worst,
    inDanger: worst === 'critical' || worst === 'high',
    flags: [...flags],
    riskScoreBps,
  };
}

/** Sort flags worst-first, so an alert list leads with what matters. */
export function sortFlags(flags: readonly RiskFlag[]): RiskFlag[] {
  return [...flags].sort((a, b) => {
    const bySeverity = SEVERITY_SCORE[b.severity] - SEVERITY_SCORE[a.severity];
    if (bySeverity !== 0) return bySeverity;
    return (b.amountSantim ?? 0) - (a.amountSantim ?? 0);
  });
}
