/**
 * Financial reporting: project statements, portfolio totals, period series and
 * a cash-flow forecast.
 *
 * Everything here is derived from documents that exist. No figure in a report
 * may come from anywhere but an invoice, a disbursement or a contract — a report
 * that can disagree with its own source records is worse than no report.
 */

import { ethiopianFiscalYear, ethiopianToUTCDate, utcDateToEthiopian } from './ethiopic.js';
import { ageBucket, settle, type AgeBucket, type ReceiptInput } from './invoicing.js';
import { rateBps } from './kpi.js';
import type { RateBps } from './schema.js';

// ---------------------------------------------------------------------------
// Ethiopian fiscal year
// ---------------------------------------------------------------------------

/**
 * The Ethiopian fiscal year runs 1 Hamle (month 11) to 30 Sene (month 10) and is
 * named for the year it ENDS in. FY 2018 therefore begins in Hamle 2017.
 *
 * Reports default to this rather than the Gregorian year, because it is the
 * boundary ERCA's annual filing actually uses.
 */
export function fiscalYearRange(fiscalYear: number): { start: Date; end: Date; label: string } {
  return {
    start: ethiopianToUTCDate({ year: fiscalYear - 1, month: 11, day: 1 }),
    // 30 Sene is the last day; Sene always has 30 days.
    end: ethiopianToUTCDate({ year: fiscalYear, month: 10, day: 30 }),
    label: `FY ${fiscalYear} (Hamle ${fiscalYear - 1} – Sene ${fiscalYear})`,
  };
}

export function currentFiscalYear(asOf: Date = new Date()): number {
  return ethiopianFiscalYear(utcDateToEthiopian(asOf));
}

export function isInFiscalYear(date: Date, fiscalYear: number): boolean {
  const { start, end } = fiscalYearRange(fiscalYear);
  return date >= start && date <= end;
}

// ---------------------------------------------------------------------------
// Project statement
// ---------------------------------------------------------------------------

export interface StatementInvoice {
  invoiceNo: string;
  issuedAt: Date;
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  dueDate: Date;
  receipts: readonly ReceiptInput[];
}

export interface StatementDisbursement {
  voucherNo: string;
  subcontractorName: string;
  phaseName: string;
  paidAt: Date | null;
  netSantim: number;
  supplierVatSantim: number;
  whtSantim: number;
  netPayableSantim: number;
  status: 'draft' | 'approved' | 'paid' | 'rejected' | 'void';
}

export interface PhaseCost {
  phaseName: string;
  netSantim: number;
  whtSantim: number;
  netPayableSantim: number;
  vouchers: number;
  /** Share of total subcontract cost. */
  shareBps: RateBps;
}

export interface ProjectStatement {
  projectId: string;
  title: string;
  clientName: string;

  revenue: {
    contractNetSantim: number;
    contractVatSantim: number;
    contractGrossSantim: number;
    invoicedNetSantim: number;
    invoicedVatSantim: number;
    invoicedGrossSantim: number;
    collectedGrossSantim: number;
    /** Cleared by client withholding — settled without arriving as cash. */
    withheldByClientSantim: number;
    outstandingGrossSantim: number;
    /** Contract value not yet invoiced. */
    unbilledNetSantim: number;
  };

  costs: {
    subcontractNetSantim: number;
    subcontractInputVatSantim: number;
    whtWithheldSantim: number;
    cashDisbursedSantim: number;
    byPhase: PhaseCost[];
  };

  tax: {
    outputVatSantim: number;
    inputVatSantim: number;
    netVatPayableSantim: number;
    whtWithheldSantim: number;
  };

  margin: {
    /** Contract net less subcontract net. VAT excluded on both sides. */
    grossSantim: number;
    grossBps: RateBps;
    /** Margin realised on what has actually been invoiced so far. */
    realisedSantim: number;
    realisedBps: RateBps;
  };

  /** Cash in less cash out. The number that decides whether a project is funding itself. */
  netCashSantim: number;
}

/**
 * Build a full statement for one project.
 *
 * Realised margin is reported alongside contract margin because they answer
 * different questions: contract margin is what the job is worth if it finishes
 * as sold, realised margin is what has been earned on the work billed so far.
 * A project can look profitable on the first and be bleeding on the second.
 */
