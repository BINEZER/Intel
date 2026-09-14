import { describe, expect, it } from 'vitest';
import {
  ethiopianFiscalYear,
  ethiopianMonthLength,
  ethiopianToGregorian,
  ethiopianToUTCDate,
  ethiopianPeriodKey,
  formatDual,
  gregorianToEthiopian,
  isEthiopianLeapYear,
  utcDateToEthiopian,
} from '../ethiopic.js';

describe('known anchor dates', () => {
  // Each pair is an independently verifiable public date.
  const anchors: Array<[ec: [number, number, number], gc: [number, number, number], note: string]> = [
    [[2013, 1, 1], [2020, 9, 11], 'Ethiopian New Year 2013'],
    [[2012, 1, 1], [2019, 9, 12], 'New Year after the 2011 EC leap year — slides to Sep 12'],
    [[2011, 13, 6], [2019, 9, 11], 'Pagume 6 exists only in a leap year'],
    [[2018, 1, 1], [2025, 9, 11], 'Ethiopian New Year 2018'],
    [[1900, 1, 1], [1907, 9, 12], 'well before the Unix epoch'],
    [[2000, 4, 22], [2008, 1, 1], 'follows the 1999 EC leap year, so New Year fell on 12 Sep'],
  ];

  for (const [ec, gc, note] of anchors) {
    it(`${ec.join('-')} EC === ${gc.join('-')} GC (${note})`, () => {
      expect(ethiopianToGregorian({ year: ec[0], month: ec[1], day: ec[2] })).toEqual({
        year: gc[0], month: gc[1], day: gc[2],
      });
      expect(gregorianToEthiopian({ year: gc[0], month: gc[1], day: gc[2] })).toEqual({
        year: ec[0], month: ec[1], day: ec[2],
      });
    });
  }
});

describe('round-tripping', () => {
  it('survives 40 years of consecutive days without drift', () => {
    let d = new Date(Date.UTC(1995, 0, 1));
    const end = Date.UTC(2035, 0, 1);
    let checked = 0;
    while (d.getTime() < end) {
      const ec = utcDateToEthiopian(d);
      expect(ethiopianToUTCDate(ec).getTime()).toBe(d.getTime());
      d = new Date(d.getTime() + 86_400_000);
      checked++;
    }
    expect(checked).toBeGreaterThan(14_000);
  });

  it('handles dates before the Unix epoch (negative timestamps)', () => {
    const d = new Date(Date.UTC(1930, 5, 15));
    expect(ethiopianToUTCDate(utcDateToEthiopian(d)).getTime()).toBe(d.getTime());
  });
});

describe('leap years', () => {
  it('marks year % 4 === 3 as leap', () => {
    expect(isEthiopianLeapYear(2011)).toBe(true);
    expect(isEthiopianLeapYear(2015)).toBe(true);
    expect([2012, 2013, 2014].every((y) => !isEthiopianLeapYear(y))).toBe(true);
  });

  it('gives Pagume 5 days normally and 6 in a leap year', () => {
    expect(ethiopianMonthLength(2012, 13)).toBe(5);
    expect(ethiopianMonthLength(2011, 13)).toBe(6);
    expect(ethiopianMonthLength(2012, 7)).toBe(30);
  });

  it('rejects Pagume 6 in a non-leap year', () => {
    expect(() => ethiopianToUTCDate({ year: 2012, month: 13, day: 6 })).toThrow(/Pagume has 5 days/);
  });

  it('every Ethiopian year has exactly 365 or 366 days', () => {
    for (let y = 2005; y <= 2030; y++) {
      const start = ethiopianToUTCDate({ year: y, month: 1, day: 1 }).getTime();
      const next = ethiopianToUTCDate({ year: y + 1, month: 1, day: 1 }).getTime();
      const days = (next - start) / 86_400_000;
      expect(days).toBe(isEthiopianLeapYear(y) ? 366 : 365);
    }
  });
});

describe('fiscal year and period keys', () => {
  it('rolls the fiscal year over at 1 Hamle', () => {
    expect(ethiopianFiscalYear({ year: 2017, month: 10, day: 30 })).toBe(2017); // 30 Sene
    expect(ethiopianFiscalYear({ year: 2017, month: 11, day: 1 })).toBe(2018);  // 1 Hamle
  });

  it('builds a zero-padded VAT period key', () => {
    expect(ethiopianPeriodKey(new Date(Date.UTC(2025, 8, 11)))).toBe('EC-2018-01');
    expect(ethiopianPeriodKey(new Date(Date.UTC(2026, 0, 15)))).toBe('EC-2018-05');
  });
});

describe('dual formatting', () => {
  it('renders both calendars in one label, Gregorian leading', () => {
    // The database baseline is Gregorian and it is what people read first; the
    // Ethiopian reading follows in brackets, present on every date but never
    // the thing the eye lands on.
    expect(formatDual(new Date(Date.UTC(2025, 8, 11)))).toBe('11 Sep 2025 (1 Meskerem 2018 EC)');
  });

  it('still carries the Ethiopian reading on every date', () => {
    // Demoting it must not mean dropping it: an Ethiopian filing is dated by it.
    expect(formatDual(new Date(Date.UTC(2025, 8, 11)))).toContain('Meskerem');
    expect(formatDual(new Date(Date.UTC(2025, 8, 11)))).toContain('EC');
  });

  it('supports Amharic month names', () => {
    expect(formatDual(new Date(Date.UTC(2025, 8, 11)), { script: 'amharic' })).toContain('መስከረም');
  });
});
