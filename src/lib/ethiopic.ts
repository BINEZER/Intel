/**
 * Ethiopian (Ge'ez) <-> Gregorian calendar conversion.
 *
 * DESIGN RULE FOR THIS CODEBASE:
 *   Firestore is ALWAYS Gregorian. Every stored instant is a UTC `Timestamp`.
 *   The Ethiopian date is derived for display, and denormalized alongside the
 *   timestamp only so we can filter/report by Ethiopian fiscal year without
 *   recomputing across the whole collection.
 *
 * Conversion goes through the Julian Day Number (JDN), which both calendars
 * map onto exactly, so there is no drift and no floating point anywhere.
 *
 * Reference anchor: 1 Meskerem 2013 EC == 11 September 2020 GC (JDN 2459104).
 */

/** JDN of the Amete Mihret (Year of Mercy) epoch used by the civil Ethiopian calendar. */
const JDN_EPOCH_AMETE_MIHRET = 1723856;

/** JDN of 1970-01-01, the Unix epoch. Lets us cross to/from JS `Date` exactly. */
const JDN_UNIX_EPOCH = 2440588;

const MS_PER_DAY = 86_400_000;

export const ETHIOPIAN_MONTHS = [
  'Meskerem', 'Tikimt', 'Hidar', 'Tahsas', 'Tir', 'Yekatit',
  'Megabit', 'Miyazya', 'Ginbot', 'Sene', 'Hamle', 'Nehase', 'Pagume',
] as const;

export const ETHIOPIAN_MONTHS_AM = [
  'መስከረም', 'ጥቅምት', 'ኅዳር', 'ታኅሣሥ', 'ጥር', 'የካቲት',
  'መጋቢት', 'ሚያዝያ', 'ግንቦት', 'ሰኔ', 'ሐምሌ', 'ነሐሴ', 'ጳጉሜን',
] as const;

/** A calendar date with no time component and no timezone. */
export interface EthiopianDate {
  /** Amete Mihret year, e.g. 2018. */
  year: number;
  /** 1 = Meskerem ... 13 = Pagume. */
  month: number;
  /** 1-30, or 1-5 (1-6 in a leap year) for Pagume. */
  day: number;
}

export interface GregorianDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
}

/**
 * Ethiopian leap years fall on year % 4 === 3 — the year immediately BEFORE a
 * Gregorian leap year — which is why Ethiopian New Year slides between
 * 11 and 12 September.
 */
export function isEthiopianLeapYear(year: number): boolean {
  return mod(year, 4) === 3;
}

/** Days in an Ethiopian month: 30 for months 1-12, 5 or 6 for Pagume. */
export function ethiopianMonthLength(year: number, month: number): number {
  assertInt(month, 'month');
  if (month < 1 || month > 13) throw new RangeError(`Ethiopian month out of range: ${month}`);
  if (month === 13) return isEthiopianLeapYear(year) ? 6 : 5;
  return 30;
}

export function isValidEthiopianDate(d: EthiopianDate): boolean {
  if (!Number.isInteger(d.year) || !Number.isInteger(d.month) || !Number.isInteger(d.day)) return false;
  if (d.month < 1 || d.month > 13) return false;
  if (d.day < 1) return false;
  return d.day <= ethiopianMonthLength(d.year, d.month);
}

// ---------------------------------------------------------------------------
// JDN core
// ---------------------------------------------------------------------------

export function ethiopianToJDN(d: EthiopianDate): number {
  if (!isValidEthiopianDate(d)) {
    throw new RangeError(
      `Invalid Ethiopian date ${d.year}-${d.month}-${d.day} ` +
        `(Pagume has ${isEthiopianLeapYear(d.year) ? 6 : 5} days in ${d.year})`,
    );
  }
  return (
    JDN_EPOCH_AMETE_MIHRET + 365 + 365 * (d.year - 1) + Math.floor(d.year / 4) + 30 * d.month + d.day - 31
  );
}

