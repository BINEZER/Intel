/**
 * What "start from scratch" covers.
 *
 * IT REALLY DOES CLEAR EVERYTHING
 *   Every record somebody entered or imported goes, including the ones the
 *   everyday delete button refuses: a technician, an issued invoice, a paid
 *   voucher, a callout already resolved. Those refusals live in
 *   `lib/deletion.ts`, where they belong — they are judgements about whether
 *   deleting one record makes sense, and they can explain themselves. Clearing
 *   the whole database is a different act, taken deliberately and confirmed by
 *   typing a word.
 *
 * TWO THINGS SURVIVE ON PURPOSE
 *   The user accounts, because deleting them would lock everybody out of the
 *   app they just reset. And the audit log, because a wipe is precisely the
 *   event you would later want it to have recorded.
 *
 * REFUSALS ARE STILL REPORTED, NOT ASSUMED AWAY
 *   If a rule ever does refuse something, the pass counts it and names the
 *   reason rather than reporting a clean sweep. A tool that silently leaves
 *   records behind is worse than one that says which and why.
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
  /**
   * Why a record here might be refused, if one ever is. Not expected — the
   * reset is allowed to clear every collection listed — but a refusal has to
   * arrive with an explanation rather than as a silent shortfall.
   */
  guard?: string;
}

/**
 * Every collection holding data somebody entered, children first.
 *
 * `config` is absent deliberately: the VAT rate, the KPI targets and the
 * withholding rates are settings, not input. Starting from scratch should not
 * mean setting the tax rate up again.
 *
 * `users` and `auditLogs` are absent for the reasons in the header.
 */
export const RESET_TARGETS: readonly ResetTarget[] = [
  { path: 'tasks', label: 'Board cards' },
  { path: 'boards', label: 'Boards' },
  { path: 'maintenanceVisits', label: 'Maintenance visits' },
  { path: 'callouts', label: 'Callouts' },
  { path: 'disbursements', label: 'Payment vouchers' },
  { path: 'invoices', label: 'Invoices', subcollections: ['receipts', 'collectionSteps'] },
  { path: 'projectAssignments', label: 'Crew assignments' },
  { path: 'units', label: 'Lifts' },
  { path: 'projects', label: 'Projects', subcollections: ['phases'] },
  { path: 'programs', label: 'Programs' },
  { path: 'contracts', label: 'Contracts', subcollections: ['milestones'] },
  { path: 'clients', label: 'Clients' },
  { path: 'subcontractors', label: 'Subcontractors' },
  { path: 'technicians', label: 'Technicians', subcollections: ['kpiSnapshots'] },
  // Last, and the reason it is here at all: numbering restarts. Leaving the
  // counters would have the first invoice of an empty database numbered 0042.
  { path: 'counters', label: 'Document numbering' },
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
