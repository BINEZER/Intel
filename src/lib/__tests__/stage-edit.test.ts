/**
 * Stage editing.
 *
 * The invariant under test everywhere: after ANY edit, the weights sum to
 * exactly 10000. A set that sums to 9998 still renders as a percentage and
 * still looks fine — which is exactly why it has to be tested rather than eyeballed.
 */

import { describe, expect, it } from 'vitest';
import {
  addStage,
  diffStages,
  MIN_WEIGHT_BPS,
  moveStage,
  normaliseWeights,
  removeStage,
  renameStage,
  rescaleWeights,
  setStageWeight,
  TOTAL_BPS,
  weightsTotal,
  type EditableStage,
} from '../stage-edit.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../stages.js';

function stages(): EditableStage[] {
  return ELEVATOR_STAGE_TEMPLATE.map((s, i) => ({
    id: `id-${s.key}`,
    seq: i + 1,
    key: s.key,
    name: s.name,
    weightBps: s.weightBps,
    progressBps: 0,
  }));
}

function expectOk<T extends EditableStage>(result: ReturnType<typeof removeStage<T>>) {
  if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
  return result;
}

describe('rescaleWeights', () => {
  it('lands on the target exactly, however the division falls', () => {
    // Three equal shares of 10000 is the classic 33.33/33.33/33.34 problem.
    expect(rescaleWeights([1, 1, 1], TOTAL_BPS).reduce((a, b) => a + b, 0)).toBe(TOTAL_BPS);
    expect(rescaleWeights([7, 11, 13, 17, 19], TOTAL_BPS).reduce((a, b) => a + b, 0)).toBe(TOTAL_BPS);
  });

  it('keeps the relative sizes', () => {
    const [small, large] = rescaleWeights([1000, 3000], TOTAL_BPS) as [number, number];
    expect(large).toBe(small * 3);
  });

  it('never leaves a stage on zero', () => {
    // A tiny stage rescaled into a small budget would floor to nothing.
    const out = rescaleWeights([1, 1, 9998], 20);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(MIN_WEIGHT_BPS);
    expect(out.reduce((a, b) => a + b, 0)).toBe(20);
  });

  it('splits an all-zero set evenly rather than dividing by zero', () => {
    expect(rescaleWeights([0, 0, 0, 0], TOTAL_BPS)).toEqual([2500, 2500, 2500, 2500]);
  });
});

describe('the template it starts from', () => {
  it('already sums to 100%', () => {
    expect(weightsTotal(stages())).toBe(TOTAL_BPS);
  });
});

describe('addStage', () => {
  const make = (base: EditableStage) => base;

  it('adds the stage and rebalances the rest to 100%', () => {
    const result = addStage(stages(), { id: 'new', key: 'custom_x', name: 'Shaft modification', weightBps: 800, afterId: 'id-site_preparation' }, make);
    const ok = expectOk(result);

    expect(weightsTotal(ok.stages)).toBe(TOTAL_BPS);
    expect(ok.stages.find((s) => s.id === 'new')?.weightBps).toBe(800);
    // Inserted directly after the stage named, not appended to the end.
    const index = ok.stages.findIndex((s) => s.id === 'new');
    expect(ok.stages[index - 1]?.key).toBe('site_preparation');
    expect(ok.stages.map((s) => s.seq)).toEqual(ok.stages.map((_, i) => i + 1));
  });

  it('puts it first when nothing is named to follow', () => {
    const ok = expectOk(addStage(stages(), { id: 'new', key: 'k', name: 'Client kick-off', weightBps: 100, afterId: null }, make));
    expect(ok.stages[0]?.id).toBe('new');
  });

  it('does not lose a stage whose anchor has since been deleted', () => {
    const ok = expectOk(addStage(stages(), { id: 'new', key: 'k', name: 'Late addition', weightBps: 100, afterId: 'id-that-is-gone' }, make));
    expect(ok.stages[ok.stages.length - 1]?.id).toBe('new');
  });

  it('refuses a nameless stage', () => {
    expect(addStage(stages(), { id: 'n', key: 'k', name: '   ', weightBps: 100, afterId: null }, make)).toMatchObject({ ok: false });
  });

  it('refuses a weight that would starve the others', () => {
    const result = addStage(stages(), { id: 'n', key: 'k', name: 'Everything', weightBps: TOTAL_BPS, afterId: null }, make);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('at most');
  });
});

