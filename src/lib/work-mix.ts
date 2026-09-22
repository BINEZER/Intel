/**
 * How the portfolio divides between lift work and everything else.
 *
 * WHY IT IS A LIBRARY AND NOT A LOOP IN THE REPORT
 *   The judgement is in what gets counted, not in the addition. Cancelled and
 *   terminated jobs are excluded — they are not work in hand, and a portfolio
 *   that counts them reports a business bigger than the one that exists. That
 *   decision belongs where a test can pin it down.
 *
 * WHY THE SPLIT IS TWO-LEVEL
 *   "Elevator versus other" is the question an owner asks first: is the new
 *   business real yet. The per-kind breakdown underneath is the question asked
 *   second: real as WHAT — renovation, fit-out, or a bucket nobody has named
 *   properly. One figure without the other is either too coarse to act on or
 *   too fine to summarise.
 */

import { normaliseProjectType, projectTypeLabel, workSplit } from './project-kind.js';
import type { SelectableProjectType } from './project-kind.js';

/** The fields of a project this module needs. */
export interface MixProject {
  status: string;
  type: string | undefined;
  /** This job's share of the contract, in santim. */
  contractNetSantim: number;
  progressBps: number;
}

export interface MixRow {
  type: SelectableProjectType;
  label: string;
  projects: number;
  valueNetSantim: number;
  /** Share of the counted value, in basis points. Null when nothing is valued. */
  shareBps: number | null;
  /** Value-weighted progress, or null where no job in the row carries a value. */
  progressBps: number | null;
}

export interface WorkMix {
  /** Every kind present, largest by value first. */
  rows: MixRow[];
  elevator: MixRow;
  other: MixRow;
  /** Jobs counted, after cancelled and terminated are dropped. */
  projects: number;
  valueNetSantim: number;
  /** Is there any non-lift work at all? */
  hasOtherWork: boolean;
}

/** A job that is no longer part of the business. */
function isAbandoned(status: string): boolean {
  return status === 'cancelled' || status === 'terminated';
}

function emptyRow(type: SelectableProjectType, label: string): MixRow {
  return { type, label, projects: 0, valueNetSantim: 0, shareBps: null, progressBps: null };
}

/**
 * Value-weighted progress across a set of jobs.
 *
 * Weighted, for the same reason a contract's progress is: a 10-million tower at
 * 10% and a 200-thousand callout at 100% do not average to 55% of anything a
 * person would recognise. Where nothing carries a value there is no honest
 * weighting, so the answer is null rather than a number nobody should act on.
 */
function weightedProgress(projects: readonly MixProject[]): number | null {
  const total = projects.reduce((sum, p) => sum + p.contractNetSantim, 0);
  if (total <= 0) return null;
  const weighted = projects.reduce((sum, p) => sum + p.progressBps * p.contractNetSantim, 0);
  return Math.round(weighted / total);
}

function rowFor(
  type: SelectableProjectType,
  label: string,
  projects: readonly MixProject[],
  totalValue: number,
): MixRow {
  const valueNetSantim = projects.reduce((sum, p) => sum + p.contractNetSantim, 0);
  return {
    type,
    label,
    projects: projects.length,
    valueNetSantim,
    shareBps: totalValue > 0 ? Math.round((valueNetSantim * 10_000) / totalValue) : null,
    progressBps: weightedProgress(projects),
  };
}

/** The portfolio, split by the kind of work. */
export function workMix(all: readonly MixProject[]): WorkMix {
  const counted = all.filter((p) => !isAbandoned(p.status));
  const totalValue = counted.reduce((sum, p) => sum + p.contractNetSantim, 0);

  const byType = new Map<SelectableProjectType, MixProject[]>();
  for (const project of counted) {
    const type = normaliseProjectType(project.type);
    const list = byType.get(type);
    if (list === undefined) byType.set(type, [project]);
    else list.push(project);
  }

  const rows = [...byType.entries()]
    .map(([type, list]) => rowFor(type, projectTypeLabel(type), list, totalValue))
    // By value, because that is the order the business is in. Ties fall back to
    // the number of jobs so the order is stable rather than insertion-dependent.
    .sort((a, b) => b.valueNetSantim - a.valueNetSantim || b.projects - a.projects);

  const lift = counted.filter((p) => workSplit(p.type) === 'elevator');
  const rest = counted.filter((p) => workSplit(p.type) !== 'elevator');

  return {
    rows,
    elevator: rowFor('elevator', 'Lift work', lift, totalValue),
    other: rowFor('other', 'Other work', rest, totalValue),
    projects: counted.length,
    valueNetSantim: totalValue,
    hasOtherWork: rest.length > 0,
  };
}

/** Both sides of the split in one sentence, or null when there is nothing to say. */
export function describeMix(mix: WorkMix): string | null {
  if (mix.projects === 0) return null;
  if (!mix.hasOtherWork) return null;

  const share = mix.other.shareBps;
  const pct = share === null ? null : (share / 100).toFixed(share % 100 === 0 ? 0 : 1);
  return (
    `${mix.other.projects} of ${mix.projects} live jobs are not lift work` +
    (pct === null
      ? '. None of the portfolio carries a value yet, so their share of it cannot be stated.'
      : `, carrying ${pct}% of the portfolio by value.`)
  );
}
