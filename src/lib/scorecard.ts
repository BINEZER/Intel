/**
 * Weighted KPI scorecards for projects and technicians.
 *
 * THE RULE THAT MATTERS MOST HERE
 *
 *   A component with no data is DROPPED and its weight REDISTRIBUTED across the
 *   components that do have data — never scored as zero.
 *
 *   Scoring a missing metric as zero would mark down a new project for having no
 *   invoices yet, or a technician for a quiet month. Redistribution asks the
 *   only fair question: of what we can actually measure, how are they doing?
 *   `coverageBps` reports how much of the intended weight was measurable, so a
 *   score built on one metric out of six is visibly thin rather than silently
 *   authoritative.
 */

import { clampBps, rateBps, type Grade } from './kpi.js';
import type { ProjectKpiResult, TechnicianKpiResult } from './kpi.js';
import type { ProjectKpiWeights, RateBps, TechnicianKpiWeights } from './schema.js';

// ---------------------------------------------------------------------------
// Achievement: turning a raw metric into "how close to target", 0-10000
// ---------------------------------------------------------------------------

/**
 * Achievement is capped at 100%. A scorecard where 300% on one metric cancels
 * 0% on another is not a scorecard — it is an average with extra steps.
 */
export function achievement(
  value: number | null,
  target: number,
  direction: 'higher' | 'lower' = 'higher',
): number | null {
  if (value === null) return null;
  if (direction === 'higher') {
    if (target <= 0) return 10_000;
    return clampBps(Math.round((value * 10_000) / target));
  }
  // Lower is better: hitting zero is a perfect score, not a division by zero.
  if (value <= 0) return 10_000;
  if (target <= 0) return 0;
  return clampBps(Math.round((target * 10_000) / value));
}

/**
 * Achievement for a signed variance, where zero is the goal and negative is bad.
 * On or ahead of plan scores full marks; at the tolerance, half; at twice the
 * tolerance or worse, nothing.
 */
export function achievementFromVariance(
  variance: number | null,
  toleranceBps: number,
): number | null {
  if (variance === null) return null;
  if (variance >= 0) return 10_000;
  const tolerance = Math.abs(toleranceBps);
  if (tolerance === 0) return 0;
  return clampBps(Math.round(10_000 - (Math.abs(variance) * 5_000) / tolerance));
}

// ---------------------------------------------------------------------------
// Weighted composite
// ---------------------------------------------------------------------------

export interface ScoreComponent {
  key: string;
  label: string;
  /** Achievement against target, 0-10000, or null when unmeasurable. */
  achievementBps: number | null;
  weightBps: number;
  /** The underlying figure, for display next to the score. */
  rawValue: number | null;
  target: number;
  direction: 'higher' | 'lower';
}

export interface Scorecard {
  /** 0-10000, or null when nothing at all could be measured. */
  scoreBps: number | null;
  /** Share of the intended weight that had data behind it. */
  coverageBps: number;
  components: ScoreComponent[];
  grade: Grade;
}

/** Weights must sum to 10000, or the composite silently means something else. */
export function assertWeightsValid(weights: Record<string, number>): void {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total !== 10_000) {
    const detail = Object.entries(weights)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    throw new RangeError(`KPI weights must sum to 10000 bps, got ${total} (${detail})`);
  }
  for (const [key, value] of Object.entries(weights)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`Weight '${key}' must be a non-negative integer in bps, got ${value}`);
    }
  }
}

export function composeScore(components: readonly ScoreComponent[]): Scorecard {
  const totalWeight = components.reduce((a, c) => a + c.weightBps, 0);
  const measured = components.filter((c) => c.achievementBps !== null);
  const measuredWeight = measured.reduce((a, c) => a + c.weightBps, 0);

  if (measuredWeight === 0) {
    return {
      scoreBps: null,
      coverageBps: 0,
      components: [...components],
      grade: 'unknown',
    };
  }

  // Redistribution: divide by the weight that had data, not the intended total.
  const weighted = measured.reduce((a, c) => a + (c.achievementBps as number) * c.weightBps, 0);
  const scoreBps = Math.round(weighted / measuredWeight);

  return {
    scoreBps,
    coverageBps: rateBps(measuredWeight, totalWeight) ?? 0,
    components: [...components],
    grade: scoreBps >= 9_000 ? 'good' : scoreBps >= 7_000 ? 'warn' : 'bad',
  };
}

// ---------------------------------------------------------------------------
// Technician scorecard
// ---------------------------------------------------------------------------

export const DEFAULT_TECHNICIAN_WEIGHTS: TechnicianKpiWeights = {
  // Service quality carries half the weight: whether the lift stayed fixed
  // matters more than how fast someone arrived.
  firstTimeFix: 2500,
  repeatCallouts: 2000,
  responseSla: 1500,
  resolutionSla: 1500,
  pmCompliance: 1500,
  pmOnTime: 500,
  utilisation: 500,
};

export interface TechnicianScoreTargets {
  firstTimeFixBps: number;
  repeatCalloutBps: number;
  slaResponseComplianceBps: number;
  slaResolutionComplianceBps: number;
  pmComplianceBps: number;
  pmOnTimeBps: number;
  utilisationBps: number;
}

