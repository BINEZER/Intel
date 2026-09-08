import { describe, expect, it } from 'vitest';
import {
  achievement,
  achievementFromVariance,
  assertWeightsValid,
  composeScore,
  DEFAULT_PROJECT_WEIGHTS,
  DEFAULT_TECHNICIAN_WEIGHTS,
  projectScorecard,
  teamScore,
  technicianScorecard,
  type ScoreComponent,
  type TeamMemberScore,
} from '../scorecard.js';
import type { ProjectKpiResult, TechnicianKpiResult } from '../kpi.js';

const targets = {
  firstTimeFixBps: 8000,
  repeatCalloutBps: 1000,
  slaResponseComplianceBps: 9500,
  slaResolutionComplianceBps: 9000,
  pmComplianceBps: 9500,
  pmOnTimeBps: 9000,
  utilisationBps: 7500,
};

const techKpi = (over: Partial<TechnicianKpiResult> = {}): TechnicianKpiResult => ({
  calloutsHandled: 10,
  entrapments: 0,
  avgResponseMinutes: 40,
  medianResponseMinutes: 38,
  avgRepairMinutes: 70,
  slaResponseComplianceBps: 9500,
  slaResolutionComplianceBps: 9000,
  firstTimeFixBps: 8000,
  repeatCalloutBps: 1000,
  pmVisitsScheduled: 4,
  pmVisitsCompleted: 4,
  pmComplianceBps: 10000,
  pmOnTimeBps: 9000,
  loggedMinutes: 1800,
  utilisationBps: 7500,
  certificationsExpiringSoon: 0,
  certificationsExpired: 0,
  ...over,
});

describe('weights must sum to 10000', () => {
  it('accepts the shipped defaults', () => {
    expect(() => assertWeightsValid(DEFAULT_TECHNICIAN_WEIGHTS as unknown as Record<string, number>)).not.toThrow();
    expect(() => assertWeightsValid(DEFAULT_PROJECT_WEIGHTS as unknown as Record<string, number>)).not.toThrow();
  });

  it('rejects weights that do not sum to 100%', () => {
    expect(() => assertWeightsValid({ a: 5000, b: 4000 })).toThrow(/must sum to 10000/);
  });

  it('rejects a negative or fractional weight', () => {
    expect(() => assertWeightsValid({ a: 10500, b: -500 })).toThrow(/non-negative integer/);
    expect(() => assertWeightsValid({ a: 5000.5, b: 4999.5 })).toThrow(/non-negative integer/);
  });
});

describe('achievement', () => {
  it('scores against target for higher-is-better', () => {
    expect(achievement(8000, 8000)).toBe(10_000);
    expect(achievement(4000, 8000)).toBe(5_000);
  });

  it('caps at 100% so one great metric cannot cancel a failure', () => {
    expect(achievement(16_000, 8000)).toBe(10_000);
  });

  it('inverts for lower-is-better', () => {
    expect(achievement(1000, 1000, 'lower')).toBe(10_000);
    expect(achievement(2000, 1000, 'lower')).toBe(5_000);
  });

  it('treats zero as perfect on a lower-is-better metric, not a division by zero', () => {
    expect(achievement(0, 1000, 'lower')).toBe(10_000);
  });

  it('passes null through as unmeasurable', () => {
    expect(achievement(null, 8000)).toBeNull();
  });
});

describe('achievementFromVariance', () => {
  it('gives full marks on or ahead of plan', () => {
    expect(achievementFromVariance(0, -500)).toBe(10_000);
    expect(achievementFromVariance(1500, -500)).toBe(10_000);
  });

  it('gives half marks at the tolerance', () => {
    expect(achievementFromVariance(-500, -500)).toBe(5_000);
  });

  it('bottoms out at twice the tolerance', () => {
    expect(achievementFromVariance(-1000, -500)).toBe(0);
    expect(achievementFromVariance(-5000, -500)).toBe(0);
  });
});

