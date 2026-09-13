import { describe, expect, it } from 'vitest';
import {
  assertRateValid,
  convert,
  exchangeDifference,
  formatConverted,
  formatMoney,
  formatRate,
  majorToMinor,
  nativeEtb,
  parseRate,
  RATE_SCALE,
  toBaseSantim,
} from '../currency.js';
import { addVat, computeDisbursement } from '../money.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const USD = (dollars: number) => majorToMinor(dollars, 'USD');
const ETB = (birr: number) => majorToMinor(birr, 'ETB');
/** 1 USD = 120.4567 ETB */
const RATE = 120_456_700;

describe('rate validity', () => {
  it('insists the base currency rate is exactly 1', () => {
    expect(() => assertRateValid(RATE_SCALE, 'ETB')).not.toThrow();
    expect(() => assertRateValid(RATE, 'ETB')).toThrow(/must be exactly 1/);
  });

  it('rejects a zero, negative or fractional-micro rate', () => {
    expect(() => assertRateValid(0, 'USD')).toThrow(/must be positive/);
    expect(() => assertRateValid(-RATE, 'USD')).toThrow(/must be positive/);
    expect(() => assertRateValid(120.5, 'USD')).toThrow(/integer number of micros/);
  });
});

describe('conversion to the base currency', () => {
  it('converts USD cents to ETB santim at an explicit rate', () => {
    // 45,000.00 USD at 120.4567 = 5,420,551.50 ETB
    expect(toBaseSantim({ amount: USD(45_000), currency: 'USD' }, RATE)).toBe(ETB(5_420_551.5));
  });

  it('is a no-op for an amount already in ETB', () => {
    expect(toBaseSantim({ amount: ETB(1_000_000), currency: 'ETB' }, RATE_SCALE)).toBe(ETB(1_000_000));
  });

  it('rounds to the santim, never leaving a fraction', () => {
    const converted = toBaseSantim({ amount: USD(1.01), currency: 'USD' }, RATE);
    expect(Number.isInteger(converted)).toBe(true);
    expect(converted).toBe(12_166); // 1.01 x 120.4567 = 121.66 ETB
  });

  it('handles a credit note the same way', () => {
    expect(toBaseSantim({ amount: -USD(1_000), currency: 'USD' }, RATE))
      .toBe(-toBaseSantim({ amount: USD(1_000), currency: 'USD' }, RATE));
  });

  it('refuses a float amount', () => {
    expect(() => toBaseSantim({ amount: 1234.5, currency: 'USD' }, RATE)).toThrow(/integer number of minor units/);
  });
});

