/**
 * Apply the payment history to contracts that are already in the app.
 *
 * WHY A SEPARATE PASS EXISTS AT ALL
 *   The importer writes a contract's payment schedule only when the contract is
 *   NEW. That rule is right: once a term has been invoiced against, rewriting
 *   the schedule detaches the invoice from the term it settled. But it means
 *   somebody who imported before the collection tracker was read gets "109
 *   contracts updated" and still no money, for ever, because their contracts are
 *   no longer new.
 *
 *   The alternative was to tell them to clear the database and start again,
 *   which throws away every correction made in the app since. So the money is
 *   applied on its own, to the terms that can safely take it.
 *
 * WHAT MAY BE TOUCHED, AND NOTHING ELSE
 *   A term that is still `pending` and carries no invoice. That is the whole
 *   rule. A term already `invoiced`, `paid`, `waived` or sitting ready with an
 *   invoice against it is somebody's bookkeeping and is left exactly as it is,
 *   counted, and reported.
 *
 *   So the pass cannot detach an invoice, cannot unpay a paid term, and cannot
 *   contradict a decision a person made in the app. Running it twice changes
 *   nothing the second time.
 *
 * WHY THE SCHEDULE IS COMPARED BEFORE ANYTHING IS WRITTEN
 *   The stored schedule was written from an earlier version of the workbook. If
 *   the terms have since been renamed, resequenced or renumbered, then "term 2
 *   is paid" no longer means the same term, and marking it would post money
 *   against the wrong stage of the wrong contract. Where the two no longer line
 *   up the contract is skipped and named, not guessed at.
 */

/** A payment term as it is stored. */
export interface StoredTerm {
  seq: number;
  name: string;
  grossSantim: number;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'paid' | 'waived';
  invoiceId?: string | undefined;
}

/** A payment term as the workbook describes it. */
export interface PlannedTerm {
  seq: number;
  name: string;
  paid: boolean;
}

export type TermVerdict =
  /** Still open and uninvoiced: the workbook's receipt can be recorded. */
  | 'settle'
  /** Invoiced, paid, or waived — somebody's bookkeeping. Left alone. */
  | 'protected'
  /** The workbook does not say this one was paid. */
  | 'leave';

/**
 * What to do with one term.
 *
 * Note the order: `protected` is decided BEFORE the workbook is consulted, so a
 * term that carries an invoice is never even a candidate — whatever the
 * spreadsheet says about it.
 */
export function verdictFor(stored: StoredTerm, planned: PlannedTerm): TermVerdict {
  const untouched =
    stored.status === 'pending' &&
    (stored.invoiceId === undefined || stored.invoiceId === null || stored.invoiceId === '');
  if (!untouched) return 'protected';
  return planned.paid ? 'settle' : 'leave';
}

/**
 * Do the stored terms still describe the same schedule as the workbook?
 *
 * Compared on count, sequence and name. Not on amount: a contract value may have
 * been corrected in the app, which changes every amount without changing which
 * term is which, and refusing those would refuse most of them for no gain.
 */
export function scheduleMatches(
  stored: readonly StoredTerm[],
  planned: readonly PlannedTerm[],
): boolean {
  if (stored.length !== planned.length || stored.length === 0) return false;
  const bySeq = new Map(stored.map((term) => [term.seq, term]));
  return planned.every((term) => {
    const found = bySeq.get(term.seq);
    return found !== undefined && found.name.trim() === term.name.trim();
  });
}

export interface PaymentBackfillResult {
  /** Contracts the workbook had a payment history for. */
  examined: number;
  /** Contracts where at least one term was recorded as settled. */
  updated: number;
  termsSettled: number;
  santimSettled: number;
  /** Terms left alone because they are invoiced, paid or waived. */
  termsProtected: number;
  /** Contracts in the workbook that are not in the app yet. */
  notInApp: string[];
  /** Contracts whose stored schedule no longer lines up with the workbook. */
  scheduleChanged: string[];
  /** Contracts that already had every settled term recorded. */
  alreadyDone: number;
}

/** The sentence at the end. Says what was left as plainly as what was done. */
export function describePaymentBackfill(result: PaymentBackfillResult): string {
  if (result.examined === 0) {
    return 'This workbook carries no payment history, so there was nothing to apply.';
  }
  if (result.termsSettled === 0) {
    const reason =
      result.alreadyDone > 0
        ? 'Every payment the workbook records was already recorded here.'
        : 'None of the terms could be updated — see below.';
    return `Nothing changed. ${reason}`;
  }
  const money = (result.santimSettled / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    `${result.termsSettled} payment term${result.termsSettled === 1 ? '' : 's'} ` +
    `recorded as settled across ${result.updated} contract${result.updated === 1 ? '' : 's'}, ` +
    `worth ETB ${money}.`
  );
}
