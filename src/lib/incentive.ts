/**
 * Turning a KPI score into money and promotions.
 *
 * THE NUMBERS IN THIS FILE ARE A STARTING POINT, NOT A POLICY.
 *
 *   Every weight, threshold, band and cap below is editable in Settings, and the
 *   defaults are a plausible scheme rather than IntelMotion's. An incentive
 *   scheme is a promise to people about their pay; it belongs to the business,
 *   not to whoever wrote the code. What this file guarantees is that whatever
 *   scheme is set is applied consistently, explains itself, and cannot pay out
 *   on evidence that is not there.
 *
 * THE THREE RULES THAT MAKE A SCHEME SURVIVABLE
 *
 *   1. NO PAYOUT ON A SCORE YOU COULD NOT MEASURE. A technician with two
 *      callouts all quarter has a score, but it is not evidence. Below the
 *      coverage floor the scheme pays nothing and says why — because the
 *      alternative is paying a bonus on noise, and once that happens the
 *      scheme is understood to be arbitrary and stops changing behaviour.
 *
 *   2. GATES ARE ABSOLUTE. A gate is not a weighted component; it is a
 *      condition. An open safety finding or a falsified record voids the
 *      payout entirely, however good the rest looks. A scheme where safety is
 *      merely 15% of a score is a scheme that pays for unsafe work at a
 *      discount.
 *
 *   3. THE ARITHMETIC IS SHOWN. Every payout comes with the contribution of
 *      each component in birr. An incentive nobody can reconstruct is heard as
 *      a number management chose, and motivates nothing.
 */

import { assertWeightsValid, type Scorecard, type ScoreComponent } from './scorecard.js';
import { allocateByShares } from './milestones.js';
import { formatETB } from './money.js';

// ---------------------------------------------------------------------------
// The scheme
// ---------------------------------------------------------------------------

export interface IncentiveBand {
  key: string;
  label: string;
  /** Score at or above which this band applies, in bps. */
  fromBps: number;
  /**
   * Payout as a share of the base figure, in bps. 1000 = 10% of base.
   * Expressed as a share rather than an amount so one scheme covers everyone.
   */
  payoutBps: number;
  /** What this band is meant to say to the person receiving it. */
  meaning: string;
}

export type GateKey =
  | 'coverage'
  | 'open_safety_finding'
  | 'expired_certification'
  | 'unresolved_entrapment'
  | 'record_integrity'
  | 'minimum_service';

export interface IncentiveGate {
  key: GateKey;
  label: string;
  /** Why this voids a payout rather than merely reducing it. */
  rationale: string;
  enabled: boolean;
}

export interface IncentiveScheme {
  key: string;
  name: string;
  description: string;
  /** Which KPI weights this scheme scores on. Must sum to 10000. */
  weights: Record<string, number>;
  bands: readonly IncentiveBand[];
  gates: readonly IncentiveGate[];
  /**
   * Share of the intended KPI weight that must have had data behind it.
   * Below this, no payout: a score computed from a third of the evidence is
   * not a measurement of anything.
   */
  minCoverageBps: number;
  /** Hard ceiling on a single period's payout, in bps of base. */
  capBps: number;
  /** Consecutive periods at or above `promotionBandKey` to be promotion-ready. */
  promotionPeriods: number;
  promotionBandKey: string;
}

/**
 * A DEFAULT SCHEME — replace it with IntelMotion's own.
 *
 * Four bands rather than a continuous curve, because people plan against a band
 * and argue about a curve. The gap between "meets" and "exceeds" is deliberately
 * wide: a scheme that pays a little more for a little more teaches people to
 * optimise the measurement.
 */
export const DEFAULT_BANDS: readonly IncentiveBand[] = [
  { key: 'below', label: 'Below standard', fromBps: 0, payoutBps: 0, meaning: 'No incentive. The conversation is about support, not pay.' },
  { key: 'meets', label: 'Meets standard', fromBps: 7000, payoutBps: 500, meaning: 'Doing the job as agreed.' },
  { key: 'exceeds', label: 'Exceeds standard', fromBps: 8500, payoutBps: 1200, meaning: 'Consistently better than the target across most of the scorecard.' },
  { key: 'outstanding', label: 'Outstanding', fromBps: 9500, payoutBps: 2000, meaning: 'The standard others are measured against.' },
];