export function technicianScorecard(
  kpi: TechnicianKpiResult,
  targets: TechnicianScoreTargets,
  weights: TechnicianKpiWeights = DEFAULT_TECHNICIAN_WEIGHTS,
): Scorecard {
  assertWeightsValid(weights as unknown as Record<string, number>);

  const component = (
    key: string,
    label: string,
    rawValue: RateBps,
    target: number,
    weightBps: number,
    direction: 'higher' | 'lower' = 'higher',
  ): ScoreComponent => ({
    key,
    label,
    rawValue,
    target,
    direction,
    weightBps,
    achievementBps: achievement(rawValue, target, direction),
  });

  return composeScore([
    component('firstTimeFix', 'First-time fix', kpi.firstTimeFixBps, targets.firstTimeFixBps, weights.firstTimeFix),
    component('repeatCallouts', 'Repeat callouts', kpi.repeatCalloutBps, targets.repeatCalloutBps, weights.repeatCallouts, 'lower'),
    component('responseSla', 'Response SLA', kpi.slaResponseComplianceBps, targets.slaResponseComplianceBps, weights.responseSla),
    component('resolutionSla', 'Resolution SLA', kpi.slaResolutionComplianceBps, targets.slaResolutionComplianceBps, weights.resolutionSla),
    component('pmCompliance', 'PM compliance', kpi.pmComplianceBps, targets.pmComplianceBps, weights.pmCompliance),
    component('pmOnTime', 'PM on time', kpi.pmOnTimeBps, targets.pmOnTimeBps, weights.pmOnTime),
    component('utilisation', 'Utilisation', kpi.utilisationBps, targets.utilisationBps, weights.utilisation),
  ]);
}

// ---------------------------------------------------------------------------
// Team performance inherited by a project
// ---------------------------------------------------------------------------

export interface TeamMemberScore {
  technicianId: string;
  technicianName: string;
  /** Share of that technician committed to this project. */
  allocationBps: number;
  scorecard: Scorecard;
}

export interface TeamScore {
  /** Allocation-weighted mean of the crew's scores, or null if none are scorable. */
  scoreBps: number | null;
  members: TeamMemberScore[];
  /** Members whose own score could not be computed at all. */
  unscoredMembers: number;
}

/**
 * A project's team score: its technicians' scorecards, weighted by how much of
 * each technician is committed to this project.
 *
 * A lead at 60% allocation moves the project's service score six times as much
 * as a helper at 10% — which is the right incentive, because the lead is who
 * the project actually depends on.
 */
export function teamScore(members: readonly TeamMemberScore[]): TeamScore {
  const scorable = members.filter((m) => m.scorecard.scoreBps !== null && m.allocationBps > 0);
  const totalAllocation = scorable.reduce((a, m) => a + m.allocationBps, 0);

  return {
    scoreBps:
      totalAllocation === 0
        ? null
        : Math.round(
            scorable.reduce((a, m) => a + (m.scorecard.scoreBps as number) * m.allocationBps, 0) /
              totalAllocation,
          ),
    members: [...members],
    unscoredMembers: members.length - scorable.length,
  };
}

// ---------------------------------------------------------------------------
// Project scorecard
// ---------------------------------------------------------------------------

export const DEFAULT_PROJECT_WEIGHTS: ProjectKpiWeights = {
  schedule: 2500,
  margin: 2000,
  billing: 1500,
  collection: 1500,
  quality: 1500,
  team: 1000,
};

export interface ProjectScoreTargets {
  scheduleVarianceBps: number;
  grossMarginBps: number;
  /** Tolerated gap between progress and billing before it scores down. */
  underBillingToleranceBps: number;
  collectionRateBps: number;
}

export function projectScorecard(
  kpi: ProjectKpiResult,
  targets: ProjectScoreTargets,
  team: TeamScore | null,
  weights: ProjectKpiWeights = DEFAULT_PROJECT_WEIGHTS,
): Scorecard {
  assertWeightsValid(weights as unknown as Record<string, number>);

  // Quality is a verdict, not a rate: passed first time, or it did not.
  const qualityAchievement =
    kpi.inspectionFirstPass === null ? null : kpi.inspectionFirstPass ? 10_000 : 4_000;

  return composeScore([
    {
      key: 'schedule',
      label: 'Schedule',
      rawValue: kpi.scheduleVarianceBps,
      target: 0,
      direction: 'higher',
      weightBps: weights.schedule,
      achievementBps: achievementFromVariance(kpi.scheduleVarianceBps, targets.scheduleVarianceBps),
    },
    {
      key: 'margin',
      label: 'Gross margin',
      rawValue: kpi.grossMarginBps,
      target: targets.grossMarginBps,
      direction: 'higher',
      weightBps: weights.margin,
      achievementBps: achievement(kpi.grossMarginBps, targets.grossMarginBps),
    },
    {
      key: 'billing',
      label: 'Billing keeping pace',
      rawValue: kpi.underBillingBps,
      target: targets.underBillingToleranceBps,
      direction: 'lower',
      weightBps: weights.billing,
      // Billing ahead of progress is not a problem, so clamp the variance at 0.
      achievementBps: achievement(
        kpi.underBillingBps === null ? null : Math.max(0, kpi.underBillingBps),
        targets.underBillingToleranceBps,
        'lower',
      ),
    },
    {
      key: 'collection',
      label: 'Collection',
      rawValue: kpi.collectionRateBps,
      target: targets.collectionRateBps,
      direction: 'higher',
      weightBps: weights.collection,
      achievementBps: achievement(kpi.collectionRateBps, targets.collectionRateBps),
    },
    {
      key: 'quality',
      label: 'Inspection',
      rawValue: kpi.inspectionFirstPass === null ? null : kpi.inspectionFirstPass ? 10_000 : 0,
      target: 10_000,
      direction: 'higher',
      weightBps: weights.quality,
      achievementBps: qualityAchievement,
    },
    {
      key: 'team',
      label: 'Team performance',
      rawValue: team?.scoreBps ?? null,
      target: 10_000,
      direction: 'higher',
      weightBps: weights.team,
      achievementBps: team?.scoreBps ?? null,
    },
  ]);
}
