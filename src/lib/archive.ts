/**
 * Archiving a finished job, and what must be true before it may be removed.
 *
 * WHAT A "JOB" IS
 *   An installation contract and everything that was done under it: its payment
 *   terms, the projects and their stages, the invoices and the money received
 *   against them, the payments made to subcontractors, and the crew assigned.
 *   Once the lifts are handed over, the warranty is served and a maintenance
 *   agreement has taken over, that whole file is history — and it is most of the
 *   bulk in the system.
 *
 * WHAT IS NEVER PART OF IT
 *   The CLIENT stays, whatever happens: they are who the maintenance agreement is
 *   with. So do the lifts (they are what is being serviced), the maintenance
 *   agreement itself, and the service history — callouts and visits — which is
 *   what the technician figures are built from.
 *
 * WHY A BACKUP IS PART OF THE DECISION, NOT AN EXTRA
 *   The existing deletion rules refuse to delete an issued invoice because a gap
 *   in the numbering cannot be explained to the tax authority later. Archiving
 *   is allowed to remove them only because the gap CAN be explained: the numbers
 *   are listed on the archive record, and every figure is in a backup file the
 *   person saved before anything was removed. Remove either of those and this is
 *   just a delete.
 *
 * WHY EVERYTHING HERE IS A BLOCKER OR A WARNING
 *   A blocker is a fact that makes removal wrong — money still owed, a project
 *   still running. A warning is a consequence the person should read before
 *   deciding: finance reports for those periods will no longer include the job.
 *   Nothing is automatic; this only says whether the button may be pressed.
 */

import { isClosedProject } from './status.js';

// ---------------------------------------------------------------------------
// What a loaded job looks like
// ---------------------------------------------------------------------------

/** A document as read: its id and its fields. */
export interface JobDoc<T> {
  id: string;
  data: T;
}

interface DateLike {
  at: { toDate(): Date };
}

export interface JobContract {
  contractNo: string;
  title: string;
  type: string;
  status: string;
  clientId: string;
  clientName: string;
  valueNetSantim: number;
  valueGrossSantim: number;
  succeededByContractId?: string | null;
  serviceDeclined?: boolean;
  warranty?: { endsOn: DateLike | null } | null;
}

export interface JobTerm {
  status: string;
  grossSantim: number;
  receivedGrossSantim?: number | undefined;
}

export interface JobProject {
  projectNo: string;
  title: string;
  status: string;
}

export interface JobInvoice {
  invoiceNo: string;
  status: string;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  paidGrossSantim: number;
  balanceGrossSantim: number;
}

export interface JobVoucher {
  voucherNo: string;
  status: string;
}

export interface JobTask {
  title: string;
  completedAt: unknown;
  archived: boolean;
}