export const DEFAULT_GATES: readonly IncentiveGate[] = [
  {
    key: 'coverage',
    label: 'Enough evidence to judge',
    rationale: 'A score built from a handful of jobs is not a measurement. Paying on it makes the scheme look arbitrary, and an arbitrary scheme changes nobody’s behaviour.',
    enabled: true,
  },
  {
    key: 'open_safety_finding',
    label: 'No open safety finding',
    rationale: 'A scheme where safety is 15% of a score is a scheme that pays for unsafe work at a discount.',
    enabled: true,
  },
  {
    key: 'expired_certification',
    label: 'Certifications current',
    rationale: 'Working on a lift with a lapsed certification is a regulatory exposure for the company, not a personal oversight.',
    enabled: true,
  },
  {
    key: 'unresolved_entrapment',
    label: 'No unresolved entrapment',
    rationale: 'A person still trapped outranks every other number on the page.',
    enabled: true,
  },
  {
    key: 'record_integrity',
    label: 'Records not falsified',
    rationale: 'A scheme that pays on self-reported figures must void on a falsified one, or it is paying for the falsification.',
    enabled: true,
  },
  {
    key: 'minimum_service',
    label: 'Served the whole period',
    rationale: 'A part-period is judged on its own terms rather than annualised from a small sample.',
    enabled: false,
  },
];

/** The starting scheme. Change the numbers; keep the shape. */
export function defaultScheme(weights: Record<string, number>): IncentiveScheme {
  return {
    key: 'default',
    name: 'Standard quarterly incentive',
    description:
      'A placeholder scheme. Every weight, band and gate is editable in Settings — these are not IntelMotion’s numbers until someone sets them.',
    weights,
    bands: DEFAULT_BANDS,
    gates: DEFAULT_GATES,
    minCoverageBps: 6000,
    capBps: 2500,
    promotionPeriods: 3,
    promotionBandKey: 'exceeds',
  };
}

export function assertSchemeValid(scheme: IncentiveScheme): void {
  assertWeightsValid(scheme.weights);

  if (scheme.bands.length === 0) {
    throw new RangeError('An incentive scheme needs at least one band.');
  }
  const sorted = [...scheme.bands].sort((a, b) => a.fromBps - b.fromBps);
  if ((sorted[0] as IncentiveBand).fromBps !== 0) {
    throw new RangeError('The lowest band must start at 0, or a score below every band has no answer.');
  }
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1] as IncentiveBand;
    const current = sorted[i] as IncentiveBand;
    if (current.fromBps === previous.fromBps) {
      throw new RangeError(`Two bands both start at ${current.fromBps} bps; a score there would be ambiguous.`);
    }
    // A higher band paying less turns the scheme upside down at one threshold,
    // which nobody notices until somebody's bonus falls for doing better.
    if (current.payoutBps < previous.payoutBps) {
      throw new RangeError(
        `Band '${current.label}' pays less than '${previous.label}' despite requiring a higher score.`,
      );
    }
  }
  if (scheme.capBps < 0) throw new RangeError('The cap cannot be negative.');
  if (scheme.minCoverageBps < 0 || scheme.minCoverageBps > 10_000) {
    throw new RangeError('The coverage floor must be between 0 and 10000 bps.');
  }
  if (!scheme.bands.some((b) => b.key === scheme.promotionBandKey)) {
    throw new RangeError(`Promotion band '${scheme.promotionBandKey}' is not one of the scheme's bands.`);
  }
  if (!Number.isInteger(scheme.promotionPeriods) || scheme.promotionPeriods < 1) {
    throw new RangeError('Promotion requires at least one period.');
  }
}

export function bandFor(scheme: IncentiveScheme, scoreBps: number): IncentiveBand {
  const sorted = [...scheme.bands].sort((a, b) => b.fromBps - a.fromBps);
  return (sorted.find((b) => scoreBps >= b.fromBps) ?? sorted[sorted.length - 1]) as IncentiveBand;
}