export function jdnToEthiopian(jdn: number): EthiopianDate {
  assertInt(jdn, 'jdn');
  const offset = jdn - JDN_EPOCH_AMETE_MIHRET;
  const cycle = Math.floor(offset / 1461); // 4-year cycle: 3 common + 1 leap
  const r = offset - cycle * 1461;
  const n = mod(r, 365) + 365 * Math.floor(r / 1460);
  return {
    year: 4 * cycle + Math.floor(r / 365) - Math.floor(r / 1460),
    month: Math.floor(n / 30) + 1,
    day: mod(n, 30) + 1,
  };
}

export function gregorianToJDN(d: GregorianDate): number {
  const a = Math.floor((14 - d.month) / 12);
  const y = d.year + 4800 - a;
  const m = d.month + 12 * a - 3;
  return (
    d.day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

export function jdnToGregorian(jdn: number): GregorianDate {
  const utcMs = (jdn - JDN_UNIX_EPOCH) * MS_PER_DAY;
  const dt = new Date(utcMs);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

// ---------------------------------------------------------------------------
// Public conversion surface
// ---------------------------------------------------------------------------

export function ethiopianToGregorian(d: EthiopianDate): GregorianDate {
  return jdnToGregorian(ethiopianToJDN(d));
}

export function gregorianToEthiopian(d: GregorianDate): EthiopianDate {
  return jdnToEthiopian(gregorianToJDN(d));
}

/**
 * Convert an Ethiopian calendar date to the UTC instant we persist in Firestore.
 * Anchored at 00:00 UTC so the stored day never shifts when read back.
 */
export function ethiopianToUTCDate(d: EthiopianDate): Date {
  return new Date((ethiopianToJDN(d) - JDN_UNIX_EPOCH) * MS_PER_DAY);
}

/** Read a stored (UTC) instant back as an Ethiopian calendar date. */
export function utcDateToEthiopian(date: Date): EthiopianDate {
  const jdn = Math.floor(date.getTime() / MS_PER_DAY) + JDN_UNIX_EPOCH;
  return jdnToEthiopian(jdn);
}

// ---------------------------------------------------------------------------
// Fiscal year
// ---------------------------------------------------------------------------

/**
 * The Ethiopian fiscal year runs 1 Hamle (month 11) to 30 Sene (month 10) and
 * is named for the year it ENDS in — the basis for ERCA annual filing.
 * A date in Hamle 2017 EC therefore belongs to fiscal year 2018.
 */
export function ethiopianFiscalYear(d: EthiopianDate): number {
  return d.month >= 11 ? d.year + 1 : d.year;
}

/** VAT return period key for a stored instant: `EC-<year>-<month>`, e.g. `EC-2018-03`. */
export function ethiopianPeriodKey(date: Date): string {
  const ec = utcDateToEthiopian(date);
  return `EC-${ec.year}-${String(ec.month).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatEthiopian(d: EthiopianDate, opts: { script?: 'latin' | 'amharic' } = {}): string {
  const names = opts.script === 'amharic' ? ETHIOPIAN_MONTHS_AM : ETHIOPIAN_MONTHS;
  const name = names[d.month - 1];
  if (name === undefined) throw new RangeError(`Ethiopian month out of range: ${d.month}`);
  return `${d.day} ${name} ${d.year}`;
}

const GREGORIAN_MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Gregorian short form, spelled out rather than delegated to `toLocaleDateString`.
 * ICU disagrees with itself across Node and browser versions ("Sep" vs "Sept"),
 * and this string lands on printed invoices, so it must not move.
 */
export function formatGregorianShort(date: Date): string {
  const name = GREGORIAN_MONTHS_SHORT[date.getUTCMonth()];
  return `${date.getUTCDate()} ${name} ${date.getUTCFullYear()}`;
}

/** `1 Meskerem 2018 EC (11 Sep 2025)` — the dual-calendar label used across the UI. */
export function formatDual(date: Date, opts: { script?: 'latin' | 'amharic' } = {}): string {
  const ec = utcDateToEthiopian(date);
  return `${formatEthiopian(ec, opts)} EC (${formatGregorianShort(date)})`;
}

// ---------------------------------------------------------------------------

/** Floored modulo — JS `%` keeps the sign of the dividend, which breaks pre-epoch dates. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function assertInt(n: number, label: string): void {
  if (!Number.isInteger(n)) throw new TypeError(`${label} must be an integer, got ${n}`);
}
