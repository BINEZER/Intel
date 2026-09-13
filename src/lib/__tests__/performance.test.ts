import { describe, expect, it } from 'vitest';
import {
  computeInstallationKpi,
  computeSubcontractorKpi,
  headlineMetrics,
  type StageOutcomeInput,
  type SubcontractorWorkInput,
  type WorkforceRow,
} from '../performance.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const stage = (over: Partial<StageOutcomeInput> = {}): StageOutcomeInput => ({
  projectId: 'p1',
  stageKey: 'cab_assembly',
  status: 'completed',
  plannedEnd: utc(2025, 6, 30),
  actualEnd: utc(2025, 6, 28),
  ours: true,
  ...over,
});

describe('installation performance', () => {
  it('scores an installer on stages delivered, not on callouts', () => {
    // The gap this closes: an installer previously scored null on everything.
    const kpi = computeInstallationKpi(
      [stage(), stage({ projectId: 'p2', stageKey: 'rail_installation' })],
      [],
    );
    expect(kpi.stagesCompleted).toBe(2);
    expect(kpi.projectsWorked).toBe(2);
    expect(kpi.onTimeStageBps).toBe(10_000);
  });

  it('counts a stage finished on the planned day as on time', () => {
    const kpi = computeInstallationKpi([stage({ actualEnd: utc(2025, 6, 30) })], []);
    expect(kpi.onTimeStageBps).toBe(10_000);
    expect(kpi.avgStageVarianceDays).toBe(0);
  });

  it('measures how late, not just whether late', () => {
    const kpi = computeInstallationKpi(
      [
        stage({ actualEnd: utc(2025, 7, 10) }),  // 10 days late
        stage({ projectId: 'p2', actualEnd: utc(2025, 6, 28) }), // 2 early
      ],
      [],
    );
    expect(kpi.onTimeStageBps).toBe(5_000);
    expect(kpi.lateStages).toBe(1);
    expect(kpi.avgStageVarianceDays).toBe(4); // (10 + -2) / 2
  });

  it('EXCLUDES stages owned by the client, supplier or authority', () => {
    // Marking a crew down because customs held a shipment is the fastest way to
    // make a scorecard ignored.
    const kpi = computeInstallationKpi(
      [
        stage({ ours: true, actualEnd: utc(2025, 6, 28) }),
        stage({ ours: false, stageKey: 'shipping_customs', actualEnd: utc(2025, 9, 30) }),
      ],
      [],
    );
    expect(kpi.stagesCompleted).toBe(1);
    expect(kpi.onTimeStageBps).toBe(10_000); // the customs delay is not theirs
  });

  it('credits a first-pass authority inspection', () => {
    const kpi = computeInstallationKpi(
      [stage()],
      [
        { projectId: 'p1', result: 'passed', attempts: 1 },
        { projectId: 'p2', result: 'passed', attempts: 3 },
      ],
    );
    expect(kpi.firstPassInspectionBps).toBe(5_000);
    expect(kpi.inspectionsJudged).toBe(2);
  });

  it('ignores inspections that have not happened', () => {
    const kpi = computeInstallationKpi([stage()], [{ projectId: 'p1', result: 'pending', attempts: 0 }]);
    expect(kpi.firstPassInspectionBps).toBeNull();
  });

  it('counts blocked stages without scoring them as failures', () => {
    const kpi = computeInstallationKpi(
      [stage({ status: 'blocked', actualEnd: null })],
      [],
    );
    expect(kpi.blockedStages).toBe(1);
    expect(kpi.onTimeStageBps).toBeNull(); // nothing completed, so nothing judged
  });

  it('returns nulls rather than zeros for a crew with no completed work', () => {
    const kpi = computeInstallationKpi([stage({ status: 'in_progress', actualEnd: null })], []);
    expect(kpi.onTimeStageBps).toBeNull();
    expect(kpi.avgStageVarianceDays).toBeNull();
    expect(kpi.stagesInProgress).toBe(1);
  });
});

