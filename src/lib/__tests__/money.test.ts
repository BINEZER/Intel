import { describe, expect, it } from 'vitest';
import {
  addVat,
  applyBps,
  birrToSantim,
  computeDisbursement,
  extractVat,
  formatETB,
  rollUpProject,
  sumWithVat,
  VAT_RATE_BPS,
} from '../money.js';

const ETB = birrToSantim;

describe('santim discipline', () => {
  it('rejects float money', () => {
    expect(() => addVat(1234.56)).toThrow(/integer count of santim/);
  });

  it('survives the classic float trap', () => {
    // 0.1 + 0.2 !== 0.3 in floats; in santim it is exact.
    expect(ETB(0.1) + ETB(0.2)).toBe(ETB(0.3));
  });

  it('rounds bps half-up', () => {
    expect(applyBps(1_00, 1500)).toBe(15);   // 1.00 -> 0.15
    expect(applyBps(3, 1500)).toBe(0);       // 0.03 -> 0.0045 -> 0.00
    expect(applyBps(34, 1500)).toBe(5);      // 0.34 -> 0.0051 -> 0.01... rounds to 5 santim
  });
});

describe('15% VAT on revenue', () => {
  it('adds VAT to a contract value', () => {
    const v = addVat(ETB(1_000_000));
    expect(v.vatRateBps).toBe(VAT_RATE_BPS);
    expect(v.vatSantim).toBe(ETB(150_000));
    expect(v.grossSantim).toBe(ETB(1_150_000));
  });

  it('backs VAT out of an all-in negotiated price with no lost santim', () => {
    const v = extractVat(ETB(1_150_000));
    expect(v.netSantim).toBe(ETB(1_000_000));
    expect(v.vatSantim).toBe(ETB(150_000));
    expect(v.netSantim + v.vatSantim).toBe(v.grossSantim);
  });

  it('keeps net + vat === gross exactly for awkward inclusive amounts', () => {
    for (const gross of [ETB(1), ETB(99.99), ETB(100_000.01), ETB(7_777_777.77)]) {
      const v = extractVat(gross);
      expect(v.netSantim + v.vatSantim).toBe(gross);
    }
  });

  it('applies VAT once to a multi-line total', () => {
    const v = sumWithVat([ETB(400_000), ETB(350_000), ETB(250_000)]);
    expect(v.netSantim).toBe(ETB(1_000_000));
    expect(v.grossSantim).toBe(ETB(1_150_000));
  });

  it('formats ETB with two decimals', () => {
    expect(formatETB(ETB(1_150_000))).toBe('ETB 1,150,000.00');
  });
});

describe('subcontractor WHT', () => {
  const base = { supplierVatRegistered: true, supplierHasTin: true } as const;

  it('withholds 3% on services, computed on the VAT-exclusive base', () => {
    const d = computeDisbursement({ ...base, netSantim: ETB(100_000), category: 'services' });
    expect(d.supplierVatSantim).toBe(ETB(15_000));
    expect(d.grossSantim).toBe(ETB(115_000));
    expect(d.whtBaseSantim).toBe(ETB(100_000)); // NOT 115,000
    expect(d.whtSantim).toBe(ETB(3_000));
    expect(d.netPayableSantim).toBe(ETB(112_000));
  });

  it('withholds 2% on goods', () => {
    const d = computeDisbursement({ ...base, netSantim: ETB(100_000), category: 'goods' });
    expect(d.whtSantim).toBe(ETB(2_000));
    expect(d.netPayableSantim).toBe(ETB(113_000));
  });

  it('applies the 30% penalty rate when the supplier has no TIN', () => {
    const d = computeDisbursement({
      ...base, supplierHasTin: false, netSantim: ETB(100_000), category: 'services',
    });
    expect(d.whtRateBps).toBe(3000);
    expect(d.whtSantim).toBe(ETB(30_000));
  });

  it('charges no input VAT when the subcontractor is not VAT-registered', () => {
    const d = computeDisbursement({
      ...base, supplierVatRegistered: false, netSantim: ETB(100_000), category: 'services',
    });
    expect(d.supplierVatSantim).toBe(0);
    expect(d.grossSantim).toBe(ETB(100_000));
    expect(d.netPayableSantim).toBe(ETB(97_000));
  });

  it('skips WHT below the per-transaction threshold', () => {
    const goods = computeDisbursement({ ...base, netSantim: ETB(9_000), category: 'goods' });
    expect(goods.whtSantim).toBe(0);
    expect(goods.whtExemptReason).toBe('below_threshold');

    const services = computeDisbursement({ ...base, netSantim: ETB(2_500), category: 'services' });
    expect(services.whtSantim).toBe(0);

    // Services threshold is lower, so the same amount IS withheld on services.
    const atGoodsThreshold = computeDisbursement({ ...base, netSantim: ETB(9_000), category: 'services' });
    expect(atGoodsThreshold.whtSantim).toBe(ETB(270));
  });

  it('honours a rate negotiated in the subcontract', () => {
    const d = computeDisbursement({
      ...base, netSantim: ETB(100_000), category: 'services', overrideWhtRateBps: 500,
    });
    expect(d.whtSantim).toBe(ETB(5_000));
  });

  it('never withholds on an exempt category', () => {
    const d = computeDisbursement({ ...base, netSantim: ETB(500_000), category: 'exempt' });
    expect(d.whtSantim).toBe(0);
    expect(d.whtExemptReason).toBe('category_exempt');
  });
});

describe('project rollup', () => {
  it('excludes VAT from margin and nets output VAT against input VAT', () => {
    const contract = addVat(ETB(1_000_000));
    const disbursements = [
      computeDisbursement({ netSantim: ETB(300_000), category: 'services', supplierVatRegistered: true, supplierHasTin: true }),
      computeDisbursement({ netSantim: ETB(200_000), category: 'goods', supplierVatRegistered: false, supplierHasTin: true }),
    ];
    const r = rollUpProject(contract, disbursements);

    expect(r.subcontractCostNetSantim).toBe(ETB(500_000));
    expect(r.grossMarginSantim).toBe(ETB(500_000));
    expect(r.grossMarginBps).toBe(5000); // 50%
    expect(r.whtWithheldSantim).toBe(ETB(9_000) + ETB(4_000));
    expect(r.subcontractInputVatSantim).toBe(ETB(45_000));
    expect(r.netVatPayableSantim).toBe(ETB(150_000) - ETB(45_000));
    // Cash out reconciles: gross invoices less everything withheld.
    expect(r.cashDisbursedSantim).toBe(ETB(345_000) - ETB(9_000) + ETB(200_000) - ETB(4_000));
  });

  it('does not divide by zero on a valueless contract', () => {
    expect(rollUpProject(addVat(0), []).grossMarginBps).toBe(0);
  });
});
