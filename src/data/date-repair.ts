/**
 * Correct the dates the first import stored one day early.
 *
 * WHY THIS EXISTS RATHER THAN "JUST RE-RUN THE IMPORT"
 *   The importer does update in place — ids are derived from the workbook, so a
 *   second run overwrites rather than duplicates. But it overwrites the WHOLE
 *   document, and by now those documents have been worked on: a contract put on
 *   hold, a project marked terminated, a warranty term corrected, a handover
 *   recorded. All of that came from somebody deciding it, and none of it is in
 *   the workbook. A full re-run would quietly put every one of them back to what
 *   the spreadsheet said months ago.
 *
 *   So this does one thing. It writes date fields, only the ones that are
 *   actually wrong, with `update` rather than `set` — so every other field is
 *   untouched by construction rather than by care.
 *
 * THE BUG BEING REPAIRED
 *   Excel stores a date as a wall-clock day with no timezone. SheetJS turned the
 *   serial into a JS Date by way of LOCAL time, so at UTC+3 the 15th arrived as
 *   `2021-03-14T20:59:44Z` and the day was read off that. Fixed in
 *   `excelWallClockDate`; this carries the fix to the rows already stored.
 *
 * WHAT IT DOES NOT TOUCH
 *   Anything the workbook has no date for. There the import fell back to the day
 *   it ran, and that is not a misread cell — rewriting it would only stamp a
 *   newer today over an older one. See `lib/date-repair.ts`, which decides.
 */

import { Timestamp, collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampUpdate } from './audit.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { planDateRepair, type StoredDates, type WantedDates } from '../lib/date-repair.js';
import type { ImportPlan } from '../lib/import-master.js';
import type { DualDate } from '../lib/schema.js';

/** Firestore caps a batch at 500 writes; the same headroom the importer keeps. */
const BATCH_LIMIT = 450;

const ID = {
  program: (key: string) => `im-g-${key}`,
  contract: (key: string) => `im-k-${key}`,
  project: (key: string) => `im-p-${key}`,
};

/** The date fields each collection carries, in the order they read best. */
const FIELDS: Record<string, readonly string[]> = {
  programs: ['plannedStart', 'plannedEnd'],
  contracts: ['signedDate', 'startDate', 'endDate'],
  projects: ['plannedStart', 'plannedEnd'],
};

export interface DateRepairProgress {
  stage: string;
  examined: number;
  total: number;
}

/** One date that moved, in terms a person can check against the workbook. */
export interface DateChange {
  collection: string;
  label: string;
  field: string;
  from: string;
  to: string;
  daysOut: number | null;
}

export interface DateRepairResult {
  examined: Record<string, number>;
  /** Documents with at least one date corrected. */
  corrected: Record<string, number>;
  /** Date fields written. */
  fields: Record<string, number>;
  /** In the workbook but no longer stored — deleted since, presumably. */
  missing: number;
  /** Fields the workbook says nothing about, so nothing there was misread. */
  noDateInWorkbook: number;
  /** Fields already holding the right day. */
  alreadyRight: number;
  changes: DateChange[];
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** What the workbook says each document's dates should be, per collection. */
function wantedFrom(plan: ImportPlan): Record<string, WantedDates[]> {
  return {
    programs: plan.programs.map((program) => ({
      id: ID.program(program.key),
      label: program.name,
      dates: { plannedStart: program.plannedStart, plannedEnd: program.plannedEnd },
    })),
    contracts: plan.contracts.map((contract) => ({
      id: ID.contract(contract.key),
      label: contract.contractNo,
      dates: {
        signedDate: contract.signedDate,
        startDate: contract.startDate,
        endDate: contract.endDate,
      },
    })),
    projects: plan.projects.map((project) => ({
      id: ID.project(project.key),
      label: project.projectNo,
      dates: { plannedStart: project.plannedStart, plannedEnd: project.plannedEnd },
    })),
  };
}

/** The instant a stored dual date sits on, or null if there is not one there. */
function storedMillis(value: unknown): number | null {
  const at = (value as { at?: { toMillis?: () => number } } | null | undefined)?.at;
  return typeof at?.toMillis === 'function' ? at.toMillis() : null;
}

/**
 * Compare the workbook against what is stored, and write back only the dates
 * that differ.
 *
 * Each collection is read in one query rather than a document at a time: 129
 * contracts is one round trip, and one round trip is both cheaper and far easier
 * to reason about than 129.
 */
export async function repairImportedDates(
  plan: ImportPlan,
  uid: string,
  onProgress: (progress: DateRepairProgress) => void,
): Promise<DateRepairResult> {
  const wanted = wantedFrom(plan);
  const result: DateRepairResult = {
    examined: {},
    corrected: {},
    fields: {},
    missing: 0,
    noDateInWorkbook: 0,
    alreadyRight: 0,
    changes: [],
  };

  const total = Object.values(wanted).reduce((sum, list) => sum + list.length, 0);
  let examined = 0;

  let batch = writeBatch(db);
  let queued = 0;
  const flush = async () => {
    if (queued === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    queued = 0;
  };

  for (const [path, list] of Object.entries(wanted)) {
    if (list.length === 0) continue;
    onProgress({ stage: path, examined, total });

    const snapshot = await getDocs(collection(db, path));
    const stored = new Map<string, StoredDates>();
    for (const document of snapshot.docs) {
      const data = document.data();
      const dates: StoredDates = {};
      for (const field of FIELDS[path] ?? []) dates[field] = storedMillis(data[field]);
      stored.set(document.id, dates);
    }

    const repair = planDateRepair(list, (id) => stored.get(id) ?? null);
    result.examined[path] = list.length;
    result.corrected[path] = repair.documents;
    result.fields[path] = repair.fixes.length;
    result.missing += repair.missing;
    result.noDateInWorkbook += repair.noDateInWorkbook;
    result.alreadyRight += repair.alreadyRight;

    // The fixes come back one per FIELD; they are written one per DOCUMENT, so a
    // contract with three wrong dates is one write rather than three.
    const byDocument = new Map<string, Record<string, DualDate>>();
    for (const fix of repair.fixes) {
      const patch = byDocument.get(fix.id) ?? {};
      patch[fix.field] = dualDateFromGregorian(fix.to, (d) => Timestamp.fromDate(d));
      byDocument.set(fix.id, patch);

      result.changes.push({
        collection: path,
        label: fix.label,
        field: fix.field,
        from: fix.fromMillis === null ? 'not set' : iso(new Date(fix.fromMillis)),
        to: iso(fix.to),
        daysOut:
          fix.fromMillis === null
            ? null
            : Math.round((Date.parse(`${iso(fix.to)}T00:00:00.000Z`) - fix.fromMillis) / 86_400_000),
      });
    }

    for (const [id, patch] of byDocument) {
      // `update`, never `set`: it writes the named fields and leaves the rest of
      // the document exactly as it is, which is the whole point of this pass.
      batch.update(doc(db, path, id), { ...patch, ...stampUpdate(uid) });
      queued += 1;
      if (queued >= BATCH_LIMIT) await flush();
    }

    examined += list.length;
    onProgress({ stage: path, examined, total });
  }

  await flush();
  onProgress({ stage: 'done', examined, total });
  return result;
}
