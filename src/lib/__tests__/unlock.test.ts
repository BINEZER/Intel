import { describe, expect, it } from 'vitest';
import {
  buildUnlockReport,
  projectStanding,
  type UnlockMilestoneInput,
  type UnlockStageInput,
} from '../unlock.js';
import { ELEVATOR_STAGE_TEMPLATE, TYPICAL_PAYMENT_STAGES, isOurs, stageOwner } from '../stages.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2025, 9, 13);

const stage = (over: Partial<UnlockStageInput> = {}): UnlockStageInput => ({
  projectId: 'p1',
  projectTitle: 'Bole Tower',
  clientName: 'Bole Development',
  phaseId: 'ph1',
  stageKey: 'mobilisation',
  stageName: 'Mobilisation & start of installation',
  progressBps: 0,
  status: 'not_started',
  dependsOnPhaseIds: [],
  plannedEnd: utc(2025, 10, 1),
  ...over,
});

const milestone = (over: Partial<UnlockMilestoneInput> = {}): UnlockMilestoneInput => ({
  milestoneId: 'm1',
  contractId: 'k1',
  name: 'On mobilisation',
  phaseId: 'ph1',
  grossSantim: ETB(1_000_000),
  status: 'pending',
  ...over,
});

describe('the stage template', () => {
  it('runs from site inspection to handover', () => {
    expect(ELEVATOR_STAGE_TEMPLATE[0]!.key).toBe('site_inspection');
    expect(ELEVATOR_STAGE_TEMPLATE.at(-1)!.key).toBe('handover');
    expect(ELEVATOR_STAGE_TEMPLATE).toHaveLength(14);
  });

  it('has weights summing to exactly 100%', () => {
    expect(ELEVATOR_STAGE_TEMPLATE.reduce((a, s) => a + s.weightBps, 0)).toBe(10_000);
  });

  it('names who has to move for each stage', () => {
    // A project stuck in customs and one stuck because the crew never turned up
    // need different interventions, so the owner is recorded rather than assumed.
    expect(stageOwner('shipping_customs')).toBe('supplier');
    expect(stageOwner('site_preparation')).toBe('client');
    expect(stageOwner('authority_inspection')).toBe('authority');
    expect(stageOwner('cab_assembly')).toBe('us');
    expect(isOurs('cab_assembly')).toBe(true);
    expect(isOurs('shipping_customs')).toBe(false);
  });

  it('treats an unknown stage as ours rather than silently excusing it', () => {
    expect(stageOwner('some_custom_stage')).toBe('us');
  });

  it('offers a typical payment schedule that also sums to 100%', () => {
    expect(TYPICAL_PAYMENT_STAGES.reduce((a, p) => a + p.shareBps, 0)).toBe(10_000);
    // The manager's example: mobilisation carries a payment.
    expect(TYPICAL_PAYMENT_STAGES.find((p) => p.stage === 'mobilisation')).toBeDefined();
  });
});

