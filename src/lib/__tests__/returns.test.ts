import { describe, expect, it } from 'vitest';
import {
  buildVatReturn,
  buildWhtReturn,
  describeVatReturn,
  gregorianPeriodKey,
  periodKeyFor,
  type VatReturnDisbursement,
  type VatReturnInvoice,
  type WhtReturnRow,
} from '../returns.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;

const invoice = (over: Partial<VatReturnInvoice> = {}): VatReturnInvoice => ({
  invoiceNo: 'INV-00001', clientName: 'Acme', clientTin: '001',
  netSantim: ETB(1_000_000), vatSantim: ETB(150_000), status: 'issued', ...over,
});

const purchase = (over: Partial<VatReturnDisbursement> = {}): VatReturnDisbursement => ({
  voucherNo: 'V-1', subcontractorName: 'Sub', subcontractorTin: '002',
  netSantim: ETB(400_000), supplierVatSantim: ETB(60_000), status: 'paid', ...over,
});

describe('VAT return', () => {
  it('nets input VAT against output VAT', () => {
    const r = buildVatReturn('EC-2018-01', [invoice()], [purchase()]);
    expect(r.outputVatSantim).toBe(ETB(150_000));
    expect(r.inputVatSantim).toBe(ETB(60_000));
    expect(r.netVatSantim).toBe(ETB(90_000));
    expect(r.payableSantim).toBe(ETB(90_000));
    expect(r.creditCarriedForwardSantim).toBe(0);
  });

  it('declares on issue, NOT on payment', () => {
    // An invoice issued this month is declared this month whether or not the
    // client has paid. Filtering on payment understates the liability.
    const unpaid = buildVatReturn('EC-2018-01', [invoice({ status: 'overdue' })], []);
    const paid = buildVatReturn('EC-2018-01', [invoice({ status: 'paid' })], []);
    expect(unpaid.outputVatSantim).toBe(paid.outputVatSantim);
  });

  it('carries a credit forward when input exceeds output', () => {
    const r = buildVatReturn('EC-2018-01', [invoice({ vatSantim: ETB(10_000), netSantim: ETB(66_667) })], [purchase()]);
    expect(r.payableSantim).toBe(0);
    expect(r.creditCarriedForwardSantim).toBe(ETB(50_000));
    expect(describeVatReturn(r)).toContain('credit carried forward');
  });

  it('excludes drafts and voids but COUNTS them', () => {
    // A missing invoice should be a number to investigate, not a silent absence.
    const r = buildVatReturn(
      'EC-2018-01',
      [invoice(), invoice({ invoiceNo: 'INV-2', status: 'draft' }), invoice({ invoiceNo: 'INV-3', status: 'void' })],
      [],
    );
    expect(r.invoiceCount).toBe(1);
    expect(r.outputVatSantim).toBe(ETB(150_000));
    expect(r.excludedDrafts).toBe(1);
    expect(r.excludedVoids).toBe(1);
  });

  it('claims input VAT only on approved or paid purchases', () => {
    const r = buildVatReturn('EC-2018-01', [], [
      purchase({ status: 'paid' }),
      purchase({ voucherNo: 'V-2', status: 'approved' }),
      purchase({ voucherNo: 'V-3', status: 'draft' }),
      purchase({ voucherNo: 'V-4', status: 'rejected' }),
    ]);
    expect(r.disbursementCount).toBe(2);
    expect(r.inputVatSantim).toBe(ETB(120_000));
  });

  it('handles an empty period', () => {
    const r = buildVatReturn('EC-2018-01', [], []);
    expect(r.payableSantim).toBe(0);
    expect(r.creditCarriedForwardSantim).toBe(0);
    expect(describeVatReturn(r)).toContain('Nothing to pay');
  });
});

