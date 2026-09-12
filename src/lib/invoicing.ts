/**
 * Invoice arithmetic: line totals, settlement, and ageing.
 *
 * TWO THINGS HERE ARE EASY TO GET WRONG AND EXPENSIVE TO DISCOVER LATE
 *
 *   1. VAT is summed PER LINE, not applied to the invoice total. Zero-rated and
 *      exempt supplies sit on the same invoice as standard-rated ones, and
 *      multiplying the total by 15% would overstate the VAT owed on every
 *      invoice that carries one.
 *
 *   2. An invoice paid net of the client's withholding is SETTLED, not part
 *      paid. If a client withholds 2% and remits 98%, the remaining 2% is not a
 *      receivable — it is sitting with ERCA against our income tax. Treating it
 *      as debt means chasing money nobody owes, forever.
 */

import { applyBps, VAT_RATE_BPS } from './money.js';
import { daysBetween, rateBps } from './kpi.js';
import type { RateBps } from './schema.js';

export interface InvoiceLineInput {
  description: string;
  /** Quantity, allowed to be fractional (e.g. 1.5 days). */
  qty: number;
  unitNetSantim: number;
  /** Per line: 1500 standard, 0 for zero-rated or exempt supplies. */
  vatRateBps?: number;
}

export interface InvoiceLine {
  description: string;
  qty: number;
  unitNetSantim: number;
  lineNetSantim: number;
  vatRateBps: number;
  lineVatSantim: number;
  lineGrossSantim: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  /** The dominant rate, for the invoice header. Null when lines disagree. */
  vatRateBps: number | null;
  /** True when the invoice carries lines at more than one VAT rate. */
  mixedRates: boolean;
}

/**
 * Total an invoice from its lines.
 *
 * Each line's VAT is rounded to the santim independently, because that is what
 * is printed against it — summing exact fractions and rounding once would print
 * lines that do not add up to the total.
 */
