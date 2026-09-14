import { describe, expect, it } from 'vitest';
import {
  buildCashflowForecast,
  buildPeriodSeries,
  buildProjectStatement,
  currentFiscalYear,
  fiscalYearRange,
  isInFiscalYear,
  summarisePortfolio,
  type StatementDisbursement,
  type StatementInvoice,
} from '../reporting.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('Ethiopian fiscal year', () => {
  it('runs 1 Hamle to 30 Sene and is named for the year it ends', () => {
    const fy = fiscalYearRange(2018);
    // 1 Hamle 2017 EC == 8 July 2025 GC
    expect(fy.start.toISOString().slice(0, 10)).toBe('2025-07-08');
    // 30 Sene 2018 EC == 7 July 2026 GC
    expect(fy.end.toISOString().slice(0, 10)).toBe('2026-07-07');
    expect(fy.label).toContain('FY 2018');
  });

  it('covers a full year with no gap to the next', () => {
    const a = fiscalYearRange(2018);
    const b = fiscalYearRange(2019);
    expect(b.start.getTime() - a.end.getTime()).toBe(86_400_000);
  });

  it('places a date on the correct side of the boundary', () => {
    expect(isInFiscalYear(utc(2025, 7, 8), 2018)).toBe(true);   // first day
    expect(isInFiscalYear(utc(2025, 7, 7), 2018)).toBe(false);  // day before
    expect(isInFiscalYear(utc(2026, 7, 7), 2018)).toBe(true);   // last day
    expect(isInFiscalYear(utc(2026, 7, 8), 2018)).toBe(false);  // day after
  });

  it('derives the current fiscal year', () => {
    expect(currentFiscalYear(utc(2025, 9, 12))).toBe(2018);
    expect(currentFiscalYear(utc(2025, 6, 1))).toBe(2017);
  });
});

describe('project statement', () => {
  const project = { projectId: 'p1', title: 'Bole Tower', clientName: 'Bole Development' };
  const contract = { netSantim: ETB(4_200_000), vatSantim: ETB(630_000), grossSantim: ETB(4_830_000) };

  const invoice = (over: Partial<StatementInvoice> = {}): StatementInvoice => ({
    invoiceNo: 'INV-1', issuedAt: utc(2025, 8, 1), dueDate: utc(2025, 9, 1),
    netSantim: ETB(1_000_000), vatSantim: ETB(150_000), grossSantim: ETB(1_150_000),
    status: 'issued', receipts: [], ...over,
  });

  const voucher = (over: Partial<StatementDisbursement> = {}): StatementDisbursement => ({
    voucherNo: 'PV-1', subcontractorName: 'Alpha Civil', phaseName: 'Shaft preparation',
    paidAt: utc(2025, 8, 15), netSantim: ETB(300_000), supplierVatSantim: ETB(45_000),
    whtSantim: ETB(9_000), netPayableSantim: ETB(336_000), status: 'paid', ...over,
  });

  it('separates cash collected from client withholding', () => {
    const s = buildProjectStatement(project, contract, [
      invoice({ receipts: [{ amountGrossSantim: ETB(1_130_000), clientWhtSantim: ETB(20_000) }] }),
    ], []);
    expect(s.revenue.collectedGrossSantim).toBe(ETB(1_130_000));
    expect(s.revenue.withheldByClientSantim).toBe(ETB(20_000));
    expect(s.revenue.outstandingGrossSantim).toBe(0); // settled by the two together
  });

  it('reports what is left to bill', () => {
    const s = buildProjectStatement(project, contract, [invoice()], []);
    expect(s.revenue.unbilledNetSantim).toBe(ETB(3_200_000));
  });

  it('reports contract margin and realised margin separately', () => {
    // Contract margin is what the job is worth if it finishes as sold; realised
    // margin is what has been earned on the work billed so far. A project can
    // look healthy on one and be bleeding on the other.
    const s = buildProjectStatement(project, contract, [invoice()], [
      voucher({ netSantim: ETB(1_200_000) }),
    ]);
    expect(s.margin.grossSantim).toBe(ETB(3_000_000)); // 4.2M contract - 1.2M cost
    expect(s.margin.realisedSantim).toBe(-ETB(200_000)); // 1.0M billed - 1.2M cost
    expect(s.margin.realisedBps).toBe(-2000);
  });

  it('groups cost by phase, largest first', () => {
    const s = buildProjectStatement(project, contract, [], [
      voucher({ phaseName: 'Shaft preparation', netSantim: ETB(200_000) }),
      voucher({ voucherNo: 'PV-2', phaseName: 'Rail installation', netSantim: ETB(500_000) }),
      voucher({ voucherNo: 'PV-3', phaseName: 'Shaft preparation', netSantim: ETB(100_000) }),
    ]);
    expect(s.costs.byPhase[0]!.phaseName).toBe('Rail installation');
    const shaft = s.costs.byPhase.find((p) => p.phaseName === 'Shaft preparation');
    expect(shaft!.netSantim).toBe(ETB(300_000));
    expect(shaft!.vouchers).toBe(2);
    expect(shaft!.shareBps).toBe(3750); // 300k of 800k
  });

  it('excludes drafts and voids from revenue, and uncommitted vouchers from cost', () => {
    const s = buildProjectStatement(project, contract,
      [invoice(), invoice({ invoiceNo: 'INV-2', status: 'draft' }), invoice({ invoiceNo: 'INV-3', status: 'void' })],
      [voucher(), voucher({ voucherNo: 'PV-9', status: 'draft', netSantim: ETB(900_000) })],
    );
    expect(s.revenue.invoicedNetSantim).toBe(ETB(1_000_000));
    expect(s.costs.subcontractNetSantim).toBe(ETB(300_000));
  });

  it('counts only paid vouchers as cash out', () => {
    const s = buildProjectStatement(project, contract, [], [
      voucher({ status: 'paid' }),
      voucher({ voucherNo: 'PV-2', status: 'approved' }),
    ]);
    expect(s.costs.subcontractNetSantim).toBe(ETB(600_000)); // both committed
    expect(s.costs.cashDisbursedSantim).toBe(ETB(336_000));  // only one paid
  });

  it('nets VAT and reports net cash', () => {
    const s = buildProjectStatement(project, contract, [
      invoice({ receipts: [{ amountGrossSantim: ETB(1_150_000), clientWhtSantim: 0 }] }),
    ], [voucher()]);
    expect(s.tax.netVatPayableSantim).toBe(ETB(150_000) - ETB(45_000));
    expect(s.netCashSantim).toBe(ETB(1_150_000) - ETB(336_000));
  });

  it('handles a project with no contract yet', () => {
    const s = buildProjectStatement(project, null, [], []);
    expect(s.margin.grossBps).toBeNull();
    expect(s.revenue.unbilledNetSantim).toBe(0);
  });
});

