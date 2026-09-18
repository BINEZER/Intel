import { describe, expect, it } from 'vitest';
import { excelWallClockDate } from '../import-master.js';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * What SheetJS actually hands back for Excel serial 44270 — 15 March 2021 —
 * in a given timezone. These are not invented: each was printed by running
 * `XLSX.read(…, { cellDates: true })` under that TZ.
 */
const SHEETJS_44270 = {
  utc: new Date('2021-03-15T00:00:00.000Z'),
  addisAbaba: new Date('2021-03-14T20:59:44.000Z'), // UTC+3  — the reported bug
  kolkata: new Date('2021-03-14T18:29:50.000Z'),    // UTC+5:30, a half-hour zone
  newYork: new Date('2021-03-15T04:00:00.000Z'),    // UTC-5
  sydney: new Date('2021-03-14T13:00:00.000Z'),     // UTC+11
};

describe('the day an Excel cell meant', () => {
  it('reads 15 March in Addis Ababa, where it used to read the 14th', () => {
    // The whole bug in one line: at UTC+3 the serial arrives as 20:59:44 on
    // the PREVIOUS day, so both local and UTC getters said the 14th.
    expect(iso(excelWallClockDate(SHEETJS_44270.addisAbaba, -180))).toBe('2021-03-15');
  });

  it('reads 15 March in every other timezone too', () => {
    expect(iso(excelWallClockDate(SHEETJS_44270.utc, 0))).toBe('2021-03-15');
    expect(iso(excelWallClockDate(SHEETJS_44270.kolkata, -330))).toBe('2021-03-15');
    expect(iso(excelWallClockDate(SHEETJS_44270.newYork, 300))).toBe('2021-03-15');
    expect(iso(excelWallClockDate(SHEETJS_44270.sydney, -660))).toBe('2021-03-15');
  });

  it('lands exactly on midnight, never seconds before or after', () => {
    // A date that is 23:59:44 rather than 00:00:00 sorts and compares as the
    // day before in half the code that touches it.
    const out = excelWallClockDate(SHEETJS_44270.addisAbaba, -180);
    expect(out.getTime() % 86_400_000).toBe(0);
    expect(out.toISOString()).toBe('2021-03-15T00:00:00.000Z');
  });

  it('absorbs the seconds of drift rather than flooring past them', () => {
    // Undoing the offset lands on 23:59:44. Flooring would give the 14th,
    // which is the very mistake this replaces.
    const drifting = new Date('2021-03-14T20:59:44.000Z');
    expect(iso(excelWallClockDate(drifting, -180))).toBe('2021-03-15');
  });

  it('handles a date already at clean UTC midnight', () => {
    expect(iso(excelWallClockDate(new Date('2024-06-01T00:00:00.000Z'), 0))).toBe('2024-06-01');
  });

  it('holds across a year boundary', () => {
    // 31 Dec at UTC+3 is where an off-by-one moves the FISCAL YEAR too.
    expect(iso(excelWallClockDate(new Date('2024-12-30T20:59:44.000Z'), -180))).toBe('2024-12-31');
    expect(iso(excelWallClockDate(new Date('2020-12-31T21:00:00.000Z'), -180))).toBe('2021-01-01');
  });

  it('holds on a leap day', () => {
    expect(iso(excelWallClockDate(new Date('2024-02-28T21:00:00.000Z'), -180))).toBe('2024-02-29');
  });
});
