/**
 * Maintenance agreements: priced by the month, run for a term, billed monthly.
 *
 * WHY THIS IS NOT JUST A CONTRACT WITH A SMALL VALUE
 *   An installation is a lump sum paid in stages as the work is done. A service
 *   agreement is the opposite shape: the figure that was negotiated is the
 *   MONTHLY fee, the term is usually a year, and the money arrives one month at
 *   a time. Entering it as a lump sum with a ten-stage installation schedule
 *   gets every one of those wrong at once, so this file is the one place that
 *   works from the fee outward.
 *
 *   The contract still stores the whole-term value (`valueNetSantim`) because
 *   every report, receivable and tax figure reads that field. The monthly fee is
 *   kept beside it (`serviceFee`) as the number people actually agreed.
 */

import { addMonthsUtc } from './lifecycle.js';
import { allocateMilestones, equalShares, type AllocatedMilestone } from './milestones.js';
import { addVat, extractVat, formatETB, type VatBreakdown } from './money.js';

/** "Usually for 1 year" — the proposal, never a rule. */
export const DEFAULT_SERVICE_TERM_MONTHS = 12;

/**
 * Whole months between two dates, to the nearest month, never less than one.
 *
 * An agreement from 1 January to 1 January is twelve months; one from the 1st
 * to the 31st of the month is one. Counting days and dividing would call a year
 * running 1 Jan to 31 Dec "11.97 months" and bill eleven or twelve depending on
 * which way it rounds.
 */
export function wholeMonthsBetween(start: Date, end: Date): number {
  const months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (end.getUTCMonth() - start.getUTCMonth());
  const days = end.getUTCDate() - start.getUTCDate();
  const rounded = days >= 15 ? months + 1 : days <= -15 ? months - 1 : months;
  return Math.max(1, rounded);
}

export interface ServiceFeeFigures {
  monthly: VatBreakdown;
  months: number;
  /** The whole term — what goes on the contract as its value. */
  term: VatBreakdown;
}

/**
 * Work the figures out from the monthly fee.
 *
 * `feeEntered` is what was typed. Where the client agreed an all-in figure the
 * net is backed out of it first and the term is built from that net, so the
 * monthly VAT line and the term VAT line are both derived the same way.
 */
export function serviceFeeFigures(
  feeEntered: number,
  months: number,
  vatRateBps: number,
  enteredInclusive = false,
): ServiceFeeFigures {
  if (!Number.isInteger(months) || months < 1) {
    throw new RangeError(`A service agreement runs for at least one month, got ${months}`);
  }
  const monthly = enteredInclusive ? extractVat(feeEntered, vatRateBps) : addVat(feeEntered, vatRateBps);
  return { monthly, months, term: addVat(monthly.netSantim * months, vatRateBps) };
}

export interface MonthlyTerm extends AllocatedMilestone {
  dueDate: Date;
}

/**
 * One payment term per month, each falling due a month after the one before.
 *
 * The first falls due a month after the start, i.e. billing in arrears — the
 * convention the conversion from an installation contract already used.
 */
export function monthlyTerms(startsOn: Date, months: number, term: VatBreakdown): MonthlyTerm[] {
  const shares = equalShares(
    months,
    Array.from({ length: months }, (_, index) => `Month ${index + 1}`),
  );
  return allocateMilestones(term, shares).map((milestone, index) => ({
    ...milestone,
    dueDate: addMonthsUtc(startsOn, index + 1),
  }));
}

/** The default end: a year (or whatever the term is) after the start. */
export function serviceEnd(startsOn: Date, months = DEFAULT_SERVICE_TERM_MONTHS): Date {
  return addMonthsUtc(startsOn, months);
}

/** Fee per lift per month, or null where the lift count is not known. */
export function feePerLift(monthlyNetSantim: number, unitCount: number): number | null {
  return unitCount > 0 ? Math.round(monthlyNetSantim / unitCount) : null;
}

/** A one-line summary for lists: "ETB 8,500 a month · 2 lifts". */
export function describeFee(
  fee: { monthlyNetSantim: number; unitCount: number } | undefined,
  months?: number,
): string | null {
  if (fee === undefined) return null;
  const parts = [`${formatETB(fee.monthlyNetSantim)} a month`];
  if (months !== undefined) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  if (fee.unitCount > 0) parts.push(`${fee.unitCount} lift${fee.unitCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export interface TermLike {
  status: string;
  grossSantim: number;
  receivedGrossSantim?: number | undefined;
}

/**
 * What is still owed on a contract's payment terms.
 *
 * Used before an installation contract hands over to a service agreement: the
 * agreement does not replace those payments, so somebody should see them before
 * they walk away from the old contract. Waived terms are not owed.
 */
export function outstandingOn(terms: readonly TermLike[]): { count: number; santim: number } {
  let count = 0;
  let santim = 0;
  for (const term of terms) {
    if (term.status === 'paid' || term.status === 'waived') continue;
    count += 1;
    santim += Math.max(0, term.grossSantim - (term.receivedGrossSantim ?? 0));
  }
  return { count, santim };
}

// ---------------------------------------------------------------------------
// Renewal
// ---------------------------------------------------------------------------

/**
 * The number of the agreement that follows this one: `C-1-SVC` becomes
 * `C-1-SVC-R1`, and that becomes `C-1-SVC-R2`.
 *
 * The suffix is counted rather than appended, so the fifth renewal reads `-R5`
 * and not `-R1-R1-R1-R1-R1`.
 */
export function nextAgreementNo(contractNo: string): string {
  const match = /^(.*)-R(\d+)$/.exec(contractNo);
  return match === null ? `${contractNo}-R1` : `${match[1] as string}-R${Number(match[2]) + 1}`;
}

export interface RenewableContract {
  type: string;
  status: string;
  renewedIntoContractId?: string | null | undefined;
}

/**
 * May this agreement be renewed?
 *
 * Only a maintenance agreement that is running, or has just run out, and has not
 * already been renewed — renewing twice would leave two live agreements for the
 * same lifts, each billing a month at a time.
 */
export function canRenew(contract: RenewableContract): boolean {
  return (
    contract.type === 'maintenance' &&
    (contract.status === 'active' || contract.status === 'expired') &&
    (contract.renewedIntoContractId === undefined ||
      contract.renewedIntoContractId === null ||
      contract.renewedIntoContractId === '')
  );
}
