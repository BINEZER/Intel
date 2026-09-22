import { describe, expect, it } from 'vitest';
import {
  dayMillis,
  daysOut,
  planDateRepair,
  type StoredDates,
  type WantedDates,
} from '../date-repair.js';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const at = (iso: string) => day(iso).getTime();

const wanted = (over: Partial<WantedDates> = {}): WantedDates => ({
  id: 'im-k-AGR-2021-001',
  label: 'AGR-2021-001',
  dates: { signedDate: day('2021-03-15'), startDate: day('2021-03-15'), endDate: day('2021-09-15') },
  ...over,
});

/** A database holding exactly one document. */
const holding = (id: string, dates: StoredDates) => (asked: string) =>
  asked === id ? dates : null;

describe('deciding which dates to correct', () => {
  it('corrects a day that is stored one early — the whole bug', () => {
    const plan = planDateRepair(
      [wanted()],
      holding('im-k-AGR-2021-001', {
        signedDate: at('2021-03-14'),
        startDate: at('2021-03-14'),
        endDate: at('2021-09-14'),
      }),
    );
    expect(plan.fixes).toHaveLength(3);
    expect(plan.documents).toBe(1);
    expect(plan.fixes.map((fix) => fix.field)).toEqual(['signedDate', 'startDate', 'endDate']);
    expect(plan.fixes[0]?.to).toEqual(day('2021-03-15'));
  });

  it('leaves a date that is already right alone', () => {
    // Otherwise the count at the end reports rows examined rather than rows
    // that were wrong, and every re-run looks like it found something.
    const plan = planDateRepair(
      [wanted()],
      holding('im-k-AGR-2021-001', {
        signedDate: at('2021-03-15'),
        startDate: at('2021-03-15'),
        endDate: at('2021-09-15'),
      }),
    );
    expect(plan.fixes).toEqual([]);
    expect(plan.documents).toBe(0);
    expect(plan.alreadyRight).toBe(3);
  });

  it('corrects only the field that is wrong, not the whole document', () => {
    const plan = planDateRepair(
      [wanted()],
      holding('im-k-AGR-2021-001', {
        signedDate: at('2021-03-15'),
        startDate: at('2021-03-15'),
        endDate: at('2021-09-14'),
      }),
    );
    expect(plan.fixes).toHaveLength(1);
    expect(plan.fixes[0]?.field).toBe('endDate');
    expect(plan.alreadyRight).toBe(2);
  });

  it('never touches a field the workbook has no date for', () => {
    // The import fell back to the day it ran. That is not a misread cell, and
    // rewriting it would only stamp a newer today over an older one.
    const plan = planDateRepair(
      [wanted({ dates: { signedDate: null, startDate: null, endDate: null } })],
      holding('im-k-AGR-2021-001', {
        signedDate: at('2026-09-18'),
        startDate: at('2026-09-18'),
        endDate: at('2026-09-18'),
      }),
    );
    expect(plan.fixes).toEqual([]);
    expect(plan.noDateInWorkbook).toBe(3);
  });

  it('reports a document that is no longer there rather than failing', () => {
    // Deleted since the import. A fact to report, not an error to throw.
    const plan = planDateRepair([wanted()], () => null);
    expect(plan.missing).toBe(1);
    expect(plan.fixes).toEqual([]);
  });

  it('writes a date into a field that holds nothing at all', () => {
    const plan = planDateRepair(
      [wanted({ dates: { signedDate: day('2021-03-15') } })],
      holding('im-k-AGR-2021-001', { signedDate: null }),
    );
    expect(plan.fixes).toHaveLength(1);
    expect(plan.fixes[0]?.fromMillis).toBeNull();
  });

  it('counts documents, not fields, as corrected', () => {
    const plan = planDateRepair(
      [wanted({ id: 'a' }), wanted({ id: 'b' })],
      (id) =>
        id === 'a'
          ? { signedDate: at('2021-03-14'), startDate: at('2021-03-14'), endDate: at('2021-09-14') }
          : { signedDate: at('2021-03-15'), startDate: at('2021-03-15'), endDate: at('2021-09-15') },
    );
    expect(plan.documents).toBe(1);
    expect(plan.fixes).toHaveLength(3);
  });
});

describe('reading a stored instant as a day', () => {
  it('ignores a time of day that is not midnight', () => {
    // A stored value at 20:59:44 is still that day; comparing raw instants
    // would call every one of them wrong and rewrite all 129 every run.
    expect(dayMillis(new Date('2021-03-15T20:59:44.000Z'))).toBe(at('2021-03-15'));
  });
});

describe('saying how far out a date was', () => {
  it('reports one day for the bug this repairs', () => {
    expect(
      daysOut({ id: 'a', label: 'A', field: 'signedDate', to: day('2021-03-15'), fromMillis: at('2021-03-14') }),
    ).toBe(1);
  });

  it('reports nothing when there was no date stored to be out by', () => {
    expect(
      daysOut({ id: 'a', label: 'A', field: 'signedDate', to: day('2021-03-15'), fromMillis: null }),
    ).toBeNull();
  });

  it('is negative when the stored date is later than the workbook', () => {
    expect(
      daysOut({ id: 'a', label: 'A', field: 'endDate', to: day('2021-03-15'), fromMillis: at('2021-03-18') }),
    ).toBe(-3);
  });
});
