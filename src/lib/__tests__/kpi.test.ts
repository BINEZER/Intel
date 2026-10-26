import { describe, expect, it } from 'vitest';
import {
  calloutDurations,
  computeProjectKpis,
  computeTechnicianKpis,
  daysBetween,
  expectedProgressBps,
  flagRepeatCallouts,
  formatBps,
  formatMinutes,
  formatVarianceDays,
  grade,
  median,
  rateBps,
  type CalloutKpiInput,
  type ProjectKpiInput,
  type VisitKpiInput,
} from '../kpi.js';
import { birrToSantim } from '../money.js';

const utc = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, min));
const ETB = birrToSantim;

describe('rateBps — no data is not zero', () => {
  it('returns null rather than 0 when there is nothing to divide by', () => {
    // This is the whole point: a technician with no callouts must not be shown
    // as 0% compliant.
    expect(rateBps(0, 0)).toBeNull();
    expect(rateBps(0, 5)).toBe(0);
    expect(rateBps(19, 20)).toBe(9500);
  });

  it('renders null as an em dash, not 0.0%', () => {
    expect(formatBps(null)).toBe('—');
    expect(formatBps(0)).toBe('0.0%');
    expect(formatBps(9500)).toBe('95.0%');
  });
});

describe('grade', () => {
  it('grades higher-is-better metrics with a 10% amber band', () => {
    expect(grade(9600, 9500, 'higher')).toBe('good');
    expect(grade(9000, 9500, 'higher')).toBe('warn');  // within 950 of target
    expect(grade(5000, 9500, 'higher')).toBe('bad');
  });

  it('grades lower-is-better metrics', () => {
    expect(grade(800, 1000, 'lower')).toBe('good');
    expect(grade(1050, 1000, 'lower')).toBe('warn');
    expect(grade(3000, 1000, 'lower')).toBe('bad');
  });

  it('reports unknown for missing data instead of failing it', () => {
    expect(grade(null, 9500)).toBe('unknown');
  });
});

