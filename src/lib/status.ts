/**
 * The status vocabulary for clients, contracts and projects.
 *
 * WHY THIS IS ONE FILE
 *   A status is three things at once: a stored value, the words a person reads,
 *   and a colour. Spread across the pages, they drift — the same value ends up
 *   labelled "On hold" in one list and "Paused" in another, and a status added
 *   to the schema never reaches the form that would let anyone set it. Keeping
 *   them together means adding a status is one edit, and the form, the chip and
 *   the filter all learn about it at once.
 *
 * WHY THE HINTS
 *   "Cancelled" and "Terminated" are not the same thing and the difference
 *   costs money: one job never started, the other stopped after work was done
 *   and may owe somebody for what was built. A dropdown of bare words invites
 *   the wrong pick, so every option carries the sentence that distinguishes it.
 */

/** How a status should read at a glance: is this job fine, stuck, or over? */
export type StatusTone = 'good' | 'warn' | 'bad' | 'idle';

export interface StatusOption<T extends string = string> {
  value: T;
  label: string;
  /** The one sentence that tells this status apart from its neighbours. */
  hint: string;
  tone: StatusTone;
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export type ClientStatus = 'prospect' | 'active' | 'on_hold' | 'inactive';

export const CLIENT_STATUSES: StatusOption<ClientStatus>[] = [
  {
    value: 'prospect',
    label: 'Prospect',
    hint: 'Quoted or in discussion, nothing signed yet.',
    tone: 'idle',
  },
  {
    value: 'active',
    label: 'Active',
    hint: 'Trading with us now — signed work, or a live service contract.',
    tone: 'good',
  },
  {
    value: 'on_hold',
    label: 'On hold',
    hint: 'Work paused, a dispute open, or payment stopped. Still a client.',
    tone: 'warn',
  },
  {
    value: 'inactive',
    label: 'Inactive',
    hint: 'No longer trading with us. Kept for the history.',
    tone: 'idle',
  },
];

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

export type ContractStatusValue =
  | 'draft'
  | 'active'
  | 'suspended'
  | 'completed'
  | 'terminated'
  | 'expired';

export const CONTRACT_STATUSES: StatusOption<ContractStatusValue>[] = [
  {
    value: 'draft',
    label: 'Draft',
    hint: 'Being prepared. Not signed, and nothing may be invoiced against it.',
    tone: 'idle',
  },
  {
    value: 'active',
    label: 'Active',
    hint: 'Signed and running. This is the only status that raises renewal alerts.',
    tone: 'good',
  },
  {
    value: 'suspended',
    label: 'Suspended',
    hint: 'Signed but stopped for now — a dispute, a site closure, unpaid advance.',
    tone: 'warn',
  },
  {
    value: 'completed',
    label: 'Completed',
    hint: 'Delivered in full and closed out. Nothing further is owed either way.',
    tone: 'good',
  },
  {
    value: 'terminated',
    label: 'Terminated',
    hint: 'Ended early by one side. Work may have been done that still needs settling.',
    tone: 'bad',
  },
  {
    value: 'expired',
    label: 'Expired',
    hint: 'Ran past its end date without being renewed or closed out.',
    tone: 'warn',
  },
];

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type ProjectStatusValue =
  | 'planned'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'cancelled'
  | 'terminated';

export const PROJECT_STATUSES: StatusOption<ProjectStatusValue>[] = [
  {
    value: 'planned',
    label: 'Planned',
    hint: 'Scheduled but not started on site.',
    tone: 'idle',
  },
  {
    value: 'in_progress',
    label: 'In progress',
    hint: 'Work is running. Counted as a live job everywhere in the app.',
    tone: 'good',
  },
  {
    value: 'on_hold',
    label: 'Paused',
    hint: 'Started, then stopped — waiting on the client, a part, or a payment. Expected to resume.',
    tone: 'warn',
  },
  {
    value: 'completed',
    label: 'Completed',
    hint: 'Handed over. Stops raising alerts.',
    tone: 'good',
  },
  {
    value: 'cancelled',
    label: 'Cancelled',
    hint: 'Called off before any work was done. Nothing to settle.',
    tone: 'idle',
  },
  {
    value: 'terminated',
    label: 'Terminated',
    hint: 'Stopped for good after work had started. What was built may still need settling.',
    tone: 'bad',
  },
];

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export type StatusKind = 'client' | 'contract' | 'project';

const BY_KIND: Record<StatusKind, StatusOption[]> = {
  client: CLIENT_STATUSES,
  contract: CONTRACT_STATUSES,
  project: PROJECT_STATUSES,
};

export function statusOptions(kind: StatusKind): StatusOption[] {
  return BY_KIND[kind];
}

function find(kind: StatusKind, value: string): StatusOption | undefined {
  return BY_KIND[kind].find((option) => option.value === value);
}

/**
 * The words for a stored value.
 *
 * A value the vocabulary does not know still has to read as something — older
 * records and imports carry statuses nobody has mapped yet — so it is shown
 * tidied up rather than blank. A blank cell reads as missing data; the raw
 * value at least tells you what to go and fix.
 */
export function statusLabel(kind: StatusKind, value: string): string {
  return find(kind, value)?.label ?? value.replace(/_/g, ' ');
}

export function statusHint(kind: StatusKind, value: string): string | null {
  return find(kind, value)?.hint ?? null;
}

export function statusTone(kind: StatusKind, value: string): StatusTone {
  return find(kind, value)?.tone ?? 'idle';
}

/** The chip class for a stored value, so the colour is decided in one place. */
export function statusChipClass(kind: StatusKind, value: string): string {
  return `chip chip-status-${statusTone(kind, value)}`;
}

/**
 * Statuses that mean the job is over.
 *
 * Alerts, chase letters and "live project" counts all need the same answer to
 * "is this still running", and they used to each carry their own list — which
 * is how `terminated` could be added to the vocabulary and go on raising
 * overdue alerts on a job that stopped a year ago.
 */
export function isClosedProject(status: string): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'terminated';
}

export function isClosedContract(status: string): boolean {
  return status === 'completed' || status === 'terminated' || status === 'expired';
}
