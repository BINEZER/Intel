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
  REPORT_FOCUSES,
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
    type: 'elevator',
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
  tasks: [],
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

  it('counts the projects past their planned end without listing them again', () => {
    // The names were a comma-separated copy of the Live projects table
    // directly below, which carries the planned end date for every row. Two
    // lists of the same projects means checking one against the other.
    const report = buildCeoReport(
      inputs({ projects: [project({ plannedEnd: utc(2026, 6, 30) })], asOf: utc(2026, 10, 1) }),
    );
    const delivery = report.sections.find((s) => s.id === 'delivery');
    const narrative = delivery?.narrative.join(' ') ?? '';
    expect(narrative).toContain('1 live project is past the planned completion date');
    expect(narrative).not.toContain('PRJ-001');
    // The table still names it, once.
    expect(delivery?.table?.rows.map((r) => r.projectNo)).toContain('PRJ-001');
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
            endDate: utc(2026, 10, 20), title: 'A contract', signedDate: utc(2026, 1, 15), renewalAlertAt: utc(2026, 8, 20), status: 'active',
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

describe('what the work is', () => {
  const lift = (over = {}) => project({ type: 'elevator', ...over });
  const other = (over = {}) =>
    project({ type: 'renovation', status: 'in_progress', ...over });

  const mixOf = (projects: ReportProject[]) => {
    const report = buildCeoReport({ ...inputs(), projects }, 'projects');
    return report.sections.find((s) => s.id === 'mix');
  };

  it('breaks the portfolio down by kind of work', () => {
    const mix = mixOf([
      lift({ id: 'a', projectNo: 'P-1', contractNetSantim: 8_000_000_00 }),
      other({ id: 'b', projectNo: 'P-2', contractNetSantim: 2_000_000_00 }),
    ]);
    expect(mix?.heading).toBe('What the work is');
    expect(mix?.table?.rows.map((r) => r['kind'])).toEqual([
      'Lift supply & installation',
      'Building renovation',
    ]);
  });

  it('says so plainly when every job is lift work', () => {
    // Rather than an empty "other" row, which reads as a business that has
    // tried something and failed at it.
    const mix = mixOf([lift({ id: 'a' }), lift({ id: 'b', projectNo: 'P-2' })]);
    expect(mix?.narrative.join(' ')).toContain('is lift work');
    expect(mix?.table?.rows).toHaveLength(1);
  });

  it('names the non-lift share in the delivery narrative too', () => {
    const report = buildCeoReport(
      {
        ...inputs(),
        projects: [
          lift({ id: 'a', contractNetSantim: 8_000_000_00 }),
          other({ id: 'b', projectNo: 'P-2', contractNetSantim: 2_000_000_00 }),
        ],
      },
      'projects',
    );
    const delivery = report.sections.find((s) => s.id === 'delivery');
    expect(delivery?.narrative.join(' ')).toContain('not lift work');
  });

  it('keeps the delivery narrative silent when there is no other work', () => {
    const report = buildCeoReport({ ...inputs(), projects: [lift({ id: 'a' })] }, 'projects');
    const delivery = report.sections.find((s) => s.id === 'delivery');
    expect(delivery?.narrative.join(' ')).not.toContain('not lift work');
  });

  it('names the kind of every live project in the delivery table', () => {
    const report = buildCeoReport(
      { ...inputs(), projects: [other({ id: 'b', projectNo: 'P-2' })] },
      'projects',
    );
    const delivery = report.sections.find((s) => s.id === 'delivery');
    expect(delivery?.table?.columns.map((c) => c.key)).toContain('kind');
    expect(delivery?.table?.rows[0]?.['kind']).toBe('Renovation');
  });

  it('draws a chart only when there is more than one kind to compare', () => {
    expect(mixOf([lift({ id: 'a' })])?.chart).toBeUndefined();
    expect(mixOf([lift({ id: 'a' }), other({ id: 'b', projectNo: 'P-2' })])?.chart).toBeDefined();
  });

  it('says there is nothing to break down rather than showing an empty table', () => {
    const mix = mixOf([]);
    expect(mix?.narrative.join(' ')).toContain('no project in hand');
  });
});

describe('the record of what got done', () => {
  const on = (y: number, m: number, d: number) => utc(y, m, d);

  it('lists only things that finished, with the date that makes each a fact', () => {
    const report = buildCeoReport(
      {
        ...inputs(),
        contracts: [
          {
            id: 'k1', contractNo: 'AGR-2026-009', clientName: 'Addis Towers PLC',
            title: 'Bole Tower — four lifts', type: 'supply_install',
            signedDate: on(2026, 9, 12), endDate: on(2027, 3, 12),
            renewalAlertAt: null, status: 'active', valueGrossSantim: 11_500_000_00,
          },
        ],
      },
      'achievements',
    );
    const section = report.sections.find((s) => s.id === 'achievements');
    expect(section?.heading).toBe('What got done');
    expect(section?.table?.rows[0]?.['what']).toContain('AGR-2026-009');
    expect(section?.table?.rows[0]?.['group']).toBe('Work won');
  });

  it('is titled as a record handed up, not as a report to the chief executive', () => {
    // It is written BY the person who did the work. A title addressed to its
    // own author reads as a form rather than as a record.
    const report = buildCeoReport(inputs(), 'achievements');
    expect(report.title).toContain('got done');
    expect(report.title).not.toContain('Chief Executive');
  });

  it('carries no plan: nothing in it is forward-looking', () => {
    expect(buildCeoReport(inputs(), 'achievements').plan).toEqual([]);
  });

  it('keeps the record out of every other focus', () => {
    for (const focus of ['overall', 'finance', 'projects', 'contracts', 'clients'] as const) {
      expect(buildCeoReport(inputs(), focus).sections.map((s) => s.id)).not.toContain('achievements');
    }
  });

  it('says what to do about an empty period rather than showing a bare blank', () => {
    const bare = { ...inputs(), invoices: [], contracts: [], projects: [], stages: [], tasks: [] };
    const section = buildCeoReport(bare, 'achievements').sections.find((s) => s.id === 'achievements');
    expect(section?.table?.rows).toEqual([]);
    expect(section?.table?.emptyMessage).toContain('record the finish dates');
  });
});

describe('focusing the report', () => {
  const contract = (over = {}) => ({
    id: 'k1',
    contractNo: 'AGR-2021-001',
    clientName: 'Addis Towers',
    type: 'installation',
    endDate: utc(2027, 3, 31),
    title: 'A contract', signedDate: utc(2026, 1, 15), renewalAlertAt: null,
    status: 'active',
    valueGrossSantim: 10_000_000,
    ...over,
  });

  it('leaves the overall report exactly as it was', () => {
    // Clients and Contracts are new sections. Quietly adding them to the
    // overall report would change a document somebody already prints every
    // month — they are reached by asking for them.
    const report = buildCeoReport(inputs());
    expect(report.focus).toBe('overall');
    expect(report.sections.map((s) => s.id)).toEqual([
      'money-in', 'money-out', 'delivery', 'trend', 'risk',
    ]);
    expect(report.title).toBe('Monthly report to the Chief Executive');
  });

  it('keeps only the money sections when focused on finance', () => {
    const report = buildCeoReport(inputs(), 'finance');
    expect(report.sections.map((s) => s.id)).toEqual(['money-in', 'money-out', 'trend']);
    expect(report.title).toBe('Monthly finance report to the Chief Executive');
  });

  it('keeps delivery and the breakdown of the work when focused on projects', () => {
    const report = buildCeoReport(inputs(), 'projects');
    expect(report.sections.map((s) => s.id)).toEqual(['delivery', 'mix']);
    expect(report.title).toContain('delivery report');
  });

  it('leaves the breakdown out of the overall report', () => {
    // The overall report is a document somebody prints every month and reads
    // the same way each time. Quietly adding a section changes that document.
    const report = buildCeoReport(inputs(), 'overall');
    expect(report.sections.map((s) => s.id)).not.toContain('mix');
  });

  it('narrows the plan ahead to match the focus', () => {
    // A finance report that ended with next month's site work would read as a
    // different document stapled to the back.
    const finance = buildCeoReport(inputs(), 'finance');
    expect(finance.plan.every((s) => s.id === 'plan-cash')).toBe(true);

    const projects = buildCeoReport(inputs(), 'projects');
    expect(projects.plan.every((s) => s.id.startsWith('plan-work') || s.id === 'plan-priorities')).toBe(true);
  });

  it('keeps the headline figures whatever the focus is', () => {
    // The summary at the top is the reason somebody opened it at all.
    for (const { value } of REPORT_FOCUSES) {
      const report = buildCeoReport(inputs(), value);
      expect(report.headline.length).toBeGreaterThan(0);
      expect(report.executiveSummary.length).toBeGreaterThan(0);
    }
  });

  it('offers every focus the report can actually build', () => {
    for (const { value } of REPORT_FOCUSES) {
      const report = buildCeoReport(inputs({ contracts: [contract()] }), value);
      // An empty section list would be a focus that shows nothing.
      expect(report.sections.length).toBeGreaterThan(0);
    }
  });
});

describe('the clients section', () => {
  const contract = (over = {}) => ({
    id: 'k1', contractNo: 'AGR-1', clientName: 'Addis Towers', type: 'installation',
    endDate: utc(2027, 3, 31), title: 'A contract', signedDate: utc(2026, 1, 15), renewalAlertAt: null, status: 'active',
    valueGrossSantim: 10_000_000, ...over,
  });

  it('names concentration when one client dominates the book', () => {
    // The number worth an executive's attention is the SHARE, not the size:
    // one client at 60% is a different company from twelve at 8% each.
    const report = buildCeoReport(
      inputs({ contracts: [contract(), contract({ id: 'k2', clientName: 'Small Co', valueGrossSantim: 1_000_000 })] }),
      'clients',
    );
    const narrative = report.sections.find((s) => s.id === 'clients')?.narrative.join(' ') ?? '';
    expect(narrative).toContain('Addis Towers is 91% of the signed book');
    expect(narrative).toContain('concentration');
  });

  it('says so when no client dominates', () => {
    const even = [
      contract({ id: 'a', clientName: 'A', valueGrossSantim: 1_000_000 }),
      contract({ id: 'b', clientName: 'B', valueGrossSantim: 1_000_000 }),
      contract({ id: 'c', clientName: 'C', valueGrossSantim: 1_000_000 }),
    ];
    const narrative = buildCeoReport(inputs({ contracts: even }), 'clients')
      .sections.find((s) => s.id === 'clients')?.narrative.join(' ') ?? '';
    expect(narrative).toContain('no single client dominates');
  });

  it('sorts the biggest client first', () => {
    const report = buildCeoReport(
      inputs({ contracts: [contract({ id: 'k2', clientName: 'Small Co', valueGrossSantim: 1_000_000 }), contract()] }),
      'clients',
    );
    const rows = report.sections.find((s) => s.id === 'clients')?.table?.rows ?? [];
    expect(rows[0]?.name).toBe('Addis Towers');
  });

  it('says plainly when there is no client to report on', () => {
    const narrative = buildCeoReport(inputs({ contracts: [], invoices: [], projects: [] }), 'clients')
      .sections.find((s) => s.id === 'clients')?.narrative.join(' ') ?? '';
    expect(narrative).toContain('No client has a contract');
  });
});

describe('the contracts section', () => {
  const contract = (over = {}) => ({
    id: 'k1', contractNo: 'AGR-1', clientName: 'Addis Towers', type: 'installation',
    endDate: utc(2027, 3, 31), title: 'A contract', signedDate: utc(2026, 1, 15), renewalAlertAt: null, status: 'active',
    valueGrossSantim: 10_000_000, ...over,
  });

  it('flags a contract still active with an end date in the past', () => {
    // Either the term was extended and nobody recorded it, or it lapsed and
    // the work is running uncovered. Both are worth a sentence.
    const report = buildCeoReport(
      inputs({ contracts: [contract({ endDate: utc(2026, 1, 31) })], asOf: utc(2026, 10, 1) }),
      'contracts',
    );
    const narrative = report.sections.find((s) => s.id === 'contracts')?.narrative.join(' ') ?? '';
    expect(narrative).toContain('end date already in the past');
  });

  it('lists active contracts soonest to end first', () => {
    const report = buildCeoReport(
      inputs({
        contracts: [
          contract({ id: 'late', contractNo: 'AGR-LATE', endDate: utc(2028, 1, 1) }),
          contract({ id: 'soon', contractNo: 'AGR-SOON', endDate: utc(2026, 11, 1) }),
        ],
      }),
      'contracts',
    );
    const rows = report.sections.find((s) => s.id === 'contracts')?.table?.rows ?? [];
    expect(rows.map((r) => r.contractNo)).toEqual(['AGR-SOON', 'AGR-LATE']);
  });

  it('breaks the book down by type when there is more than one', () => {
    const report = buildCeoReport(
      inputs({ contracts: [contract(), contract({ id: 'm', type: 'maintenance', valueGrossSantim: 500_000 })] }),
      'contracts',
    );
    const narrative = report.sections.find((s) => s.id === 'contracts')?.narrative.join(' ') ?? '';
    expect(narrative).toContain('By type:');
    expect(narrative).toContain('maintenance');
  });
});

describe('client concentration in the headline', () => {
  const contract = (over = {}) => ({
    id: 'k1', contractNo: 'AGR-1', clientName: 'Addis Towers', type: 'installation',
    endDate: utc(2027, 3, 31), title: 'A contract', signedDate: utc(2026, 1, 15), renewalAlertAt: null, status: 'active',
    valueGrossSantim: 10_000_000, ...over,
  });

  const concentration = (over: Partial<ReportInputs> = {}, focus?: 'overall' | 'finance') =>
    buildCeoReport(inputs(over), focus).headline.find((m) => m.key === 'concentration');

  it('rides in the headline of every report, not only the clients one', () => {
    // How much of the book sits with one client changes what a month means,
    // and it is invisible in any of the other totals.
    for (const { value } of REPORT_FOCUSES) {
      const report = buildCeoReport(inputs({ contracts: [contract()] }), value);
      expect(report.headline.find((m) => m.key === 'concentration')).toBeDefined();
    }
  });

  it('reports the SHARE, and names who it is', () => {
    const metric = concentration({
      contracts: [contract(), contract({ id: 'k2', clientName: 'Small Co', valueGrossSantim: 10_000_000 })],
    });
    expect(metric?.value).toBe('50%');
    expect(metric?.note).toContain('Addis Towers');
  });

  it('says what losing them would cost once one client dominates', () => {
    const metric = concentration({
      contracts: [contract(), contract({ id: 'k2', clientName: 'Small Co', valueGrossSantim: 1_000_000 })],
    });
    expect(metric?.note).toContain('Losing them would take 91%');
  });

  it('says plainly that nobody dominates when nobody does', () => {
    const even = ['A', 'B', 'C'].map((name, i) =>
      contract({ id: `k${i}`, clientName: name, valueGrossSantim: 1_000_000 }));
    expect(concentration({ contracts: even })?.note).toContain('No single client dominates');
  });

  it('carries no arrow, because a share is a position and not a flow', () => {
    // There is no stored "last month's concentration"; re-deriving one would
    // be a different calculation wearing the same label.
    const metric = concentration({ contracts: [contract()] });
    expect(metric?.direction).toBeNull();
    expect(metric?.changeBps).toBeNull();
    expect(metric?.previousValue).toBeNull();
  });

  it('shows a dash rather than 0% when there is no signed value at all', () => {
    const metric = concentration({ contracts: [] });
    expect(metric?.value).toBe('—');
    expect(metric?.note).toContain('No signed contract value');
  });

  it('agrees with the clients section about who is biggest', () => {
    // One grouping feeds both; they cannot drift apart.
    const over = {
      contracts: [contract(), contract({ id: 'k2', clientName: 'Small Co', valueGrossSantim: 1_000_000 })],
    };
    const metric = concentration(over);
    const rows = buildCeoReport(inputs(over), 'clients')
      .sections.find((s) => s.id === 'clients')?.table?.rows ?? [];
    expect(metric?.note).toContain(rows[0]?.name ?? '');
  });
});