// ---------------------------------------------------------------------------
// Computing a payout
// ---------------------------------------------------------------------------

export interface GateFacts {
  openSafetyFindings: number;
  expiredCertifications: number;
  unresolvedEntrapments: number;
  recordIntegrityConcern: boolean;
  /** Share of the period the person was actually in post, in bps. */
  servedBps: number;
}

export const CLEAN_GATE_FACTS: GateFacts = {
  openSafetyFindings: 0,
  expiredCertifications: 0,
  unresolvedEntrapments: 0,
  recordIntegrityConcern: false,
  servedBps: 10_000,
};

export interface Contribution {
  key: string;
  label: string;
  weightBps: number;
  achievementBps: number | null;
  /** This component's share of the payout, in santim. Sums to the payout exactly. */
  santim: number;
  /** Null when the component had no data and its weight was redistributed. */
  measured: boolean;
}

export interface IncentiveResult {
  eligible: boolean;
  /** Gates that failed, each with the reason. Empty when eligible. */
  blockedBy: { key: GateKey; label: string; detail: string }[];
  scoreBps: number | null;
  coverageBps: number;
  band: IncentiveBand | null;
  /** Payout share of base, after the cap. */
  payoutBps: number;
  payoutSantim: number;
  /** Set when the cap bit, so it can be shown rather than silently applied. */
  cappedFromBps: number | null;
  contributions: Contribution[];
  /** One paragraph a manager can read out in a review. */
  explanation: string;
}

/**
 * Work out what someone has earned, and say why.
 *
 * The payout is split across components by the SAME largest-remainder method the
 * contract milestones use, so the parts sum to the payout exactly. A breakdown
 * that does not add up to the figure at the top is worse than no breakdown.
 */
export function computeIncentive(
  scorecard: Scorecard,
  scheme: IncentiveScheme,
  input: { baseSantim: number; facts?: GateFacts },
): IncentiveResult {
  const facts = input.facts ?? CLEAN_GATE_FACTS;
  const enabled = (key: GateKey) => scheme.gates.some((g) => g.key === key && g.enabled);
  const blockedBy: IncentiveResult['blockedBy'] = [];

  const gate = (key: GateKey, failed: boolean, detail: string) => {
    if (!enabled(key) || !failed) return;
    const definition = scheme.gates.find((g) => g.key === key);
    blockedBy.push({ key, label: definition?.label ?? key, detail });
  };

  gate(
    'coverage',
    scorecard.scoreBps === null || scorecard.coverageBps < scheme.minCoverageBps,
    scorecard.scoreBps === null
      ? 'Nothing in the scorecard could be measured at all this period.'
      : `Only ${(scorecard.coverageBps / 100).toFixed(0)}% of the scorecard had data behind it; the scheme requires ${(scheme.minCoverageBps / 100).toFixed(0)}%.`,
  );
  gate('open_safety_finding', facts.openSafetyFindings > 0, `${facts.openSafetyFindings} safety finding${facts.openSafetyFindings === 1 ? '' : 's'} still open.`);
  gate('expired_certification', facts.expiredCertifications > 0, `${facts.expiredCertifications} certification${facts.expiredCertifications === 1 ? '' : 's'} lapsed.`);
  gate('unresolved_entrapment', facts.unresolvedEntrapments > 0, `${facts.unresolvedEntrapments} entrapment${facts.unresolvedEntrapments === 1 ? '' : 's'} unresolved.`);
  gate('record_integrity', facts.recordIntegrityConcern, 'A record-integrity concern is open against this period.');
  gate('minimum_service', facts.servedBps < 10_000, `In post for ${(facts.servedBps / 100).toFixed(0)}% of the period.`);

  const scoreBps = scorecard.scoreBps;
  const band = scoreBps === null ? null : bandFor(scheme, scoreBps);
  const eligible = blockedBy.length === 0 && band !== null;

  const rawPayoutBps = eligible && band !== null ? band.payoutBps : 0;
  const payoutBps = Math.min(rawPayoutBps, scheme.capBps);
  const cappedFromBps = rawPayoutBps > scheme.capBps ? rawPayoutBps : null;
  const payoutSantim = Math.round((input.baseSantim * payoutBps) / 10_000);

  const contributions = splitContributions(scorecard.components, payoutSantim);

  return {
    eligible,
    blockedBy,
    scoreBps,
    coverageBps: scorecard.coverageBps,
    band,
    payoutBps,
    payoutSantim,
    cappedFromBps,
    contributions,
    explanation: explain(scorecard, scheme, {
      eligible, blockedBy, band, payoutBps, payoutSantim, cappedFromBps,
    }),
  };
}