describe('composeScore redistributes the weight of missing data', () => {
  const component = (key: string, achievementBps: number | null, weightBps: number): ScoreComponent => ({
    key, label: key, achievementBps, weightBps, rawValue: achievementBps, target: 10_000, direction: 'higher',
  });

  it('scores a fully measured card as a plain weighted mean', () => {
    const card = composeScore([component('a', 10_000, 5000), component('b', 5_000, 5000)]);
    expect(card.scoreBps).toBe(7_500);
    expect(card.coverageBps).toBe(10_000);
  });

  it('does NOT score a missing component as zero', () => {
    // The whole point. Both measured components are perfect; the missing one
    // must not drag the score to 66%.
    const card = composeScore([
      component('a', 10_000, 3000),
      component('b', 10_000, 3000),
      component('missing', null, 4000),
    ]);
    expect(card.scoreBps).toBe(10_000);
    expect(card.coverageBps).toBe(6_000); // but coverage shows the card is thin
  });

  it('returns null rather than 0 when nothing is measurable', () => {
    const card = composeScore([component('a', null, 5000), component('b', null, 5000)]);
    expect(card.scoreBps).toBeNull();
    expect(card.coverageBps).toBe(0);
    expect(card.grade).toBe('unknown');
  });

  it('grades on the composite', () => {
    expect(composeScore([component('a', 9_500, 10_000)]).grade).toBe('good');
    expect(composeScore([component('a', 7_500, 10_000)]).grade).toBe('warn');
    expect(composeScore([component('a', 3_000, 10_000)]).grade).toBe('bad');
  });
});

describe('technician scorecard', () => {
  it('scores a technician exactly on target at 100%', () => {
    const card = technicianScorecard(techKpi({ pmComplianceBps: 9500 }), targets);
    expect(card.scoreBps).toBe(10_000);
    expect(card.coverageBps).toBe(10_000);
  });

  it('weights first-time fix more heavily than utilisation', () => {
    const ftfPoor = technicianScorecard(techKpi({ firstTimeFixBps: 0 }), targets);
    const utilPoor = technicianScorecard(techKpi({ utilisationBps: 0 }), targets);
    // Same metric collapse, very different cost — quality carries more weight.
    expect(ftfPoor.scoreBps!).toBeLessThan(utilPoor.scoreBps!);
  });

  it('penalises high repeat callouts', () => {
    const clean = technicianScorecard(techKpi(), targets);
    const repeats = technicianScorecard(techKpi({ repeatCalloutBps: 4000 }), targets);
    expect(repeats.scoreBps!).toBeLessThan(clean.scoreBps!);
  });

  it('does not punish a technician for a month with no callouts', () => {
    const quiet = technicianScorecard(
      techKpi({
        calloutsHandled: 0,
        firstTimeFixBps: null,
        repeatCalloutBps: null,
        slaResponseComplianceBps: null,
        slaResolutionComplianceBps: null,
      }),
      targets,
    );
    // Their PM work still scores; the missing callout metrics are dropped.
    expect(quiet.scoreBps).not.toBeNull();
    expect(quiet.coverageBps).toBeLessThan(10_000);
    expect(quiet.scoreBps!).toBeGreaterThan(5_000);
  });

  it('returns an unknown card for a technician with no data at all', () => {
    const none = technicianScorecard(
      techKpi({
        firstTimeFixBps: null, repeatCalloutBps: null, slaResponseComplianceBps: null,
        slaResolutionComplianceBps: null, pmComplianceBps: null, pmOnTimeBps: null,
        utilisationBps: null,
      }),
      targets,
    );
    expect(none.scoreBps).toBeNull();
    expect(none.grade).toBe('unknown');
  });
});

describe('team score', () => {
  const member = (id: string, scoreBps: number | null, allocationBps: number): TeamMemberScore => ({
    technicianId: id,
    technicianName: id,
    allocationBps,
    scorecard: { scoreBps, coverageBps: 10_000, components: [], grade: 'good' },
  });

  it('weights by allocation, so the lead moves the number most', () => {
    // 6000@10000 + 1000@4000 -> weighted toward the lead.
    const t = teamScore([member('lead', 10_000, 6000), member('helper', 4_000, 1000)]);
    expect(t.scoreBps).toBe(9_143);
  });

  it('ignores unscorable members instead of counting them as zero', () => {
    const t = teamScore([member('a', 9_000, 5000), member('b', null, 5000)]);
    expect(t.scoreBps).toBe(9_000);
    expect(t.unscoredMembers).toBe(1);
  });

  it('returns null when nobody on the crew can be scored', () => {
    expect(teamScore([member('a', null, 5000)]).scoreBps).toBeNull();
    expect(teamScore([]).scoreBps).toBeNull();
  });

  it('ignores a member with zero allocation', () => {
    const t = teamScore([member('a', 10_000, 5000), member('b', 0, 0)]);
    expect(t.scoreBps).toBe(10_000);
  });
});

