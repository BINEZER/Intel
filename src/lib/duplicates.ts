/**
 * Finding records that are the same thing entered twice.
 *
 * WHERE DUPLICATES COME FROM
 *   Not from the importer. Its ids are derived from the workbook — client
 *   `Addis Towers PLC` always lands at `im-c-addis-towers-plc` — so running it
 *   again overwrites rather than duplicates, and that derivation has not
 *   changed since the first version.
 *
 *   They come from the same thing being typed in as well as imported, or typed
 *   in twice by two people on two days: "Addis Towers PLC" and "Addis Towers
 *   Plc." are one client to everybody except a string comparison.
 *
 * THE MATCHING RULE
 *   An identifier when there is one — a contract number, a project number, a
 *   lift code are meant to be unique, so two records sharing one are duplicates
 *   by definition and no judgement is involved.
 *
 *   A NAME otherwise, normalised: case folded, punctuation dropped, and the
 *   company-form words removed, because PLC / LLC / Ltd / S.C. are the part
 *   people type inconsistently and never the part that distinguishes two
 *   clients from each other.
 *
 * WHAT THIS MODULE WILL NOT DO
 *   It does not merge, and it does not choose for you beyond a suggestion. A
 *   merge moves references — invoices, projects, contracts — and a wrong merge
 *   is far harder to undo than a wrong delete. What it does is show the groups
 *   and mark which record to keep, and the keep rule is deliberately dull: the
 *   one other records already point at, then the oldest.
 */

/** A record this module can compare. */
export interface DuplicateCandidate {
  id: string;
  /** The identifier that is supposed to be unique, where the kind has one. */
  code: string | null;
  /** What a person calls it. */
  name: string;
  /** Milliseconds; the older record wins a tie. */
  createdAtMillis: number;
  /** How many other records point at this one. */
  references: number;
}

export interface DuplicateGroup {
  /** What made these match, for the person deciding. */
  reason: 'same code' | 'same name';
  /** The value they share, as matched. */
  key: string;
  /** The record to keep. */
  keep: DuplicateCandidate;
  /** The rest, oldest first. */
  extras: DuplicateCandidate[];
  /** Why this one is the keeper, in words. */
  why: string;
}

/** The company-form words people type inconsistently and never distinguish by. */
const COMPANY_FORMS =
  /\b(p\s?l\s?c|plc|llc|ltd|limited|inc|incorporated|co|company|s\s?c|share\s?company|pvt|private|enterprise|enterprises|trading|general)\b/g;

/**
 * A name reduced to what actually identifies it.
 *
 * Deliberately aggressive: this decides only what gets SHOWN as a possible
 * duplicate, and a false pair a person dismisses costs a glance, where a missed
 * pair costs a client record that stays split for ever.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[._]/g, ' ')
    .replace(COMPANY_FORMS, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** A code reduced to what identifies it: case and spacing are never meaningful. */
export function normaliseCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Which record of a group to keep.
 *
 * The one other records already point at, because keeping it means no
 * reference has to move. Where that does not decide it — none of them is
 * referenced, or several are — the oldest wins, since it is the one whose id
 * is most likely to be written down somewhere outside this app.
 */
function chooseKeeper(group: readonly DuplicateCandidate[]): { keep: DuplicateCandidate; why: string } {
  const mostReferenced = [...group].sort(
    (a, b) => b.references - a.references || a.createdAtMillis - b.createdAtMillis,
  );
  const best = mostReferenced[0] as DuplicateCandidate;
  const tied = group.filter((c) => c.references === best.references).length > 1;

  if (best.references > 0 && !tied) {
    return {
      keep: best,
      why: `Kept because ${best.references} other record${best.references === 1 ? '' : 's'} already point at it.`,
    };
  }
  const oldest = [...group].sort((a, b) => a.createdAtMillis - b.createdAtMillis)[0] as DuplicateCandidate;
  return {
    keep: oldest,
    why:
      best.references === 0
        ? 'Kept because it is the oldest; nothing points at any of them.'
        : 'Kept because it is the oldest of the ones being pointed at.',
  };
}

/**
 * Group the records that look like the same thing.
 *
 * Code matches are found first and win: two records sharing a contract number
 * are duplicates whatever their names say, and reporting the same pair twice
 * under two headings makes a list nobody can act on.
 */
export function findDuplicates(records: readonly DuplicateCandidate[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const spoken = new Set<string>();

  const byCode = new Map<string, DuplicateCandidate[]>();
  for (const record of records) {
    if (record.code === null) continue;
    const key = normaliseCode(record.code);
    if (key === '') continue;
    byCode.set(key, [...(byCode.get(key) ?? []), record]);
  }
  for (const [key, list] of byCode) {
    if (list.length < 2) continue;
    const { keep, why } = chooseKeeper(list);
    for (const record of list) spoken.add(record.id);
    groups.push({
      reason: 'same code',
      key,
      keep,
      extras: list.filter((c) => c.id !== keep.id).sort((a, b) => a.createdAtMillis - b.createdAtMillis),
      why,
    });
  }

  const byName = new Map<string, DuplicateCandidate[]>();
  for (const record of records) {
    if (spoken.has(record.id)) continue;
    const key = normaliseName(record.name);
    if (key === '') continue;
    byName.set(key, [...(byName.get(key) ?? []), record]);
  }
  for (const [key, list] of byName) {
    if (list.length < 2) continue;
    const { keep, why } = chooseKeeper(list);
    groups.push({
      reason: 'same name',
      key,
      keep,
      extras: list.filter((c) => c.id !== keep.id).sort((a, b) => a.createdAtMillis - b.createdAtMillis),
      why,
    });
  }

  // Most duplicated first: the worst offender is the one worth fixing now.
  return groups.sort((a, b) => b.extras.length - a.extras.length || a.key.localeCompare(b.key));
}

/** How many records could be removed, across every group. */
export function extraCount(groups: readonly DuplicateGroup[]): number {
  return groups.reduce((sum, group) => sum + group.extras.length, 0);
}
