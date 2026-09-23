/**
 * Programs: projects that belong together.
 *
 * A tower with four lifts is usually four projects — separate contracts,
 * separate crews, separate invoices — and one commitment to one client. Reported
 * separately they look like four modest jobs; reported together they are the
 * largest thing the company is carrying, and the one whose slippage matters most.
 *
 * A program owns no money of its own. Every figure here is the sum of its
 * projects, so a program can never disagree with the projects inside it.
 */

import { rateBps } from './kpi.js';
import type { RateBps } from './schema.js';
import type { ProjectStatusValue } from './status.js';

export interface ProgramProject {
  id: string;
  projectNo: string;
  title: string;
  clientName: string;
  status: ProjectStatusValue;
  progressBps: number;
  /**
   * The contract this project delivers, so the programme can count each
   * agreement once. Null for a project under no contract.
   */
  contractId: string | null;
  /**
   * The value attributed to THIS project.
   *
   * Where the project carries its own share, that is the figure. Where it does
   * not — imported projects do not — the whole contract value comes through
   * here instead, which is why `rollUpProgram` counts each contract once
   * rather than adding this up blindly. See the note there.
   */
  contractNetSantim: number;
  invoicedNetSantim: number;
  collectedGrossSantim: number;
  subcontractNetSantim: number;
  plannedEnd: Date;
  actualEnd: Date | null;
  inDanger: boolean;
}

export interface ProgramRollup {
  projects: number;
  live: number;
  completed: number;
  onHold: number;
  inDanger: number;
  /**
   * Cancelled or terminated. Counted so a page can say so, and excluded from
   * the progress figure and the commitment — see `rollUpProgram`.
   */
  abandoned: number;

  contractNetSantim: number;
  invoicedNetSantim: number;
  collectedGrossSantim: number;
  /** Contracted but not yet invoiced — the work still to bill. */
  unbilledNetSantim: number;
  /** Invoiced but not yet collected. */
  outstandingNetSantim: number;
  subcontractNetSantim: number;
  grossMarginSantim: number;
  grossMarginBps: RateBps;

  /**
   * Progress weighted by CONTRACT VALUE, not by project count.
   *
   * A 24-million-birr tower at 20% and a 400-thousand-birr lift at 100% do not
   * average to 60% done in any sense a chief executive would accept. Weighting
   * by value is the only average that survives being asked what it means.
   */
  progressBps: number;
  /** Null when no project in the program carries a contract value to weight by. */
  weightedBy: 'value' | 'count' | null;

  /** The latest planned end across the program — when the commitment closes. */
  plannedEnd: Date | null;
  /** Live projects already past their planned end. */
  overdue: number;
}

/** A project that is no longer part of the commitment, however it ended. */
function isAbandoned(status: ProjectStatusValue): boolean {
  return status === 'cancelled' || status === 'terminated';
}

