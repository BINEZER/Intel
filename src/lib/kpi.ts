/**
 * KPI computation for projects and technicians.
 *
 * Pure functions over plain inputs, so every metric is unit-testable and the
 * same code can run in a Cloud Function (to write snapshots) or in the browser
 * (to preview a period before it closes).
 *
 * TWO RULES THAT SHAPE EVERYTHING HERE
 *
 *   1. A rate with no denominator is `null`, never 0. A technician with no
 *      callouts this month has NO SLA compliance figure — showing 0% would
 *      brand a blameless person as a total failure. `null` renders as "—".
 *
 *   2. Rates are integer basis points and durations are whole minutes, for the
 *      same reason money is integer santim: these numbers get averaged, ranked
 *      and compared to targets, and float drift in a KPI is invisible until
 *      someone's bonus depends on it.
 */

import type { RateBps } from './schema.js';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * A ratio in basis points, or `null` when there is nothing to divide by.
 * This is the single most important helper in the file — see rule 1 above.
 */
export function rateBps(numerator: number, denominator: number): RateBps {
  if (denominator === 0) return null;
  return Math.round((numerator * 10_000) / denominator);
}

export function clampBps(value: number): number {
  return Math.min(10_000, Math.max(0, value));
}

/** Whole minutes between two instants, or null if either is missing. */
export function minutesBetween(from: Date | null, to: Date | null): number | null {
  if (from === null || to === null) return null;
  return Math.round((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}

/** Whole days between two instants. Positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Median, which resists the one four-hour callout that would drag a mean apart. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

// ---------------------------------------------------------------------------
// Grading against targets
// ---------------------------------------------------------------------------

export type Grade = 'good' | 'warn' | 'bad' | 'unknown';

/**
 * Grade a value against a target.
 *
 * `direction` says which way is good: `'higher'` for compliance and margin,
 * `'lower'` for repeat callouts and response times. Amber is the 10% band on
 * the wrong side of target, so a near miss reads differently from a collapse.
 */
export function grade(
  value: number | null,
  target: number,
  direction: 'higher' | 'lower' = 'higher',
): Grade {
  if (value === null) return 'unknown';
  const warnBand = Math.abs(target) * 0.1;
  if (direction === 'higher') {
    if (value >= target) return 'good';
    return value >= target - warnBand ? 'warn' : 'bad';
  }
  if (value <= target) return 'good';
  return value <= target + warnBand ? 'warn' : 'bad';
}

// ---------------------------------------------------------------------------
// Project KPIs
// ---------------------------------------------------------------------------

export interface ProjectKpiInput {
  plannedStart: Date;
  plannedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
  /** Physical progress, 0-10000. */
  progressBps: number;
  status: 'planned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
  contractNetSantim: number;
  subcontractCostNetSantim: number;
  invoicedNetSantim: number;
  collectedGrossSantim: number;
  invoicedGrossSantim: number;
  phases: readonly PhaseKpiInput[];
  /** Settled invoices, for the collection-days figure. */
  settledInvoices: readonly { issuedAt: Date; settledAt: Date; grossSantim: number }[];
}

export interface PhaseKpiInput {
  key: string;
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed';
  actualStart: Date | null;
  actualEnd: Date | null;
  /** Present only on the authority-inspection phase. */
  certification?: { result: 'pending' | 'passed' | 'failed_rework' | 'not_applicable'; attempts: number };
}

export interface ProjectKpiResult {
  progressBps: number;
  expectedProgressBps: number;
  scheduleVarianceBps: number;
  scheduleVarianceDays: number | null;
  daysToPlannedEnd: number | null;
  overdue: boolean;
  contractNetSantim: number;
  subcontractCostNetSantim: number;
  grossMarginSantim: number;
  grossMarginBps: RateBps;
  invoicedBps: RateBps;
  collectionRateBps: RateBps;
  underBillingBps: number | null;
  avgCollectionDays: number | null;
  phasesCompleted: number;
  phasesTotal: number;
  inspectionFirstPass: boolean | null;
  inspectionAttempts: number;
  phaseDurationDays: Record<string, number>;
}

/**
 * How much of the plan *should* be done by `asOf`, as a share of the planned
 * duration. Straight-line, which is the honest default: pretending to know an
 * S-curve for a shaft installation would be false precision.
 */
export function expectedProgressBps(plannedStart: Date, plannedEnd: Date, asOf: Date): number {
  const total = plannedEnd.getTime() - plannedStart.getTime();
  if (total <= 0) return asOf >= plannedEnd ? 10_000 : 0;
  const elapsed = asOf.getTime() - plannedStart.getTime();
  return clampBps(Math.round((elapsed * 10_000) / total));
}

export function computeProjectKpis(input: ProjectKpiInput, asOf: Date): ProjectKpiResult {
  const expected = expectedProgressBps(input.plannedStart, input.plannedEnd, asOf);
  const complete = input.status === 'completed';

  // For a finished project the variance is a fact: actual end vs planned end.
  // For one still running it is a forecast we decline to make — we report how
  // many days remain and let the progress variance carry the warning.
  const scheduleVarianceDays =
    complete && input.actualEnd !== null ? daysBetween(input.plannedEnd, input.actualEnd) : null;

  const grossMarginSantim = input.contractNetSantim - input.subcontractCostNetSantim;
  const invoicedBps = rateBps(input.invoicedNetSantim, input.contractNetSantim);

  const collectionDays = input.settledInvoices.map((i) => ({
    days: daysBetween(i.issuedAt, i.settledAt),
    weight: i.grossSantim,
  }));
  const totalWeight = collectionDays.reduce((a, c) => a + c.weight, 0);
  const avgCollectionDays =
    totalWeight === 0
      ? null
      : Math.round(collectionDays.reduce((a, c) => a + c.days * c.weight, 0) / totalWeight);

  const inspection = input.phases.find((p) => p.certification !== undefined)?.certification;

  const phaseDurationDays: Record<string, number> = {};
  for (const phase of input.phases) {
    if (phase.actualStart !== null && phase.actualEnd !== null) {
      phaseDurationDays[phase.key] = daysBetween(phase.actualStart, phase.actualEnd);
    }
  }

  return {
    progressBps: input.progressBps,
    expectedProgressBps: expected,
    scheduleVarianceBps: input.progressBps - expected,
    scheduleVarianceDays,
    daysToPlannedEnd: complete ? null : daysBetween(asOf, input.plannedEnd),
    overdue: !complete && asOf > input.plannedEnd,
    contractNetSantim: input.contractNetSantim,
    subcontractCostNetSantim: input.subcontractCostNetSantim,
    grossMarginSantim,
    grossMarginBps: rateBps(grossMarginSantim, input.contractNetSantim),
    invoicedBps,
    collectionRateBps: rateBps(input.collectedGrossSantim, input.invoicedGrossSantim),
    // Under-billing only means something once we know how much was invoiced.
    underBillingBps: invoicedBps === null ? null : input.progressBps - invoicedBps,
    avgCollectionDays,
    phasesCompleted: input.phases.filter((p) => p.status === 'completed').length,
    phasesTotal: input.phases.length,
    inspectionFirstPass:
      inspection === undefined || inspection.result === 'pending' || inspection.result === 'not_applicable'
        ? null
        : inspection.result === 'passed' && inspection.attempts <= 1,
    inspectionAttempts: inspection?.attempts ?? 0,
    phaseDurationDays,
  };
}

// ---------------------------------------------------------------------------
// Technician KPIs
// ---------------------------------------------------------------------------

export interface CalloutKpiInput {
  id: string;
  technicianId: string | null;
  unitTag: string;
  entrapment: boolean;
  reportedAt: Date;
  arrivedAt: Date | null;
  resolvedAt: Date | null;
  slaResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
  firstTimeFix: boolean | null;
  status: 'open' | 'assigned' | 'on_site' | 'resolved' | 'cancelled';
  repeatOfCalloutId: string | null;
}

export interface VisitKpiInput {
  technicianId: string | null;
  scheduledDate: Date;
  completedDate: Date | null;
  status: 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';
  durationMinutes: number | null;
}

export interface CertificationKpiInput {
  expiryDate: Date;
}

export interface TechnicianKpiResult {
  calloutsHandled: number;
  entrapments: number;
  avgResponseMinutes: number | null;
  medianResponseMinutes: number | null;
  avgRepairMinutes: number | null;
  slaResponseComplianceBps: RateBps;
  slaResolutionComplianceBps: RateBps;
  firstTimeFixBps: RateBps;
  repeatCalloutBps: RateBps;
  pmVisitsScheduled: number;
  pmVisitsCompleted: number;
  pmComplianceBps: RateBps;
  pmOnTimeBps: RateBps;
  loggedMinutes: number;
  utilisationBps: RateBps;
  certificationsExpiringSoon: number;
  certificationsExpired: number;
}

/**
 * Response and repair times, computed the same way everywhere.
 *
 * Response is reported -> on site; repair is on site -> back in service. Keeping
 * them separate matters: a technician cannot control Addis traffic, but they can
 * control how long the repair takes, and merging the two hides which is failing.
 */
export function calloutDurations(callout: CalloutKpiInput): {
  responseMinutes: number | null;
  repairMinutes: number | null;
  breachedResponse: boolean | null;
  breachedResolution: boolean | null;
} {
  const responseMinutes = minutesBetween(callout.reportedAt, callout.arrivedAt);
  const repairMinutes = minutesBetween(callout.arrivedAt, callout.resolvedAt);
  const totalMinutes = minutesBetween(callout.reportedAt, callout.resolvedAt);

  return {
    responseMinutes,
    repairMinutes,
    breachedResponse:
      responseMinutes === null || callout.slaResponseMinutes === null
        ? null
        : responseMinutes > callout.slaResponseMinutes,
    // Resolution SLA runs from the report, not from arrival — that is what the
    // client experiences and what the contract promises.
    breachedResolution:
      totalMinutes === null || callout.slaResolutionMinutes === null
        ? null
        : totalMinutes > callout.slaResolutionMinutes,
  };
}

/**
 * Mark callouts that recur on the same unit within `windowDays` of an earlier
 * resolved callout. A repeat is the strongest signal that the first fix did not
 * hold, which no response-time metric will ever show.
 *
 * Returns a new array; the input is not mutated.
 */
export function flagRepeatCallouts(
  callouts: readonly CalloutKpiInput[],
  windowDays: number,
): CalloutKpiInput[] {
  const byUnit = new Map<string, CalloutKpiInput[]>();
  for (const c of callouts) {
    const list = byUnit.get(c.unitTag);
    if (list === undefined) byUnit.set(c.unitTag, [c]);
    else list.push(c);
  }

  const repeatOf = new Map<string, string | null>();
  for (const list of byUnit.values()) {
    const ordered = [...list].sort((a, b) => a.reportedAt.getTime() - b.reportedAt.getTime());
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i] as CalloutKpiInput;
      let previousId: string | null = null;
      // Walk backwards to the most recent *resolved* callout on this unit.
      for (let j = i - 1; j >= 0; j--) {
        const earlier = ordered[j] as CalloutKpiInput;
        if (earlier.resolvedAt === null) continue;
        const gap = daysBetween(earlier.resolvedAt, current.reportedAt);
        if (gap <= windowDays) previousId = earlier.id;
        break;
      }
      repeatOf.set(current.id, previousId);
    }
  }

  return callouts.map((c) => ({ ...c, repeatOfCalloutId: repeatOf.get(c.id) ?? null }));
}

