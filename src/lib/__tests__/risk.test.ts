import { describe, expect, it } from 'vitest';
import { assessProjectRisk, sortFlags, summarise, type RiskInput } from '../risk.js';
import type { ProjectKpiResult } from '../kpi.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;

const healthyKpi = (over: Partial<ProjectKpiResult> = {}): ProjectKpiResult => ({
  progressBps: 6000,
  expectedProgressBps: 6000,
  scheduleVarianceBps: 0,
  scheduleVarianceDays: null,
  daysToPlannedEnd: 60,
  overdue: false,
  contractNetSantim: ETB(4_000_000),
  subcontractCostNetSantim: ETB(2_800_000),
  grossMarginSantim: ETB(1_200_000),
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

const input = (over: Partial<RiskInput> = {}): RiskInput => ({
  kpi: healthyKpi(),
  status: 'in_progress',
  overdueReceivableSantim: 0,
  oldestOverdueDays: null,
  assignedTechnicians: 3,
  expiredCertifications: 0,
  teamRepeatCalloutBps: 800,
  daysSinceProgressChange: 3,
  ...over,
});

describe('a healthy project raises nothing', () => {
  it('is not in danger', () => {
    const r = assessProjectRisk(input());
    expect(r.flags).toEqual([]);
    expect(r.level).toBe('none');
    expect(r.inDanger).toBe(false);
    expect(r.riskScoreBps).toBe(0);
  });
});

describe('cash risks', () => {
  it('escalates old receivables to critical', () => {
    const r = assessProjectRisk(
      input({ overdueReceivableSantim: ETB(800_000), oldestOverdueDays: 120 }),
    );
    const flag = r.flags.find((f) => f.code === 'overdue_receivable');
    expect(flag?.severity).toBe('critical');
    expect(flag?.amountSantim).toBe(ETB(800_000));
    expect(flag?.message).toContain('120 days');
  });

  it('treats recently overdue money as high, not critical', () => {
    const r = assessProjectRisk(
      input({ overdueReceivableSantim: ETB(200_000), oldestOverdueDays: 45 }),
    );
    expect(r.flags.find((f) => f.code === 'overdue_receivable')?.severity).toBe('high');
  });

  it('stays quiet inside normal payment terms', () => {
    const r = assessProjectRisk(
      input({ overdueReceivableSantim: ETB(200_000), oldestOverdueDays: 10 }),
    );
    expect(r.flags.find((f) => f.code === 'overdue_receivable')).toBeUndefined();
  });

  it('flags severe under-billing with the ETB at stake', () => {
    const r = assessProjectRisk(input({ kpi: healthyKpi({ underBillingBps: 2500 }) }));
    const flag = r.flags.find((f) => f.code === 'severe_under_billing');
    expect(flag?.severity).toBe('high');
    // 25% of a 4,000,000 contract.
    expect(flag?.amountSantim).toBe(ETB(1_000_000));
  });
});

describe('margin risks', () => {
  it('calls a loss-making project critical', () => {
    const r = assessProjectRisk(
      input({ kpi: healthyKpi({ grossMarginBps: -500, grossMarginSantim: -ETB(200_000) }) }),
    );
    expect(r.flags.find((f) => f.code === 'margin_negative')?.severity).toBe('critical');
    expect(r.inDanger).toBe(true);
  });

  it('warns on eroding margin', () => {
    const r = assessProjectRisk(input({ kpi: healthyKpi({ grossMarginBps: 800 }) }));
    expect(r.flags.find((f) => f.code === 'margin_erosion')?.severity).toBe('high');
  });
});

describe('schedule risks', () => {
  it('calls an overdue live project critical', () => {
    const r = assessProjectRisk(
      input({ kpi: healthyKpi({ overdue: true, daysToPlannedEnd: -40 }) }),
    );
    expect(r.flags.find((f) => f.code === 'overdue_delivery')?.severity).toBe('critical');
  });

  it('escalates a large slip above a small one', () => {
    const small = assessProjectRisk(input({ kpi: healthyKpi({ scheduleVarianceBps: -700 }) }));
    const large = assessProjectRisk(input({ kpi: healthyKpi({ scheduleVarianceBps: -3000 }) }));
    expect(small.flags.find((f) => f.code === 'schedule_slip')?.severity).toBe('medium');
    expect(large.flags.find((f) => f.code === 'schedule_slip')?.severity).toBe('high');
  });

  it('flags a stalled project', () => {
    const r = assessProjectRisk(input({ daysSinceProgressChange: 40 }));
    expect(r.flags.find((f) => f.code === 'stalled_progress')?.severity).toBe('high');
  });

  it('does not raise schedule flags on a completed project', () => {
    const r = assessProjectRisk(
      input({ status: 'completed', kpi: healthyKpi({ overdue: true, scheduleVarianceBps: -3000 }) }),
    );
    expect(r.flags.find((f) => f.code === 'overdue_delivery')).toBeUndefined();
    expect(r.flags.find((f) => f.code === 'schedule_slip')).toBeUndefined();
  });

  it('still chases money owed on a completed project', () => {
    const r = assessProjectRisk(
      input({ status: 'completed', overdueReceivableSantim: ETB(500_000), oldestOverdueDays: 100 }),
    );
    expect(r.flags.find((f) => f.code === 'overdue_receivable')?.severity).toBe('critical');
  });
});

describe('team risks', () => {
  it('flags a live project with nobody assigned', () => {
    const r = assessProjectRisk(input({ assignedTechnicians: 0 }));
    expect(r.flags.find((f) => f.code === 'no_team_assigned')?.severity).toBe('high');
  });

  it('treats an expired certification as critical — certified work cannot proceed', () => {
    const r = assessProjectRisk(input({ expiredCertifications: 2 }));
    const flag = r.flags.find((f) => f.code === 'expired_certification');
    expect(flag?.severity).toBe('critical');
    expect(flag?.message).toContain('2 expired');
  });

  it('flags a crew whose first fixes are not holding', () => {
    const r = assessProjectRisk(input({ teamRepeatCalloutBps: 3500 }));
    expect(r.flags.find((f) => f.code === 'repeat_callouts')?.severity).toBe('medium');
  });

  it('says nothing when the crew has no callout data', () => {
    const r = assessProjectRisk(input({ teamRepeatCalloutBps: null }));
    expect(r.flags.find((f) => f.code === 'repeat_callouts')).toBeUndefined();
  });
});

describe('summarise', () => {
  it('takes the worst flag, not an average', () => {
    // Three mediums are not a crisis.
    const mediums = summarise([
      { code: 'poor_collection', severity: 'medium', message: 'a' },
      { code: 'repeat_callouts', severity: 'medium', message: 'b' },
      { code: 'schedule_slip', severity: 'medium', message: 'c' },
    ]);
    expect(mediums.level).toBe('medium');
    expect(mediums.inDanger).toBe(false);

    // And one critical is not softened by good news elsewhere.
    const withCritical = summarise([
      { code: 'poor_collection', severity: 'medium', message: 'a' },
      { code: 'margin_negative', severity: 'critical', message: 'b' },
    ]);
    expect(withCritical.level).toBe('critical');
    expect(withCritical.inDanger).toBe(true);
  });

  it('saturates the risk score rather than growing without bound', () => {
    const many = summarise(
      Array.from({ length: 10 }, () => ({ code: 'schedule_slip' as const, severity: 'critical' as const, message: 'x' })),
    );
    expect(many.riskScoreBps).toBe(10_000);
  });

  it('treats high as in danger and medium as not', () => {
    expect(summarise([{ code: 'stalled_progress', severity: 'high', message: 'x' }]).inDanger).toBe(true);
    expect(summarise([{ code: 'poor_collection', severity: 'medium', message: 'x' }]).inDanger).toBe(false);
  });
});

describe('sortFlags', () => {
  it('leads with the worst, then the largest amount', () => {
    const sorted = sortFlags([
      { code: 'poor_collection', severity: 'medium', message: 'c' },
      { code: 'overdue_receivable', severity: 'high', message: 'a', amountSantim: ETB(100_000) },
      { code: 'severe_under_billing', severity: 'high', message: 'b', amountSantim: ETB(900_000) },
      { code: 'margin_negative', severity: 'critical', message: 'd' },
    ]);
    expect(sorted.map((f) => f.code)).toEqual([
      'margin_negative',
      'severe_under_billing',
      'overdue_receivable',
      'poor_collection',
    ]);
  });
});