describe('median', () => {
  it('resists a single outlier that would drag the mean', () => {
    // One four-hour callout among quick ones.
    expect(median([20, 25, 30, 35, 240])).toBe(30);
  });

  it('averages the middle pair for an even count', () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('returns null for no data', () => {
    expect(median([])).toBeNull();
  });
});

describe('expectedProgressBps', () => {
  const start = utc(2025, 1, 1);
  const end = utc(2025, 12, 31);

  it('is 0 at the start and 10000 at the end', () => {
    expect(expectedProgressBps(start, end, start)).toBe(0);
    expect(expectedProgressBps(start, end, end)).toBe(10_000);
  });

  it('is roughly half way through the middle', () => {
    const mid = utc(2025, 7, 2);
    expect(expectedProgressBps(start, end, mid)).toBeGreaterThan(4900);
    expect(expectedProgressBps(start, end, mid)).toBeLessThan(5100);
  });

  it('clamps rather than exceeding 100% after the planned end', () => {
    expect(expectedProgressBps(start, end, utc(2026, 6, 1))).toBe(10_000);
    expect(expectedProgressBps(start, end, utc(2024, 6, 1))).toBe(0);
  });

  it('does not divide by zero on a zero-length plan', () => {
    const d = utc(2025, 5, 5);
    expect(expectedProgressBps(d, d, d)).toBe(10_000);
  });
});

describe('project KPIs', () => {
  const base: ProjectKpiInput = {
    plannedStart: utc(2025, 1, 1),
    plannedEnd: utc(2025, 12, 31),
    actualStart: utc(2025, 1, 6),
    actualEnd: null,
    progressBps: 4000,
    status: 'in_progress',
    contractNetSantim: ETB(1_000_000),
    subcontractCostNetSantim: ETB(600_000),
    invoicedNetSantim: ETB(300_000),
    invoicedGrossSantim: ETB(345_000),
    collectedGrossSantim: ETB(230_000),
    phases: [
      { key: 'shaft_prep', status: 'completed', actualStart: utc(2025, 1, 6), actualEnd: utc(2025, 2, 20) },
      { key: 'rail_installation', status: 'in_progress', actualStart: utc(2025, 2, 21), actualEnd: null },
      {
        key: 'authority_inspection',
        status: 'not_started',
        actualStart: null,
        actualEnd: null,
        certification: { result: 'pending', attempts: 0 },
      },
    ],
    settledInvoices: [
      { issuedAt: utc(2025, 2, 1), settledAt: utc(2025, 3, 18), grossSantim: ETB(115_000) },
      { issuedAt: utc(2025, 4, 1), settledAt: utc(2025, 4, 21), grossSantim: ETB(115_000) },
    ],
  };

  it('flags a project behind schedule', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    expect(k.expectedProgressBps).toBeGreaterThan(4900); // ~50% of the plan elapsed
    expect(k.progressBps).toBe(4000);
    expect(k.scheduleVarianceBps).toBeLessThan(0);       // 40% done, ~50% elapsed
    expect(k.overdue).toBe(false);
    expect(k.daysToPlannedEnd).toBe(182);
  });

  it('marks a project overdue once the planned end passes', () => {
    const k = computeProjectKpis(base, utc(2026, 2, 1));
    expect(k.overdue).toBe(true);
    expect(k.daysToPlannedEnd).toBeLessThan(0);
  });

  it('reports schedule variance in days only once the project is finished', () => {
    expect(computeProjectKpis(base, utc(2025, 7, 2)).scheduleVarianceDays).toBeNull();

    const finished = { ...base, status: 'completed' as const, actualEnd: utc(2026, 1, 14) };
    const k = computeProjectKpis(finished, utc(2026, 2, 1));
    expect(k.scheduleVarianceDays).toBe(14); // 14 days past 31 Dec
    expect(k.overdue).toBe(false);           // finished, so no longer "overdue"
    expect(k.scheduleVarianceDays).toBe(14); // retain the historical lateness
  });

  it('computes margin excluding VAT', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    expect(k.grossMarginSantim).toBe(ETB(400_000));
    expect(k.grossMarginBps).toBe(4000); // 40%
  });

  it('surfaces under-billing: more built than billed', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    expect(k.invoicedBps).toBe(3000);      // 30% of contract value invoiced
    expect(k.underBillingBps).toBe(1000);  // 40% built - 30% billed = 10% unbilled WIP
  });

  it('weights collection days by invoice value', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    // Equal-value invoices settled in 45 and 20 days.
    expect(k.avgCollectionDays).toBe(33);
  });

  it('reports collection rate against what was invoiced', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    expect(k.collectionRateBps).toBe(6667); // 230k of 345k
  });

  it('measures completed phase durations', () => {
    const k = computeProjectKpis(base, utc(2025, 7, 2));
    expect(k.phaseDurationDays['shaft_prep']).toBe(45);
    expect(k.phaseDurationDays['rail_installation']).toBeUndefined(); // still running
    expect(k.phasesCompleted).toBe(1);
    expect(k.phasesTotal).toBe(3);
  });

  it('withholds a first-pass verdict until the inspection has happened', () => {
    expect(computeProjectKpis(base, utc(2025, 7, 2)).inspectionFirstPass).toBeNull();
  });

  it('records a first-pass inspection', () => {
    const passed: ProjectKpiInput = {
      ...base,
      phases: base.phases.map((p) =>
        p.certification ? { ...p, certification: { result: 'passed' as const, attempts: 1 } } : p,
      ),
    };
    expect(computeProjectKpis(passed, utc(2026, 1, 1)).inspectionFirstPass).toBe(true);
  });

  it('does not credit a first pass to an inspection that needed rework', () => {
    const reworked: ProjectKpiInput = {
      ...base,
      phases: base.phases.map((p) =>
        p.certification ? { ...p, certification: { result: 'passed' as const, attempts: 2 } } : p,
      ),
    };
    const k = computeProjectKpis(reworked, utc(2026, 1, 1));
    expect(k.inspectionFirstPass).toBe(false);
    expect(k.inspectionAttempts).toBe(2);
  });

  it('returns null rates rather than dividing by zero on an empty project', () => {
    const empty: ProjectKpiInput = {
      ...base,
      contractNetSantim: 0,
      subcontractCostNetSantim: 0,
      invoicedNetSantim: 0,
      invoicedGrossSantim: 0,
      collectedGrossSantim: 0,
      phases: [],
      settledInvoices: [],
    };
    const k = computeProjectKpis(empty, utc(2025, 7, 2));
    expect(k.grossMarginBps).toBeNull();
    expect(k.invoicedBps).toBeNull();
    expect(k.collectionRateBps).toBeNull();
    expect(k.underBillingBps).toBeNull();
    expect(k.avgCollectionDays).toBeNull();
  });
});