describe('portfolio summary', () => {
  it('aggregates and counts loss-making projects by REALISED margin', () => {
    const statement = (realised: number, contractNet: number, cost: number) =>
      buildProjectStatement(
        { projectId: 'x', title: 'x', clientName: 'x' },
        { netSantim: contractNet, vatSantim: 0, grossSantim: contractNet },
        [{ invoiceNo: 'i', issuedAt: new Date(), dueDate: new Date(),
           netSantim: realised + cost, vatSantim: 0, grossSantim: realised + cost,
           status: 'issued', receipts: [] }],
        [{ voucherNo: 'v', subcontractorName: 's', phaseName: 'p', paidAt: new Date(),
           netSantim: cost, supplierVatSantim: 0, whtSantim: 0, netPayableSantim: cost, status: 'paid' }],
      );

    const summary = summarisePortfolio([
      statement(ETB(500_000), ETB(2_000_000), ETB(500_000)),
      statement(-ETB(100_000), ETB(1_000_000), ETB(600_000)),
    ]);
    expect(summary.projects).toBe(2);
    expect(summary.lossMakingProjects).toBe(1);
    expect(summary.contractNetSantim).toBe(ETB(3_000_000));
  });

  it('handles an empty portfolio', () => {
    const summary = summarisePortfolio([]);
    expect(summary.projects).toBe(0);
    expect(summary.grossMarginBps).toBeNull();
  });
});

