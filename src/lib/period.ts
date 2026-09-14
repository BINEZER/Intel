/**
 * Reporting periods: this week, this month, this quarter, this year — and the
 * ones that come next.
 *
 * WHY THIS IS NOT `date-fns`
 *
 *   "This quarter" is not one thing in Ethiopia. The Ethiopian budget year runs
 *   1 Hamle to 30 Sene and splits into quarters that a Gregorian calendar cannot
 *   express: Q1 is Hamle–Meskerem and carries thirteen months' worth of month
 *   boundaries between them, because Pagume's five days sit inside it.
 *
 *   A CEO report that says "Q2" has to mean the quarter ERCA and the board mean.
 *   So both bases are first-class: `gregorian` for anyone reading against the
 *   international calendar, `ethiopian` for the filings.
 *
 * Every range is half-open in intent but closed in expression: `start` is the
 * first instant in the period and `end` is the last millisecond of it, so a
 * `date >= start && date <= end` test is exact and no transaction can fall
 * between two adjacent periods.
 */

import {
  ETHIOPIAN_MONTHS,
  ethiopianMonthLength,
  ethiopianToUTCDate,
  formatEthiopian,
  formatGregorianShort,
  utcDateToEthiopian,
  type EthiopianDate,
} from './ethiopic.js';

export const PERIOD_KINDS = ['week', 'month', 'quarter', 'year'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export type CalendarBasis = 'gregorian' | 'ethiopian';

export interface Period {
  kind: PeriodKind;
  basis: CalendarBasis;
  start: Date;
  /** The last millisecond of the period, so range tests are closed at both ends. */
  end: Date;
  /** What a reader calls this period: "Week of 8 Sep 2026", "Q2 FY 2019". */
  label: string;
  /**
   * The same period in as few characters as still identify it, for a chart axis.
   * Six full labels across one axis collide; six short ones do not, and an axis
   * whose labels overlap is worse than one that abbreviates.
   */
  shortLabel: string;
  /** The same period named in the other calendar, for the dual-calendar header. */
  altLabel: string;
}

const DAY_MS = 86_400_000;

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The last millisecond of the day `end` falls on. */
function endOfUTCDay(date: Date): Date {
  return new Date(startOfUTCDay(date).getTime() + DAY_MS - 1);
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/**
 * Monday to Sunday.
 *
 * Both calendars share the same seven-day cycle — the Ethiopian calendar
 * reorganises months, not weeks — so a week needs no basis. The Ethiopian
 * working week runs Monday to Friday with Saturday a half day on many sites,
 * which is why the week is cut at Monday rather than Sunday: a Saturday visit
 * belongs to the week it finished, not the one about to start.
 */
export function weekOf(asOf: Date): { start: Date; end: Date } {
  const start = startOfUTCDay(asOf);
  // getUTCDay: 0 = Sunday. Monday-based offset puts Sunday six days after Monday.
  const offset = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - offset);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS - 1) };
}

// ---------------------------------------------------------------------------
// Ethiopian quarters
// ---------------------------------------------------------------------------

/**
 * The Ethiopian budget year's four quarters, by month number.
 *
 * Month numbering is 1 Meskerem … 10 Sene, 11 Hamle, 12 Nehase, 13 Pagume. The
 * year opens at Hamle, so Q1 runs Hamle, Nehase, Pagume, Meskerem — four month
 * names but three months of days, because Pagume is only five (six in a leap
 * year). Folding Pagume into Q1 rather than giving it a quarter of its own is
 * what Ethiopian government and corporate reporting actually does.
 */
const ETHIOPIAN_QUARTERS: readonly { q: 1 | 2 | 3 | 4; months: readonly number[] }[] = [
  { q: 1, months: [11, 12, 13, 1] }, // Hamle, Nehase, Pagume, Meskerem
  { q: 2, months: [2, 3, 4] },       // Tikimt, Hidar, Tahsas
  { q: 3, months: [5, 6, 7] },       // Tir, Yekatit, Megabit
  { q: 4, months: [8, 9, 10] },      // Miazia, Ginbot, Sene
];

export function ethiopianQuarterOf(month: number): 1 | 2 | 3 | 4 {
  const found = ETHIOPIAN_QUARTERS.find((entry) => entry.months.includes(month));
  if (found === undefined) throw new RangeError(`Not an Ethiopian month number: ${month}`);
  return found.q;
}

