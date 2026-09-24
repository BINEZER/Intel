/**
 * Dating the payments the tracker records.
 *
 * The cash-walk decides WHICH terms are settled; these tests pin how the dates
 * are attached to them, and what happens when the two do not line up.
 */

import { describe, expect, it } from 'vitest';
import { applyCollectedToMilestones } from '../import-master.js';
import type { MilestoneShare } from '../milestones.js';

const SHARES: MilestoneShare[] = [
  { name: 'Advance', shareBps: 5000 },
  { name: 'On delivery', shareBps: 3000 },
  { name: 'On handover', shareBps: 2000 },
];
const VALUE = 1_000_000_00; // ETB 1,000,000 in santim
const day = (d: number) => new Date(Date.UTC(2024, 5, d));

describe('attaching payment dates', () => {
  it('dates the settled terms in order, earliest first', () => {
    const terms = applyCollectedToMilestones(SHARES, VALUE, 800_000_00, [day(1), day(20)]);
    expect(terms.map((t) => [t.name, t.paid, t.paidOn?.toISOString() ?? null])).toEqual([
      ['Advance', true, '2024-06-01T00:00:00.000Z'],
      ['On delivery', true, '2024-06-20T00:00:00.000Z'],
      ['On handover', false, null],
    ]);
  });

  it('leaves an unsettled term undated even when spare dates exist', () => {
    const terms = applyCollectedToMilestones(SHARES, VALUE, 500_000_00, [day(1), day(20), day(28)]);
    expect(terms[0]?.paidOn?.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    expect(terms[1]?.paid).toBe(false);
    expect(terms[1]?.paidOn).toBeNull();
    expect(terms[2]?.paidOn).toBeNull();
  });

  it('settles without a date when the tracker recorded none', () => {
    // An undated receipt is a gap in the record, not a payment that never
    // happened: the term is still settled, and simply has no date.
    const terms = applyCollectedToMilestones(SHARES, VALUE, 500_000_00, []);
    expect(terms[0]?.paid).toBe(true);
    expect(terms[0]?.paidOn).toBeNull();
  });

  it('keeps an undated receipt in its place rather than dropping it', () => {
    // Dropping it would shift the second date onto the first term, dating a
    // payment to a day it did not arrive on.
    const terms = applyCollectedToMilestones(SHARES, VALUE, 800_000_00, [null, day(20)]);
    expect(terms[0]?.paid).toBe(true);
    expect(terms[0]?.paidOn).toBeNull();
    expect(terms[1]?.paidOn?.toISOString()).toBe('2024-06-20T00:00:00.000Z');
  });

  it('runs out of dates without failing', () => {
    const terms = applyCollectedToMilestones(SHARES, VALUE, 1_000_000_00, [day(1)]);
    expect(terms.map((t) => t.paid)).toEqual([true, true, true]);
    expect(terms.map((t) => t.paidOn === null)).toEqual([false, true, true]);
  });

  it('is unchanged when no dates are passed at all', () => {
    // The elevator register has no dates; it must still produce valid terms.
    const terms = applyCollectedToMilestones(SHARES, VALUE, 500_000_00);
    expect(terms).toHaveLength(3);
    expect(terms.every((t) => t.paidOn === null)).toBe(true);
  });
});
