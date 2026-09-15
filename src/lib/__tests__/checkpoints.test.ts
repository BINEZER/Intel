import { describe, expect, it } from 'vitest';
import {
  STAGE_CHECKPOINTS,
  checkpointProgressBps,
  checkpointsForStage,
  describeCheckpoints,
  isTracked,
  nextCheckpoint,
  phaseProgressBps,
} from '../checkpoints.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../stages.js';

const cp = (key: string, done: boolean) => ({ key, label: key, doneAt: done ? new Date() : null });

describe('the checkpoint set', () => {
  it('covers every installation stage', () => {
    // A stage with no checkpoints silently falls back to a typed percentage,
    // which is the thing this whole file exists to remove.
    for (const stage of ELEVATOR_STAGE_TEMPLATE) {
      const checkpoints = STAGE_CHECKPOINTS[stage.key];
      expect(checkpoints, `${stage.key} has no checkpoints`).toBeDefined();
      expect(checkpoints.length).toBeGreaterThanOrEqual(3);
      expect(checkpoints.length).toBeLessThanOrEqual(5);
    }
  });

  it('has unique keys within each stage', () => {
    for (const [stage, checkpoints] of Object.entries(STAGE_CHECKPOINTS)) {
      const keys = checkpoints.map((c) => c.key);
      expect(new Set(keys).size, `${stage} repeats a checkpoint key`).toBe(keys.length);
    }
  });

  it('hands out copies, so ticking one project does not tick every project', () => {
    const a = checkpointsForStage('testing');
    const b = checkpointsForStage('testing');
    expect(a).toEqual(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('returns nothing for a stage that is not in the template', () => {
    expect(checkpointsForStage('some_custom_stage')).toEqual([]);
  });
});

describe('progress from checkpoints', () => {
  it('is the share that has been ticked', () => {
    expect(checkpointProgressBps([cp('a', true), cp('b', true), cp('c', false), cp('d', false)]))
      .toBe(5000);
    expect(checkpointProgressBps([cp('a', true), cp('b', true)])).toBe(10_000);
  });

  it('treats an empty list as nothing done, not everything', () => {
    // Nothing proven is not everything done. Returning 10000 here would mark a
    // stage complete the moment somebody removed its last checkpoint.
    expect(checkpointProgressBps([])).toBe(0);
  });

  it('rounds a third to the nearest basis point', () => {
    expect(checkpointProgressBps([cp('a', true), cp('b', false), cp('c', false)])).toBe(3333);
  });
});

describe('which figure a phase uses', () => {
  it('prefers its checkpoints over any stored percentage', () => {
    // The stored 9000 is somebody's old estimate; two of four ticked is a fact.
    const phase = {
      key: 'testing',
      progressBps: 9000,
      checkpoints: [cp('a', true), cp('b', true), cp('c', false), cp('d', false)],
    };
    expect(phaseProgressBps(phase)).toBe(5000);
    expect(isTracked(phase)).toBe(true);
  });

  it('falls back to the stored figure for a hand-made stage', () => {
    const phase = { key: 'custom', progressBps: 4200 };
    expect(phaseProgressBps(phase)).toBe(4200);
    expect(isTracked(phase)).toBe(false);
  });

  it('clamps a stored figure that is out of range', () => {
    expect(phaseProgressBps({ key: 'x', progressBps: -50 })).toBe(0);
    expect(phaseProgressBps({ key: 'x', progressBps: 99_999 })).toBe(10_000);
  });
});

describe('reading it back', () => {
  it('counts rather than percentages, so the remaining work is visible', () => {
    expect(describeCheckpoints([cp('a', true), cp('b', false), cp('c', false)])).toBe(
      '1 of 3 checked',
    );
  });

  it('names the next thing to go and do', () => {
    const list = [cp('a', true), cp('b', false), cp('c', false)];
    expect(nextCheckpoint(list)?.key).toBe('b');
    expect(nextCheckpoint([cp('a', true)])).toBeNull();
  });
});

describe('handover', () => {
  it('ends with the signature that starts the warranty', () => {
    // The warranty clock hangs off this checkpoint, so it has to be the last
    // one and it has to be a signature rather than an opinion.
    const handover = STAGE_CHECKPOINTS.handover;
    const last = handover[handover.length - 1];
    expect(last?.key).toBe('acceptance_signed');
    expect(last?.label).toContain('warranty starts');
  });
});