export interface TechnicianKpiOptions {
  /** Working minutes available in the period, for utilisation. 0 disables the metric. */
  availableMinutes: number;
  /** Days ahead of expiry at which a certification counts as expiring soon. */
  certificationWarningDays: number;
}

export function computeTechnicianKpis(
  callouts: readonly CalloutKpiInput[],
  visits: readonly VisitKpiInput[],
  certifications: readonly CertificationKpiInput[],
  asOf: Date,
  options: TechnicianKpiOptions,
): TechnicianKpiResult {
  // Cancelled work is not the technician's record either way.
  const live = callouts.filter((c) => c.status !== 'cancelled');
  const resolved = live.filter((c) => c.resolvedAt !== null);

  const durations = resolved.map((c) => calloutDurations(c));
  const responseTimes = durations
    .map((d) => d.responseMinutes)
    .filter((n): n is number => n !== null);
  const repairTimes = durations.map((d) => d.repairMinutes).filter((n): n is number => n !== null);

  // Only callouts that actually carried an SLA can be judged against one.
  const responseJudged = durations.filter((d) => d.breachedResponse !== null);
  const resolutionJudged = durations.filter((d) => d.breachedResolution !== null);

  const firstTimeFixJudged = resolved.filter((c) => c.firstTimeFix !== null);

  const scheduledVisits = visits.filter((v) => v.status !== 'cancelled');
  const completedVisits = scheduledVisits.filter(
    (v) => v.status === 'completed' && v.completedDate !== null,
  );
  const onTimeVisits = completedVisits.filter(
    (v) => (v.completedDate as Date).getTime() <= v.scheduledDate.getTime(),
  );

  const loggedMinutes =
    repairTimes.reduce((a, b) => a + b, 0) +
    scheduledVisits.reduce((a, v) => a + (v.durationMinutes ?? 0), 0);

  const warningCutoff = new Date(asOf.getTime() + options.certificationWarningDays * MS_PER_DAY);

  return {
    calloutsHandled: live.length,
    entrapments: live.filter((c) => c.entrapment).length,
    avgResponseMinutes: mean(responseTimes),
    medianResponseMinutes: median(responseTimes),
    avgRepairMinutes: mean(repairTimes),
    slaResponseComplianceBps: rateBps(
      responseJudged.filter((d) => d.breachedResponse === false).length,
      responseJudged.length,
    ),
    slaResolutionComplianceBps: rateBps(
      resolutionJudged.filter((d) => d.breachedResolution === false).length,
      resolutionJudged.length,
    ),
    firstTimeFixBps: rateBps(
      firstTimeFixJudged.filter((c) => c.firstTimeFix === true).length,
      firstTimeFixJudged.length,
    ),
    repeatCalloutBps: rateBps(
      live.filter((c) => c.repeatOfCalloutId !== null).length,
      live.length,
    ),
    pmVisitsScheduled: scheduledVisits.length,
    pmVisitsCompleted: completedVisits.length,
    pmComplianceBps: rateBps(completedVisits.length, scheduledVisits.length),
    pmOnTimeBps: rateBps(onTimeVisits.length, completedVisits.length),
    loggedMinutes,
    utilisationBps: rateBps(loggedMinutes, options.availableMinutes),
    certificationsExpired: certifications.filter((c) => c.expiryDate <= asOf).length,
    certificationsExpiringSoon: certifications.filter(
      (c) => c.expiryDate > asOf && c.expiryDate <= warningCutoff,
    ).length,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** `95.0%`, or `—` when there is no data. */
export function formatBps(value: RateBps, fractionDigits = 1): string {
  if (value === null) return '—';
  return `${(value / 100).toFixed(fractionDigits)}%`;
}

/** `1h 45m`, `38m`, or `—`. Durations are read at a glance, not parsed. */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  const hours = Math.floor(abs / 60);
  const rest = abs % 60;
  if (hours === 0) return `${sign}${rest}m`;
  return rest === 0 ? `${sign}${hours}h` : `${sign}${hours}h ${rest}m`;
}

/** `+3 days late` / `2 days early` / `—`. */
export function formatVarianceDays(days: number | null): string {
  if (days === null) return '—';
  if (days === 0) return 'on time';
  return days > 0 ? `${days} day${days === 1 ? '' : 's'} late` : `${-days} day${days === -1 ? '' : 's'} early`;
}

export const DEFAULT_KPI_TARGETS = {
  slaResponseComplianceBps: 9500,
  slaResolutionComplianceBps: 9000,
  firstTimeFixBps: 8000,
  repeatCalloutBps: 1000,
  pmComplianceBps: 9500,
  pmOnTimeBps: 9000,
  utilisationBps: 7500,
  grossMarginBps: 2500,
  scheduleVarianceBps: -500,
  repeatCalloutWindowDays: 30,
  certificationWarningDays: 60,
} as const;