/**
 * The fiscal year a given Ethiopian date falls in, named for the year it ends.
 * Hamle and after belong to the NEXT fiscal year: Hamle 2018 is in FY 2019.
 */
export function fiscalYearOf(date: EthiopianDate): number {
  return date.month >= 11 ? date.year + 1 : date.year;
}

/** The Ethiopian calendar year a fiscal quarter's months fall in. */
function calendarYearForQuarter(fiscalYear: number, quarter: 1 | 2 | 3 | 4, month: number): number {
  // Q1's Hamle, Nehase and Pagume are in the previous calendar year; its
  // Meskerem has already rolled over into the year the FY is named for.
  if (quarter === 1 && month >= 11) return fiscalYear - 1;
  return fiscalYear;
}

// ---------------------------------------------------------------------------
// The period builder
// ---------------------------------------------------------------------------

function gregorianPeriod(kind: PeriodKind, asOf: Date): { start: Date; end: Date } {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();

  switch (kind) {
    case 'week':
      return weekOf(asOf);
    case 'month':
      return {
        start: new Date(Date.UTC(y, m, 1)),
        end: new Date(Date.UTC(y, m + 1, 1) - 1),
      };
    case 'quarter': {
      const q = Math.floor(m / 3);
      return {
        start: new Date(Date.UTC(y, q * 3, 1)),
        end: new Date(Date.UTC(y, q * 3 + 3, 1) - 1),
      };
    }
    case 'year':
      return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1) - 1) };
  }
}

function ethiopianPeriod(kind: PeriodKind, asOf: Date): { start: Date; end: Date } {
  const ec = utcDateToEthiopian(asOf);

  switch (kind) {
    case 'week':
      return weekOf(asOf);
    case 'month': {
      const start = ethiopianToUTCDate({ year: ec.year, month: ec.month, day: 1 });
      const length = ethiopianMonthLength(ec.year, ec.month);
      return { start, end: new Date(start.getTime() + length * DAY_MS - 1) };
    }
    case 'quarter': {
      const fy = fiscalYearOf(ec);
      const quarter = ethiopianQuarterOf(ec.month);
      const months = ETHIOPIAN_QUARTERS.find((entry) => entry.q === quarter)?.months ?? [];
      const firstMonth = months[0] as number;
      const lastMonth = months[months.length - 1] as number;

      const start = ethiopianToUTCDate({
        year: calendarYearForQuarter(fy, quarter, firstMonth),
        month: firstMonth,
        day: 1,
      });
      const lastYear = calendarYearForQuarter(fy, quarter, lastMonth);
      const end = ethiopianToUTCDate({
        year: lastYear,
        month: lastMonth,
        day: ethiopianMonthLength(lastYear, lastMonth),
      });
      return { start, end: endOfUTCDay(end) };
    }
    case 'year': {
      const fy = fiscalYearOf(ec);
      return {
        start: ethiopianToUTCDate({ year: fy - 1, month: 11, day: 1 }),
        end: endOfUTCDay(ethiopianToUTCDate({ year: fy, month: 10, day: 30 })),
      };
    }
  }
}

function gregorianLabel(kind: PeriodKind, start: Date): string {
  const y = start.getUTCFullYear();
  switch (kind) {
    case 'week':
      return `Week of ${formatGregorianShort(start)}`;
    case 'month':
      return `${MONTHS[start.getUTCMonth()] as string} ${y}`;
    case 'quarter':
      return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${y}`;
    case 'year':
      return String(y);
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function gregorianShortLabel(kind: PeriodKind, start: Date): string {
  const y = start.getUTCFullYear();
  switch (kind) {
    case 'week':
      return formatGregorianShort(start).replace(String(y), '').trim();
    case 'month':
      return `${(MONTHS[start.getUTCMonth()] as string).slice(0, 3)} ${String(y).slice(2)}`;
    case 'quarter':
      return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${String(y).slice(2)}`;
    case 'year':
      return String(y);
  }
}