describe('callout durations', () => {
  const callout: CalloutKpiInput = {
    id: 'c1',
    technicianId: 't1',
    unitTag: 'LIFT-01',
    entrapment: false,
    reportedAt: utc(2025, 9, 11, 8, 0),
    arrivedAt: utc(2025, 9, 11, 8, 45),
    resolvedAt: utc(2025, 9, 11, 10, 15),
    slaResponseMinutes: 60,
    slaResolutionMinutes: 240,
    firstTimeFix: true,
    status: 'resolved',
    repeatOfCalloutId: null,
  };

  it('separates travel from repair', () => {
    const d = calloutDurations(callout);
    expect(d.responseMinutes).toBe(45);  // reported -> on site
    expect(d.repairMinutes).toBe(90);    // on site -> back in service
  });

  it('measures the resolution SLA from the report, as the client experiences it', () => {
    // 8:00 report to 10:15 resolved is 135 minutes, inside a 240-minute SLA,
    // even though the repair itself was 90 minutes.
    expect(calloutDurations(callout).breachedResolution).toBe(false);

    const slow = { ...callout, slaResolutionMinutes: 120 };
    expect(calloutDurations(slow).breachedResolution).toBe(true);
  });

  it('flags a response breach', () => {
    const late = { ...callout, arrivedAt: utc(2025, 9, 11, 9, 30) };
    expect(calloutDurations(late).breachedResponse).toBe(true);
  });

  it('returns null, not false, when there is no SLA or no arrival', () => {
    expect(calloutDurations({ ...callout, slaResponseMinutes: null }).breachedResponse).toBeNull();
    expect(calloutDurations({ ...callout, arrivedAt: null }).breachedResponse).toBeNull();
  });
});

describe('repeat callouts', () => {
  const make = (id: string, unitTag: string, day: number, resolvedDay = day): CalloutKpiInput => ({
    id,
    technicianId: 't1',
    unitTag,
    entrapment: false,
    reportedAt: utc(2025, 9, day, 9, 0),
    arrivedAt: utc(2025, 9, day, 10, 0),
    resolvedAt: utc(2025, 9, resolvedDay, 12, 0),
    slaResponseMinutes: 120,
    slaResolutionMinutes: 480,
    firstTimeFix: true,
    status: 'resolved',
    repeatOfCalloutId: null,
  });

  it('links a second callout on the same unit inside the window', () => {
    const flagged = flagRepeatCallouts([make('a', 'LIFT-01', 1), make('b', 'LIFT-01', 10)], 30);
    expect(flagged.find((c) => c.id === 'a')?.repeatOfCalloutId).toBeNull();
    expect(flagged.find((c) => c.id === 'b')?.repeatOfCalloutId).toBe('a');
  });

  it('does not link beyond the window', () => {
    const flagged = flagRepeatCallouts([make('a', 'LIFT-01', 1), make('b', 'LIFT-01', 1)], 30);
    const far = flagRepeatCallouts(
      [make('a', 'LIFT-01', 1), { ...make('b', 'LIFT-01', 1), reportedAt: utc(2025, 11, 15, 9, 0) }],
      30,
    );
    expect(flagged.find((c) => c.id === 'b')?.repeatOfCalloutId).toBe('a');
    expect(far.find((c) => c.id === 'b')?.repeatOfCalloutId).toBeNull();
  });

  it('does not link across different units', () => {
    const flagged = flagRepeatCallouts([make('a', 'LIFT-01', 1), make('b', 'LIFT-02', 5)], 30);
    expect(flagged.find((c) => c.id === 'b')?.repeatOfCalloutId).toBeNull();
  });

  it('does not treat an unresolved earlier callout as a first fix that failed', () => {
    const open = { ...make('a', 'LIFT-01', 1), resolvedAt: null, status: 'open' as const };
    const flagged = flagRepeatCallouts([open, make('b', 'LIFT-01', 5)], 30);
    expect(flagged.find((c) => c.id === 'b')?.repeatOfCalloutId).toBeNull();
  });

  it('does not mutate its input', () => {
    const input = [make('a', 'LIFT-01', 1), make('b', 'LIFT-01', 5)];
    flagRepeatCallouts(input, 30);
    expect(input[1]!.repeatOfCalloutId).toBeNull();
  });
});

