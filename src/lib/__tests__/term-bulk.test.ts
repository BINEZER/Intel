import { describe, expect, it } from 'vitest';
import { describePlan, flaggedByPastDate, planDates, type BulkTerm } from '../term-bulk.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const term = (over: Partial<BulkTerm> = {}): BulkTerm => ({
  contractId: 'k1', termId: 't1', seq: 1, name: 'Advance', status: 'pending', grossSantim: 1_000, dueDate: null, ...over,
});

describe('planDates — one date for all', () => {
  it('gives every selected term the same date', () => {
    const plan = planDates([term({ termId: 'a' }), term({ termId: 'b', seq: 2 }), term({ termId: 'c', contractId: 'k2' })], { kind: 'same', date: d('2026-11-01') });
    expect(plan.map((p) => iso(p.dueDate))).toEqual(['2026-11-01', '2026-11-01', '2026-11-01']);
    expect(plan).toHaveLength(3);
  });
});

describe('planDates — spread', () => {
  it('runs a contract’s terms in sequence order, a month apart', () => {
    const plan = planDates(
      [term({ termId: 'c', seq: 3 }), term({ termId: 'a', seq: 1 }), term({ termId: 'b', seq: 2 })],
      { kind: 'spread', first: d('2026-11-01'), gapMonths: 1 },
    );
    expect(plan.map((p) => [p.termId, iso(p.dueDate)])).toEqual([['a', '2026-11-01'], ['b', '2026-12-01'], ['c', '2027-01-01']]);
  });

  it('restarts for each contract, rather than running on across them', () => {
    const plan = planDates(
      [term({ termId: 'a', contractId: 'k1', seq: 1 }), term({ termId: 'b', contractId: 'k1', seq: 2 }), term({ termId: 'x', contractId: 'k2', seq: 1 })],
      { kind: 'spread', first: d('2026-11-01'), gapMonths: 2 },
    );
    expect(plan.find((p) => p.termId === 'a')?.dueDate).toEqual(d('2026-11-01'));
    expect(plan.find((p) => p.termId === 'b')?.dueDate).toEqual(d('2027-01-01'));
    expect(plan.find((p) => p.termId === 'x')?.dueDate).toEqual(d('2026-11-01'));
  });

  it('spreads only the terms that were selected', () => {
    const plan = planDates([term({ termId: 'b', seq: 2 }), term({ termId: 'd', seq: 4 })], { kind: 'spread', first: d('2026-11-01'), gapMonths: 3 });
    expect(plan.map((p) => iso(p.dueDate))).toEqual(['2026-11-01', '2027-02-01']);
  });

  it('clamps the end of a month rather than spilling into the next', () => {
    const plan = planDates([term({ termId: 'a', seq: 1 }), term({ termId: 'b', seq: 2 })], { kind: 'spread', first: d('2026-01-31'), gapMonths: 1 });
    expect(iso(plan[1]!.dueDate)).toBe('2026-02-28');
  });

  it('treats a gap of zero as the same date, and a negative or fractional gap safely', () => {
    const same = planDates([term({ termId: 'a' }), term({ termId: 'b', seq: 2 })], { kind: 'spread', first: d('2026-11-01'), gapMonths: 0 });
    expect(same[0]?.dueDate).toEqual(same[1]?.dueDate);
    const odd = planDates([term({ termId: 'a' }), term({ termId: 'b', seq: 2 })], { kind: 'spread', first: d('2026-11-01'), gapMonths: -3 });
    expect(odd[0]?.dueDate).toEqual(odd[1]?.dueDate);
    const frac = planDates([term({ termId: 'a' }), term({ termId: 'b', seq: 2 })], { kind: 'spread', first: d('2026-11-01'), gapMonths: 1.9 });
    expect(iso(frac[1]!.dueDate)).toBe('2026-12-01');
  });
});

describe('planDates — what is left out', () => {
  it('skips paid and waived terms instead of failing the whole selection', () => {
    const plan = planDates(
      [term({ termId: 'a', status: 'paid' }), term({ termId: 'b', status: 'waived', seq: 2 }), term({ termId: 'c', seq: 3 })],
      { kind: 'same', date: d('2026-11-01') },
    );
    expect(plan.map((p) => p.termId)).toEqual(['c']);
  });

  it('lets a billed term be re-dated', () => {
    expect(planDates([term({ status: 'invoiced' }), term({ termId: 'b', status: 'part_paid', seq: 2 })], { kind: 'same', date: d('2026-11-01') })).toHaveLength(2);
  });

  it('is empty for an empty selection', () => {
    expect(planDates([], { kind: 'same', date: d('2026-11-01') })).toEqual([]);
  });
});

describe('flaggedByPastDate', () => {
  const asOf = d('2026-10-12');
  const terms = [term({ termId: 'a', grossSantim: 500 }), term({ termId: 'b', seq: 2, grossSantim: 700 }), term({ termId: 'c', seq: 3, status: 'invoiced', grossSantim: 900 })];

  it('counts the unbilled terms whose new date has already come, and what they are worth', () => {
    const plan = planDates(terms, { kind: 'spread', first: d('2026-10-01'), gapMonths: 1 });
    // a -> 1 Oct (past), b -> 1 Nov (future), c -> 1 Dec (and billed anyway)
    expect(flaggedByPastDate(plan, terms, asOf)).toEqual({ count: 1, santim: 500 });
  });

  it('counts today as having come', () => {
    expect(flaggedByPastDate(planDates([terms[0]!], { kind: 'same', date: asOf }), terms, asOf)).toEqual({ count: 1, santim: 500 });
  });

  it('does not count a billed term, which a past date does not make ready', () => {
    expect(flaggedByPastDate(planDates([terms[2]!], { kind: 'same', date: d('2026-01-01') }), terms, asOf)).toEqual({ count: 0, santim: 0 });
  });

  it('is zero when every new date is still ahead', () => {
    expect(flaggedByPastDate(planDates(terms, { kind: 'same', date: d('2027-01-01') }), terms, asOf).count).toBe(0);
  });
});

describe('describePlan', () => {
  it('reads as a sentence', () => {
    expect(describePlan([])).toBe('Nothing to date.');
    expect(describePlan([{ contractId: 'k1', termId: 'a', dueDate: d('2026-11-01') }])).toBe('1 term on 1 contract.');
    expect(describePlan([
      { contractId: 'k1', termId: 'a', dueDate: d('2026-11-01') }, { contractId: 'k1', termId: 'b', dueDate: d('2026-11-01') }, { contractId: 'k2', termId: 'c', dueDate: d('2026-11-01') },
    ])).toBe('3 terms on 2 contracts.');
  });
});
