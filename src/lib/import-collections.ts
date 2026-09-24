/**
 * Read what clients have actually paid, from the collection tracker.
 *
 * WHY NOT `PL_Payment`, WHICH LOOKS LIKE THE OBVIOUS SOURCE
 *   It has File Name, Phase, Amount, Paid and Remaining, and it replaced the
 *   `Project_Finance` sheet the importer used to read. It is not a receipts
 *   ledger. Its figures repeat byte for byte across unrelated clients —
 *   4,701,920.46 billed and 4,231,728.414 paid appears against fifteen
 *   different names, always exactly 90% — because it is a PRICE TEMPLATE with
 *   the schedule percentages filled in, not a record of money received.
 *
 *   Read as cash it claims ETB 876 million collected against ETB 927 million
 *   contracted. Importing that would have invented a payment history, put a
 *   false figure into every receivable and every VAT return, and looked
 *   entirely plausible while doing it.
 *
 * WHY THE TRACKER IS THE REAL THING
 *   `Ops_Collection_Status` carries one block per client and a row per payment
 *   stage — AGREEMENT (ADVANCE), BILL OF LOADING, START OF INSTALLATION,
 *   HANDOVER — with the stage's amount, THE DATE the money arrived, and a
 *   received figure filled in only for stages actually paid. The proportions
 *   differ per client, which is what a record of real events looks like, and
 *   its TOTAL CONTRACT VALUE agrees with `Agreements_Master` where the template
 *   disagrees with both.
 *
 * MATCHED BY NAME, NOT BY VALUE
 *   The old matcher used the contract value as a fingerprint, on the grounds
 *   that a figure carrying cents identifies an agreement about as well as a
 *   serial number. That is false here: the same standard price recurs across
 *   clients, and on this workbook value-matching disagreed with name-matching
 *   on 58 of 104 blocks — each disagreement one client's money posted against
 *   another client's contract. The client's name is the identity; the value is
 *   kept only to cross-check it.
 */

import { date, num, text, type Row } from './import-master.js';

export type { Row };

/** One stage of a client's payment schedule. */
export interface CollectionStage {
  /** `AGREEMENT (ADVANCE)`, `HANDOVER`, and so on, as the sheet spells it. */
  stage: string;
  /** What the stage is worth. */
  amountBirr: number | null;
  /** What has actually come in against it. Null means nothing yet. */
  receivedBirr: number | null;
  /** The day it arrived, where the tracker records one. */
  paidOn: Date | null;
}

/** One client's block in the tracker. */
export interface CollectionBlock {
  /** The tracker's name for the client, e.g. `ATO BEDRUDIN KEDIR`. */
  client: string;
  /** The contract value as the tracker states it, for cross-checking. */
  contractValueBirr: number | null;
  /** The block's own total of what has been collected. */
  statedCollectedBirr: number | null;
  stages: CollectionStage[];
  /** Section the block sat under, e.g. `NEW`. Kept as provenance. */
  section: string | null;
}

const NO = ['NO.', 'NO', 'No.'];
const PROJECT = ['PROJECT', 'Project'];
const VALUE = ['TOTAL CONTRACT VALUE', 'Total Contract Value'];
const RECEIVED = ['COMPLETED PAYMENT', 'Completed Payment'];
const WHEN = ['DATES (m/d/y)', 'DATES', 'Dates'];

/**
 * Is this the row that opens a client's block?
 *
 * The tracker numbers its clients and leaves the number blank on the stage rows
 * beneath, so a number in that column with a name beside it is a new client. A
 * row whose number is a WORD — `NEW` — is a section heading, which is why the
 * test is for a number rather than for "not empty".
 */
function startsBlock(row: Row): boolean {
  return num(row, ...NO) !== null && text(row, ...PROJECT) !== '';
}

/** A section heading: a word where the numbers go, and nothing else on the row. */
function sectionOf(row: Row): string | null {
  if (num(row, ...NO) !== null) return null;
  const label = text(row, ...NO);
  if (label === '') return null;
  return text(row, ...PROJECT) === '' ? label : null;
}

/**
 * Split the tracker into one block per client.
 *
 * Stage rows are taken as they come rather than matched against a list of known
 * stage names: the schedule differs between contracts — some have a bill of
 * loading, some go straight to installation — and a stage this code has never
 * heard of is still money.
 */
export function collectionBlocks(rows: readonly Row[]): CollectionBlock[] {
  const blocks: CollectionBlock[] = [];
  let current: CollectionBlock | null = null;
  let section: string | null = null;

  for (const row of rows) {
    const heading = sectionOf(row);
    if (heading !== null) {
      section = heading;
      continue;
    }

    if (startsBlock(row)) {
      if (current !== null) blocks.push(current);
      current = {
        client: text(row, ...PROJECT),
        contractValueBirr: num(row, ...VALUE),
        statedCollectedBirr: num(row, ...RECEIVED),
        stages: [],
        section,
      };
      continue;
    }

    if (current === null) continue;
    const stage = text(row, ...PROJECT);
    if (stage === '') continue;
    current.stages.push({
      stage,
      amountBirr: num(row, ...VALUE),
      receivedBirr: num(row, ...RECEIVED),
      paidOn: date(row, ...WHEN),
    });
  }

  if (current !== null) blocks.push(current);
  return blocks;
}

