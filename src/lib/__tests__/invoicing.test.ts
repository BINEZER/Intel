import { describe, expect, it } from 'vitest';
import {
  ageBucket,
  ageReceivables,
  deriveInvoiceStatus,
  formatInvoiceNo,
  settle,
  totalInvoice,
} from '../invoicing.js';
import { birrToSantim } from '../money.js';

const ETB = birrToSantim;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2025, 9, 12);

describe('line totals', () => {
  it('applies 15% to a standard-rated line', () => {
    const t = totalInvoice([{ description: 'Lift', qty: 1, unitNetSantim: ETB(1_000_000) }]);
    expect(t.netSantim).toBe(ETB(1_000_000));
    expect(t.vatSantim).toBe(ETB(150_000));
    expect(t.grossSantim).toBe(ETB(1_150_000));
    expect(t.mixedRates).toBe(false);
  });

  it('multiplies quantity by unit price', () => {
    const t = totalInvoice([{ description: 'Lifts', qty: 3, unitNetSantim: ETB(400_000) }]);
    expect(t.netSantim).toBe(ETB(1_200_000));
  });

  it('sums VAT PER LINE so a zero-rated line is not taxed', () => {
    // Applying 15% to the invoice total would overstate the VAT by 30,000.
    const t = totalInvoice([
      { description: 'Installation', qty: 1, unitNetSantim: ETB(1_000_000) },
      { description: 'Exempt supply', qty: 1, unitNetSantim: ETB(200_000), vatRateBps: 0 },
    ]);
    expect(t.netSantim).toBe(ETB(1_200_000));
    expect(t.vatSantim).toBe(ETB(150_000)); // not 180,000
    expect(t.grossSantim).toBe(ETB(1_350_000));
    expect(t.mixedRates).toBe(true);
    expect(t.vatRateBps).toBeNull();
  });

  it('keeps every line internally consistent', () => {
    const t = totalInvoice([
      { description: 'A', qty: 1.5, unitNetSantim: ETB(333.33) },
      { description: 'B', qty: 7, unitNetSantim: ETB(99.99) },
    ]);
    for (const line of t.lines) {
      expect(line.lineGrossSantim).toBe(line.lineNetSantim + line.lineVatSantim);
    }
    expect(t.netSantim).toBe(t.lines.reduce((a, l) => a + l.lineNetSantim, 0));
    expect(t.grossSantim).toBe(t.netSantim + t.vatSantim);
  });

  it('reports the single rate when every line agrees', () => {
    const t = totalInvoice([
      { description: 'A', qty: 1, unitNetSantim: ETB(100) },
      { description: 'B', qty: 1, unitNetSantim: ETB(200) },
    ]);
    expect(t.vatRateBps).toBe(1500);
  });

  it('handles an empty invoice without dividing by anything', () => {
    const t = totalInvoice([]);
    expect(t.netSantim).toBe(0);
    expect(t.vatSantim).toBe(0);
    expect(t.mixedRates).toBe(false);
  });
});

describe('settlement', () => {
  const gross = ETB(1_150_000);

  it('clears an invoice paid in full', () => {
    const s = settle(gross, [{ amountGrossSantim: gross, clientWhtSantim: 0 }]);
    expect(s.balanceSantim).toBe(0);
    expect(s.fullySettled).toBe(true);
  });

  it('treats an invoice paid net of CLIENT withholding as SETTLED, not part paid', () => {
    // Client withholds 2% of the net and remits the rest. The withheld amount is
    // with ERCA against our income tax — it is not a receivable, and chasing it
    // would mean pursuing money nobody owes, forever.
    const wht = ETB(20_000);
    const s = settle(gross, [{ amountGrossSantim: gross - wht, clientWhtSantim: wht }]);
    expect(s.paidGrossSantim).toBe(ETB(1_130_000));
    expect(s.clientWhtSantim).toBe(wht);
    expect(s.settledSantim).toBe(gross);
    expect(s.balanceSantim).toBe(0);
    expect(s.fullySettled).toBe(true);
  });

  it('reports a genuine part payment', () => {
    const s = settle(gross, [{ amountGrossSantim: ETB(500_000), clientWhtSantim: 0 }]);
    expect(s.balanceSantim).toBe(ETB(650_000));
    expect(s.fullySettled).toBe(false);
  });

  it('adds up several receipts', () => {
    const s = settle(gross, [
      { amountGrossSantim: ETB(500_000), clientWhtSantim: 0 },
      { amountGrossSantim: ETB(630_000), clientWhtSantim: ETB(20_000) },
    ]);
    expect(s.fullySettled).toBe(true);
    expect(s.balanceSantim).toBe(0);
  });

  it('surfaces an overpayment rather than hiding it in a clamp', () => {
    const s = settle(gross, [{ amountGrossSantim: ETB(1_200_000), clientWhtSantim: 0 }]);
    expect(s.balanceSantim).toBe(0);
    expect(s.overpaidSantim).toBe(ETB(50_000));
  });

  it('handles an invoice with no receipts', () => {
    const s = settle(gross, []);
    expect(s.balanceSantim).toBe(gross);
    expect(s.settledSantim).toBe(0);
  });
});

