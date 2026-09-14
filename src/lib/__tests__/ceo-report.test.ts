/**
 * The CEO report.
 *
 * What is tested here is mostly HONESTY, not arithmetic: that a period with no
 * data says so rather than printing zeros with green arrows, that a rise from
 * nothing is not expressed as a percentage, and that cash received is counted in
 * the period it arrived rather than the period it was invoiced.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCeoReport,
  describeChange,
  periodProgressNote,
  type ReportDisbursement,
  type ReportInputs,
  type ReportInvoice,
  type ReportProject,
  type ReportStage,
} from '../ceo-report.js';
import { periodContaining } from '../period.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const SEPTEMBER = periodContaining('month', 'gregorian', utc(2026, 9, 15));

function invoice(over: Partial<ReportInvoice> = {}): ReportInvoice {
  return {
    id: 'inv-1',
    invoiceNo: 'INV-00001',
    clientName: 'Addis Towers',
    projectId: 'p1',
    issuedAt: utc(2026, 9, 10),
    dueDate: utc(2026, 10, 10),
    netSantim: 1_000_000,
    vatSantim: 150_000,
    grossSantim: 1_150_000,
    status: 'issued',
    receipts: [],
    ...over,
  };
}

function disbursement(over: Partial<ReportDisbursement> = {}): ReportDisbursement {
  return {
    voucherNo: 'PV-001',
    projectId: 'p1',
    subcontractorName: 'Selam Civil',
    requestedAt: utc(2026, 9, 5),
    paidAt: utc(2026, 9, 12),
    netSantim: 400_000,
    supplierVatSantim: 60_000,
    whtSantim: 8_000,
    netPayableSantim: 452_000,
    status: 'paid',
    ...over,
  };
}

function project(over: Partial<ReportProject> = {}): ReportProject {
  return {
    id: 'p1',
    projectNo: 'PRJ-001',
    title: 'Bole Tower lifts',
    clientName: 'Addis Towers',
    status: 'in_progress',
    progressBps: 4000,
    contractNetSantim: 10_000_000,
    plannedEnd: utc(2026, 12, 31),
    actualStart: utc(2026, 3, 1),
    actualEnd: null,
    ...over,
  };
}

function stage(over: Partial<ReportStage> = {}): ReportStage {
  return {
    projectId: 'p1',
    projectTitle: 'Bole Tower lifts',
    clientName: 'Addis Towers',
    phaseId: 'ph-1',
    stageKey: 'rail_installation',
    stageName: 'Guide rails & brackets',
    weightBps: 1400,
    progressBps: 5000,
    status: 'in_progress',
    plannedEnd: utc(2026, 10, 15),
    actualStart: utc(2026, 9, 1),
    actualEnd: null,
    dependsOnPhaseIds: [],
    ...over,
  };
}

function inputs(over: Partial<ReportInputs> = {}): ReportInputs {
  return {
    companyName: 'IntelMotion',
    period: SEPTEMBER,
    asOf: utc(2026, 10, 1),
    projects: [project()],
    stages: [stage()],
    invoices: [invoice()],
    disbursements: [disbursement()],
    milestones: [],
    contracts: [],
    ...over,
  };
}

describe('describeChange', () => {
  it('refuses to express a rise from nothing as a percentage', () => {
    const change = describeChange(5_000_000, 0, 'month', 'higher_is_better');
    expect(change.changeBps).toBeNull();
    expect(change.note).toBe('Up from nothing in the previous month.');
    expect(change.note).not.toMatch(/%/);
  });

  it('calls a fall to nothing what it is', () => {
    const change = describeChange(0, 4_000_000, 'week', 'higher_is_better');
    expect(change.direction).toBe('down');
    expect(change.note).toContain('Nothing this week');
  });

  it('does not dress a rounding wobble up as a trend', () => {
    // 0.3% is noise, not movement.
    const change = describeChange(1_003_000, 1_000_000, 'month', 'higher_is_better');
    expect(change.direction).toBe('flat');
    expect(change.note).toBe('Level with the previous month.');
  });

  it('flags a move in the wrong direction for the metric', () => {
    const worse = describeChange(2_000_000, 1_000_000, 'month', 'lower_is_better');
    expect(worse.note).toContain('worth a look');

    const better = describeChange(2_000_000, 1_000_000, 'month', 'higher_is_better');
    expect(better.note).not.toContain('worth a look');
  });

  it('is symmetric about the base, not the larger number', () => {
    expect(describeChange(150, 100, 'month', 'neutral').changeBps).toBe(5000);
    expect(describeChange(100, 150, 'month', 'neutral').changeBps).toBe(-3333);
  });
});

describe('buildCeoReport', () => {
  it('names the period in both calendars and titles itself by period kind', () => {
    const report = buildCeoReport(inputs());
    expect(report.title).toBe('Monthly report to the Chief Executive');
    expect(report.period.label).toBe('September 2026');
    expect(report.period.altLabel).toMatch(/EC$/);
    expect(report.periodRange).toBe('1 Sep 2026 – 30 Sep 2026');
  });

  it('says plainly when a period has no activity at all, instead of printing zeros', () => {
    const report = buildCeoReport(inputs({ invoices: [], disbursements: [] }));
    const summary = report.executiveSummary.join(' ');

    expect(summary).toContain('No invoices were issued');
    expect(summary).toContain('worth confirming');
  });

  it('counts cash in the period it arrived, not the period it was invoiced', () => {
    // Invoiced in July, paid in September.
    const july = invoice({
      issuedAt: utc(2026, 7, 3),
      dueDate: utc(2026, 8, 3),
      receipts: [{ receivedAt: utc(2026, 9, 20), amountGrossSantim: 1_150_000, clientWhtSantim: 0 }],
    });
    const report = buildCeoReport(inputs({ invoices: [july] }));

    const invoiced = report.headline.find((m) => m.key === 'invoiced');
    const collected = report.headline.find((m) => m.key === 'collected');

    expect(invoiced?.santim).toBe(0);
    expect(collected?.santim).toBe(1_150_000);
  });

  it('excludes drafts and voids from revenue', () => {
    const report = buildCeoReport(
      inputs({ invoices: [invoice({ status: 'draft' }), invoice({ id: 'i2', status: 'void' })] }),
    );
    expect(report.headline.find((m) => m.key === 'invoiced')?.santim).toBe(0);
  });

  it('gives receivables no arrow, because a balance has no previous period', () => {
    const report = buildCeoReport(inputs());
    const receivables = report.headline.find((m) => m.key === 'receivables');

    expect(receivables?.direction).toBeNull();
    expect(receivables?.changeBps).toBeNull();
    expect(receivables?.previousValue).toBeNull();
  });

  it('reports margin as billed less subcontractor cost', () => {
    const report = buildCeoReport(inputs());
    expect(report.headline.find((m) => m.key === 'margin')?.santim).toBe(1_000_000 - 400_000);
  });

  it('counts only subcontractor payments actually settled in the window', () => {
    const report = buildCeoReport(
      inputs({
        disbursements: [
          disbursement({ status: 'approved', paidAt: null }),
          disbursement({ voucherNo: 'PV-002', status: 'paid', paidAt: utc(2026, 8, 20) }),
        ],
      }),
    );
    expect(report.headline.find((m) => m.key === 'cost')?.santim).toBe(0);

    // But the approved-and-unpaid one is named as a commitment.
    const moneyOut = report.sections.find((s) => s.id === 'money-out');
    expect(moneyOut?.narrative.join(' ')).toContain('committed cash');
  });

  it('counts a stage as delivered in the period it was recorded finished', () => {
    const report = buildCeoReport(
      inputs({
        stages: [
          stage({ phaseId: 'a', status: 'completed', progressBps: 10_000, actualEnd: utc(2026, 9, 18) }),
          stage({ phaseId: 'b', status: 'completed', progressBps: 10_000, actualEnd: utc(2026, 8, 18) }),
          stage({ phaseId: 'c' }),
        ],
      }),
    );
    expect(report.headline.find((m) => m.key === 'delivery')?.value).toBe('1');
  });

  it('does not claim projects are on schedule when the tracker simply has not moved', () => {
    const report = buildCeoReport(inputs({ stages: [stage()] }));
    const delivery = report.sections.find((s) => s.id === 'delivery');
    expect(delivery?.narrative.join(' ')).toContain('an unmoved tracker and an unmoved site look identical');
  });

  it('names the project that is past its planned end date', () => {
    const report = buildCeoReport(
      inputs({ projects: [project({ plannedEnd: utc(2026, 6, 30) })], asOf: utc(2026, 10, 1) }),
    );
    expect(report.sections.find((s) => s.id === 'delivery')?.narrative.join(' ')).toContain('PRJ-001 Bole Tower lifts');
  });

  it('draws six trailing periods including the empty ones', () => {
    const chart = buildCeoReport(inputs()).sections.find((s) => s.id === 'trend')?.chart;
    expect(chart?.points).toHaveLength(6);
    expect(chart?.points[5]?.label).toBe('September 2026');
    expect(chart?.points[0]?.label).toBe('April 2026');
    // Five of the six had nothing in them; they are still drawn.
    expect(chart?.points.filter((p) => p.values.revenue === 0)).toHaveLength(5);
  });

  it('splits the VAT position into payable and reclaimable correctly', () => {
    const reclaimable = buildCeoReport(
      inputs({ invoices: [], disbursements: [disbursement({ supplierVatSantim: 90_000 })] }),
    );
    expect(reclaimable.sections.find((s) => s.id === 'money-out')?.narrative.join(' ')).toContain('reclaimable');

    const payable = buildCeoReport(inputs());
    expect(payable.sections.find((s) => s.id === 'money-out')?.narrative.join(' ')).toContain('payable to ERCA');
  });
});

describe('the plan for the period ahead', () => {
  it('looks at the next period, not this one', () => {
    const report = buildCeoReport(inputs());
    expect(report.ahead.label).toBe('October 2026');
    expect(report.plan[0]?.heading).toBe('Cash plan for October 2026');
  });

  it('counts overdue debt as collectable next period — waiting does not retire it', () => {
    const overdue = invoice({
      issuedAt: utc(2026, 5, 1),
      dueDate: utc(2026, 6, 1),
      status: 'overdue',
    });
    const report = buildCeoReport(inputs({ invoices: [overdue], asOf: utc(2026, 10, 1) }));
    const collectable = report.plan[0]?.metrics?.find((m) => m.key === 'collectable');

    expect(collectable?.santim).toBe(1_150_000);
    expect(report.plan[0]?.narrative.join(' ')).toContain('already past due');
  });

  it('lists stages due in the window ahead and says who is holding them up', () => {
    const report = buildCeoReport(
      inputs({
        stages: [
          stage({ phaseId: 'a', stageKey: 'shipping_customs', stageName: 'Shipping & customs', plannedEnd: utc(2026, 10, 9) }),
          stage({ phaseId: 'b', plannedEnd: utc(2026, 12, 1) }),
        ],
      }),
    );
    const work = report.plan.find((s) => s.id === 'plan-work');

    expect(work?.table?.rows).toHaveLength(1);
    expect(work?.table?.rows[0]?.stage).toBe('Shipping & customs');
    expect(work?.table?.rows[0]?.owner).toBe('supplier');
    expect(work?.narrative.join(' ')).toContain('rather than on us');
  });

  it('does not invent work when the plan dates are simply missing', () => {
    const report = buildCeoReport(inputs({ stages: [stage({ plannedEnd: null })] }));
    expect(report.plan.find((s) => s.id === 'plan-work')?.narrative.join(' ')).toContain('plan dates have not been maintained');
  });

  it('names expiring contracts only when there are some', () => {
    const withNone = buildCeoReport(inputs());
    expect(withNone.plan.some((s) => s.id === 'plan-renewals')).toBe(false);

    const withOne = buildCeoReport(
      inputs({
        contracts: [
          {
            id: 'c1', contractNo: 'MC-2026-04', clientName: 'Addis Towers', type: 'maintenance',
            endDate: utc(2026, 10, 20), renewalAlertAt: utc(2026, 8, 20), status: 'active',
            valueGrossSantim: 2_400_000,
          },
        ],
      }),
    );
    const renewals = withOne.plan.find((s) => s.id === 'plan-renewals');
    expect(renewals?.table?.rows[0]?.contractNo).toBe('MC-2026-04');
  });
});

describe('periodProgressNote', () => {
  it('warns that a mid-period report is partial', () => {
    const note = periodProgressNote(SEPTEMBER, utc(2026, 9, 16));
    expect(note).toContain('to date');
    expect(note).toContain('50');
  });

  it('says nothing once the period is over', () => {
    expect(periodProgressNote(SEPTEMBER, utc(2026, 10, 5))).toBeNull();
  });
});