describe('removeStage', () => {
  it('shares the deleted weight out and stays at 100%', () => {
    const before = stages();
    const customs = before.find((s) => s.key === 'shipping_customs') as EditableStage;
    const ok = expectOk(removeStage(before, customs.id));

    expect(ok.stages).toHaveLength(before.length - 1);
    expect(ok.stages.some((s) => s.key === 'shipping_customs')).toBe(false);
    expect(weightsTotal(ok.stages)).toBe(TOTAL_BPS);
    expect(ok.stages.map((s) => s.seq)).toEqual(ok.stages.map((_, i) => i + 1));
  });

  it('refuses when a payment milestone is tied to the stage', () => {
    const before = stages();
    const mobilisation = before.find((s) => s.key === 'mobilisation') as EditableStage;
    const result = removeStage(before, mobilisation.id, ['C-014: On mobilisation']);

    expect(result.ok).toBe(false);
    // The message has to name the payment, or the manager cannot act on it.
    if (!result.ok) expect(result.error).toContain('C-014: On mobilisation');
  });

  it('warns in its note when recorded progress is being destroyed', () => {
    const before = stages().map((s) => (s.key === 'manufacturing' ? { ...s, progressBps: 5000 } : s));
    const target = before.find((s) => s.key === 'manufacturing') as EditableStage;
    const ok = expectOk(removeStage(before, target.id));
    expect(ok.note).toContain('progress');
  });

  it('refuses to empty the project', () => {
    expect(removeStage([{ id: 'only', seq: 1, key: 'k', name: 'Only', weightBps: TOTAL_BPS, progressBps: 0 }], 'only')).toMatchObject({ ok: false });
  });
});

describe('setStageWeight', () => {
  it('absorbs the difference across the others', () => {
    const before = stages();
    const cab = before.find((s) => s.key === 'cab_assembly') as EditableStage;
    const ok = expectOk(setStageWeight(before, cab.id, 2000));

    expect(ok.stages.find((s) => s.id === cab.id)?.weightBps).toBe(2000);
    expect(weightsTotal(ok.stages)).toBe(TOTAL_BPS);
  });

  it('leaves progress alone — reweighting is not re-reporting', () => {
    const before = stages().map((s) => ({ ...s, progressBps: 4000 }));
    const ok = expectOk(setStageWeight(before, before[3]?.id as string, 2500));
    expect(ok.stages.every((s) => s.progressBps === 4000)).toBe(true);
  });

  it('keeps the others in proportion to each other', () => {
    const before: EditableStage[] = [
      { id: 'a', seq: 1, key: 'a', name: 'A', weightBps: 5000, progressBps: 0 },
      { id: 'b', seq: 2, key: 'b', name: 'B', weightBps: 3000, progressBps: 0 },
      { id: 'c', seq: 3, key: 'c', name: 'C', weightBps: 2000, progressBps: 0 },
    ];
    const ok = expectOk(setStageWeight(before, 'a', 6000));
    // b:c was 3:2 and must stay 3:2 within the remaining 4000.
    expect(ok.stages.find((s) => s.id === 'b')?.weightBps).toBe(2400);
    expect(ok.stages.find((s) => s.id === 'c')?.weightBps).toBe(1600);
  });

  it('is a no-op when the weight has not changed', () => {
    const before = stages();
    const ok = expectOk(setStageWeight(before, before[0]?.id as string, before[0]?.weightBps as number));
    expect(ok.stages.map((s) => s.weightBps)).toEqual(before.map((s) => s.weightBps));
  });

  it('rejects zero and negative weights', () => {
    const before = stages();
    expect(setStageWeight(before, before[0]?.id as string, 0)).toMatchObject({ ok: false });
    expect(setStageWeight(before, before[0]?.id as string, -100)).toMatchObject({ ok: false });
  });
});

