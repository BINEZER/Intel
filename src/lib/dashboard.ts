/**
 * The dashboard: what the business looks like this morning.
 *
 * TWO JOBS, AND THE SECOND IS THE ONE USUALLY SKIPPED
 *
 *   1. When there IS data, show the few figures that would change what someone
 *      does today — money in, money out, what is overdue, what is at risk.
 *
 *   2. When there is NOT, say so and say what to enter first. A dashboard of
 *      zeros on a new system is indistinguishable from a broken one: the reader
 *      cannot tell whether the business had a quiet month or whether nothing is
 *      wired up. Every empty figure here is either labelled as empty or replaced
 *      by the step that would fill it.
 *
 * Nothing on this page is stored. Every figure is derived from the records as
 * they stand, so a dashboard can never disagree with the pages behind it.
 */

import { ageReceivables, type AgeingReport } from './invoicing.js';
import { buildPayoutPipeline, type PayoutPipeline, type PayoutVoucher } from './payout-workflow.js';
import { summariseChase, type ChaseInvoice, type ChaseState, type ChaseSummary } from './collection-chase.js';
import { rateBps } from './kpi.js';
import { containsDate, periodContaining, type Period } from './period.js';
import type { RateBps, RiskSeverity } from './schema.js';
import type { ProjectStatusValue } from './status.js';

// ---------------------------------------------------------------------------
// Getting started
// ---------------------------------------------------------------------------

export interface SetupStep {
  key: string;
  label: string;
  /** Why this one comes before the others. */
  detail: string;
  href: string;
  count: number;
  done: boolean;
}

export interface SetupCounts {
  clients: number;
  contracts: number;
  projects: number;
  invoices: number;
  units: number;
  subcontractors: number;
  technicians: number;
}

export interface SetupState {
  steps: SetupStep[];
  /** True once the records needed for the figures above exist. */
  ready: boolean;
  /** Nothing at all has been entered — a brand-new system, not a quiet month. */
  empty: boolean;
  completed: number;
  nextStep: SetupStep | null;
}

/**
 * What to enter first, and why that order.
 *
 * The order is not arbitrary and is not alphabetical: each step is the thing
 * the next one needs. A project with no client cannot be invoiced; an invoice
 * with no contract has no milestone to draw down. Starting in the wrong place
 * means re-entering work, which is how people conclude a system is not worth
 * the trouble.
 */