describe('which work unlocks the most money', () => {
  it('values a stage by the milestones gated on it', () => {
    const report = buildUnlockReport([stage()], [milestone()], NOW);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.gatedSantim).toBe(ETB(1_000_000));
    expect(report.rows[0]!.milestones[0]!.name).toBe('On mobilisation');
  });

  it('ignores stages with no money behind them', () => {
    const report = buildUnlockReport([stage({ phaseId: 'ph-nothing' })], [milestone()], NOW);
    expect(report.rows).toEqual([]);
  });

  it('ignores finished stages — there is nothing left to unlock', () => {
    const report = buildUnlockReport([stage({ progressBps: 10_000 })], [milestone()], NOW);
    expect(report.rows).toEqual([]);
  });

  it('excludes milestones already invoiced, so cash is never counted twice', () => {
    // Once invoiced the money moves from "finish work" to "chase payment",
    // which is the priority board's job.
    const report = buildUnlockReport([stage()], [milestone({ status: 'invoiced' })], NOW);
    expect(report.rows).toEqual([]);
    expect(buildUnlockReport([stage()], [milestone({ status: 'paid' })], NOW).rows).toEqual([]);
  });

  it('ranks a nearly-finished stage above a barely-started one holding more', () => {
    // Finishing the last tenth releases the same money for a tenth of the work.
    const report = buildUnlockReport(
      [
        stage({ phaseId: 'nearly', progressBps: 9_000 }),
        stage({ phaseId: 'barely', progressBps: 500 }),
      ],
      [
        milestone({ milestoneId: 'a', phaseId: 'nearly', grossSantim: ETB(2_000_000) }),
        milestone({ milestoneId: 'b', phaseId: 'barely', grossSantim: ETB(2_600_000) }),
      ],
      NOW,
    );
    expect(report.rows[0]!.phaseId).toBe('nearly');
    expect(report.rows[0]!.santimPerRemainingBps).toBeGreaterThan(
      report.rows[1]!.santimPerRemainingBps,
    );
  });

  it('puts work we can actually do above work we cannot', () => {
    // A list led by things nobody can action is a list that gets ignored.
    const report = buildUnlockReport(
      [
        stage({ phaseId: 'customs', stageKey: 'shipping_customs', progressBps: 5_000 }),
        stage({ phaseId: 'ours', stageKey: 'cab_assembly', progressBps: 5_000 }),
      ],
      [
        milestone({ milestoneId: 'a', phaseId: 'customs', grossSantim: ETB(5_000_000) }),
        milestone({ milestoneId: 'b', phaseId: 'ours', grossSantim: ETB(500_000) }),
      ],
      NOW,
    );
    expect(report.rows[0]!.phaseId).toBe('ours');
    expect(report.rows[0]!.actionable).toBe(true);
    expect(report.rows[1]!.actionable).toBe(false);
  });

  it('separates cash we can act on from cash waiting on someone else', () => {
    const report = buildUnlockReport(
      [
        stage({ phaseId: 'ours', stageKey: 'cab_assembly' }),
        stage({ phaseId: 'client', stageKey: 'site_preparation' }),
        stage({ phaseId: 'customs', stageKey: 'shipping_customs' }),
      ],
      [
        milestone({ milestoneId: 'a', phaseId: 'ours', grossSantim: ETB(1_000_000) }),
        milestone({ milestoneId: 'b', phaseId: 'client', grossSantim: ETB(2_000_000) }),
        milestone({ milestoneId: 'c', phaseId: 'customs', grossSantim: ETB(3_000_000) }),
      ],
      NOW,
    );
    expect(report.actionableSantim).toBe(ETB(1_000_000));
    expect(report.waitingOnOthersSantim).toBe(ETB(5_000_000));
    expect(report.byOwner.client).toBe(ETB(2_000_000));
    expect(report.byOwner.supplier).toBe(ETB(3_000_000));
  });

  it('marks a stage whose predecessor is unfinished as not actionable', () => {
    const report = buildUnlockReport(
      [
        stage({ phaseId: 'first', stageKey: 'rail_installation', progressBps: 4_000 }),
        stage({ phaseId: 'second', stageKey: 'cab_assembly', dependsOnPhaseIds: ['first'] }),
      ],
      [milestone({ phaseId: 'second' })],
      NOW,
    );
    const row = report.rows.find((r) => r.phaseId === 'second');
    expect(row!.actionable).toBe(false);
    expect(row!.blockedByPhaseIds).toEqual(['first']);
    expect(report.blockedSantim).toBe(ETB(1_000_000));
  });

  it('treats a manually blocked stage as not actionable', () => {
    const report = buildUnlockReport(
      [stage({ stageKey: 'cab_assembly', status: 'blocked' })],
      [milestone()],
      NOW,
    );
    expect(report.rows[0]!.actionable).toBe(false);
  });

  it('adds up several milestones gated on one stage', () => {
    const report = buildUnlockReport(
      [stage()],
      [
        milestone({ milestoneId: 'a', grossSantim: ETB(400_000) }),
        milestone({ milestoneId: 'b', grossSantim: ETB(600_000), name: 'Retention release' }),
      ],
      NOW,
    );
    expect(report.rows[0]!.gatedSantim).toBe(ETB(1_000_000));
    expect(report.rows[0]!.milestones).toHaveLength(2);
  });

  it('crosses project boundaries — four small stages can beat one large project', () => {
    const report = buildUnlockReport(
      [
        stage({ projectId: 'a', phaseId: 'a1', stageKey: 'testing', progressBps: 9_500 }),
        stage({ projectId: 'b', phaseId: 'b1', stageKey: 'testing', progressBps: 9_500 }),
        stage({ projectId: 'c', phaseId: 'c1', stageKey: 'manufacturing', progressBps: 1_000 }),
      ],
      [
        milestone({ milestoneId: 'a', phaseId: 'a1', grossSantim: ETB(800_000) }),
        milestone({ milestoneId: 'b', phaseId: 'b1', grossSantim: ETB(800_000) }),
        milestone({ milestoneId: 'c', phaseId: 'c1', grossSantim: ETB(1_500_000) }),
      ],
      NOW,
    );
    // The two near-complete stages lead, even though the single big one holds more.
    expect(report.rows.slice(0, 2).map((r) => r.projectId).sort()).toEqual(['a', 'b']);
  });

  it('flags an overdue stage', () => {
    const report = buildUnlockReport([stage({ plannedEnd: utc(2025, 8, 1) })], [milestone()], NOW);
    expect(report.rows[0]!.overdue).toBe(true);
    expect(report.rows[0]!.daysUntilPlannedEnd).toBeLessThan(0);
  });

  it('handles an empty portfolio', () => {
    const report = buildUnlockReport([], [], NOW);
    expect(report.rows).toEqual([]);
    expect(report.totalGatedSantim).toBe(0);
  });
});

