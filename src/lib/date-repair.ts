/**
 * Which stored dates the first import got wrong, and what they should be.
 *
 * The writing lives in `data/date-repair.ts`; the DECIDING lives here, because
 * "correct this row, leave that one alone" is a judgement and a judgement
 * belongs where a test can pin it down.
 *
 * THE RULE, IN ONE LINE
 *   Correct a field only when the workbook has a date for it AND what is stored
 *   is a different day.
 *
 *   The first half matters more than it looks. Where a row had no date, the
 *   import fell back to the day it ran; that stored value is not a misread cell,
 *   and "correcting" it would only stamp a newer today over an older one. The
 *   second half keeps the write list honest: a row already holding the right day
 *   is not rewritten, so the count at the end is the number of dates that were
 *   actually wrong rather than the number of rows examined.
 */

/** A document the workbook has dates for. */
export interface WantedDates {
  id: string;
  /** The contract or project number — what a person recognises. */
  label: string;
  /** Field name to the day the workbook means, or null where it says nothing. */
  dates: Record<string, Date | null>;
}

/** What a document currently holds, as millis at UTC midnight, or null. */
export type StoredDates = Record<string, number | null>;

/** One field to write. */
export interface DateFix {
  id: string;
  label: string;
  field: string;
  /** The day to write. */
  to: Date;
  /** The day currently stored, for the report. Null when nothing is stored. */
  fromMillis: number | null;
}

export interface RepairPlan {
  fixes: DateFix[];
  /** Documents with at least one field to write. */
  documents: number;
  /** In the workbook, but no longer stored. */
  missing: number;
  /** Fields the workbook says nothing about, so nothing was misread. */
  noDateInWorkbook: number;
  /** Fields already holding the right day. */
  alreadyRight: number;
}

/** Midnight UTC on the day this date falls on. */
export function dayMillis(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Work out every field that needs writing.
 *
 * `stored` returns what the database holds for a document, or null when the
 * document is not there at all — deleted since the import, which is a fact to
 * report rather than an error to throw.
 */
export function planDateRepair(
  wanted: readonly WantedDates[],
  stored: (id: string) => StoredDates | null,
): RepairPlan {
  const plan: RepairPlan = {
    fixes: [],
    documents: 0,
    missing: 0,
    noDateInWorkbook: 0,
    alreadyRight: 0,
  };

  for (const item of wanted) {
    const current = stored(item.id);
    if (current === null) {
      plan.missing += 1;
      continue;
    }

    let touched = false;
    for (const [field, date] of Object.entries(item.dates)) {
      if (date === null) {
        plan.noDateInWorkbook += 1;
        continue;
      }

      const fromMillis = current[field] ?? null;
      if (fromMillis === dayMillis(date)) {
        plan.alreadyRight += 1;
        continue;
      }

      plan.fixes.push({ id: item.id, label: item.label, field, to: date, fromMillis });
      touched = true;
    }
    if (touched) plan.documents += 1;
  }

  return plan;
}

/** How many days a stored date was out by, for the report. Null if none stored. */
export function daysOut(fix: DateFix): number | null {
  if (fix.fromMillis === null) return null;
  return Math.round((dayMillis(fix.to) - fix.fromMillis) / 86_400_000);
}
