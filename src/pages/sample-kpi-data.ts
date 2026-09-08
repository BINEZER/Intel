/**
 * Illustrative KPI inputs for the module-1 dashboard.
 *
 * These exist so the KPI engine can be seen working before the callout and
 * visit collections are populated in later modules. DELETE THIS FILE once the
 * dashboard reads live data — it is scaffolding, not a fixture.
 */

import { birrToSantim } from '../lib/money.js';
import type { CalloutKpiInput, ProjectKpiInput, VisitKpiInput } from '../lib/kpi.js';

const utc = (y: number, m: number, d: number, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min));
const ETB = birrToSantim;

export const SAMPLE_PROJECT: ProjectKpiInput = {
  plannedStart: utc(2025, 1, 15),
  plannedEnd: utc(2025, 11, 30),
  actualStart: utc(2025, 1, 22),
  actualEnd: null,
  progressBps: 6200,
  status: 'in_progress',
  contractNetSantim: ETB(4_200_000),
  subcontractCostNetSantim: ETB(2_900_000),
  invoicedNetSantim: ETB(2_100_000),
  invoicedGrossSantim: ETB(2_415_000),
  collectedGrossSantim: ETB(1_800_000),
  phases: [
    { key: 'shaft_prep', status: 'completed', actualStart: utc(2025, 1, 22), actualEnd: utc(2025, 3, 14) },
    { key: 'rail_installation', status: 'completed', actualStart: utc(2025, 3, 17), actualEnd: utc(2025, 5, 30) },
    { key: 'cab_assembly', status: 'in_progress', actualStart: utc(2025, 6, 2), actualEnd: null },
    { key: 'testing', status: 'not_started', actualStart: null, actualEnd: null },
    {
      key: 'authority_inspection',
      status: 'not_started',
      actualStart: null,
      actualEnd: null,
      certification: { result: 'pending', attempts: 0 },
    },
  ],
  settledInvoices: [
    { issuedAt: utc(2025, 3, 20), settledAt: utc(2025, 5, 2), grossSantim: ETB(900_000) },
    { issuedAt: utc(2025, 6, 5), settledAt: utc(2025, 7, 1), grossSantim: ETB(900_000) },
  ],
};

const callout = (
  id: string,
  unitTag: string,
  day: number,
  responseMin: number,
  repairMin: number,
  over: Partial<CalloutKpiInput> = {},
): CalloutKpiInput => {
  const reportedAt = utc(2025, 8, day, 9, 0);
  const arrivedAt = new Date(reportedAt.getTime() + responseMin * 60_000);
  return {
    id,
    technicianId: 't1',
    unitTag,
    entrapment: false,
    reportedAt,
    arrivedAt,
    resolvedAt: new Date(arrivedAt.getTime() + repairMin * 60_000),
    slaResponseMinutes: 60,
    slaResolutionMinutes: 240,
    firstTimeFix: true,
    status: 'resolved',
    repeatOfCalloutId: null,
    ...over,
  };
};

export const SAMPLE_CALLOUTS: CalloutKpiInput[] = [
  callout('c1', 'LIFT-01', 3, 35, 55),
  callout('c2', 'LIFT-04', 7, 48, 120, { entrapment: true }),
  callout('c3', 'LIFT-01', 12, 41, 95, { firstTimeFix: false }),   // repeat on LIFT-01
  callout('c4', 'LIFT-09', 15, 95, 60),                            // response breach
  callout('c5', 'LIFT-04', 21, 30, 45),
  callout('c6', 'LIFT-12', 26, 52, 210),
];

export const SAMPLE_VISITS: VisitKpiInput[] = [
  { technicianId: 't1', scheduledDate: utc(2025, 8, 5), completedDate: utc(2025, 8, 5), status: 'completed', durationMinutes: 95 },
  { technicianId: 't1', scheduledDate: utc(2025, 8, 12), completedDate: utc(2025, 8, 14), status: 'completed', durationMinutes: 80 },
  { technicianId: 't1', scheduledDate: utc(2025, 8, 19), completedDate: utc(2025, 8, 19), status: 'completed', durationMinutes: 110 },
  { technicianId: 't1', scheduledDate: utc(2025, 8, 26), completedDate: null, status: 'missed', durationMinutes: null },
];

export const SAMPLE_CERTS = [{ expiryDate: utc(2026, 7, 1) }, { expiryDate: utc(2025, 10, 20) }];