describe('project standing', () => {
  const project = {
    projectId: 'p1',
    title: 'Bole Tower',
    clientName: 'Bole Development',
    contractGrossSantim: ETB(4_830_000),
    invoicedGrossSantim: ETB(1_932_000),
    collectedGrossSantim: ETB(966_000),
  };

  it('reports how much of the contract is left to bill', () => {
    const standing = projectStanding(project, [stage()], []);
    expect(standing.remainingContractSantim).toBe(ETB(2_898_000));
    expect(standing.remainingBps).toBe(6000); // 60% still to invoice
  });

  it('reports the furthest stage under way, not the earliest unfinished one', () => {
    // Sites overlap; pegging a project to whatever small thing got left behind
    // would understate where it actually is.
    const standing = projectStanding(
      project,
      [
        stage({ phaseId: 'a', stageKey: 'site_preparation', progressBps: 6_000 }),
        stage({ phaseId: 'b', stageKey: 'rail_installation', progressBps: 10_000 }),
        stage({ phaseId: 'c', stageKey: 'cab_assembly', progressBps: 3_000 }),
        stage({ phaseId: 'd', stageKey: 'testing', progressBps: 0 }),
      ],
      [],
    );
    expect(standing.currentStageKey).toBe('cab_assembly');
    expect(standing.stagesComplete).toBe(1);
    expect(standing.stagesTotal).toBe(4);
  });

  it('reports how much of the remaining value our own crew can unlock', () => {
    const stages = [
      stage({ phaseId: 'ours', stageKey: 'cab_assembly' }),
      stage({ phaseId: 'customs', stageKey: 'shipping_customs' }),
    ];
    const report = buildUnlockReport(stages, [
      milestone({ milestoneId: 'a', phaseId: 'ours', grossSantim: ETB(1_000_000) }),
      milestone({ milestoneId: 'b', phaseId: 'customs', grossSantim: ETB(2_000_000) }),
    ], NOW);
    const standing = projectStanding(project, stages, report.rows);
    expect(standing.unlockableSantim).toBe(ETB(1_000_000));
  });

  it('does not divide by zero on a project with no contract', () => {
    const standing = projectStanding(
      { ...project, contractGrossSantim: 0, invoicedGrossSantim: 0 },
      [],
      [],
    );
    expect(standing.remainingBps).toBeNull();
    expect(standing.progressBps).toBe(0);
  });
});
