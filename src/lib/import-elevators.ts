/**
 * Read the consolidated one-sheet elevator register.
 *
 * WHY THERE ARE TWO IMPORTERS
 *   The original source was eleven sheets — agreements, a payment plan, a
 *   finance tab, projects, two lift lists, four rosters and a contact list —
 *   and `import-master.ts` reads that. This is the same business consolidated
 *   into ONE sheet, one row per lift, which is a different document rather than
 *   a tidier version of the old one: it holds the whole equipment register and
 *   no money at all.
 *
 *   Faking the old sheets out of this one was the other option, and it was
 *   rejected: it would mean inventing `PRJ-` ids to satisfy an id format this
 *   file does not use, and matching lifts to projects by NAME, as the old
 *   mapper must. Both are couplings to a document that no longer exists.
 *
 *   What IS shared is everything below the mapping: this produces the same
 *   `ImportPlan`, so `data/import-run.ts` writes it unchanged, and the cell
 *   readers, the key derivation and the status maps are imported rather than
 *   copied. The date reader in particular carries the UTC+3 fix, and a second
 *   copy of it is a second chance to get the one-day shift wrong.
 *
 * THERE IS NO MONEY IN THIS FILE
 *   No contract value, no payment schedule, nothing collected. Contracts are
 *   therefore imported at a value of zero, which is true rather than convenient
 *   — and said out loud in the issue list, because an order book reading ETB 0
 *   is otherwise the kind of thing somebody discovers in a board meeting.
 *
 *   Every other importable fact is here, including the one the old workbook was
 *   thin on: the actual machines, with their capacity, speed, stops and model.
 *
 * ONE ROW IS ONE LIFT IS ONE PROJECT
 *   Which is the business's own model: a site with several lifts is one
 *   agreement, one programme, and one project per machine. So an agreement
 *   carrying two or more rows becomes a programme, and the project count
 *   follows the row count exactly.
 */

import { birrToSantim } from './money.js';
import { usdCentsFrom } from './direct-supply.js';
import {
  clientKeyOf,
  contractStatusOf,
  date,
  normaliseAgreementId,
  num,
  projectLifecycleOf,
  text,
  type ImportIssue,
  type ImportPlan,
  type PlannedClient,
  type PlannedContract,
  type PlannedProgram,
  type PlannedProject,
  type PlannedUnit,
  type Row,
  type Workbook,
} from './import-master.js';

/** The only sheet this format has. */
export const ELEVATOR_SHEET = 'Elevators';

/**
 * The money columns, which the register does not yet carry.
 *
 * WHY THEY ARE OPTIONAL RATHER THAN REQUIRED
 *   The file is the equipment register first. Refusing to import it until
 *   somebody has priced 79 agreements would leave the whole business out of the
 *   app for the sake of a column, and the technical data is useful on its own —
 *   a service quote needs the capacity and the stop count, not the contract
 *   value.
 *
 *   So every one of these is read if present and reported as absent if not. The
 *   day they are filled in, the same import picks them up.
 *
 * TWO WAYS TO PRICE, AND BOTH ARE RIGHT
 *   `Lift_Value` prices each machine, which suits a sheet with one row per lift
 *   and is the better of the two: it gives each project a real share of its
 *   contract, so a programme's progress can be weighted by value instead of
 *   averaged. `Contract_Value` prices the agreement as a whole, for the ones
 *   sold as a single job.
 *
 *   Where both appear the lift figures are summed and checked against the
 *   agreement figure, and a disagreement is reported rather than silently
 *   resolved — the two disagreeing is a fact about the source, not a rounding
 *   question.
 */
export const MONEY_COLUMNS = {
  liftValue: ['Lift_Value', 'Lift_Value_ETB', 'Elevator_Value'],
  contractValue: ['Contract_Value', 'Contract_Value_ETB', 'Agreement_Value'],
  vatInclusive: ['VAT_Inclusive', 'Value_Includes_VAT'],
  collected: ['Collected_To_Date', 'Paid_To_Date', 'Collected'],
  equipmentUsd: ['Equipment_Paid_Direct_USD', 'Equipment_USD', 'Supply_Only_USD'],
} as const;

/**
 * Whether a yes/no cell says yes.
 *
 * Spelled out rather than truthy: `text()` gives "no", and "no" is truthy.
 */