describe('moveStage and renameStage', () => {
  it('moves and renumbers without touching weights', () => {
    const before = stages();
    const totalBefore = weightsTotal(before);
    const ok = expectOk(moveStage(before, before[5]?.id as string, 'up'));

    expect(ok.stages[4]?.id).toBe(before[5]?.id);
    expect(ok.stages[5]?.id).toBe(before[4]?.id);
    expect(weightsTotal(ok.stages)).toBe(totalBefore);
    expect(ok.stages.map((s) => s.seq)).toEqual(ok.stages.map((_, i) => i + 1));
  });

  it('says so rather than silently doing nothing at the ends', () => {
    const before = stages();
    expect(moveStage(before, before[0]?.id as string, 'up')).toMatchObject({ ok: false });
    expect(moveStage(before, before[before.length - 1]?.id as string, 'down')).toMatchObject({ ok: false });
  });

  it('renames and trims', () => {
    const before = stages();
    const ok = expectOk(renameStage(before, before[0]?.id as string, '  Site visit  '));
    expect(ok.stages[0]?.name).toBe('Site visit');
  });

  it('refuses a blank rename', () => {
    const before = stages();
    expect(renameStage(before, before[0]?.id as string, '  ')).toMatchObject({ ok: false });
  });
});

describe('normaliseWeights', () => {
  it('pulls a drifted set back to exactly 100%', () => {
    const drifted = stages().map((s) => ({ ...s, weightBps: s.weightBps + 37 }));
    expect(weightsTotal(drifted)).not.toBe(TOTAL_BPS);
    const ok = expectOk(normaliseWeights(drifted));
    expect(weightsTotal(ok.stages)).toBe(TOTAL_BPS);
  });

  it('reports honestly when there was nothing to fix', () => {
    const ok = expectOk(normaliseWeights(stages()));
    expect(ok.note).toContain('already');
  });
});

describe('diffStages', () => {
  it('reports only what actually moved', () => {
    const before = stages();
    const after = expectOk(renameStage(before, before[2]?.id as string, 'Factory order')).stages;
    const diff = diffStages(before, after);

    expect(diff.added).toEqual([]);
    expect(diff.removedIds).toEqual([]);
    expect(diff.changed).toEqual([{ id: before[2]?.id, name: 'Factory order' }]);
  });

  it('separates an addition from the reweights it caused', () => {
    const before = stages();
    const after = expectOk(
      addStage(before, { id: 'new', key: 'k', name: 'Extra', weightBps: 500, afterId: null }, (b) => b),
    ).stages;
    const diff = diffStages(before, after);

    expect(diff.added.map((s) => s.id)).toEqual(['new']);
    expect(diff.removedIds).toEqual([]);
    // Every existing stage shifted down one place AND lost weight.
    expect(diff.changed).toHaveLength(before.length);
  });

  it('reports a deletion', () => {
    const before = stages();
    const after = expectOk(removeStage(before, before[3]?.id as string)).stages;
    expect(diffStages(before, after).removedIds).toEqual([before[3]?.id]);
  });
});

describe('a long sequence of edits', () => {
  it('never lets the total drift', () => {
    let current = stages();
    const operations: Array<() => void> = [
      () => { current = expectOk(addStage(current, { id: 'x1', key: 'k1', name: 'Demolition', weightBps: 700, afterId: null }, (b) => b)).stages; },
      () => { current = expectOk(removeStage(current, current[4]?.id as string)).stages; },
      () => { current = expectOk(setStageWeight(current, current[2]?.id as string, 1234)).stages; },
      () => { current = expectOk(moveStage(current, current[6]?.id as string, 'up')).stages; },
      () => { current = expectOk(addStage(current, { id: 'x2', key: 'k2', name: 'Witnessed load test', weightBps: 250, afterId: current[3]?.id ?? null }, (b) => b)).stages; },
      () => { current = expectOk(removeStage(current, current[1]?.id as string)).stages; },
      () => { current = expectOk(setStageWeight(current, current[0]?.id as string, 3000)).stages; },
    ];

    for (const operation of operations) {
      operation();
      expect(weightsTotal(current)).toBe(TOTAL_BPS);
      expect(Math.min(...current.map((s) => s.weightBps))).toBeGreaterThanOrEqual(MIN_WEIGHT_BPS);
      expect(current.map((s) => s.seq)).toEqual(current.map((_, i) => i + 1));
    }
  });
});