export function buildProjectStatement(
  project: { projectId: string; title: string; clientName: string },
  contract: { netSantim: number; vatSantim: number; grossSantim: number } | null,
  invoices: readonly StatementInvoice[],
  disbursements: readonly StatementDisbursement[],
): ProjectStatement {
  const billed = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const committed = disbursements.filter((d) => d.status === 'approved' || d.status === 'paid');

  let collectedGrossSantim = 0;
  let withheldByClientSantim = 0;
  let outstandingGrossSantim = 0;
  for (const invoice of billed) {
    const settlement = settle(invoice.grossSantim, invoice.receipts);
    collectedGrossSantim += settlement.paidGrossSantim;
    withheldByClientSantim += settlement.clientWhtSantim;
    outstandingGrossSantim += settlement.balanceSantim;
  }

  const invoicedNetSantim = billed.reduce((a, i) => a + i.netSantim, 0);
  const invoicedVatSantim = billed.reduce((a, i) => a + i.vatSantim, 0);
  const subcontractNetSantim = committed.reduce((a, d) => a + d.netSantim, 0);
  const subcontractInputVatSantim = committed.reduce((a, d) => a + d.supplierVatSantim, 0);
  const whtWithheldSantim = committed.reduce((a, d) => a + d.whtSantim, 0);
  const cashDisbursedSantim = committed
    .filter((d) => d.status === 'paid')
    .reduce((a, d) => a + d.netPayableSantim, 0);

  const contractNetSantim = contract?.netSantim ?? 0;
  const grossMarginSantim = contractNetSantim - subcontractNetSantim;
  const realisedSantim = invoicedNetSantim - subcontractNetSantim;

  return {
    ...project,
    revenue: {
      contractNetSantim,
      contractVatSantim: contract?.vatSantim ?? 0,
      contractGrossSantim: contract?.grossSantim ?? 0,
      invoicedNetSantim,
      invoicedVatSantim,
      invoicedGrossSantim: billed.reduce((a, i) => a + i.grossSantim, 0),
      collectedGrossSantim,
      withheldByClientSantim,
      outstandingGrossSantim,
      unbilledNetSantim: Math.max(0, contractNetSantim - invoicedNetSantim),
    },
    costs: {
      subcontractNetSantim,
      subcontractInputVatSantim,
      whtWithheldSantim,
      cashDisbursedSantim,
      byPhase: groupByPhase(committed, subcontractNetSantim),
    },
    tax: {
      outputVatSantim: invoicedVatSantim,
      inputVatSantim: subcontractInputVatSantim,
      netVatPayableSantim: invoicedVatSantim - subcontractInputVatSantim,
      whtWithheldSantim,
    },
    margin: {
      grossSantim: grossMarginSantim,
      grossBps: rateBps(grossMarginSantim, contractNetSantim),
      realisedSantim,
      realisedBps: rateBps(realisedSantim, invoicedNetSantim),
    },
    netCashSantim: collectedGrossSantim - cashDisbursedSantim,
  };
}