function ethiopianShortLabel(kind: PeriodKind, start: Date): string {
  const ec = utcDateToEthiopian(start);
  switch (kind) {
    case 'week':
      return `${ec.day} ${(ETHIOPIAN_MONTHS[ec.month - 1] as string).slice(0, 3)}`;
    case 'month':
      return `${(ETHIOPIAN_MONTHS[ec.month - 1] as string).slice(0, 3)} ${String(ec.year).slice(2)}`;
    case 'quarter':
      return `Q${ethiopianQuarterOf(ec.month)} FY${String(fiscalYearOf(ec)).slice(2)}`;
    case 'year':
      return `FY${String(fiscalYearOf(ec)).slice(2)}`;
  }
}

function ethiopianLabel(kind: PeriodKind, start: Date): string {
  const ec = utcDateToEthiopian(start);
  switch (kind) {
    case 'week':
      return `Week of ${formatEthiopian(ec)}`;
    case 'month':
      return `${ETHIOPIAN_MONTHS[ec.month - 1] as string} ${ec.year} EC`;
    case 'quarter':
      return `Q${ethiopianQuarterOf(ec.month)} FY ${fiscalYearOf(ec)}`;
    case 'year':
      return `FY ${fiscalYearOf(ec)} (Hamle ${fiscalYearOf(ec) - 1} – Sene ${fiscalYearOf(ec)})`;
  }
}

/** The period containing `asOf`, on the given calendar basis. */
export function periodContaining(kind: PeriodKind, basis: CalendarBasis, asOf: Date): Period {
  const { start, end } = basis === 'gregorian' ? gregorianPeriod(kind, asOf) : ethiopianPeriod(kind, asOf);
  return {
    kind,
    basis,
    start,
    end,
    label: basis === 'gregorian' ? gregorianLabel(kind, start) : ethiopianLabel(kind, start),
    shortLabel: basis === 'gregorian' ? gregorianShortLabel(kind, start) : ethiopianShortLabel(kind, start),
    altLabel: basis === 'gregorian' ? ethiopianLabel(kind, start) : gregorianLabel(kind, start),
  };
}

/**
 * The period before or after this one.
 *
 * Stepping by a day past the boundary and re-deriving, rather than by arithmetic
 * on month numbers. It is the only approach that survives Pagume, which is five
 * days long in three years out of four and six in the fourth — month arithmetic
 * on a thirteen-month year gets this wrong in ways that show up once every four
 * years, in production, in an annual report.
 */
export function shiftPeriod(period: Period, direction: -1 | 1): Period {
  const pivot =
    direction === 1
      ? new Date(period.end.getTime() + 1)
      : new Date(period.start.getTime() - 1);
  return periodContaining(period.kind, period.basis, pivot);
}

export function previousPeriod(period: Period): Period {
  return shiftPeriod(period, -1);
}

export function nextPeriod(period: Period): Period {
  return shiftPeriod(period, 1);
}

export function containsDate(period: Period, date: Date): boolean {
  return date >= period.start && date <= period.end;
}

/** Inclusive day count, for "12 of the 30 days are gone" style statements. */
export function periodDays(period: Period): number {
  return Math.round((period.end.getTime() + 1 - period.start.getTime()) / DAY_MS);
}

/**
 * How far through the period we are, in basis points.
 *
 * Used to say whether a figure is behind or ahead of where it should be: half a
 * quarter's revenue at the two-thirds mark is a different story from half at the
 * halfway mark, and a report that does not make the distinction is just a number.
 */
export function periodElapsedBps(period: Period, asOf: Date): number {
  if (asOf <= period.start) return 0;
  if (asOf >= period.end) return 10_000;
  const span = period.end.getTime() + 1 - period.start.getTime();
  return Math.round(((asOf.getTime() - period.start.getTime()) / span) * 10_000);
}

/** The last `count` periods ending with this one, oldest first — for a trend. */
export function trailingPeriods(period: Period, count: number): Period[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`Trailing period count must be a positive integer, got ${count}`);
  }
  const out: Period[] = [period];
  for (let i = 1; i < count; i += 1) out.unshift(previousPeriod(out[0] as Period));
  return out;
}

/** Dual-calendar date range for a report header. */
export function formatPeriodRange(period: Period): string {
  return `${formatGregorianShort(period.start)} – ${formatGregorianShort(period.end)}`;
}
