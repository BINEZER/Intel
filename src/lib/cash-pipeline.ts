/**
 * Where the money is, in the order it can be acted on.
 *
 * THREE QUESTIONS, ONE SET OF FACTS
 *   1. WHAT CAN BE INVOICED RIGHT NOW? — a payment term whose work is done or
 *      whose date has come, and which nobody has billed. This is the cheapest cash
 *      in the business: it needs one person to raise one document.
 *   2. WHAT CASH IS EXPECTED, AND WHEN? — invoices by their due date, terms by
 *      theirs, grouped by month, with what is not dated said plainly rather than
 *      guessed at.
 *   3. WHICH MAINTENANCE AGREEMENTS HAVE MONEY WAITING? — a maintenance agreement
 *      has no project, so the project ranking never saw it.
 *
 * "READY" IS WORKED OUT, NOT STORED
 *   A term has a `ready_to_invoice` status, but nothing in the app ever sets it.
 *   Waiting for a person to remember to mark a term ready is the same failure as
 *   waiting for them to remember to invoice it. So readiness is derived from two
 *   facts that ARE recorded: the stage the term is tied to is complete, or the
 *   term's own due date has arrived.
 *
 *   It is deliberately conservative. A term with NEITHER a stage nor a date is
 *   never called ready: imported contracts carry terms like that, and many were
 *   in fact paid long ago in the tracker the workbook came from. Nagging about
 *   them would bury the real ones. Giving such a term a date or a stage is what
 *   makes it visible.
 */

import { daysBetween } from './kpi.js';
import { containsDate, nextPeriod, periodContaining, type CalendarBasis, type Period } from './period.js';
import { milestoneExpectedValue, splitReceivables, DEFAULT_PRIORITY_CONFIG } from './priority.js';
import type { PriorityConfig } from './schema.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface PipelineContract {
  id: string;
  contractNo: string;
  title: string;
  clientName: string;
  type: string;
  status: string;
}

export interface PipelineTerm {
  id: string;
  contractId: string;
  name: string;
  seq: number;
  grossSantim: number;
  receivedGrossSantim: number;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'part_paid' | 'paid' | 'waived';
  dueDate: Date | null;
  /** The stage whose completion releases this term, where one is recorded. */
  phaseId: string | null;
}

export interface PipelineStage {
  phaseId: string;
  projectId: string;
  progressBps: number;
  status: string;
}

export interface PipelineInvoice {
  id: string;
  invoiceNo: string;
  clientName: string;
  contractId: string | null;
  milestoneId: string | null;
  status: string;
  balanceGrossSantim: number;
  grossSantim: number;
  paidGrossSantim: number;
  dueDate: Date;
}

export interface PipelineReceipt {
  receivedDate: Date;
  amountGrossSantim: number;
}

// A draft contract may not be invoiced against; a terminated or suspended one is
// not being billed. A completed or expired one can still owe the last months.
const BILLABLE_CONTRACT = new Set(['active', 'completed', 'expired']);

const OPEN_TERM = new Set(['pending', 'ready_to_invoice']);
const OPEN_INVOICE_DEBT = new Set(['issued', 'partially_paid', 'overdue']);

function stageComplete(stage: PipelineStage | undefined): boolean {
  return stage !== undefined && (stage.progressBps >= 10_000 || stage.status === 'completed');
}

// ---------------------------------------------------------------------------
// 1. Ready to invoice
// ---------------------------------------------------------------------------

export type ReadyReason = 'marked_ready' | 'stage_complete' | 'due_date';

export interface ReadyItem {
  termId: string;
  contractId: string;
  contractNo: string;
  contractTitle: string;
  clientName: string;
  termName: string;
  amountSantim: number;
  reason: ReadyReason;
  /** Days past the term's own date, where it had one; null otherwise. */
  daysPastDue: number | null;
  maintenance: boolean;
}