export function rollUpProgram(projects: readonly ProgramProject[]): ProgramRollup {
  /**
   * Cancelled and terminated jobs are not 0% complete; they are not part of
   * the programme any more.
   *
   * Leaving them in did both halves of the damage at once: a cancelled lift
   * sitting at 0% dragged the average down, AND its contract value inflated
   * the denominator, so a two-lift programme with one cancelled read as half
   * finished when the remaining lift was done. `lib/scope.ts` and
   * `lib/work-mix.ts` have always excluded them; this did not.
   */
  const live = projects.filter((p) => !isAbandoned(p.status));
  const sum = (pick: (p: ProgramProject) => number) => live.reduce((a, p) => a + pick(p), 0);
  /**
   * Money, though, is summed across EVERY project including the abandoned
   * ones. A cancelled job that was invoiced for and paid really was invoiced
   * for and paid; dropping it would make the programme's cash disagree with
   * the bank.
   */
  const sumAll = (pick: (p: ProgramProject) => number) => projects.reduce((a, p) => a + pick(p), 0);

  /**
   * EACH CONTRACT COUNTED ONCE.
   *
   * A tower is one contract and one project per lift, and every one of those
   * projects reports the contract's value when it has no share of its own
   * recorded. Adding them up made a four-lift agreement worth four times the
   * money — a programme on a ETB 40M contract read as ETB 120M once the
   * cancelled lift dropped out, which is the sort of figure somebody repeats
   * in a meeting.
   *
   * So: one entry per contract id, and projects under no contract keep their
   * own figure because there is nothing to share with.
   */
  const seenContract = new Set<string>();
  let contractNetSantim = 0;
  for (const project of live) {
    if (project.contractId === null) {
      contractNetSantim += project.contractNetSantim;
      continue;
    }
    if (seenContract.has(project.contractId)) continue;
    seenContract.add(project.contractId);
    contractNetSantim += project.contractNetSantim;
  }
  const invoicedNetSantim = sumAll((p) => p.invoicedNetSantim);
  const collectedGrossSantim = sumAll((p) => p.collectedGrossSantim);
  const subcontractNetSantim = sumAll((p) => p.subcontractNetSantim);
  const grossMarginSantim = invoicedNetSantim - subcontractNetSantim;

  const totalWeight = contractNetSantim;
  // Fall back to an unweighted mean only when there is no value to weight by —
  // and say which was used, so nobody reads a count-average as a value-average.
  /**
   * WEIGHT BY VALUE ONLY WHERE THE VALUES ARE REALLY PER PROJECT.
   *
   * Several lifts on one agreement each report that agreement's whole value
   * when none of them carries a share of its own. Those are not weights —
   * they are the same number repeated — and weighting by them divides a
   * numerator built from four copies by a denominator holding one, which is
   * how a programme of two finished lifts and one at 60% came out at 100%.
   *
   * So: a repeated contract id means there are no real shares, and the
   * honest average is the plain one across the live projects. That is also
   * the usual shape of this — one site, one contract, one project per lift.
   */
  const contractIds = live.map((p) => p.contractId).filter((id): id is string => id !== null);
  const sharesAreDistinct = new Set(contractIds).size === contractIds.length;

  const weightedBy: ProgramRollup['weightedBy'] =
    live.length === 0 ? null : totalWeight > 0 && sharesAreDistinct ? 'value' : 'count';

  const progressBps =
    weightedBy === 'value'
      ? Math.round(sum((p) => p.progressBps * p.contractNetSantim) / totalWeight)
      : weightedBy === 'count'
        ? Math.round(sum((p) => p.progressBps) / live.length)
        : 0;

  // The commitment closes when the last LIVE project is due. A cancelled job
  // with a date next year does not hold the programme open.
  const plannedEnds = live.map((p) => p.plannedEnd.getTime());

  return {
    // Every project on the programme, so the member list and the count agree.
    projects: projects.length,
    live: projects.filter((p) => p.status === 'in_progress').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    onHold: projects.filter((p) => p.status === 'on_hold').length,
    inDanger: projects.filter((p) => p.inDanger).length,
    abandoned: projects.filter((p) => isAbandoned(p.status)).length,

    contractNetSantim,
    invoicedNetSantim,
    collectedGrossSantim,
    unbilledNetSantim: Math.max(0, contractNetSantim - invoicedNetSantim),
    outstandingNetSantim: Math.max(0, invoicedNetSantim - collectedGrossSantim),
    subcontractNetSantim,
    grossMarginSantim,
    grossMarginBps: rateBps(grossMarginSantim, invoicedNetSantim),

    progressBps: Math.min(10_000, Math.max(0, progressBps)),
    weightedBy,

    plannedEnd: plannedEnds.length === 0 ? null : new Date(Math.max(...plannedEnds)),
    overdue: 0,
  };
}

/** As above, but knowing the date, so "overdue" can be counted. */
export function rollUpProgramAsOf(projects: readonly ProgramProject[], asOf: Date): ProgramRollup {
  const rollup = rollUpProgram(projects);
  return {
    ...rollup,
    overdue: projects.filter((p) => p.status === 'in_progress' && p.plannedEnd < asOf).length,
  };
}

/**
 * Programs ranked by what deserves the chief executive's attention.
 *
 * Danger first, then money at stake. A program with a project in trouble
 * outranks a larger one running smoothly, because the larger one needs nothing
 * from anybody today.
 */
export function sortPrograms<T extends { rollup: ProgramRollup }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.rollup.inDanger !== b.rollup.inDanger) return b.rollup.inDanger - a.rollup.inDanger;
    if (a.rollup.overdue !== b.rollup.overdue) return b.rollup.overdue - a.rollup.overdue;
    return b.rollup.contractNetSantim - a.rollup.contractNetSantim;
  });
}