describe('status derivation', () => {
  const gross = ETB(100_000);
  const due = utc(2025, 9, 1);

  it('marks a fully settled invoice paid', () => {
    const s = settle(gross, [{ amountGrossSantim: gross, clientWhtSantim: 0 }]);
    expect(deriveInvoiceStatus('issued', s, due, NOW)).toBe('paid');
  });

  it('marks an unpaid invoice past its due date overdue', () => {
    expect(deriveInvoiceStatus('issued', settle(gross, []), due, NOW)).toBe('overdue');
  });

  it('leaves an unpaid invoice inside terms as issued', () => {
    expect(deriveInvoiceStatus('issued', settle(gross, []), utc(2025, 10, 1), NOW)).toBe('issued');
  });

  it('marks a part-paid invoice partially paid even when overdue', () => {
    const s = settle(gross, [{ amountGrossSantim: ETB(40_000), clientWhtSantim: 0 }]);
    expect(deriveInvoiceStatus('issued', s, due, NOW)).toBe('partially_paid');
  });

  it('never derives away a draft or a void', () => {
    const s = settle(gross, [{ amountGrossSantim: gross, clientWhtSantim: 0 }]);
    expect(deriveInvoiceStatus('draft', s, due, NOW)).toBe('draft');
    expect(deriveInvoiceStatus('void', s, due, NOW)).toBe('void');
  });
});

describe('ageing', () => {
  it('buckets by days past due', () => {
    expect(ageBucket(utc(2025, 10, 1), NOW)).toBe('current');
    expect(ageBucket(utc(2025, 9, 1), NOW)).toBe('1_30');
    expect(ageBucket(utc(2025, 8, 1), NOW)).toBe('31_60');
    expect(ageBucket(utc(2025, 7, 1), NOW)).toBe('61_90');
    expect(ageBucket(utc(2025, 4, 1), NOW)).toBe('over_90');
  });

  const invoice = (
    id: string, dueDate: Date, grossSantim: number,
    receipts: { amountGrossSantim: number; clientWhtSantim: number }[] = [],
    status: 'issued' | 'draft' | 'void' = 'issued',
  ) => ({ id, invoiceNo: id, clientName: 'Acme', dueDate, grossSantim, receipts, status });

  it('totals outstanding debt by bucket', () => {
    const report = ageReceivables(
      [
        invoice('a', utc(2025, 10, 1), ETB(100_000)),
        invoice('b', utc(2025, 9, 1), ETB(200_000)),
        invoice('c', utc(2025, 4, 1), ETB(300_000)),
      ],
      NOW,
    );
    expect(report.byBucket.current).toBe(ETB(100_000));
    expect(report.byBucket['1_30']).toBe(ETB(200_000));
    expect(report.byBucket.over_90).toBe(ETB(300_000));
    expect(report.totalSantim).toBe(ETB(600_000));
    expect(report.overdueSantim).toBe(ETB(500_000));
    expect(report.over90Bps).toBe(5000);
  });

  it('excludes drafts and voids — neither is a debt', () => {
    const report = ageReceivables(
      [
        invoice('a', utc(2025, 8, 1), ETB(100_000), [], 'draft'),
        invoice('b', utc(2025, 8, 1), ETB(100_000), [], 'void'),
      ],
      NOW,
    );
    expect(report.totalSantim).toBe(0);
    expect(report.rows).toEqual([]);
  });

  it('excludes an invoice settled by client withholding', () => {
    const report = ageReceivables(
      [invoice('a', utc(2025, 6, 1), ETB(100_000), [
        { amountGrossSantim: ETB(98_000), clientWhtSantim: ETB(2_000) },
      ])],
      NOW,
    );
    expect(report.totalSantim).toBe(0);
  });

  it('ages only the unpaid balance of a part-paid invoice', () => {
    const report = ageReceivables(
      [invoice('a', utc(2025, 8, 1), ETB(100_000), [
        { amountGrossSantim: ETB(60_000), clientWhtSantim: 0 },
      ])],
      NOW,
    );
    expect(report.totalSantim).toBe(ETB(40_000));
  });

  it('leads with the oldest debt', () => {
    const report = ageReceivables(
      [
        invoice('recent', utc(2025, 9, 1), ETB(100_000)),
        invoice('ancient', utc(2025, 2, 1), ETB(50_000)),
      ],
      NOW,
    );
    expect(report.rows[0]!.invoiceId).toBe('ancient');
  });

  it('returns null rather than 0% over-90 when nothing is outstanding', () => {
    expect(ageReceivables([], NOW).over90Bps).toBeNull();
  });
});

describe('invoice numbering', () => {
  it('zero-pads a sequential number', () => {
    expect(formatInvoiceNo('INV', 1)).toBe('INV-00001');
    expect(formatInvoiceNo('INV', 4321)).toBe('INV-04321');
  });

  it('does not truncate past the pad width', () => {
    expect(formatInvoiceNo('INV', 123456)).toBe('INV-123456');
  });

  it('rejects a non-positive sequence', () => {
    expect(() => formatInvoiceNo('INV', 0)).toThrow(/positive integer/);
  });
});
