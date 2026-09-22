/**
 * Give the imported projects the stage trackers they never got.
 *
 * WHAT WAS MISSING
 *   The workbook import created clients, contracts, projects and lifts, but no
 *   STAGES. A project with no stages has nothing to roll progress up from, so
 *   all 163 imported jobs sit at 0% regardless of what is actually built. The
 *   board, the schedule variance and the "finish next" list are all downstream
 *   of that figure, so all three are blind on the imported half of the company.
 *
 * WHAT THE WORKBOOK KNOWS
 *   One word per project — `installation`, `warranty`, `shipping`, `completed`,
 *   `planning`, or nothing at all. That is enough to say which stages a job has
 *   ALREADY PASSED. It is not enough to say how far into the current one it is,
 *   and this module does not pretend otherwise: the current stage is opened and
 *   left at zero for the crew to tick.
 *
 * THE HONESTY PROBLEM, AND WHAT IS DONE ABOUT IT
 *   A checkpoint means a fact was signed off by somebody. Back-filling ticks
 *   checkpoints nobody signed, which is precisely the drift `checkpoints.ts`
 *   exists to remove — so every tick this module makes is stamped
 *   `doneBy: WORKBOOK_SOURCE` instead of a person's id. The figure is then
 *   traceable to the spreadsheet rather than passing as somebody's word, and
 *   the tracker says so on screen.
 *
 *   Where the workbook says nothing, NOTHING is asserted: the stages are
 *   created, all at zero, and the job reads 0% exactly as it does today. A
 *   tracker somebody can start ticking is strictly better than no tracker, and
 *   a guessed percentage is strictly worse than both.
 */

/** Stamped on every checkpoint this back-fill ticks, in place of a person. */
export const WORKBOOK_SOURCE = 'workbook-import';

/** How far a job had got, as far as anything can tell. */
export type StageReach =
  /** Every stage is behind it — handed over, or in warranty. */
  | { kind: 'done' }
  /** This stage is under way; everything before it is finished. */
  | { kind: 'at'; key: string }
  /** Nothing is known. Open the tracker, assert nothing. */
  | { kind: 'unknown' };

/**
 * The workbook's stage word as the stage a job is standing in.
 *
 * `warranty` counts as DONE: a lift in warranty has been handed over, which is
 * the last stage. Reading it as "still working" would put 40 finished jobs back
 * on the board.
 *
 * `on hold` is deliberately unknown rather than a stage. A hold says the job
 * stopped, not where it stopped, and `Project.status` already carries the hold.
 */
export function reachFromWorkbook(sourceStage: string | null | undefined): StageReach {
  switch ((sourceStage ?? '').trim().toLowerCase()) {
    case 'completed':
    case 'handed over':
    case 'warranty':
      return { kind: 'done' };
    case 'testing':
    case 'testing & commissioning':
    case 'commissioning':
      return { kind: 'at', key: 'testing' };
    case 'installation':
      return { kind: 'at', key: 'rail_installation' };
    case 'delivery':
    case 'delivered':
      return { kind: 'at', key: 'delivery_to_site' };
    case 'shipping':
      return { kind: 'at', key: 'shipping_customs' };
    case 'procurement':
    case 'manufacturing':
      return { kind: 'at', key: 'manufacturing' };
    case 'planning':
    case 'design':
      return { kind: 'at', key: 'site_inspection' };
    default:
      return { kind: 'unknown' };
  }
}

/**
 * Where the stage word is blank, the project's own status is the last resort.
 *
 * Only a FINISHED status tells us anything: a job marked completed has been
 * through every stage whatever the stage column says. "In progress" says the
 * job is running, which we already knew, and naming a stage from it would be
 * inventing one.
 */
export function reachFor(
  sourceStage: string | null | undefined,
  projectStatus: string,
): StageReach {
  const fromWord = reachFromWorkbook(sourceStage);
  if (fromWord.kind !== 'unknown') return fromWord;
  if (projectStatus === 'completed' || projectStatus === 'handed_over') return { kind: 'done' };
  return { kind: 'unknown' };
}

/** What one stage should look like after the back-fill. */
export interface PlannedStage {
  key: string;
  status: 'not_started' | 'in_progress' | 'completed';
  progressBps: number;
  /** Tick every checkpoint on this stage — it is behind the job. */
  tickCheckpoints: boolean;
}

/**
 * Each stage of the template, given how far the job had got.
 *
 * Stages BEFORE the current one are complete, because a job does not reach
 * installation without having ordered, shipped and cleared the equipment. The
 * current one is opened at zero, and everything after it is untouched.
 *
 * An unrecognised current-stage key means the template does not contain it, and
 * then nothing is assumed rather than everything being marked complete — the
 * failure mode of a typo must not be "this job is finished".
 */
export function planStages(
  templateKeys: readonly string[],
  reach: StageReach,
): PlannedStage[] {
  const idle = (key: string): PlannedStage => ({
    key,
    status: 'not_started',
    progressBps: 0,
    tickCheckpoints: false,
  });

  if (reach.kind === 'unknown') return templateKeys.map(idle);

  if (reach.kind === 'done') {
    return templateKeys.map((key) => ({
      key,
      status: 'completed',
      progressBps: 10_000,
      tickCheckpoints: true,
    }));
  }

  const at = templateKeys.indexOf(reach.key);
  if (at === -1) return templateKeys.map(idle);

  return templateKeys.map((key, index) => {
    if (index < at) {
      return { key, status: 'completed', progressBps: 10_000, tickCheckpoints: true };
    }
    if (index === at) {
      // Open, but at zero: the workbook says the job is HERE, not how far in.
      return { key, status: 'in_progress', progressBps: 0, tickCheckpoints: false };
    }
    return idle(key);
  });
}

/**
 * The project's own progress figure, rolled up from the planned stages.
 *
 * Weighted by the template's stage weights, the same way the live roll-up
 * works, so a back-filled figure and a ticked one mean the same thing.
 */
export function rolledProgressBps(
  stages: readonly PlannedStage[],
  weightByKey: ReadonlyMap<string, number>,
): number {
  const total = stages.reduce((sum, s) => sum + (weightByKey.get(s.key) ?? 0), 0);
  if (total === 0) return 0;
  const weighted = stages.reduce(
    (sum, s) => sum + s.progressBps * (weightByKey.get(s.key) ?? 0),
    0,
  );
  return Math.min(10_000, Math.max(0, Math.round(weighted / total)));
}

/** What the back-fill did to one project, for the report. */
export interface BackfillOutcome {
  projectNo: string;
  title: string;
  /** The word the workbook carried, for checking against the spreadsheet. */
  sourceStage: string;
  stagesCreated: number;
  stagesCompleted: number;
  progressBps: number;
  /** True where nothing was asserted because nothing was known. */
  openedEmpty: boolean;
}
