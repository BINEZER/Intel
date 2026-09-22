/**
 * The CEO report: what happened this period, and what happens next.
 *
 * RULES THIS FILE IS BUILT ON
 *
 *   1. Every figure traces to a document that exists. Nothing is estimated,
 *      smoothed, or carried forward from a previous version of the report.
 *
 *   2. Missing data says so. "No subcontractor payments were made this week" is
 *      a finding. Printing ETB 0.00 next to a green arrow is a lie of omission,
 *      and the one thing a board report cannot afford is to be quietly wrong.
 *
 *   3. A change needs a base to be a percentage. Going from nothing to ETB 4M is
 *      not "+∞%" and not "+100%" — it is "up from nothing last month", which is
 *      what a person would actually say.
 *
 *   4. Progress in the period is measured from what was RECORDED as finished in
 *      it — stages with an actual end date inside the window — not from a
 *      snapshot of a progress bar nobody stored. There is no history table, so
 *      the report does not pretend there is one.
 */

import { ageReceivables, settle, type AgeBucket, type AgeingReport } from './invoicing.js';
import { buildUnlockReport, type UnlockReport } from './unlock.js';
import { formatETB, santimToBirr } from './money.js';
import { rateBps } from './kpi.js';
import { stageOwner } from './stages.js';
import {
  containsDate,
  formatPeriodRange,
  nextPeriod,
  periodElapsedBps,
  previousPeriod,
  trailingPeriods,
  type Period,
} from './period.js';
import { formatDual } from './ethiopic.js';
import type { ProjectStatusValue } from './status.js';
import { projectTypeShort } from './project-kind.js';
import { describeMix, workMix, type WorkMix } from './work-mix.js';
import type { ProjectType } from './project-kind.js';

// ---------------------------------------------------------------------------
// Inputs — flat, so the report can be tested without Firestore
// ---------------------------------------------------------------------------

export interface ReportReceipt {
  receivedAt: Date;
  amountGrossSantim: number;
  clientWhtSantim: number;
}

export interface ReportInvoice {
  id: string;
  invoiceNo: string;
  clientName: string;
  projectId: string | null;
  issuedAt: Date;
  dueDate: Date;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  receipts: readonly ReportReceipt[];
}

export interface ReportDisbursement {
  voucherNo: string;
  projectId: string;
  subcontractorName: string;
  requestedAt: Date;
  paidAt: Date | null;
  netSantim: number;
  supplierVatSantim: number;
  whtSantim: number;
  netPayableSantim: number;
  status: 'draft' | 'requested' | 'checked' | 'approved' | 'paid' | 'rejected' | 'on_hold' | 'void';
}

export interface ReportProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  /**
   * The kind of work. Without it the report cannot tell an office renovation
   * from a lift installation, which is how a company that has diversified goes
   * on reading as a company that has not.
   */
  type: ProjectType;
  status: ProjectStatusValue;
  progressBps: number;
  contractNetSantim: number;
  plannedEnd: Date;
  actualStart: Date | null;
  actualEnd: Date | null;
}

export interface ReportStage {
  projectId: string;
  projectTitle: string;
  clientName: string;
  phaseId: string;
  stageKey: string;
  stageName: string;
  weightBps: number;
  progressBps: number;
  status: 'not_started' | 'in_progress' | 'blocked' | 'completed';
  plannedEnd: Date | null;
  actualStart: Date | null;
  actualEnd: Date | null;
  dependsOnPhaseIds: readonly string[];
}

export interface ReportMilestone {
  milestoneId: string;
  contractId: string;
  contractNo: string;
  projectId: string | null;
  clientName: string;
  name: string;
  phaseId: string | null;
  grossSantim: number;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'paid' | 'waived';
  dueDate: Date | null;
}

export interface ReportContract {
  id: string;
  contractNo: string;
  clientName: string;
  type: string;
  endDate: Date;
  renewalAlertAt: Date | null;
  status: string;
  valueGrossSantim: number;
}