export function setupProgress(counts: SetupCounts): SetupState {
  const steps: SetupStep[] = [
    {
      key: 'clients',
      label: 'Add your clients',
      detail: 'Everything else hangs off a client — contracts, projects, invoices. Start here or you will re-enter names.',
      href: '/clients',
      count: counts.clients,
      done: counts.clients > 0,
    },
    {
      key: 'contracts',
      label: 'Enter a contract',
      detail: 'The contract carries the value, the VAT and the payment milestones. Those milestones are what the whole cash forecast is built from.',
      href: '/contracts',
      count: counts.contracts,
      done: counts.contracts > 0,
    },
    {
      key: 'projects',
      label: 'Create the project',
      detail: 'Pick the kind of job and its stages are created for you. Progress, risk and the finish-next ranking all come from the stages.',
      href: '/projects',
      count: counts.projects,
      done: counts.projects > 0,
    },
    {
      key: 'invoices',
      label: 'Raise an invoice',
      detail: 'Revenue, VAT, receivables and the whole collections view start with an issued invoice.',
      href: '/finance',
      count: counts.invoices,
      done: counts.invoices > 0,
    },
    {
      key: 'units',
      label: 'Register the lifts',
      detail: 'A lift outlives the project that installed it. Callouts, maintenance and certificates attach to the machine.',
      href: '/units',
      count: counts.units,
      done: counts.units > 0,
    },
    {
      key: 'people',
      label: 'Add technicians and subcontractors',
      detail: 'Performance, incentives and the payout workflow need people to attach to.',
      href: '/performance',
      count: counts.technicians + counts.subcontractors,
      done: counts.technicians + counts.subcontractors > 0,
    },
  ];

  const completed = steps.filter((s) => s.done).length;

  return {
    steps,
    // The first four are what the money figures need. Lifts and people make the
    // service and incentive pages work but no headline figure depends on them.
    ready: steps.slice(0, 4).every((s) => s.done),
    empty: completed === 0,
    completed,
    nextStep: steps.find((s) => !s.done) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------

export interface DashboardInvoice {
  id: string;
  invoiceNo: string;
  clientName: string;
  issuedAt: Date;
  dueDate: Date;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  receipts: readonly { receivedAt: Date; amountGrossSantim: number; clientWhtSantim: number }[];
}

export interface DashboardProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  status: ProjectStatusValue;
  progressBps: number;
  plannedEnd: Date;
  inDanger: boolean;
  severity: RiskSeverity | 'none';
}

export interface DashboardInputs {
  asOf: Date;
  counts: SetupCounts;
  invoices: readonly DashboardInvoice[];
  projects: readonly DashboardProject[];
  vouchers: readonly PayoutVoucher[];
  chase: readonly { invoice: ChaseInvoice; state: ChaseState }[];
  /** Alerts already built by the alerts engine, counted here by severity. */
  alerts: readonly { severity: RiskSeverity }[];
  unitsNeedingAttention: number;
}

export interface MoneyFigure {
  key: string;
  label: string;
  santim: number;
  /** What the number means, in one clause. Shown under it, always. */
  note: string;
  /** True when there is genuinely nothing to report, rather than a zero total. */
  empty: boolean;
  href: string;
}

export interface DashboardModel {
  setup: SetupState;
  period: Period;
  money: MoneyFigure[];
  ageing: AgeingReport;
  payouts: PayoutPipeline;
  chase: ChaseSummary;
  delivery: {
    live: number;
    inDanger: number;
    overdue: number;
    completedThisMonth: number;
    averageProgressBps: number | null;
  };
  alerts: { critical: number; high: number; total: number };
  unitsNeedingAttention: number;
  /** The two or three sentences worth reading if nothing else is. */
  headline: string[];
}

export function buildDashboard(inputs: DashboardInputs): DashboardModel {
  const { asOf } = inputs;
  const setup = setupProgress(inputs.counts);
  const period = periodContaining('month', 'gregorian', asOf);

  const billed = inputs.invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const issuedThisMonth = billed.filter((i) => containsDate(period, i.issuedAt));

  const collectedThisMonth = billed
    .flatMap((i) => i.receipts)
    .filter((r) => containsDate(period, r.receivedAt))
    .reduce((a, r) => a + r.amountGrossSantim, 0);

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

  const payouts = buildPayoutPipeline(inputs.vouchers, asOf, { paidWithin: { start: period.start, end: period.end } });
  const chase = summariseChase(inputs.chase);

  const live = inputs.projects.filter((p) => p.status === 'in_progress');
  const completedThisMonth = inputs.projects.filter(
    (p) => p.status === 'completed' && containsDate(period, p.plannedEnd),
  ).length;

  const money: MoneyFigure[] = [
    {
      key: 'invoiced',
      label: 'Invoiced this month',
      santim: issuedThisMonth.reduce((a, i) => a + i.netSantim, 0),
      note: `${issuedThisMonth.length} invoice${issuedThisMonth.length === 1 ? '' : 's'}, net of VAT`,
      empty: issuedThisMonth.length === 0,
      href: '/finance',
    },
    {
      key: 'collected',
      label: 'Collected this month',
      santim: collectedThisMonth,
      note: 'cash actually received',
      empty: collectedThisMonth === 0,
      href: '/collections',
    },
    {
      key: 'outstanding',
      label: 'Owed to us',
      santim: ageing.totalSantim,
      note:
        ageing.overdueSantim > 0
          ? `${Math.round((rateBps(ageing.overdueSantim, ageing.totalSantim) ?? 0) / 100)}% of it past due`
          : billed.length === 0
            ? 'no issued invoices yet'
            : 'nothing past due',
      empty: billed.length === 0,
      href: '/collections',
    },
    {
      key: 'committed',
      label: 'Committed to subcontractors',
      santim: payouts.committedSantim,
      note: 'approved and unpaid',
      empty: inputs.vouchers.length === 0,
      href: '/payouts',
    },
  ];

  const averageProgressBps =
    live.length === 0 ? null : Math.round(live.reduce((a, p) => a + p.progressBps, 0) / live.length);

  return {
    setup,
    period,
    money,
    ageing,
    payouts,
    chase,
    delivery: {
      live: live.length,
      inDanger: inputs.projects.filter((p) => p.inDanger).length,
      overdue: live.filter((p) => p.plannedEnd < asOf).length,
      completedThisMonth,
      averageProgressBps,
    },
    alerts: {
      critical: inputs.alerts.filter((a) => a.severity === 'critical').length,
      high: inputs.alerts.filter((a) => a.severity === 'high').length,
      total: inputs.alerts.length,
    },
    unitsNeedingAttention: inputs.unitsNeedingAttention,
    headline: buildHeadline({ setup, ageing, chase, payouts, live: live.length, inputs }),
  };
}

/**
 * The two or three sentences worth reading if nothing else is.
 *
 * Ordered by what would change someone's morning: money nobody has asked for
 * first, then debt going bad, then delivery. A headline that opens with a total
 * is a headline nobody reads twice.
 */
function buildHeadline(args: {
  setup: SetupState;
  ageing: AgeingReport;
  chase: ChaseSummary;
  payouts: PayoutPipeline;
  live: number;
  inputs: DashboardInputs;
}): string[] {
  const { setup, ageing, chase, payouts, live, inputs } = args;

  if (setup.empty) {
    return [
      'Nothing has been entered yet, so there is nothing to report. The checklist below is the order to work through — each step is the thing the next one needs.',
    ];
  }

  if (!setup.ready) {
    return [
      `${setup.completed} of ${setup.steps.length} steps done. The figures below stay empty until there are clients, contracts, projects and invoices behind them — that is the system being honest, not broken.`,
    ];
  }

  const out: string[] = [];

  if (chase.unchasedSantim > 0) {
    out.push(
      `Nobody has asked for ${formatShort(chase.unchasedSantim)} across ${chase.unchasedCount} invoice${chase.unchasedCount === 1 ? '' : 's'}. Asking is free and it is the step most often skipped.`,
    );
  }

  if (chase.brokenPromiseCount > 0) {
    out.push(
      `${chase.brokenPromiseCount} client${chase.brokenPromiseCount === 1 ? '' : 's'} named a payment date and missed it, covering ${formatShort(chase.brokenPromiseSantim)}. That is a different conversation from a client who has never replied.`,
    );
  } else if (ageing.byBucket.over_90 > 0) {
    out.push(`${formatShort(ageing.byBucket.over_90)} has aged past ninety days. Debt that old rarely collects itself.`);
  }

  const stuck = payouts.stages.reduce((a, s) => a + s.overdue, 0);
  if (stuck > 0) {
    out.push(`${stuck} payment voucher${stuck === 1 ? ' is' : 's are'} past the step target. Subcontractors notice before we do.`);
  }

  const inDanger = inputs.projects.filter((p) => p.inDanger).length;
  if (inDanger > 0) {
    out.push(`${inDanger} of ${live} live project${live === 1 ? '' : 's'} ${inDanger === 1 ? 'is' : 'are'} flagged in danger.`);
  }

  if (out.length === 0) {
    out.push(
      live === 0
        ? 'No project is currently in progress. Nothing is overdue and nothing is past due.'
        : `${live} live project${live === 1 ? '' : 's'}, nothing past due and nothing flagged. Worth confirming the records are current rather than assuming a quiet week.`,
    );
  }

  return out.slice(0, 3);
}

/** Compact birr for a sentence: "ETB 4.2m", "ETB 850k". */
function formatShort(santim: number): string {
  const birr = santim / 100;
  if (Math.abs(birr) >= 1_000_000) return `ETB ${(birr / 1_000_000).toFixed(1)}m`;
  if (Math.abs(birr) >= 1_000) return `ETB ${Math.round(birr / 1_000)}k`;
  return `ETB ${Math.round(birr)}`;
}

export { formatShort as compactBirrPhrase };

/** Collection rate this month, for the one ratio worth a tile. */
export function collectionRate(invoicedSantim: number, collectedSantim: number): RateBps {
  return rateBps(collectedSantim, invoicedSantim);
}
