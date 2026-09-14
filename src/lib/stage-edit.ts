/**
 * Editing a project's stage list: add, remove, rename, reweight, reorder.
 *
 * WHY THIS IS NOT JUST A FORM
 *
 *   Stage weights are what "project 62% complete" means. They must sum to
 *   exactly 100%, always — a set summing to 97% quietly understates every
 *   project on the dashboard, and nobody ever notices, because the number still
 *   looks like a percentage.
 *
 *   So the manager never has to do the arithmetic. They say "this project also
 *   needs a shaft modification, call it 8%" or "no customs on this one, it came
 *   from local stock", and the remaining stages absorb the difference PRO RATA,
 *   by largest remainder, landing on exactly 10000 bps every time.
 *
 * Every function here is pure: it takes the current stage list and returns the
 * next one. The repository diffs the two and writes only what changed.
 */

import { allocateByShares } from './milestones.js';

export const TOTAL_BPS = 10_000;

/**
 * A stage may not fall below 0.01%. Zero-weight stages are worse than useless:
 * they appear on the tracker, invite work to be recorded against them, and
 * contribute nothing to progress no matter how much of that work is done.
 */
export const MIN_WEIGHT_BPS = 1;

export interface EditableStage {
  id: string;
  seq: number;
  key: string;
  name: string;
  weightBps: number;
  /** Carried through untouched — reweighting a stage never rewrites its progress. */
  progressBps: number;
}

export type StageEditResult<T extends EditableStage> =
  | { ok: true; stages: T[]; note: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Weight arithmetic
// ---------------------------------------------------------------------------

/**
 * Raise anything below the floor, paying for it from the largest stages one
 * basis point at a time. Callers guarantee `total >= count * MIN_WEIGHT_BPS`
 * before rescaling, so this always succeeds; the loop's escape hatch is there
 * to be non-infinite, not because it is expected to fire.
 */
function enforceFloor(weights: readonly number[]): number[] {
  const out = [...weights];
  for (let i = 0; i < out.length; i += 1) {
    let deficit = MIN_WEIGHT_BPS - (out[i] as number);
    if (deficit <= 0) continue;
    out[i] = MIN_WEIGHT_BPS;
    while (deficit > 0) {
      let donor = -1;
      let best = MIN_WEIGHT_BPS;
      for (let j = 0; j < out.length; j += 1) {
        if (j !== i && (out[j] as number) > best) {
          best = out[j] as number;
          donor = j;
        }
      }
      if (donor === -1) break;
      out[donor] = (out[donor] as number) - 1;
      deficit -= 1;
    }
  }
  return out;
}

/**
 * Rescale weights so they sum to exactly `total`, keeping their relative sizes.
 *
 * Largest remainder, so the rounding error is spread rather than dumped on
 * whichever stage happens to be last in the list.
 */
export function rescaleWeights(weights: readonly number[], total: number): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  // All-zero input has no proportions to preserve, so split it evenly.
  const shares = sum === 0 ? weights.map(() => 1) : weights;
  return enforceFloor(allocateByShares(total, shares));
}

/** Whether a stage list is internally consistent. Used for live form feedback. */
export function weightsTotal(stages: readonly EditableStage[]): number {
  return stages.reduce((a, s) => a + s.weightBps, 0);
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

function resequence<T extends EditableStage>(stages: readonly T[]): T[] {
  return stages.map((stage, index) => ({ ...stage, seq: index + 1 }));
}

function applyWeights<T extends EditableStage>(stages: readonly T[], weights: readonly number[]): T[] {
  return stages.map((stage, index) => ({ ...stage, weightBps: weights[index] as number }));
}

function percent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}

/**
 * Insert a stage, taking its weight pro rata from the existing ones.
 *
 * `afterId` of null puts it first; an unknown id puts it last, because a
 * manager who has just deleted the stage they were aiming at should still get
 * their new stage, at the end, rather than an error they cannot act on.
 */