describe('project scorecard', () => {
  const projectKpi = (over: Partial<ProjectKpiResult> = {}): ProjectKpiResult => ({
    progressBps: 6000,
    expectedProgressBps: 6000,
    scheduleVarianceBps: 0,
    scheduleVarianceDays: null,
    daysToPlannedEnd: 60,
    overdue: false,
    contractNetSantim: 100_000_00,
    subcontractCostNetSantim: 70_000_00,
    grossMarginSantim: 30_000_00,
    grossMarginBps: 3000,
    invoicedBps: 6000,
    collectionRateBps: 9000,
    underBillingBps: 0,
    avgCollectionDays: 30,
    phasesCompleted: 3,
    phasesTotal: 5,
    inspectionFirstPass: null,
    inspectionAttempts: 0,
    phaseDurationDays: {},
    ...over,
  });

  const scoreTargets = {
    scheduleVarianceBps: -500,
    grossMarginBps: 2500,
    underBillingToleranceBps: 1000,
    collectionRateBps: 9000,
  };

  it('scores a healthy project highly', () => {
    const card = projectScorecard(projectKpi(), scoreTargets, null);
    expect(card.scoreBps!).toBeGreaterThan(9_000);
  });

  it('drops the team component when no crew is scorable', () => {
    const withoutTeam = projectScorecard(projectKpi(), scoreTargets, null);
    expect(withoutTeam.coverageBps).toBeLessThan(10_000);

    const withTeam = projectScorecard(projectKpi(), scoreTargets, {
      scoreBps: 5_000,
      members: [],
      unscoredMembers: 0,
    });
    // A weak crew pulls the project score down; an absent one does not.
    expect(withTeam.scoreBps!).toBeLessThan(withoutTeam.scoreBps!);
  });

  it('inherits the crew score as the team component', () => {
    const good = projectScorecard(projectKpi(), scoreTargets, { scoreBps: 10_000, members: [], unscoredMembers: 0 });
    const poor = projectScorecard(projectKpi(), scoreTargets, { scoreBps: 2_000, members: [], unscoredMembers: 0 });
    expect(good.scoreBps!).toBeGreaterThan(poor.scoreBps!);
  });

  it('does not penalise billing that runs ahead of progress', () => {
    const ahead = projectScorecard(projectKpi({ underBillingBps: -2000 }), scoreTargets, null);
    const level = projectScorecard(projectKpi({ underBillingBps: 0 }), scoreTargets, null);
    expect(ahead.scoreBps).toBe(level.scoreBps);
  });

  it('marks down a failed inspection but not a pending one', () => {
    const pending = projectScorecard(projectKpi(), scoreTargets, null);
    const failed = projectScorecard(projectKpi({ inspectionFirstPass: false, inspectionAttempts: 2 }), scoreTargets, null);
    const passed = projectScorecard(projectKpi({ inspectionFirstPass: true, inspectionAttempts: 1 }), scoreTargets, null);
    expect(failed.scoreBps!).toBeLessThan(passed.scoreBps!);
    expect(pending.components.find((c) => c.key === 'quality')?.achievementBps).toBeNull();
  });

  it('punishes a schedule slip through the variance component', () => {
    const behind = projectScorecard(
      projectKpi({ progressBps: 4000, scheduleVarianceBps: -2000 }),
      scoreTargets,
      null,
    );
    expect(behind.components.find((c) => c.key === 'schedule')?.achievementBps).toBe(0);
    expect(behind.scoreBps!).toBeLessThan(8_000);
  });
});
