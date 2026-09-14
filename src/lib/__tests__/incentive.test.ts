/**
 * Incentives and promotion.
 *
 * What is guarded here is not the arithmetic but the discipline: no payout on a
 * score nobody could measure, gates that void rather than discount, a breakdown
 * that adds up to the figure at the top, and a streak that means "consistently"
 * rather than "at some point".
 */

import { describe, expect, it } from 'vitest';
import {
  assertSchemeValid,
  bandFor,
  CLEAN_GATE_FACTS,
  computeIncentive,
  defaultScheme,
  DEFAULT_BANDS,
  promotionReadiness,
  summariseRun,
  type IncentiveScheme,
  type PeriodResult,
} from '../incentive.js';
import { composeScore, type ScoreComponent } from '../scorecard.js';

const WEIGHTS = { firstTimeFix: 4000, sla: 3000, pm: 2000, safety: 1000 };
const SCHEME = defaultScheme(WEIGHTS);
const BASE = 12_000_00; // ETB 12,000 a month

function component(over: Partial<ScoreComponent> & { key: string }): ScoreComponent {
  return {
    label: over.key,
    achievementBps: 9000,
    weightBps: 2500,
    rawValue: 1,
    target: 1,
    direction: 'higher',
    ...over,
  };
}

/** A scorecard scoring `achievement` everywhere, fully covered. */
function scoredAt(achievementBps: number | null) {
  return composeScore(
    Object.entries(WEIGHTS).map(([key, weightBps]) =>
      component({ key, weightBps, achievementBps }),
    ),
  );
}

describe('assertSchemeValid', () => {
  it('accepts the default scheme', () => {
    expect(() => assertSchemeValid(SCHEME)).not.toThrow();
  });

  it('refuses weights that do not sum to 100%', () => {
    expect(() => assertSchemeValid({ ...SCHEME, weights: { a: 5000 } })).toThrow(RangeError);
  });

  it('refuses a scheme with no band starting at zero', () => {
    const bands = DEFAULT_BANDS.filter((b) => b.key !== 'below');
    expect(() => assertSchemeValid({ ...SCHEME, bands })).toThrow(/must start at 0/);
  });

  it('refuses a higher band that pays less than a lower one', () => {
    // Otherwise somebody's bonus falls for doing better, and nobody notices
    // until it happens to a person.
    const bands = [
      { key: 'a', label: 'A', fromBps: 0, payoutBps: 1000, meaning: '' },
      { key: 'b', label: 'B', fromBps: 8000, payoutBps: 500, meaning: '' },
    ];
    expect(() => assertSchemeValid({ ...SCHEME, bands, promotionBandKey: 'b' })).toThrow(/pays less than/);
  });

  it('refuses two bands starting at the same score', () => {
    const bands = [
      { key: 'a', label: 'A', fromBps: 0, payoutBps: 0, meaning: '' },
      { key: 'b', label: 'B', fromBps: 0, payoutBps: 500, meaning: '' },
    ];
    expect(() => assertSchemeValid({ ...SCHEME, bands, promotionBandKey: 'b' })).toThrow(/ambiguous/);
  });

  it('refuses a promotion band that is not in the scheme', () => {
    expect(() => assertSchemeValid({ ...SCHEME, promotionBandKey: 'legendary' })).toThrow(/not one of/);
  });
});

describe('bandFor', () => {
  it('picks the highest band the score reaches', () => {
    expect(bandFor(SCHEME, 9900).key).toBe('outstanding');
    expect(bandFor(SCHEME, 9500).key).toBe('outstanding');
    expect(bandFor(SCHEME, 9499).key).toBe('exceeds');
    expect(bandFor(SCHEME, 6999).key).toBe('below');
    expect(bandFor(SCHEME, 0).key).toBe('below');
  });
});

