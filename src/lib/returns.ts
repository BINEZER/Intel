/**
 * Monthly VAT and withholding tax returns.
 *
 * Both are filed on the Ethiopian calendar month, so every figure is keyed by
 * `periodEc` — the denormalized key on invoices and disbursements exists exactly
 * so a return is one indexed query rather than a date-range scan plus in-memory
 * conversion.
 *
 * These produce the numbers a filing is built from. They are not a substitute
 * for the declaration itself, and the accountant signs the return, not the app.
 */

import { formatETB } from './money.js';
import { ethiopianPeriodKey } from './ethiopic.js';
import type { RateBps } from './schema.js';
import { rateBps } from './kpi.js';

// ---------------------------------------------------------------------------
// VAT return
// ---------------------------------------------------------------------------

export interface VatReturnInvoice {
  invoiceNo: string;
  clientName: string;
  clientTin: string;
  netSantim: number;
  vatSantim: number;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
}

export interface VatReturnDisbursement {
  voucherNo: string;
  subcontractorName: string;
  subcontractorTin: string;
  netSantim: number;
  supplierVatSantim: number;
  status: 'draft' | 'requested' | 'checked' | 'approved' | 'paid' | 'rejected' | 'on_hold' | 'void';
}

export interface VatReturn {
  periodEc: string;
  /** Taxable supplies made, VAT-exclusive. */
  outputNetSantim: number;
  outputVatSantim: number;
  invoiceCount: number;
  /** Purchases on which we were charged VAT, VAT-exclusive. */
  inputNetSantim: number;
  inputVatSantim: number;
  disbursementCount: number;
  /** Output less input. Negative means a credit, not a payment. */
  netVatSantim: number;
  payableSantim: number;
  /** Carried forward against future periods when input exceeds output. */
  creditCarriedForwardSantim: number;
  /** Invoices excluded because they were never issued. Listed so nothing goes missing silently. */
  excludedDrafts: number;
  excludedVoids: number;
}

/**
 * Build the VAT return for one Ethiopian month.
 *
 * VAT is declared on an ACCRUAL basis — an invoice issued in Tir is declared in
 * Tir whether or not the client has paid. Filtering on payment would understate
 * the liability and is the single most common way a VAT return goes wrong.
 *
 * Drafts and voids are excluded and COUNTED, so a missing invoice shows up as a
 * number to investigate rather than an absence nobody notices.
 */
export function buildVatReturn(
  periodEc: string,
  invoices: readonly VatReturnInvoice[],
  disbursements: readonly VatReturnDisbursement[],
): VatReturn {
  const declarable = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  // Input VAT is claimable against an AUTHORISED voucher, never against one
  // still working its way through the payout workflow. A requested or held
  // voucher can still be reduced or refused, and reclaiming VAT on a purchase
  // that is later cut is a correction to ERCA rather than a saving.
  const claimable = disbursements.filter((d) => d.status === 'approved' || d.status === 'paid');

  const outputNetSantim = declarable.reduce((a, i) => a + i.netSantim, 0);
  const outputVatSantim = declarable.reduce((a, i) => a + i.vatSantim, 0);
  const inputNetSantim = claimable.reduce((a, d) => a + d.netSantim, 0);
  const inputVatSantim = claimable.reduce((a, d) => a + d.supplierVatSantim, 0);
  const netVatSantim = outputVatSantim - inputVatSantim;

  return {
    periodEc,
    outputNetSantim,
    outputVatSantim,
    invoiceCount: declarable.length,
    inputNetSantim,
    inputVatSantim,
    disbursementCount: claimable.length,
    netVatSantim,
    payableSantim: Math.max(0, netVatSantim),
    creditCarriedForwardSantim: Math.max(0, -netVatSantim),
    excludedDrafts: invoices.filter((i) => i.status === 'draft').length,
    excludedVoids: invoices.filter((i) => i.status === 'void').length,
  };
}

// ---------------------------------------------------------------------------
// WHT return
// ---------------------------------------------------------------------------

