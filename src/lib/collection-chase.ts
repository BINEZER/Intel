/**
 * Chasing a client for money: request → letter → follow-up → receipt.
 *
 * WHAT MAKES THIS DIFFERENT FROM AN AGEING REPORT
 *
 *   An ageing report says an invoice is 74 days old. It does not say whether
 *   anyone has asked for the money, whether the letter reached the right desk,
 *   what the client said, or whether they promised to pay on a date that has
 *   since passed. Those are the facts that decide what to do next, and none of
 *   them survive in a status field.
 *
 *   In Ethiopian practice the delivered LETTER is the pivotal artefact — a
 *   stamped copy is what a finance department acts on and what any later
 *   escalation rests on — so it is a first-class step rather than a note.
 *
 * THE BROKEN PROMISE
 *   A client who promised to pay on a date that has passed is a different
 *   problem from one who has never replied, and needs a different call. Nothing
 *   else in the system notices the difference, so this file does: a promise is
 *   recorded with its date and amount, and goes bad on its own.
 */

import { daysBetween } from './kpi.js';
import { formatETB } from './money.js';

export const CHASE_ACTIONS = [
  'payment_request',
  'letter_delivered',
  'follow_up_call',
  'follow_up_visit',
  'promise_to_pay',
  'dispute_raised',
  'escalation',
  'legal_notice',
  'part_payment',
  'payment_received',
  'written_off',
] as const;

export type ChaseAction = (typeof CHASE_ACTIONS)[number];

export interface ChaseActionMeta {
  key: ChaseAction;
  label: string;
  description: string;
  /** Advances the chase rather than merely recording contact. */
  advances: boolean;
}

export const CHASE_ACTION_META: readonly ChaseActionMeta[] = [
  { key: 'payment_request', label: 'Payment requested', description: 'We asked for the money — usually the invoice going out with a covering note.', advances: true },
  { key: 'letter_delivered', label: 'Letter delivered', description: 'A formal demand physically reached them and was received. The stamped copy is the artefact everything later rests on.', advances: true },
  { key: 'follow_up_call', label: 'Follow-up call', description: 'Spoke to somebody. Record who and what they said.', advances: false },
  { key: 'follow_up_visit', label: 'Follow-up visit', description: 'Went in person.', advances: false },
  { key: 'promise_to_pay', label: 'Promised to pay', description: 'They committed to a date and an amount. Recorded so it can be held against them when it passes.', advances: true },
  { key: 'dispute_raised', label: 'Dispute raised', description: 'They are contesting the amount or the work. Chasing harder will not help until it is resolved.', advances: true },
  { key: 'escalation', label: 'Escalated', description: 'Taken above the person who has been handling it.', advances: true },
  { key: 'legal_notice', label: 'Legal notice', description: 'Formal notice issued through a lawyer.', advances: true },
  { key: 'part_payment', label: 'Part payment received', description: 'Some of it came in.', advances: true },
  { key: 'payment_received', label: 'Paid in full', description: 'Settled.', advances: true },
  { key: 'written_off', label: 'Written off', description: 'Given up on, with approval. Recorded so it stops appearing as collectable.', advances: true },
];

const META_BY_KEY = new Map(CHASE_ACTION_META.map((m) => [m.key as string, m]));

export function chaseActionLabel(action: string): string {
  return META_BY_KEY.get(action)?.label ?? action.replace(/_/g, ' ');
}

export interface ChaseStep {
  id: string;
  action: ChaseAction;
  at: Date;
  /** Who did it, on our side. */
  byName: string;
  /** Who it went to, on theirs. */
  contactName: string;
  /** What was said, what was handed over, the reference on the stamped copy. */
  note: string;
  /** Set on `promise_to_pay`: what they committed to, and by when. */
  promisedAmountSantim?: number;
  promisedDate?: Date;
  /** Set on `letter_delivered`: their reference on the received copy. */
  deliveryRef?: string;
}

export interface ChaseInvoice {
  id: string;
  invoiceNo: string;
  clientName: string;
  issuedAt: Date;
  dueDate: Date;
  grossSantim: number;
  /** Still owed, after receipts and any client withholding. */
  balanceSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  /**
   * Money actually received, with dates.
   *
   * Needed to judge a promise: what matters is whether anything arrived AFTER
   * they promised it, not whether the invoice has ever been part-paid.
   */
  receipts: readonly { at: Date; amountSantim: number }[];
}

// ---------------------------------------------------------------------------
// Cadence
// ---------------------------------------------------------------------------

export interface ChaseCadence {
  /** Days after the due date before the first formal request. */
  requestAfterDays: number;
  /** Days after the request with no payment before a letter goes out. */
  letterAfterDays: number;
  /** Days between follow-ups once a letter has been delivered. */
  followUpEveryDays: number;
  /** Days of silence after a delivered letter before escalating. */
  escalateAfterDays: number;
  /** Days past a broken promise before legal notice is the recommendation. */
  legalAfterDays: number;
}