/**
 * What a block says has been collected.
 *
 * The stages are the evidence and the block's own total is a formula over them,
 * so the stages win where the two disagree — but only the stages that name a
 * figure. A stage with an amount and no received column is unpaid, not paid in
 * full, and that distinction is the whole receivable.
 */
export function collectedFrom(block: CollectionBlock): number {
  return block.stages.reduce((sum, stage) => sum + (stage.receivedBirr ?? 0), 0);
}

/** Stages with money against them, for a receipt trail. */
export function receiptsOf(block: CollectionBlock): CollectionStage[] {
  return block.stages.filter((stage) => (stage.receivedBirr ?? 0) > 0);
}

/**
 * Normalise a name for matching.
 *
 * Case, punctuation and runs of spaces go; the words stay in order. Honorifics
 * are deliberately NOT stripped — "Ato Mohammed Hussain" and "Ato Mohammed
 * Hussain new" are two different agreements in this workbook, and a
 * normalisation aggressive enough to merge them would merge money too.
 */
export function normaliseName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Do two spellings of a name refer to the same client?
 *
 * WHY A TOLERANT COMPARISON IS NEEDED AT ALL
 *   The tracker and the agreement register are typed by different people.
 *   `MULUWONGEL` and `Mulu Wongel`, `FEDAWAK` and `Feda Wak PLC`, `ATO MILION`
 *   and `Ato Million`, `DR. TOLLU DURESA` and `Dr. Tolu Duressa` are each one
 *   client. Exact matching found 7 of 53.
 *
 * WHY IT IS NOT MERELY "CLOSE ENOUGH"
 *   This decides whose money is whose, so the name is never the only key — it
 *   CORROBORATES a candidate already picked by matching the contract value to
 *   the cent. Its job is to catch the case where two unrelated clients happen to
 *   have been sold the same standard package for the same price, which really
 *   happens in this workbook: `GIFT RE HQ` and `HIYA (CAR)` both match one
 *   agreement by value alone, and the name is what refuses them.
 *
 * WHAT COUNTS AS CORROBORATION
 *   Spacing and punctuation are ignored outright — they carry no information
 *   here. Beyond that: one name being the start of the other (a register entry
 *   with `PLC` or a trading name appended), a distinctive word in common, or a
 *   difference of one or two letters across the opening stretch, which is the
 *   shape of a transliteration slip. Anything further apart is left unmatched
 *   and reported, because an unimported receipt is a gap someone can see and
 *   fill, while a misattributed one is a wrong figure nobody will question.
 */

/** Words that say nothing about WHICH client this is. */
const NOISE = new Set([
  'ato', 'wro', 'wo', 'dr', 'mr', 'mrs', 'ms',
  'plc', 'llc', 'ltd', 'sc', 'inc',
  'real', 'estate', 'hotels', 'hotel', 'trading', 'construction', 'building',
  'buildings', 'rent', 'sales', 'general', 'and', 'the', 'new', 'friends',
]);

function letters(value: string): string {
  return normaliseName(value).replace(/[^a-z0-9]/g, '');
}

function distinctiveWords(value: string): Set<string> {
  return new Set(
    normaliseName(value)
      .split(' ')
      .filter((word) => word.length > 2 && !NOISE.has(word)),
  );
}

/** Levenshtein distance, capped: beyond the cap the exact figure is irrelevant. */
function within(a: string, b: string, cap: number): boolean {
  if (Math.abs(a.length - b.length) > cap) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
    if (Math.min(...current) > cap) return false;
  }
  return (previous[b.length] ?? cap + 1) <= cap;
}

export function namesCorroborate(a: string, b: string): boolean {
  const left = letters(a);
  const right = letters(b);
  // Too little to go on. Two or three letters match by accident.
  if (left.length < 4 || right.length < 4) return false;
  if (left === right) return true;
  if (left.startsWith(right) || right.startsWith(left)) return true;

  for (const word of distinctiveWords(a)) {
    if (distinctiveWords(b).has(word)) return true;
  }

  // A transliteration slip, measured over the opening stretch so a trading name
  // appended to one side cannot push the two apart.
  const span = Math.min(12, left.length, right.length);
  return within(left.slice(0, span), right.slice(0, span), 2);
}

/** An agreement, as much of it as the matching needs. */
export interface AgreementForMatching {
  id: string;
  name: string;
  /** The contract value in birr, from the ETB row of the register. */
  valueBirr: number | null;
}

