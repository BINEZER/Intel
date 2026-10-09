import { describe, expect, it } from 'vitest';
import {
  describeFee,
  feePerLift,
  monthlyTerms,
  outstandingOn,
  serviceEnd,
  serviceFeeFigures,
  wholeMonthsBetween,
} from '../service-agreement.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('wholeMonthsBetween', () => {
  it('counts a year from the first to the first as twelve', () => {
    expect(wholeMonthsBetween(d('2026-01-01'), d('2027-01-01'))).toBe(12);
  });
  it('counts a year ending on the last day as twelve, not eleven', () => {
    expect(wholeMonthsBetween(d('2026-01-01'), d('2026-12-31'))).toBe(12);
  });
  it('never goes below one month', () => {
    expect(wholeMonthsBetween(d('2026-01-01'), d('2026-01-05'))).toBe(1);
    expect(wholeMonthsBetween(d('2026-03-01'), d('2026-01-01'))).toBe(1);
  });
  it('agrees with serviceEnd', () => {
    for (const months of [1, 3, 6, 12, 24]) {
      const start = d('2026-03-17');
      expect(wholeMonthsBetween(start, serviceEnd(start, months))).toBe(months);
    }
  });
});

describe('serviceFeeFigures', () => {
  it('builds the term from the monthly net', () => {
    const f = serviceFeeFigures(850_000, 12, 1500);
    expect(f.monthly.netSantim).toBe(850_000);
    expect(f.monthly.grossSantim).toBe(977_500);
    expect(f.term.netSantim).toBe(10_200_000);
    expect(f.term.grossSantim).toBe(11_730_000);
  });
  it('backs the net out of an all-in monthly figure', () => {
    const f = serviceFeeFigures(1_150_000, 12, 1500, true);
    expect(f.monthly.netSantim).toBe(1_000_000);
    expect(f.term.netSantim).toBe(12_000_000);
  });
  it('refuses a term under a month', () => {
    expect(() => serviceFeeFigures(1000, 0, 1500)).toThrow(RangeError);
  });
});

describe('monthlyTerms', () => {
  it('makes one term per month that sums exactly to the term value', () => {
    const f = serviceFeeFigures(333_333, 7, 1500);
    const terms = monthlyTerms(d('2026-01-31'), 7, f.term);
    expect(terms).toHaveLength(7);
    expect(terms.reduce((a, t) => a + t.netSantim, 0)).toBe(f.term.netSantim);
    expect(terms.reduce((a, t) => a + t.vatSantim, 0)).toBe(f.term.vatSantim);
    expect(terms.reduce((a, t) => a + t.grossSantim, 0)).toBe(f.term.grossSantim);
    expect(terms.map((t) => t.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
  it('bills in arrears and clamps month ends', () => {
    const f = serviceFeeFigures(100_000, 3, 1500);
    const terms = monthlyTerms(d('2026-01-31'), 3, f.term);
    expect(terms[0]?.dueDate.toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(terms[1]?.dueDate.toISOString().slice(0, 10)).toBe('2026-03-31');
    expect(terms[2]?.dueDate.toISOString().slice(0, 10)).toBe('2026-04-30');
  });
});

describe('describeFee / feePerLift', () => {
  it('reads as a sentence', () => {
    expect(describeFee({ monthlyNetSantim: 850_000, unitCount: 2 }, 12)).toBe(
      'ETB 8,500.00 a month · 12 months · 2 lifts',
    );
    expect(describeFee({ monthlyNetSantim: 850_000, unitCount: 1 })).toBe('ETB 8,500.00 a month · 1 lift');
    expect(describeFee(undefined)).toBeNull();
  });
  it('gives a per-lift rate only when lifts are known', () => {
    expect(feePerLift(850_000, 2)).toBe(425_000);
    expect(feePerLift(850_000, 0)).toBeNull();
  });
});

describe('outstandingOn', () => {
  it('counts what is unpaid and nets off part payments', () => {
    const out = outstandingOn([
      { status: 'paid', grossSantim: 100 },
      { status: 'waived', grossSantim: 100 },
      { status: 'part_paid', grossSantim: 100, receivedGrossSantim: 40 },
      { status: 'pending', grossSantim: 50 },
    ]);
    expect(out).toEqual({ count: 2, santim: 110 });
  });
  it('is zero when everything is settled', () => {
    expect(outstandingOn([{ status: 'paid', grossSantim: 10 }])).toEqual({ count: 0, santim: 0 });
  });
});

import { canRenew, nextAgreementNo } from '../service-agreement.js';

describe('nextAgreementNo', () => {
  it('adds -R1 to an agreement that has never been renewed', () => {
    expect(nextAgreementNo('C-1-SVC')).toBe('C-1-SVC-R1');
  });
  it('counts on rather than piling suffixes up', () => {
    expect(nextAgreementNo('C-1-SVC-R1')).toBe('C-1-SVC-R2');
    expect(nextAgreementNo('C-1-SVC-R9')).toBe('C-1-SVC-R10');
  });
  it('leaves an -R inside a number alone', () => {
    expect(nextAgreementNo('R-7')).toBe('R-7-R1');
  });
});

describe('canRenew', () => {
  it('allows a running or just-expired maintenance agreement', () => {
    expect(canRenew({ type: 'maintenance', status: 'active' })).toBe(true);
    expect(canRenew({ type: 'maintenance', status: 'expired' })).toBe(true);
  });
  it('refuses anything that is not a maintenance agreement', () => {
    expect(canRenew({ type: 'supply_install', status: 'active' })).toBe(false);
  });
  it('refuses one that is finished, still a draft, or already renewed', () => {
    expect(canRenew({ type: 'maintenance', status: 'completed' })).toBe(false);
    expect(canRenew({ type: 'maintenance', status: 'terminated' })).toBe(false);
    expect(canRenew({ type: 'maintenance', status: 'draft' })).toBe(false);
    expect(canRenew({ type: 'maintenance', status: 'active', renewedIntoContractId: 'k2' })).toBe(false);
  });
});