function saysYes(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === '') return null;
  if (['yes', 'y', 'true', '1', 'inclusive', 'incl'].includes(v)) return true;
  if (['no', 'n', 'false', '0', 'exclusive', 'excl'].includes(v)) return false;
  return null;
}

/** Does any row carry any money column at all? */
export function hasMoneyColumns(workbook: Workbook): boolean {
  const first = (workbook[ELEVATOR_SHEET] ?? [])[0];
  if (first === undefined) return false;
  const headers = Object.keys(first).map((k) => k.trim().toLowerCase());
  return Object.values(MONEY_COLUMNS)
    .flat()
    .some((name) => headers.includes(name.toLowerCase()));
}

/**
 * The columns that identify the format.
 *
 * Deliberately three, not eighteen: a file with these is this register even if
 * somebody has added a column or dropped the remarks, and requiring all
 * eighteen would reject the next revision of it for no reason.
 */
export const ELEVATOR_COLUMNS = ['Elevator_ID', 'Agreement_ID', 'Client_Name'] as const;

/** Is this the one-sheet register rather than the eleven-sheet workbook? */
export function isElevatorWorkbook(workbook: Workbook): boolean {
  const rows = workbook[ELEVATOR_SHEET];
  if (rows === undefined || rows.length === 0) return false;
  const first = rows[0];
  if (first === undefined) return false;
  const headers = Object.keys(first).map((k) => k.trim().toLowerCase());
  return ELEVATOR_COLUMNS.every((name) => headers.includes(name.toLowerCase()));
}

/** Six months, for a contract whose end the sheet does not give. */
function sixMonthsOn(from: Date): Date {
  const out = new Date(from.getTime());
  out.setUTCMonth(out.getUTCMonth() + 6);
  return out;
}

/**
 * `LIFT-01` from a lift number.
 *
 * Padded because the tag is what a person reads on a list beside nineteen
 * others, and `LIFT-2` sorting between `LIFT-19` and `LIFT-20` is a small
 * daily irritation with no upside.
 */
function tagOf(liftNo: number | null, fallbackIndex: number): string {
  const n = liftNo ?? fallbackIndex;
  return `LIFT-${String(n).padStart(2, '0')}`;
}

/**
 * The people named in `Assigned_To`, which holds pairs as often as names:
 * "Yosef & Tesfaye", "Fasika/Dejene", "Yosef Niguse/Dejene".
 *
 * Split on the separators rather than stored as one string, because a cell
 * reading "Fasika/Dejene" makes two technicians into one person who does not
 * exist and whose KPIs are the sum of two people's work.
 */