function groupByPhase(
  disbursements: readonly StatementDisbursement[],
  totalNetSantim: number,
): PhaseCost[] {
  const groups = new Map<string, StatementDisbursement[]>();
  for (const d of disbursements) {
    const key = d.phaseName || 'Unassigned';
    const existing = groups.get(key);
    if (existing === undefined) groups.set(key, [d]);
    else existing.push(d);
  }

  return [...groups.entries()]
    .map(([phaseName, rows]) => {
      const netSantim = rows.reduce((a, d) => a + d.netSantim, 0);
      return {
        phaseName,
        netSantim,
        whtSantim: rows.reduce((a, d) => a + d.whtSantim, 0),
        netPayableSantim: rows.reduce((a, d) => a + d.netPayableSantim, 0),
        vouchers: rows.length,
        shareBps: rateBps(netSantim, totalNetSantim),
      };
    })
    .sort((a, b) => b.netSantim - a.netSantim);
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioSummary {
  projects: number;
  contractNetSantim: number;
  invoicedNetSantim: number;
  collectedGrossSantim: number;
  outstandingGrossSantim: number;
  unbilledNetSantim: number;
  subcontractNetSantim: number;
  grossMarginSantim: number;
  grossMarginBps: RateBps;
  outputVatSantim: number;
  inputVatSantim: number;
  netVatPayableSantim: number;
  whtWithheldSantim: number;
  netCashSantim: number;
  /** Projects whose realised margin is negative — losing money on work billed. */
  lossMakingProjects: number;
}

export function summarisePortfolio(statements: readonly ProjectStatement[]): PortfolioSummary {
  const sum = (pick: (s: ProjectStatement) => number) => statements.reduce((a, s) => a + pick(s), 0);

  const contractNetSantim = sum((s) => s.revenue.contractNetSantim);
  const subcontractNetSantim = sum((s) => s.costs.subcontractNetSantim);
  const grossMarginSantim = contractNetSantim - subcontractNetSantim;
  const outputVatSantim = sum((s) => s.tax.outputVatSantim);
  const inputVatSantim = sum((s) => s.tax.inputVatSantim);

  return {
    projects: statements.length,
    contractNetSantim,
    invoicedNetSantim: sum((s) => s.revenue.invoicedNetSantim),
    collectedGrossSantim: sum((s) => s.revenue.collectedGrossSantim),
    outstandingGrossSantim: sum((s) => s.revenue.outstandingGrossSantim),
    unbilledNetSantim: sum((s) => s.revenue.unbilledNetSantim),
    subcontractNetSantim,
    grossMarginSantim,
    grossMarginBps: rateBps(grossMarginSantim, contractNetSantim),
    outputVatSantim,
    inputVatSantim,
    netVatPayableSantim: outputVatSantim - inputVatSantim,
    whtWithheldSantim: sum((s) => s.tax.whtWithheldSantim),
    netCashSantim: sum((s) => s.netCashSantim),
    lossMakingProjects: statements.filter((s) => s.margin.realisedSantim < 0).length,
  };
}

// ---------------------------------------------------------------------------
// Period series
// ---------------------------------------------------------------------------

export interface PeriodRow {
  /** `EC-2018-04`. */
  periodEc: string;
  ecYear: number;
  ecMonth: number;
  revenueNetSantim: number;
  outputVatSantim: number;
  costNetSantim: number;
  inputVatSantim: number;
  marginSantim: number;
  marginBps: RateBps;
  netVatPayableSantim: number;
  whtWithheldSantim: number;
  invoices: number;
  vouchers: number;
}

/**
 * Revenue, cost and margin by Ethiopian month.
 *
 * Every month between the first and last with activity is emitted, including
 * empty ones — a trend with silently missing months reads as a smooth line when
 * the truth is a gap, and that is exactly the shape a seasonal business needs
 * to see.
 */
export function buildPeriodSeries(
  invoices: readonly { periodEc: string; netSantim: number; vatSantim: number; status: StatementInvoice['status'] }[],
  disbursements: readonly { periodEc: string; netSantim: number; supplierVatSantim: number; whtSantim: number; status: StatementDisbursement['status'] }[],
): PeriodRow[] {
  const rows = new Map<string, PeriodRow>();

  const ensure = (periodEc: string): PeriodRow => {
    const existing = rows.get(periodEc);
    if (existing !== undefined) return existing;
    const [, year, month] = /^EC-(\d+)-(\d+)$/.exec(periodEc) ?? [];
    const created: PeriodRow = {
      periodEc,
      ecYear: Number(year ?? 0),
      ecMonth: Number(month ?? 0),
      revenueNetSantim: 0, outputVatSantim: 0, costNetSantim: 0, inputVatSantim: 0,
      marginSantim: 0, marginBps: null, netVatPayableSantim: 0, whtWithheldSantim: 0,
      invoices: 0, vouchers: 0,
    };
    rows.set(periodEc, created);
    return created;
  };

  for (const invoice of invoices) {
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    const row = ensure(invoice.periodEc);
    row.revenueNetSantim += invoice.netSantim;
    row.outputVatSantim += invoice.vatSantim;
    row.invoices += 1;
  }

  for (const voucher of disbursements) {
    if (voucher.status !== 'approved' && voucher.status !== 'paid') continue;
    const row = ensure(voucher.periodEc);
    row.costNetSantim += voucher.netSantim;
    row.inputVatSantim += voucher.supplierVatSantim;
    row.whtWithheldSantim += voucher.whtSantim;
    row.vouchers += 1;
  }

  const filled = fillGaps([...rows.values()]);
  for (const row of filled) {
    row.marginSantim = row.revenueNetSantim - row.costNetSantim;
    row.marginBps = rateBps(row.marginSantim, row.revenueNetSantim);
    row.netVatPayableSantim = row.outputVatSantim - row.inputVatSantim;
  }
  return filled;
}

/** Emit every month between the first and last, so a gap reads as a gap. */
function fillGaps(rows: readonly PeriodRow[]): PeriodRow[] {
  if (rows.length === 0) return [];
  const sorted = [...rows].sort((a, b) => a.ecYear - b.ecYear || a.ecMonth - b.ecMonth);
  const first = sorted[0] as PeriodRow;
  const last = sorted[sorted.length - 1] as PeriodRow;
  const byKey = new Map(sorted.map((r) => [r.periodEc, r]));

  const out: PeriodRow[] = [];
  // 13 months per Ethiopian year, Pagume included.
  for (let year = first.ecYear; year <= last.ecYear; year++) {
    const from = year === first.ecYear ? first.ecMonth : 1;
    const to = year === last.ecYear ? last.ecMonth : 13;
    for (let month = from; month <= to; month++) {
      const periodEc = `EC-${year}-${String(month).padStart(2, '0')}`;
      out.push(
        byKey.get(periodEc) ?? {
          periodEc, ecYear: year, ecMonth: month,
          revenueNetSantim: 0, outputVatSantim: 0, costNetSantim: 0, inputVatSantim: 0,
          marginSantim: 0, marginBps: null, netVatPayableSantim: 0, whtWithheldSantim: 0,
          invoices: 0, vouchers: 0,
        },
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cash-flow forecast
// ---------------------------------------------------------------------------

export interface CashflowBucket {
  bucket: AgeBucket | 'due_30' | 'due_60' | 'due_90' | 'due_later';
  label: string;
  inflowSantim: number;
  outflowSantim: number;
  netSantim: number;
  /** Running net across buckets, oldest first. */
  cumulativeSantim: number;
}

/**
 * Expected cash in against committed cash out.
 *
 * Overdue receivables are shown FIRST and separately, because they are not a
 * forecast — they are money that should already be here. Folding them into a
 * future bucket makes a cash position look healthier than it is.
 *
 * Outflows count approved-but-unpaid vouchers at their NET PAYABLE, since the
 * withheld portion goes to ERCA, not the subcontractor.
 */
export function buildCashflowForecast(
  receivables: readonly { dueDate: Date; balanceSantim: number }[],
  payables: readonly { dueDate: Date | null; netPayableSantim: number }[],
  asOf: Date,
): { buckets: CashflowBucket[]; totalInflowSantim: number; totalOutflowSantim: number; netSantim: number } {
  const order: CashflowBucket['bucket'][] = [
    'over_90', '61_90', '31_60', '1_30', 'due_30', 'due_60', 'due_90', 'due_later',
  ];
  const labels: Record<CashflowBucket['bucket'], string> = {
    over_90: 'Overdue 90+ days', '61_90': 'Overdue 61–90', '31_60': 'Overdue 31–60',
    '1_30': 'Overdue 1–30', current: 'Not yet due',
    due_30: 'Due within 30 days', due_60: 'Due in 31–60 days',
    due_90: 'Due in 61–90 days', due_later: 'Due beyond 90 days',
  };

  const buckets = new Map<CashflowBucket['bucket'], { inflow: number; outflow: number }>();
  for (const key of order) buckets.set(key, { inflow: 0, outflow: 0 });

  const futureBucket = (dueDate: Date): CashflowBucket['bucket'] => {
    const days = Math.round((dueDate.getTime() - asOf.getTime()) / 86_400_000);
    if (days <= 30) return 'due_30';
    if (days <= 60) return 'due_60';
    if (days <= 90) return 'due_90';
    return 'due_later';
  };

  for (const receivable of receivables) {
    if (receivable.balanceSantim <= 0) continue;
    const overdue = ageBucket(receivable.dueDate, asOf);
    const key = overdue === 'current' ? futureBucket(receivable.dueDate) : overdue;
    (buckets.get(key) as { inflow: number; outflow: number }).inflow += receivable.balanceSantim;
  }

  for (const payable of payables) {
    if (payable.netPayableSantim <= 0) continue;
    // A voucher with no payment date is treated as immediately due — an
    // approved payment we have not scheduled is still money we owe now.
    const key = payable.dueDate === null ? 'due_30' : futureBucket(payable.dueDate);
    (buckets.get(key) as { inflow: number; outflow: number }).outflow += payable.netPayableSantim;
  }

  let cumulativeSantim = 0;
  const rows: CashflowBucket[] = order.map((bucket) => {
    const { inflow, outflow } = buckets.get(bucket) as { inflow: number; outflow: number };
    const netSantim = inflow - outflow;
    cumulativeSantim += netSantim;
    return {
      bucket,
      label: labels[bucket],
      inflowSantim: inflow,
      outflowSantim: outflow,
      netSantim,
      cumulativeSantim,
    };
  });

  return {
    buckets: rows,
    totalInflowSantim: rows.reduce((a, r) => a + r.inflowSantim, 0),
    totalOutflowSantim: rows.reduce((a, r) => a + r.outflowSantim, 0),
    netSantim: cumulativeSantim,
  };
}
