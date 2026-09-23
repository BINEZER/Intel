/**
 * What was actually accomplished in a period, as a document somebody can hand
 * to the person they report to.
 *
 * WHY THIS IS NOT THE CEO REPORT
 *   The CEO report answers "how is the business". It is written to be read by
 *   somebody deciding what to do next, so it leads with what is wrong: debt
 *   ageing, stages that have not moved, contracts about to lapse. That is the
 *   right shape for a management document and exactly the wrong shape for the
 *   question "what did you get done".
 *
 *   This answers that question. Same records, same figures, opposite selection:
 *   only things that FINISHED, each named with what it was worth and who it was
 *   for. Nothing here is a plan, a forecast or a concern.
 *
 * THE RULE THAT KEEPS IT HONEST
 *   Every line is a stored fact with a date on it — a contract signed, a job
 *   handed over, a stage closed out, money received, a task ticked. Nothing is
 *   inferred from a status that somebody could have set at any time, because a
 *   claim in a document like this will be read back to you.
 *
 *   The consequence is that a quiet period produces a short document, and a
 *   period where nothing was recorded produces one that says so. That is the
 *   feature working, not failing: a brag list that always finds something to
 *   brag about is a brag list nobody believes twice.
 */

import { containsDate } from './period.js';
import { formatETB } from './money.js';
import type { Period } from './period.js';

/** The kinds of thing that can count. */
export type AchievementKind =
  | 'contract_won'
  | 'project_delivered'
  | 'stage_closed'
  | 'cash_collected'
  | 'invoice_raised'
  | 'task_done';

export interface Achievement {
  kind: AchievementKind;
  /** The claim, in one line. */
  headline: string;
  /** What backs it: the client, the figure, the reference. */
  detail: string;
  when: Date;
  /** What it was worth, where it was worth something. */
  santim: number | null;
}

export interface AchievementGroup {
  key: AchievementKind;
  heading: string;
  /** One sentence with the number in it, for the section opener. */
  summary: string;
  items: Achievement[];
  santimTotal: number;
}

export interface AchievementReport {
  groups: AchievementGroup[];
  count: number;
  /** New contract value signed in the period. */
  wonSantim: number;
  /** Cash actually received in the period. */
  collectedSantim: number;
  /** Work invoiced in the period, gross. */
  invoicedSantim: number;
  projectsDelivered: number;
  stagesClosed: number;
  tasksDone: number;
  /** The opening paragraphs. Empty-safe. */
  opening: string[];
}

// ---------------------------------------------------------------------------
// The inputs, kept to what this module reads
// ---------------------------------------------------------------------------

export interface WonContract {
  contractNo: string;
  clientName: string;
  title: string;
  signedDate: Date;
  valueGrossSantim: number;
}

export interface DeliveredProject {
  projectNo: string;
  title: string;
  clientName: string;
  status: string;
  actualEnd: Date | null;
  contractNetSantim: number;
}

export interface ClosedStage {
  stageName: string;
  projectTitle: string;
  clientName: string;
  status: string;
  actualEnd: Date | null;
}

export interface RaisedInvoice {
  invoiceNo: string;
  clientName: string;
  status: string;
  issuedAt: Date;
  grossSantim: number;
  receipts: readonly { receivedAt: Date; amountGrossSantim: number }[];
}

export interface DoneTask {
  title: string;
  completedAt: Date | null;
  archived: boolean;
}

export interface AchievementInputs {
  period: Period;
  contracts: readonly WonContract[];
  projects: readonly DeliveredProject[];
  stages: readonly ClosedStage[];
  invoices: readonly RaisedInvoice[];
  tasks: readonly DoneTask[];
}

// ---------------------------------------------------------------------------
// Collecting
// ---------------------------------------------------------------------------

/** A job that is genuinely over, rather than merely not running. */
function isDelivered(status: string): boolean {
  return status === 'completed' || status === 'handed_over';
}

const money = (santim: number) => formatETB(santim);

/**
 * Sort a group: biggest first where there is money, newest first where there
 * is not.
 *
 * Both orders answer "what should they read first" for the kind of item they
 * apply to. A list of stages sorted by value would be sorted by nothing.
 */
function order(items: Achievement[]): Achievement[] {
  return [...items].sort((a, b) => {
    if (a.santim !== null && b.santim !== null && a.santim !== b.santim) {
      return b.santim - a.santim;
    }
    return b.when.getTime() - a.when.getTime();
  });
}

