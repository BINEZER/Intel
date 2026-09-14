/**
 * Chasing receivables.
 *
 * The broken promise is what this file exists for. A client who promised to pay
 * on a date that has passed is a different problem from one who has never
 * replied, and nothing else in the system notices the difference.
 */

import { describe, expect, it } from 'vitest';
import {
  chaseState,
  DEFAULT_CADENCE,
  sortChase,
  summariseChase,
  type ChaseInvoice,
  type ChaseStep,
} from '../collection-chase.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function invoice(over: Partial<ChaseInvoice> = {}): ChaseInvoice {
  return {
    id: 'inv1',
    invoiceNo: 'INV-00042',
    clientName: 'Sheger Mall',
    issuedAt: utc(2026, 6, 1),
    dueDate: utc(2026, 7, 1),
    grossSantim: 1_150_000_00,
    balanceSantim: 1_150_000_00,
    status: 'overdue',
    receipts: [],
    ...over,
  };
}

function step(over: Partial<ChaseStep> & { action: ChaseStep['action']; at: Date }): ChaseStep {
  return {
    id: `s-${over.action}-${over.at.getTime()}`,
    byName: 'Finance',
    contactName: 'Ato Bekele',
    note: '',
    ...over,
  };
}

describe('the ordinary ladder', () => {
  it('says nobody has asked, because that is the cheapest thing left undone', () => {
    const state = chaseState(invoice(), [], NOW);

    expect(state.stage).toBe('not_started');
    expect(state.nextAction).toBe('payment_request');
    expect(state.reason).toContain('That is the first step and it is free');
    expect(state.nextActionOverdue).toBe(true);
  });

  it('does not chase an invoice that is not due yet', () => {
    const state = chaseState(invoice({ dueDate: utc(2026, 12, 1), status: 'issued' }), [], NOW);
    expect(state.stage).toBe('not_due');
    expect(state.nextActionOverdue).toBe(false);
  });

  it('asks for a delivered letter once a request has gone unanswered', () => {
    const state = chaseState(invoice(), [step({ action: 'payment_request', at: utc(2026, 7, 5) })], NOW);

    expect(state.stage).toBe('requested');
    expect(state.nextAction).toBe('letter_delivered');
    expect(state.reason).toContain('what a finance department acts on');
  });

  it('moves to following up once the letter has landed', () => {
    const state = chaseState(
      invoice(),
      [
        step({ action: 'payment_request', at: utc(2026, 9, 1) }),
        step({ action: 'letter_delivered', at: utc(2026, 9, 5), deliveryRef: 'REG/2026/411' }),
      ],
      NOW,
    );

    expect(state.stage).toBe('following_up');
    expect(state.letterDelivered).toBe(true);
    expect(state.reason).toContain('a letter in a registry is not a letter read');
  });

  it('escalates after a delivered letter goes quiet for long enough', () => {
    const state = chaseState(
      invoice(),
      [
        step({ action: 'payment_request', at: utc(2026, 7, 2) }),
        step({ action: 'letter_delivered', at: utc(2026, 7, 10) }),
      ],
      NOW,
    );

    expect(state.nextAction).toBe('escalation');
    expect(state.reason).toContain('Go above the person handling it');
  });

  it('moves to legal once escalation has also failed', () => {
    const state = chaseState(
      invoice(),
      [
        step({ action: 'payment_request', at: utc(2026, 7, 2) }),
        step({ action: 'letter_delivered', at: utc(2026, 7, 10) }),
        step({ action: 'escalation', at: utc(2026, 8, 1) }),
      ],
      NOW,
    );

    expect(state.stage).toBe('escalated');
    expect(state.nextAction).toBe('legal_notice');
  });
});

describe('promises', () => {
  const promised = (date: Date, amountSantim?: number) =>
    step({
      action: 'promise_to_pay',
      at: utc(2026, 8, 1),
      contactName: 'W/ro Hanna',
      ...(amountSantim === undefined ? {} : { promisedAmountSantim: amountSantim }),
      promisedDate: date,
    });

  it('says wait when a promise is still in the future, and means it', () => {
    const state = chaseState(invoice(), [promised(utc(2026, 10, 1), 500_000_00)], NOW);

    expect(state.stage).toBe('promised');
    expect(state.openPromise?.contactName).toBe('W/ro Hanna');
    expect(state.reason).toContain('Wait until then');
    expect(state.brokenPromises).toHaveLength(0);
  });

  it('breaks a promise whose date passed with the money still owed', () => {
    const state = chaseState(invoice(), [promised(utc(2026, 8, 20), 500_000_00)], NOW);

    expect(state.stage).toBe('promise_broken');
    expect(state.brokenPromises).toHaveLength(1);
    expect(state.brokenPromises[0]?.daysLate).toBe(25);
    expect(state.nextAction).toBe('escalation');
  });

  it('does NOT break a promise the client actually kept, whatever reference they used', () => {
    // Promised 400,000 and 400,000 arrived after the promise. Demanding that the
    // transfer reference match would call honest clients liars.
    const state = chaseState(
      invoice({
        balanceSantim: 750_000_00,
        status: 'partially_paid',
        receipts: [{ at: utc(2026, 8, 18), amountSantim: 400_000_00 }],
      }),
      [promised(utc(2026, 8, 20), 400_000_00)],
      NOW,
    );

    expect(state.brokenPromises).toHaveLength(0);
  });

  it('does not let an OLD part payment excuse a NEW promise', () => {
    // Part-paid in March, promised the rest in August, nothing since. Comparing
    // against the running total would call this kept and hide every broken
    // promise on every part-paid invoice.
    const state = chaseState(
      invoice({
        balanceSantim: 750_000_00,
        status: 'partially_paid',
        receipts: [{ at: utc(2026, 3, 10), amountSantim: 400_000_00 }],
      }),
      [promised(utc(2026, 8, 20), 400_000_00)],
      NOW,
    );

    expect(state.brokenPromises).toHaveLength(1);
    expect(state.stage).toBe('promise_broken');
  });

  it('recommends legal once a broken promise is old enough', () => {
    const state = chaseState(invoice(), [promised(utc(2026, 7, 1), 500_000_00)], NOW);

    expect(state.nextAction).toBe('legal_notice');
    expect(state.reason).toContain('Legal notice is the next step');
  });

  it('counts repeated broken promises and says so', () => {
    const state = chaseState(
      invoice(),
      [
        step({ action: 'promise_to_pay', at: utc(2026, 7, 1), contactName: 'Ato Bekele', promisedAmountSantim: 500_000_00, promisedDate: utc(2026, 7, 15) }),
        step({ action: 'promise_to_pay', at: utc(2026, 8, 1), contactName: 'Ato Bekele', promisedAmountSantim: 500_000_00, promisedDate: utc(2026, 8, 1) }),
      ],
      NOW,
    );

    expect(state.brokenPromises).toHaveLength(2);
    expect(state.reason).toContain('2 broken promises');
  });

  it('falls back to the whole balance when a promise named no amount', () => {
    const state = chaseState(invoice(), [promised(utc(2026, 8, 1))], NOW);
    expect(state.brokenPromises[0]?.promisedAmountSantim).toBe(1_150_000_00);
  });
});

