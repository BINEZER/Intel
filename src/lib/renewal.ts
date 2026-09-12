/**
 * Maintenance contract renewal windows and SLA snapshots.
 *
 * The renewal alert is the difference between a contract that rolls over and one
 * that lapses because nobody looked. It is precomputed as a timestamp on the
 * contract (`renewalAlertAt = endDate − renewalWindowDays`) so the alert query
 * is a single indexed range filter rather than a scan over every contract
 * recomputing dates.
 */

import { daysBetween } from './kpi.js';

export type RenewalStatus = 'not_due' | 'due' | 'in_negotiation' | 'renewed' | 'lapsed';

/** Statuses a human sets, which the automatic derivation must not overwrite. */
const MANUAL_STATUSES: readonly RenewalStatus[] = ['in_negotiation', 'renewed'];

export interface RenewalInput {
  endDate: Date;
  renewalWindowDays: number;
  /** What is currently stored, so a human decision is respected. */
  storedStatus: RenewalStatus;
  contractStatus: 'draft' | 'active' | 'suspended' | 'completed' | 'terminated' | 'expired';
}

/**
 * The instant the renewal alert should start firing.
 * Returns null for a contract with no end date to work back from.
 */
export function renewalAlertAt(endDate: Date | null, renewalWindowDays: number): Date | null {
  if (endDate === null) return null;
  if (!Number.isInteger(renewalWindowDays) || renewalWindowDays < 0) {
    throw new RangeError(`Renewal window must be a non-negative whole number of days, got ${renewalWindowDays}`);
  }
  return new Date(endDate.getTime() - renewalWindowDays * 86_400_000);
}

/**
 * Derive the renewal status.
 *
 * A status a person set — in negotiation, or renewed — is never overwritten by
 * the automatic pass. Sales knows something the calendar does not, and a nightly
 * job silently resetting their work would make the field useless.
 */
export function deriveRenewalStatus(input: RenewalInput, asOf: Date): RenewalStatus {
  if (MANUAL_STATUSES.includes(input.storedStatus)) return input.storedStatus;
  if (input.contractStatus === 'terminated' || input.contractStatus === 'completed') {
    return input.storedStatus;
  }

  const alertAt = renewalAlertAt(input.endDate, input.renewalWindowDays);
  if (alertAt === null) return 'not_due';

  if (asOf > input.endDate) return 'lapsed';
  if (asOf >= alertAt) return 'due';
  return 'not_due';
}

export interface RenewalView {
  daysUntilExpiry: number;
  /** Negative once expired. */
  inWindow: boolean;
  status: RenewalStatus;
  /** Buckets for the renewal board. */
  bucket: 'lapsed' | 'within_30' | 'within_60' | 'within_90' | 'later';
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

export function renewalView(input: RenewalInput, asOf: Date): RenewalView {
  const daysUntilExpiry = daysBetween(asOf, input.endDate);
  const alertAt = renewalAlertAt(input.endDate, input.renewalWindowDays);
  const status = deriveRenewalStatus(input, asOf);

  const bucket: RenewalView['bucket'] =
    daysUntilExpiry < 0
      ? 'lapsed'
      : daysUntilExpiry <= 30
        ? 'within_30'
        : daysUntilExpiry <= 60
          ? 'within_60'
          : daysUntilExpiry <= 90
            ? 'within_90'
            : 'later';

  // A contract already renewed or under negotiation is not urgent, whatever the
  // calendar says — someone is on it.
  const handled = status === 'renewed' || status === 'in_negotiation';

  const urgency: RenewalView['urgency'] = handled
    ? 'low'
    : bucket === 'lapsed'
      ? 'critical'
      : bucket === 'within_30'
        ? 'high'
        : bucket === 'within_60'
          ? 'medium'
          : 'low';

  return {
    daysUntilExpiry,
    inWindow: alertAt !== null && asOf >= alertAt,
    status,
    bucket,
    urgency,
  };
}

/** Order a renewal board: soonest expiry first, handled contracts last. */
export function sortByUrgency<T extends { renewal: RenewalView }>(rows: readonly T[]): T[] {
  const rank: Record<RenewalView['urgency'], number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...rows].sort(
    (a, b) =>
      rank[a.renewal.urgency] - rank[b.renewal.urgency] ||
      a.renewal.daysUntilExpiry - b.renewal.daysUntilExpiry,
  );
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

export interface ContractSla {
  responseHours: number;
  resolutionHours: number;
  preventiveVisitsPerYear: number;
}

/**
 * Snapshot a contract's SLA onto a callout, in minutes.
 *
 * Callouts store the SLA they were logged under, not a reference to the
 * contract, so a later renegotiation cannot retroactively rewrite whether a past
 * callout breached. This is what makes historical SLA compliance defensible.
 */
export function snapshotSla(sla: ContractSla | null | undefined): {
  slaResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
} {
  if (sla === null || sla === undefined) {
    return { slaResponseMinutes: null, slaResolutionMinutes: null };
  }
  return {
    slaResponseMinutes: Math.round(sla.responseHours * 60),
    slaResolutionMinutes: Math.round(sla.resolutionHours * 60),
  };
}

/**
 * How many preventive visits the contract owes across a period, pro-rated.
 * Used to seed the maintenance schedule and to judge PM compliance fairly on a
 * contract that started mid-year.
 */
export function visitsDueInPeriod(
  visitsPerYear: number,
  periodStart: Date,
  periodEnd: Date,
  contractStart: Date,
  contractEnd: Date,
): number {
  const from = Math.max(periodStart.getTime(), contractStart.getTime());
  const to = Math.min(periodEnd.getTime(), contractEnd.getTime());
  if (to <= from) return 0;
  const days = (to - from) / 86_400_000;
  return Math.round((visitsPerYear * days) / 365);
}
