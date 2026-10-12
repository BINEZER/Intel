/**
 * What to actually do today.
 *
 * WHY THIS EXISTS
 *   The dashboard reported the state of the business and asked nothing of
 *   anybody. You could read it for a minute and close it without having done a
 *   thing, which is the definition of a screen that does nothing. Every number
 *   on it was true and none of it was a instruction.
 *
 * WHAT EARNS A PLACE
 *   The same test the alerts engine uses: a DEADLINE and an ACTION. Something
 *   that is merely large, merely open, or merely interesting does not qualify —
 *   nothing about it changes by being ignored for a day. A list that shows
 *   everything gets read once.
 *
 * WHY IT IS ONE LIST
 *   The work arrives from five places — overdue money, stages past their date,
 *   contracts running out, certificates expiring, decisions waiting — and a
 *   person has one day. Five panels make them compare across panels; one ranked
 *   list does the comparing for them, and the top of it is where to start.
 */

import { daysBetween } from './kpi.js';
import { formatETB } from './money.js';
import { isClosedProject } from './status.js';
import { describeReady, type ReadyItem } from './cash-pipeline.js';

export type TaskKind =
  | 'collect'
  | 'invoice'
  | 'stage_overdue'
  | 'stage_due'
  | 'contract_expiring'
  | 'certificate'
  | 'decision'
  | 'approve_payment';

/** How hard it presses. `overdue` has already been ignored at least once. */
export type TaskUrgency = 'overdue' | 'today' | 'soon';