describe('computeIncentive', () => {
  it('pays the band the score reached, and shows the arithmetic', () => {
    const result = computeIncentive(scoredAt(9000), SCHEME, { baseSantim: BASE });

    expect(result.eligible).toBe(true);
    expect(result.band?.key).toBe('exceeds');
    expect(result.payoutBps).toBe(1200);
    expect(result.payoutSantim).toBe(Math.round((BASE * 1200) / 10_000));
    expect(result.explanation).toContain('exceeds standard');
  });

  it('breaks the payout down so the parts sum to the whole exactly', () => {
    const result = computeIncentive(scoredAt(9000), SCHEME, { baseSantim: BASE });
    const parts = result.contributions.reduce((a, c) => a + c.santim, 0);

    expect(parts).toBe(result.payoutSantim);
  });

  it('gives no share to a component that was not measured', () => {
    const scorecard = composeScore([
      component({ key: 'firstTimeFix', weightBps: 4000, achievementBps: 9500 }),
      component({ key: 'sla', weightBps: 3000, achievementBps: 9500 }),
      component({ key: 'pm', weightBps: 2000, achievementBps: 9500 }),
      component({ key: 'safety', weightBps: 1000, achievementBps: null }),
    ]);
    const result = computeIncentive(scorecard, SCHEME, { baseSantim: BASE });

    expect(result.contributions.find((c) => c.key === 'safety')?.santim).toBe(0);
    expect(result.contributions.find((c) => c.key === 'safety')?.measured).toBe(false);
    // And the redistribution is named, not silently applied.
    expect(result.explanation).toContain('shared across the rest rather than counted as zero');
  });

  it('pays nothing below the lowest paying band', () => {
    const result = computeIncentive(scoredAt(5000), SCHEME, { baseSantim: BASE });
    expect(result.eligible).toBe(true);
    expect(result.payoutSantim).toBe(0);
    expect(result.band?.key).toBe('below');
  });
});

describe('gates void the payout; they do not discount it', () => {
  it('pays nothing when a safety finding is open, however good the score', () => {
    const result = computeIncentive(scoredAt(10_000), SCHEME, {
      baseSantim: BASE,
      facts: { ...CLEAN_GATE_FACTS, openSafetyFindings: 1 },
    });

    expect(result.eligible).toBe(false);
    expect(result.payoutSantim).toBe(0);
    expect(result.blockedBy.map((b) => b.key)).toContain('open_safety_finding');
    expect(result.explanation).toContain('however good the rest of the scorecard looks');
  });

  it('pays nothing on a score built from too little evidence', () => {
    const thin = composeScore([
      component({ key: 'firstTimeFix', weightBps: 4000, achievementBps: 10_000 }),
      component({ key: 'sla', weightBps: 3000, achievementBps: null }),
      component({ key: 'pm', weightBps: 2000, achievementBps: null }),
      component({ key: 'safety', weightBps: 1000, achievementBps: null }),
    ]);
    const result = computeIncentive(thin, SCHEME, { baseSantim: BASE });

    // 40% coverage against a 60% floor.
    expect(result.eligible).toBe(false);
    expect(result.blockedBy.map((b) => b.key)).toContain('coverage');
    expect(result.blockedBy[0]?.detail).toContain('40%');
  });

  it('pays nothing when nothing at all could be measured', () => {
    const result = computeIncentive(scoredAt(null), SCHEME, { baseSantim: BASE });
    expect(result.eligible).toBe(false);
    expect(result.scoreBps).toBeNull();
  });

  it('reports every failed gate, not just the first', () => {
    const result = computeIncentive(scoredAt(10_000), SCHEME, {
      baseSantim: BASE,
      facts: { ...CLEAN_GATE_FACTS, openSafetyFindings: 1, expiredCertifications: 2, unresolvedEntrapments: 1 },
    });
    expect(result.blockedBy).toHaveLength(3);
  });

  it('ignores a gate that has been switched off', () => {
    const noSafetyGate: IncentiveScheme = {
      ...SCHEME,
      gates: SCHEME.gates.map((g) => (g.key === 'open_safety_finding' ? { ...g, enabled: false } : g)),
    };
    const result = computeIncentive(scoredAt(9000), noSafetyGate, {
      baseSantim: BASE,
      facts: { ...CLEAN_GATE_FACTS, openSafetyFindings: 1 },
    });
    expect(result.eligible).toBe(true);
  });

  it('leaves the part-period gate off by default', () => {
    const result = computeIncentive(scoredAt(9000), SCHEME, {
      baseSantim: BASE,
      facts: { ...CLEAN_GATE_FACTS, servedBps: 5000 },
    });
    expect(result.eligible).toBe(true);
  });
});

