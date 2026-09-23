/**
 * Read the IntelMotion consolidated master workbook into records the app can
 * store.
 *
 * WHY THIS IS NOT A STRAIGHT COPY
 *   The workbook is a merge of six years of separate spreadsheets, and the
 *   merge left damage that a naive import would carry into the database and
 *   then into the CEO's reports. Three faults matter, and each one is repaired
 *   here rather than worked around later:
 *
 *   1. `Agreement_Payment_Plan` keys agreements as `AGR-2019-01` while
 *      `Agreements_Master` keys them `AGR-2019-001`. Not one row joins as
 *      written; every row joins once the sequence is re-padded.
 *
 *   2. `Project_Finance` and `Payment_Transactions` carry an `Agreement_ID`
 *      that is WRONG ON EVERY ROW — the payment blocks were renumbered by
 *      alphabetical position at some point, so the money sits under a
 *      different client's id. The blocks are recovered by matching each
 *      block's `Total` against the contract value, which is a to-the-cent
 *      fingerprint. The sheet also repeats each agreement's block about six
 *      times, once per merged source file, so the copies are collapsed to the
 *      fullest one instead of added together. Blocks that do not resolve to
 *      exactly one agreement are left out, because putting one client's money
 *      against another client's contract is far worse than having no payment
 *      history — which is why only a minority of contracts come out of this
 *      with a collection figure at all.
 *
 *   3. Eight rows carry a USD figure under an Agreement_ID that already
 *      belongs to an ETB agreement. These are equipment purchase costs, not
 *      client contracts; importing them would both duplicate a contract number
 *      and inflate the order book. They are excluded and reported.
 *
 * EVERYTHING EXCLUDED IS REPORTED. A silent drop is indistinguishable from a
 * bug, so every row this file refuses is returned in `issues` with the reason,
 * and the page shows them before anything is written.
 */

import { DEFAULT_SUPPLY_INSTALL_SHARES, type MilestoneShare } from './milestones.js';
import { birrToSantim } from './money.js';
import { rescaleWeights } from './stage-edit.js';
import type { ContractStatus } from './schema.js';
import type { ProjectStatusValue } from './status.js';
import {
  buildPeoplePlan,
  type PlannedSubcontractor,
  type PlannedTechnician,
} from './import-people.js';

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

/** One spreadsheet row: header name -> cell value. */
export type Row = Record<string, unknown>;
/** The parsed workbook: sheet name -> rows. */
export type Workbook = Record<string, Row[]>;

export interface ImportOptions {
  /**
   * Whether the `Contract_Value` column already contains VAT.
   *
   * There is nothing in the workbook that settles this, and it moves every
   * figure in the system by 15%, so it is asked rather than guessed.
   */
  vatTreatment: 'inclusive' | 'exclusive';
  vatRateBps: number;
}

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

export type IssueSeverity = 'skipped' | 'warning' | 'repaired';

export interface ImportIssue {
  severity: IssueSeverity;
  sheet: string;
  /** Whatever identifies the row to a person: an id, a name. */
  ref: string;
  reason: string;
}

export interface PlannedClient {
  key: string;
  name: string;
  city: string;
  contactName: string | null;
}

export interface PlannedProgram {
  key: string;
  programNo: string;
  name: string;
  clientKey: string;
  plannedStart: Date | null;
  plannedEnd: Date | null;
}

export interface PlannedMilestone {
  name: string;
  shareBps: number;
  /** Set where the payment history says this term has been settled. */
  paid: boolean;
}

export interface PlannedContract {
  key: string;
  sourceId: string;
  clientKey: string;
  contractNo: string;
  title: string;
  status: ContractStatus;
  signedDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  /** The figure as written in the sheet, in santim, before VAT is split out. */
  valueSantim: number;
  valueEnteredInclusive: boolean;
  vatRateBps: number;
  siteCity: string;
  milestones: PlannedMilestone[];
  /** Where a payment block was matched, what it said had been collected. */
  collectedSantim: number | null;
  /**
   * Equipment the client pays the factory for directly, in cents.
   *
   * The workbook carries these as a second row under the same Agreement_ID,
   * priced in USD. They used to be dropped, which lost the size of the job;
   * they are now attached to the contract as data. Never converted to birr and
   * never part of any total — see `lib/direct-supply.ts`.
   */
  equipmentPaidDirectUsdCents: number | null;
  notes: string;
}

