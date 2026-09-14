/**
 * The subcontractor payout workflow.
 *
 * Two things matter more than the transitions themselves: that the person who
 * verified work cannot also release the money, and that waiting time is measured
 * from the step stamps rather than from `updatedAt`, which moves whenever anyone
 * touches the record.
 */

import { describe, expect, it } from 'vitest';
import {
  ageVoucher,
  availableTransitions,
  buildPayoutPipeline,
  canTransition,
  payeeStanding,
  stepLabel,
  type PayoutVoucher,
} from '../payout-workflow.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function voucher(over: Partial<PayoutVoucher> = {}): PayoutVoucher {
  return {
    id: 'v1',
    voucherNo: 'PV-001',
    subcontractorName: 'Selam Civil',
    projectId: 'p1',
    phaseName: 'Shaft preparation',
    status: 'requested',
    netSantim: 400_000_00,
    netPayableSantim: 452_000_00,
    supplierInvoiceDate: utc(2026, 8, 20),
    trail: {
      requestedAt: utc(2026, 9, 1),
      checkedAt: null,
      approvedAt: null,
      paidAt: null,
      rejectedAt: null,
      heldAt: null,
    },
    ...over,
  };
}

describe('separation of duties', () => {
  const context = (role: 'manager' | 'finance' | 'engineer' | 'admin', uid: string, checkedBy?: string) => ({
    role: role as 'manager',
    uid,
    actors: checkedBy === undefined ? {} : { checked: checkedBy },
  });

  it('refuses to let the person who verified the work approve the payment', () => {
    const transitions = availableTransitions('checked', context('finance', 'abebe', 'abebe'));
    const approve = transitions.find((t) => t.to === 'approved');

    expect(approve?.blockedBy).toContain('someone else must approve');
    expect(canTransition('checked', 'approved', context('finance', 'abebe', 'abebe'))).toBe(false);
  });

  it('allows approval by anyone else with the right role', () => {
    expect(canTransition('checked', 'approved', context('finance', 'meron', 'abebe'))).toBe(true);
  });

  it('shows blocked transitions with their reason rather than hiding them', () => {
    // A missing button looks like a bug and gets worked around; a greyed-out one
    // that explains itself teaches the rule.
    const transitions = availableTransitions('checked', context('engineer', 'eng'));
    const approve = transitions.find((t) => t.to === 'approved');

    expect(approve).toBeDefined();
    expect(approve?.blockedBy).toContain('admin or finance');
  });
});

describe('transitions', () => {
  const anyone = { role: 'admin' as const, uid: 'adm', actors: {} };

  it('walks the ladder in order', () => {
    expect(canTransition('draft', 'requested', anyone)).toBe(true);
    expect(canTransition('requested', 'checked', anyone)).toBe(true);
    expect(canTransition('checked', 'approved', anyone)).toBe(true);
    expect(canTransition('approved', 'paid', anyone)).toBe(true);
  });

  it('refuses to skip verification', () => {
    expect(canTransition('requested', 'approved', anyone)).toBe(false);
    expect(canTransition('requested', 'paid', anyone)).toBe(false);
  });

  it('sends a released hold back to verification, not straight to approval', () => {
    // Whatever put it on hold probably changed what is owed.
    const transitions = availableTransitions('on_hold', anyone).map((t) => t.to);
    expect(transitions).toContain('checked');
    expect(transitions).not.toContain('approved');
  });

  it('offers nothing on a settled or refused voucher', () => {
    expect(availableTransitions('paid', anyone)).toEqual([]);
    expect(availableTransitions('rejected', anyone)).toEqual([]);
    expect(availableTransitions('void', anyone)).toEqual([]);
  });

  it('refuses everything to someone not signed in', () => {
    const out = availableTransitions('requested', { role: null, uid: '', actors: {} });
    expect(out.every((t) => t.blockedBy !== null)).toBe(true);
  });
});

describe('ageing', () => {
  it('measures the current step from the stamp that started it', () => {
    const ageing = ageVoucher(voucher(), NOW);
    expect(ageing.daysAtStep).toBe(13);
    expect(ageing.daysSinceRequest).toBe(13);
    expect(ageing.waitingOn).toContain('confirm the work was done');
  });

  it('falls back to the supplier invoice date for a voucher never submitted', () => {
    const ageing = ageVoucher(
      voucher({ status: 'draft', trail: { requestedAt: null, checkedAt: null, approvedAt: null, paidAt: null, rejectedAt: null, heldAt: null } }),
      NOW,
    );
    expect(ageing.daysAtStep).toBe(25);
    expect(ageing.daysSinceRequest).toBeNull();
  });

  it('flags a voucher past its step target', () => {
    expect(ageVoucher(voucher(), NOW).overdue).toBe(true);
    expect(ageVoucher(voucher({ trail: { ...voucher().trail, requestedAt: utc(2026, 9, 13) } }), NOW).overdue).toBe(false);
  });

  it('never calls a paid voucher overdue, however long it sat', () => {
    const paid = voucher({
      status: 'paid',
      trail: { requestedAt: utc(2026, 1, 1), checkedAt: utc(2026, 1, 5), approvedAt: utc(2026, 2, 1), paidAt: utc(2026, 6, 1), rejectedAt: null, heldAt: null },
    });
    expect(ageVoucher(paid, NOW).overdue).toBe(false);
    expect(ageVoucher(paid, NOW).daysToPay).toBe(151);
  });
});

