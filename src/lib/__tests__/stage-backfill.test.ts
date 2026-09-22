import { describe, expect, it } from 'vitest';
import {
  planStages,
  reachFor,
  reachFromWorkbook,
  rolledProgressBps,
  type PlannedStage,
} from '../stage-backfill.js';
import { ELEVATOR_STAGES } from '../stages.js';

const KEYS = [...ELEVATOR_STAGES];

describe('reading how far a job had got', () => {
  it('treats warranty as finished, not as still working', () => {
    // A lift in warranty has been handed over. Reading it as "in progress"
    // would put 40 finished jobs back on the board.
    expect(reachFromWorkbook('warranty')).toEqual({ kind: 'done' });
    expect(reachFromWorkbook('completed')).toEqual({ kind: 'done' });
  });

  it('maps each working word onto the stage it means', () => {
    expect(reachFromWorkbook('installation')).toEqual({ kind: 'at', key: 'rail_installation' });
    expect(reachFromWorkbook('shipping')).toEqual({ kind: 'at', key: 'shipping_customs' });
    expect(reachFromWorkbook('procurement')).toEqual({ kind: 'at', key: 'manufacturing' });
    expect(reachFromWorkbook('planning')).toEqual({ kind: 'at', key: 'site_inspection' });
    expect(reachFromWorkbook('testing & commissioning')).toEqual({ kind: 'at', key: 'testing' });
  });

  it('ignores case and stray spacing, which a spreadsheet column is full of', () => {
    expect(reachFromWorkbook('  Installation ')).toEqual({ kind: 'at', key: 'rail_installation' });
    expect(reachFromWorkbook('WARRANTY')).toEqual({ kind: 'done' });
  });

  it('knows nothing from a blank, and says so', () => {
    expect(reachFromWorkbook('')).toEqual({ kind: 'unknown' });
    expect(reachFromWorkbook(null)).toEqual({ kind: 'unknown' });
    expect(reachFromWorkbook(undefined)).toEqual({ kind: 'unknown' });
  });

  it('treats "on hold" as unknown rather than as a stage', () => {
    // A hold says the job stopped, not where it stopped, and the project's own
    // status already carries the hold.
    expect(reachFromWorkbook('on hold')).toEqual({ kind: 'unknown' });
  });
});

describe('falling back to the project status', () => {
  it('uses a finished status when the stage word is blank', () => {
    expect(reachFor('', 'completed')).toEqual({ kind: 'done' });
    expect(reachFor(null, 'handed_over')).toEqual({ kind: 'done' });
  });

  it('never invents a stage from "in progress"', () => {
    // It says the job is running, which we already knew.
    expect(reachFor('', 'in_progress')).toEqual({ kind: 'unknown' });
    expect(reachFor('', 'planned')).toEqual({ kind: 'unknown' });
  });

  it('lets the stage word win over the status where both are there', () => {
    expect(reachFor('installation', 'completed')).toEqual({ kind: 'at', key: 'rail_installation' });
  });
});

describe('planning the stages', () => {
  const byKey = (stages: PlannedStage[]) => new Map(stages.map((s) => [s.key, s]));

  it('marks everything complete for a finished job', () => {
    const stages = planStages(KEYS, { kind: 'done' });
    expect(stages).toHaveLength(KEYS.length);
    expect(stages.every((s) => s.status === 'completed' && s.progressBps === 10_000)).toBe(true);
    expect(stages.every((s) => s.tickCheckpoints)).toBe(true);
  });

  it('completes what is behind the current stage and opens the current one at zero', () => {
    // The workbook says the job is HERE, not how far into it.
    const stages = byKey(planStages(KEYS, { kind: 'at', key: 'rail_installation' }));
    expect(stages.get('manufacturing')?.status).toBe('completed');
    expect(stages.get('shipping_customs')?.status).toBe('completed');
    expect(stages.get('mobilisation')?.status).toBe('completed');

    const current = stages.get('rail_installation');
    expect(current?.status).toBe('in_progress');
    expect(current?.progressBps).toBe(0);
    expect(current?.tickCheckpoints).toBe(false);

    expect(stages.get('testing')?.status).toBe('not_started');
    expect(stages.get('handover')?.status).toBe('not_started');
  });

  it('opens every stage at zero when nothing is known', () => {
    const stages = planStages(KEYS, { kind: 'unknown' });
    expect(stages.every((s) => s.status === 'not_started' && s.progressBps === 0)).toBe(true);
    expect(stages.some((s) => s.tickCheckpoints)).toBe(false);
  });

  it('assumes nothing rather than everything when the stage key is not in the template', () => {
    // The failure mode of a typo must not be "this job is finished".
    const stages = planStages(KEYS, { kind: 'at', key: 'not_a_stage' });
    expect(stages.every((s) => s.status === 'not_started')).toBe(true);
  });

  it('opens the first stage at zero rather than completing nothing before it', () => {
    const stages = planStages(KEYS, { kind: 'at', key: 'site_inspection' });
    expect(stages[0]?.status).toBe('in_progress');
    expect(stages.filter((s) => s.status === 'completed')).toHaveLength(0);
  });
});

describe('rolling the stages up to a project figure', () => {
  const weights = new Map(KEYS.map((k, i) => [k, i === 0 ? 8000 : 2000 / (KEYS.length - 1)]));

  it('is 100% for a job that is entirely finished', () => {
    expect(rolledProgressBps(planStages(KEYS, { kind: 'done' }), weights)).toBe(10_000);
  });

  it('is 0% for a job nothing is known about', () => {
    expect(rolledProgressBps(planStages(KEYS, { kind: 'unknown' }), weights)).toBe(0);
  });

  it('weights the stages rather than counting them', () => {
    // One stage carrying 80% of the weight is 80% of the job, not 1/14th.
    const stages = planStages(KEYS, { kind: 'at', key: KEYS[1] as string });
    expect(rolledProgressBps(stages, weights)).toBe(8000);
  });

  it('is 0 rather than a divide-by-zero when no stage carries weight', () => {
    const none = new Map(KEYS.map((k) => [k, 0]));
    expect(rolledProgressBps(planStages(KEYS, { kind: 'done' }), none)).toBe(0);
  });
});
