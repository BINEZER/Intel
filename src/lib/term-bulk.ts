/**
 * Dating many payment terms at once.
 *
 * WHY THIS EXISTS
 *   A date is what makes a payment term visible to the ready-to-invoice nudge and
 *   the cash forecast, and an imported book has hundreds of terms with none.
 *   Dating them one at a time is correct and unbearable. This works out, from a
 *   selection and a choice, the date each one gets — nothing is written here.
 *
 * TWO CHOICES, BECAUSE THERE ARE TWO REAL CASES
 *   SAME DATE   — "these are all due on 1 November".
 *   SPREAD      — "the first falls due on 1 November, then one a month". Applied
 *                 per CONTRACT in the order the terms are paid (their sequence
 *                 number), because a schedule's second term is not due before its
 *                 first, and spreading across contracts would date one client's
 *                 advance a month after another client's retention.
 */

import { addMonthsUtc } from './lifecycle.js';
import { termScheduleRights } from './milestones.js';

export interface BulkTerm {
  contractId: string;
  termId: string;
  seq: number;
  name: string;
  status: string;
  grossSantim: number;
  dueDate: Date | null;
}

export type BulkMode =
  | { kind: 'same'; date: Date }
  | { kind: 'spread'; first: Date; gapMonths: number };

export interface BulkChange {
  contractId: string;
  termId: string;
  dueDate: Date;
}

/**
 * The date each selected term would get.
 *
 * Terms that may not be re-dated (paid or waived) are left out rather than
 * refused, so a selection that happens to include one does not fail as a whole.
 * Contracts are kept together and, within one, terms run in sequence order.
 */
export function planDates(terms: readonly BulkTerm[], mode: BulkMode): BulkChange[] {
  const gap = mode.kind === 'spread' ? Math.max(0, Math.floor(mode.gapMonths)) : 0;
  const byContract = new Map<string, BulkTerm[]>();
  for (const term of terms) {
    if (!termScheduleRights(term.status).date) continue;
    byContract.set(term.contractId, [...(byContract.get(term.contractId) ?? []), term]);
  }

  const out: BulkChange[] = [];
  for (const [contractId, group] of [...byContract].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...group].sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
    ordered.forEach((term, index) => {
      out.push({
        contractId,
        termId: term.termId,
        dueDate: mode.kind === 'same' ? mode.date : addMonthsUtc(mode.first, index * gap),
      });
    });
  }
  return out;
}

const OPEN = new Set(['pending', 'ready_to_invoice']);

/**
 * How many of these new dates have already come — and so would make the term
 * "ready to invoice" the moment it is saved — and what they are worth.
 *
 * This is the consequence people do not expect. Dating an unbilled term in the
 * past is a statement that it is due and has not been billed. If it was in fact
 * billed or paid outside the app, that is a false alarm on the list; the date
 * form says so before it is saved.
 */
export function flaggedByPastDate(
  changes: readonly BulkChange[],
  terms: readonly BulkTerm[],
  asOf: Date,
): { count: number; santim: number } {
  const byId = new Map(terms.map((t) => [t.termId, t]));
  let count = 0;
  let santim = 0;
  for (const change of changes) {
    const term = byId.get(change.termId);
    if (term === undefined || !OPEN.has(term.status)) continue;
    if (change.dueDate.getTime() > asOf.getTime()) continue;
    count += 1;
    santim += term.grossSantim;
  }
  return { count, santim };
}

/** What the plan does, in one line, for the confirm button's neighbour. */
export function describePlan(changes: readonly BulkChange[]): string {
  if (changes.length === 0) return 'Nothing to date.';
  const contracts = new Set(changes.map((c) => c.contractId)).size;
  return `${changes.length} term${changes.length === 1 ? '' : 's'} on ${contracts} contract${contracts === 1 ? '' : 's'}.`;
}