describe('the pipeline', () => {
  const vouchers = [
    voucher({ id: 'a', status: 'requested' }),
    voucher({ id: 'b', status: 'checked', netPayableSantim: 100_00, trail: { ...voucher().trail, checkedAt: utc(2026, 9, 12) } }),
    voucher({ id: 'c', status: 'approved', netPayableSantim: 900_00, trail: { ...voucher().trail, checkedAt: utc(2026, 9, 2), approvedAt: utc(2026, 9, 3) } }),
    voucher({ id: 'd', status: 'paid', netPayableSantim: 500_00, trail: { requestedAt: utc(2026, 8, 1), checkedAt: utc(2026, 8, 3), approvedAt: utc(2026, 8, 5), paidAt: utc(2026, 8, 9), rejectedAt: null, heldAt: null } }),
    voucher({ id: 'e', status: 'paid', netPayableSantim: 700_00, trail: { requestedAt: utc(2026, 7, 1), checkedAt: utc(2026, 7, 2), approvedAt: utc(2026, 7, 3), paidAt: utc(2026, 7, 21), rejectedAt: null, heldAt: null } }),
  ];

  it('separates committed cash from cash still under decision', () => {
    const pipeline = buildPayoutPipeline(vouchers, NOW);

    // Approved and unpaid is committed; requested and checked are not yet.
    expect(pipeline.committedSantim).toBe(900_00);
    expect(pipeline.inFlightSantim).toBe(452_000_00 + 100_00);
  });

  it('uses the median days to pay, not the mean', () => {
    // 8 and 20 days: the median of two is their mean, so add a third outlier.
    const withOutlier = [
      ...vouchers,
      voucher({ id: 'f', status: 'paid', trail: { requestedAt: utc(2026, 2, 1), checkedAt: null, approvedAt: null, paidAt: utc(2026, 8, 1), rejectedAt: null, heldAt: null } }),
    ];
    const pipeline = buildPayoutPipeline(withOutlier, NOW);

    // Days to pay are 8, 20, 181. Median is 20; the mean would be 69.
    expect(pipeline.medianDaysToPay).toBe(20);
  });

  it('reports no timing figure at all when nothing has been paid', () => {
    const pipeline = buildPayoutPipeline([voucher()], NOW);
    expect(pipeline.medianDaysToPay).toBeNull();
    expect(pipeline.onTimeRateBps).toBeNull();
  });

  it('counts payments in the window when one is given', () => {
    const pipeline = buildPayoutPipeline(vouchers, NOW, {
      paidWithin: { start: utc(2026, 8, 1), end: utc(2026, 8, 31) },
    });
    expect(pipeline.paidThisPeriodSantim).toBe(500_00);
  });

  it('names the oldest voucher stuck at each step', () => {
    const requested = buildPayoutPipeline(vouchers, NOW).stages.find((s) => s.key === 'requested');
    expect(requested?.oldestDays).toBe(13);
    expect(requested?.overdue).toBe(1);
  });
});

describe('payeeStanding', () => {
  it('says what a subcontractor would say about us', () => {
    const standing = payeeStanding('Selam Civil', [
      voucher({ id: 'a', status: 'requested', netPayableSantim: 300_00 }),
      voucher({ id: 'b', status: 'paid', trail: { requestedAt: utc(2026, 8, 1), checkedAt: null, approvedAt: null, paidAt: utc(2026, 8, 15), rejectedAt: null, heldAt: null } }),
    ], NOW);

    expect(standing.outstandingSantim).toBe(300_00);
    expect(standing.oldestOutstandingDays).toBe(13);
    expect(standing.summary).toContain('typically pay in 14 days');
  });

  it('does not count a draft voucher as money owed to them', () => {
    // A draft has not been submitted; the subcontractor is not waiting on it.
    const standing = payeeStanding('Selam Civil', [voucher({ status: 'draft' })], NOW);
    expect(standing.outstandingSantim).toBe(0);
  });

  it('is honest when there is nothing to judge us by', () => {
    const standing = payeeStanding('New Sub', [], NOW);
    expect(standing.summary).toContain('nothing paid yet to judge us by');
  });
});

describe('labels', () => {
  it('names every state in words, including the exits', () => {
    expect(stepLabel('requested')).toBe('Payment requested');
    expect(stepLabel('on_hold')).toBe('On hold');
    expect(stepLabel('void')).toBe('Cancelled');
  });
});