export interface MatchedCollection {
  agreementId: string;
  /** The tracker's name for the client, which is often not the register's. */
  client: string;
  collectedBirr: number;
  receipts: CollectionStage[];
}

export interface CollectionMatchResult {
  matched: MatchedCollection[];
  /** Blocks left out, each with the reason, for the import's issue list. */
  unmatched: Array<{ client: string; reason: string; candidate?: string }>;
  /**
   * Matches where the two spellings differed. Reported even though they were
   * accepted: this is fuzzy matching of money, and the only honest way to do it
   * is to show every judgement it made.
   */
  spellingDiffered: Array<{ client: string; agreementId: string; registerName: string }>;
}

/**
 * Attach each tracker block to an agreement.
 *
 * TWO KEYS, BOTH REQUIRED
 *   The contract value picks the candidate — it is unique across the register —
 *   and the client's name has to corroborate it. Either alone is unsafe here:
 *   names are spelled differently in the two sheets, and the same standard price
 *   is sold to different clients.
 *
 * TO THE NEAREST BIRR, NOT THE CENT
 *   The tracker rounds where the register does not: 40,754,098.2 against
 *   40,754,098.19, and 4,539,918.28 against 4,539,918.3. Matched on the cent,
 *   six clients were refused over a rounding difference of one or two cents.
 *   Whole birr still distinguishes all 107 agreements from one another — the
 *   figures differ by thousands, not by pennies — and the name remains a second
 *   key, so the tolerance cannot on its own let a wrong match through.
 *
 *   A block that cannot satisfy both is reported and left out. No receipt is
 *   posted on a guess.
 */
export function matchCollections(
  blocks: readonly CollectionBlock[],
  agreements: readonly AgreementForMatching[],
): CollectionMatchResult {
  const byBirr = new Map<number, AgreementForMatching[]>();
  for (const agreement of agreements) {
    if (agreement.valueBirr === null) continue;
    const birr = Math.round(agreement.valueBirr);
    const list = byBirr.get(birr);
    if (list === undefined) byBirr.set(birr, [agreement]);
    else list.push(agreement);
  }

  const matched: MatchedCollection[] = [];
  const unmatched: CollectionMatchResult['unmatched'] = [];
  const spellingDiffered: CollectionMatchResult['spellingDiffered'] = [];
  const taken = new Map<string, string>();

  for (const block of blocks) {
    const collected = collectedFrom(block);

    if (block.contractValueBirr === null) {
      unmatched.push({
        client: block.client,
        reason: 'The tracker gives no contract value for this client, so there is nothing to match it to an agreement by.',
      });
      continue;
    }

    const candidates = byBirr.get(Math.round(block.contractValueBirr)) ?? [];
    if (candidates.length === 0) {
      unmatched.push({
        client: block.client,
        reason: `No agreement has a contract value of ${block.contractValueBirr.toLocaleString()} ETB, so there is no safe way to tell whose money this is.`,
      });
      continue;
    }

    const agreed = candidates.filter((c) => namesCorroborate(block.client, c.name));
    if (agreed.length === 0) {
      unmatched.push({
        client: block.client,
        reason: `The contract value matches ${candidates.map((c) => c.id).join(', ')}, but the name does not, so the match is not trusted.`,
        candidate: candidates.map((c) => `${c.id} (${c.name})`).join(', '),
      });
      continue;
    }
    if (agreed.length > 1) {
      unmatched.push({
        client: block.client,
        reason: `Both value and name match ${agreed.length} agreements (${agreed.map((c) => c.id).join(', ')}), so the owner is ambiguous.`,
      });
      continue;
    }

    const winner = agreed[0] as AgreementForMatching;
    const already = taken.get(winner.id);
    if (already !== undefined) {
      // Two tracker blocks on one agreement. Collections only go up, so the
      // fuller one is the later snapshot — but it is said out loud, because it
      // can equally mean two clients have been merged by mistake.
      const existing = matched.find((m) => m.agreementId === winner.id);
      if (existing !== undefined && collected > existing.collectedBirr) {
        existing.collectedBirr = collected;
        existing.receipts = receiptsOf(block);
        existing.client = block.client;
      }
      unmatched.push({
        client: block.client,
        reason: `A second block matches ${winner.id}, already claimed by "${already}". The larger collected figure is used; check whether these are two clients.`,
      });
      continue;
    }

    taken.set(winner.id, block.client);
    if (normaliseName(block.client) !== normaliseName(winner.name)) {
      spellingDiffered.push({
        client: block.client,
        agreementId: winner.id,
        registerName: winner.name,
      });
    }
    matched.push({
      agreementId: winner.id,
      client: block.client,
      collectedBirr: collected,
      receipts: receiptsOf(block),
    });
  }

  return { matched, unmatched, spellingDiffered };
}