export interface ReportInputs {
  companyName: string;
  period: Period;
  asOf: Date;
  projects: readonly ReportProject[];
  stages: readonly ReportStage[];
  invoices: readonly ReportInvoice[];
  disbursements: readonly ReportDisbursement[];
  milestones: readonly ReportMilestone[];
  contracts: readonly ReportContract[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type Polarity = 'higher_is_better' | 'lower_is_better' | 'neutral';

export interface Metric {
  key: string;
  label: string;
  /** Formatted for display — the report never re-formats a number twice. */
  value: string;
  santim: number | null;
  previousValue: string | null;
  /** Null when there is no comparable base to be a percentage OF. */
  changeBps: number | null;
  direction: 'up' | 'down' | 'flat' | null;
  polarity: Polarity;
  /** A sentence a person would say about the change. Never a bare percentage. */
  note: string;
}

export interface ReportTable {
  caption: string;
  columns: readonly { key: string; label: string; align?: 'left' | 'right' }[];
  rows: readonly Record<string, string>[];
  /** Shown instead of an empty table, so a blank section still says something. */
  emptyMessage: string;
}

export interface SeriesPoint {
  label: string;
  /** Axis form of `label` — full labels collide on an axis six categories wide. */
  shortLabel: string;
  values: Record<string, number>;
}

export interface ChartSpec {
  id: string;
  kind: 'grouped_bars' | 'bars';
  title: string;
  /** What the reader should take from it — never just a restatement of the axes. */
  subtitle: string;
  /** Series key → display name, in draw order. */
  series: readonly { key: string; label: string }[];
  /**
   * Which colour job the marks are doing.
   *   `categorical` — series are identities; fixed hue order, never cycled.
   *   `ordinal`     — one series whose categories are ORDERED (age buckets);
   *                   one hue, light to dark, so the order is visible.
   *   `single`      — one series, one hue; the title names it, no legend.
   */
  palette: 'categorical' | 'ordinal' | 'single';
  points: readonly SeriesPoint[];
  /** 'santim' values are rendered as ETB; 'count' as plain integers. */
  unit: 'santim' | 'count';
}

export interface ReportSection {
  id: string;
  heading: string;
  /** Paragraphs. Each states a fact with a number in it, or says there is none. */
  narrative: readonly string[];
  metrics?: readonly Metric[];
  table?: ReportTable;
  chart?: ChartSpec;
}

export interface CeoReport {
  companyName: string;
  title: string;
  /** What the report was asked to be about. `overall` is the whole thing. */
  focus: ReportFocus;
  period: Period;
  comparison: Period;
  ahead: Period;
  generatedAt: Date;
  periodRange: string;
  /** One paragraph the CEO can read and stop. */
  executiveSummary: readonly string[];
  headline: readonly Metric[];
  sections: readonly ReportSection[];
  plan: readonly ReportSection[];
}

// ---------------------------------------------------------------------------
// Formatting and honest change description
// ---------------------------------------------------------------------------

const PERIOD_NOUN: Record<Period['kind'], string> = {
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

function pct(bps: number): string {
  const abs = Math.abs(bps);
  return `${(abs / 100).toFixed(abs >= 1000 ? 0 : 1)}%`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Describe a change the way a person would.
 *
 * The awkward cases are the point: zero to something has no percentage, something
 * to zero is "stopped", and a change under half a percent is "level" rather than
 * a number that invites over-reading.
 */
export function describeChange(
  current: number,
  previous: number,
  noun: string,
  polarity: Polarity,
): { changeBps: number | null; direction: Metric['direction']; note: string } {
  if (current === previous) {
    return { changeBps: 0, direction: 'flat', note: `Unchanged from the previous ${noun}.` };
  }
  if (previous === 0) {
    return {
      changeBps: null,
      direction: current > 0 ? 'up' : 'down',
      note: `Up from nothing in the previous ${noun}.`,
    };
  }
  if (current === 0) {
    return { changeBps: -10_000, direction: 'down', note: `Nothing this ${noun}, against ${formatETB(previous)} in the previous one.` };
  }

  const changeBps = Math.round(((current - previous) / Math.abs(previous)) * 10_000);
  const direction = changeBps > 0 ? 'up' : 'down';
  if (Math.abs(changeBps) < 50) {
    return { changeBps, direction: 'flat', note: `Level with the previous ${noun}.` };
  }

  const good =
    polarity === 'neutral' ? null : polarity === 'higher_is_better' ? changeBps > 0 : changeBps < 0;
  const tail = good === null ? '' : good ? '' : ' — worth a look';

  return {
    changeBps,
    direction,
    note: `${direction === 'up' ? 'Up' : 'Down'} ${pct(changeBps)} on the previous ${noun}${tail}.`,
  };
}

function countMetric(
  key: string,
  label: string,
  current: number,
  previous: number,
  noun: string,
  polarity: Polarity,
): Metric {
  const change = describeChange(current, previous, noun, polarity);
  return {
    key,
    label,
    value: String(current),
    santim: null,
    previousValue: String(previous),
    changeBps: change.changeBps,
    direction: change.direction,
    polarity,
    note: change.note,
  };
}

/**
 * A position, not a flow.
 *
 * Receivables outstanding is a balance at a moment — there is no "previous
 * period's outstanding" stored anywhere, and inventing one by re-running the
 * ageing at a past date would be a different calculation wearing the same label.
 * So it carries no arrow at all, and says what matters about it instead.
 */
function positionMetric(key: string, label: string, santim: number, note: string, polarity: Polarity): Metric {
  return {
    key,
    label,
    value: formatETB(santim),
    santim,
    previousValue: null,
    changeBps: null,
    direction: null,
    polarity,
    note,
  };
}

function moneyMetric(
  key: string,
  label: string,
  current: number,
  previous: number,
  noun: string,
  polarity: Polarity,
): Metric {
  const change = describeChange(current, previous, noun, polarity);
  return {
    key,
    label,
    value: formatETB(current),
    santim: current,
    previousValue: formatETB(previous),
    changeBps: change.changeBps,
    direction: change.direction,
    polarity,
    note: change.note,
  };
}

// ---------------------------------------------------------------------------
// Period slicing
// ---------------------------------------------------------------------------

/** Invoices ISSUED in the window. Drafts and voids are not revenue. */
function invoicesIssuedIn(invoices: readonly ReportInvoice[], period: Period): ReportInvoice[] {
  return invoices.filter(
    (i) => i.status !== 'draft' && i.status !== 'void' && containsDate(period, i.issuedAt),
  );
}

/**
 * Cash actually received in the window.
 *
 * Receipts, not invoices — an invoice issued in March and paid in June is June's
 * cash. Confusing the two is how a business with healthy "revenue" runs out of
 * money.
 */
function receiptsIn(invoices: readonly ReportInvoice[], period: Period) {
  const rows: { invoice: ReportInvoice; receipt: ReportReceipt }[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    for (const receipt of invoice.receipts) {
      if (containsDate(period, receipt.receivedAt)) rows.push({ invoice, receipt });
    }
  }
  return rows;
}

function disbursementsPaidIn(rows: readonly ReportDisbursement[], period: Period): ReportDisbursement[] {
  return rows.filter((d) => d.status === 'paid' && d.paidAt !== null && containsDate(period, d.paidAt));
}

function stagesCompletedIn(stages: readonly ReportStage[], period: Period): ReportStage[] {
  return stages.filter((s) => s.actualEnd !== null && containsDate(period, s.actualEnd));
}

interface PeriodTotals {
  invoicedNetSantim: number;
  outputVatSantim: number;
  collectedGrossSantim: number;
  clientWhtSantim: number;
  costNetSantim: number;
  inputVatSantim: number;
  whtWithheldSantim: number;
  cashOutSantim: number;
  marginSantim: number;
  invoiceCount: number;
  voucherCount: number;
  stagesCompleted: number;
  projectsHandedOver: number;
  projectsStarted: number;
}

function totalsFor(inputs: ReportInputs, period: Period): PeriodTotals {
  const issued = invoicesIssuedIn(inputs.invoices, period);
  const received = receiptsIn(inputs.invoices, period);
  const paid = disbursementsPaidIn(inputs.disbursements, period);

  const invoicedNetSantim = issued.reduce((a, i) => a + i.netSantim, 0);
  const costNetSantim = paid.reduce((a, d) => a + d.netSantim, 0);

  return {
    invoicedNetSantim,
    outputVatSantim: issued.reduce((a, i) => a + i.vatSantim, 0),
    collectedGrossSantim: received.reduce((a, r) => a + r.receipt.amountGrossSantim, 0),
    clientWhtSantim: received.reduce((a, r) => a + r.receipt.clientWhtSantim, 0),
    costNetSantim,
    inputVatSantim: paid.reduce((a, d) => a + d.supplierVatSantim, 0),
    whtWithheldSantim: paid.reduce((a, d) => a + d.whtSantim, 0),
    cashOutSantim: paid.reduce((a, d) => a + d.netPayableSantim, 0),
    marginSantim: invoicedNetSantim - costNetSantim,
    invoiceCount: issued.length,
    voucherCount: paid.length,
    stagesCompleted: stagesCompletedIn(inputs.stages, period).length,
    projectsHandedOver: inputs.projects.filter((p) => p.actualEnd !== null && containsDate(period, p.actualEnd)).length,
    projectsStarted: inputs.projects.filter((p) => p.actualStart !== null && containsDate(period, p.actualStart)).length,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

/**
 * What the report is ABOUT.
 *
 * The whole report answers every question at once, which is right for the
 * monthly read-through and wrong when you are going into a meeting about one
 * thing. A focused report is not a shorter overall report: it drops the
 * sections that are not about its subject, and it keeps the plan items that
 * are, so what is left reads as a document rather than as an extract.
 *
 * `overall` is exactly what the report has always been — nothing is hidden by
 * default, because a reader who does not know this control exists must not be
 * quietly given less than before.
 */
export type ReportFocus = 'overall' | 'clients' | 'finance' | 'contracts' | 'projects';

export const REPORT_FOCUSES: readonly { value: ReportFocus; label: string; hint: string }[] = [
  { value: 'overall', label: 'Overall', hint: 'Everything: money in and out, delivery, trend and risk' },
  { value: 'finance', label: 'Finance', hint: 'Invoiced, collected, what is owed, cost and margin' },
  { value: 'projects', label: 'Projects', hint: 'Live jobs, stages closed, what is late' },
  { value: 'contracts', label: 'Contracts', hint: 'The signed book, what it covers, what is expiring' },
  { value: 'clients', label: 'Clients', hint: 'Who the work is for, and who owes what' },
];

/** Which body sections each focus keeps, in the order they are read. */
const FOCUS_SECTIONS: Record<ReportFocus, readonly string[]> = {
  /*
   * The five sections the overall report has always had, listed rather than
   * left as "everything". Clients and Contracts are new, and quietly adding
   * them here would change the document somebody already prints every month —
   * they are reports in their own right, reached by asking for them.
   */
  overall: ['money-in', 'money-out', 'delivery', 'trend', 'risk'],
  finance: ['money-in', 'money-out', 'trend'],
  projects: ['delivery', 'mix'],
  contracts: ['contracts'],
  clients: ['clients'],
};

/** Which items of the plan ahead belong to each focus. */
const FOCUS_PLAN: Record<ReportFocus, readonly string[] | null> = {
  overall: null,   // the plan ahead is unchanged: every item, as before
  finance: ['plan-cash'],
  projects: ['plan-work', 'plan-priorities'],
  contracts: ['plan-renewals'],
  clients: ['plan-cash', 'plan-renewals'],
};

const FOCUS_TITLE: Record<ReportFocus, string> = {
  overall: '',
  finance: 'finance ',
  projects: 'delivery ',
  contracts: 'contracts ',
  clients: 'clients ',
};

function keep(sections: readonly ReportSection[], allowed: readonly string[] | null): ReportSection[] {
  if (allowed === null) return [...sections];
  // Ordered by the focus, not by the order the sections were built in.
  return allowed.flatMap((id) => sections.filter((section) => section.id === id));
}

export function buildCeoReport(inputs: ReportInputs, focus: ReportFocus = 'overall'): CeoReport {
  const { period, asOf } = inputs;
  const comparison = previousPeriod(period);
  const ahead = nextPeriod(period);
  const noun = PERIOD_NOUN[period.kind];

  const now = totalsFor(inputs, period);
  const before = totalsFor(inputs, comparison);

  const ageing = ageReceivables(
    inputs.invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      clientName: i.clientName,
      dueDate: i.dueDate,
      grossSantim: i.grossSantim,
      receipts: i.receipts.map((r) => ({ amountGrossSantim: r.amountGrossSantim, clientWhtSantim: r.clientWhtSantim })),
      status: i.status,
    })),
    asOf,
  );

  const unlock = buildUnlockReport(
    inputs.stages.map((s) => ({
      projectId: s.projectId,
      projectTitle: s.projectTitle,
      clientName: s.clientName,
      phaseId: s.phaseId,
      stageKey: s.stageKey,
      stageName: s.stageName,
      progressBps: s.progressBps,
      status: s.status,
      dependsOnPhaseIds: s.dependsOnPhaseIds,
      plannedEnd: s.plannedEnd,
    })),
    inputs.milestones.map((m) => ({
      milestoneId: m.milestoneId,
      contractId: m.contractId,
      name: `${m.contractNo}: ${m.name}`,
      phaseId: m.phaseId,
      grossSantim: m.grossSantim,
      status: m.status,
    })),
    asOf,
  );

  const headline: Metric[] = [
    moneyMetric('invoiced', 'Invoiced (net of VAT)', now.invoicedNetSantim, before.invoicedNetSantim, noun, 'higher_is_better'),
    moneyMetric('collected', 'Cash collected', now.collectedGrossSantim, before.collectedGrossSantim, noun, 'higher_is_better'),
    moneyMetric('cost', 'Subcontractor cost', now.costNetSantim, before.costNetSantim, noun, 'lower_is_better'),
    moneyMetric('margin', 'Gross margin', now.marginSantim, before.marginSantim, noun, 'higher_is_better'),
    positionMetric(
      'receivables',
      'Receivables outstanding',
      ageing.totalSantim,
      ageing.overdueSantim > 0 ? `${formatETB(ageing.overdueSantim)} of it is past due.` : 'Nothing is past due.',
      'lower_is_better',
    ),
    countMetric('delivery', 'Stages completed', now.stagesCompleted, before.stagesCompleted, noun, 'higher_is_better'),
    // In the headline of EVERY report, not only the clients one: how much of
    // the book sits with one client is the kind of fact that changes what a
    // month means, and it is invisible in any of the totals above.
    concentrationMetric(clientBook(inputs, ageing)),
  ];

  return {
    companyName: inputs.companyName,
    title:
      `${period.kind === 'week' ? 'Weekly' : period.kind === 'month' ? 'Monthly' : period.kind === 'quarter' ? 'Quarterly' : 'Annual'} ` +
      `${FOCUS_TITLE[focus]}report to the Chief Executive`,
    period,
    comparison,
    ahead,
    generatedAt: asOf,
    periodRange: formatPeriodRange(period),
    executiveSummary: buildExecutiveSummary(inputs, now, before, ageing, unlock, noun),
    headline,
    focus,
    sections: keep(
      [
        moneyInSection(inputs, now, before, ageing, noun),
        moneyOutSection(inputs, now, before, noun),
        deliverySection(inputs, now, before, noun),
        mixSection(inputs),
        clientsSection(inputs, ageing),
        contractsSection(inputs, noun),
        trendSection(inputs),
        // Risk cuts across everything, so it rides with the overall report
        // only; a focused report that ended on somebody else's risks would
        // read as a different document stapled to the back.
        riskSection(inputs, ageing, unlock),
      ],
      FOCUS_SECTIONS[focus],
    ),
    plan: keep(buildPlan(inputs, ahead, unlock, ageing), FOCUS_PLAN[focus]),
  };
}

// ---------------------------------------------------------------------------
// Executive summary
// ---------------------------------------------------------------------------

function buildExecutiveSummary(
  inputs: ReportInputs,
  now: PeriodTotals,
  before: PeriodTotals,
  ageing: AgeingReport,
  unlock: UnlockReport,
  noun: string,
): string[] {
  const out: string[] = [];
  const live = inputs.projects.filter((p) => p.status === 'in_progress').length;

  if (now.invoicedNetSantim === 0 && now.collectedGrossSantim === 0 && now.costNetSantim === 0) {
    out.push(
      `No invoices were issued, no payments received and no subcontractors paid during this ${noun}. ` +
        `That is either a genuinely quiet ${noun} or a sign that paperwork has not been entered — worth confirming before this report goes further.`,
    );
  } else {
    const change = describeChange(now.invoicedNetSantim, before.invoicedNetSantim, noun, 'higher_is_better');
    // The change note names its subject. Trailing it after a sentence that
    // mentions two figures leaves the reader guessing which of them moved.
    const billing = `Billing was ${change.note.charAt(0).toLowerCase()}${change.note.slice(1)}`;
    out.push(
      `We invoiced ${formatETB(now.invoicedNetSantim)} net of VAT across ${plural(now.invoiceCount, 'invoice')} this ${noun}, ` +
        `and collected ${formatETB(now.collectedGrossSantim)} in cash. ${billing} ` +
        `Subcontractor cost was ${formatETB(now.costNetSantim)}, leaving a gross margin of ${formatETB(now.marginSantim)}` +
        `${now.invoicedNetSantim > 0 ? ` (${pct(rateBps(now.marginSantim, now.invoicedNetSantim) ?? 0)} of what we billed)` : ''}.`,
    );
  }

  out.push(
    now.stagesCompleted === 0
      ? `No project stage was recorded as finished this ${noun} across ${plural(live, 'live project')}. Either the crews did not close anything out, or the tracker has not been updated.`
      : `${plural(now.stagesCompleted, 'project stage')} finished this ${noun} across ${plural(live, 'live project')}` +
        `${now.projectsHandedOver > 0 ? `, including ${plural(now.projectsHandedOver, 'handover')}` : ''}.`,
  );

  if (ageing.totalSantim > 0) {
    const over90 = ageing.byBucket.over_90;
    out.push(
      `${formatETB(ageing.totalSantim)} is outstanding from clients, of which ${formatETB(ageing.overdueSantim)} is past due` +
        `${over90 > 0 ? ` and ${formatETB(over90)} is more than ninety days old` : ''}. ` +
        `${over90 > 0 ? 'Debt that old rarely collects itself.' : 'None of it has aged past ninety days.'}`,
    );
  } else {
    out.push('There is nothing outstanding from clients — every issued invoice has been settled.');
  }

  if (unlock.actionableSantim > 0) {
    out.push(
      `${formatETB(unlock.actionableSantim)} of contracted money is sitting behind work our own crews can do now, ` +
        `against ${formatETB(unlock.waitingOnOthersSantim)} waiting on clients, suppliers or the authority. ` +
        `The first number is the one we control.`,
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const BUCKET_SHORT: Record<AgeBucket, string> = {
  current: 'Not due',
  '1_30': '1–30',
  '31_60': '31–60',
  '61_90': '61–90',
  over_90: '90+',
};

const BUCKET_LABEL: Record<AgeBucket, string> = {
  current: 'Not yet due',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
};

function moneyInSection(
  inputs: ReportInputs,
  now: PeriodTotals,
  before: PeriodTotals,
  ageing: AgeingReport,
  noun: string,
): ReportSection {
  const issued = invoicesIssuedIn(inputs.invoices, inputs.period);
  const narrative: string[] = [];

  narrative.push(
    now.invoiceCount === 0
      ? `No invoice was issued this ${noun}.`
      : `${plural(now.invoiceCount, 'invoice')} totalling ${formatETB(now.invoicedNetSantim)} net was issued, ` +
        `carrying ${formatETB(now.outputVatSantim)} of output VAT.`,
  );

  const receipts = receiptsIn(inputs.invoices, inputs.period);
  narrative.push(
    receipts.length === 0
      ? `No client payment was received this ${noun}.`
      : `${plural(receipts.length, 'payment')} came in, totalling ${formatETB(now.collectedGrossSantim)}` +
        `${now.clientWhtSantim > 0 ? `. Clients withheld ${formatETB(now.clientWhtSantim)} of tax at source, which we can claim against our own income tax — the certificates are worth chasing` : ''}.`,
  );

  if (now.invoicedNetSantim > 0) {
    const collectionRate = rateBps(now.collectedGrossSantim, now.invoicedNetSantim + now.outputVatSantim);
    narrative.push(
      `Cash in this ${noun} was ${pct(collectionRate ?? 0)} of what we billed in it. ` +
        `The two rarely match — invoices issued now are collected later — but a rate that stays far below 100% ${noun} after ${noun} means the gap is widening, not shifting.`,
    );
  }

  return {
    id: 'money-in',
    heading: 'Money in',
    narrative,
    metrics: [
      moneyMetric('invoiced-net', 'Invoiced net', now.invoicedNetSantim, before.invoicedNetSantim, noun, 'higher_is_better'),
      moneyMetric('output-vat', 'Output VAT', now.outputVatSantim, before.outputVatSantim, noun, 'neutral'),
      moneyMetric('collected', 'Collected', now.collectedGrossSantim, before.collectedGrossSantim, noun, 'higher_is_better'),
      moneyMetric('client-wht', 'Withheld by clients', now.clientWhtSantim, before.clientWhtSantim, noun, 'neutral'),
    ],
    table: {
      caption: `Invoices issued in ${inputs.period.label}`,
      columns: [
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'clientName', label: 'Client' },
        { key: 'issued', label: 'Issued' },
        { key: 'net', label: 'Net', align: 'right' },
        { key: 'vat', label: 'VAT', align: 'right' },
        { key: 'gross', label: 'Gross', align: 'right' },
        { key: 'balance', label: 'Outstanding', align: 'right' },
      ],
      rows: issued.map((i) => ({
        invoiceNo: i.invoiceNo,
        clientName: i.clientName,
        issued: formatDual(i.issuedAt),
        net: formatETB(i.netSantim),
        vat: formatETB(i.vatSantim),
        gross: formatETB(i.grossSantim),
        balance: formatETB(settle(i.grossSantim, i.receipts).balanceSantim),
      })),
      emptyMessage: `No invoice was issued in ${inputs.period.label}.`,
    },
    chart: {
      id: 'ageing',
      kind: 'bars',
      title: 'Receivables by age',
      subtitle:
        ageing.byBucket.over_90 > 0
          ? `${formatETB(ageing.byBucket.over_90)} has aged past ninety days`
          : 'Nothing has aged past ninety days',
      series: [{ key: 'balance', label: 'Outstanding' }],
      palette: 'ordinal',
      unit: 'santim',
      points: (Object.keys(BUCKET_LABEL) as AgeBucket[]).map((bucket) => ({
        label: BUCKET_LABEL[bucket],
        shortLabel: BUCKET_SHORT[bucket],
        values: { balance: ageing.byBucket[bucket] },
      })),
    },
  };
}

function moneyOutSection(
  inputs: ReportInputs,
  now: PeriodTotals,
  before: PeriodTotals,
  noun: string,
): ReportSection {
  const paid = disbursementsPaidIn(inputs.disbursements, inputs.period);
  const approved = inputs.disbursements.filter((d) => d.status === 'approved');
  // Submitted and awaiting a decision. A draft nobody has sent is not the same
  // thing, and neither is money already authorised.
  const inFlight = inputs.disbursements.filter((d) => d.status === 'requested' || d.status === 'checked');
  const held = inputs.disbursements.filter((d) => d.status === 'on_hold');
  const approvedSantim = approved.reduce((a, d) => a + d.netPayableSantim, 0);
  const inFlightSantim = inFlight.reduce((a, d) => a + d.netPayableSantim, 0);
  const heldSantim = held.reduce((a, d) => a + d.netPayableSantim, 0);
  const netVat = now.outputVatSantim - now.inputVatSantim;

  const narrative: string[] = [];

  narrative.push(
    now.voucherCount === 0
      ? `No subcontractor was paid this ${noun}.`
      : `${plural(now.voucherCount, 'payment voucher')} was settled, ${formatETB(now.costNetSantim)} net of VAT. ` +
        `We withheld ${formatETB(now.whtWithheldSantim)} of tax at source and actually paid out ${formatETB(now.cashOutSantim)}.`,
  );

  narrative.push(
    netVat >= 0
      ? `VAT position for the ${noun}: ${formatETB(now.outputVatSantim)} output less ${formatETB(now.inputVatSantim)} input, leaving ${formatETB(netVat)} payable to ERCA.`
      : `VAT position for the ${noun}: ${formatETB(now.inputVatSantim)} input exceeds ${formatETB(now.outputVatSantim)} output, leaving ${formatETB(-netVat)} reclaimable.`,
  );

  if (approved.length > 0) {
    narrative.push(
      `${plural(approved.length, 'payment voucher is', 'payment vouchers are')} approved and unpaid, worth ${formatETB(approvedSantim)}. ` +
        `That is committed cash, not a decision still open.`,
    );
  }

  if (inFlight.length > 0) {
    narrative.push(
      `A further ${plural(inFlight.length, 'voucher')} worth ${formatETB(inFlightSantim)} has been submitted and is waiting on verification or approval. ` +
        `Those are still decisions — approving them is what turns them into commitments.`,
    );
  }

  if (held.length > 0) {
    narrative.push(
      `${plural(held.length, 'voucher is', 'vouchers are')} on hold, worth ${formatETB(heldSantim)}. ` +
        `A hold is somebody waiting on us, and subcontractors notice.`,
    );
  }

  return {
    id: 'money-out',
    heading: 'Money out',
    narrative,
    metrics: [
      moneyMetric('cost-net', 'Subcontractor cost (net)', now.costNetSantim, before.costNetSantim, noun, 'lower_is_better'),
      moneyMetric('input-vat', 'Input VAT', now.inputVatSantim, before.inputVatSantim, noun, 'neutral'),
      moneyMetric('wht', 'WHT withheld from subcontractors', now.whtWithheldSantim, before.whtWithheldSantim, noun, 'neutral'),
      moneyMetric('cash-out', 'Cash actually paid out', now.cashOutSantim, before.cashOutSantim, noun, 'lower_is_better'),
    ],
    table: {
      caption: `Subcontractor payments in ${inputs.period.label}`,
      columns: [
        { key: 'voucherNo', label: 'Voucher' },
        { key: 'subcontractor', label: 'Subcontractor' },
        { key: 'paid', label: 'Paid' },
        { key: 'net', label: 'Net', align: 'right' },
        { key: 'wht', label: 'WHT', align: 'right' },
        { key: 'payable', label: 'Paid out', align: 'right' },
      ],
      rows: paid.map((d) => ({
        voucherNo: d.voucherNo,
        subcontractor: d.subcontractorName,
        paid: d.paidAt === null ? '—' : formatDual(d.paidAt),
        net: formatETB(d.netSantim),
        wht: formatETB(d.whtSantim),
        payable: formatETB(d.netPayableSantim),
      })),
      emptyMessage: `No subcontractor payment was settled in ${inputs.period.label}.`,
    },
  };
}


/**
 * Who the work is for, and who owes what.
 *
 * Grouped by client NAME, because that is the only client key the report
 * inputs carry. Two clients with the same name would merge — worth knowing,
 * and not worth a second identifier on five input types to avoid.
 *
 * The figure worth an executive's attention is CONCENTRATION: not how much the
 * biggest client is worth, but what share of the book it is. One client at
 * 60% is a different company from twelve at 8% each, and the totals alone do
 * not show the difference.
 */
interface ClientBookRow {
  name: string;
  contractGrossSantim: number;
  outstandingSantim: number;
  liveProjects: number;
  contracts: number;
}

interface ClientBook {
  rows: ClientBookRow[];
  bookTotal: number;
  owedTotal: number;
  largest: ClientBookRow | null;
  /** The largest client's share of the signed book, or null when there is none. */
  largestShareBps: number | null;
}

/** Above this share, one client leaving takes a serious part of the work with it. */
const CONCENTRATION_BPS = 4000;

/**
 * The book, by client.
 *
 * Shared by the headline figure and the Clients section so the two cannot
 * disagree about who the biggest client is or what share they are.
 *
 * Grouped by client NAME, because that is the only client key the report
 * inputs carry. Two clients with the same name would merge — worth knowing,
 * and not worth a second identifier on five input types to avoid.
 */
function clientBook(inputs: ReportInputs, ageing: AgeingReport): ClientBook {
  const byName = new Map<string, ClientBookRow>();
  const row = (name: string): ClientBookRow => {
    const found = byName.get(name);
    if (found !== undefined) return found;
    const created: ClientBookRow = {
      name, contractGrossSantim: 0, outstandingSantim: 0, liveProjects: 0, contracts: 0,
    };
    byName.set(name, created);
    return created;
  };

  for (const contract of inputs.contracts) {
    if (contract.status === 'cancelled' || contract.status === 'draft') continue;
    const r = row(contract.clientName);
    r.contractGrossSantim += contract.valueGrossSantim;
    r.contracts += 1;
  }
  for (const project of inputs.projects) {
    if (project.status === 'in_progress') row(project.clientName).liveProjects += 1;
  }
  for (const aged of ageing.rows) {
    row(aged.clientName).outstandingSantim += aged.balanceSantim;
  }

  const rows = [...byName.values()].sort(
    (a, b) => b.contractGrossSantim - a.contractGrossSantim || a.name.localeCompare(b.name),
  );
  const bookTotal = rows.reduce((sum, r) => sum + r.contractGrossSantim, 0);
  const largest = rows[0] ?? null;

  return {
    rows,
    bookTotal,
    owedTotal: rows.reduce((sum, r) => sum + r.outstandingSantim, 0),
    largest,
    largestShareBps:
      largest === null || bookTotal <= 0
        ? null
        : Math.round((largest.contractGrossSantim / bookTotal) * 10_000),
  };
}

/**
 * How much of the book sits with one client.
 *
 * Carried in the HEADLINE of every report, not only the clients one. It is a
 * position rather than a flow, so like receivables it gets no arrow: there is
 * no stored "last month's concentration", and re-deriving one would be a
 * different calculation wearing the same label.
 *
 * The figure that matters is the SHARE, not the size. One client at 60% is a
 * different company from twelve at 8% each, and no total shows that.
 */
function concentrationMetric(book: ClientBook): Metric {
  const share = book.largestShareBps;
  return {
    key: 'concentration',
    label: 'Largest client',
    value: share === null ? '—' : pct(share),
    santim: null,
    previousValue: null,
    changeBps: null,
    direction: null,
    polarity: 'lower_is_better',
    note:
      share === null || book.largest === null
        ? 'No signed contract value to divide between clients.'
        : share >= CONCENTRATION_BPS
          ? `${book.largest.name}. Losing them would take ${pct(share)} of the signed book with it.`
          : `${book.largest.name}. No single client dominates the book.`,
  };
}

/**
 * Who the work is for, and who owes what.
 *
 * The figure worth an executive's attention is CONCENTRATION: not how much the
 * biggest client is worth, but what share of the book it is.
 */
function clientsSection(inputs: ReportInputs, ageing: AgeingReport): ReportSection {
  const book = clientBook(inputs, ageing);
  const { rows, bookTotal, owedTotal, largest, largestShareBps: share } = book;

  const narrative: string[] = [];
  if (rows.length === 0) {
    narrative.push('No client has a contract, a live project or an unpaid invoice against them.');
  } else {
    narrative.push(
      `${plural(rows.length, 'client')} on the book, carrying ${formatETB(bookTotal)} of signed contract value ` +
        `and ${formatETB(owedTotal)} outstanding.`,
    );
    if (largest !== null && share !== null) {
      narrative.push(
        share >= CONCENTRATION_BPS
          ? `${largest.name} is ${pct(share)} of the signed book on its own. That is concentration worth naming out loud: losing one client would take ${pct(share)} of the work with it.`
          : `The largest client, ${largest.name}, is ${pct(share)} of the signed book — no single client dominates it.`,
      );
    }
    const owing = rows.filter((r) => r.outstandingSantim > 0).length;
    if (owing > 0) narrative.push(`${plural(owing, 'client owes', 'clients owe')} money against an issued invoice.`);
  }

  return {
    id: 'clients',
    heading: 'Clients',
    narrative,
    table: {
      caption: 'Clients by signed value',
      columns: [
        { key: 'name', label: 'Client' },
        { key: 'contracts', label: 'Contracts', align: 'right' },
        { key: 'value', label: 'Signed value', align: 'right' },
        { key: 'live', label: 'Live projects', align: 'right' },
        { key: 'owed', label: 'Outstanding', align: 'right' },
      ],
      rows: rows.map((r) => ({
        name: r.name,
        contracts: String(r.contracts),
        value: formatETB(r.contractGrossSantim),
        live: String(r.liveProjects),
        owed: r.outstandingSantim === 0 ? '—' : formatETB(r.outstandingSantim),
      })),
      emptyMessage: 'No client records yet.',
    },
  };
}

/**
 * The signed book: what is on it, and what is running out.
 *
 * A contract's END DATE is the thing this section exists for. Work gets
 * delivered whether or not anybody reads a report; a contract quietly reaching
 * its end date does not announce itself, and the renewal conversation has to
 * start before it does.
 */
function contractsSection(inputs: ReportInputs, noun: string): ReportSection {
  const live = inputs.contracts.filter((c) => c.status === 'active');
  const ended = inputs.contracts.filter((c) => c.endDate < inputs.asOf && c.status === 'active');
  const signedValue = live.reduce((sum, c) => sum + c.valueGrossSantim, 0);

  const byType = new Map<string, { count: number; santim: number }>();
  for (const contract of live) {
    const key = contract.type.replace(/_/g, ' ');
    const found = byType.get(key) ?? { count: 0, santim: 0 };
    found.count += 1;
    found.santim += contract.valueGrossSantim;
    byType.set(key, found);
  }

  const narrative: string[] = [];
  if (live.length === 0) {
    narrative.push('No contract is currently active.');
  } else {
    narrative.push(
      `${plural(live.length, 'active contract')} worth ${formatETB(signedValue)} gross.` +
        (byType.size > 1
          ? ` By type: ${[...byType.entries()]
              .sort((a, b) => b[1].santim - a[1].santim)
              .map(([type, t]) => `${plural(t.count, type)} at ${formatETB(t.santim)}`)
              .join('; ')}.`
          : ''),
    );
  }

  if (ended.length > 0) {
    narrative.push(
      `${plural(ended.length, 'contract is', 'contracts are')} still marked active with an end date already in the past. ` +
        'Either the term was extended and nobody recorded it, or it lapsed and the work is running uncovered.',
    );
  }

  const soon = inputs.contracts
    .filter((c) => c.status === 'active' && c.endDate >= inputs.asOf)
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());

  return {
    id: 'contracts',
    heading: 'Contracts',
    narrative: [
      ...narrative,
      soon.length === 0
        ? `No active contract runs past today, so nothing is due to be renewed this ${noun}.`
        : `The nearest end date is ${formatDual(soon[0]!.endDate)}.`,
    ],
    table: {
      caption: 'Active contracts, soonest to end first',
      columns: [
        { key: 'contractNo', label: 'Contract' },
        { key: 'client', label: 'Client' },
        { key: 'type', label: 'Type' },
        { key: 'value', label: 'Value (gross)', align: 'right' },
        { key: 'ends', label: 'Ends' },
      ],
      rows: [...live]
        .sort((a, b) => a.endDate.getTime() - b.endDate.getTime())
        .map((c) => ({
          contractNo: c.contractNo,
          client: c.clientName,
          type: c.type.replace(/_/g, ' '),
          value: formatETB(c.valueGrossSantim),
          ends: formatDual(c.endDate),
        })),
      emptyMessage: 'No active contract.',
    },
  };
}

function deliverySection(
  inputs: ReportInputs,
  now: PeriodTotals,
  before: PeriodTotals,
  noun: string,
): ReportSection {
  const completed = stagesCompletedIn(inputs.stages, inputs.period);
  const live = inputs.projects.filter((p) => p.status === 'in_progress');
  const overdue = live.filter((p) => p.plannedEnd < inputs.asOf);
  const onHold = inputs.projects.filter((p) => p.status === 'on_hold');

  const narrative: string[] = [];

  narrative.push(
    completed.length === 0
      ? `Nothing was recorded as finished this ${noun}. On ${plural(live.length, 'live project')}, that is worth asking about directly: an unmoved tracker and an unmoved site look identical from here.`
      : `${plural(completed.length, 'stage')} was closed out across ${plural(new Set(completed.map((s) => s.projectId)).size, 'project')}.`,
  );

  if (overdue.length > 0) {
    // The COUNT is the fact; naming each one was a comma-separated copy of the
    // Live projects table directly below, which carries the planned end date
    // for every row anyway. Two lists of the same projects means checking one
    // against the other to see whether they agree.
    narrative.push(
      `${plural(overdue.length, 'live project is', 'live projects are')} past the planned completion date. ` +
        'They are in the table below, with the dates they were due.',
    );
  } else if (live.length > 0) {
    narrative.push('Every live project is still inside its planned end date.');
  }

  // Said only where there IS other work. A company that only installs lifts
  // should not read "0 jobs are not lift work" every month.
  const mixLine = describeMix(workMix(inputs.projects));
  if (mixLine !== null) narrative.push(mixLine);

  if (onHold.length > 0) {
    narrative.push(`${plural(onHold.length, 'project is', 'projects are')} on hold and consuming no crew time, but still carrying contract value.`);
  }

  const stagesBefore = before.stagesCompleted;
  const change = describeChange(now.stagesCompleted, stagesBefore, noun, 'higher_is_better');

  return {
    id: 'delivery',
    heading: 'Delivery',
    narrative: [...narrative, change.note],
    table: {
      caption: 'Live projects',
      columns: [
        { key: 'projectNo', label: 'Project' },
        { key: 'title', label: 'Title' },
        { key: 'kind', label: 'Kind' },
        { key: 'client', label: 'Client' },
        { key: 'progress', label: 'Progress', align: 'right' },
        { key: 'contract', label: 'Contract value', align: 'right' },
        { key: 'due', label: 'Planned end' },
      ],
      rows: live.map((p) => ({
        projectNo: p.projectNo,
        title: p.title,
        kind: projectTypeShort(p.type),
        client: p.clientName,
        progress: pct(p.progressBps),
        contract: formatETB(p.contractNetSantim),
        due: formatDual(p.plannedEnd),
      })),
      emptyMessage: 'No project is currently in progress.',
    },
    chart: {
      id: 'progress',
      kind: 'bars',
      title: 'Progress by live project',
      subtitle:
        overdue.length > 0
          ? `${plural(overdue.length, 'project is', 'projects are')} past the planned end date`
          : 'All inside the planned end date',
      series: [{ key: 'progress', label: 'Complete' }],
      palette: 'single',
      unit: 'count',
      points: live.map((p) => ({
        label: `${p.projectNo} ${p.title}`,
        shortLabel: p.projectNo,
        values: { progress: Math.round(p.progressBps / 100) },
      })),
    },
  };
}

/**
 * What kind of work the portfolio is.
 *
 * Carried by the DELIVERY focus, not by the overall report. The overall report
 * is a document somebody prints every month and reads the same way each time;
 * quietly adding a section to it changes that document. Asking for the delivery
 * report is asking for the detail, and this is the detail.
 *
 * The rows are jobs in hand — cancelled and terminated are dropped by
 * `workMix`, because a portfolio that counts them describes a bigger business
 * than the one that exists.
 */
function mixSection(inputs: ReportInputs): ReportSection {
  const mix = workMix(inputs.projects);
  const chart = mixChart(mix);

  const narrative: string[] = [];
  if (mix.projects === 0) {
    narrative.push('There is no project in hand to break down.');
  } else if (!mix.hasOtherWork) {
    narrative.push(
      `All ${plural(mix.projects, 'project')} in hand is lift work. ` +
        'When a job outside that is taken on, set its kind on the project and it will report here separately.',
    );
  } else {
    narrative.push(describeMix(mix) ?? '');
    narrative.push(
      `Lift work is ${plural(mix.elevator.projects, 'job')} worth ${formatETB(mix.elevator.valueNetSantim)}; ` +
        `everything else is ${plural(mix.other.projects, 'job')} worth ${formatETB(mix.other.valueNetSantim)}. ` +
        'Both are in the table below, split by what the work actually is.',
    );
  }

  return {
    id: 'mix',
    heading: 'What the work is',
    narrative: narrative.filter((line) => line !== ''),
    table: {
      caption: 'Projects in hand, by kind of work',
      columns: [
        { key: 'kind', label: 'Kind of work' },
        { key: 'projects', label: 'Projects', align: 'right' },
        { key: 'value', label: 'Value', align: 'right' },
        { key: 'share', label: 'Share of portfolio', align: 'right' },
        { key: 'progress', label: 'Progress', align: 'right' },
      ],
      rows: mix.rows.map((row) => ({
        kind: row.label,
        projects: String(row.projects),
        value: formatETB(row.valueNetSantim),
        // A share of nothing is not 0%: printing it reads as "this work is
        // worth nothing" rather than "nothing here carries a figure yet".
        share: row.shareBps === null ? 'no value recorded' : pct(row.shareBps),
        progress: row.progressBps === null ? '—' : pct(row.progressBps),
      })),
      emptyMessage: 'No project is in hand.',
    },
    ...(chart === undefined ? {} : { chart }),
  };
}

/** The same split as a chart, where there is more than one kind to compare. */
function mixChart(mix: WorkMix): ChartSpec | undefined {
  if (mix.rows.length < 2) return undefined;
  return {
    id: 'mix',
    kind: 'bars',
    title: 'Portfolio value by kind of work',
    subtitle: `${plural(mix.projects, 'project')} in hand, worth ${formatETB(mix.valueNetSantim)}`,
    series: [{ key: 'value', label: 'Value' }],
    palette: 'single',
    unit: 'santim',
    points: mix.rows.map((row) => ({
      label: row.label,
      shortLabel: row.label,
      values: { value: row.valueNetSantim },
    })),
  };
}

/**
 * The trailing trend.
 *
 * Six periods, because three is not a trend and twelve weeks of bars is a
 * texture rather than a chart. Empty periods are drawn as empty, never skipped —
 * a gap that reads as a smooth line is the one distortion a trend must not have.
 */
function trendSection(inputs: ReportInputs): ReportSection {
  const periods = trailingPeriods(inputs.period, 6);
  const points: SeriesPoint[] = periods.map((p) => {
    const totals = totalsFor(inputs, p);
    return {
      label: p.label,
      shortLabel: p.shortLabel,
      values: { revenue: totals.invoicedNetSantim, cost: totals.costNetSantim },
    };
  });

  const withActivity = points.filter((p) => (p.values.revenue ?? 0) > 0 || (p.values.cost ?? 0) > 0).length;
  const narrative: string[] =
    withActivity === 0
      ? [`Nothing was invoiced or paid in any of the last six ${PERIOD_NOUN[inputs.period.kind]}s on record.`]
      : [
          `Revenue and cost over the last six ${PERIOD_NOUN[inputs.period.kind]}s, ${withActivity} of which had activity. ` +
            `The gap between the two bars is gross margin; where cost approaches revenue the work was priced too thin, subcontracted too widely, or overran.`,
        ];

  return {
    id: 'trend',
    heading: 'Trend',
    narrative,
    chart: {
      id: 'trend',
      kind: 'grouped_bars',
      title: `Revenue and cost, last six ${PERIOD_NOUN[inputs.period.kind]}s`,
      subtitle: 'Invoiced net of VAT against subcontractor cost',
      series: [
        { key: 'revenue', label: 'Invoiced (net)' },
        { key: 'cost', label: 'Subcontractor cost' },
      ],
      palette: 'categorical',
      unit: 'santim',
      points,
    },
  };
}

function riskSection(inputs: ReportInputs, ageing: AgeingReport, unlock: UnlockReport): ReportSection {
  const narrative: string[] = [];
  const stalled = unlock.rows.filter((r) => r.overdue && r.actionable);
  const blocked = unlock.rows.filter((r) => r.blockedByPhaseIds.length > 0 && r.gatedSantim > 0);

  if (ageing.byBucket.over_90 > 0) {
    const worst = ageing.rows.filter((r) => r.bucket === 'over_90').sort((a, b) => b.balanceSantim - a.balanceSantim);
    narrative.push(
      `${formatETB(ageing.byBucket.over_90)} is more than ninety days overdue` +
        `${worst[0] !== undefined ? `, the largest being ${worst[0].invoiceNo} from ${worst[0].clientName} at ${formatETB(worst[0].balanceSantim)}, ${worst[0].daysOverdue} days late` : ''}.`,
    );
  }

  if (stalled.length > 0) {
    narrative.push(
      `${plural(stalled.length, 'stage is', 'stages are')} past the planned end date and ours to finish, ` +
        `holding ${formatETB(stalled.reduce((a, r) => a + r.gatedSantim, 0))} of contracted money.`,
    );
  }

  if (blocked.length > 0) {
    narrative.push(
      `${formatETB(unlock.blockedSantim)} sits behind stages whose predecessors are unfinished. ` +
        `Sequencing, not capacity, is what releases that money.`,
    );
  }

  const renewals = inputs.contracts.filter(
    (c) => c.status === 'active' && c.renewalAlertAt !== null && c.renewalAlertAt <= inputs.asOf,
  );
  if (renewals.length > 0) {
    narrative.push(
      `${plural(renewals.length, 'maintenance contract is', 'maintenance contracts are')} inside the renewal window, ` +
        `worth ${formatETB(renewals.reduce((a, c) => a + c.valueGrossSantim, 0))} a year. A lapsed renewal is revenue that simply stops.`,
    );
  }

  if (narrative.length === 0) narrative.push('Nothing meets the reporting thresholds for risk this period.');

  return {
    id: 'risk',
    heading: 'What needs attention',
    narrative,
    table: {
      caption: 'Overdue receivables',
      columns: [
        { key: 'invoiceNo', label: 'Invoice' },
        { key: 'client', label: 'Client' },
        { key: 'due', label: 'Due' },
        { key: 'days', label: 'Days late', align: 'right' },
        { key: 'balance', label: 'Outstanding', align: 'right' },
      ],
      rows: ageing.rows
        .filter((r) => r.daysOverdue > 0)
        .sort((a, b) => b.balanceSantim - a.balanceSantim)
        .map((r) => ({
          invoiceNo: r.invoiceNo,
          client: r.clientName,
          due: formatDual(r.dueDate),
          days: String(r.daysOverdue),
          balance: formatETB(r.balanceSantim),
        })),
      emptyMessage: 'Nothing is past due.',
    },
  };
}

// ---------------------------------------------------------------------------
// The plan for next period
// ---------------------------------------------------------------------------

function buildPlan(
  inputs: ReportInputs,
  ahead: Period,
  unlock: UnlockReport,
  ageing: AgeingReport,
): ReportSection[] {
  const noun = PERIOD_NOUN[ahead.kind];

  // Work scheduled to finish in the window ahead.
  const due = inputs.stages
    .filter((s) => s.status !== 'completed' && s.plannedEnd !== null && containsDate(ahead, s.plannedEnd))
    .sort((a, b) => (a.plannedEnd as Date).getTime() - (b.plannedEnd as Date).getTime());

  const gatedByDue = new Map(unlock.rows.map((r) => [r.phaseId, r.gatedSantim]));
  const scheduledCash = due.reduce((a, s) => a + (gatedByDue.get(s.phaseId) ?? 0), 0);

  // Cash we should be able to collect: invoices falling due in the window, plus
  // everything already overdue, which does not get less collectable by waiting.
  const fallingDue = ageing.rows.filter((r) => containsDate(ahead, r.dueDate));
  const collectable = fallingDue.reduce((a, r) => a + r.balanceSantim, 0) + ageing.overdueSantim;

  // Approved and unpaid only. A draft voucher can still be refused, so counting
  // it as committed cash would overstate what next period is already spent.
  const commitments = inputs.disbursements.filter((d) => d.status === 'approved');
  const committedSantim = commitments.reduce((a, d) => a + d.netPayableSantim, 0);

  const renewals = inputs.contracts.filter((c) => c.status === 'active' && containsDate(ahead, c.endDate));

  const topUnlock = unlock.rows.filter((r) => r.actionable && r.gatedSantim > 0).slice(0, 8);

  const plan: ReportSection[] = [];

  plan.push({
    id: 'plan-cash',
    heading: `Cash plan for ${ahead.label}`,
    narrative: [
      collectable > 0
        ? `${formatETB(collectable)} should be collectable in the ${noun} ahead: ${formatETB(ageing.overdueSantim)} already past due and ${formatETB(collectable - ageing.overdueSantim)} falling due inside the window.`
        : `No invoice falls due in the ${noun} ahead and nothing is currently past due, so collections depend entirely on what we invoice during it.`,
      committedSantim > 0
        ? `${formatETB(committedSantim)} is already committed to subcontractors across ${plural(commitments.length, 'approved payment')}. That is the floor under next ${noun}'s cash out, before anything new is approved.`
        : `Nothing is currently committed to subcontractors, so cash out next ${noun} is whatever we choose to approve.`,
      scheduledCash > 0
        ? `${formatETB(scheduledCash)} of contract milestones is gated on stages scheduled to finish in the window. Finishing them is what turns that into an invoice.`
        : 'No payment milestone is gated on work scheduled to finish in the window ahead.',
    ],
    metrics: [
      positionMetric('collectable', 'Collectable', collectable, 'Overdue plus falling due in the window.', 'higher_is_better'),
      positionMetric('committed', 'Committed out', committedSantim, 'Approved, not yet paid.', 'lower_is_better'),
      positionMetric('unlockable', 'Unlockable by finishing work', scheduledCash, 'Milestones gated on stages due in the window.', 'higher_is_better'),
    ],
  });

  plan.push({
    id: 'plan-work',
    heading: `Work scheduled for ${ahead.label}`,
    narrative: [
      due.length === 0
        ? `No stage is scheduled to finish in the ${noun} ahead. On a live portfolio that usually means the plan dates have not been maintained rather than that nothing is happening.`
        : `${plural(due.length, 'stage is', 'stages are')} scheduled to finish, across ${plural(new Set(due.map((s) => s.projectId)).size, 'project')}.`,
      ...(due.filter((s) => stageOwner(s.stageKey) !== 'us').length > 0
        ? [
            `${plural(due.filter((s) => stageOwner(s.stageKey) !== 'us').length, 'of them depends', 'of them depend')} on a client, supplier or the authority rather than on us. ` +
              `Those need chasing now, not at the end of the ${noun}.`,
          ]
        : []),
    ],
    table: {
      caption: `Stages due to finish in ${ahead.label}`,
      columns: [
        { key: 'project', label: 'Project' },
        { key: 'stage', label: 'Stage' },
        { key: 'owner', label: 'Waiting on' },
        { key: 'progress', label: 'Done', align: 'right' },
        { key: 'due', label: 'Planned end' },
        { key: 'gated', label: 'Payment gated', align: 'right' },
      ],
      rows: due.map((s) => ({
        project: s.projectTitle,
        stage: s.stageName,
        owner: stageOwner(s.stageKey),
        progress: pct(s.progressBps),
        due: s.plannedEnd === null ? '—' : formatDual(s.plannedEnd),
        gated: formatETB(gatedByDue.get(s.phaseId) ?? 0),
      })),
      emptyMessage: `No stage is scheduled to finish in ${ahead.label}.`,
    },
  });

  plan.push({
    id: 'plan-priorities',
    heading: 'Where to put the crews first',
    narrative: [
      topUnlock.length === 0
        ? 'No unfinished stage that our own crews can act on is holding a payment milestone.'
        : `Ranked by cash released per unit of work still required, not by contract size. A stage nearly finished holding ${formatETB(topUnlock[0]?.gatedSantim ?? 0)} beats a barely-started one holding more.`,
    ],
    table: {
      caption: 'Highest-yield unfinished work',
      columns: [
        { key: 'project', label: 'Project' },
        { key: 'stage', label: 'Stage' },
        { key: 'progress', label: 'Done', align: 'right' },
        { key: 'gated', label: 'Releases', align: 'right' },
        { key: 'blocked', label: 'Blocked by' },
      ],
      rows: topUnlock.map((r) => ({
        project: r.projectTitle,
        stage: r.stageName,
        progress: pct(r.progressBps),
        gated: formatETB(r.gatedSantim),
        blocked: r.blockedByPhaseIds.length === 0 ? '—' : `${plural(r.blockedByPhaseIds.length, 'stage')}`,
      })),
      emptyMessage: 'Nothing our crews can act on is holding a payment.',
    },
  });

  if (renewals.length > 0) {
    plan.push({
      id: 'plan-renewals',
      heading: `Contracts expiring in ${ahead.label}`,
      narrative: [
        `${plural(renewals.length, 'contract')} worth ${formatETB(renewals.reduce((a, c) => a + c.valueGrossSantim, 0))} expires inside the window. ` +
          `Renewal is cheaper than replacement: a maintenance client lost is recurring revenue that stops and a lift someone else now services.`,
      ],
      table: {
        caption: 'Expiring contracts',
        columns: [
          { key: 'contractNo', label: 'Contract' },
          { key: 'client', label: 'Client' },
          { key: 'ends', label: 'Ends' },
          { key: 'value', label: 'Annual value', align: 'right' },
        ],
        rows: renewals.map((c) => ({
          contractNo: c.contractNo,
          client: c.clientName,
          ends: formatDual(c.endDate),
          value: formatETB(c.valueGrossSantim),
        })),
        emptyMessage: 'No contract expires in the window.',
      },
    });
  }

  return plan;
}

/**
 * Where we are through the period, for a report run mid-period.
 *
 * A month-to-date report showing 40% of target at the 70% mark is a different
 * message from the same number at the 35% mark, and the reader cannot tell which
 * without being told.
 */
export function periodProgressNote(period: Period, asOf: Date): string | null {
  const elapsed = periodElapsedBps(period, asOf);
  if (elapsed >= 10_000) return null;
  return `This ${PERIOD_NOUN[period.kind]} is ${pct(elapsed)} elapsed — the figures below are ${period.label} to date, not a full ${PERIOD_NOUN[period.kind]}.`;
}

/** Compact ETB for a chart axis: 4.2M, 850k, 0. */
export function compactBirr(santim: number): string {
  const birr = santimToBirr(santim);
  if (birr === 0) return '0';
  const abs = Math.abs(birr);
  if (abs >= 1_000_000) return `${(birr / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(birr / 1_000)}k`;
  return String(Math.round(birr));
}
