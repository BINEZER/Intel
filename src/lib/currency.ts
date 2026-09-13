/**
 * Multi-currency support.
 *
 * IntelMotion buys lifts abroad and sells them in Addis, so supplier invoices
 * arrive in USD while VAT, WHT and every return are declared in ETB.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *   A foreign-currency document stores BOTH the original amount AND its ETB
 *   equivalent, together with the exact rate used and the date it applied.
 *   The ETB figure is the source of truth for tax; the original is the truth
 *   for the supplier relationship.
 *
 *   The rate is SNAPSHOTTED onto the document, never looked up at read time.
 *   The birr moves. If a report re-converted at today's rate, last quarter's
 *   filed VAT return would silently change every time you opened it — and the
 *   figure you filed would no longer be reproducible. This is the same
 *   principle already applied to VAT rates on contracts and SLAs on callouts.
 *
 * Amounts are integer minor units throughout: santim for ETB, cents for USD.
 * Rates are integer micros — ETB per 1 USD times 1,000,000 — so a rate of
 * 120.4567 is 120_456_700 and nothing is ever a float.
 */

export const CURRENCIES = ['ETB', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** The currency every tax obligation is declared in. */
export const BASE_CURRENCY: Currency = 'ETB';

export const CURRENCY_META: Record<Currency, { symbol: string; name: string; minorUnits: number }> = {
  ETB: { symbol: 'ETB', name: 'Ethiopian Birr', minorUnits: 100 },
  USD: { symbol: 'USD', name: 'US Dollar', minorUnits: 100 },
};

/** Micros per whole unit of rate. 1 USD = 120.4567 ETB -> 120_456_700. */
export const RATE_SCALE = 1_000_000;

export interface Money {
  /** Integer minor units — santim or cents. */
  amount: number;
  currency: Currency;
}

/**
 * A foreign-currency amount alongside its base-currency equivalent and the
 * rate that produced it. This is the shape every document stores.
 */
export interface ConvertedMoney {
  /** As invoiced by the counterparty. */
  currency: Currency;
  amount: number;
  /** ETB equivalent — what tax is computed on. */
  baseAmountSantim: number;
  /** ETB per 1 unit of `currency`, in micros. Exactly 1_000_000 for ETB itself. */
  rateMicros: number;
  /** The day the rate was taken, so the figure is reproducible. */
  rateDate: Date;
  /** Where the rate came from, for the audit trail. */
  rateSource: string;
}

export class CurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyError';
  }
}

function assertMinorUnits(amount: number, label: string): void {
  if (!Number.isInteger(amount)) {
    throw new CurrencyError(`${label} must be an integer number of minor units, got ${amount}`);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new CurrencyError(`${label} exceeds safe integer range: ${amount}`);
  }
}

export function assertRateValid(rateMicros: number, currency: Currency): void {
  if (!Number.isInteger(rateMicros)) {
    throw new CurrencyError(`Exchange rate must be an integer number of micros, got ${rateMicros}`);
  }
  if (currency === BASE_CURRENCY) {
    if (rateMicros !== RATE_SCALE) {
      throw new CurrencyError(`The rate for ${BASE_CURRENCY} must be exactly 1, got ${rateMicros / RATE_SCALE}`);
    }
    return;
  }
  if (rateMicros <= 0) {
    throw new CurrencyError(`Exchange rate must be positive, got ${rateMicros / RATE_SCALE}`);
  }
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

/**
 * Convert a foreign amount to ETB santim at an explicit rate.
 *
 * There is deliberately no default rate and no lookup. A caller that does not
 * know which rate applies has no business converting — the rate is a fact about
 * a specific day that must be recorded, not a convenience.
 */
export function toBaseSantim(money: Money, rateMicros: number): number {
  assertMinorUnits(money.amount, 'Amount');
  assertRateValid(rateMicros, money.currency);
  if (money.currency === BASE_CURRENCY) return money.amount;

  const sign = money.amount < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(money.amount) * rateMicros) / RATE_SCALE);
}