describe('a dispute stops the chase', () => {
  it('outranks every other recommendation', () => {
    const state = chaseState(
      invoice(),
      [
        step({ action: 'payment_request', at: utc(2026, 7, 2) }),
        step({ action: 'letter_delivered', at: utc(2026, 7, 10) }),
        step({ action: 'dispute_raised', at: utc(2026, 8, 1), note: 'Contesting the variation on floor 4.' }),
      ],
      NOW,
    );

    expect(state.stage).toBe('disputed');
    expect(state.reason).toContain('more demands will not collect a contested invoice');
  });
});

describe('terminal states', () => {
  it('settles on a zero balance', () => {
    expect(chaseState(invoice({ balanceSantim: 0, status: 'paid' }), [], NOW).stage).toBe('settled');
  });

  it('stops counting a written-off invoice as collectable', () => {
    const state = chaseState(invoice(), [step({ action: 'written_off', at: utc(2026, 9, 1) })], NOW);
    expect(state.stage).toBe('written_off');
    expect(state.nextAction).toBeNull();
  });

  it('has nothing to collect on a draft or void invoice', () => {
    expect(chaseState(invoice({ status: 'draft' }), [], NOW).stage).toBe('not_started');
    expect(chaseState(invoice({ status: 'void' }), [], NOW).nextAction).toBeNull();
  });
});

describe('summariseChase', () => {
  const rows = [
    { id: 'a', steps: [] as ChaseStep[] },
    { id: 'b', steps: [step({ action: 'promise_to_pay', at: utc(2026, 8, 1), promisedAmountSantim: 100, promisedDate: utc(2026, 8, 5) })] },
    { id: 'c', steps: [step({ action: 'dispute_raised', at: utc(2026, 8, 1) })] },
  ].map(({ id, steps }) => {
    const inv = invoice({ id, grossSantim: 100_000_00, balanceSantim: 100_000_00 });
    return { invoice: inv, state: chaseState(inv, steps, NOW) };
  });

  it('separates money nobody has chased from money being chased badly', () => {
    const summary = summariseChase(rows);

    expect(summary.unchasedCount).toBe(1);
    expect(summary.unchasedSantim).toBe(100_000_00);
    expect(summary.brokenPromiseCount).toBe(1);
    expect(summary.disputedSantim).toBe(100_000_00);
  });

  it('leaves settled and written-off invoices out of the outstanding total', () => {
    const settled = invoice({ id: 'z', grossSantim: 100_000_00, balanceSantim: 0, status: 'paid' });
    const summary = summariseChase([...rows, { invoice: settled, state: chaseState(settled, [], NOW) }]);

    expect(summary.invoices).toBe(3);
    expect(summary.outstandingSantim).toBe(300_000_00);
  });
});

describe('sortChase', () => {
  it('leads with broken promises, then work nobody has started', () => {
    const make = (id: string, steps: ChaseStep[], balance: number) => {
      const inv = invoice({ id, grossSantim: balance, balanceSantim: balance });
      return { invoice: inv, state: chaseState(inv, steps, NOW) };
    };

    const sorted = sortChase([
      make('promised', [step({ action: 'promise_to_pay', at: utc(2026, 9, 1), promisedDate: utc(2026, 12, 1), promisedAmountSantim: 1 })], 9_000_000_00),
      make('unchased', [], 100_00),
      make('broken', [step({ action: 'promise_to_pay', at: utc(2026, 8, 1), promisedDate: utc(2026, 8, 5), promisedAmountSantim: 1 })], 1_00),
    ]);

    // Smallest balance first here, because urgency outranks size.
    expect(sorted.map((r) => r.invoice.id)).toEqual(['broken', 'unchased', 'promised']);
  });
});

describe('cadence is configurable', () => {
  it('respects a slower rhythm for a client that needs one', () => {
    const steps = [step({ action: 'payment_request', at: utc(2026, 8, 1) })];
    const fast = chaseState(invoice(), steps, NOW, DEFAULT_CADENCE);
    const slow = chaseState(invoice(), steps, NOW, { ...DEFAULT_CADENCE, letterAfterDays: 90 });

    expect(fast.nextActionOverdue).toBe(true);
    expect(slow.nextActionOverdue).toBe(false);
  });
});