describe('subcontractor performance', () => {
  const work = (over: Partial<SubcontractorWorkInput> = {}): SubcontractorWorkInput => ({
    projectId: 'p1',
    phaseName: 'Shaft preparation',
    netSantim: ETB(300_000),
    whtSantim: ETB(9_000),
    status: 'paid',
    invoicedAt: utc(2025, 6, 1),
    paidAt: utc(2025, 6, 21),
    ...over,
  });

  it('totals what was committed and what was actually paid', () => {
    const kpi = computeSubcontractorKpi(
      [work(), work({ status: 'approved', paidAt: null })],
      [],
      true,
    );
    expect(kpi.committedNetSantim).toBe(ETB(600_000));
    expect(kpi.paidNetSantim).toBe(ETB(300_000));
    expect(kpi.outstandingVouchers).toBe(1);
    expect(kpi.outstandingNetSantim).toBe(ETB(300_000));
  });

  it('measures how long WE take to pay them', () => {
    // Reported on their card on purpose: a subcontractor paid 90 days late who
    // still turns up is performing well, and their delivery figures are unfair
    // without that context.
    const kpi = computeSubcontractorKpi(
      [work({ paidAt: utc(2025, 6, 21) }), work({ paidAt: utc(2025, 7, 1) })],
      [],
      true,
    );
    expect(kpi.avgDaysToPaySantim).toBe(25); // (20 + 30) / 2
  });

  it('tracks rejected vouchers as a paperwork signal', () => {
    const kpi = computeSubcontractorKpi(
      [work(), work({ status: 'rejected', paidAt: null }), work()],
      [],
      true,
    );
    expect(kpi.rejectionBps).toBe(3333);
  });

  it('excludes voided vouchers from every count', () => {
    const kpi = computeSubcontractorKpi([work(), work({ status: 'void' })], [], true);
    expect(kpi.vouchers).toBe(1);
  });

  it('surfaces a missing TIN, which forces the 30% penalty rate', () => {
    expect(computeSubcontractorKpi([work()], [], false).hasTin).toBe(false);
  });

  it('scores their stage delivery separately from their invoicing', () => {
    const kpi = computeSubcontractorKpi(
      [work()],
      [
        stage({ actualEnd: utc(2025, 6, 28) }),
        stage({ actualEnd: utc(2025, 7, 15) }),
      ],
      true,
    );
    expect(kpi.onTimeStageBps).toBe(5_000);
  });

  it('returns nulls for a subcontractor with no history', () => {
    const kpi = computeSubcontractorKpi([], [], true);
    expect(kpi.avgDaysToPaySantim).toBeNull();
    expect(kpi.rejectionBps).toBeNull();
    expect(kpi.onTimeStageBps).toBeNull();
    expect(kpi.committedNetSantim).toBe(0);
  });
});

describe('headline metrics adapt to the discipline', () => {
  const base: WorkforceRow = {
    id: 't1', name: 'Abel', kind: 'technician', discipline: 'installation',
    installation: computeInstallationKpi([stage()], [{ projectId: 'p1', result: 'passed', attempts: 1 }]),
    service: null, subcontractor: null,
    certificationsExpired: 0, certificationsExpiringSoon: 0, scoreBps: null, coverageBps: 0,
  };

  it('shows stage delivery for an installer', () => {
    expect(headlineMetrics(base).map((m) => m.label)).toEqual([
      'On-time stages', 'First-pass inspection',
    ]);
  });

  it('shows callout quality for a service technician', () => {
    const service: WorkforceRow = {
      ...base, discipline: 'service', installation: null,
      service: {
        calloutsHandled: 10, firstTimeFixBps: 8_000, repeatCalloutBps: 1_000,
        slaResponseComplianceBps: 9_500, pmComplianceBps: 10_000,
      },
    };
    expect(headlineMetrics(service).map((m) => m.label)).toEqual([
      'First-time fix', 'Response SLA',
    ]);
  });

  it('shows both for someone who does both', () => {
    const both: WorkforceRow = {
      ...base, discipline: 'both',
      service: {
        calloutsHandled: 4, firstTimeFixBps: 7_500, repeatCalloutBps: 500,
        slaResponseComplianceBps: 9_000, pmComplianceBps: 9_000,
      },
    };
    expect(headlineMetrics(both)).toHaveLength(4);
  });

  it('shows delivery and paperwork for a subcontractor', () => {
    const sub: WorkforceRow = {
      ...base, kind: 'subcontractor', discipline: null, installation: null,
      subcontractor: computeSubcontractorKpi([], [], true),
    };
    expect(headlineMetrics(sub).map((m) => m.label)).toEqual([
      'On-time stages', 'Rejected vouchers',
    ]);
  });
});
