/**
 * Paying a subcontractor: request → check → approve → pay.
 *
 * WHY A WORKFLOW AND NOT A STATUS FIELD
 *
 *   A voucher that sits for three weeks and a voucher raised yesterday both read
 *   as "approved". The subcontractor knows the difference, and so does anyone
 *   who has had a crew walk off site. What matters is not which box a payment is
 *   in but HOW LONG IT HAS BEEN THERE and WHO IT IS WAITING ON — and neither is
 *   recoverable from a single status field.
 *
 *   So every step is stamped with when it happened and who did it, and the
 *   waiting time is computed from those stamps rather than from `updatedAt`,
 *   which moves every time anyone touches the record.
 *
 * SEPARATION OF DUTIES
 *   The person who checks the work is not the person who authorises the money.
 *   That is not bureaucracy: a single person who can both confirm work happened
 *   and release payment for it is the entire control failure, and it is enforced
 *   here and in the security rules rather than left to habit.
 */

import { daysBetween, rateBps } from './kpi.js';
import { formatETB } from './money.js';
import type { RateBps, Role } from './schema.js';

export const PAYOUT_STEPS = [
  'draft',
  'requested',
  'checked',
  'approved',
  'paid',
] as const;

export type PayoutStep = (typeof PAYOUT_STEPS)[number];

/** Terminal states a voucher can end in instead of being paid. */
export type PayoutExit = 'rejected' | 'on_hold' | 'void';

export type PayoutStatus = PayoutStep | PayoutExit;

export interface StepDefinition {
  key: PayoutStep;
  label: string;
  /** What actually has to happen, in the words the person doing it would use. */
  description: string;
  /** Who may move a voucher INTO this step. */
  actors: readonly Role[];
  /**
   * Days this step should take. Not a promise to anyone outside — a threshold
   * for asking why a voucher has stopped moving.
   */
  targetDays: number;
}

export const PAYOUT_WORKFLOW: readonly StepDefinition[] = [
  {
    key: 'draft',
    label: 'Being prepared',
    description: 'The voucher is being written up — supplier invoice, amounts, which phase it is against.',
    actors: ['admin', 'manager', 'finance'],
    targetDays: 2,
  },
  {
    key: 'requested',
    label: 'Payment requested',
    description: 'Submitted for payment by whoever raised it. The clock the subcontractor is counting starts here.',
    actors: ['admin', 'manager', 'finance', 'engineer'],
    targetDays: 3,
  },
  {
    key: 'checked',
    label: 'Work verified',
    description: 'Someone confirmed the work being paid for was actually done, to the quantity claimed.',
    actors: ['admin', 'manager', 'engineer'],
    targetDays: 3,
  },
  {
    key: 'approved',
    label: 'Approved for payment',
    description: 'Authorised to release. Committed cash from this point — it is no longer a decision.',
    actors: ['admin', 'finance'],
    targetDays: 7,
  },
  {
    key: 'paid',
    label: 'Paid',
    description: 'Money out of the bank, withholding certificate issued.',
    actors: ['admin', 'finance'],
    targetDays: 0,
  },
];

const BY_KEY = new Map(PAYOUT_WORKFLOW.map((step) => [step.key as string, step]));

export function stepDefinition(key: string): StepDefinition | undefined {
  return BY_KEY.get(key);
}

export function stepLabel(status: PayoutStatus): string {
  if (status === 'rejected') return 'Rejected';
  if (status === 'on_hold') return 'On hold';
  if (status === 'void') return 'Cancelled';
  return BY_KEY.get(status)?.label ?? status;
}

