/**
 * Reporting periods.
 *
 * The Ethiopian cases are the ones worth testing: a thirteen-month year whose
 * last month is five days long, and quarters that do not divide it evenly. Get
 * these wrong and an annual report silently omits five days once a year, or
 * double-counts them.
 */

import { describe, expect, it } from 'vitest';
import {
  containsDate,
  ethiopianQuarterOf,
  fiscalYearOf,
  formatPeriodRange,
  nextPeriod,
  periodContaining,
  periodDays,
  periodElapsedBps,
  previousPeriod,
  trailingPeriods,
  weekOf,
  type PeriodKind,
} from '../period.js';
import { ethiopianToUTCDate, utcDateToEthiopian } from '../ethiopic.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe('weekOf', () => {
  it('runs Monday to Sunday', () => {
    // 2026-09-14 is a Monday.
    const { start, end } = weekOf(utc(2026, 9, 16));
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-14');
    expect(end.toISOString()).toBe('2026-09-20T23:59:59.999Z');
  });

  it('puts Sunday at the end of the week that has just finished, not the start of the next', () => {
    const { start } = weekOf(utc(2026, 9, 20)); // a Sunday
    expect(start.toISOString().slice(0, 10)).toBe('2026-09-14');
  });

  it('puts Monday at the very start of its own week', () => {
    const monday = utc(2026, 9, 14);
    expect(weekOf(monday).start.getTime()).toBe(monday.getTime());
  });
});

describe('Gregorian periods', () => {
  it('bounds a month exactly, including February in a leap year', () => {
    const february = periodContaining('month', 'gregorian', utc(2028, 2, 10));
    expect(february.start.toISOString().slice(0, 10)).toBe('2028-02-01');
    expect(february.end.toISOString()).toBe('2028-02-29T23:59:59.999Z');
    expect(periodDays(february)).toBe(29);
  });

  it('bounds a quarter and names it', () => {
    const q = periodContaining('quarter', 'gregorian', utc(2026, 8, 3));
    expect(q.label).toBe('Q3 2026');
    expect(q.start.toISOString().slice(0, 10)).toBe('2026-07-01');
    expect(q.end.toISOString().slice(0, 10)).toBe('2026-09-30');
  });

  it('bounds a year', () => {
    const y = periodContaining('year', 'gregorian', utc(2026, 5, 5));
    expect(y.label).toBe('2026');
    expect(periodDays(y)).toBe(365);
  });
});

describe('Ethiopian periods', () => {
  it('bounds an Ethiopian month at 30 days', () => {
    const month = periodContaining('month', 'ethiopian', utc(2026, 9, 20));
    expect(periodDays(month)).toBe(30);
    expect(utcDateToEthiopian(month.start).day).toBe(1);
    expect(utcDateToEthiopian(month.end).day).toBe(30);
  });

  it('bounds Pagume at five days, or six in a leap year', () => {
    // EC 2018 is not a leap year (2018 % 4 === 2); EC 2019 is (2019 % 4 === 3).
    const plain = periodContaining('month', 'ethiopian', ethiopianToUTCDate({ year: 2018, month: 13, day: 2 }));
    expect(periodDays(plain)).toBe(5);

    const leap = periodContaining('month', 'ethiopian', ethiopianToUTCDate({ year: 2019, month: 13, day: 2 }));
    expect(periodDays(leap)).toBe(6);
  });

  it('runs the fiscal year from 1 Hamle to 30 Sene', () => {
    const year = periodContaining('year', 'ethiopian', ethiopianToUTCDate({ year: 2018, month: 3, day: 15 }));
    const start = utcDateToEthiopian(year.start);
    const end = utcDateToEthiopian(year.end);

    expect(start).toMatchObject({ month: 11, day: 1 });
    expect(end).toMatchObject({ month: 10, day: 30 });
    // Hidar 2018 is in FY 2018: the year is named for the year it ENDS in.
    expect(year.label).toContain('FY 2018');
    expect(start.year).toBe(2017);
    expect(end.year).toBe(2018);
  });

  it('puts Hamle in the fiscal year that is only just beginning', () => {
    // Hamle 2018 belongs to FY 2019, not FY 2018.
    expect(fiscalYearOf({ year: 2018, month: 11, day: 1 })).toBe(2019);
    expect(fiscalYearOf({ year: 2018, month: 10, day: 30 })).toBe(2018);
  });

  it('covers a whole fiscal year with no gap and no overlap between its quarters', () => {
    const year = periodContaining('year', 'ethiopian', ethiopianToUTCDate({ year: 2017, month: 11, day: 5 }));
    let quarter = periodContaining('quarter', 'ethiopian', year.start);
    let covered = 0;

    for (let i = 0; i < 4; i += 1) {
      // Each quarter starts exactly where the previous one ended.
      if (i > 0) expect(quarter.start.getTime()).toBe(covered + year.start.getTime());
      covered += periodDays(quarter) * 86_400_000;
      quarter = nextPeriod(quarter);
    }

    expect(covered).toBe(year.end.getTime() + 1 - year.start.getTime());
    // Four quarters later we are in the next fiscal year, not back where we started.
    expect(quarter.start.getTime()).toBe(year.end.getTime() + 1);
  });

  it('folds Pagume into the first quarter', () => {
    expect(ethiopianQuarterOf(11)).toBe(1); // Hamle
    expect(ethiopianQuarterOf(13)).toBe(1); // Pagume
    expect(ethiopianQuarterOf(1)).toBe(1);  // Meskerem
    expect(ethiopianQuarterOf(2)).toBe(2);  // Tikimt
    expect(ethiopianQuarterOf(10)).toBe(4); // Sene
  });

  it('rejects a month number that does not exist', () => {
    expect(() => ethiopianQuarterOf(14)).toThrow(RangeError);
    expect(() => ethiopianQuarterOf(0)).toThrow(RangeError);
  });
});