/** Build the stored shape from an amount, a rate, and the day it applied. */
export function convert(
  money: Money,
  rate: { rateMicros: number; rateDate: Date; rateSource: string },
): ConvertedMoney {
  const rateMicros = money.currency === BASE_CURRENCY ? RATE_SCALE : rate.rateMicros;
  assertRateValid(rateMicros, money.currency);

  return {
    currency: money.currency,
    amount: money.amount,
    baseAmountSantim: toBaseSantim(money, rateMicros),
    rateMicros,
    rateDate: rate.rateDate,
    rateSource: money.currency === BASE_CURRENCY ? 'base currency' : rate.rateSource,
  };
}

/** An ETB amount, in the same stored shape, so every document reads alike. */
export function nativeEtb(santim: number, asOf: Date): ConvertedMoney {
  assertMinorUnits(santim, 'Amount');
  return {
    currency: 'ETB',
    amount: santim,
    baseAmountSantim: santim,
    rateMicros: RATE_SCALE,
    rateDate: asOf,
    rateSource: 'base currency',
  };
}

/**
 * Re-convert an amount at a different rate, reporting the difference.
 *
 * Used when a payment settles at a rate other than the one the invoice was
 * booked at: the gap is a realised exchange gain or loss and belongs in the
 * accounts, not silently absorbed into the cost of the job.
 */
export function exchangeDifference(
  booked: ConvertedMoney,
  settlementRateMicros: number,
): { settledBaseSantim: number; differenceSantim: number; isGain: boolean } {
  assertRateValid(settlementRateMicros, booked.currency);
  const settledBaseSantim = toBaseSantim(
    { amount: booked.amount, currency: booked.currency },
    settlementRateMicros,
  );
  const differenceSantim = settledBaseSantim - booked.baseAmountSantim;
  return { settledBaseSantim, differenceSantim, isGain: differenceSantim > 0 };
}

// ---------------------------------------------------------------------------
// Parsing and formatting
// ---------------------------------------------------------------------------

export function majorToMinor(value: number, currency: Currency): number {
  if (!Number.isFinite(value)) throw new CurrencyError(`Amount must be finite, got ${value}`);
  return Math.round(value * CURRENCY_META[currency].minorUnits);
}

export function minorToMajor(amount: number, currency: Currency): number {
  assertMinorUnits(amount, 'Amount');
  return amount / CURRENCY_META[currency].minorUnits;
}

/** `USD 45,000.00` / `ETB 1,150,000.00`. */
export function formatMoney(money: Money, opts: { withSymbol?: boolean } = {}): string {
  assertMinorUnits(money.amount, 'Amount');
  const body = minorToMajor(money.amount, money.currency).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return opts.withSymbol === false ? body : `${CURRENCY_META[money.currency].symbol} ${body}`;
}

/** `120.4567` — rates carry four decimals, which is how banks quote them. */
export function formatRate(rateMicros: number): string {
  return (rateMicros / RATE_SCALE).toFixed(4);
}

export function parseRate(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) return null;
  const micros = Math.round(Number(cleaned) * RATE_SCALE);
  return micros > 0 ? micros : null;
}

/**
 * `USD 45,000.00 (ETB 5,420,551.50 at 120.4567)` — the dual rendering used
 * everywhere a foreign amount appears.
 *
 * Both figures are always shown together. A USD number alone invites someone to
 * compare it against an ETB number on the next line.
 */
export function formatConverted(value: ConvertedMoney): string {
  if (value.currency === BASE_CURRENCY) return formatMoney({ amount: value.amount, currency: 'ETB' });
  return (
    `${formatMoney({ amount: value.amount, currency: value.currency })} ` +
    `(${formatMoney({ amount: value.baseAmountSantim, currency: 'ETB' })} at ${formatRate(value.rateMicros)})`
  );
}