/**
 * Split the payout across the components that actually earned it.
 *
 * Weighted by weight × achievement, not by weight alone: a component someone
 * scored nothing on did not contribute to the payout, and showing it as though
 * it did makes the breakdown a decoration.
 */
function splitContributions(
  components: readonly ScoreComponent[],
  payoutSantim: number,
): Contribution[] {
  const shares = components.map((c) =>
    c.achievementBps === null ? 0 : Math.max(0, Math.round((c.weightBps * c.achievementBps) / 10_000)),
  );
  const amounts = allocateByShares(payoutSantim, shares);

  return components.map((component, index) => ({
    key: component.key,
    label: component.label,
    weightBps: component.weightBps,
    achievementBps: component.achievementBps,
    santim: amounts[index] as number,
    measured: component.achievementBps !== null,
  }));
}

function explain(
  scorecard: Scorecard,
  scheme: IncentiveScheme,
  result: Pick<IncentiveResult, 'eligible' | 'blockedBy' | 'band' | 'payoutBps' | 'payoutSantim' | 'cappedFromBps'>,
): string {
  if (!result.eligible) {
    if (result.blockedBy.length === 0) {
      return 'No score could be computed for this period, so no incentive is payable.';
    }
    // The gate LABEL says what the rule is ("No open safety finding"), so
    // dropping it into a sentence unchanged reads as the opposite of what
    // happened. The detail is the fact; the label is only the rule's name.
    const reasons = result.blockedBy.map((b) => b.detail).join(' ');
    const names = result.blockedBy.map((b) => `"${b.label}"`).join(', ');
    return (
      `No incentive is payable this period. ${reasons} ` +
      `That fails the ${result.blockedBy.length === 1 ? 'gate' : 'gates'} ${names}. ` +
      `A gate is a condition, not a weighted component: it voids the payout however good the rest of the scorecard looks.`
    );
  }

  const score = ((scorecard.scoreBps ?? 0) / 100).toFixed(0);
  const capNote =
    result.cappedFromBps === null
      ? ''
      : ` The band pays ${(result.cappedFromBps / 100).toFixed(1)}% but the scheme caps a single period at ${(scheme.capBps / 100).toFixed(1)}%, so that is what applies.`;

  const unmeasured = scorecard.components.filter((c) => c.achievementBps === null);
  const coverageNote =
    unmeasured.length === 0
      ? ''
      : ` ${unmeasured.length} component${unmeasured.length === 1 ? '' : 's'} had no data this period (${unmeasured.map((c) => c.label.toLowerCase()).join(', ')}), so their weight was shared across the rest rather than counted as zero.`;

  return (
    `Scored ${score}% against the scorecard — ${(result.band as IncentiveBand).label.toLowerCase()}. ` +
    `${(result.band as IncentiveBand).meaning} That pays ${(result.payoutBps / 100).toFixed(1)}% of base — ${formatETB(result.payoutSantim)}.${capNote}${coverageNote}`
  );
}

// ---------------------------------------------------------------------------
// Promotion
// ---------------------------------------------------------------------------

export interface PeriodResult {
  periodLabel: string;
  scoreBps: number | null;
  coverageBps: number;
  bandKey: string | null;
  gatesPassed: boolean;
}

