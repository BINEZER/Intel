/**
 * A lift's own history.
 *
 * THE PROBLEM
 *   A lift outlives the project that installed it and the contract that services
 *   it. Its callouts, its maintenance findings and its certificate all attach to
 *   the UNIT — but until now a unit existed only as an entry inside a project
 *   document, and callouts referred to it by a tag like "LIFT-01".
 *
 *   "LIFT-01" is not an identity. Every building has one. So history is matched
 *   on the pair that actually identifies a machine in the stored records —
 *   its contract and its tag, falling back to its site and its tag — and this
 *   file is the ONE place that matching happens, so it can be corrected in one
 *   place when units carry a stable id everywhere.
 *
 * WHAT A HISTORY IS FOR
 *   Deciding whether to renew, what to quote, and which machine is quietly
 *   eating the service margin. That makes the useful output not a list of
 *   events but a pattern: how often it breaks, whether the same fault keeps
 *   coming back, whether anyone is actually visiting it, and what the engineers
 *   have written down about it.
 */

import { daysBetween, rateBps } from './kpi.js';
import type { RateBps } from './schema.js';

export interface UnitKey {
  unitTag: string;
  contractId: string | null;
  siteName: string;
}

export interface HistoryCallout {
  id: string;
  calloutNo: string;
  unitTag: string;
  contractId: string;
  siteName: string;
  category: 'breakdown' | 'entrapment' | 'callback' | 'damage' | 'other';
  entrapment: boolean;
  description: string;
  technicianName: string | null;
  reportedAt: Date;
  resolvedAt: Date | null;
  responseMinutes: number | null;
  repairMinutes: number | null;
  breachedResponse: boolean | null;
  resolution: string | null;
  firstTimeFix: boolean | null;
  repeatOfCalloutId: string | null;
  status: 'open' | 'assigned' | 'on_site' | 'resolved' | 'cancelled';
  partsUsed: readonly { description: string; qty: number; costNetSantim: number }[];
}

export interface HistoryVisit {
  id: string;
  unitTag: string;
  contractId: string;
  siteName: string;
  technicianName: string | null;
  scheduledDate: Date;
  completedDate: Date | null;
  status: 'scheduled' | 'completed' | 'missed' | 'rescheduled' | 'cancelled';
  checklistCompleteBps: number;
  findings: readonly { note: string; severity: 'info' | 'defect' | 'safety' }[];
}

/**
 * Does this record belong to this unit?
 *
 * Contract plus tag is the stronger match and is tried first. Site plus tag
 * catches records written before the unit was under its current contract —
 * which is exactly the history a take-on survey needs.
 */
export function matchesUnit(key: UnitKey, record: { unitTag: string; contractId: string; siteName: string }): boolean {
  if (record.unitTag !== key.unitTag) return false;
  if (key.contractId !== null && record.contractId === key.contractId) return true;
  return record.siteName === key.siteName;
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

export type TimelineKind = 'callout' | 'visit' | 'finding';

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: Date;
  title: string;
  /** What was written down — the remark a manager actually wants to read. */
  detail: string;
  technicianName: string | null;
  severity: 'info' | 'defect' | 'safety' | 'breakdown' | 'entrapment';
  /** Still open, so it belongs at the top of any list of things to do. */
  open: boolean;
}

/**
 * Every recorded event on one lift, newest first.
 *
 * Maintenance FINDINGS are promoted to entries of their own rather than being
 * buried inside the visit that raised them. A safety finding written on a
 * routine visit is the single most important thing in a unit's history, and
 * folding it into "visit completed" is how it gets missed.
 */