export interface ArchiveJob {
  contract: JobDoc<JobContract>;
  terms: JobDoc<JobTerm>[];
  projects: JobDoc<JobProject>[];
  /** One entry per stage, with the project it belongs to. */
  stages: Array<JobDoc<Record<string, unknown>> & { projectId: string }>;
  invoices: JobDoc<JobInvoice>[];
  receipts: Array<JobDoc<Record<string, unknown>> & { invoiceId: string }>;
  chaseSteps: Array<JobDoc<Record<string, unknown>> & { invoiceId: string }>;
  vouchers: JobDoc<JobVoucher>[];
  assignments: JobDoc<Record<string, unknown>>[];
  tasks: JobDoc<JobTask>[];
  /** Lifts installed under these projects. Kept; only their "installed by" link changes. */
  units: JobDoc<Record<string, unknown>>[];
  /** The maintenance agreement that followed, where one was found. */
  successor: { id: string; contractNo: string; status: string } | null;
  /** Service records that name this job and are deliberately left in place. */
  staying: { callouts: number; visits: number };
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export interface ArchiveCount {
  /** Plural, as stored on the archive record: "invoices". */
  label: string;
  /** Singular, for a count of one: "invoice". */
  one: string;
  count: number;
}

export interface ArchiveVerdict {
  /** True only when nothing blocks it. Warnings never block. */
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  /** What the removal takes, as counts — each also in the backup. */
  removes: ArchiveCount[];
  /** What the removal leaves alone, as sentences. */
  stays: string[];
  /** Every invoice number that goes, so a gap in the sequence can be explained. */
  invoiceNumbers: string[];
  totals: {
    invoicedNetSantim: number;
    invoicedVatSantim: number;
    invoicedGrossSantim: number;
    receivedGrossSantim: number;
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Compare invoice numbers the way people read them: INV-2 before INV-10. */
function byNumber(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

const SETTLED_TERM = new Set(['paid', 'waived']);
// Vouchers that are finished one way or the other. Anything else is a payment
// somebody still means to make, or a decision nobody has taken.
const FINISHED_VOUCHER = new Set(['paid', 'rejected', 'void']);

/**
 * May this job be removed from the app?
 *
 * Pure: the reads happen elsewhere and arrive here as a snapshot, so the same
 * snapshot that is judged is the one that is backed up and the one that is
 * deleted.
 */
export function assessArchive(job: ArchiveJob, asOf: Date): ArchiveVerdict {
  const { contract } = job;
  const c = contract.data;
  const blockers: string[] = [];
  const warnings: string[] = [];

  // --- is it the kind of contract that ends? --------------------------------

  if (c.type === 'maintenance') {
    blockers.push(
      'This is a maintenance agreement. Those are renewed, not archived — it is what the client is being serviced under.',
    );
  }

  // --- is it over? ----------------------------------------------------------

  if (c.status !== 'completed') {
    blockers.push(`${c.contractNo} is marked ${c.status.replace(/_/g, ' ')}, not completed. Set it to completed first.`);
  }

  for (const project of job.projects) {
    if (project.data.status !== 'completed') {
      blockers.push(
        `${project.data.projectNo} is ${isClosedProject(project.data.status) ? project.data.status : project.data.status.replace(/_/g, ' ')}, not completed.`,
      );
    }
  }

  // --- has somebody taken it over, or has the client said no? -----------------

  const succeeded = c.succeededByContractId !== null && c.succeededByContractId !== undefined;
  if (succeeded) {
    if (job.successor === null) {
      blockers.push(
        'It says a maintenance agreement took over, but that agreement cannot be found. Removing this would leave nothing showing how the client came to be serviced.',
      );
    }
  } else if (c.serviceDeclined !== true) {
    blockers.push(
      'No maintenance agreement follows it, and the client has not been recorded as declining service. Use "To maintenance" on the Contracts page, or record that they declined.',
    );
  }

  // --- is every shilling accounted for? ----------------------------------------

  const unsettled = job.terms.filter((t) => !SETTLED_TERM.has(t.data.status));
  if (unsettled.length > 0) {
    const owed = unsettled.reduce(
      (sum, t) => sum + Math.max(0, t.data.grossSantim - (t.data.receivedGrossSantim ?? 0)),
      0,
    );
    blockers.push(
      `${plural(unsettled.length, 'payment term is', 'payment terms are')} not settled, with ${formatSantim(owed)} still to come in.`,
    );
  }

  for (const invoice of job.invoices) {
    const i = invoice.data;
    if (i.status === 'draft') {
      blockers.push(`Invoice ${i.invoiceNo || '(unnumbered)'} is still a draft. Issue it or delete it first.`);
    } else if (i.status !== 'void' && i.balanceGrossSantim > 0) {
      blockers.push(`Invoice ${i.invoiceNo} still has ${formatSantim(i.balanceGrossSantim)} unpaid.`);
    }
  }

  const openVouchers = job.vouchers.filter((v) => !FINISHED_VOUCHER.has(v.data.status));
  if (openVouchers.length > 0) {
    blockers.push(
      `${plural(openVouchers.length, 'payment voucher is', 'payment vouchers are')} not finished (${openVouchers
        .map((v) => v.data.voucherNo)
        .join(', ')}).`,
    );
  }

  const openTasks = job.tasks.filter((t) => t.data.completedAt === null && !t.data.archived);
  if (openTasks.length > 0) {
    blockers.push(
      `${plural(openTasks.length, 'task on a board is', 'tasks on a board are')} still open against it: ${openTasks
        .map((t) => `"${t.data.title}"`)
        .join(', ')}.`,
    );
  }

  // --- what the person should know before pressing it ---------------------------

  const warrantyEnds = c.warranty?.endsOn?.at.toDate() ?? null;
  if (warrantyEnds !== null && warrantyEnds.getTime() > asOf.getTime()) {
    warnings.push(
      `The free warranty on these lifts runs until ${warrantyEnds.toISOString().slice(0, 10)}. A defect claim is easier to argue with the project file in front of you.`,
    );
  }

  const issued = job.invoices.filter((i) => i.data.status !== 'draft');
  if (issued.length > 0) {
    warnings.push(
      `${plural(issued.length, 'invoice goes', 'invoices go')} out of the app. Finance and VAT reports for the periods they fall in will no longer include them — keep the backup with your tax records.`,
    );
  }
  if (job.assignments.length > 0) {
    warnings.push(
      'The crew assignments on these projects go too, so the project-by-project history behind a technician’s past scores will not be reconstructible from the app. Their saved monthly scores are untouched.',
    );
  }

  // --- the figures that stay on the archive record ----------------------------

  const counted = issued.filter((i) => i.data.status !== 'void');
  const totals = {
    invoicedNetSantim: counted.reduce((a, i) => a + i.data.netSantim, 0),
    invoicedVatSantim: counted.reduce((a, i) => a + i.data.vatSantim, 0),
    invoicedGrossSantim: counted.reduce((a, i) => a + i.data.grossSantim, 0),
    receivedGrossSantim: counted.reduce((a, i) => a + i.data.paidGrossSantim, 0),
  };

  const removes: ArchiveCount[] = [
    { label: 'payment terms', one: 'payment term', count: job.terms.length },
    { label: 'projects', one: 'project', count: job.projects.length },
    { label: 'stages', one: 'stage', count: job.stages.length },
    { label: 'invoices', one: 'invoice', count: job.invoices.length },
    { label: 'receipts', one: 'receipt', count: job.receipts.length },
    { label: 'collection notes', one: 'collection note', count: job.chaseSteps.length },
    { label: 'payment vouchers', one: 'payment voucher', count: job.vouchers.length },
    { label: 'crew assignments', one: 'crew assignment', count: job.assignments.length },
    { label: 'finished tasks', one: 'finished task', count: job.tasks.length },
  ].filter((entry) => entry.count > 0);

  const stays = [
    `The client, ${c.clientName}, and every contact on file.`,
    job.units.length > 0
      ? `${plural(job.units.length, 'lift', 'lifts')} — kept, with a note of which contract installed ${job.units.length === 1 ? 'it' : 'them'}.`
      : 'The lifts, if any are on the register.',
    job.successor !== null
      ? `The maintenance agreement ${job.successor.contractNo}.`
      : 'Any maintenance agreement for this client.',
  ];
  if (job.staying.callouts + job.staying.visits > 0) {
    stays.push(
      `${plural(job.staying.callouts, 'callout', 'callouts')} and ${plural(job.staying.visits, 'maintenance visit', 'maintenance visits')} that mention this job — service history is never removed here.`,
    );
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    warnings,
    removes,
    stays,
    invoiceNumbers: job.invoices.map((i) => i.data.invoiceNo).filter((n) => n !== '').sort(byNumber),
    totals,
  };
}

function formatSantim(santim: number): string {
  const birr = santim / 100;
  return `ETB ${birr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// The list: which contracts are even worth opening
// ---------------------------------------------------------------------------

export interface CandidateContract {
  type: string;
  status: string;
  succeededByContractId?: string | null | undefined;
  serviceDeclined?: boolean | undefined;
}

/**
 * A cheap first look from lists already on screen: is this contract worth
 * reviewing?
 *
 * It judges only what is visible without reading anything — the contract's own
 * status, whether it was followed, and whether its projects are done. The money
 * and the paperwork are checked when the contract is opened, because checking
 * them for every contract would be hundreds of reads to draw a list.
 */
export function archiveCandidate(
  contract: CandidateContract,
  projectStatuses: readonly string[],
): { ready: boolean; reason: string | null } {
  if (contract.type === 'maintenance') return { ready: false, reason: 'A maintenance agreement is renewed, not archived.' };
  if (contract.status !== 'completed') {
    return { ready: false, reason: `The contract is ${contract.status.replace(/_/g, ' ')}, not completed.` };
  }
  const open = projectStatuses.filter((s) => s !== 'completed').length;
  if (open > 0) {
    return { ready: false, reason: `${plural(open, 'project is', 'projects are')} not completed.` };
  }
  const followed = contract.succeededByContractId != null || contract.serviceDeclined === true;
  if (!followed) return { ready: false, reason: 'No maintenance agreement follows it yet.' };
  return { ready: true, reason: null };
}