describe('the stored shape keeps the rate with the amount', () => {
  it('records the original, the equivalent, the rate and its date', () => {
    const stored = convert(
      { amount: USD(45_000), currency: 'USD' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    expect(stored.currency).toBe('USD');
    expect(stored.amount).toBe(USD(45_000));
    expect(stored.baseAmountSantim).toBe(ETB(5_420_551.5));
    expect(stored.rateMicros).toBe(RATE);
    expect(stored.rateDate).toEqual(utc(2025, 9, 12));
    expect(stored.rateSource).toBe('NBE daily');
  });

  it('forces the rate to 1 for an ETB amount, whatever the caller passed', () => {
    const stored = convert(
      { amount: ETB(1_000_000), currency: 'ETB' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    expect(stored.rateMicros).toBe(RATE_SCALE);
    expect(stored.baseAmountSantim).toBe(ETB(1_000_000));
    expect(stored.rateSource).toBe('base currency');
  });

  it('gives a native ETB amount the same shape, so every document reads alike', () => {
    const stored = nativeEtb(ETB(500_000), utc(2025, 9, 12));
    expect(stored.baseAmountSantim).toBe(stored.amount);
    expect(stored.rateMicros).toBe(RATE_SCALE);
  });

  it('is reproducible: the stored figure never moves when the rate does', () => {
    // The birr floats. A report that re-converted at today's rate would
    // silently rewrite a VAT return you already filed.
    const booked = convert(
      { amount: USD(10_000), currency: 'USD' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    const laterRate = 135_000_000;
    // Nothing about the stored document depends on the later rate.
    expect(booked.baseAmountSantim).toBe(ETB(1_204_567));
    expect(toBaseSantim({ amount: booked.amount, currency: 'USD' }, laterRate)).not.toBe(booked.baseAmountSantim);
  });
});

describe('exchange differences', () => {
  const booked = convert(
    { amount: USD(10_000), currency: 'USD' },
    { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
  );

  it('reports a loss when the birr weakens before settlement', () => {
    const result = exchangeDifference(booked, 135_000_000);
    expect(result.settledBaseSantim).toBe(ETB(1_350_000));
    expect(result.differenceSantim).toBe(ETB(1_350_000) - ETB(1_204_567));
    expect(result.isGain).toBe(true); // more ETB is owed — a cost to us, a larger base
  });

  it('reports the opposite direction when the birr strengthens', () => {
    const result = exchangeDifference(booked, 110_000_000);
    expect(result.differenceSantim).toBeLessThan(0);
    expect(result.isGain).toBe(false);
  });

  it('is zero when nothing moved', () => {
    expect(exchangeDifference(booked, RATE).differenceSantim).toBe(0);
  });
});

describe('tax is computed on the ETB equivalent', () => {
  it('charges 15% VAT on the converted base, not the foreign amount', () => {
    const stored = convert(
      { amount: USD(45_000), currency: 'USD' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    const vat = addVat(stored.baseAmountSantim);
    expect(vat.netSantim).toBe(ETB(5_420_551.5));
    expect(vat.vatSantim).toBe(ETB(813_082.73)); // 15% of the ETB figure
    expect(vat.netSantim + vat.vatSantim).toBe(vat.grossSantim);
  });

  it('withholds on the ETB equivalent of a USD subcontractor invoice', () => {
    const stored = convert(
      { amount: USD(100_000), currency: 'USD' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    const payout = computeDisbursement({
      netSantim: stored.baseAmountSantim,
      category: 'services',
      supplierVatRegistered: true,
      supplierHasTin: true,
    });
    // WHT base is the ETB equivalent of the net, never the gross and never USD.
    expect(payout.whtBaseSantim).toBe(stored.baseAmountSantim);
    expect(payout.whtSantim).toBe(Math.round(stored.baseAmountSantim * 0.03));
  });
});

describe('formatting', () => {
  it('labels the currency on every amount', () => {
    expect(formatMoney({ amount: USD(45_000), currency: 'USD' })).toBe('USD 45,000.00');
    expect(formatMoney({ amount: ETB(1_150_000), currency: 'ETB' })).toBe('ETB 1,150,000.00');
  });

  it('shows a foreign amount together with its ETB equivalent and rate', () => {
    // A USD figure alone invites comparison against an ETB figure on the next line.
    const stored = convert(
      { amount: USD(45_000), currency: 'USD' },
      { rateMicros: RATE, rateDate: utc(2025, 9, 12), rateSource: 'NBE daily' },
    );
    expect(formatConverted(stored)).toBe('USD 45,000.00 (ETB 5,420,551.50 at 120.4567)');
  });

  it('does not clutter a native ETB amount with a rate', () => {
    expect(formatConverted(nativeEtb(ETB(1_000), utc(2025, 9, 12)))).toBe('ETB 1,000.00');
  });

  it('quotes rates to four decimals', () => {
    expect(formatRate(RATE)).toBe('120.4567');
    expect(formatRate(RATE_SCALE)).toBe('1.0000');
  });
});

describe('rate parsing', () => {
  it('accepts what a bank quotes', () => {
    expect(parseRate('120.4567')).toBe(120_456_700);
    expect(parseRate('57')).toBe(57_000_000);
    expect(parseRate(' 1,234.56 ')).toBe(1_234_560_000);
  });

  it('rejects nonsense and non-positive rates', () => {
    expect(parseRate('abc')).toBeNull();
    expect(parseRate('')).toBeNull();
    expect(parseRate('-5')).toBeNull();
    expect(parseRate('0')).toBeNull();
  });
});