export function assignedNames(raw: string): string[] {
  return raw
    .split(/[&/,+]|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** A lift's machine is in service once the job is handed over. */
function unitStatusOf(projectStatus: string): PlannedUnit['status'] {
  const s = projectStatus.trim().toLowerCase();
  return s === 'completed' || s === 'warranty' ? 'in_service' : 'under_installation';
}

interface Group {
  agreementId: string;
  rows: Row[];
}

/** What the money columns say about one agreement, if anything. */
interface GroupMoney {
  /** Birr, as written in the sheet, before VAT is split out. */
  valueBirr: number | null;
  /** Per-lift figures by Elevator_ID, where the sheet prices each machine. */
  perLiftBirr: Map<string, number>;
  collectedBirr: number | null;
  equipmentUsdCents: number | null;
  /** null where no column answers it, so the page can ask instead. */
  vatInclusive: boolean | null;
  /** Where lift figures and an agreement figure disagree, by how much. */
  mismatchBirr: number | null;
}

function moneyOf(group: Group): GroupMoney {
  const perLiftBirr = new Map<string, number>();
  for (const row of group.rows) {
    const value = num(row, ...MONEY_COLUMNS.liftValue);
    if (value !== null) perLiftBirr.set(text(row, 'Elevator_ID'), value);
  }
  const liftTotal = [...perLiftBirr.values()].reduce((a, b) => a + b, 0);

  // Agreement-level figures: whichever row names one. Repeating the same value
  // on every row of an agreement is the natural thing to do in a sheet with one
  // row per lift, and must not be read as one value per lift.
  const stated = group.rows
    .map((r) => num(r, ...MONEY_COLUMNS.contractValue))
    .find((v) => v !== null) ?? null;
  const collected = group.rows
    .map((r) => num(r, ...MONEY_COLUMNS.collected))
    .find((v) => v !== null) ?? null;
  const usd = group.rows
    .map((r) => text(r, ...MONEY_COLUMNS.equipmentUsd))
    .find((v) => v !== '') ?? '';
  const vat = group.rows
    .map((r) => saysYes(text(r, ...MONEY_COLUMNS.vatInclusive)))
    .find((v) => v !== null) ?? null;

  const value = perLiftBirr.size > 0 ? liftTotal : stated;
  // Half a birr of tolerance: a sheet that rounds each lift to the nearest
  // birr should not be reported as disagreeing with its own total.
  const mismatch =
    perLiftBirr.size > 0 && stated !== null && Math.abs(liftTotal - stated) > 0.5
      ? liftTotal - stated
      : null;

  return {
    valueBirr: value,
    perLiftBirr,
    collectedBirr: collected,
    equipmentUsdCents: usd === '' ? null : usdCentsFrom(usd),
    vatInclusive: vat,
    mismatchBirr: mismatch,
  };
}

export interface ElevatorImportOptions {
  /**
   * Whether a money figure in the sheet already contains VAT.
   *
   * Only consulted where the sheet carries money and no `VAT_Inclusive` column
   * answers it per agreement. With no money columns at all it is unused, which
   * is why the page does not ask the question in that case.
   */
  vatTreatment: 'inclusive' | 'exclusive';
  vatRateBps: number;
}

const NO_MONEY: ElevatorImportOptions = { vatTreatment: 'exclusive', vatRateBps: 0 };

/**
 * Build the same plan the eleven-sheet workbook produces, from one sheet.
 */
export function buildElevatorPlan(
  workbook: Workbook,
  options: ElevatorImportOptions = NO_MONEY,
): ImportPlan {
  const issues: ImportIssue[] = [];
  const rows = workbook[ELEVATOR_SHEET] ?? [];

  // --- group the rows by agreement ----------------------------------------

  const groups = new Map<string, Group>();
  const seenElevator = new Set<string>();

  for (const row of rows) {
    const elevatorId = text(row, 'Elevator_ID');
    const agreementId = normaliseAgreementId(row['Agreement_ID']);

    if (elevatorId === '') {
      issues.push({
        severity: 'skipped',
        sheet: ELEVATOR_SHEET,
        ref: text(row, 'Client_Name') || '(blank row)',
        reason: 'No Elevator_ID — the row cannot be told apart from another lift.',
      });
      continue;
    }
    if (agreementId === null) {
      issues.push({
        severity: 'skipped',
        sheet: ELEVATOR_SHEET,
        ref: elevatorId,
        reason:
          'No usable Agreement_ID, so the lift has no contract to sit under. Expected the form AGR-2024-001.',
      });
      continue;
    }
    if (seenElevator.has(elevatorId)) {
      issues.push({
        severity: 'skipped',
        sheet: ELEVATOR_SHEET,
        ref: elevatorId,
        reason: 'This Elevator_ID appears twice. The second row was left out.',
      });
      continue;
    }
    seenElevator.add(elevatorId);

    const group = groups.get(agreementId);
    if (group === undefined) groups.set(agreementId, { agreementId, rows: [row] });
    else group.rows.push(row);
  }

  // --- clients and contracts, one per agreement ---------------------------

  const clients = new Map<string, PlannedClient>();
  const contracts: PlannedContract[] = [];
  const programs: PlannedProgram[] = [];
  const projects: PlannedProject[] = [];
  const units: PlannedUnit[] = [];
  const technicians = new Map<string, { key: string; name: string; note: string }>();

  for (const group of groups.values()) {
    const first = group.rows[0] as Row;
    const clientName = text(first, 'Client_Name');

    if (clientName === '') {
      issues.push({
        severity: 'skipped',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason: 'No Client_Name on any of its rows, so there is nobody to file the contract under.',
      });
      continue;
    }

    // The site is whichever of the group's rows names one: a blank Location on
    // lift 2 does not mean lift 2 is somewhere else.
    const city = group.rows.map((r) => text(r, 'Location')).find((v) => v !== '') ?? '';
    const contact = group.rows.map((r) => text(r, 'Contact_Person')).find((v) => v !== '') ?? '';

    const clientKey = clientKeyOf(clientName);
    if (!clients.has(clientKey)) {
      clients.set(clientKey, {
        key: clientKey,
        name: clientName,
        city,
        contactName: contact === '' ? null : contact,
      });
    }

    const signed = date(first, 'Agreement_Date');
    // The agreement's end is the last lift's planned completion: the job is not
    // finished while any machine in it is outstanding.
    const completions = group.rows
      .map((r) => date(r, 'Planned_Completion'))
      .filter((d): d is Date => d !== null);
    const lastCompletion =
      completions.length === 0
        ? null
        : new Date(Math.max(...completions.map((d) => d.getTime())));

    if (lastCompletion === null) {
      issues.push({
        severity: 'repaired',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason:
          'No Planned_Completion on any of its lifts. The contract end is set six months after signing, which is the usual term — correct it on the contract if it differs.',
      });
    }
    if (signed !== null && lastCompletion !== null && lastCompletion < signed) {
      issues.push({
        severity: 'warning',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason: 'Planned_Completion is before Agreement_Date. Both are imported as written.',
      });
    }

    // Service_Status describes the agreement as a whole — a closed contract, a
    // live service one — so it is the contract's status, not the project's.
    const serviceStatus = group.rows.map((r) => text(r, 'Service_Status')).find((v) => v !== '') ?? '';
    if (serviceStatus === '') {
      issues.push({
        severity: 'warning',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason: 'No Service_Status, so the contract is imported as active. Check it.',
      });
    }

    const lifts = group.rows.length;
    const title = lifts === 1 ? clientName : `${clientName} — ${lifts} lifts`;
    const money = moneyOf(group);

    if (money.mismatchBirr !== null) {
      issues.push({
        severity: 'warning',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason: `The lift values add up to ${money.mismatchBirr > 0 ? 'more' : 'less'} than the Contract_Value on the same agreement, by ETB ${Math.abs(money.mismatchBirr).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. The lift figures are used, since they say which machine is worth what.`,
      });
    }
    if (money.valueBirr !== null && money.valueBirr <= 0) {
      issues.push({
        severity: 'warning',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason: 'The contract value is zero or negative. Imported as written.',
      });
    }
    if (
      money.collectedBirr !== null &&
      money.valueBirr !== null &&
      money.collectedBirr > money.valueBirr
    ) {
      issues.push({
        severity: 'warning',
        sheet: ELEVATOR_SHEET,
        ref: group.agreementId,
        reason:
          'More has been collected than the contract is worth. Usually a variation nobody added to the value — check before invoicing against it.',
      });
    }

    contracts.push({
      key: group.agreementId,
      sourceId: group.agreementId,
      clientKey,
      contractNo: group.agreementId,
      title,
      status: contractStatusOf(serviceStatus),
      signedDate: signed,
      startDate: signed,
      endDate: lastCompletion ?? (signed === null ? null : sixMonthsOn(signed)),
      // Zero where the sheet prices nothing, which is the truth rather than a
      // convenience — and the warning at the end is what stops a whole order
      // book of zeros being read as a business that sold nothing.
      valueSantim: money.valueBirr === null ? 0 : birrToSantim(money.valueBirr),
      // The sheet's own answer wins over the one given on the page: a column
      // that says so is evidence, and the page's radio button is a default.
      valueEnteredInclusive: money.vatInclusive ?? options.vatTreatment === 'inclusive',
      vatRateBps: money.valueBirr === null ? 0 : options.vatRateBps,
      siteCity: city,
      /*
       * One term for the whole amount.
       *
       * The register carries no payment schedule, and a contract with NO terms
       * is refused — rightly: its value is money nobody can ever invoice, and
       * `lib/milestones.ts` will not let shares add up to anything but 100%.
       *
       * So the assumption is made explicit rather than the rule bent: a single
       * term for the full amount, named so that it reads as a placeholder on
       * the contract page, and reported in the issue list so the real schedule
       * gets entered. Where the sheet says something HAS been collected, that
       * is applied to this term as it would be to a real one.
       */
      milestones: [
        {
          name: 'Full amount (no schedule in the register)',
          shareBps: 10_000,
          paid: money.collectedBirr !== null && money.valueBirr !== null
            && money.collectedBirr >= money.valueBirr && money.valueBirr > 0,
        },
      ],
      collectedSantim: money.collectedBirr === null ? null : birrToSantim(money.collectedBirr),
      equipmentPaidDirectUsdCents: money.equipmentUsdCents,
      notes: '',
    });

    // --- a programme where the agreement carries more than one lift --------

    if (lifts > 1) {
      programs.push({
        key: group.agreementId,
        programNo: `PGM-${group.agreementId.slice(4)}`,
        name: `${clientName}${city === '' ? '' : ` — ${city}`}`,
        clientKey,
        plannedStart: signed,
        plannedEnd: lastCompletion,
      });
    }

    // --- one project and one lift per row ---------------------------------

    group.rows.forEach((row, index) => {
      const elevatorId = text(row, 'Elevator_ID');
      const projectStatus = text(row, 'Project_Status');
      const tag = tagOf(num(row, 'Lift_No'), index + 1);
      const label = text(row, 'Unit_Label') || `${clientName} ${tag}`;
      const capacityKg = num(row, 'Capacity_kg');
      const stops = num(row, 'Stops');
      const klNumber = text(row, 'KL_Number');
      const model = text(row, 'Model');
      const speed = num(row, 'Speed_mps');

      if (projectStatus === '') {
        issues.push({
          severity: 'warning',
          sheet: ELEVATOR_SHEET,
          ref: elevatorId,
          reason: 'No Project_Status, so the job is imported as planned. Check it.',
        });
      }
      if (capacityKg === null || stops === null) {
        issues.push({
          severity: 'warning',
          sheet: ELEVATOR_SHEET,
          ref: elevatorId,
          reason:
            'The machine has no capacity or no stop count. Both are wanted for a service quote and for the spare-parts list.',
        });
      }

      projects.push({
        key: elevatorId,
        sourceId: elevatorId,
        contractKey: group.agreementId,
        clientKey,
        programKey: lifts > 1 ? group.agreementId : null,
        projectNo: elevatorId,
        title: label,
        tag,
        status: projectLifecycleOf(projectStatus),
        sourceStage: projectStatus,
        capacityKg,
        stops,
        plannedStart: signed,
        plannedEnd: date(row, 'Planned_Completion'),
        siteCity: text(row, 'Location') || city,
        remarks: text(row, 'Remarks'),
      });

      units.push({
        key: elevatorId,
        projectKey: elevatorId,
        clientKey,
        tag,
        siteName: label,
        city: text(row, 'Location') || city,
        klNumber: klNumber === '' ? null : klNumber,
        capacityKg,
        stops,
        speedMps: speed,
        model: model === '' ? null : model,
        status: unitStatusOf(projectStatus),
      });

      // --- whoever is on it ----------------------------------------------

      const assigned = text(row, 'Assigned_To');
      const names = assignedNames(assigned);
      if (names.length > 1) {
        issues.push({
          severity: 'repaired',
          sheet: ELEVATOR_SHEET,
          ref: elevatorId,
          reason: `Assigned_To named ${names.length} people ("${assigned}") and each is imported separately.`,
        });
      }
      for (const name of names) {
        const key = `t-${clientKeyOf(name)}`;
        if (!technicians.has(key)) {
          technicians.set(key, {
            key,
            name,
            note: 'From the elevator register. Check the trade and the phone number.',
          });
        }
      }
    });
  }

  // --- the thing about this file somebody has to be told ------------------

  if (contracts.length > 0) {
    issues.push({
      severity: 'repaired',
      sheet: ELEVATOR_SHEET,
      ref: `${contracts.length} contracts`,
      reason:
        'The register has no payment schedule, so each contract is given a single term for the full amount. A contract with no terms cannot be invoiced against at all, which is why one is created rather than none — replace it with the real stages on the contract page.',
    });
  }

  const priced = contracts.filter((c) => c.valueSantim > 0).length;
  if (contracts.length > 0 && priced === 0) {
    issues.push({
      severity: 'warning',
      sheet: ELEVATOR_SHEET,
      ref: `${contracts.length} contracts`,
      reason:
        'This file carries no money: no contract value, no payment terms and nothing collected. Every contract is imported at ETB 0, so the order book, invoicing and the VAT return have nothing to work from until values are entered. Add a Lift_Value or Contract_Value column and import again.',
    });
  } else if (priced < contracts.length) {
    issues.push({
      severity: 'warning',
      sheet: ELEVATOR_SHEET,
      ref: `${contracts.length - priced} of ${contracts.length} contracts`,
      reason:
        'These agreements have no value in the sheet and are imported at ETB 0. They will not appear in the order book until a figure is entered.',
    });
  }

  return {
    clients: [...clients.values()],
    programs,
    contracts,
    projects,
    units,
    technicians: [...technicians.values()].map((t) => ({
      key: t.key,
      name: t.name,
      phone: '',
      note: t.note,
      trade: 'installer' as const,
    })),
    subcontractors: [],
    issues,
  };
}