export function stepIndex(status: PayoutStatus): number {
  return (PAYOUT_STEPS as readonly string[]).indexOf(status);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionContext {
  /** Who stamped each earlier step, so the same person cannot do two. */
  actors: Partial<Record<PayoutStep, string>>;
  uid: string;
  role: Role | null;
}

export interface Transition {
  to: PayoutStatus;
  label: string;
  /** Null when allowed; otherwise why not, in a sentence the user can act on. */
  blockedBy: string | null;
}

/**
 * What may happen next, and — where it may not — why.
 *
 * Returning the blocked options WITH their reason rather than filtering them out
 * is deliberate. A greyed-out "Approve" that explains itself teaches the rule;
 * a missing button looks like a bug and gets worked around by asking someone
 * else to log in.
 */
export function availableTransitions(
  status: PayoutStatus,
  context: TransitionContext,
): Transition[] {
  const { role, uid, actors } = context;
  const canAct = (step: PayoutStep): string | null => {
    const definition = BY_KEY.get(step);
    if (definition === undefined) return 'Unknown step.';
    if (role === null) return 'You are not signed in.';
    if (!definition.actors.includes(role)) {
      return `Only ${definition.actors.join(' or ')} may do this.`;
    }
    return null;
  };

  /**
   * The person who verified the work may not also authorise the money. One
   * person able to do both is the entire control failure.
   */
  const separationBlock = (step: PayoutStep): string | null => {
    if (step !== 'approved') return null;
    if (actors.checked !== undefined && actors.checked === uid) {
      return 'You verified this work, so someone else must approve the payment.';
    }
    return null;
  };

  const forward = (to: PayoutStep, label: string): Transition => ({
    to,
    label,
    blockedBy: canAct(to) ?? separationBlock(to),
  });

  const hold: Transition = { to: 'on_hold', label: 'Put on hold', blockedBy: canAct('checked') };
  const reject: Transition = { to: 'rejected', label: 'Reject', blockedBy: canAct('approved') };

  switch (status) {
    case 'draft':
      return [forward('requested', 'Submit payment request'), { to: 'void', label: 'Cancel', blockedBy: canAct('draft') }];
    case 'requested':
      return [forward('checked', 'Confirm the work was done'), hold, reject];
    case 'checked':
      return [forward('approved', 'Approve for payment'), hold, reject];
    case 'approved':
      return [forward('paid', 'Record payment'), hold];
    case 'on_hold':
      // Back to verification rather than straight to approval: whatever put it
      // on hold is likely to have changed what is owed.
      return [forward('checked', 'Release the hold'), reject];
    case 'paid':
    case 'rejected':
    case 'void':
      return [];
  }
}

export function canTransition(status: PayoutStatus, to: PayoutStatus, context: TransitionContext): boolean {
  return availableTransitions(status, context).some((t) => t.to === to && t.blockedBy === null);
}

// ---------------------------------------------------------------------------
// Where a voucher is, and how long it has been there
// ---------------------------------------------------------------------------

export interface PayoutTrail {
  requestedAt: Date | null;
  checkedAt: Date | null;
  approvedAt: Date | null;
  paidAt: Date | null;
  rejectedAt: Date | null;
  heldAt: Date | null;
}

export interface PayoutVoucher {
  id: string;
  voucherNo: string;
  subcontractorName: string;
  projectId: string;
  phaseName: string;
  status: PayoutStatus;
  netSantim: number;
  netPayableSantim: number;
  supplierInvoiceDate: Date;
  trail: PayoutTrail;
}

export interface PayoutAgeing {
  /** Days at the CURRENT step, from the stamp that put it there. */
  daysAtStep: number;
  /** Days since the subcontractor asked — what they are actually counting. */
  daysSinceRequest: number | null;
  /** Days from request to payment, once paid. */
  daysToPay: number | null;
  overdue: boolean;
  targetDays: number;
  /** One sentence naming who it is sitting with. */
  waitingOn: string;
}

/** When the voucher entered the step it is in now. */
function enteredStepAt(voucher: PayoutVoucher): Date | null {
  switch (voucher.status) {
    case 'paid': return voucher.trail.paidAt;
    case 'approved': return voucher.trail.approvedAt;
    case 'checked': return voucher.trail.checkedAt;
    case 'requested': return voucher.trail.requestedAt;
    case 'rejected': return voucher.trail.rejectedAt;
    case 'on_hold': return voucher.trail.heldAt;
    case 'draft':
    case 'void':
      return null;
  }
}

const WAITING_ON: Record<PayoutStatus, string> = {
  draft: 'whoever is raising it',
  requested: 'the project team, to confirm the work was done',
  checked: 'approval',
  approved: 'the payment run',
  paid: 'nobody — it is settled',
  on_hold: 'whatever put it on hold',
  rejected: 'nobody — it was refused',
  void: 'nobody — it was cancelled',
};

export function ageVoucher(voucher: PayoutVoucher, asOf: Date): PayoutAgeing {
  const entered = enteredStepAt(voucher) ?? voucher.supplierInvoiceDate;
  const target = BY_KEY.get(voucher.status)?.targetDays ?? 0;
  const daysAtStep = Math.max(0, daysBetween(entered, asOf));

  const daysSinceRequest =
    voucher.trail.requestedAt === null ? null : Math.max(0, daysBetween(voucher.trail.requestedAt, asOf));

  const daysToPay =
    voucher.trail.requestedAt === null || voucher.trail.paidAt === null
      ? null
      : Math.max(0, daysBetween(voucher.trail.requestedAt, voucher.trail.paidAt));

  return {
    daysAtStep,
    daysSinceRequest,
    daysToPay,
    // A settled or refused voucher is never overdue however long it sat.
    overdue: target > 0 && daysAtStep > target && voucher.status !== 'paid',
    targetDays: target,
    waitingOn: WAITING_ON[voucher.status],
  };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface PipelineStage {
  key: PayoutStatus;
  label: string;
  count: number;
  netPayableSantim: number;
  overdue: number;
  /** The single oldest voucher sitting here, in days. */
  oldestDays: number;
}

export interface PayoutPipeline {
  stages: PipelineStage[];
  /** Approved and unpaid — cash the business has already committed. */
  committedSantim: number;
  /** Raised but not yet approved — still a decision. */
  inFlightSantim: number;
  paidThisPeriodSantim: number;
  /** Median days from request to payment over vouchers actually paid. */
  medianDaysToPay: number | null;
  /** Share of paid vouchers settled inside the approval target. */
  onTimeRateBps: RateBps;
}

const PIPELINE_ORDER: readonly PayoutStatus[] = [
  'draft', 'requested', 'checked', 'approved', 'on_hold', 'paid', 'rejected',
];

export function buildPayoutPipeline(
  vouchers: readonly PayoutVoucher[],
  asOf: Date,
  options: { paidWithin?: { start: Date; end: Date } } = {},
): PayoutPipeline {
  const aged = vouchers.map((voucher) => ({ voucher, ageing: ageVoucher(voucher, asOf) }));

  const stages = PIPELINE_ORDER.map((key) => {
    const here = aged.filter((row) => row.voucher.status === key);
    return {
      key,
      label: stepLabel(key),
      count: here.length,
      netPayableSantim: here.reduce((a, row) => a + row.voucher.netPayableSantim, 0),
      overdue: here.filter((row) => row.ageing.overdue).length,
      oldestDays: here.reduce((a, row) => Math.max(a, row.ageing.daysAtStep), 0),
    };
  });

  const paid = aged.filter((row) => row.voucher.status === 'paid');
  const withDuration = paid
    .map((row) => row.ageing.daysToPay)
    .filter((days): days is number => days !== null)
    .sort((a, b) => a - b);

  // Median, not mean: one voucher stuck in a dispute for 200 days should not
  // make the typical payment look four times slower than it is.
  const medianDaysToPay =
    withDuration.length === 0
      ? null
      : withDuration.length % 2 === 1
        ? (withDuration[(withDuration.length - 1) / 2] as number)
        : Math.round(
            ((withDuration[withDuration.length / 2 - 1] as number) +
              (withDuration[withDuration.length / 2] as number)) / 2,
          );

  const approvalTarget = BY_KEY.get('approved')?.targetDays ?? 7;
  const paidInWindow =
    options.paidWithin === undefined
      ? paid
      : paid.filter(
          (row) =>
            row.voucher.trail.paidAt !== null &&
            row.voucher.trail.paidAt >= (options.paidWithin as { start: Date }).start &&
            row.voucher.trail.paidAt <= (options.paidWithin as { end: Date }).end,
        );

  return {
    stages,
    committedSantim: aged
      .filter((row) => row.voucher.status === 'approved')
      .reduce((a, row) => a + row.voucher.netPayableSantim, 0),
    inFlightSantim: aged
      .filter((row) => row.voucher.status === 'requested' || row.voucher.status === 'checked')
      .reduce((a, row) => a + row.voucher.netPayableSantim, 0),
    paidThisPeriodSantim: paidInWindow.reduce((a, row) => a + row.voucher.netPayableSantim, 0),
    medianDaysToPay,
    onTimeRateBps: rateBps(
      withDuration.filter((days) => days <= approvalTarget).length,
      withDuration.length,
    ),
  };
}

/**
 * What a subcontractor would say about us.
 *
 * Reported on the subcontractor's own card because it is the honest half of
 * their scorecard: a subcontractor paid ninety days late who still turns up is
 * performing well, and reading their delivery figures without this is unfair.
 */
export interface PayeeStanding {
  subcontractorName: string;
  vouchers: number;
  paidVouchers: number;
  medianDaysToPay: number | null;
  outstandingSantim: number;
  oldestOutstandingDays: number;
  summary: string;
}

export function payeeStanding(
  subcontractorName: string,
  vouchers: readonly PayoutVoucher[],
  asOf: Date,
): PayeeStanding {
  const pipeline = buildPayoutPipeline(vouchers, asOf);
  const unpaid = vouchers.filter(
    (v) => v.status !== 'paid' && v.status !== 'rejected' && v.status !== 'void' && v.status !== 'draft',
  );
  const outstandingSantim = unpaid.reduce((a, v) => a + v.netPayableSantim, 0);
  const oldestOutstandingDays = unpaid.reduce(
    (a, v) => Math.max(a, ageVoucher(v, asOf).daysSinceRequest ?? 0),
    0,
  );

  const summary =
    unpaid.length === 0
      ? pipeline.medianDaysToPay === null
        ? 'Nothing outstanding, and nothing paid yet to judge us by.'
        : `Nothing outstanding. We typically pay in ${pipeline.medianDaysToPay} days.`
      : `${formatETB(outstandingSantim)} outstanding across ${unpaid.length} voucher${unpaid.length === 1 ? '' : 's'}` +
        `${oldestOutstandingDays > 0 ? `, the oldest requested ${oldestOutstandingDays} days ago` : ''}.` +
        `${pipeline.medianDaysToPay === null ? '' : ` We typically pay in ${pipeline.medianDaysToPay} days.`}`;

  return {
    subcontractorName,
    vouchers: vouchers.length,
    paidVouchers: vouchers.filter((v) => v.status === 'paid').length,
    medianDaysToPay: pipeline.medianDaysToPay,
    outstandingSantim,
    oldestOutstandingDays,
    summary,
  };
}
