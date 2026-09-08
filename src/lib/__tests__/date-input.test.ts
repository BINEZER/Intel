import { describe, expect, it } from 'vitest';
import {
  ecDayOptions,
  pagumeHint,
  parseEcParts,
  parseIsoDate,
  previewGregorian,
  toEcParts,
  toIsoDate,
} from '../date-input.js';

const ec = (day: string, month: string, year: string) => ({ day, month, year });

describe('parseEcParts', () => {
  it('accepts a valid Ethiopian date', () => {
    const r = parseEcParts(ec('1', '1', '2018'));
    expect(r).toEqual({ ok: true, value: { year: 2018, month: 1, day: 1 } });
  });

  it('treats blank fields as incomplete, not wrong', () => {
    const r = parseEcParts(ec('', '1', '2018'));
    expect(r.ok).toBe(false);
    // The distinction matters: an incomplete form must not show a red error
    // while the user is still typing.
    expect(r.ok === false && r.incomplete).toBe(true);
  });

  it('rejects Pagume 6 outside a leap year, and says why', () => {
    const r = parseEcParts(ec('6', '13', '2012'));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('not a leap year');
  });

  it('accepts Pagume 6 in a leap year', () => {
    expect(parseEcParts(ec('6', '13', '2011')).ok).toBe(true);
  });

  it('rejects day 31 in a 30-day month', () => {
    const r = parseEcParts(ec('31', '5', '2018'));
    expect(r.ok === false && r.error).toBe('Day must be between 1 and 30.');
  });

  it('rejects an out-of-range month', () => {
    expect(parseEcParts(ec('1', '14', '2018')).ok).toBe(false);
    expect(parseEcParts(ec('1', '0', '2018')).ok).toBe(false);
  });

  it('rejects an implausible year before checking the month length', () => {
    const r = parseEcParts(ec('6', '13', '218'));
    expect(r.ok === false && r.error).toContain('Year must be between');
  });

  it('rejects non-numeric input', () => {
    expect(parseEcParts(ec('1', '1', '20I8')).ok).toBe(false);
    expect(parseEcParts(ec('1.5', '1', '2018')).ok).toBe(false);
  });
});

describe('parseIsoDate', () => {
  it('parses a valid ISO date at UTC midnight', () => {
    const r = parseIsoDate('2025-09-11');
    expect(r.ok && r.value.toISOString()).toBe('2025-09-11T00:00:00.000Z');
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    // Date.UTC would silently turn this into 3 March.
    const r = parseIsoDate('2025-02-31');
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toBe('That date does not exist.');
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseIsoDate('2024-02-29').ok).toBe(true);
    expect(parseIsoDate('2025-02-29').ok).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(parseIsoDate('11/09/2025').ok).toBe(false);
  });
});

describe('round-tripping between the two pickers', () => {
  it('keeps the same day when switching GC -> EC -> GC', () => {
    const iso = '2025-09-11';
    const parsed = parseIsoDate(iso);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const parts = toEcParts(parsed.value);
    expect(parts).toEqual({ day: '1', month: '1', year: '2018' });

    const back = previewGregorian(parts);
    expect(back && toIsoDate(back)).toBe(iso);
  });

  it('pads the ISO output correctly for single-digit months and days', () => {
    expect(toIsoDate(new Date(Date.UTC(2025, 0, 5)))).toBe('2025-01-05');
  });
});

describe('day options shrink to the month', () => {
  it('offers 30 days for an ordinary month', () => {
    expect(ecDayOptions('2018', '5')).toHaveLength(30);
  });

  it('offers 5 or 6 for Pagume depending on the year', () => {
    expect(ecDayOptions('2012', '13')).toHaveLength(5);
    expect(ecDayOptions('2011', '13')).toHaveLength(6);
  });

  it('falls back to 30 while the year is still being typed', () => {
    expect(ecDayOptions('', '5')).toHaveLength(30);
    expect(ecDayOptions('20', '5')).toHaveLength(30);
  });
});

describe('pagumeHint', () => {
  it('explains the leap year to the user', () => {
    expect(pagumeHint('2011')).toContain('6 days');
    expect(pagumeHint('2012')).toContain('5 days');
    expect(pagumeHint('')).toBeNull();
  });
});

describe('previewGregorian', () => {
  it('returns null rather than throwing on an invalid date', () => {
    expect(previewGregorian(ec('6', '13', '2012'))).toBeNull();
  });

  it('converts a valid EC date for the live preview', () => {
    const d = previewGregorian(ec('1', '1', '2018'));
    expect(d && toIsoDate(d)).toBe('2025-09-11');
  });
});