/** Why a term is ready, as one clause. */
export function describeReady(item: Pick<ReadyItem, 'reason' | 'daysPastDue'>): string {
  switch (item.reason) {
    case 'marked_ready':
      return 'marked ready to invoice';
    case 'stage_complete':
      return 'its stage is complete';
    case 'due_date':
      return item.daysPastDue === null || item.daysPastDue <= 0
        ? 'it falls due today'
        : `it fell due ${item.daysPastDue} day${item.daysPastDue === 1 ? '' : 's'} ago`;
  }
}

/**
 * Terms that can be invoiced now and have not been.
 *
 * A term is excluded if any non-void invoice already points at it — a term whose
 * status never caught up with its invoice must not be nagged about twice.
 */
export function readyToInvoice(
  contracts: readonly PipelineContract[],
  terms: readonly PipelineTerm[],
  stages: readonly PipelineStage[],
  invoices: readonly Pick<PipelineInvoice, 'milestoneId' | 'status'>[],
  asOf: Date,
): ReadyItem[] {
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const stageByPhase = new Map(stages.map((s) => [s.phaseId, s]));
  const billedTerms = new Set(
    invoices.filter((i) => i.status !== 'void' && i.milestoneId !== null).map((i) => i.milestoneId as string),
  );

  const out: ReadyItem[] = [];
  for (const term of terms) {
    if (!OPEN_TERM.has(term.status) || billedTerms.has(term.id)) continue;
    const contract = contractById.get(term.contractId);
    if (contract === undefined || !BILLABLE_CONTRACT.has(contract.status)) continue;
    if (term.grossSantim <= 0) continue;

    let reason: ReadyReason | null = null;
    if (term.status === 'ready_to_invoice') reason = 'marked_ready';
    else if (term.phaseId !== null && stageComplete(stageByPhase.get(term.phaseId))) reason = 'stage_complete';
    else if (term.dueDate !== null && term.dueDate.getTime() <= asOf.getTime()) reason = 'due_date';
    if (reason === null) continue;

    out.push({
      termId: term.id,
      contractId: contract.id,
      contractNo: contract.contractNo,
      contractTitle: contract.title,
      clientName: contract.clientName,
      termName: term.name,
      amountSantim: term.grossSantim,
      reason,
      daysPastDue: term.dueDate === null ? null : daysBetween(term.dueDate, asOf),
      maintenance: contract.type === 'maintenance',
    });
  }
  return out.sort(
    (a, b) => b.amountSantim - a.amountSantim || a.contractNo.localeCompare(b.contractNo) || a.termName.localeCompare(b.termName),
  );
}

export function sumReady(items: readonly ReadyItem[]): number {
  return items.reduce((a, i) => a + i.amountSantim, 0);
}

// ---------------------------------------------------------------------------
// 2. The cash forecast
// ---------------------------------------------------------------------------

export type BucketKey = 'overdue' | 'this' | 'next' | 'later' | 'undated';

export interface CashItem {
  id: string;
  /** To COLLECT is money already billed; to BILL is money not yet invoiced. */
  action: 'collect' | 'bill';
  label: string;
  clientName: string;
  contractId: string | null;
  amountSantim: number;
  dueOn: Date | null;
  maintenance: boolean;
}

export interface CashBucket {
  key: BucketKey;
  label: string;
  collectSantim: number;
  billSantim: number;
  items: CashItem[];
}

export interface CashForecast {
  thisMonth: Period;
  nextMonth: Period;
  buckets: CashBucket[];
  /** Cash that has actually arrived in the current month. */
  receivedThisMonthSantim: number;
  /** Ready to invoice today — a subset of the buckets, shown on its own. */
  readyNowSantim: number;
  /** The part of every bucket that is monthly maintenance. */
  maintenanceSantim: number;
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  overdue: 'Already due',
  this: 'This month',
  next: 'Next month',
  later: 'Later',
  undated: 'No date yet',
};