function group(
  key: AchievementKind,
  heading: string,
  items: Achievement[],
  summarise: (items: Achievement[], santimTotal: number) => string,
): AchievementGroup | null {
  if (items.length === 0) return null;
  const santimTotal = items.reduce((sum, item) => sum + (item.santim ?? 0), 0);
  return { key, heading, summary: summarise(items, santimTotal), items: order(items), santimTotal };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Everything that finished in the period, grouped and ordered. */
export function collectAchievements(inputs: AchievementInputs): AchievementReport {
  const { period } = inputs;

  const won: Achievement[] = inputs.contracts
    .filter((k) => containsDate(period, k.signedDate))
    .map((k) => ({
      kind: 'contract_won' as const,
      headline: `Signed ${k.contractNo} — ${k.title}`,
      detail: `${k.clientName} · ${money(k.valueGrossSantim)} including VAT`,
      when: k.signedDate,
      santim: k.valueGrossSantim,
    }));

  const delivered: Achievement[] = inputs.projects
    .filter((p) => isDelivered(p.status) && p.actualEnd !== null && containsDate(period, p.actualEnd))
    .map((p) => ({
      kind: 'project_delivered' as const,
      headline: `Handed over ${p.title}`,
      detail:
        `${p.clientName} · ${p.projectNo}` +
        (p.contractNetSantim > 0 ? ` · ${money(p.contractNetSantim)} net` : ''),
      when: p.actualEnd as Date,
      santim: p.contractNetSantim > 0 ? p.contractNetSantim : null,
    }));

  const stages: Achievement[] = inputs.stages
    .filter((s) => s.status === 'completed' && s.actualEnd !== null && containsDate(period, s.actualEnd))
    .map((s) => ({
      kind: 'stage_closed' as const,
      headline: `${s.stageName} completed on ${s.projectTitle}`,
      detail: s.clientName,
      when: s.actualEnd as Date,
      santim: null,
    }));

  // Cash is counted at the RECEIPT, not the invoice: an invoice raised is work
  // billed, and money received is a different achievement on a different day.
  const collected: Achievement[] = [];
  for (const invoice of inputs.invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    for (const receipt of invoice.receipts) {
      if (!containsDate(period, receipt.receivedAt)) continue;
      collected.push({
        kind: 'cash_collected',
        headline: `Collected ${money(receipt.amountGrossSantim)} against ${invoice.invoiceNo}`,
        detail: invoice.clientName,
        when: receipt.receivedAt,
        santim: receipt.amountGrossSantim,
      });
    }
  }

  const raised: Achievement[] = inputs.invoices
    .filter(
      (i) => i.status !== 'draft' && i.status !== 'void' && containsDate(period, i.issuedAt),
    )
    .map((i) => ({
      kind: 'invoice_raised' as const,
      headline: `Raised ${i.invoiceNo} for ${money(i.grossSantim)}`,
      detail: i.clientName,
      when: i.issuedAt,
      santim: i.grossSantim,
    }));

  const tasks: Achievement[] = inputs.tasks
    .filter((t) => !t.archived && t.completedAt !== null && containsDate(period, t.completedAt))
    .map((t) => ({
      kind: 'task_done' as const,
      headline: t.title,
      detail: '',
      when: t.completedAt as Date,
      santim: null,
    }));

  const groups = [
    group('contract_won', 'Work won', won, (items, total) =>
      `${plural(items.length, 'new contract')} signed, worth ${money(total)}.`),
    group('project_delivered', 'Delivered', delivered, (items) =>
      `${plural(items.length, 'job')} handed over to the client.`),
    group('cash_collected', 'Money collected', collected, (items, total) =>
      `${money(total)} received across ${plural(items.length, 'payment')}.`),
    group('invoice_raised', 'Work billed', raised, (items, total) =>
      `${plural(items.length, 'invoice')} raised, ${money(total)} including VAT.`),
    group('stage_closed', 'Progress on site', stages, (items) =>
      `${plural(items.length, 'stage')} closed out across live projects.`),
    group('task_done', 'Tasks completed', tasks, (items) =>
      `${plural(items.length, 'task')} finished.`),
  ].filter((g): g is AchievementGroup => g !== null);

  const wonSantim = won.reduce((sum, a) => sum + (a.santim ?? 0), 0);
  const collectedSantim = collected.reduce((sum, a) => sum + (a.santim ?? 0), 0);
  const invoicedSantim = raised.reduce((sum, a) => sum + (a.santim ?? 0), 0);

  return {
    groups,
    count: groups.reduce((sum, g) => sum + g.items.length, 0),
    wonSantim,
    collectedSantim,
    invoicedSantim,
    projectsDelivered: delivered.length,
    stagesClosed: stages.length,
    tasksDone: tasks.length,
    opening: opening({
      count: groups.reduce((sum, g) => sum + g.items.length, 0),
      wonSantim,
      collectedSantim,
      invoicedSantim,
      projectsDelivered: delivered.length,
      stagesClosed: stages.length,
      tasksDone: tasks.length,
    }),
  };
}

/**
 * The paragraph at the top.
 *
 * Built from whichever facts exist rather than from a template with holes in
 * it: a period with no signings should not open with "0 contracts signed".
 */
function opening(f: {
  count: number;
  wonSantim: number;
  collectedSantim: number;
  invoicedSantim: number;
  projectsDelivered: number;
  stagesClosed: number;
  tasksDone: number;
}): string[] {
  if (f.count === 0) {
    return [
      'Nothing was recorded as finished in this period.',
      'This document is built only from work with a completion date against it — a contract signed, a job handed over, a stage closed, a payment received, a task ticked. Where a period looks empty, it usually means the records have not caught up rather than that nothing happened.',
    ];
  }

  const led: string[] = [];
  if (f.wonSantim > 0) led.push(`won ${money(f.wonSantim)} of new work`);
  if (f.collectedSantim > 0) led.push(`collected ${money(f.collectedSantim)}`);
  if (f.projectsDelivered > 0) led.push(`handed over ${plural(f.projectsDelivered, 'job')}`);
  if (f.stagesClosed > 0) led.push(`closed ${plural(f.stagesClosed, 'stage')} on site`);
  if (f.tasksDone > 0 && led.length < 3) led.push(`finished ${plural(f.tasksDone, 'task')}`);

  const out: string[] = [];
  out.push(
    led.length === 0
      ? `${plural(f.count, 'thing')} was completed in this period.`
      : `In this period we ${sentenceList(led)}.`,
  );
  if (f.invoicedSantim > 0 && f.collectedSantim === 0) {
    out.push(`${money(f.invoicedSantim)} was billed; none of it had been received by the end of the period.`);
  }
  out.push(
    `${plural(f.count, 'item')} below, each one a record with a date against it. The figures come from the same contracts, invoices and stage trackers the monthly report is built from.`,
  );
  return out;
}

/** "a, b and c" — never "a, b, c". */
function sentenceList(parts: readonly string[]): string {
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}