export function buildTimeline(
  callouts: readonly HistoryCallout[],
  visits: readonly HistoryVisit[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const callout of callouts) {
    entries.push({
      id: callout.id,
      kind: 'callout',
      at: callout.reportedAt,
      title: `${callout.calloutNo} · ${callout.category.replace(/_/g, ' ')}${callout.entrapment ? ' (entrapment)' : ''}`,
      detail: callout.description,
      technicianName: callout.technicianName,
      severity: callout.entrapment ? 'entrapment' : 'breakdown',
      open: callout.status !== 'resolved' && callout.status !== 'cancelled',
    });
  }

  for (const visit of visits) {
    const at = visit.completedDate ?? visit.scheduledDate;
    entries.push({
      id: visit.id,
      kind: 'visit',
      at,
      title:
        visit.status === 'completed'
          ? `Maintenance visit · checklist ${Math.round(visit.checklistCompleteBps / 100)}% complete`
          : `Maintenance visit ${visit.status}`,
      detail:
        visit.findings.length === 0
          ? 'No findings recorded.'
          : `${visit.findings.length} finding${visit.findings.length === 1 ? '' : 's'} recorded.`,
      technicianName: visit.technicianName,
      severity: visit.status === 'missed' ? 'defect' : 'info',
      open: visit.status === 'scheduled',
    });

    visit.findings.forEach((finding, index) => {
      entries.push({
        id: `${visit.id}-f${index}`,
        kind: 'finding',
        at,
        title: finding.severity === 'safety' ? 'Safety finding' : finding.severity === 'defect' ? 'Defect found' : 'Note',
        detail: finding.note,
        technicianName: visit.technicianName,
        severity: finding.severity,
        // A safety finding stays "open" in the reader's mind until someone acts
        // on it; nothing in the schema closes one, so it is always surfaced.
        open: finding.severity === 'safety',
      });
    });
  }

  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ---------------------------------------------------------------------------
// The pattern
// ---------------------------------------------------------------------------

export interface UnitHealth {
  callouts: number;
  calloutsLast12Months: number;
  entrapments: number;
  openCallouts: number;
  repeatCallouts: number;
  /** Share of callouts that were a repeat on this machine. Null with no data. */
  repeatRateBps: RateBps;
  firstTimeFixBps: RateBps;
  avgResponseMinutes: number | null;
  avgRepairMinutes: number | null;

  visitsScheduled: number;
  visitsCompleted: number;
  visitsMissed: number;
  pmComplianceBps: RateBps;

  openSafetyFindings: number;
  openDefects: number;
  partsCostSantim: number;

  lastCalloutAt: Date | null;
  lastVisitAt: Date | null;
  daysSinceLastVisit: number | null;

  /**
   * A one-word verdict, and the reason for it.
   *
   * `unknown` when there is nothing recorded — which is a real state and not the
   * same as healthy. A lift nobody has logged anything against for two years is
   * not a lift with no problems.
   */
  verdict: 'healthy' | 'watch' | 'problem' | 'unknown';
  reasons: string[];
}

export interface HealthThresholds {
  /** Callouts in twelve months above which a unit is a problem. */
  problemCalloutsPerYear: number;
  watchCalloutsPerYear: number;
  /** Repeat rate above which the fault is not actually being fixed. */
  repeatRateBps: number;
  /** No preventive visit for this long on a serviced unit is a lapse. */
  staleVisitDays: number;
}

export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  problemCalloutsPerYear: 6,
  watchCalloutsPerYear: 3,
  repeatRateBps: 3000,
  staleVisitDays: 120,
};