describe('period series', () => {
  it('aggregates revenue and cost by Gregorian month', () => {
    const rows = buildPeriodSeries(
      [
        { period: '2025-09', netSantim: ETB(1_000_000), vatSantim: ETB(150_000), status: 'issued' },
        { period: '2025-09', netSantim: ETB(500_000), vatSantim: ETB(75_000), status: 'paid' },
      ],
      [{ period: '2025-09', netSantim: ETB(900_000), supplierVatSantim: ETB(135_000), whtSantim: ETB(27_000), status: 'paid' }],
      'gregorian',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.basis).toBe('gregorian');
    expect(rows[0]!.year).toBe(2025);
    expect(rows[0]!.month).toBe(9);
    expect(rows[0]!.revenueNetSantim).toBe(ETB(1_500_000));
    expect(rows[0]!.marginSantim).toBe(ETB(600_000));
    expect(rows[0]!.marginBps).toBe(4000);
    expect(rows[0]!.netVatPayableSantim).toBe(ETB(90_000));
  });

  it('aggregates revenue and cost by Ethiopian month', () => {
    const rows = buildPeriodSeries(
      [
        { period: 'EC-2018-01', netSantim: ETB(1_000_000), vatSantim: ETB(150_000), status: 'issued' },
        { period: 'EC-2018-01', netSantim: ETB(500_000), vatSantim: ETB(75_000), status: 'paid' },
      ],
      [{ period: 'EC-2018-01', netSantim: ETB(900_000), supplierVatSantim: ETB(135_000), whtSantim: ETB(27_000), status: 'paid' }],
      'ethiopian',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.basis).toBe('ethiopian');
    expect(rows[0]!.year).toBe(2018);
    expect(rows[0]!.month).toBe(1);
    expect(rows[0]!.revenueNetSantim).toBe(ETB(1_500_000));
    expect(rows[0]!.marginBps).toBe(4000);
  });

  it('refuses a period key from the other calendar', () => {
    // Every invoice carries both keys and they are easy to swap. A swap must
    // fail loudly, not draw a chart with the wrong figures under right-looking
    // month names.
    expect(() =>
      buildPeriodSeries(
        [{ period: 'EC-2018-01', netSantim: ETB(100), vatSantim: 0, status: 'issued' }],
        [],
        'gregorian',
      ),
    ).toThrow(/not a gregorian month key/);

    expect(() =>
      buildPeriodSeries(
        [{ period: '2025-09', netSantim: ETB(100), vatSantim: 0, status: 'issued' }],
        [],
        'ethiopian',
      ),
    ).toThrow(/not a ethiopian month key/);
  });

  it('emits empty months so a gap reads as a gap', () => {
    // A trend with silently missing months draws a smooth line over a hole.
    const rows = buildPeriodSeries(
      [
        { period: '2025-09', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
        { period: '2025-12', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
      ],
      [],
      'gregorian',
    );
    expect(rows.map((r) => r.period)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12']);
    expect(rows[1]!.revenueNetSantim).toBe(0);
    expect(rows[1]!.marginBps).toBeNull(); // no revenue, so no margin — not 0%
  });

  it('rolls a Gregorian year over at 12 months', () => {
    const rows = buildPeriodSeries(
      [
        { period: '2025-11', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
        { period: '2026-01', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
      ],
      [],
      'gregorian',
    );
    expect(rows.map((r) => r.period)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('spans an Ethiopian year boundary through Pagume', () => {
    const rows = buildPeriodSeries(
      [
        { period: 'EC-2017-12', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
        { period: 'EC-2018-01', netSantim: ETB(100), vatSantim: 0, status: 'issued' },
      ],
      [],
      'ethiopian',
    );
    // Pagume is month 13 and is a month like any other here — dropping it would
    // lose every invoice issued in the five days before New Year.
    expect(rows.map((r) => r.period)).toEqual(['EC-2017-12', 'EC-2017-13', 'EC-2018-01']);
  });

  it('ignores drafts, voids and uncommitted vouchers', () => {
    const rows = buildPeriodSeries(
      [
        { period: '2025-09', netSantim: ETB(100), vatSantim: 0, status: 'draft' },
        { period: '2025-09', netSantim: ETB(100), vatSantim: 0, status: 'void' },
      ],
      [{ period: '2025-09', netSantim: ETB(50), supplierVatSantim: 0, whtSantim: 0, status: 'draft' }],
      'gregorian',
    );
    expect(rows).toEqual([]);

  });
});

describe('cash-flow forecast', () => {
  const asOf = utc(2025, 9, 12);

  it('shows overdue money first and separately from the forecast', () => {
    // Overdue receivables are not a forecast — they are money that should
    // already be here. Folding them forward flatters the position.
    const forecast = buildCashflowForecast(
      [
        { dueDate: utc(2025, 5, 1), balanceSantim: ETB(500_000) },  // 90+ overdue
        { dueDate: utc(2025, 10, 1), balanceSantim: ETB(300_000) }, // due within 30
      ],
      [],
      asOf,
    );
    const over90 = forecast.buckets.find((b) => b.bucket === 'over_90');
    const due30 = forecast.buckets.find((b) => b.bucket === 'due_30');
    expect(over90!.inflowSantim).toBe(ETB(500_000));
    expect(due30!.inflowSantim).toBe(ETB(300_000));
    // Overdue sorts first, so the running total starts with what is already late.
    expect(forecast.buckets[0]!.bucket).toBe('over_90');
  });

  it('counts a payable at its NET PAYABLE, not the supplier invoice', () => {
    // The withheld portion goes to ERCA, not the subcontractor.
    const forecast = buildCashflowForecast([], [
      { dueDate: utc(2025, 9, 20), netPayableSantim: ETB(112_000) },
    ], asOf);
    expect(forecast.totalOutflowSantim).toBe(ETB(112_000));
  });

  it('treats an unscheduled approved payment as due now', () => {
    const forecast = buildCashflowForecast([], [
      { dueDate: null, netPayableSantim: ETB(200_000) },
    ], asOf);
    expect(forecast.buckets.find((b) => b.bucket === 'due_30')!.outflowSantim).toBe(ETB(200_000));
  });

  it('runs a cumulative net across buckets', () => {
    const forecast = buildCashflowForecast(
      [{ dueDate: utc(2025, 9, 20), balanceSantim: ETB(500_000) }],
      [{ dueDate: utc(2025, 9, 25), netPayableSantim: ETB(200_000) }],
      asOf,
    );
    const due30 = forecast.buckets.find((b) => b.bucket === 'due_30');
    expect(due30!.netSantim).toBe(ETB(300_000));
    expect(forecast.netSantim).toBe(ETB(300_000));
  });

  it('ignores settled receivables', () => {
    const forecast = buildCashflowForecast(
      [{ dueDate: utc(2025, 5, 1), balanceSantim: 0 }], [], asOf,
    );
    expect(forecast.totalInflowSantim).toBe(0);
  });
});