describe('stepping between periods', () => {
  const kinds: PeriodKind[] = ['week', 'month', 'quarter', 'year'];

  for (const basis of ['gregorian', 'ethiopian'] as const) {
    for (const kind of kinds) {
      it(`${basis} ${kind}: next starts the instant this one ends`, () => {
        const period = periodContaining(kind, basis, utc(2026, 9, 14));
        expect(nextPeriod(period).start.getTime()).toBe(period.end.getTime() + 1);
      });

      it(`${basis} ${kind}: previous then next returns to the same period`, () => {
        const period = periodContaining(kind, basis, utc(2026, 9, 14));
        const round = nextPeriod(previousPeriod(period));
        expect(round.start.getTime()).toBe(period.start.getTime());
        expect(round.end.getTime()).toBe(period.end.getTime());
        expect(round.label).toBe(period.label);
      });
    }
  }

  it('survives a long walk across Pagume and a leap year', () => {
    // Thirty Ethiopian months from mid-2018 crosses Pagume twice and one leap year.
    let month = periodContaining('month', 'ethiopian', ethiopianToUTCDate({ year: 2018, month: 5, day: 1 }));
    for (let i = 0; i < 30; i += 1) {
      const next = nextPeriod(month);
      expect(next.start.getTime()).toBe(month.end.getTime() + 1);
      expect(utcDateToEthiopian(next.start).day).toBe(1);
      month = next;
    }
  });
});

describe('containsDate', () => {
  it('is closed at both ends', () => {
    const period = periodContaining('month', 'gregorian', utc(2026, 9, 14));
    expect(containsDate(period, period.start)).toBe(true);
    expect(containsDate(period, period.end)).toBe(true);
    expect(containsDate(period, new Date(period.start.getTime() - 1))).toBe(false);
    expect(containsDate(period, new Date(period.end.getTime() + 1))).toBe(false);
  });
});

describe('periodElapsedBps', () => {
  const period = periodContaining('month', 'gregorian', utc(2026, 9, 14)); // 30 days

  it('is 0 before it starts and 100% once it is over', () => {
    expect(periodElapsedBps(period, utc(2026, 8, 20))).toBe(0);
    expect(periodElapsedBps(period, utc(2026, 10, 20))).toBe(10_000);
  });

  it('reports the fraction actually gone', () => {
    // Start of day 16 of 30 is half the month.
    expect(periodElapsedBps(period, utc(2026, 9, 16))).toBe(5000);
  });
});

describe('trailingPeriods', () => {
  it('returns the requested count, oldest first, ending with this one', () => {
    const period = periodContaining('month', 'gregorian', utc(2026, 9, 14));
    const series = trailingPeriods(period, 6);

    expect(series).toHaveLength(6);
    expect(series[5]?.label).toBe(period.label);
    expect(series[0]?.label).toBe('April 2026');
    for (let i = 1; i < series.length; i += 1) {
      expect((series[i] as { start: Date }).start.getTime()).toBe((series[i - 1] as { end: Date }).end.getTime() + 1);
    }
  });

  it('rejects a count that is not a positive whole number', () => {
    const period = periodContaining('week', 'gregorian', utc(2026, 9, 14));
    expect(() => trailingPeriods(period, 0)).toThrow(RangeError);
    expect(() => trailingPeriods(period, 2.5)).toThrow(RangeError);
  });
});

describe('labels', () => {
  it('names the period in both calendars', () => {
    const period = periodContaining('quarter', 'gregorian', utc(2026, 9, 14));
    expect(period.label).toBe('Q3 2026');
    expect(period.altLabel).toMatch(/^Q\d FY \d{4}$/);
  });

  it('prints a readable range', () => {
    const period = periodContaining('month', 'gregorian', utc(2026, 9, 14));
    expect(formatPeriodRange(period)).toBe('1 Sep 2026 – 30 Sep 2026');
  });
});