export function assessUnitHealth(
  callouts: readonly HistoryCallout[],
  visits: readonly HistoryVisit[],
  asOf: Date,
  thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS,
): UnitHealth {
  const yearAgo = new Date(asOf.getTime() - 365 * 86_400_000);
  const live = callouts.filter((c) => c.status !== 'cancelled');
  const recent = live.filter((c) => c.reportedAt >= yearAgo);

  const responded = live.filter((c) => c.responseMinutes !== null);
  const repaired = live.filter((c) => c.repairMinutes !== null);
  const judgedFix = live.filter((c) => c.firstTimeFix !== null);

  const completedVisits = visits.filter((v) => v.status === 'completed');
  const missedVisits = visits.filter((v) => v.status === 'missed');
  // Cancelled and rescheduled visits were never owed on the day, so they are not
  // counted against compliance — only what was promised and then not done.
  const owedVisits = completedVisits.length + missedVisits.length;

  const findings = visits.flatMap((v) => v.findings);
  const lastVisit = completedVisits
    .map((v) => v.completedDate)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const lastCallout = live.map((c) => c.reportedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const repeats = live.filter((c) => c.repeatOfCalloutId !== null).length;
  const repeatRateBps = rateBps(repeats, live.length);
  const daysSinceLastVisit = lastVisit === null ? null : daysBetween(lastVisit, asOf);

  const reasons: string[] = [];
  let verdict: UnitHealth['verdict'] = 'healthy';

  if (live.length === 0 && visits.length === 0) {
    verdict = 'unknown';
    reasons.push('Nothing has ever been recorded against this unit. That is not the same as no problems.');
  } else {
    if (recent.length >= thresholds.problemCalloutsPerYear) {
      verdict = 'problem';
      reasons.push(`${recent.length} callouts in the last twelve months.`);
    } else if (recent.length >= thresholds.watchCalloutsPerYear) {
      verdict = 'watch';
      reasons.push(`${recent.length} callouts in the last twelve months.`);
    }

    if (repeatRateBps !== null && repeatRateBps >= thresholds.repeatRateBps) {
      verdict = 'problem';
      reasons.push(`${Math.round(repeatRateBps / 100)}% of callouts were a repeat — the fault is not being fixed.`);
    }

    const safety = findings.filter((f) => f.severity === 'safety').length;
    if (safety > 0) {
      verdict = 'problem';
      reasons.push(`${safety} safety finding${safety === 1 ? '' : 's'} recorded and not signed off.`);
    }

    if (live.some((c) => c.entrapment)) {
      if (verdict === 'healthy') verdict = 'watch';
      reasons.push(`${live.filter((c) => c.entrapment).length} entrapment${live.filter((c) => c.entrapment).length === 1 ? '' : 's'} on record.`);
    }

    if (daysSinceLastVisit !== null && daysSinceLastVisit > thresholds.staleVisitDays) {
      if (verdict === 'healthy') verdict = 'watch';
      reasons.push(`No preventive visit for ${daysSinceLastVisit} days.`);
    } else if (lastVisit === null && visits.length === 0 && live.length > 0) {
      if (verdict === 'healthy') verdict = 'watch';
      reasons.push('Callouts on record but no preventive visit ever completed.');
    }

    if (reasons.length === 0) {
      reasons.push(
        recent.length === 0
          ? 'No callouts in the last twelve months.'
          : `${recent.length} callout${recent.length === 1 ? '' : 's'} in the last twelve months, none repeating.`,
      );
    }
  }

  const mean = (values: readonly number[]) =>
    values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return {
    callouts: live.length,
    calloutsLast12Months: recent.length,
    entrapments: live.filter((c) => c.entrapment).length,
    openCallouts: live.filter((c) => c.status !== 'resolved').length,
    repeatCallouts: repeats,
    repeatRateBps,
    firstTimeFixBps: rateBps(judgedFix.filter((c) => c.firstTimeFix === true).length, judgedFix.length),
    avgResponseMinutes: mean(responded.map((c) => c.responseMinutes as number)),
    avgRepairMinutes: mean(repaired.map((c) => c.repairMinutes as number)),

    visitsScheduled: visits.length,
    visitsCompleted: completedVisits.length,
    visitsMissed: missedVisits.length,
    pmComplianceBps: rateBps(completedVisits.length, owedVisits),

    openSafetyFindings: findings.filter((f) => f.severity === 'safety').length,
    openDefects: findings.filter((f) => f.severity === 'defect').length,
    partsCostSantim: live.reduce((a, c) => a + c.partsUsed.reduce((x, p) => x + p.costNetSantim, 0), 0),

    lastCalloutAt: lastCallout,
    lastVisitAt: lastVisit,
    daysSinceLastVisit,

    verdict,
    reasons,
  };
}

/** Worst units first — what a service manager opens the page to find. */
export function sortByHealth<T extends { health: UnitHealth }>(rows: readonly T[]): T[] {
  const rank: Record<UnitHealth['verdict'], number> = { problem: 0, watch: 1, unknown: 2, healthy: 3 };
  return [...rows].sort((a, b) => {
    const byVerdict = rank[a.health.verdict] - rank[b.health.verdict];
    if (byVerdict !== 0) return byVerdict;
    return b.health.calloutsLast12Months - a.health.calloutsLast12Months;
  });
}