export function addStage<T extends EditableStage>(
  stages: readonly T[],
  input: { id: string; key: string; name: string; weightBps: number; afterId: string | null },
  make: (base: EditableStage) => T,
): StageEditResult<T> {
  const name = input.name.trim();
  if (name === '') return { ok: false, error: 'Give the stage a name.' };
  if (!Number.isInteger(input.weightBps) || input.weightBps < MIN_WEIGHT_BPS) {
    return { ok: false, error: 'A stage must carry a weight of at least 0.01%.' };
  }
  // Every surviving stage still needs its floor, so the newcomer cannot take
  // everything. With 14 stages that caps it at 99.87% — not a limit anyone
  // meets by accident, but the message says the number rather than "too big".
  const maxBps = TOTAL_BPS - stages.length * MIN_WEIGHT_BPS;
  if (input.weightBps > maxBps) {
    return { ok: false, error: `With ${stages.length} other stages, this one can be at most ${percent(maxBps)}.` };
  }

  const rescaled = applyWeights(stages, rescaleWeights(stages.map((s) => s.weightBps), TOTAL_BPS - input.weightBps));
  const created = make({ id: input.id, seq: 0, key: input.key, name, weightBps: input.weightBps, progressBps: 0 });

  const index = input.afterId === null ? 0 : rescaled.findIndex((s) => s.id === input.afterId) + 1;
  const at = index <= 0 ? (input.afterId === null ? 0 : rescaled.length) : index;
  const next = [...rescaled.slice(0, at), created, ...rescaled.slice(at)];

  return {
    ok: true,
    stages: resequence(next),
    note: `Added ${name} at ${percent(input.weightBps)}. The other stages were scaled down to keep the total at 100%.`,
  };
}

/**
 * Remove a stage and share its weight out among the rest.
 *
 * `lockedBy` names anything that would be orphaned — a payment milestone tied to
 * this stage, most often. Deleting under it would leave a milestone waiting on
 * work that no longer exists, which is exactly the sort of silent breakage that
 * surfaces months later as an uninvoiced payment.
 */
export function removeStage<T extends EditableStage>(
  stages: readonly T[],
  id: string,
  lockedBy: readonly string[] = [],
): StageEditResult<T> {
  const target = stages.find((s) => s.id === id);
  if (target === undefined) return { ok: false, error: 'That stage is no longer on this project.' };
  if (stages.length <= 1) {
    return { ok: false, error: 'A project needs at least one stage, or it cannot report progress at all.' };
  }
  if (lockedBy.length > 0) {
    return {
      ok: false,
      error: `${target.name} releases a payment (${lockedBy.join(', ')}). Move the payment to another stage first, then delete this one.`,
    };
  }

  const rest = stages.filter((s) => s.id !== id);
  const next = applyWeights(rest, rescaleWeights(rest.map((s) => s.weightBps), TOTAL_BPS));

  return {
    ok: true,
    stages: resequence(next),
    note:
      target.progressBps > 0
        ? `Removed ${target.name}, along with the ${percent(target.progressBps)} of progress recorded against it. Its ${percent(target.weightBps)} was shared out over the remaining stages.`
        : `Removed ${target.name}. Its ${percent(target.weightBps)} was shared out over the remaining stages.`,
  };
}

/**
 * Set one stage's weight; the others absorb the difference pro rata.
 *
 * This is the operation a manager actually wants. "Cab assembly is 20% on this
 * job, not 16%" should not require recomputing the other thirteen numbers.
 */
