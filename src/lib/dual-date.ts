/**
 * Builders for the `DualDate` field type.
 *
 * Every date the user picks goes through here, so the GC timestamp and the
 * denormalized EC cache can never drift apart. Nothing else in the app is
 * allowed to construct a `DualDate` literal.
 */

import {
  ethiopianFiscalYear,
  ethiopianToUTCDate,
  utcDateToEthiopian,
  type EthiopianDate,
  type GregorianDate,
} from './ethiopic.js';
import type { CalendarSystem, DualDate, Timestamp } from './schema.js';

/** Minimal shape of the Firestore `Timestamp.fromDate` factory, injected to keep this SDK-agnostic. */
export type TimestampFactory = (date: Date) => Timestamp;

function periodKey(ec: EthiopianDate): string {
  return `EC-${ec.year}-${String(ec.month).padStart(2, '0')}`;
}

/** Build a `DualDate` from a JS Date the user picked in the Gregorian picker. */
export function dualDateFromGregorian(
  date: Date | GregorianDate,
  toTimestamp: TimestampFactory,
  enteredIn: CalendarSystem = 'GC',
): DualDate {
  const utc =
    date instanceof Date
      ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      : new Date(Date.UTC(date.year, date.month - 1, date.day));
  const ec = utcDateToEthiopian(utc);
  return {
    at: toTimestamp(utc),
    ec,
    ecPeriod: periodKey(ec),
    ecFiscalYear: ethiopianFiscalYear(ec),
    enteredIn,
  };
}

/**
 * Build a `DualDate` from an Ethiopian date the user typed in the EC picker.
 * This is the conversion the spec requires before anything touches Firestore.
 */
export function dualDateFromEthiopian(ec: EthiopianDate, toTimestamp: TimestampFactory): DualDate {
  const utc = ethiopianToUTCDate(ec); // throws on an invalid Pagume 6
  return {
    at: toTimestamp(utc),
    ec,
    ecPeriod: periodKey(ec),
    ecFiscalYear: ethiopianFiscalYear(ec),
    enteredIn: 'EC',
  };
}

/**
 * Verify a stored `DualDate`'s cache still matches its timestamp.
 * Run in tests and in a nightly integrity job — a mismatch means someone wrote
 * `at` without going through these builders.
 */
export function assertDualDateConsistent(d: DualDate): void {
  const ec = utcDateToEthiopian(d.at.toDate());
  const ok =
    ec.year === d.ec.year &&
    ec.month === d.ec.month &&
    ec.day === d.ec.day &&
    d.ecPeriod === periodKey(ec) &&
    d.ecFiscalYear === ethiopianFiscalYear(ec);
  if (!ok) {
    throw new Error(
      `DualDate cache is stale: at=${d.at.toDate().toISOString()} implies ` +
        `${ec.year}-${ec.month}-${ec.day} but stored ${d.ec.year}-${d.ec.month}-${d.ec.day}`,
    );
  }
}
