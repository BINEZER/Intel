import { describe, expect, it } from 'vitest';
import { computeRollup } from '../rollup.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;

const contract = { valueNetSantim: ETB(4_200_000), vatSantim: ETB(630_000), valueGrossSantim: ETB(4_830_000) };

const invoice = (
  netSantim: number,
  receipts: { amountGrossSantim: number; clientWhtSantim: number }[] = [],
  status: 'draft' | 'issued' | 'paid' | 'void' = 'issued',
) => ({
  netSantim,
  grossSantim: netSantim + Math.round(netSantim * 0.15),
  status,
  receipts,
});

const voucher = (
  netSantim: number,
  vatRegistered: boolean,
  whtSantim: number,
  status: 'draft' | 'approved' | 'paid' | 'rejected' = 'paid',
) => {
  const supplierVatSantim = vatRegistered ? Math.round(netSantim * 0.15) : 0;
  const grossSantim = netSantim + supplierVatSantim;
  return {
    netSantim, supplierVatSantim, grossSantim,
    whtBaseSantim: netSantim, whtSantim,
    netPayableSantim: grossSantim - whtSantim,
    whtCategory: 'services' as const, whtRateBps: 300, vatRateBps: 1500, status,
  };
};

describe('project financial roll-up', () => {
  it('excludes drafts and voids from what has been billed', () => {
    const r = computeRollup(contract, [
      invoice(ETB(1_000_000)),
      invoice(ETB(500_000), [], 'draft'),
      invoice(ETB(300_000), [], 'void'),
    ], []);
    expect(r.invoicedNetSantim).toBe(ETB(1_000_000));
  });

  it('counts client withholding as settled but NOT as cash collected', () => {
    // The 2% is with ERCA against our income tax. It clears the debt without
    // ever reaching the bank, so collections and receivables must part ways.
    const gross = ETB(1_150_000);
    const r = computeRollup(contract, [
      invoice(ETB(1_000_000), [{ amountGrossSantim: gross - ETB(20_000), clientWhtSantim: ETB(20_000) }]),
    ], []);
    expect(r.collectedGrossSantim).toBe(ETB(1_130_000));
    expect(r.outstandingGrossSantim).toBe(0); // settled, not owed
  });

  it('leaves a genuine unpaid balance outstanding', () => {
    const r = computeRollup(contract, [
      invoice(ETB(1_000_000), [{ amountGrossSantim: ETB(500_000), clientWhtSantim: 0 }]),
    ], []);
    expect(r.outstandingGrossSantim).toBe(ETB(650_000));
  });

  it('counts only approved or paid vouchers as committed cost', () => {
    const r = computeRollup(contract, [], [
      voucher(ETB(300_000), true, ETB(9_000), 'paid'),
      voucher(ETB(200_000), true, ETB(6_000), 'approved'),
      voucher(ETB(900_000), true, ETB(27_000), 'draft'),
      voucher(ETB(400_000), true, ETB(12_000), 'rejected'),
    ]);
    expect(r.subcontractCostNetSantim).toBe(ETB(500_000));
  });

  it('excludes VAT from margin on both sides', () => {
    const r = computeRollup(contract, [], [voucher(ETB(2_900_000), true, ETB(87_000))]);
    expect(r.grossMarginSantim).toBe(ETB(1_300_000)); // 4,200,000 net less 2,900,000 net
    expect(r.grossMarginBps).toBe(3095);
  });

  it('nets input VAT against output VAT', () => {
    const r = computeRollup(contract, [], [voucher(ETB(1_000_000), true, ETB(30_000))]);
    expect(r.subcontractInputVatSantim).toBe(ETB(150_000));
    expect(r.netVatPayableSantim).toBe(ETB(630_000) - ETB(150_000));
  });

  it('tracks WHT withheld and the cash that actually left the bank', () => {
    const r = computeRollup(contract, [], [
      voucher(ETB(100_000), true, ETB(3_000)),
      voucher(ETB(200_000), false, ETB(6_000)),
    ]);
    expect(r.whtWithheldSantim).toBe(ETB(9_000));
    // 115,000 - 3,000 paid, plus 200,000 - 6,000 for the non-VAT-registered sub.
    expect(r.cashDisbursedSantim).toBe(ETB(112_000) + ETB(194_000));
  });

  it('handles a project with no contract yet', () => {
    const r = computeRollup(null, [], []);
    expect(r.contractNetSantim).toBe(0);
    expect(r.grossMarginBps).toBe(0);
  });
});