export interface PlannedProject {
  key: string;
  sourceId: string;
  contractKey: string;
  clientKey: string;
  programKey: string | null;
  projectNo: string;
  title: string;
  tag: string;
  status: ProjectLifecycle;
  /** The stage word as the workbook wrote it: Shipping, Installation, Warranty. */
  sourceStage: string;
  capacityKg: number | null;
  stops: number | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  siteCity: string;
  remarks: string;
}

export interface PlannedUnit {
  key: string;
  projectKey: string;
  clientKey: string;
  tag: string;
  siteName: string;
  city: string;
  klNumber: string | null;
  capacityKg: number | null;
  stops: number | null;
  speedMps: number | null;
  model: string | null;
  status: 'under_installation' | 'in_service';
}

export interface ImportPlan {
  clients: PlannedClient[];
  programs: PlannedProgram[];
  contracts: PlannedContract[];
  projects: PlannedProject[];
  units: PlannedUnit[];
  technicians: PlannedTechnician[];
  subcontractors: PlannedSubcontractor[];
  issues: ImportIssue[];
}

// ---------------------------------------------------------------------------
// Cell readers
// ---------------------------------------------------------------------------

/** Header names in this workbook carry stray spaces; match on the trimmed name. */
function pick(row: Row, ...names: string[]): unknown {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === name.trim().toLowerCase()) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
    }
  }
  return undefined;
}

function text(row: Row, ...names: string[]): string {
  const value = pick(row, ...names);
  if (value === undefined) return '';
  if (value instanceof Date) return '';
  return String(value).trim();
}

function num(row: Row, ...names: string[]): number | null {
  const value = pick(row, ...names);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    // Figures arrive as "1,360,299.24" from some of the source files.
    const parsed = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) && value.trim() !== '' ? parsed : null;
  }
  return null;
}

const DAY_MS = 86_400_000;

/**
 * The day an Excel date cell MEANT, whatever timezone the browser is in.
 *
 * THE BUG THIS EXISTS TO KILL
 *   An Excel date is a wall-clock day with no timezone at all. SheetJS turns
 *   the serial into a JS `Date` by way of LOCAL time, so in Addis Ababa
 *   (UTC+3) serial 44270 — 15 March 2021 — arrives as
 *
 *       2021-03-14T20:59:44.000Z
 *
 *   Read the day off that with either local or UTC getters and you get the
 *   14th. Every date in the imported workbook was one day early, and only for
 *   users at a positive offset: it is correct in UTC, in New York and in
 *   Sydney, which is exactly why it survived every test and every review.
 *   Reproduced at UTC+3 and at UTC+5:30 before this was written.
 *
 * WHY IT ROUNDS
 *   Undoing the offset lands on 23:59:44, not midnight — SheetJS's serial
 *   arithmetic drifts by seconds. Rounding to the nearest midnight absorbs
 *   both the offset and the drift. Taking the floor would re-introduce the
 *   same off-by-one it is here to remove.
 *
 * `offsetMinutes` is injectable so the tests can pin every timezone down
 * without depending on the one the test runner happens to be in.
 */
export function excelWallClockDate(
  value: Date,
  offsetMinutes: number = value.getTimezoneOffset(),
): Date {
  const shifted = value.getTime() - offsetMinutes * 60_000;
  return new Date(Math.round(shifted / DAY_MS) * DAY_MS);
}

function date(row: Row, ...names: string[]): Date | null {
  const value = pick(row, ...names);
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return excelWallClockDate(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    // A bare `YYYY-MM-DD` is parsed as UTC midnight by spec, so it is already
    // the day it says. Anything else ("15 March 2021", "3/15/2021") is parsed
    // as LOCAL time, and its day has to be read with local getters to match.
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(text);
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return iso
      ? new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()))
      : new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** A stable, filesystem-safe key. Re-running the import must reuse it. */