export interface TodayTask {
  id: string;
  kind: TaskKind;
  urgency: TaskUrgency;
  /** What it is about, as a person would name it. */
  subject: string;
  /** The action, in the imperative. Not a description of the problem. */
  action: string;
  /** The number that makes it urgent, where there is one. */
  figure: string | null;
  href: string;
  /** Negative once the date has passed. */
  daysRemaining: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface TodayInvoice {
  id: string;
  invoiceNo: string;
  clientName: string;
  dueDate: Date;
  balanceGrossSantim: number;
  status: string;
}

export interface TodayStage {
  projectId: string;
  projectTitle: string;
  stageName: string;
  plannedEnd: Date;
  /** The next unticked checkpoint — the thing to actually go and do. */
  nextCheckpoint: string | null;
  done: boolean;
  projectStatus: string;
}

export interface TodayContract {
  id: string;
  contractNo: string;
  clientName: string;
  endDate: Date;
  status: string;
  renewalStatus: string;
}

export interface TodayUnit {
  id: string;
  tag: string;
  siteName: string;
  certificateExpiresOn: Date | null;
}

export interface TodayVoucher {
  id: string;
  voucherNo: string;
  subcontractorName: string;
  netPayableSantim: number;
  status: string;
}

export interface TodayInputs {
  asOf: Date;
  invoices: readonly TodayInvoice[];
  stages: readonly TodayStage[];
  contracts: readonly TodayContract[];
  units: readonly TodayUnit[];
  vouchers: readonly TodayVoucher[];
  /**
   * Payment terms that can be invoiced now and have not been. Optional because
   * they live in subcollections and arrive after the rest of the page has drawn.
   */
  readyToInvoice?: readonly ReadyItem[];
  /** Decisions the lifecycle engine is waiting on. */
  decisions: readonly { id: string; subject: string; href: string }[];
  /** Anything further out than this is not today's problem. */
  horizonDays?: number;
}

const DEFAULT_HORIZON_DAYS = 14;

function urgencyOf(days: number): TaskUrgency {
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return 'soon';
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export function buildToday(inputs: TodayInputs): TodayTask[] {
  const { asOf } = inputs;
  const horizon = inputs.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const tasks: TodayTask[] = [];

  // --- money owed to us --------------------------------------------------

  for (const invoice of inputs.invoices) {
    if (invoice.balanceGrossSantim <= 0) continue;
    if (invoice.status === 'draft' || invoice.status === 'void' || invoice.status === 'paid') continue;
    const days = daysBetween(asOf, invoice.dueDate);
    if (days > horizon) continue;

    tasks.push({
      id: `collect-${invoice.id}`,
      kind: 'collect',
      urgency: urgencyOf(days),
      subject: `${invoice.invoiceNo} · ${invoice.clientName}`,
      action:
        days < 0
          ? `Chase — ${Math.abs(days)} days overdue`
          : days === 0
            ? 'Due today — call before close of business'
            : `Due in ${days} days — send the reminder`,
      figure: formatETB(invoice.balanceGrossSantim),
      href: '/collections',
      daysRemaining: days,
    });
  }

  // --- work that should have happened -------------------------------------

  for (const stage of inputs.stages) {
    if (stage.done || isClosedProject(stage.projectStatus)) continue;
    const days = daysBetween(asOf, stage.plannedEnd);
    if (days > horizon) continue;

    tasks.push({
      id: `stage-${stage.projectId}-${stage.stageName}`,
      kind: days < 0 ? 'stage_overdue' : 'stage_due',
      urgency: urgencyOf(days),
      subject: `${stage.projectTitle} · ${stage.stageName}`,
      // The next unticked checkpoint is a specific thing somebody can go and
      // do; "the stage is late" is not.
      action:
        stage.nextCheckpoint === null
          ? days < 0
            ? `${Math.abs(days)} days past its date — close it out or move the date`
            : 'Due — close it out'
          : stage.nextCheckpoint,
      figure: null,
      href: `/projects/${stage.projectId}`,
      daysRemaining: days,
    });
  }

  // --- contracts running out ----------------------------------------------

  for (const contract of inputs.contracts) {
    if (contract.status !== 'active') continue;
    if (contract.renewalStatus === 'renewed' || contract.renewalStatus === 'in_negotiation') continue;
    const days = daysBetween(asOf, contract.endDate);
    if (days > horizon) continue;

    tasks.push({
      id: `contract-${contract.id}`,
      kind: 'contract_expiring',
      urgency: urgencyOf(days),
      subject: `${contract.contractNo} · ${contract.clientName}`,
      action:
        days < 0
          ? `Lapsed ${Math.abs(days)} days ago — call the client today`
          : 'Write the extension letter',
      figure: null,
      href: `/contracts/${contract.id}`,
      daysRemaining: days,
    });
  }

  // --- certificates --------------------------------------------------------

  for (const unit of inputs.units) {
    if (unit.certificateExpiresOn === null) continue;
    const days = daysBetween(asOf, unit.certificateExpiresOn);
    if (days > horizon) continue;

    tasks.push({
      id: `cert-${unit.id}`,
      kind: 'certificate',
      urgency: urgencyOf(days),
      subject: `${unit.tag} · ${unit.siteName}`,
      action:
        days < 0
          ? `Certificate expired ${Math.abs(days)} days ago — the lift is running uncertified`
          : 'Book the re-inspection',
      figure: null,
      href: `/units/${unit.id}`,
      daysRemaining: days,
    });
  }

  // --- money waiting on us -------------------------------------------------

  for (const voucher of inputs.vouchers) {
    if (voucher.status !== 'requested' && voucher.status !== 'checked') continue;
    tasks.push({
      id: `voucher-${voucher.id}`,
      kind: 'approve_payment',
      urgency: 'today',
      subject: `${voucher.voucherNo} · ${voucher.subcontractorName}`,
      action: 'Waiting on approval — a crew is not being paid',
      figure: formatETB(voucher.netPayableSantim),
      href: '/payouts',
      daysRemaining: 0,
    });
  }

  // --- money we have earned and not yet asked for -----------------------------
  //
  // One task per CONTRACT, not per term. A maintenance agreement that has gone
  // three months unbilled is one thing to do — raise the invoices — and three
  // identical lines would bury everything else on the list.

  const readyByContract = new Map<string, ReadyItem[]>();
  for (const item of inputs.readyToInvoice ?? []) {
    readyByContract.set(item.contractId, [...(readyByContract.get(item.contractId) ?? []), item]);
  }
  for (const [contractId, items] of readyByContract) {
    const first = items[0] as ReadyItem;
    const late = Math.max(0, ...items.map((i) => i.daysPastDue ?? 0));
    const total = items.reduce((a, i) => a + i.amountSantim, 0);
    tasks.push({
      id: `invoice-${contractId}`,
      kind: 'invoice',
      urgency: late > 0 ? 'overdue' : 'today',
      subject: `${first.contractNo} · ${first.clientName}`,
      action:
        items.length === 1
          ? `Raise the invoice for ${first.termName} — ${describeReady(first)}`
          : `Raise ${items.length} invoices — ${items.slice(0, 3).map((i) => i.termName).join(', ')}${items.length > 3 ? '…' : ''} are ready`,
      figure: formatETB(total),
      href: `/contracts/${contractId}`,
      daysRemaining: late > 0 ? -late : 0,
    });
  }

  // --- decisions -----------------------------------------------------------

  for (const decision of inputs.decisions) {
    tasks.push({
      id: `decision-${decision.id}`,
      kind: 'decision',
      urgency: 'today',
      subject: decision.subject,
      action: 'Warranty is running out — agree service terms or close it',
      figure: null,
      href: decision.href,
      daysRemaining: 0,
    });
  }

  return sortTasks(tasks);
}

const URGENCY_ORDER: Record<TaskUrgency, number> = { overdue: 0, today: 1, soon: 2 };

/**
 * Most pressing first, and within that the thing that has been waiting longest.
 *
 * Something already overdue sorts above something due today at the same
 * urgency, because it has been ignored at least once already.
 */
export function sortTasks(tasks: readonly TodayTask[]): TodayTask[] {
  return [...tasks].sort(
    (a, b) =>
      URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
      a.daysRemaining - b.daysRemaining ||
      a.subject.localeCompare(b.subject),
  );
}

export function summariseToday(tasks: readonly TodayTask[]) {
  return {
    total: tasks.length,
    overdue: tasks.filter((t) => t.urgency === 'overdue').length,
    today: tasks.filter((t) => t.urgency === 'today').length,
    money: tasks.filter((t) => t.kind === 'collect' || t.kind === 'invoice').length,
  };
}

/** The one line worth reading if nothing else is. */
export function describeToday(tasks: readonly TodayTask[]): string {
  if (tasks.length === 0) return 'Nothing is overdue and nothing falls due in the next two weeks.';
  const overdue = tasks.filter((t) => t.urgency === 'overdue').length;
  const first = tasks[0] as TodayTask;
  if (overdue === 0) return `${tasks.length} things due soon. Start with ${first.subject}.`;
  return `${overdue} already overdue. Start with ${first.subject}.`;
}

// ---------------------------------------------------------------------------
// The job board
// ---------------------------------------------------------------------------

/**
 * Every live job, under the stage it is actually at.
 *
 * A LIST of projects answers "how many"; a BOARD answers "where is the work",
 * which is the question somebody running installations has every morning. Three
 * jobs stuck in customs and none on site is a different day from three jobs on
 * site — and the list shows both as "3 in progress".
 *
 * A project's current stage is its first unfinished one, not its furthest
 * started: work does not really run in parallel on a single shaft, and taking
 * the furthest would report a job as "testing" because somebody ticked one box
 * early while the rails are still down.
 */
export interface BoardProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  progressBps: number;
  plannedEnd: Date;
  status: string;
  inDanger: boolean;
  /** The first unfinished stage, or null where every stage is done. */
  currentStage: string | null;
}

export interface BoardColumn {
  key: string;
  label: string;
  projects: BoardProject[];
  /** Jobs here that are past their planned end. */
  overdue: number;
  /**
   * True for the one column holding jobs whose stage nobody has set.
   *
   * It is not a stage; it is a queue of jobs the board cannot place. The page
   * marks it so, because a reader must not read "Stage not set" as somewhere
   * the work has got to.
   */
  untracked?: boolean;
}

/** The column that catches jobs with no stage recorded. */
export const UNTRACKED_KEY = '__untracked';

/**
 * Group the live jobs by stage, in the stage order given.
 *
 * Empty columns are KEPT: a gap in the pipeline is the most useful thing the
 * board says. Nothing in "Shipping & customs" for two months is a supply
 * problem arriving in six weeks, and a board that hides empty columns hides
 * exactly that.
 */
export function buildBoard(
  projects: readonly BoardProject[],
  stageOrder: readonly { key: string; label: string }[],
  asOf: Date,
): BoardColumn[] {
  const columns: BoardColumn[] = stageOrder.map((stage) => ({
    key: stage.key,
    label: stage.label,
    projects: [],
    overdue: 0,
  }));
  const byLabel = new Map(columns.map((c) => [c.label, c]));

  // Jobs whose stage nobody has set — every imported job, until somebody ticks
  // a checkpoint on it. They go in a column of their own at the front rather
  // than being dropped: a board that silently omits a hundred and sixty live
  // jobs is worse than one that says it cannot place them.
  const untracked: BoardColumn = {
    key: UNTRACKED_KEY,
    label: 'Stage not set',
    projects: [],
    overdue: 0,
    untracked: true,
  };

  for (const project of projects) {
    if (isClosedProject(project.status)) continue;
    const column =
      project.currentStage === null ? untracked : byLabel.get(project.currentStage);
    if (column === undefined) continue;
    column.projects.push(project);
    if (project.plannedEnd < asOf) column.overdue += 1;
  }

  if (untracked.projects.length > 0) columns.unshift(untracked);

  for (const column of columns) {
    // Worst first inside a column: the job in trouble is the one to look at.
    column.projects.sort(
      (a, b) =>
        Number(b.inDanger) - Number(a.inDanger) ||
        a.plannedEnd.getTime() - b.plannedEnd.getTime(),
    );
  }
  return columns;
}