export function setStageWeight<T extends EditableStage>(
  stages: readonly T[],
  id: string,
  weightBps: number,
): StageEditResult<T> {
  const target = stages.find((s) => s.id === id);
  if (target === undefined) return { ok: false, error: 'That stage is no longer on this project.' };
  if (!Number.isInteger(weightBps) || weightBps < MIN_WEIGHT_BPS) {
    return { ok: false, error: 'A stage must carry a weight of at least 0.01%.' };
  }
  const maxBps = TOTAL_BPS - (stages.length - 1) * MIN_WEIGHT_BPS;
  if (weightBps > maxBps) {
    return { ok: false, error: `With ${stages.length - 1} other stages, this one can be at most ${percent(maxBps)}.` };
  }
  if (weightBps === target.weightBps) {
    return { ok: true, stages: [...stages], note: 'No change.' };
  }

  const others = stages.filter((s) => s.id !== id);
  const rescaled = new Map(
    others.map((stage, index) => [
      stage.id,
      rescaleWeights(others.map((s) => s.weightBps), TOTAL_BPS - weightBps)[index] as number,
    ]),
  );

  const next = stages.map((stage) =>
    stage.id === id ? { ...stage, weightBps } : { ...stage, weightBps: rescaled.get(stage.id) as number },
  );

  return {
    ok: true,
    stages: next,
    note: `${target.name} is now ${percent(weightBps)} of the project. The other stages were adjusted to keep the total at 100%.`,
  };
}

export function renameStage<T extends EditableStage>(
  stages: readonly T[],
  id: string,
  name: string,
): StageEditResult<T> {
  const trimmed = name.trim();
  if (trimmed === '') return { ok: false, error: 'Give the stage a name.' };
  if (!stages.some((s) => s.id === id)) {
    return { ok: false, error: 'That stage is no longer on this project.' };
  }
  return {
    ok: true,
    stages: stages.map((stage) => (stage.id === id ? { ...stage, name: trimmed } : { ...stage })),
    note: `Renamed to ${trimmed}.`,
  };
}

/** Move a stage one place up or down. Weights are untouched — only the order. */
export function moveStage<T extends EditableStage>(
  stages: readonly T[],
  id: string,
  direction: 'up' | 'down',
): StageEditResult<T> {
  const from = stages.findIndex((s) => s.id === id);
  if (from === -1) return { ok: false, error: 'That stage is no longer on this project.' };
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= stages.length) {
    return { ok: false, error: `${stages[from]?.name ?? 'That stage'} is already ${direction === 'up' ? 'first' : 'last'}.` };
  }

  const next = [...stages];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);

  return { ok: true, stages: resequence(next), note: `Moved ${(moved as T).name} ${direction}.` };
}

/**
 * Force a drifted set back to 100% without changing the balance between stages.
 *
 * The escape hatch for a project whose stages were written before this file
 * existed, or edited by a future import that did not know the rule.
 */
export function normaliseWeights<T extends EditableStage>(stages: readonly T[]): StageEditResult<T> {
  if (stages.length === 0) return { ok: false, error: 'This project has no stages.' };
  const before = weightsTotal(stages);
  if (before === TOTAL_BPS) return { ok: true, stages: [...stages], note: 'Weights already total 100%.' };
  return {
    ok: true,
    stages: applyWeights(stages, rescaleWeights(stages.map((s) => s.weightBps), TOTAL_BPS)),
    note: `Weights totalled ${percent(before)} and were rescaled to 100%.`,
  };
}

// ---------------------------------------------------------------------------
// Diffing, so the repository writes only what moved
// ---------------------------------------------------------------------------

export interface StageDiff {
  added: EditableStage[];
  removedIds: string[];
  changed: { id: string; seq?: number; name?: string; weightBps?: number }[];
}

export function diffStages(
  before: readonly EditableStage[],
  after: readonly EditableStage[],
): StageDiff {
  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterIds = new Set(after.map((s) => s.id));

  const added: EditableStage[] = [];
  const changed: StageDiff['changed'] = [];

  for (const stage of after) {
    const previous = beforeById.get(stage.id);
    if (previous === undefined) {
      added.push(stage);
      continue;
    }
    const patch: StageDiff['changed'][number] = { id: stage.id };
    if (previous.seq !== stage.seq) patch.seq = stage.seq;
    if (previous.name !== stage.name) patch.name = stage.name;
    if (previous.weightBps !== stage.weightBps) patch.weightBps = stage.weightBps;
    if (Object.keys(patch).length > 1) changed.push(patch);
  }

  return { added, removedIds: before.filter((s) => !afterIds.has(s.id)).map((s) => s.id), changed };
}
