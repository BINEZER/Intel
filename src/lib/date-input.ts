/**
 * Pure parsing and validation behind the dual-calendar date input.
 *
 * Kept free of React so the rules that decide whether a typed date is legal —
 * Pagume 6, month lengths, blank fields — are unit-testable without a DOM.
 */

import {
  ethiopianMonthLength,
  ethiopianToUTCDate,
  isEthiopianLeapYear,
  utcDateToEthiopian,
  type EthiopianDate,
} from './ethiopic.js';

/** The three raw strings an EC input collects. Strings, because a partly-typed field is not a number. */
export interface EcInputParts {
  day: string;
  /** '1'-'13'. */
  month: string;
  year: string;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; /** true when the user simply has not finished typing */ incomplete: boolean };

/** Plausible Ethiopian years for a business system — guards against a typo'd 218 or 20180. */
export const EC_YEAR_MIN = 1900;
export const EC_YEAR_MAX = 2100;

/**
 * Validate the three EC fields and produce a calendar date.
 *
 * Order matters: year is checked before month length, because whether Pagume 6
 * is legal depends on the year being known and valid first.
 */
export function parseEcParts(parts: EcInputParts): ParseResult<EthiopianDate> {
  const blank = (s: string) => s.trim() === '';
  if (blank(parts.year) || blank(parts.month) || blank(parts.day)) {
    return { ok: false, error: 'Enter day, month and year.', incomplete: true };
  }

  const year = toInt(parts.year);
  const month = toInt(parts.month);
  const day = toInt(parts.day);

  if (year === null || month === null || day === null) {
    return { ok: false, error: 'Dates must be whole numbers.', incomplete: false };
  }
  if (year < EC_YEAR_MIN || year > EC_YEAR_MAX) {
    return { ok: false, error: `Year must be between ${EC_YEAR_MIN} and ${EC_YEAR_MAX}.`, incomplete: false };
  }
  if (month < 1 || month > 13) {
    return { ok: false, error: 'Month must be between 1 (Meskerem) and 13 (Pagume).', incomplete: false };
  }

  const maxDay = ethiopianMonthLength(year, month);
  if (day < 1 || day > maxDay) {
    const error =
      month === 13
        ? `Pagume has ${maxDay} days in ${year}` +
          (maxDay === 5 ? ` — ${year} is not a leap year.` : '.')
        : `Day must be between 1 and ${maxDay}.`;
    return { ok: false, error, incomplete: false };
  }

  return { ok: true, value: { year, month, day } };
}

/** `2025-09-11` -> a UTC-anchored Date. Rejects anything the calendar rolled over, e.g. `2025-02-31`. */
export function parseIsoDate(iso: string): ParseResult<Date> {
  if (iso.trim() === '') return { ok: false, error: 'Pick a date.', incomplete: true };

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return { ok: false, error: 'Use the format YYYY-MM-DD.', incomplete: false };

  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC silently rolls 31 Feb into 3 Mar; compare back to catch it.
  const rolled =
    date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day;
  if (rolled) return { ok: false, error: 'That date does not exist.', incomplete: false };

  return { ok: true, value: date };
}

/** A UTC Date -> the `YYYY-MM-DD` an `<input type="date">` expects. */
export function toIsoDate(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(date.getUTCFullYear(), 4)}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())}`;
}

/** Split a Date into EC input fields, for switching the picker into EC mode mid-edit. */
export function toEcParts(date: Date): EcInputParts {
  const ec = utcDateToEthiopian(date);
  return { day: String(ec.day), month: String(ec.month), year: String(ec.year) };
}

/**
 * Day options for the EC day selector, so the list shrinks to 5 or 6 on Pagume
 * instead of offering days that will fail validation.
 */
export function ecDayOptions(yearInput: string, monthInput: string): number[] {
  const year = toInt(yearInput);
  const month = toInt(monthInput);
  if (year === null || month === null || month < 1 || month > 13) {
    return range(30);
  }
  if (year < EC_YEAR_MIN || year > EC_YEAR_MAX) return range(month === 13 ? 6 : 30);
  return range(ethiopianMonthLength(year, month));
}

/** Human note shown under the EC picker when the year affects Pagume's length. */
export function pagumeHint(yearInput: string): string | null {
  const year = toInt(yearInput);
  if (year === null || year < EC_YEAR_MIN || year > EC_YEAR_MAX) return null;
  return isEthiopianLeapYear(year)
    ? `${year} is a leap year — Pagume has 6 days.`
    : `${year} is not a leap year — Pagume has 5 days.`;
}

/** Live GC preview shown while the user types in the EC picker. */
export function previewGregorian(parts: EcInputParts): Date | null {
  const parsed = parseEcParts(parts);
  return parsed.ok ? ethiopianToUTCDate(parsed.value) : null;
}

function toInt(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}