export interface PromotionReadiness {
  ready: boolean;
  /** Consecutive qualifying periods, counting back from the most recent. */
  streak: number;
  required: number;
  /** The band a period must reach to count towards the streak. */
  requiredBand: IncentiveBand | null;
  /** Why it is not ready yet, or what makes it ready. */
  reason: string;
  /** Periods examined, newest first, with whether each counted. */
  history: { periodLabel: string; counted: boolean; why: string }[];
}

/**
 * Sustained performance, not a good quarter.
 *
 * The streak counts BACK FROM THE MOST RECENT period and stops at the first
 * period that does not qualify. Counting qualifying periods anywhere in the
 * history would promote someone on the strength of a good year two years ago,
 * which is what "consistently" is supposed to exclude.
 *
 * A period where the gates failed breaks the streak outright. A period with too
 * little data does NOT count towards promotion, but it also does not break the
 * streak — quiet quarters happen, and holding them against someone punishes them
 * for the work not arriving.
 */
export function promotionReadiness(
  history: readonly PeriodResult[],
  scheme: IncentiveScheme,
): PromotionReadiness {
  const requiredBand = scheme.bands.find((b) => b.key === scheme.promotionBandKey) ?? null;
  if (requiredBand === null) {
    return {
      ready: false, streak: 0, required: scheme.promotionPeriods, requiredBand: null,
      reason: `The scheme names a promotion band ('${scheme.promotionBandKey}') that does not exist.`,
      history: [],
    };
  }

  const newestFirst = [...history].reverse();
  const examined: PromotionReadiness['history'] = [];
  let streak = 0;
  let broken = false;

  for (const period of newestFirst) {
    if (broken) {
      examined.push({ periodLabel: period.periodLabel, counted: false, why: 'After the streak was broken.' });
      continue;
    }

    if (!period.gatesPassed) {
      broken = true;
      examined.push({ periodLabel: period.periodLabel, counted: false, why: 'A gate failed, which breaks the run.' });
      continue;
    }

    if (period.scoreBps === null || period.coverageBps < scheme.minCoverageBps) {
      examined.push({
        periodLabel: period.periodLabel,
        counted: false,
        why: 'Too little data to judge. Neither counted nor held against.',
      });
      continue;
    }

    const band = bandFor(scheme, period.scoreBps);
    if (band.fromBps >= requiredBand.fromBps) {
      streak += 1;
      examined.push({ periodLabel: period.periodLabel, counted: true, why: `${band.label}.` });
    } else {
      broken = true;
      examined.push({ periodLabel: period.periodLabel, counted: false, why: `${band.label} — below ${requiredBand.label}.` });
    }
  }

  const ready = streak >= scheme.promotionPeriods;

  return {
    ready,
    streak,
    required: scheme.promotionPeriods,
    requiredBand,
    reason: ready
      ? `${streak} consecutive periods at ${requiredBand.label} or better. The scheme's bar for promotion is ${scheme.promotionPeriods}.`
      : streak === 0
        ? `The most recent period did not reach ${requiredBand.label}, so the run starts again from the next one.`
        : `${streak} of ${scheme.promotionPeriods} consecutive periods at ${requiredBand.label} or better.`,
    history: examined,
  };
}

// ---------------------------------------------------------------------------
// The payroll view
// ---------------------------------------------------------------------------

export interface IncentiveRun {
  totalSantim: number;
  eligible: number;
  blocked: number;
  /** Why payouts were blocked, so a pattern is visible rather than case by case. */
  blockedBy: { label: string; count: number }[];
  rows: { name: string; result: IncentiveResult }[];
}

export function summariseRun(rows: readonly { name: string; result: IncentiveResult }[]): IncentiveRun {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const block of row.result.blockedBy) {
      counts.set(block.label, (counts.get(block.label) ?? 0) + 1);
    }
  }

  return {
    totalSantim: rows.reduce((a, r) => a + r.result.payoutSantim, 0),
    eligible: rows.filter((r) => r.result.eligible).length,
    blocked: rows.filter((r) => !r.result.eligible).length,
    blockedBy: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count),
    rows: [...rows].sort((a, b) => b.result.payoutSantim - a.result.payoutSantim),
  };
}