/**
 * A starting cadence, not a policy. Change it in Settings — a government client
 * and a private developer do not respond to the same rhythm, and chasing a
 * ministry every three days achieves nothing but annoyance.
 */
export const DEFAULT_CADENCE: ChaseCadence = {
  requestAfterDays: 0,
  letterAfterDays: 14,
  followUpEveryDays: 7,
  escalateAfterDays: 30,
  legalAfterDays: 30,
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type ChaseStage =
  | 'not_due'
  | 'not_started'
  | 'requested'
  | 'letter_delivered'
  | 'following_up'
  | 'promised'
  | 'promise_broken'
  | 'disputed'
  | 'escalated'
  | 'legal'
  | 'settled'
  | 'written_off';

export interface BrokenPromise {
  stepId: string;
  promisedDate: Date;
  promisedAmountSantim: number;
  daysLate: number;
  contactName: string;
}

export interface ChaseState {
  invoiceId: string;
  stage: ChaseStage;
  stageLabel: string;
  daysOverdue: number;
  /** Days since anyone on our side made contact. Null when nobody ever has. */
  daysSinceContact: number | null;
  lastContactAt: Date | null;
  /** A promise still in the future. */
  openPromise: { date: Date; amountSantim: number; contactName: string } | null;
  brokenPromises: BrokenPromise[];
  letterDelivered: boolean;
  contactAttempts: number;
  /** What to do next, and whether it is already late. */
  nextAction: ChaseAction | null;
  nextActionLabel: string;
  nextActionDueAt: Date | null;
  nextActionOverdue: boolean;
  /** One sentence explaining the recommendation. */
  reason: string;
}

const STAGE_LABEL: Record<ChaseStage, string> = {
  not_due: 'Not yet due',
  not_started: 'Nobody has chased it',
  requested: 'Payment requested',
  letter_delivered: 'Letter delivered',
  following_up: 'Following up',
  promised: 'Promised to pay',
  promise_broken: 'Promise broken',
  disputed: 'Disputed',
  escalated: 'Escalated',
  legal: 'With lawyers',
  settled: 'Settled',
  written_off: 'Written off',
};

/**
 * A promise is broken when its date has passed and not enough arrived AFTER it
 * was made.
 *
 * Judged on receipts dated after the promise, not on how much of the invoice has
 * ever been paid. A client who part-paid in March and then promised the rest in
 * August has not kept the August promise by virtue of the March payment — but
 * that is exactly what comparing against the running total would conclude, and
 * it would silently hide the broken promises on every part-paid invoice.
 *
 * Equally, it is judged on AMOUNT and not on reference: a client who promised
 * 400,000 and paid 400,000 has kept it whatever they wrote on the transfer, and
 * a system that demands the reference match will call honest clients liars.
 */
function classifyPromises(
  steps: readonly ChaseStep[],
  invoice: ChaseInvoice,
  asOf: Date,
): { open: ChaseState['openPromise']; broken: BrokenPromise[] } {
  const promises = steps
    .filter((s) => s.action === 'promise_to_pay' && s.promisedDate !== undefined)
    .sort((a, b) => (a.promisedDate as Date).getTime() - (b.promisedDate as Date).getTime());

  const broken: BrokenPromise[] = [];
  let open: ChaseState['openPromise'] = null;

  for (const promise of promises) {
    const date = promise.promisedDate as Date;
    const amount = promise.promisedAmountSantim ?? invoice.balanceSantim;

    if (date > asOf) {
      open = { date, amountSantim: amount, contactName: promise.contactName };
      continue;
    }

    // Settled is settled, whenever the money arrived.
    if (invoice.balanceSantim <= 0) continue;

    const paidSincePromise = invoice.receipts
      .filter((receipt) => receipt.at >= promise.at)
      .reduce((a, receipt) => a + receipt.amountSantim, 0);
    if (paidSincePromise >= amount) continue;

    broken.push({
      stepId: promise.id,
      promisedDate: date,
      promisedAmountSantim: amount,
      daysLate: daysBetween(date, asOf),
      contactName: promise.contactName,
    });
  }

  return { open, broken };
}

/**
 * How dates are written into the recommendation sentences.
 *
 * The library does not format dates itself. This app is dual-calendar, and a
 * sentence reading "by Thu Aug 20 2026" beside a page that everywhere else says
 * "14 Nehase 2018 EC (20 Aug 2026)" is the seam showing. The caller passes its
 * own formatter; the ISO default is for tests and for anything head-less.
 */
export type DateFormatter = (date: Date) => string;

const ISO: DateFormatter = (date) => date.toISOString().slice(0, 10);

export function chaseState(
  invoice: ChaseInvoice,
  steps: readonly ChaseStep[],
  asOf: Date,
  cadence: ChaseCadence = DEFAULT_CADENCE,
  formatDate: DateFormatter = ISO,
): ChaseState {
  const ordered = [...steps].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = ordered[ordered.length - 1] ?? null;
  const has = (action: ChaseAction) => ordered.some((s) => s.action === action);

  const daysOverdue = daysBetween(invoice.dueDate, asOf);
  const daysSinceContact = latest === null ? null : Math.max(0, daysBetween(latest.at, asOf));
  const { open, broken } = classifyPromises(ordered, invoice, asOf);

  const base = {
    invoiceId: invoice.id,
    daysOverdue,
    daysSinceContact,
    lastContactAt: latest?.at ?? null,
    openPromise: open,
    brokenPromises: broken,
    letterDelivered: has('letter_delivered'),
    contactAttempts: ordered.filter((s) => s.action === 'follow_up_call' || s.action === 'follow_up_visit').length,
  };

  const done = (stage: ChaseStage, reason: string): ChaseState => ({
    ...base,
    stage,
    stageLabel: STAGE_LABEL[stage],
    nextAction: null,
    nextActionLabel: 'Nothing to do',
    nextActionDueAt: null,
    nextActionOverdue: false,
    reason,
  });

  const next = (
    stage: ChaseStage,
    action: ChaseAction,
    dueAt: Date,
    reason: string,
  ): ChaseState => ({
    ...base,
    stage,
    stageLabel: STAGE_LABEL[stage],
    nextAction: action,
    nextActionLabel: chaseActionLabel(action),
    nextActionDueAt: dueAt,
    nextActionOverdue: dueAt <= asOf,
    reason,
  });

  // --- terminal states first -------------------------------------------------
  if (has('written_off')) return done('written_off', 'Written off. It no longer counts as collectable.');
  if (invoice.balanceSantim <= 0 || invoice.status === 'paid') {
    return done('settled', 'Settled in full.');
  }
  if (invoice.status === 'draft' || invoice.status === 'void') {
    return done('not_started', 'Not an issued invoice, so there is nothing to collect.');
  }

  // --- a dispute stops the chase --------------------------------------------
  // Chasing harder on a disputed invoice does not collect it; resolving the
  // dispute does, and every call before that damages the relationship.
  if (has('dispute_raised')) {
    return next(
      'disputed',
      'follow_up_call',
      asOf,
      'They are contesting this. Resolve the dispute — more demands will not collect a contested invoice.',
    );
  }

  // --- broken promise outranks everything except a dispute ------------------
  if (broken.length > 0) {
    const worst = broken[broken.length - 1] as BrokenPromise;
    if (has('legal_notice')) {
      return done('legal', 'With lawyers. Nothing further to do here.');
    }
    if (worst.daysLate >= cadence.legalAfterDays) {
      return next(
        'promise_broken',
        'legal_notice',
        new Date(worst.promisedDate.getTime() + cadence.legalAfterDays * 86_400_000),
        `${worst.contactName} promised ${formatETB(worst.promisedAmountSantim)} by ${formatDate(worst.promisedDate)} and it is ${worst.daysLate} days late. ${broken.length > 1 ? `That is ${broken.length} broken promises.` : ''} Legal notice is the next step.`.trim(),
      );
    }
    return next(
      'promise_broken',
      'escalation',
      worst.promisedDate,
      `${worst.contactName} promised ${formatETB(worst.promisedAmountSantim)} by ${formatDate(worst.promisedDate)} and it did not arrive. Go above them.`,
    );
  }

  // --- an open promise means wait, and that is a real answer ----------------
  if (open !== null) {
    return next(
      'promised',
      'follow_up_call',
      open.date,
      `${open.contactName} promised ${formatETB(open.amountSantim)} by ${formatDate(open.date)}. Wait until then, then call the same day if it has not arrived.`,
    );
  }

  if (has('legal_notice')) return done('legal', 'With lawyers. Nothing further to do here.');

  // --- the ordinary ladder ---------------------------------------------------
  if (!has('payment_request')) {
    const due = new Date(invoice.dueDate.getTime() + cadence.requestAfterDays * 86_400_000);
    return daysOverdue < 0 && cadence.requestAfterDays >= 0 && asOf < due
      ? { ...done('not_due', `Not due until ${formatDate(invoice.dueDate)}.`), nextAction: 'payment_request', nextActionLabel: chaseActionLabel('payment_request'), nextActionDueAt: due, nextActionOverdue: false }
      : next('not_started', 'payment_request', due, 'Nobody has asked for this money yet. That is the first step and it is free.');
  }

  const requestedAt = (ordered.find((s) => s.action === 'payment_request') as ChaseStep).at;

  if (!has('letter_delivered')) {
    const due = new Date(requestedAt.getTime() + cadence.letterAfterDays * 86_400_000);
    return next(
      'requested',
      'letter_delivered',
      due,
      'Asked but no formal letter yet. A delivered, stamped letter is what a finance department acts on and what any escalation later rests on.',
    );
  }

  const letterAt = (ordered.find((s) => s.action === 'letter_delivered') as ChaseStep).at;
  const sinceLetter = daysBetween(letterAt, asOf);

  if (sinceLetter >= cadence.escalateAfterDays) {
    return next(
      has('escalation') ? 'escalated' : 'letter_delivered',
      has('escalation') ? 'legal_notice' : 'escalation',
      new Date(letterAt.getTime() + cadence.escalateAfterDays * 86_400_000),
      has('escalation')
        ? `Escalated and still nothing after ${sinceLetter} days. Legal notice is what is left.`
        : `The letter was delivered ${sinceLetter} days ago and nothing has come of it. Go above the person handling it.`,
    );
  }

  const dueNext = new Date((latest?.at ?? letterAt).getTime() + cadence.followUpEveryDays * 86_400_000);
  return next(
    'following_up',
    'follow_up_call',
    dueNext,
    base.contactAttempts === 0
      ? 'Letter delivered. Call to confirm it reached the right desk — a letter in a registry is not a letter read.'
      : `${base.contactAttempts} follow-up${base.contactAttempts === 1 ? '' : 's'} so far. Keep the rhythm rather than the volume.`,
  );
}

// ---------------------------------------------------------------------------
// Across the ledger
// ---------------------------------------------------------------------------

export interface ChaseSummary {
  invoices: number;
  outstandingSantim: number;
  /** Nobody has asked for this money at all. */
  unchasedSantim: number;
  unchasedCount: number;
  /** A step is due or overdue today. */
  actionDueSantim: number;
  actionDueCount: number;
  promisedSantim: number;
  brokenPromiseSantim: number;
  brokenPromiseCount: number;
  disputedSantim: number;
  legalSantim: number;
  byStage: { stage: ChaseStage; label: string; count: number; santim: number }[];
}

export function summariseChase(
  rows: readonly { invoice: ChaseInvoice; state: ChaseState }[],
): ChaseSummary {
  const live = rows.filter((r) => r.state.stage !== 'settled' && r.state.stage !== 'written_off');
  const sum = (subset: typeof live) => subset.reduce((a, r) => a + r.invoice.balanceSantim, 0);

  const stages = new Map<ChaseStage, { count: number; santim: number }>();
  for (const row of live) {
    const entry = stages.get(row.state.stage) ?? { count: 0, santim: 0 };
    stages.set(row.state.stage, {
      count: entry.count + 1,
      santim: entry.santim + row.invoice.balanceSantim,
    });
  }

  const unchased = live.filter((r) => r.state.stage === 'not_started');
  const actionDue = live.filter((r) => r.state.nextActionOverdue);
  const broken = live.filter((r) => r.state.brokenPromises.length > 0);

  return {
    invoices: live.length,
    outstandingSantim: sum(live),
    unchasedSantim: sum(unchased),
    unchasedCount: unchased.length,
    actionDueSantim: sum(actionDue),
    actionDueCount: actionDue.length,
    promisedSantim: sum(live.filter((r) => r.state.openPromise !== null)),
    brokenPromiseSantim: sum(broken),
    brokenPromiseCount: broken.length,
    disputedSantim: sum(live.filter((r) => r.state.stage === 'disputed')),
    legalSantim: sum(live.filter((r) => r.state.stage === 'legal')),
    byStage: [...stages.entries()]
      .map(([stage, entry]) => ({ stage, label: STAGE_LABEL[stage], ...entry }))
      .sort((a, b) => b.santim - a.santim),
  };
}

/**
 * The chase list, most urgent first.
 *
 * Broken promises lead, then overdue actions by value. An unchased invoice
 * outranks a well-chased one of the same size: the cheapest collection action
 * available is the first one nobody has taken.
 */
export function sortChase<T extends { invoice: ChaseInvoice; state: ChaseState }>(rows: readonly T[]): T[] {
  const rank = (row: T): number => {
    if (row.state.stage === 'settled' || row.state.stage === 'written_off') return 9;
    if (row.state.brokenPromises.length > 0) return 0;
    if (row.state.stage === 'not_started') return 1;
    if (row.state.nextActionOverdue) return 2;
    if (row.state.stage === 'disputed') return 3;
    if (row.state.stage === 'promised') return 5;
    return 4;
  };

  return [...rows].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return b.invoice.balanceSantim - a.invoice.balanceSantim;
  });
}
