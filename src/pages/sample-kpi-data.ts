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

// ---------------------------------------------------------------------------
// Priority board scaffolding
// ---------------------------------------------------------------------------

import type { PriorityInput } from '../lib/priority.js';
import type { RiskInput } from '../lib/risk.js';

const invoice = (
  grossSantim: number,
  dueDate: Date,
  paidGrossSantim = 0,
): { grossSantim: number; paidGrossSantim: number; dueDate: Date; status: 'issued' | 'partially_paid' } => ({
  grossSantim,
  paidGrossSantim,
  dueDate,
  status: paidGrossSantim > 0 ? 'partially_paid' : 'issued',
});

export interface SampleProject {
  priority: Omit<PriorityInput, 'risk'>;
  risk: Omit<RiskInput, 'kpi'>;
  kpiOverrides: Partial<import('../lib/kpi.js').ProjectKpiResult>;
}

/** Four projects with deliberately different pressures, to show the ranking working. */
export const SAMPLE_PORTFOLIO: SampleProject[] = [
  {
    priority: {
      projectId: 'p-bole',
      title: 'Bole Tower — 3 units',
      clientName: 'Bole Development PLC',
      contractNetSantim: ETB(4_200_000),
      contractGrossSantim: ETB(4_830_000),
      invoicedGrossSantim: ETB(2_415_000),
      invoices: [invoice(ETB(1_035_000), utc(2025, 6, 30)), invoice(ETB(1_380_000), utc(2025, 10, 15))],
      milestones: [
        { name: 'Cab assembly complete', grossSantim: ETB(1_207_500), status: 'pending', dueDate: utc(2025, 10, 20), gatingPhaseProgressBps: 7500 },
        { name: 'Handover', grossSantim: ETB(1_207_500), status: 'pending', dueDate: utc(2026, 1, 30), gatingPhaseProgressBps: 0 },
      ],
    },
    risk: {
      status: 'in_progress',
      overdueReceivableSantim: ETB(1_035_000),
      oldestOverdueDays: 73,
      assignedTechnicians: 3,
      expiredCertifications: 0,
      teamRepeatCalloutBps: 1600,
      daysSinceProgressChange: 5,
    },
    kpiOverrides: {},
  },
  {
    priority: {
      projectId: 'p-kazanchis',
      title: 'Kazanchis Retail — 1 unit',
      clientName: 'Habesha Retail',
      contractNetSantim: ETB(1_800_000),
      contractGrossSantim: ETB(2_070_000),
      invoicedGrossSantim: ETB(2_070_000),
      invoices: [invoice(ETB(1_500_000), utc(2025, 4, 10)), invoice(ETB(570_000), utc(2025, 7, 1))],
      milestones: [],
    },
    risk: {
      status: 'in_progress',
      overdueReceivableSantim: ETB(2_070_000),
      oldestOverdueDays: 154,
      assignedTechnicians: 0,
      expiredCertifications: 0,
      teamRepeatCalloutBps: null,
      daysSinceProgressChange: 38,
    },
    kpiOverrides: {
      progressBps: 9200,
      expectedProgressBps: 10_000,
      scheduleVarianceBps: -800,
      overdue: true,
      daysToPlannedEnd: -52,
      grossMarginBps: 900,
      underBillingBps: -800,
      collectionRateBps: 0,
      invoicedBps: 10_000,
    },
  },
  {
    priority: {
      projectId: 'p-cmc',
      title: 'CMC Residences — 2 units',
      clientName: 'CMC Housing',
      contractNetSantim: ETB(3_100_000),
      contractGrossSantim: ETB(3_565_000),
      invoicedGrossSantim: ETB(890_000),
      invoices: [invoice(ETB(890_000), utc(2025, 9, 30))],
      milestones: [
        { name: 'Rail installation complete', grossSantim: ETB(1_070_000), status: 'ready_to_invoice', dueDate: utc(2025, 9, 15), gatingPhaseProgressBps: 10_000 },
      ],
    },
    risk: {
      status: 'in_progress',
      overdueReceivableSantim: 0,
      oldestOverdueDays: null,
      assignedTechnicians: 2,
      expiredCertifications: 1,
      teamRepeatCalloutBps: 900,
      daysSinceProgressChange: 2,
    },
    kpiOverrides: { progressBps: 4800, expectedProgressBps: 4500, scheduleVarianceBps: 300, underBillingBps: 2300 },
  },
  {
    priority: {
      projectId: 'p-megenagna',
      title: 'Megenagna Office — 4 units',
      clientName: 'Zenith Properties',
      contractNetSantim: ETB(6_400_000),
      contractGrossSantim: ETB(7_360_000),
      invoicedGrossSantim: ETB(1_472_000),
      invoices: [invoice(ETB(1_472_000), utc(2025, 11, 1))],
      milestones: [
        { name: 'Shaft prep complete', grossSantim: ETB(1_472_000), status: 'pending', dueDate: utc(2026, 3, 1), gatingPhaseProgressBps: 3000 },
      ],
    },
    risk: {
      status: 'in_progress',
      overdueReceivableSantim: 0,
      oldestOverdueDays: null,
      assignedTechnicians: 4,
      expiredCertifications: 0,
      teamRepeatCalloutBps: 600,
      daysSinceProgressChange: 1,
    },
    kpiOverrides: { progressBps: 2200, expectedProgressBps: 2000, scheduleVarianceBps: 200, underBillingBps: 200, grossMarginBps: 3100 },
  },
];