export const BUCKET_ORDER: readonly BucketKey[] = ['overdue', 'this', 'next', 'later', 'undated'];

export function bucketTotal(bucket: Pick<CashBucket, 'collectSantim' | 'billSantim'>): number {
  return bucket.collectSantim + bucket.billSantim;
}

/**
 * Expected cash by month.
 *
 * "Expected" means due on the schedule — an invoice by its due date, a term by
 * its own — not predicted. Money billed and not yet paid is "to collect"; money
 * not yet billed is "to bill", and says so, because the first needs a phone call
 * and the second needs a document, and a total that blended them would not tell
 * anyone which.
 *
 * Money with no date is its own row rather than being spread across the months,
 * so the total of the dated rows is never padded with guesses.
 */
export function cashForecast(
  contracts: readonly PipelineContract[],
  terms: readonly PipelineTerm[],
  stages: readonly PipelineStage[],
  invoices: readonly PipelineInvoice[],
  receipts: readonly PipelineReceipt[],
  asOf: Date,
  basis: CalendarBasis = 'gregorian',
): CashForecast {
  const thisMonth = periodContaining('month', basis, asOf);
  const nextMonth = nextPeriod(thisMonth);
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const stageByPhase = new Map(stages.map((s) => [s.phaseId, s]));
  const billedTerms = new Set(
    invoices.filter((i) => i.status !== 'void' && i.milestoneId !== null).map((i) => i.milestoneId as string),
  );

  const buckets = new Map<BucketKey, CashBucket>(
    BUCKET_ORDER.map((key) => [key, { key, label: BUCKET_LABEL[key], collectSantim: 0, billSantim: 0, items: [] }]),
  );

  const place = (date: Date | null, item: CashItem) => {
    let key: BucketKey;
    if (date === null) key = 'undated';
    else if (date.getTime() < asOf.getTime()) key = 'overdue';
    else if (containsDate(thisMonth, date)) key = 'this';
    else if (containsDate(nextMonth, date)) key = 'next';
    else key = 'later';
    const bucket = buckets.get(key) as CashBucket;
    if (item.action === 'collect') bucket.collectSantim += item.amountSantim;
    else bucket.billSantim += item.amountSantim;
    bucket.items.push(item);
  };

  // --- already billed: the invoice's own due date --------------------------------
  for (const invoice of invoices) {
    if (!OPEN_INVOICE_DEBT.has(invoice.status) || invoice.balanceGrossSantim <= 0) continue;
    const contract = invoice.contractId === null ? undefined : contractById.get(invoice.contractId);
    place(invoice.dueDate, {
      id: `invoice-${invoice.id}`,
      action: 'collect',
      label: invoice.invoiceNo === '' ? 'Invoice' : invoice.invoiceNo,
      clientName: invoice.clientName,
      contractId: invoice.contractId,
      amountSantim: invoice.balanceGrossSantim,
      dueOn: invoice.dueDate,
      maintenance: contract?.type === 'maintenance',
    });
  }

  // --- terms --------------------------------------------------------------------------
  for (const term of terms) {
    const contract = contractById.get(term.contractId);
    if (contract === undefined || !BILLABLE_CONTRACT.has(contract.status)) continue;
    const maintenance = contract.type === 'maintenance';
    const base = {
      clientName: contract.clientName,
      contractId: contract.id,
      maintenance,
    };

    if (OPEN_TERM.has(term.status)) {
      if (billedTerms.has(term.id) || term.grossSantim <= 0) continue;
      const ready =
        term.status === 'ready_to_invoice' ||
        (term.phaseId !== null && stageComplete(stageByPhase.get(term.phaseId)));
      // A term ready now is billable now; otherwise it falls where its date says.
      const when = term.dueDate ?? (ready ? asOf : null);
      place(when, {
        id: `term-${term.id}`,
        action: 'bill',
        label: `${contract.contractNo} · ${term.name}`,
        amountSantim: term.grossSantim,
        dueOn: term.dueDate,
        ...base,
      });
    } else if (term.status === 'invoiced' || term.status === 'part_paid') {
      // Billed according to the term but with no invoice document pointing at it
      // (an import, or an invoice raised before terms were linked). Without this
      // the money would be in no row at all.
      if (billedTerms.has(term.id)) continue;
      const remaining = term.grossSantim - term.receivedGrossSantim;
      if (remaining <= 0) continue;
      place(term.dueDate, {
        id: `term-${term.id}`,
        action: 'collect',
        label: `${contract.contractNo} · ${term.name}`,
        amountSantim: remaining,
        dueOn: term.dueDate,
        ...base,
      });
    }
  }

  const ordered = BUCKET_ORDER.map((key) => buckets.get(key) as CashBucket);
  for (const bucket of ordered) bucket.items.sort((a, b) => b.amountSantim - a.amountSantim);

  const ready = readyToInvoice(contracts, terms, stages, invoices, asOf);
  return {
    thisMonth,
    nextMonth,
    buckets: ordered,
    receivedThisMonthSantim: receipts
      .filter((r) => containsDate(thisMonth, r.receivedDate))
      .reduce((a, r) => a + r.amountGrossSantim, 0),
    readyNowSantim: sumReady(ready),
    maintenanceSantim: ordered.reduce(
      (a, b) => a + b.items.filter((i) => i.maintenance).reduce((s, i) => s + i.amountSantim, 0),
      0,
    ),
  };
}