describe('technician KPIs', () => {
  const callout = (over: Partial<CalloutKpiInput> = {}): CalloutKpiInput => ({
    id: 'c',
    technicianId: 't1',
    unitTag: 'LIFT-01',
    entrapment: false,
    reportedAt: utc(2025, 9, 11, 8, 0),
    arrivedAt: utc(2025, 9, 11, 8, 30),
    resolvedAt: utc(2025, 9, 11, 9, 30),
    slaResponseMinutes: 60,
    slaResolutionMinutes: 240,
    firstTimeFix: true,
    status: 'resolved',
    repeatOfCalloutId: null,
    ...over,
  });

  const visit = (over: Partial<VisitKpiInput> = {}): VisitKpiInput => ({
    technicianId: 't1',
    scheduledDate: utc(2025, 9, 10),
    completedDate: utc(2025, 9, 10),
    status: 'completed',
    durationMinutes: 90,
    ...over,
  });

  const opts = { availableMinutes: 2400, certificationWarningDays: 60 };

  it('reports every rate as null for a technician with no work', () => {
    const k = computeTechnicianKpis([], [], [], utc(2025, 9, 30), opts);
    expect(k.calloutsHandled).toBe(0);
    expect(k.slaResponseComplianceBps).toBeNull();
    expect(k.firstTimeFixBps).toBeNull();
    expect(k.repeatCalloutBps).toBeNull();
    expect(k.pmComplianceBps).toBeNull();
    expect(k.avgResponseMinutes).toBeNull();
  });

  it('computes SLA compliance over judged callouts only', () => {
    const k = computeTechnicianKpis(
      [
        callout({ id: 'a' }),
        callout({ id: 'b', arrivedAt: utc(2025, 9, 11, 9, 30) }),          // response breach
        callout({ id: 'c', slaResponseMinutes: null }),                     // no SLA, not judged
      ],
      [],
      [],
      utc(2025, 9, 30),
      opts,
    );
    expect(k.calloutsHandled).toBe(3);
    expect(k.slaResponseComplianceBps).toBe(5000); // 1 of the 2 judged
  });

  it('excludes cancelled callouts from the record', () => {
    const k = computeTechnicianKpis(
      [callout({ id: 'a' }), callout({ id: 'b', status: 'cancelled' })],
      [],
      [],
      utc(2025, 9, 30),
      opts,
    );
    expect(k.calloutsHandled).toBe(1);
  });

  it('reports mean and median response separately', () => {
    const k = computeTechnicianKpis(
      [
        callout({ id: 'a', arrivedAt: utc(2025, 9, 11, 8, 20) }),  // 20m
        callout({ id: 'b', arrivedAt: utc(2025, 9, 11, 8, 25) }),  // 25m
        callout({ id: 'c', arrivedAt: utc(2025, 9, 11, 11, 0) }),  // 180m — one bad night
      ],
      [],
      [],
      utc(2025, 9, 30),
      opts,
    );
    expect(k.avgResponseMinutes).toBe(75);
    expect(k.medianResponseMinutes).toBe(25); // the honest typical figure
  });

  it('scores first-time fix only over callouts where it was recorded', () => {
    const k = computeTechnicianKpis(
      [
        callout({ id: 'a', firstTimeFix: true }),
        callout({ id: 'b', firstTimeFix: false }),
        callout({ id: 'c', firstTimeFix: null }),
      ],
      [],
      [],
      utc(2025, 9, 30),
      opts,
    );
    expect(k.firstTimeFixBps).toBe(5000);
  });

  it('measures PM compliance and punctuality separately', () => {
    const k = computeTechnicianKpis(
      [],
      [
        visit(),                                                            // on time
        visit({ completedDate: utc(2025, 9, 14) }),                         // late but done
        visit({ status: 'missed', completedDate: null }),                   // not done
        visit({ status: 'cancelled', completedDate: null }),                // not counted
      ],
      [],
      utc(2025, 9, 30),
      opts,
    );
    expect(k.pmVisitsScheduled).toBe(3);
    expect(k.pmVisitsCompleted).toBe(2);
    expect(k.pmComplianceBps).toBe(6667);
    expect(k.pmOnTimeBps).toBe(5000); // 1 of the 2 completed was on time
  });

  it('counts expired and expiring certifications', () => {
    const k = computeTechnicianKpis([], [], [
      { expiryDate: utc(2025, 8, 1) },   // expired
      { expiryDate: utc(2025, 10, 15) }, // within 60 days
      { expiryDate: utc(2026, 6, 1) },   // fine
    ], utc(2025, 9, 30), opts);
    expect(k.certificationsExpired).toBe(1);
    expect(k.certificationsExpiringSoon).toBe(1);
  });

  it('computes utilisation from repair and visit time', () => {
    const k = computeTechnicianKpis([callout()], [visit()], [], utc(2025, 9, 30), opts);
    expect(k.loggedMinutes).toBe(150); // 60m repair + 90m visit
    expect(k.utilisationBps).toBe(625);
  });

  it('disables utilisation rather than dividing by zero available minutes', () => {
    const k = computeTechnicianKpis([callout()], [], [], utc(2025, 9, 30), {
      ...opts,
      availableMinutes: 0,
    });
    expect(k.utilisationBps).toBeNull();
  });
});

describe('formatting', () => {
  it('formats durations for reading at a glance', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(null)).toBe('—');
  });

  it('states schedule variance in plain words', () => {
    expect(formatVarianceDays(14)).toBe('14 days late');
    expect(formatVarianceDays(1)).toBe('1 day late');
    expect(formatVarianceDays(-3)).toBe('3 days early');
    expect(formatVarianceDays(0)).toBe('on time');
    expect(formatVarianceDays(null)).toBe('—');
  });

  it('counts whole days between instants', () => {
    expect(daysBetween(utc(2025, 1, 1), utc(2025, 1, 31))).toBe(30);
  });
});
