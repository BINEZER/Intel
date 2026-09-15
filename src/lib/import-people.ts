/**
 * Read the people out of the workbook: our technicians, and the subcontractors
 * who work alongside them.
 *
 * NOBODY IS IN A TABLE
 *   There is no technicians sheet and no subcontractors sheet. Both kinds share
 *   the same rosters, separated by a marker row — "OUR TECHNICIANS" then, part
 *   way down, "SUBCONTRACTORS" — so the section a name sits in is the only
 *   thing that says which kind of person it is. Read without that, the rosters
 *   are one undifferentiated list of first names.
 *
 * THE SAME NAME CAN BE TWO PEOPLE
 *   "Yosef" appears in the technician section AND in the subcontractor section
 *   of both rosters, and the contacts sheet lists a "YOSEF SC" with a phone
 *   number. They are not the same person. Records are keyed by kind AND name,
 *   so merging them is not possible even by accident.
 *
 * PHONES CARRY THEIR OWN EVIDENCE
 *   The contact list suffixes every name — "FASIKA T", "ABRAHAM SC" — and that
 *   suffix is an independent statement of what somebody is. It is used both to
 *   attach the phone number and to find people the rosters missed: three
 *   technicians exist only in the contact list.
 *
 * NO TINS ANYWHERE
 *   Not one sheet records a subcontractor's TIN, and a missing TIN is not a
 *   cosmetic gap: withholding goes to 30% instead of 2% or 3%. Everyone is
 *   imported with no TIN, which is true, and every one of them is flagged so
 *   nobody raises a payment voucher against the penalty rate by accident.
 */

import type { ImportIssue, Row, Workbook } from './import-master.js';

export type PersonKind = 'technician' | 'subcontractor';

export interface PlannedTechnician {
  key: string;
  name: string;
  phone: string;
  /** What the rosters say they are working on, kept as a starting note. */
  note: string;
}

export interface PlannedSubcontractor {
  key: string;
  name: string;
  phone: string;
  /** "Installation", "Steel structure work" — from the payment sheets. */
  trades: string[];
  note: string;
}

export interface PlannedPeople {
  technicians: PlannedTechnician[];
  subcontractors: PlannedSubcontractor[];
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Upper case, no punctuation, single spaces. The form used for matching only. */
export function normaliseName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The section markers, and the words that are not people.
 *
 * A roster's own headings sit in the same column as the names, so without this
 * the import creates a technician called "Our Techncians" — typo and all.
 */
const TECHNICIAN_MARKERS = ['OUR TECHNICIANS', 'OUR TECHNCIANS', 'TECHNICIANS', 'TECNICIAN'];
const SUBCONTRACTOR_MARKERS = ['SUBCONTRACTORS', 'SUB CONTRACTORS', 'SUBCONTRACTOR'];
const NOT_A_PERSON = [
  'NAME', 'NO', 'PROJECTS', 'PROJECT', 'TOTAL', 'CONTACT LISTS', 'PHONE',
  'PREVIOUS', 'CURRENT', 'UPCOMING', 'REMARKS', 'WEEKS', 'NAN',
];

/**
 * Words that only ever appear in a column heading.
 *
 * Several of these sheets keep their real header inside the data — the parser
 * sees `Unnamed: 1` as the header and "Name of The sub contacts" as the first
 * row — so without this the import gains a subcontractor by that name. Nobody
 * is called anything containing these.
 */
const HEADER_WORDS = [
  'NAME', 'DESCRIPTION', 'AMOUNT', 'PAYMENT', 'NUMBER', 'TOTAL', 'DATE',
  'STATUS', 'CONTACT', 'CONTACTS', 'LIST', 'LISTS', 'PROJECTS',
];

/** The section a sheet declares in its own column headings, if any. */
function headerSection(rows: readonly Row[]): PersonKind | null {
  const first = rows[0];
  if (first === undefined) return null;
  for (const key of Object.keys(first)) {
    const marker = sectionMarker(key);
    if (marker !== null) return marker;
  }
  return null;
}

function sectionMarker(value: string): PersonKind | null {
  const name = normaliseName(value);
  if (TECHNICIAN_MARKERS.includes(name)) return 'technician';
  if (SUBCONTRACTOR_MARKERS.includes(name)) return 'subcontractor';
  return null;
}

function looksLikeAPerson(raw: string): boolean {
  const name = normaliseName(raw);
  if (name.length < 2 || name.length > 60) return false;
  if (NOT_A_PERSON.includes(name)) return false;
  const words = name.split(' ');
  if (words.some((word) => HEADER_WORDS.includes(word))) return false;
  // A pure number, a date, or a row index is not a name.
  return /[A-Z]/.test(name);
}

/**
 * Do two names refer to the same person?
 *
 * The sheets are inconsistent in a way that has to be handled or half the
 * phone numbers go unattached: the contact list says "MELAKU MAS", the roster
 * says "MAS"; the payment sheet says "Merkebu Alemayehu", the contact list says
 * "MERKEB". So a match is either a shared token set (one name's words contain
 * the other's) or a prefix of at least four letters.
 *
 * It is deliberately used only where the candidate is UNIQUE. "Yosef" matching
 * two people is not a near miss to be resolved by picking one — it is the
 * reason the two Yosefs must stay apart.
 */
export function namesMatch(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (left === '' || right === '') return false;
  if (left === right) return true;

  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const subset = (small: Set<string>, big: Set<string>) =>
    small.size > 0 && [...small].every((token) => big.has(token));
  if (subset(leftTokens, rightTokens) || subset(rightTokens, leftTokens)) return true;

  const short = left.length <= right.length ? left : right;
  const long = left.length <= right.length ? right : left;
  return short.length >= 4 && long.startsWith(short);
}

/** The fuller of two spellings, so "Merkebu Alemayehu" beats "Merkebu". */
function betterName(a: string, b: string): string {
  return b.trim().length > a.trim().length ? b.trim() : a.trim();
}

// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

interface Person {
  kind: PersonKind;
  name: string;
  phone: string;
  trades: Set<string>;
  notes: Set<string>;
}

class People {
  private readonly rows: Person[] = [];