export function totalInvoice(inputs: readonly InvoiceLineInput[]): InvoiceTotals {
  const lines: InvoiceLine[] = inputs.map((input) => {
    const vatRateBps = input.vatRateBps ?? VAT_RATE_BPS;
    const lineNetSantim = Math.round(input.qty * input.unitNetSantim);
    const lineVatSantim = applyBps(lineNetSantim, vatRateBps);
    return {
      description: input.description,
      qty: input.qty,
      unitNetSantim: input.unitNetSantim,
      lineNetSantim,
      vatRateBps,
      lineVatSantim,
      lineGrossSantim: lineNetSantim + lineVatSantim,
    };
  });

  const netSantim = lines.reduce((a, l) => a + l.lineNetSantim, 0);
  const vatSantim = lines.reduce((a, l) => a + l.lineVatSantim, 0);
  const rates = new Set(lines.map((l) => l.vatRateBps));

  return {
    lines,
    netSantim,
    vatSantim,
    grossSantim: netSantim + vatSantim,
    vatRateBps: rates.size === 1 ? ([...rates][0] as number) : null,
    mixedRates: rates.size > 1,
  };
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface ReceiptInput {
  amountGrossSantim: number;
  /** Withholding the CLIENT deducted from us and remitted to ERCA on our behalf. */
  clientWhtSantim: number;
}

export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';

export interface SettlementState {
  grossSantim: number;
  /** Cash actually received. */
  paidGrossSantim: number;
  /** Withheld by the client — settled, but never arriving as cash. */
  clientWhtSantim: number;
  /** paid + withheld. What the invoice has been cleared by. */
  settledSantim: number;
  /** What the client still owes. Never negative. */
  balanceSantim: number;
  /** Overpayment, if any — worth surfacing rather than hiding in a clamp. */
  overpaidSantim: number;
  fullySettled: boolean;
}

export function settle(grossSantim: number, receipts: readonly ReceiptInput[]): SettlementState {
  const paidGrossSantim = receipts.reduce((a, r) => a + r.amountGrossSantim, 0);
  const clientWhtSantim = receipts.reduce((a, r) => a + r.clientWhtSantim, 0);
  const settledSantim = paidGrossSantim + clientWhtSantim;
  const difference = grossSantim - settledSantim;

  return {
    grossSantim,
    paidGrossSantim,
    clientWhtSantim,
    settledSantim,
    balanceSantim: Math.max(0, difference),
    overpaidSantim: Math.max(0, -difference),
    fullySettled: difference <= 0,
  };
}

/**
 * Derive an invoice's status.
 *
 * `void` and `draft` are states a person set and are never derived away.
 */
export function deriveInvoiceStatus(
  current: InvoiceStatus,
  settlement: SettlementState,
  dueDate: Date,
  asOf: Date,
): InvoiceStatus {
  if (current === 'draft' || current === 'void') return current;
  if (settlement.fullySettled) return 'paid';
  if (settlement.settledSantim > 0) return 'partially_paid';
  return asOf > dueDate ? 'overdue' : 'issued';
}

// ---------------------------------------------------------------------------
// Ageing
// ---------------------------------------------------------------------------

export type AgeBucket = 'current' | '1_30' | '31_60' | '61_90' | 'over_90';

export const AGE_BUCKET_LABELS: Record<AgeBucket, string> = {
  current: 'Not yet due',
  '1_30': '1–30 days',
  '31_60': '31–60 days',
  '61_90': '61–90 days',
  over_90: 'Over 90 days',
};

export function ageBucket(dueDate: Date, asOf: Date): AgeBucket {
  const days = daysBetween(dueDate, asOf);
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'over_90';
}

export interface AgedReceivable {
  invoiceId: string;
  invoiceNo: string;
  clientName: string;
  dueDate: Date;
  balanceSantim: number;
  bucket: AgeBucket;
  daysOverdue: number;
}

export interface AgeingReport {
  rows: AgedReceivable[];
  byBucket: Record<AgeBucket, number>;
  totalSantim: number;
  overdueSantim: number;
  /** Share of outstanding debt more than 90 days old — the collectability signal. */
  over90Bps: RateBps;
}

export function ageReceivables(
  invoices: readonly {
    id: string;
    invoiceNo: string;
    clientName: string;
    dueDate: Date;
    grossSantim: number;
    receipts: readonly ReceiptInput[];
    status: InvoiceStatus;
  }[],
  asOf: Date,
): AgeingReport {
  const byBucket: Record<AgeBucket, number> = {
    current: 0, '1_30': 0, '31_60': 0, '61_90': 0, over_90: 0,
  };
  const rows: AgedReceivable[] = [];

  for (const invoice of invoices) {
    // Drafts were never issued and voids were cancelled; neither is a debt.
    if (invoice.status === 'draft' || invoice.status === 'void') continue;
    const settlement = settle(invoice.grossSantim, invoice.receipts);
    if (settlement.balanceSantim <= 0) continue;

    const bucket = ageBucket(invoice.dueDate, asOf);
    byBucket[bucket] += settlement.balanceSantim;
    rows.push({
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      clientName: invoice.clientName,
      dueDate: invoice.dueDate,
      balanceSantim: settlement.balanceSantim,
      bucket,
      daysOverdue: Math.max(0, daysBetween(invoice.dueDate, asOf)),
    });
  }

  const totalSantim = Object.values(byBucket).reduce((a, b) => a + b, 0);
  const overdueSantim = totalSantim - byBucket.current;

  return {
    rows: rows.sort((a, b) => b.daysOverdue - a.daysOverdue || b.balanceSantim - a.balanceSantim),
    byBucket,
    totalSantim,
    overdueSantim,
    over90Bps: rateBps(byBucket.over_90, totalSantim),
  };
}

// ---------------------------------------------------------------------------
// Invoice numbering
// ---------------------------------------------------------------------------

/**
 * Format a sequential invoice number.
 *
 * Ethiopian VAT invoices must be sequential and gapless, which is why the
 * sequence comes from a transactional counter rather than a timestamp or a
 * document count — two users invoicing at once would otherwise collide, and a
 * duplicated invoice number is a finding in any audit.
 */
export function formatInvoiceNo(prefix: string, sequence: number, width = 5): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new RangeError(`Invoice sequence must be a positive integer, got ${sequence}`);
  }
  return `${prefix}-${String(sequence).padStart(width, '0')}`;
}