describe('WHT return', () => {
  const row = (over: Partial<WhtReturnRow> = {}): WhtReturnRow => ({
    voucherNo: 'V-1', subcontractorId: 's1', subcontractorName: 'Alpha Civil',
    subcontractorTin: '002', whtCategory: 'services', whtRateBps: 300,
    whtBaseSantim: ETB(100_000), whtSantim: ETB(3_000),
    certificateNo: 'WHT-1', status: 'paid', ...over,
  });

  it('totals what was withheld', () => {
    const r = buildWhtReturn('EC-2018-01', [row(), row({ voucherNo: 'V-2' })]);
    expect(r.totalBaseSantim).toBe(ETB(200_000));
    expect(r.totalWhtSantim).toBe(ETB(6_000));
  });

  it('groups by supplier, because the certificate covers the period not the voucher', () => {
    const r = buildWhtReturn('EC-2018-01', [
      row({ voucherNo: 'V-1' }),
      row({ voucherNo: 'V-2', whtBaseSantim: ETB(50_000), whtSantim: ETB(1_500) }),
      row({ voucherNo: 'V-3', subcontractorId: 's2', subcontractorName: 'Beta Electrical',
            whtCategory: 'goods', whtRateBps: 200, whtBaseSantim: ETB(300_000), whtSantim: ETB(6_000) }),
    ]);
    expect(r.bySupplier).toHaveLength(2);
    // Sorted by amount withheld, largest first.
    expect(r.bySupplier[0]!.subcontractorName).toBe('Beta Electrical');
    const alpha = r.bySupplier.find((s) => s.subcontractorId === 's1');
    expect(alpha!.payments).toBe(2);
    expect(alpha!.whtSantim).toBe(ETB(4_500));
    expect(alpha!.effectiveRateBps).toBe(300);
  });

  it('exposes a blended effective rate when a supplier billed both goods and services', () => {
    const r = buildWhtReturn('EC-2018-01', [
      row({ whtCategory: 'services', whtRateBps: 300, whtBaseSantim: ETB(100_000), whtSantim: ETB(3_000) }),
      row({ voucherNo: 'V-2', whtCategory: 'goods', whtRateBps: 200, whtBaseSantim: ETB(100_000), whtSantim: ETB(2_000) }),
    ]);
    expect(r.bySupplier[0]!.effectiveRateBps).toBe(250);
  });

  it('counts payments that hit the no-TIN penalty rate', () => {
    const r = buildWhtReturn('EC-2018-01', [
      row(),
      row({ voucherNo: 'V-2', subcontractorId: 's9', subcontractorTin: '',
            whtRateBps: 3000, whtSantim: ETB(30_000) }),
    ]);
    expect(r.noTinPayments).toBe(1);
    expect(r.bySupplier.find((s) => s.subcontractorId === 's9')!.hasTin).toBe(false);
  });

  it('flags payments with no certificate issued to the supplier', () => {
    // A supplier who cannot produce their certificate cannot claim the credit.
    const r = buildWhtReturn('EC-2018-01', [
      row({ certificateNo: 'WHT-1' }),
      row({ voucherNo: 'V-2', certificateNo: undefined }),
      row({ voucherNo: 'V-3', certificateNo: '  ' }),
    ]);
    expect(r.missingCertificates).toBe(2);
  });

  it('excludes drafts, rejections and zero-WHT payments', () => {
    const r = buildWhtReturn('EC-2018-01', [
      row({ status: 'draft' }),
      row({ voucherNo: 'V-2', status: 'rejected' }),
      row({ voucherNo: 'V-3', whtCategory: 'exempt', whtRateBps: 0, whtSantim: 0 }),
    ]);
    expect(r.rows).toEqual([]);
    expect(r.totalWhtSantim).toBe(0);
    expect(r.bySupplier).toEqual([]);
  });
});

describe('period keys', () => {
  it('keys on the Ethiopian month', () => {
    expect(periodKeyFor(new Date(Date.UTC(2025, 8, 11)))).toBe('EC-2018-01');
  });

  it('keeps a Gregorian key for cross-checking the filing calendar', () => {
    expect(gregorianPeriodKey(new Date(Date.UTC(2025, 8, 11)))).toBe('2025-09');
    expect(gregorianPeriodKey(new Date(Date.UTC(2025, 11, 1)))).toBe('2025-12');
  });
});