describe('the cap', () => {
  it('applies and says so, rather than silently trimming', () => {
    const generous: IncentiveScheme = { ...SCHEME, capBps: 800 };
    const result = computeIncentive(scoredAt(9800), generous, { baseSantim: BASE });

    expect(result.payoutBps).toBe(800);
    expect(result.cappedFromBps).toBe(2000);
    expect(result.explanation).toContain('caps a single period');
  });

  it('is silent when it does not bite', () => {
    expect(computeIncentive(scoredAt(9000), SCHEME, { baseSantim: BASE }).cappedFromBps).toBeNull();
  });
});

describe('promotionReadiness', () => {
  const period = (label: string, scoreBps: number | null, over: Partial<PeriodResult> = {}): PeriodResult => ({
    periodLabel: label,
    scoreBps,
    coverageBps: 10_000,
    bandKey: null,
    gatesPassed: true,
    ...over,
  });

  it('is ready after the required run of qualifying periods', () => {
    const readiness = promotionReadiness(
      [period('Q1', 8800), period('Q2', 9000), period('Q3', 9600)],
      SCHEME,
    );

    expect(readiness.ready).toBe(true);
    expect(readiness.streak).toBe(3);
    expect(readiness.reason).toContain('3 consecutive periods');
  });

  it('counts back from the most recent and stops at the first miss', () => {
    // Three great years followed by a bad quarter is not "consistently".
    const readiness = promotionReadiness(
      [period('Q1', 9600), period('Q2', 9600), period('Q3', 9600), period('Q4', 6000)],
      SCHEME,
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.streak).toBe(0);
    expect(readiness.reason).toContain('starts again');
  });

  it('breaks the run outright on a failed gate', () => {
    const readiness = promotionReadiness(
      [period('Q1', 9600), period('Q2', 9600), period('Q3', 9600, { gatesPassed: false })],
      SCHEME,
    );

    expect(readiness.streak).toBe(0);
    expect(readiness.history[0]?.why).toContain('breaks the run');
  });

  it('neither counts nor punishes a quiet period with too little data', () => {
    const readiness = promotionReadiness(
      [period('Q1', 9600), period('Q2', 9600), period('Q3', 9600, { coverageBps: 2000 })],
      SCHEME,
    );

    // The quiet quarter is skipped; the two good ones before it still count.
    expect(readiness.streak).toBe(2);
    expect(readiness.ready).toBe(false);
    expect(readiness.history[0]?.why).toContain('Neither counted nor held against');
  });

  it('reports progress towards the bar rather than a bare no', () => {
    const readiness = promotionReadiness([period('Q1', 9600), period('Q2', 9600)], SCHEME);
    expect(readiness.reason).toBe('2 of 3 consecutive periods at Exceeds standard or better.');
  });

  it('handles an empty history', () => {
    const readiness = promotionReadiness([], SCHEME);
    expect(readiness.ready).toBe(false);
    expect(readiness.streak).toBe(0);
  });
});

describe('summariseRun', () => {
  it('totals the payroll and shows why payouts were blocked', () => {
    const rows = [
      { name: 'Dawit', result: computeIncentive(scoredAt(9600), SCHEME, { baseSantim: BASE }) },
      { name: 'Meron', result: computeIncentive(scoredAt(9000), SCHEME, { baseSantim: BASE }) },
      {
        name: 'Abebe',
        result: computeIncentive(scoredAt(9800), SCHEME, {
          baseSantim: BASE,
          facts: { ...CLEAN_GATE_FACTS, openSafetyFindings: 1 },
        }),
      },
    ];
    const run = summariseRun(rows);

    expect(run.eligible).toBe(2);
    expect(run.blocked).toBe(1);
    expect(run.totalSantim).toBe(rows[0]!.result.payoutSantim + rows[1]!.result.payoutSantim);
    expect(run.blockedBy[0]).toEqual({ label: 'No open safety finding', count: 1 });
    // Biggest payout first — the review conversation starts at the top.
    expect(run.rows[0]?.name).toBe('Dawit');
  });
});