export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * `AGR-2019-01` and `AGR-2019-001` are the same agreement.
 *
 * The payment-plan sheet writes the sequence unpadded and every other sheet
 * pads it to three digits. Without this, not one payment plan finds its
 * contract — and the failure is silent, because an agreement with no plan just
 * looks like an agreement nobody wrote terms for.
 */
export function normaliseAgreementId(value: unknown): string | null {
  const match = /^AGR-(\d{4})-(\d+)$/i.exec(String(value ?? '').trim());
  if (match === null) return null;
  return `AGR-${match[1]}-${String(Number(match[2])).padStart(3, '0')}`;
}

export function normaliseProjectId(value: unknown): string | null {
  const match = /^PRJ-(\d{4})-(\d+)$/i.exec(String(value ?? '').trim());
  if (match === null) return null;
  return `PRJ-${match[1]}-${match[2]}`;
}

/** Clients are grouped by name; the workbook has no client table of its own. */
function clientKeyOf(name: string): string {
  return slug(name.replace(/\s+/g, ' ').trim());
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

const CONTRACT_STATUS: Record<string, ContractStatus> = {
  draft: 'draft',
  active: 'active',
  service: 'active',
  closed: 'completed',
  completed: 'completed',
  cancelled: 'terminated',
  terminated: 'terminated',
  suspended: 'suspended',
  'on hold': 'suspended',
};

function contractStatusOf(raw: string): ContractStatus {
  return CONTRACT_STATUS[raw.trim().toLowerCase()] ?? 'active';
}

/**
 * The workbook records where a job has reached — Shipping, Installation,
 * Warranty. The app records a lifecycle — planned, in progress, completed.
 * They are different questions, so the stage is mapped to a lifecycle here and
 * the original word is kept on the project as its stage, rather than one being
 * bent into the other.
 */
const PROJECT_LIFECYCLE: Record<string, ProjectLifecycle> = {
  planning: 'planned',
  procurement: 'in_progress',
  shipping: 'in_progress',
  installation: 'in_progress',
  'testing & commissioning': 'in_progress',
  testing: 'in_progress',
  // Warranty means handed over and running: the installation job is done.
  warranty: 'completed',
  completed: 'completed',
  'on hold': 'on_hold',
  cancelled: 'cancelled',
};

export type ProjectLifecycle = ProjectStatusValue;

function projectLifecycleOf(raw: string): ProjectLifecycle {
  return PROJECT_LIFECYCLE[raw.trim().toLowerCase()] ?? 'planned';
}

// ---------------------------------------------------------------------------
// Payment blocks
// ---------------------------------------------------------------------------

/**
 * `Project_Finance` packs its real content into a remarks string:
 * `Phase=Advance; %=0.5; Amount=680149.62; Remaining=0.0`.
 */
export function parseFinanceRemarks(remarks: string): {
  phase: string | null;
  amount: number | null;
} {
  const phase = /Phase=([^;]*)/.exec(remarks);
  const amount = /Amount=([0-9.]+)/.exec(remarks);
  return {
    phase: phase?.[1]?.trim() || null,
    amount: amount?.[1] !== undefined ? Number(amount[1]) : null,
  };
}

interface FinanceBlock {
  /** The block's `Total` row — the contract value, used as the fingerprint. */
  totalBirr: number | null;
  paidBirr: number;
  rowCount: number;
}

/**
 * Split the finance sheet into per-agreement blocks.
 *
 * Each agreement's rows run in order and close with a `Total` row. The
 * `Agreement_ID` column cannot be used to group them — it is wrong on every
 * row — but the block boundaries are intact.
 */
export function financeBlocks(rows: readonly Row[]): FinanceBlock[] {
  const blocks: FinanceBlock[] = [];
  let paid = 0;
  let count = 0;
  let started = false;

  for (const row of rows) {
    const { phase, amount } = parseFinanceRemarks(text(row, 'Finance_Remarks'));
    if (phase === null && !started) continue;
    started = true;
    count += 1;

    if (phase === 'Total') {
      blocks.push({ totalBirr: amount, paidBirr: paid, rowCount: count });
      paid = 0;
      count = 0;
      started = false;
      continue;
    }
    const status = text(row, 'Payment_Status').toLowerCase();
    const paidAmount = num(row, 'Amount_Paid');
    if (status === 'paid' && paidAmount !== null) paid += paidAmount;
  }
  return blocks;
}

/**
 * Match payment blocks to agreements by contract value.
 *
 * A contract value carries cents — 4,642,074.42 — so it identifies an
 * agreement about as well as a serial number.
 *
 * DUPLICATE BLOCKS
 *   The finance sheet is a merge of six source files and carries the same
 *   agreement's block roughly six times over, each a snapshot from a different
 *   date. Adding them up would report a client as having paid six times what
 *   they owe. Collections only ever go up, so for each agreement the fullest
 *   snapshot — the largest collected figure — is the current one, and the rest
 *   are older copies of it.
 *
 * Where a value matches no agreement, or more than one, the block is dropped
 * rather than guessed at: one client's money against another client's contract
 * is far worse than no payment history at all.
 */
function resolvePayments(
  blocks: readonly FinanceBlock[],
  contractValueBirr: ReadonlyMap<string, number>,
  issues: ImportIssue[],
): Map<string, number> {
  const byValue = new Map<number, string[]>();
  for (const [id, value] of contractValueBirr) {
    const cents = Math.round(value * 100);
    const list = byValue.get(cents);
    if (list === undefined) byValue.set(cents, [id]);
    else list.push(id);
  }

  // Collapse repeated snapshots of the same agreement to the fullest one.
  const bestByValue = new Map<number, number>();
  for (const block of blocks) {
    if (block.totalBirr === null || block.totalBirr <= 0) continue;
    const cents = Math.round(block.totalBirr * 100);
    bestByValue.set(cents, Math.max(bestByValue.get(cents) ?? 0, block.paidBirr));
  }

  const collected = new Map<string, number>();
  for (const [cents, paid] of bestByValue) {
    const owners = byValue.get(cents) ?? [];
    if (owners.length === 1) {
      const owner = owners[0] as string;
      // Cash cannot exceed the contract it is paying for; where the sheet says
      // otherwise the figure is capped and the contract is flagged rather than
      // silently showing a negative receivable.
      const value = contractValueBirr.get(owner) ?? 0;
      if (paid > value + 0.01) {
        issues.push({
          severity: 'warning',
          sheet: 'Project_Finance',
          ref: owner,
          reason: `Payments recorded (${paid.toLocaleString()} ETB) exceed the contract value (${value.toLocaleString()} ETB); capped at the contract value.`,
        });
      }
      collected.set(owner, Math.min(paid, value));
      continue;
    }
    issues.push({
      severity: 'skipped',
      sheet: 'Project_Finance',
      ref: `block totalling ${(cents / 100).toLocaleString()} ETB`,
      reason:
        owners.length === 0
          ? 'Payment block matches no contract value, so there is no safe way to tell whose money it is.'
          : `Payment block's total matches ${owners.length} contracts (${owners.join(', ')}), so the owner is ambiguous.`,
    });
  }
  return collected;
}

/**
 * Walk cash down the payment schedule in order.
 *
 * The workbook records what has been collected per agreement but not which
 * term each receipt settled. Advance is collected first and the schedule runs
 * in sequence, so cash is applied term by term until it runs out. A term is
 * only marked paid when the money covers it in full — a part-paid term stays
 * open, which is the answer that leaves the receivable visible.
 */
export function applyCollectedToMilestones(
  shares: readonly MilestoneShare[],
  valueSantim: number,
  collectedSantim: number,
): PlannedMilestone[] {
  let left = collectedSantim;
  return shares.map((share) => {
    const due = Math.round((valueSantim * share.shareBps) / 10_000);
    const paid = left >= due && due > 0;
    if (paid) left -= due;
    return { name: share.name, shareBps: share.shareBps, paid };
  });
}

// ---------------------------------------------------------------------------
// Payment schedules
// ---------------------------------------------------------------------------

/**
 * The payment terms written for each agreement.
 *
 * Percentages in the sheet are fractions (0.4 = 40%) and do not always total
 * 100 — rounding, and a few schedules that were edited by hand. They are
 * rescaled to exactly 10000 bps, because a schedule with a gap in it is a
 * contract nobody can invoice against.
 */
export function paymentSchedules(
  rows: readonly Row[],
  issues: ImportIssue[],
): Map<string, MilestoneShare[]> {
  const byAgreement = new Map<string, { seq: number; name: string; fraction: number }[]>();

  for (const row of rows) {
    const agreementId = normaliseAgreementId(pick(row, 'Agreement_ID'));
    if (agreementId === null) continue;
    const fraction = num(row, '%');
    if (fraction === null || fraction <= 0) continue;
    const list = byAgreement.get(agreementId) ?? [];
    list.push({
      seq: num(row, 'Term_No') ?? list.length + 1,
      name: text(row, 'Term_Name') || text(row, 'Term_Code') || `Payment ${list.length + 1}`,
      fraction,
    });
    byAgreement.set(agreementId, list);
  }

  const out = new Map<string, MilestoneShare[]>();
  for (const [agreementId, terms] of byAgreement) {
    terms.sort((a, b) => a.seq - b.seq);
    const raw = terms.map((t) => Math.round(t.fraction * 10_000));
    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    if (Math.abs(total - 10_000) > 100) {
      // Some schedules hold birr amounts in the percent column rather than
      // fractions. Either way the terms are relative weights and rescaling
      // gives the right split — but the two cases need different wording, or
      // the report reads as though a schedule was 7,709,901% paid.
      const looksLikeAmounts = total > 50_000;
      issues.push({
        severity: 'repaired',
        sheet: 'Agreement_Payment_Plan',
        ref: agreementId,
        reason: looksLikeAmounts
          ? 'Payment terms were written as birr amounts rather than percentages; converted to their proportional shares.'
          : `Payment terms totalled ${(total / 100).toFixed(1)}% instead of 100%; rescaled so the schedule closes.`,
      });
    }
    const balanced = rescaleWeights(raw, 10_000);
    out.set(
      agreementId,
      terms.map((t, i) => ({ name: t.name, shareBps: balanced[i] as number })),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export function buildImportPlan(workbook: Workbook, options: ImportOptions): ImportPlan {
  const issues: ImportIssue[] = [];
  const sheet = (name: string): Row[] => workbook[name] ?? [];

  // --- agreements -> clients + contracts -----------------------------------

  const agreementRows = sheet('Agreements_Master');
  const contracts: PlannedContract[] = [];
  const clients = new Map<string, PlannedClient>();
  const seenAgreement = new Set<string>();
  const contractValueBirr = new Map<string, number>();
  /**
   * Dollar figures found under an agreement id, by id.
   *
   * Collected as the rows go past and attached afterwards, because the USD row
   * may sit either side of the ETB one in the sheet and neither order is wrong.
   */
  const directUsdCents = new Map<string, number>();

  for (const row of agreementRows) {
    const name = text(row, 'Agreement_Name');
    const agreementId = normaliseAgreementId(pick(row, 'Agreement_ID'));
    const value = num(row, 'Contract_Value');
    const currency = text(row, 'Currency').toUpperCase();

    if (agreementId === null) {
      issues.push({
        severity: 'skipped',
        sheet: 'Agreements_Master',
        ref: name || '(blank row)',
        reason: 'No Agreement_ID — the row is a stray cell rather than an agreement.',
      });
      continue;
    }
    if (currency === 'USD') {
      // NOT a contract of ours: it is the lift, bought by the client straight
      // from the factory. Importing it as a contract would duplicate the
      // agreement and inflate the order book — so it is kept as a figure ON
      // that agreement instead, in cents, with no birr equivalent anywhere.
      if (value !== null && value > 0) {
        directUsdCents.set(agreementId, Math.round(value * 100));
        issues.push({
          severity: 'repaired',
          sheet: 'Agreements_Master',
          ref: `${agreementId} ${name}`,
          reason:
            'USD figure under an existing Agreement_ID — recorded on the contract as equipment the client pays the manufacturer for directly. It is data only and is in no total.',
        });
      } else {
        issues.push({
          severity: 'skipped',
          sheet: 'Agreements_Master',
          ref: `${agreementId} ${name}`,
          reason: 'USD row with no figure on it — nothing to record.',
        });
      }
      continue;
    }
    if (seenAgreement.has(agreementId)) {
      issues.push({
        severity: 'skipped',
        sheet: 'Agreements_Master',
        ref: `${agreementId} ${name}`,
        reason: 'Duplicate Agreement_ID; the first row with this id was kept.',
      });
      continue;
    }
    if (value === null || value <= 0) {
      issues.push({
        severity: 'warning',
        sheet: 'Agreements_Master',
        ref: `${agreementId} ${name}`,
        reason: 'No contract value in the sheet; imported at zero so the job exists, but it needs a figure.',
      });
    }
    seenAgreement.add(agreementId);

    const city = text(row, 'Location');
    const clientKey = clientKeyOf(name || agreementId);
    if (!clients.has(clientKey)) {
      clients.set(clientKey, {
        key: clientKey,
        name: name || agreementId,
        city,
        contactName: text(row, 'Contact Person') || null,
      });
    }

    const signed = date(row, 'Agreement_Date');
    const completion = date(row, 'Completion date');
    const valueBirr = value ?? 0;
    if (valueBirr > 0) contractValueBirr.set(agreementId, valueBirr);

    contracts.push({
      key: agreementId,
      sourceId: agreementId,
      clientKey,
      contractNo: agreementId,
      title: name || agreementId,
      status: contractStatusOf(text(row, 'Agreement_Status')),
      signedDate: signed,
      startDate: signed,
      endDate: completion,
      valueSantim: birrToSantim(valueBirr),
      valueEnteredInclusive: options.vatTreatment === 'inclusive',
      vatRateBps: options.vatRateBps,
      siteCity: city,
      milestones: [],
      collectedSantim: null,
      // Filled in after the loop: the USD row may sit either side of this one.
      equipmentPaidDirectUsdCents: null,
      notes: [text(row, 'Status') && `Stage in source: ${text(row, 'Status')}`, text(row, 'Remarks')]
        .filter((part) => part && !part.startsWith('nan'))
        .join(' · '),
    });
  }

  // Attach the dollar figures now every agreement has been seen, whichever
  // order the two rows appeared in.
  for (const contract of contracts) {
    const cents = directUsdCents.get(contract.sourceId);
    if (cents !== undefined) contract.equipmentPaidDirectUsdCents = cents;
  }
  for (const [agreementId, cents] of directUsdCents) {
    if (contracts.some((c) => c.sourceId === agreementId)) continue;
    // A dollar row with no ETB agreement to hang on. Said out loud rather than
    // quietly dropped: it means an agreement is missing from the sheet.
    issues.push({
      severity: 'warning',
      sheet: 'Agreements_Master',
      ref: agreementId,
      reason: `USD ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} under an Agreement_ID with no ETB agreement row — there is nothing to attach it to.`,
    });
  }

  // --- payment schedules and collections -----------------------------------

  const schedules = paymentSchedules(sheet('Agreement_Payment_Plan'), issues);
  const collectedBirr = resolvePayments(
    financeBlocks(sheet('Project_Finance')),
    contractValueBirr,
    issues,
  );

  for (const contract of contracts) {
    const shares = schedules.get(contract.key) ?? DEFAULT_SUPPLY_INSTALL_SHARES;
    if (!schedules.has(contract.key)) {
      issues.push({
        severity: 'warning',
        sheet: 'Agreement_Payment_Plan',
        ref: contract.contractNo,
        reason: 'No payment terms in the sheet; the standard supply-and-install schedule was used.',
      });
    }
    const collected = collectedBirr.get(contract.key);
    contract.collectedSantim = collected === undefined ? null : birrToSantim(collected);
    contract.milestones = applyCollectedToMilestones(
      shares,
      contract.valueSantim,
      contract.collectedSantim ?? 0,
    );
  }

  // --- projects ------------------------------------------------------------

  const contractByKey = new Map(contracts.map((c) => [c.key, c]));
  const projects: PlannedProject[] = [];
  const perAgreement = new Map<string, number>();

  for (const row of sheet('Projects_Master')) {
    const projectId = normaliseProjectId(pick(row, 'Project_ID'));
    if (projectId === null) continue; // padding rows carry only formula output
    const agreementId = normaliseAgreementId(pick(row, 'Agreement_ID'));
    const contract = agreementId === null ? undefined : contractByKey.get(agreementId);
    const title = text(row, 'Project_Name (auto/optional)', 'Project_Name');

    if (contract === undefined) {
      issues.push({
        severity: 'skipped',
        sheet: 'Projects_Master',
        ref: `${projectId} ${title}`,
        reason:
          agreementId === null
            ? 'No Agreement_ID, so the project has no contract to sit under.'
            : `Agreement ${agreementId} was not imported, so this project has no contract to sit under.`,
      });
      continue;
    }

    perAgreement.set(agreementId as string, (perAgreement.get(agreementId as string) ?? 0) + 1);
    projects.push({
      key: projectId,
      sourceId: projectId,
      contractKey: contract.key,
      clientKey: contract.clientKey,
      programKey: null, // filled in below, once the per-agreement counts are known
      projectNo: projectId,
      title: title || projectId,
      tag: text(row, 'Elevator_No') || 'LIFT-01',
      status: projectLifecycleOf(text(row, 'Project_Status')),
      sourceStage: text(row, 'Project_Status'),
      capacityKg: num(row, 'Capacity_kg'),
      stops: num(row, 'Stops'),
      plannedStart: date(row, 'Planned_Start_Date'),
      plannedEnd: date(row, 'Planned_End_Date'),
      siteCity: contract.siteCity,
      remarks: text(row, 'Remarks'),
    });
  }

  // --- programs, for agreements carrying more than one lift ----------------

  const programs: PlannedProgram[] = [];
  for (const [agreementId, count] of perAgreement) {
    if (count < 2) continue;
    const contract = contractByKey.get(agreementId);
    if (contract === undefined) continue;
    programs.push({
      key: agreementId,
      programNo: `PGM-${agreementId.slice(4)}`,
      name: contract.title,
      clientKey: contract.clientKey,
      plannedStart: contract.startDate,
      plannedEnd: contract.endDate,
    });
  }
  const programKeys = new Set(programs.map((p) => p.key));
  for (const project of projects) {
    if (programKeys.has(project.contractKey)) project.programKey = project.contractKey;
  }

  // --- units ---------------------------------------------------------------

  const specByName = new Map<string, Row>();
  for (const row of sheet('Elevator_List_Full')) {
    const name = text(row, 'Project_Name (auto/optional)', 'Project_Name');
    if (name) specByName.set(name.toLowerCase(), row);
  }

  const projectByKey = new Map(projects.map((p) => [p.key, p]));
  const units: PlannedUnit[] = [];
  const seenUnit = new Set<string>();

  const addUnit = (project: PlannedProject, klNumber: string | null, row: Row | undefined) => {
    const spec = specByName.get(project.title.toLowerCase());
    units.push({
      key: project.key,
      projectKey: project.key,
      clientKey: project.clientKey,
      tag: project.tag,
      siteName: project.title,
      city: project.siteCity,
      klNumber,
      capacityKg: (row === undefined ? null : num(row, 'Capacity_kg', 'KG')) ?? project.capacityKg,
      stops: (row === undefined ? null : num(row, 'Stops', 'STOPS')) ?? project.stops,
      speedMps: spec === undefined ? null : num(spec, 'SPEED (m/sec)'),
      model: spec === undefined ? null : text(spec, 'Type') || null,
      // A lift on a job that is finished or in warranty is a lift that is
      // running; anything earlier is still being installed.
      status: project.status === 'completed' ? 'in_service' : 'under_installation',
    });
    seenUnit.add(project.key);
  };

  for (const row of sheet('Elevator_Assets')) {
    const projectId = normaliseProjectId(pick(row, 'Project_ID'));
    const project = projectId === null ? undefined : projectByKey.get(projectId);
    // Elevator_Assets numbers projects in an older sequence than
    // Projects_Master, so about half its rows point at ids that no longer
    // exist. Those lifts are picked up by name from Elevator_List_Full below
    // rather than dropped.
    if (project === undefined || seenUnit.has(project.key)) continue;
    const kl = num(row, 'KL_Number');
    addUnit(project, kl === null ? null : String(Math.round(kl)), row);
  }

  // Second pass: the full lift list keys on project NAME, which survives the
  // renumbering. It carries the authority KL number for lifts whose asset row
  // was lost, and it is the only place speed and model are recorded.
  const projectByTitle = new Map(projects.map((p) => [p.title.toLowerCase(), p]));
  for (const row of sheet('Elevator_List_Full')) {
    const title = text(row, 'Project_Name (auto/optional)', 'Project_Name');
    const project = projectByTitle.get(title.toLowerCase());
    if (project === undefined) {
      issues.push({
        severity: 'skipped',
        sheet: 'Elevator_List_Full',
        ref: title || '(unnamed lift)',
        reason: 'No project of this name was imported, so the lift has nowhere to hang.',
      });
      continue;
    }
    if (seenUnit.has(project.key)) continue;
    const kl = num(row, 'KL_Number (6 digits)', 'KL_Number');
    addUnit(project, kl === null ? null : String(Math.round(kl)), row);
  }

  for (const project of projects) {
    if (!seenUnit.has(project.key)) {
      issues.push({
        severity: 'warning',
        sheet: 'Elevator_Assets',
        ref: project.projectNo,
        reason: 'No lift record found for this project; a unit was not created, so it will not appear in the service list.',
      });
    }
  }

  // --- people --------------------------------------------------------------

  const people = buildPeoplePlan(workbook, issues);

  return {
    clients: [...clients.values()],
    programs,
    contracts,
    projects,
    units,
    technicians: people.technicians,
    subcontractors: people.subcontractors,
    issues,
  };
}

/** One row per distinct reason, because 121 rows of twelve sentences is a wall. */
export interface IssueGroup {
  severity: IssueSeverity;
  sheet: string;
  reason: string;
  refs: string[];
}

/**
 * Collapse the issue list to one row per reason.
 *
 * The same sentence repeats sixty times over — every USD cost row, every
 * agreement with no value. Grouped, the whole report is about a dozen lines,
 * which is a thing a person will actually read; ungrouped it is a wall nobody
 * scrolls to the bottom of, and the one unusual entry hides in it.
 */
export function groupIssues(issues: readonly ImportIssue[]): IssueGroup[] {
  const order: IssueSeverity[] = ['skipped', 'warning', 'repaired'];
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const key = `${issue.severity}|${issue.sheet}|${issue.reason}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        severity: issue.severity,
        sheet: issue.sheet,
        reason: issue.reason,
        refs: [issue.ref],
      });
    } else {
      existing.refs.push(issue.ref);
    }
  }
  return [...groups.values()].sort(
    (a, b) =>
      order.indexOf(a.severity) - order.indexOf(b.severity) ||
      b.refs.length - a.refs.length ||
      a.sheet.localeCompare(b.sheet),
  );
}

/** Headline counts for the confirmation screen. */
export function planSummary(plan: ImportPlan) {
  const contractValue = plan.contracts.reduce((a, c) => a + c.valueSantim, 0);
  const collected = plan.contracts.reduce((a, c) => a + (c.collectedSantim ?? 0), 0);
  return {
    clients: plan.clients.length,
    programs: plan.programs.length,
    contracts: plan.contracts.length,
    projects: plan.projects.length,
    units: plan.units.length,
    technicians: plan.technicians.length,
    subcontractors: plan.subcontractors.length,
    milestones: plan.contracts.reduce((a, c) => a + c.milestones.length, 0),
    contractValueSantim: contractValue,
    collectedSantim: collected,
    contractsWithPayments: plan.contracts.filter((c) => c.collectedSantim !== null).length,
    skipped: plan.issues.filter((i) => i.severity === 'skipped').length,
    warnings: plan.issues.filter((i) => i.severity === 'warning').length,
    repaired: plan.issues.filter((i) => i.severity === 'repaired').length,
  };
}
