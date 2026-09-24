/**
 * Project prioritisation: which project, given attention this week, unlocks the
 * most cash soonest.
 *
 * The ranking is a transparent sum, not a score out of nowhere. Every project
 * carries its `drivers` — the ETB behind its position — because a manager who
 * cannot see why a project is ranked first will override the list, and then the
 * list is worthless.
 *
 * Three pools of money, treated differently:
 *
 *   1. OVERDUE receivables — already earned, already invoiced, past due. Needs
 *      collection effort, not construction effort. Weighted highest: this is
 *      the cheapest cash in the business to recover.
 *   2. CURRENT receivables — invoiced, not yet due. Needs nothing but patience.
 *   3. UPCOMING milestones — not yet billable. Discounted twice: by how close
 *      the gating phase is to done (attainability), and by how far away the due
 *      date is (imminence). A milestone gated on a phase at 10% is not cash.
 */

import { clampBps, daysBetween } from './kpi.js';
import type { PriorityConfig, ProjectPriority, RiskAssessment, Timestamp } from './schema.js';

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
  horizonDays: 90,
  overdueWeightBps: 10_000,
  currentWeightBps: 6_000,
  upcomingWeightBps: 4_000,
  riskBoostBps: 2_000,
  criticalOverdueDays: 90,
};

export interface InvoiceReceivable {
  grossSantim: number;
  paidGrossSantim: number;
  dueDate: Date;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
}

export interface UpcomingMilestone {
  name: string;
  grossSantim: number;
  status: 'pending' | 'ready_to_invoice' | 'invoiced' | 'part_paid' | 'paid' | 'waived';
  dueDate: Date | null;
  /**
   * Progress of the phase whose completion unlocks this milestone, 0-10000.
   * Null when the milestone is not phase-gated — treated as fully attainable.
   */
  gatingPhaseProgressBps: number | null;
}

export interface PriorityInput {
  projectId: string;
  title: string;
  clientName: string;
  contractNetSantim: number;
  invoicedGrossSantim: number;
  contractGrossSantim: number;
  invoices: readonly InvoiceReceivable[];
  milestones: readonly UpcomingMilestone[];
  risk: RiskAssessment;
}

export interface ReceivableBreakdown {
  overdueSantim: number;
  currentSantim: number;
  oldestOverdueDays: number | null;
}

/** Split outstanding invoices into overdue and current. Voids and drafts are not receivables. */
export function splitReceivables(
  invoices: readonly InvoiceReceivable[],
  asOf: Date,
): ReceivableBreakdown {
  let overdueSantim = 0;
  let currentSantim = 0;
  let oldestOverdueDays: number | null = null;

  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void' || invoice.status === 'paid') continue;
    const outstanding = invoice.grossSantim - invoice.paidGrossSantim;
    if (outstanding <= 0) continue;

    if (invoice.dueDate < asOf) {
      overdueSantim += outstanding;
      const age = daysBetween(invoice.dueDate, asOf);
      if (oldestOverdueDays === null || age > oldestOverdueDays) oldestOverdueDays = age;
    } else {
      currentSantim += outstanding;
    }
  }

  return { overdueSantim, currentSantim, oldestOverdueDays };
}

/**
 * How much of an upcoming milestone is realistically reachable in the horizon.
 *
 * Attainability is the gating phase's progress: a milestone behind a phase at
 * 90% is nearly cash; one behind a phase at 10% is a hope. Imminence decays
 * linearly to the horizon — money due next week deserves attention over money
 * due in three months — and a milestone already ready to invoice is not
 * discounted at all, because nothing stands between it and a bill.
 */
export function milestoneExpectedValue(
  milestone: UpcomingMilestone,
  asOf: Date,
  horizonDays: number,
): number {
  if (milestone.status === 'invoiced' || milestone.status === 'paid' || milestone.status === 'waived') {
    return 0;
  }
  if (milestone.status === 'ready_to_invoice') return milestone.grossSantim;

  const attainabilityBps =
    milestone.gatingPhaseProgressBps === null ? 10_000 : clampBps(milestone.gatingPhaseProgressBps);

  let imminenceBps = 5_000; // no due date: treat as mid-horizon
  if (milestone.dueDate !== null) {
    const days = daysBetween(asOf, milestone.dueDate);
    if (days <= 0) imminenceBps = 10_000; // due or overdue
    else if (days >= horizonDays) imminenceBps = 0; // beyond the horizon
    else imminenceBps = clampBps(Math.round(10_000 - (days * 10_000) / horizonDays));
  }

  return Math.round((milestone.grossSantim * attainabilityBps * imminenceBps) / 100_000_000);
}

/**
 * Score one project. The impact score is a weighted blend of the three cash
 * pools, expressed against the project's own contract value so that projects of
 * different sizes can be compared, then lifted by risk.
 */