export interface WhtReturnRow {
  voucherNo: string;
  subcontractorId: string;
  subcontractorName: string;
  subcontractorTin: string;
  whtCategory: 'goods' | 'services' | 'exempt';
  whtRateBps: number;
  /** Always the VAT-exclusive base. */
  whtBaseSantim: number;
  whtSantim: number;
  certificateNo?: string | undefined;
  status: 'draft' | 'requested' | 'checked' | 'approved' | 'paid' | 'rejected' | 'on_hold' | 'void';
}

export interface WhtSupplierSummary {
  subcontractorId: string;
  subcontractorName: string;
  subcontractorTin: string;
  hasTin: boolean;
  payments: number;
  baseSantim: number;
  whtSantim: number;
  /** Effective rate across their payments — flags a mix of goods and services. */
  effectiveRateBps: RateBps;
  /** Payments still without a withholding certificate issued to the supplier. */
  missingCertificates: number;
}

export interface WhtReturn {
  periodEc: string;
  rows: WhtReturnRow[];
  bySupplier: WhtSupplierSummary[];
  totalBaseSantim: number;
  totalWhtSantim: number;
  /** Payments where the 30% no-TIN penalty rate was applied. */
  noTinPayments: number;
  /** The compliance gap: every supplier is owed a certificate for what we withheld. */
  missingCertificates: number;
}

/**
 * Build the WHT return for one Ethiopian month, grouped by supplier.
 *
 * Grouping matters because the certificate we owe each subcontractor covers
 * everything withheld from them in the period, not each voucher separately —
 * and a supplier who cannot produce their certificate cannot claim the credit.
 */
export function buildWhtReturn(periodEc: string, rows: readonly WhtReturnRow[]): WhtReturn {
  const withheld = rows.filter(
    // Same rule on the withholding side: declared once authorised, not once
    // requested.
    (r) => (r.status === 'approved' || r.status === 'paid') && r.whtSantim > 0,
  );

  const groups = new Map<string, WhtReturnRow[]>();
  for (const row of withheld) {
    const existing = groups.get(row.subcontractorId);
    if (existing === undefined) groups.set(row.subcontractorId, [row]);
    else existing.push(row);
  }

  const bySupplier: WhtSupplierSummary[] = [...groups.values()].map((supplierRows) => {
    const first = supplierRows[0] as WhtReturnRow;
    const baseSantim = supplierRows.reduce((a, r) => a + r.whtBaseSantim, 0);
    const whtSantim = supplierRows.reduce((a, r) => a + r.whtSantim, 0);
    return {
      subcontractorId: first.subcontractorId,
      subcontractorName: first.subcontractorName,
      subcontractorTin: first.subcontractorTin,
      hasTin: first.subcontractorTin.trim() !== '',
      payments: supplierRows.length,
      baseSantim,
      whtSantim,
      effectiveRateBps: rateBps(whtSantim, baseSantim),
      missingCertificates: supplierRows.filter(
        (r) => r.certificateNo === undefined || r.certificateNo.trim() === '',
      ).length,
    };
  });

  bySupplier.sort((a, b) => b.whtSantim - a.whtSantim);

  return {
    periodEc,
    rows: [...withheld],
    bySupplier,
    totalBaseSantim: withheld.reduce((a, r) => a + r.whtBaseSantim, 0),
    totalWhtSantim: withheld.reduce((a, r) => a + r.whtSantim, 0),
    noTinPayments: withheld.filter((r) => r.whtRateBps === 3000).length,
    missingCertificates: bySupplier.reduce((a, s) => a + s.missingCertificates, 0),
  };
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/** The Ethiopian period key a document belongs to, from its own date. */
export function periodKeyFor(date: Date): string {
  return ethiopianPeriodKey(date);
}

/** `2025-12` — the Gregorian key, kept alongside for cross-checking a filing calendar. */
export function gregorianPeriodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** A one-line summary for the returns dashboard. */
export function describeVatReturn(vatReturn: VatReturn): string {
  if (vatReturn.payableSantim > 0) {
    return `${formatETB(vatReturn.payableSantim)} payable to ERCA for ${vatReturn.periodEc}.`;
  }
  if (vatReturn.creditCarriedForwardSantim > 0) {
    return `${formatETB(vatReturn.creditCarriedForwardSantim)} credit carried forward from ${vatReturn.periodEc}.`;
  }
  return `Nothing to pay or reclaim for ${vatReturn.periodEc}.`;
}
