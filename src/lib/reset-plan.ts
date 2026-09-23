/**
 * What "start from scratch" actually covers, and what it cannot.
 *
 * WHY THIS IS NOT SIMPLY "DELETE EVERYTHING"
 *   The security rules refuse some deletes outright, on purpose. A technician
 *   is deactivated rather than deleted so the KPI history survives; an issued
 *   invoice and a paid voucher are financial records; the audit log is
 *   append-only, and a wipe is exactly the event you would later want it to
 *   have recorded.
 *
 *   Those guards are right for every ordinary day and inconvenient for exactly
 *   one operation. Rather than weaken them, the reset clears what it is allowed
 *   to clear and REPORTS the rest by name. A tool that silently leaves records
 *   behind is worse than one that says which and why.
 *
 * THE ORDER MATTERS
 *   Children before parents. Deleting a contract first would leave its
 *   milestones orphaned in a subcollection nothing points at, still costing
 *   storage and still turning up in a collection-group query.
 */

/** One collection the reset walks. */
export interface ResetTarget {
  path: string;
  /** What a person calls the records in it. */
  label: string;
  /** Subcollections to clear before the parent document goes. */
  subcollections?: readonly string[];
  /** Set where the rules will refuse some or all of them, and why. */
  guard?: string;
}

/**
 * Every collection holding data somebody entered, children first.
 *
 * `config` is absent deliberately: the VAT rate, the KPI targets and the
 * withholding rates are settings, not input. Starting from scratch should not
 * mean setting the tax rate up again.
 *
 * `users` is absent for a blunter reason: deleting the accounts would lock
 * everybody out of the app they just reset.
 */
export const RESET_TARGETS: readonly ResetTarget[] = [
  { path: 'tasks', label: 'Board cards' },
  { path: 'boards', label: 'Boards' },
  {
    path: 'maintenanceVisits',
    label: 'Maintenance visits',
    guard: 'Visits already carried out are kept — they are the service history.',
  },
  {
    path: 'callouts',
    label: 'Callouts',
    guard: 'Callouts already resolved are kept — they are the evidence behind response times.',
  },
  {
    path: 'disbursements',
    label: 'Payment vouchers',
    guard: 'Vouchers past draft are kept — a paid voucher is a financial record.',
  },
  {
    path: 'invoices',
    label: 'Invoices',
    subcollections: ['receipts', 'collectionSteps'],
    guard: 'Invoices past draft are kept — an issued invoice is a legal document.',
  },
  { path: 'projectAssignments', label: 'Crew assignments' },
  { path: 'units', label: 'Lifts' },
  { path: 'projects', label: 'Projects', subcollections: ['phases'] },
  { path: 'programs', label: 'Programs' },
  { path: 'contracts', label: 'Contracts', subcollections: ['milestones'] },
  { path: 'clients', label: 'Clients' },
  { path: 'subcontractors', label: 'Subcontractors' },
  {
    path: 'technicians',
    label: 'Technicians',
    subcollections: ['kpiSnapshots'],
    guard: 'Technicians are never deleted — they are deactivated so their KPI history survives.',
  },
];

/** What happened to one collection. */
export interface ResetOutcome {
  path: string;
  label: string;
  found: number;
  deleted: number;
  /** Records the rules would not let go, and why. */
  kept: number;
  reason: string | null;
}

export interface ResetReport {
  outcomes: ResetOutcome[];
  deleted: number;
  kept: number;
}

/** Roll the per-collection outcomes into the two numbers that matter. */
export function summariseReset(outcomes: readonly ResetOutcome[]): ResetReport {
  return {
    outcomes: [...outcomes],
    deleted: outcomes.reduce((sum, o) => sum + o.deleted, 0),
    kept: outcomes.reduce((sum, o) => sum + o.kept, 0),
  };
}

/**
 * The sentence at the end.
 *
 * Says what is left as plainly as what went, because "reset complete" over a
 * database that still holds nine technicians is the kind of half-truth that
 * costs an afternoon later.
 */
export function describeReset(report: ResetReport): string {
  if (report.deleted === 0 && report.kept === 0) return 'There was nothing to delete.';
  if (report.kept === 0) {
    return `${report.deleted} record${report.deleted === 1 ? '' : 's'} deleted. Nothing is left.`;
  }
  return (
    `${report.deleted} record${report.deleted === 1 ? '' : 's'} deleted. ` +
    `${report.kept} could not be removed and ${report.kept === 1 ? 'is' : 'are'} listed below with the reason.`
  );
}

/** The collections that actually kept something, for the report. */
export function keptOutcomes(report: ResetReport): ResetOutcome[] {
  return report.outcomes.filter((o) => o.kept > 0);
}
