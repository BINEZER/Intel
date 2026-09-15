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

export function rollUpProgram(projects: readonly ProgramProject[]): ProgramRollup {
  const sum = (pick: (p: ProgramProject) => number) => projects.reduce((a, p) => a + pick(p), 0);

  const contractNetSantim = sum((p) => p.contractNetSantim);
  const invoicedNetSantim = sum((p) => p.invoicedNetSantim);
  const collectedGrossSantim = sum((p) => p.collectedGrossSantim);
  const subcontractNetSantim = sum((p) => p.subcontractNetSantim);
  const grossMarginSantim = invoicedNetSantim - subcontractNetSantim;

  const totalWeight = contractNetSantim;
  // Fall back to an unweighted mean only when there is no value to weight by —
  // and say which was used, so nobody reads a count-average as a value-average.
  const weightedBy: ProgramRollup['weightedBy'] =
    projects.length === 0 ? null : totalWeight > 0 ? 'value' : 'count';

  const progressBps =
    weightedBy === 'value'
      ? Math.round(sum((p) => p.progressBps * p.contractNetSantim) / totalWeight)
      : weightedBy === 'count'
        ? Math.round(sum((p) => p.progressBps) / projects.length)
        : 0;

  const plannedEnds = projects.map((p) => p.plannedEnd.getTime());

  return {
    projects: projects.length,
    live: projects.filter((p) => p.status === 'in_progress').length,
    completed: projects.filter((p) => p.status === 'completed').length,
    onHold: projects.filter((p) => p.status === 'on_hold').length,
    inDanger: projects.filter((p) => p.inDanger).length,

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