export function scoreProject(
  input: PriorityInput,
  asOf: Date,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): Omit<ProjectPriority, 'rank' | 'computedAt'> {
  const receivables = splitReceivables(input.invoices, asOf);

  const nearTermBillableSantim = input.milestones.reduce(
    (a, m) => a + milestoneExpectedValue(m, asOf, config.horizonDays),
    0,
  );

  const unbilledContractSantim = Math.max(0, input.contractGrossSantim - input.invoicedGrossSantim);

  // The headline figure: cash reachable in the horizon, undiscounted, for
  // display. Overdue money counts fully — it is already earned.
  const expectedReceivableSantim =
    receivables.overdueSantim + receivables.currentSantim + nearTermBillableSantim;

  // The ranking key weights the pools by how cheaply each converts to cash.
  const weightedSantim =
    (receivables.overdueSantim * config.overdueWeightBps +
      receivables.currentSantim * config.currentWeightBps +
      nearTermBillableSantim * config.upcomingWeightBps) /
    10_000;

  // Normalise against contract value so a 40M project does not always outrank a
  // 4M one purely on size — this ranks by *share of the project* at stake, then
  // ties break on absolute ETB in `rankProjects`.
  const base =
    input.contractGrossSantim > 0
      ? clampBps(Math.round((weightedSantim * 10_000) / input.contractGrossSantim))
      : 0;

  const riskBoost = Math.round((input.risk.riskScoreBps * config.riskBoostBps) / 10_000);

  return {
    projectId: input.projectId,
    expectedReceivableSantim,
    overdueReceivableSantim: receivables.overdueSantim,
    currentReceivableSantim: receivables.currentSantim,
    nearTermBillableSantim,
    unbilledContractSantim,
    impactScoreBps: clampBps(base + riskBoost),
    drivers: buildDrivers(receivables, nearTermBillableSantim, unbilledContractSantim, input.risk),
    risk: input.risk,
  };
}

function buildDrivers(
  receivables: ReceivableBreakdown,
  nearTermBillableSantim: number,
  unbilledContractSantim: number,
  risk: RiskAssessment,
): ProjectPriority['drivers'] {
  const drivers: ProjectPriority['drivers'] = [];

  if (receivables.overdueSantim > 0) {
    drivers.push({
      label: 'Overdue',
      amountSantim: receivables.overdueSantim,
      note:
        receivables.oldestOverdueDays === null
          ? 'invoiced and past due'
          : `oldest ${receivables.oldestOverdueDays} days past due — chase collection`,
    });
  }
  if (receivables.currentSantim > 0) {
    drivers.push({
      label: 'Invoiced, not yet due',
      amountSantim: receivables.currentSantim,
      note: 'awaiting payment terms',
    });
  }
  if (nearTermBillableSantim > 0) {
    drivers.push({
      label: 'Billable within horizon',
      amountSantim: nearTermBillableSantim,
      note: 'milestones weighted by phase progress and due date',
    });
  }
  if (unbilledContractSantim > 0) {
    drivers.push({
      label: 'Contract not yet invoiced',
      amountSantim: unbilledContractSantim,
      note: 'total remaining to bill over the life of the project',
    });
  }
  if (risk.inDanger) {
    drivers.push({
      label: 'Risk',
      amountSantim: 0,
      note: `${risk.flags.length} open flag${risk.flags.length === 1 ? '' : 's'}, worst is ${risk.level}`,
    });
  }

  return drivers;
}

/**
 * Rank a portfolio. Primary key is the impact score; ties break on absolute
 * expected receivable, so that between two equally-pressured projects the
 * larger cheque wins.
 */
export function rankProjects(
  inputs: readonly PriorityInput[],
  asOf: Date,
  config: PriorityConfig = DEFAULT_PRIORITY_CONFIG,
): Array<Omit<ProjectPriority, 'computedAt'>> {
  return inputs
    .map((input) => scoreProject(input, asOf, config))
    .sort(
      (a, b) =>
        b.impactScoreBps - a.impactScoreBps ||
        b.expectedReceivableSantim - a.expectedReceivableSantim,
    )
    .map((scored, index) => ({ ...scored, rank: index + 1 }));
}

/** Portfolio totals for the header of the priority board. */
export function portfolioTotals(ranked: readonly Omit<ProjectPriority, 'computedAt'>[]) {
  return {
    projects: ranked.length,
    inDanger: ranked.filter((p) => p.risk.inDanger).length,
    expectedReceivableSantim: ranked.reduce((a, p) => a + p.expectedReceivableSantim, 0),
    overdueReceivableSantim: ranked.reduce((a, p) => a + p.overdueReceivableSantim, 0),
    nearTermBillableSantim: ranked.reduce((a, p) => a + p.nearTermBillableSantim, 0),
    unbilledContractSantim: ranked.reduce((a, p) => a + p.unbilledContractSantim, 0),
  };
}

/** Convenience for callers that store a snapshot. */
export function withTimestamp(
  priority: Omit<ProjectPriority, 'computedAt'>,
  computedAt: Timestamp,
): ProjectPriority {
  return { ...priority, computedAt };
}
