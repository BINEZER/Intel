/**
 * Payment milestone arithmetic.
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE
 *
 *   Split ETB 1,000,000 three ways and the honest shares are 33.33%, 33.33%,
 *   33.34%. Round each independently and the parts come to 999,999.99 or
 *   1,000,000.01 — and now the milestones do not add up to the contract.
 *
 *   Nobody notices until a client queries the final invoice, or a VAT return is
 *   off by a santim. So allocation is done by the LARGEST REMAINDER method: every
 *   part is a whole santim, and the parts sum EXACTLY to the total, always.
 *
 * Net and VAT are allocated separately with the same shares, so each milestone's
 * net + vat = gross, and the milestones' totals equal the contract's exactly.
 */

import { addVat, type VatBreakdown } from './money.js';

export interface MilestoneShare {
  name: string;
  /** Share of contract value in basis points. All shares must sum to 10000. */
  shareBps: number;
  /** Phase whose completion unlocks this milestone. */
  phaseId?: string | undefined;
}

export interface AllocatedMilestone extends MilestoneShare {
  seq: number;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
}

export class MilestoneShareError extends Error {
  constructor(message: string, readonly totalBps: number) {
    super(message);
    this.name = 'MilestoneShareError';
  }
}

/**
 * Shares must sum to exactly 100%. A contract whose milestones cover 95% is a
 * contract with 5% nobody will ever invoice.
 */
export function assertSharesValid(shares: readonly MilestoneShare[]): void {
  if (shares.length === 0) {
    throw new MilestoneShareError('A contract needs at least one payment milestone.', 0);
  }
  for (const share of shares) {
    if (!Number.isInteger(share.shareBps) || share.shareBps <= 0) {
      throw new MilestoneShareError(
        `Milestone '${share.name}' must have a positive whole-basis-point share, got ${share.shareBps}.`,
        share.shareBps,
      );
    }
  }
  const total = shares.reduce((a, s) => a + s.shareBps, 0);
  if (total !== 10_000) {
    throw new MilestoneShareError(
      `Milestone shares must sum to 100% (10000 bps), got ${(total / 100).toFixed(2)}%.`,
      total,
    );
  }
}

/** Non-throwing form, for live form validation. */
export function validateShares(shares: readonly MilestoneShare[]): { ok: true } | { ok: false; error: string; totalBps: number } {
  try {
    assertSharesValid(shares);
    return { ok: true };
  } catch (error) {
    if (error instanceof MilestoneShareError) {
      return { ok: false, error: error.message, totalBps: error.totalBps };
    }
    throw error;
  }
}

/**
 * Split `total` across `shares` so that every part is a whole santim and the
 * parts sum to exactly `total`.
 *
 * Largest remainder (Hamilton): floor every part, then hand the leftover santim
 * one at a time to the parts with the largest discarded fraction. Any other
 * approach either loses santim or dumps the whole rounding error on one
 * milestone.
 */
export function allocateByShares(total: number, shares: readonly number[]): number[] {
  if (!Number.isInteger(total)) {
    throw new TypeError(`Total must be an integer count of santim, got ${total}`);
  }
  if (shares.length === 0) return [];

  const shareTotal = shares.reduce((a, b) => a + b, 0);
  if (shareTotal === 0) return shares.map(() => 0);

  // Work on magnitude so a credit note (negative total) allocates the same way.
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const exact = shares.map((share) => (magnitude * share) / shareTotal);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = magnitude - floors.reduce((a, b) => a + b, 0);

  // Order by discarded fraction, descending; ties go to the earlier milestone so
  // the result is deterministic rather than dependent on sort stability.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const allocated = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    allocated[index] = (allocated[index] as number) + 1;
    remainder -= 1;
  }

  return allocated.map((value) => value * sign);
}

/**
 * Turn a contract value and a set of shares into milestones whose net, VAT and
 * gross each sum exactly to the contract's.
 */
export function allocateMilestones(
  contract: VatBreakdown,
  shares: readonly MilestoneShare[],
): AllocatedMilestone[] {
  assertSharesValid(shares);

  const shareBps = shares.map((s) => s.shareBps);
  const nets = allocateByShares(contract.netSantim, shareBps);
  // VAT is allocated from the contract's VAT total rather than recomputed per
  // milestone, so the milestones' VAT sums to the VAT actually on the contract.
  const vats = allocateByShares(contract.vatSantim, shareBps);

  return shares.map((share, index) => {
    const netSantim = nets[index] as number;
    const vatSantim = vats[index] as number;
    return {
      ...share,
      seq: index + 1,
      netSantim,
      vatSantim,
      grossSantim: netSantim + vatSantim,
    };
  });
}

/** Convenience for a VAT-exclusive contract value. */
export function allocateFromNet(
  netSantim: number,
  shares: readonly MilestoneShare[],
  vatRateBps?: number,
): AllocatedMilestone[] {
  return allocateMilestones(addVat(netSantim, vatRateBps), shares);
}

/** Totals, for asserting a milestone set still reconciles to its contract. */
export function milestoneTotals(milestones: readonly AllocatedMilestone[]) {
  return {
    netSantim: milestones.reduce((a, m) => a + m.netSantim, 0),
    vatSantim: milestones.reduce((a, m) => a + m.vatSantim, 0),
    grossSantim: milestones.reduce((a, m) => a + m.grossSantim, 0),
    shareBps: milestones.reduce((a, m) => a + m.shareBps, 0),
  };
}

/** The standard supply-and-install schedule, as a starting point in the form. */
export const DEFAULT_SUPPLY_INSTALL_SHARES: MilestoneShare[] = [
  { name: 'Advance on signing', shareBps: 5000 },
  { name: 'On delivery to site', shareBps: 3000 },
  { name: 'On completion of installation', shareBps: 1000 },
  { name: 'On handover and certification', shareBps: 1000 },
];

/** Maintenance contracts are usually billed in equal periods. */
export function equalShares(count: number, names?: readonly string[]): MilestoneShare[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Milestone count must be a positive integer, got ${count}`);
  }
  // Same largest-remainder trick on the shares themselves, so they sum to 10000.
  const allocated = allocateByShares(10_000, Array.from({ length: count }, () => 1));
  return allocated.map((shareBps, index) => ({
    name: names?.[index] ?? `Payment ${index + 1}`,
    shareBps,
  }));
}

// ---------------------------------------------------------------------------
// Scheduling a term after the contract exists
// ---------------------------------------------------------------------------

export interface TermScheduleRights {
  /** The date it falls due may be set or cleared. */
  date: boolean;
  /** The stage whose completion releases it may be chosen. */
  stage: boolean;
  /** Why not, in a sentence, where neither may be changed. */
  reason: string | null;
}

/**
 * What may still be changed about a payment term.
 *
 * A term somebody has not yet billed can be scheduled freely: a date and a stage
 * are what make it show up as ready to invoice, and are the whole point of being
 * able to set them. A term already billed keeps its date editable (a client may
 * agree a later date) but a stage means nothing to it any more — the work was
 * done, the invoice is out. A settled term is history and is not touched.
 */
export function termScheduleRights(status: string): TermScheduleRights {
  switch (status) {
    case 'pending':
    case 'ready_to_invoice':
      return { date: true, stage: true, reason: null };
    case 'invoiced':
    case 'part_paid':
      return { date: true, stage: false, reason: null };
    default:
      return {
        date: false,
        stage: false,
        reason: status === 'waived' ? 'This term was waived.' : 'This term has been paid.',
      };
  }
}
