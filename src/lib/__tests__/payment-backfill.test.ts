/**
 * Applying the workbook's payments to contracts that already exist.
 *
 * The thing under test is restraint: what it refuses to touch matters more than
 * what it writes, because the records it could damage are invoices.
 */

import { describe, expect, it } from 'vitest';
import {
  describePaymentBackfill,
  scheduleMatches,
  describeTermStatus,
  termStatusAfterSettlement,
  verdictFor,
  type PaymentBackfillResult,
  type PlannedTerm,
  type StoredTerm,
} from '../payment-backfill.js';

const term = (over: Partial<StoredTerm> = {}): StoredTerm => ({
  seq: 1,
  name: 'Advance Payment',
  grossSantim: 2_703_604_26,
  status: 'pending',
  ...over,
});
const planned = (over: Partial<PlannedTerm> = {}): PlannedTerm => ({
  seq: 1,
  name: 'Advance Payment',
  paid: true,
  ...over,
});

describe('what may be touched', () => {
  it('settles an open term the workbook says was paid', () => {
    expect(verdictFor(term(), planned())).toBe('settle');
  });

  it('leaves an open term the workbook says nothing about', () => {
    expect(verdictFor(term(), planned({ paid: false }))).toBe('leave');
  });

  it.each(['invoiced', 'paid', 'waived', 'ready_to_invoice'] as const)(
    'protects a term that is %s',
    (status) => {
      expect(verdictFor(term({ status }), planned())).toBe('protected');
    },
  );

  it('protects a pending term that nonetheless carries an invoice', () => {
    // The status and the invoice can disagree. The invoice wins: detaching one
    // is the damage this pass exists to avoid.
    expect(verdictFor(term({ status: 'pending', invoiceId: 'inv-1' }), planned())).toBe('protected');
  });

  it('is not fooled by an empty invoice id', () => {
    expect(verdictFor(term({ invoiceId: '' }), planned())).toBe('settle');
  });

  it('decides protection before consulting the workbook', () => {
    // A term with an invoice is never a candidate, whatever the sheet says.
    expect(verdictFor(term({ status: 'invoiced' }), planned({ paid: false }))).toBe('protected');
  });
});

describe('does the stored schedule still line up', () => {
  const stored = [term({ seq: 1 }), term({ seq: 2, name: 'Bill receipt' })];
  const plan = [planned({ seq: 1 }), planned({ seq: 2, name: 'Bill receipt', paid: false })];

  it('accepts the same terms in the same order', () => {
    expect(scheduleMatches(stored, plan)).toBe(true);
  });

  it('refuses a schedule with a different number of terms', () => {
    expect(scheduleMatches(stored, [plan[0] as PlannedTerm])).toBe(false);
  });

  it('refuses a renamed term', () => {
    // "Term 2 is paid" stops meaning the same term, and the money would land on
    // the wrong stage.
    expect(scheduleMatches(stored, [plan[0] as PlannedTerm, planned({ seq: 2, name: 'On handover' })])).toBe(false);
  });

  it('refuses a resequenced term', () => {
    expect(scheduleMatches(stored, [plan[0] as PlannedTerm, planned({ seq: 3, name: 'Bill receipt' })])).toBe(false);
  });

  it('ignores the amounts, which may have been corrected in the app', () => {
    const richer = [term({ seq: 1, grossSantim: 999 }), term({ seq: 2, name: 'Bill receipt', grossSantim: 1 })];
    expect(scheduleMatches(richer, plan)).toBe(true);
  });

  it('refuses an empty schedule rather than calling it a match', () => {
    expect(scheduleMatches([], [])).toBe(false);
  });

  it('tolerates stray spacing in a stored name', () => {
    expect(scheduleMatches([term({ name: '  Advance Payment ' })], [planned()])).toBe(true);
  });
});

const result = (over: Partial<PaymentBackfillResult> = {}): PaymentBackfillResult => ({
  examined: 0,
  updated: 0,
  termsSettled: 0,
  santimSettled: 0,
  termsProtected: 0,
  notInApp: [],
  scheduleChanged: [],
  alreadyDone: 0,
  ...over,
});

describe('what an invoice settlement means for its term', () => {
  it('marks the term paid when nothing is left outstanding', () => {
    expect(termStatusAfterSettlement(0, 115_000_000)).toBe('paid');
  });

  it('says PART PAID when money arrived but a balance remains', () => {
    // Not "invoiced". The client has paid something and the term must say so —
    // "invoiced" reports only that a bill went out and hides the cash.
    expect(termStatusAfterSettlement(57_500_000, 57_500_000)).toBe('part_paid');
  });

  it('says invoiced only while nothing at all has come in', () => {
    expect(termStatusAfterSettlement(115_000_000, 0)).toBe('invoiced');
  });

  it('does not close a term over a single cent still owed', () => {
    // A part payment acknowledges the cash; it must never forgive the rest.
    expect(termStatusAfterSettlement(1, 114_999_999)).toBe('part_paid');
  });

  it('treats an overpayment as settled', () => {
    // A rounding cent on the wrong side must not leave a paid contract open.
    expect(termStatusAfterSettlement(-1, 115_000_001)).toBe('paid');
  });

  it('settles a term paid entirely by withholding, with no cash at all', () => {
    // Withholding the client remitted to ERCA on our behalf settles the invoice
    // without arriving as money. Leaving the term open would have somebody
    // chasing tax that is already paid.
    expect(termStatusAfterSettlement(0, 0)).toBe('paid');
  });

  it('reads in words a person would use', () => {
    expect(describeTermStatus('part_paid')).toBe('part paid');
    expect(describeTermStatus('ready_to_invoice')).toBe('ready to invoice');
    expect(describeTermStatus('paid')).toBe('paid');
  });
});

describe('what it says afterwards', () => {
  it('says there was nothing to apply when the workbook has no history', () => {
    expect(describePaymentBackfill(result())).toContain('no payment history');
  });

  it('distinguishes "already recorded" from "could not be updated"', () => {
    expect(describePaymentBackfill(result({ examined: 5, alreadyDone: 5 }))).toContain(
      'already recorded here',
    );
    expect(describePaymentBackfill(result({ examined: 5, scheduleChanged: ['AGR-1'] }))).toContain(
      'see below',
    );
  });

  it('names the money and counts in plain words', () => {
    const said = describePaymentBackfill(
      result({ examined: 41, updated: 41, termsSettled: 84, santimSettled: 27_250_445_108 }),
    );
    expect(said).toContain('84 payment terms');
    expect(said).toContain('41 contracts');
    expect(said).toContain('ETB 272,504,451.08');
  });

  it('gets the singulars right', () => {
    const said = describePaymentBackfill(
      result({ examined: 1, updated: 1, termsSettled: 1, santimSettled: 100 }),
    );
    expect(said).toContain('1 payment term recorded');
    expect(said).toContain('1 contract,');
  });
});
