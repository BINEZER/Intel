import { describe, expect, it } from 'vitest';
import { describeMix, workMix, type MixProject } from '../work-mix.js';

const job = (over: Partial<MixProject> = {}): MixProject => ({
  status: 'in_progress',
  type: 'elevator',
  contractNetSantim: 1_000_000_00,
  progressBps: 5000,
  ...over,
});

describe('splitting the portfolio', () => {
  it('separates lift work from everything else', () => {
    const mix = workMix([
      job({ type: 'elevator' }),
      job({ type: 'modernisation' }),
      job({ type: 'service' }),
      job({ type: 'renovation' }),
      job({ type: 'fit_out' }),
    ]);
    expect(mix.elevator.projects).toBe(3);
    expect(mix.other.projects).toBe(2);
    expect(mix.hasOtherWork).toBe(true);
  });

  it('says there is no other work when there is none', () => {
    // The line is then left out of the report entirely: a company that only
    // installs lifts should not read "0 jobs are not lift work" every month.
    const mix = workMix([job(), job({ type: 'service' })]);
    expect(mix.hasOtherWork).toBe(false);
    expect(describeMix(mix)).toBeNull();
  });

  it('files the legacy and unknown types under other work', () => {
    const mix = workMix([job({ type: 'non_elevator' }), job({ type: 'zipana' }), job({ type: undefined })]);
    expect(mix.other.projects).toBe(3);
    expect(mix.rows).toHaveLength(1);
    expect(mix.rows[0]?.type).toBe('other');
  });
});

describe('what gets counted', () => {
  it('leaves out cancelled and terminated jobs', () => {
    // They are not work in hand. Counting them reports a business bigger than
    // the one that exists.
    const mix = workMix([
      job(),
      job({ status: 'cancelled' }),
      job({ status: 'terminated' }),
    ]);
    expect(mix.projects).toBe(1);
    expect(mix.valueNetSantim).toBe(1_000_000_00);
  });

  it('counts jobs on hold — they still carry contract value', () => {
    const mix = workMix([job({ status: 'on_hold' })]);
    expect(mix.projects).toBe(1);
  });
});

describe('the per-kind breakdown', () => {
  it('orders the kinds by value, largest first', () => {
    const mix = workMix([
      job({ type: 'renovation', contractNetSantim: 5_000_000_00 }),
      job({ type: 'elevator', contractNetSantim: 9_000_000_00 }),
      job({ type: 'fit_out', contractNetSantim: 1_000_000_00 }),
    ]);
    expect(mix.rows.map((r) => r.type)).toEqual(['elevator', 'renovation', 'fit_out']);
  });

  it('states each kind as a share of the portfolio', () => {
    const mix = workMix([
      job({ type: 'elevator', contractNetSantim: 7_500_000_00 }),
      job({ type: 'renovation', contractNetSantim: 2_500_000_00 }),
    ]);
    expect(mix.rows[0]?.shareBps).toBe(7500);
    expect(mix.rows[1]?.shareBps).toBe(2500);
  });

  it('names each kind in words rather than in field values', () => {
    const mix = workMix([job({ type: 'fit_out' })]);
    expect(mix.rows[0]?.label).toBe('Fit-out');
  });

  it('reports no share at all when nothing carries a value', () => {
    // 0/0 is not 0%, and printing 0% reads as "this work is worth nothing".
    const mix = workMix([job({ contractNetSantim: 0 }), job({ type: 'renovation', contractNetSantim: 0 })]);
    expect(mix.rows.every((r) => r.shareBps === null)).toBe(true);
    expect(mix.valueNetSantim).toBe(0);
  });
});

describe('progress across a kind', () => {
  it('weights by value rather than averaging the jobs', () => {
    // A 10-million tower at 10% and a 200-thousand callout at 100% do not
    // average to anything a person would recognise as progress.
    const mix = workMix([
      job({ type: 'renovation', contractNetSantim: 9_000_000_00, progressBps: 10_000 }),
      job({ type: 'renovation', contractNetSantim: 1_000_000_00, progressBps: 0 }),
    ]);
    expect(mix.rows[0]?.progressBps).toBe(9000);
  });

  it('reports no figure rather than zero when nothing is valued', () => {
    const mix = workMix([job({ contractNetSantim: 0, progressBps: 4000 })]);
    expect(mix.rows[0]?.progressBps).toBeNull();
  });
});

describe('saying it in one sentence', () => {
  it('names the count and the share by value', () => {
    const mix = workMix([
      job({ type: 'elevator', contractNetSantim: 8_000_000_00 }),
      job({ type: 'renovation', contractNetSantim: 2_000_000_00 }),
    ]);
    expect(describeMix(mix)).toBe(
      '1 of 2 live jobs are not lift work, carrying 20% of the portfolio by value.',
    );
  });

  it('keeps one decimal only where it earns it', () => {
    const mix = workMix([
      job({ type: 'elevator', contractNetSantim: 8_500_000_00 }),
      job({ type: 'renovation', contractNetSantim: 1_500_000_00 }),
    ]);
    expect(describeMix(mix)).toContain('15% of the portfolio');
  });

  it('says plainly when the share cannot be worked out', () => {
    const mix = workMix([
      job({ type: 'elevator', contractNetSantim: 0 }),
      job({ type: 'renovation', contractNetSantim: 0 }),
    ]);
    expect(describeMix(mix)).toContain('cannot be stated');
  });

  it('says nothing at all when there are no jobs', () => {
    expect(describeMix(workMix([]))).toBeNull();
  });
});