  /** Find by kind and name, or create. Kind is part of the identity. */
  upsert(kind: PersonKind, name: string): Person {
    const found = this.rows.find((row) => row.kind === kind && namesMatch(row.name, name));
    if (found !== undefined) {
      found.name = betterName(found.name, name);
      return found;
    }
    const created: Person = { kind, name: name.trim(), phone: '', trades: new Set(), notes: new Set() };
    this.rows.push(created);
    return created;
  }

  /** Candidates for a name, so an ambiguous match can be refused rather than guessed. */
  candidates(kind: PersonKind, name: string): Person[] {
    return this.rows.filter((row) => row.kind === kind && namesMatch(row.name, name));
  }

  all(): Person[] {
    return this.rows;
  }
}

/** Every cell of a row, as text, in order. */
function cells(row: Row): string[] {
  return Object.values(row).map((value) =>
    value === null || value === undefined || value instanceof Date ? '' : String(value).trim(),
  );
}

/**
 * Walk a roster top to bottom, tracking which section we are in.
 *
 * Column 0 holds the names; the columns to the right hold whatever that person
 * is working on, which is kept as a note rather than parsed — those are project
 * nicknames ("MAW", "HIYA BM"), not ids that join to anything.
 */
function readRoster(
  rows: readonly Row[],
  people: People,
  nameColumn: number,
  noteColumns: readonly number[],
  sheet: string,
  issues: ImportIssue[],
): void {
  // A sheet whose whole purpose is one kind puts the marker in its HEADER row —
  // "OUR TECHNICIANS" is the column name, not a cell — so it never appears as a
  // value and every name above the first in-sheet marker would be refused.
  let section: PersonKind | null = headerSection(rows);

  for (const row of rows) {
    const values = cells(row);
    // A marker can sit in any column: the rosters put "Subcontractors" in the
    // name column, but "OUR TECHNICIANS" is the sheet's own header.
    const marker = values.map(sectionMarker).find((kind) => kind !== null);
    if (marker !== undefined && marker !== null) {
      section = marker;
      continue;
    }

    const raw = values[nameColumn] ?? '';
    if (raw === '' || !looksLikeAPerson(raw)) continue;

    if (section === null) {
      issues.push({
        severity: 'skipped',
        sheet,
        ref: raw,
        reason:
          'Name appears above any "Our technicians" or "Subcontractors" heading, so there is nothing to say which they are.',
      });
      continue;
    }

    const person = people.upsert(section, raw);
    for (const column of noteColumns) {
      const note = values[column] ?? '';
      if (note !== '' && looksLikeAPerson(note)) person.notes.add(note);
    }
  }
}

/**
 * The contact list, where the suffix states the kind.
 *
 * "FASIKA T" is a technician, "ABRAHAM SC" a subcontractor. Anything else —
 * "YONAS KIDUS PROJECT" — is a contact for a job rather than one of our people,
 * and is left alone.
 */
function readContacts(rows: readonly Row[], people: People, issues: ImportIssue[]): void {
  for (const row of rows) {
    const values = cells(row).filter((value) => value !== '');
    if (values.length < 2) continue;

    const rawName = values.find((value) => /[A-Za-z]/.test(value) && !/^\d+$/.test(value)) ?? '';
    const phone = values.find((value) => /^\+?\d[\d\s-]{7,}$/.test(value.replace(/\s/g, ''))) ?? '';
    if (rawName === '' || phone === '' || !looksLikeAPerson(rawName)) continue;

    const upper = normaliseName(rawName);
    const kind: PersonKind | null = upper.endsWith(' SC')
      ? 'subcontractor'
      : upper.endsWith(' T')
        ? 'technician'
        : null;
    if (kind === null) continue; // a project contact, not one of ours

    const name = rawName.replace(/\s+(SC|T)\s*$/i, '').trim();
    const matches = people.candidates(kind, name);

    if (matches.length > 1) {
      issues.push({
        severity: 'skipped',
        sheet: 'Sch_Contacts',
        ref: rawName,
        reason: `Phone number matches ${matches.length} people of that kind, so it was not attached to any of them.`,
      });
      continue;
    }

    const person = matches[0] ?? people.upsert(kind, name);
    if (matches.length === 0) {
      issues.push({
        severity: 'warning',
        sheet: 'Sch_Contacts',
        ref: rawName,
        reason:
          'Only in the contact list, not in any roster. Created from the name and the "T"/"SC" suffix alone, so check the details.',
      });
    } else if (normaliseName(person.name) !== normaliseName(name)) {
      issues.push({
        severity: 'repaired',
        sheet: 'Sch_Contacts',
        ref: `${rawName} → ${person.name}`,
        reason: 'Phone attached to a name spelled differently in the roster. Worth a glance.',
      });
    }
    person.phone = phone.replace(/\s/g, '');
    person.name = betterName(person.name, name);
  }
}

/**
 * The subcontractor payment sheets: fuller names, and what each one does.
 *
 * The name column repeats down a block of project rows, so a blank name means
 * "same person as above" rather than a row to skip.
 */
function readSubcontractorWork(
  rows: readonly Row[],
  people: People,
  nameColumn: number,
  /** Null where the sheet has no trade column, rather than a column that looks
      like one: "PAYMENT FOR" holds "FINAL PAYMENT", which is not a trade. */
  tradeColumn: number | null,
): void {
  let current: Person | null = null;
  for (const row of rows) {
    const values = cells(row);
    const raw = values[nameColumn] ?? '';
    if (raw !== '' && looksLikeAPerson(raw)) current = people.upsert('subcontractor', raw);
    const trade = tradeColumn === null ? '' : (values[tradeColumn] ?? '');
    if (current !== null && trade !== '' && looksLikeAPerson(trade)) {
      current.trades.add(titleCase(trade));
    }
  }
}

function titleCase(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function buildPeoplePlan(workbook: Workbook, issues: ImportIssue[]): PlannedPeople {
  const sheet = (name: string): Row[] => workbook[name] ?? [];
  const people = new People();

  // HR_Roster is the richest: name in column 1, with previous/current/upcoming
  // work either side of it.
  readRoster(sheet('HR_Roster'), people, 1, [2, 4, 8], 'HR_Roster', issues);
  // Eng_Technicians_List is a grid: name in column 0, projects across.
  readRoster(sheet('Eng_Technicians_List'), people, 0, [1, 2, 3, 4], 'Eng_Technicians_List', issues);

  readSubcontractorWork(sheet('Fin_Subcontractor_Payments'), people, 1, 3);
  readSubcontractorWork(sheet('Sch_SC_Payment_Tracker'), people, 0, null);

  readContacts(sheet('Sch_Contacts'), people, issues);

  const technicians: PlannedTechnician[] = [];
  const subcontractors: PlannedSubcontractor[] = [];

  for (const person of people.all()) {
    const key = `${person.kind === 'technician' ? 't' : 's'}-${normaliseName(person.name)
      .toLowerCase()
      .replace(/\s+/g, '-')}`;
    const note = [...person.notes].slice(0, 6).join(', ');

    if (person.kind === 'technician') {
      technicians.push({ key, name: person.name, phone: person.phone, note });
      if (person.phone === '') {
        issues.push({
          severity: 'warning',
          sheet: 'Sch_Contacts',
          ref: person.name,
          reason: 'No phone number anywhere in the workbook for this technician.',
        });
      }
      continue;
    }

    subcontractors.push({
      key,
      name: person.name,
      phone: person.phone,
      trades: [...person.trades],
      note,
    });
    // Not a nicety: with no TIN the withholding rate is 30% rather than 2% or
    // 3%, so a voucher raised before this is filled in pays the penalty rate.
    issues.push({
      severity: 'warning',
      sheet: 'Subcontractors',
      ref: person.name,
      reason:
        'No TIN in the workbook. Imported as having none, which sets withholding to 30% instead of 2% or 3% — add the TIN before raising a payment voucher.',
    });
  }

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  return { technicians: technicians.sort(byName), subcontractors: subcontractors.sort(byName) };
}