// ---------------------------------------------------------------------------
// 3. Maintenance agreements, ranked by the money waiting on them
// ---------------------------------------------------------------------------

export interface MaintenanceRow {
  contractId: string;
  contractNo: string;
  title: string;
  clientName: string;
  overdueSantim: number;
  currentSantim: number;
  readyNowSantim: number;
  /** Not ready yet, but due inside the horizon, discounted by how soon. */
  upcomingSantim: number;
  oldestOverdueDays: number | null;
  /** The ranking key: the pools weighted by how cheaply each becomes cash. */
  weightedSantim: number;
  readyCount: number;
}

/**
 * Rank maintenance agreements by money waiting, using the same weights as the
 * project ranking so the two lists mean the same thing.
 *
 * It is ranked by ETB, not by share of the agreement. The project ranking
 * normalises by contract value so a small project is not always buried by a big
 * one; a maintenance agreement is twelve near-identical months, so "share" would
 * rank every one of them the same and say nothing about which has money waiting.
 */
export function rankMaintenance(
  contracts: readonly PipelineContract[],
  terms: readonly PipelineTerm[],
  invoices: readonly PipelineInvoice[],
  asOf: Date,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): MaintenanceRow[] {
  const rows: MaintenanceRow[] = [];
  for (const contract of contracts) {
    // A renewed agreement is `completed`, and its last months may still be unbilled;
    // the contract being finished does not make that money any less owed.
    if (contract.type !== 'maintenance' || !BILLABLE_CONTRACT.has(contract.status)) continue;

    const mine = invoices.filter((i) => i.contractId === contract.id);
    const receivables = splitReceivables(
      mine.map((i) => ({
        grossSantim: i.grossSantim,
        paidGrossSantim: i.paidGrossSantim,
        dueDate: i.dueDate,
        status: i.status as 'issued',
      })),
      asOf,
    );

    const ready = readyToInvoice([contract], terms.filter((t) => t.contractId === contract.id), [], mine, asOf);
    const readyIds = new Set(ready.map((r) => r.termId));
    const billed = new Set(mine.filter((i) => i.status !== 'void' && i.milestoneId !== null).map((i) => i.milestoneId));

    const upcomingSantim = terms
      .filter((t) => t.contractId === contract.id && OPEN_TERM.has(t.status) && !readyIds.has(t.id) && !billed.has(t.id))
      .reduce(
        (a, t) =>
          a +
          milestoneExpectedValue(
            { name: t.name, grossSantim: t.grossSantim, status: t.status, dueDate: t.dueDate, gatingPhaseProgressBps: null },
            asOf,
            config.horizonDays,
          ),
        0,
      );

    const readyNowSantim = sumReady(ready);
    // Ready terms are weighted as the cheapest money there is — earned and
    // unbilled — the same as overdue; billed-and-current as the project ranking.
    const weightedSantim = Math.round(
      ((receivables.overdueSantim + readyNowSantim) * config.overdueWeightBps +
        receivables.currentSantim * config.currentWeightBps +
        upcomingSantim * config.upcomingWeightBps) /
        10_000,
    );
    if (weightedSantim <= 0) continue;

    rows.push({
      contractId: contract.id,
      contractNo: contract.contractNo,
      title: contract.title,
      clientName: contract.clientName,
      overdueSantim: receivables.overdueSantim,
      currentSantim: receivables.currentSantim,
      readyNowSantim,
      upcomingSantim,
      oldestOverdueDays: receivables.oldestOverdueDays,
      weightedSantim,
      readyCount: ready.length,
    });
  }
  return rows.sort(
    (a, b) => b.weightedSantim - a.weightedSantim || (b.oldestOverdueDays ?? 0) - (a.oldestOverdueDays ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Feeding the project ranking
// ---------------------------------------------------------------------------

export interface PipelineProject {
  id: string;
  contractId: string | null;
}

export interface ProjectTerm {
  name: string;
  grossSantim: number;
  status: PipelineTerm['status'];
  dueDate: Date | null;
  gatingPhaseProgressBps: number | null;
}

/**
 * The payment terms to credit to each project.
 *
 * A contract can cover several projects, and the project ranking scores each one
 * on its own, so a term must be counted ONCE. A term tied to a stage belongs to
 * the project that owns the stage. A term tied to no stage is shared equally by
 * the contract's projects — the whole contract's terms would otherwise be
 * counted again for every project it covers.
 *
 * A term that is READY (see above) is reported as `ready_to_invoice`, so the
 * ranking counts it at full value instead of discounting it for a stage the
 * work has in fact finished.
 */
export function termsByProject(
  projects: readonly PipelineProject[],
  terms: readonly PipelineTerm[],
  stages: readonly PipelineStage[],
  readyTermIds: ReadonlySet<string>,
): Map<string, ProjectTerm[]> {
  const out = new Map<string, ProjectTerm[]>(projects.map((p) => [p.id, []]));
  const stageByPhase = new Map(stages.map((s) => [s.phaseId, s]));
  const projectsOf = new Map<string, string[]>();
  for (const p of projects) {
    if (p.contractId === null) continue;
    projectsOf.set(p.contractId, [...(projectsOf.get(p.contractId) ?? []), p.id]);
  }

  for (const term of terms) {
    const owners = projectsOf.get(term.contractId);
    if (owners === undefined || owners.length === 0) continue;
    const stage = term.phaseId === null ? undefined : stageByPhase.get(term.phaseId);
    const status = readyTermIds.has(term.id) ? ('ready_to_invoice' as const) : term.status;
    const gating = stage === undefined ? null : stage.progressBps;

    if (stage !== undefined && owners.includes(stage.projectId)) {
      out.get(stage.projectId)?.push({ name: term.name, grossSantim: term.grossSantim, status, dueDate: term.dueDate, gatingPhaseProgressBps: gating });
      continue;
    }
    // Shared equally; the remainder goes to the first project so the shares add
    // up to the whole term.
    const share = Math.floor(term.grossSantim / owners.length);
    const remainder = term.grossSantim - share * owners.length;
    owners.forEach((id, index) => {
      out.get(id)?.push({
        name: term.name,
        grossSantim: share + (index === 0 ? remainder : 0),
        status,
        dueDate: term.dueDate,
        gatingPhaseProgressBps: gating,
      });
    });
  }
  return out;
}
