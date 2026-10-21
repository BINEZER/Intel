/**
 * The one-sheet elevator register.
 *
 * The rules worth pinning are the ones where a plausible implementation is
 * wrong in a way nobody notices: money repeated down an agreement's rows read
 * as one figure per lift, a compound "Fasika/Dejene" read as one person, and a
 * blank cell read as zero rather than as unknown.
 */

import { describe, expect, it } from 'vitest';
import {
  assignedNames,
  buildElevatorPlan,
  hasMoneyColumns,
  isElevatorWorkbook,
  type ElevatorImportOptions,
} from '../import-elevators.js';
import { planSummary, type Row, type Workbook } from '../import-master.js';

const VAT: ElevatorImportOptions = { vatTreatment: 'exclusive', vatRateBps: 1500 };

function lift(over: Partial<Row> = {}): Row {
  return {
    Elevator_ID: 'AGR-2024-001-L01',
    Agreement_ID: 'AGR-2024-001',
    Client_Name: 'Addis Towers PLC',
    Unit_Label: 'Addis Towers - Lift 01',
    Lift_No: 1,
    Location: 'Bole',
    Contact_Person: 'Ato Seifu',
    KL_Number: 731629,
    Model: 'ATLAS BASIC SP',
    Speed_mps: 1,
    Capacity_kg: 630,
    Stops: 8,
    Agreement_Date: '2024-03-01',
    Planned_Completion: '2024-09-30',
    Project_Status: 'Installation',
    Service_Status: 'Active',
    Assigned_To: null,
    Remarks: null,
    ...over,
  } as Row;
}

const book = (rows: Row[]): Workbook => ({ Elevators: rows });

describe('recognising the format', () => {
  it('recognises the register by its identifying columns', () => {
    expect(isElevatorWorkbook(book([lift()]))).toBe(true);
  });

  it('does not recognise the eleven-sheet workbook', () => {
    expect(isElevatorWorkbook({ Agreements_Master: [{ Agreement_ID: 'AGR-2024-001' } as Row] })).toBe(
      false,
    );
  });

  it('does not recognise a sheet called Elevators that is something else', () => {
    expect(isElevatorWorkbook({ Elevators: [{ Name: 'Abebe', Cost: 4 } as Row] })).toBe(false);
  });

  it('survives an added column', () => {
    expect(isElevatorWorkbook(book([lift({ Something_New: 'x' })]))).toBe(true);
  });
});

describe('one row is one lift is one project', () => {
  it('makes a client, a contract, a project and a lift from one row', () => {
    const s = planSummary(buildElevatorPlan(book([lift()]), VAT));
    expect(s).toMatchObject({ clients: 1, contracts: 1, projects: 1, units: 1, projectGroups: 0 });
  });

  it('groups projects when an agreement carries two lifts', () => {
    const one = planSummary(buildElevatorPlan(book([lift()]), VAT));
    expect(one.projectGroups).toBe(0);

    const two = planSummary(
      buildElevatorPlan(book([lift(), lift({ Elevator_ID: 'AGR-2024-001-L02', Lift_No: 2 })]), VAT),
    );
    expect(two).toMatchObject({ projectGroups: 1, projects: 2, contracts: 1 });
  });

  it('pads the lift tag so LIFT-2 does not sort between LIFT-19 and LIFT-20', () => {
    const plan = buildElevatorPlan(book([lift({ Lift_No: 2 })]), VAT);
    expect(plan.projects[0]?.tag).toBe('LIFT-02');
  });

  it('carries the machine spec onto the lift record', () => {
    const unit = buildElevatorPlan(book([lift()]), VAT).units[0];
    expect(unit).toMatchObject({
      capacityKg: 630,
      stops: 8,
      speedMps: 1,
      model: 'ATLAS BASIC SP',
      klNumber: '731629',
      status: 'under_installation',
    });
  });

  it('puts a handed-over machine in service', () => {
    for (const status of ['Completed', 'Warranty']) {
      const unit = buildElevatorPlan(book([lift({ Project_Status: status })]), VAT).units[0];
      expect(unit?.status).toBe('in_service');
    }
  });

  it('keeps the stage word as written while mapping the lifecycle', () => {
    const project = buildElevatorPlan(book([lift({ Project_Status: 'Shipping' })]), VAT).projects[0];
    expect(project?.status).toBe('in_progress');
    expect(project?.sourceStage).toBe('Shipping');
  });

  it('leaves out a row with no Elevator_ID rather than guessing one', () => {
    const plan = buildElevatorPlan(book([lift({ Elevator_ID: null })]), VAT);
    expect(plan.projects).toHaveLength(0);
    expect(plan.issues[0]?.severity).toBe('skipped');
  });

  it('leaves out a second row claiming the same Elevator_ID', () => {
    const plan = buildElevatorPlan(book([lift(), lift()]), VAT);
    expect(plan.projects).toHaveLength(1);
    expect(plan.issues.some((i) => /appears twice/.test(i.reason))).toBe(true);
  });
});

describe('the site details come from whichever row names them', () => {
  it('does not conclude lift 2 is somewhere else because its Location is blank', () => {
    const plan = buildElevatorPlan(
      book([
        lift({ Location: 'Bole', Contact_Person: 'Ato Seifu' }),
        lift({ Elevator_ID: 'AGR-2024-001-L02', Lift_No: 2, Location: null, Contact_Person: null }),
      ]),
      VAT,
    );
    expect(plan.clients[0]).toMatchObject({ city: 'Bole', contactName: 'Ato Seifu' });
  });

  it("ends the contract at the LAST lift's completion, not the first", () => {
    const plan = buildElevatorPlan(
      book([
        lift({ Planned_Completion: '2024-06-30' }),
        lift({ Elevator_ID: 'AGR-2024-001-L02', Lift_No: 2, Planned_Completion: '2024-12-31' }),
      ]),
      VAT,
    );
    expect(plan.contracts[0]?.endDate?.toISOString().slice(0, 10)).toBe('2024-12-31');
  });

  it('falls back to six months after signing where no lift has a completion', () => {
    const plan = buildElevatorPlan(book([lift({ Planned_Completion: null })]), VAT);
    expect(plan.contracts[0]?.endDate?.toISOString().slice(0, 10)).toBe('2024-09-01');
    expect(plan.issues.some((i) => i.severity === 'repaired' && /six months/.test(i.reason))).toBe(
      true,
    );
  });
});

describe('the people named in Assigned_To', () => {
  it('splits a pair into two people', () => {
    expect(assignedNames('Fasika & Dejene')).toEqual(['Fasika', 'Dejene']);
    expect(assignedNames('Fasika/Dejene')).toEqual(['Fasika', 'Dejene']);
    expect(assignedNames('Yosef Niguse/Dejene')).toEqual(['Yosef Niguse', 'Dejene']);
    expect(assignedNames('BGB/ Getch')).toEqual(['BGB', 'Getch']);
  });

  it('is empty for a blank cell', () => {
    expect(assignedNames('')).toEqual([]);
  });

  it('imports each of a pair as a technician and says it split them', () => {
    const plan = buildElevatorPlan(book([lift({ Assigned_To: 'Fasika & Dejene' })]), VAT);
    expect(plan.technicians.map((t) => t.name)).toEqual(['Fasika', 'Dejene']);
    expect(plan.issues.some((i) => /named 2 people/.test(i.reason))).toBe(true);
  });

  it('does not enter the same person twice across rows', () => {
    const plan = buildElevatorPlan(
      book([
        lift({ Assigned_To: 'Yosef' }),
        lift({ Elevator_ID: 'AGR-2024-002-L01', Agreement_ID: 'AGR-2024-002', Assigned_To: 'Yosef' }),
      ]),
      VAT,
    );
    expect(plan.technicians).toHaveLength(1);
  });
});

describe('money', () => {
  it('reports no money columns at all', () => {
    expect(hasMoneyColumns(book([lift()]))).toBe(false);
    const plan = buildElevatorPlan(book([lift()]), VAT);
    expect(plan.contracts[0]?.valueSantim).toBe(0);
    expect(plan.issues.some((i) => /carries no money/.test(i.reason))).toBe(true);
  });

  it('sums a per-lift price into the contract', () => {
    const plan = buildElevatorPlan(
      book([
        lift({ Lift_Value: 1_200_000 }),
        lift({ Elevator_ID: 'AGR-2024-001-L02', Lift_No: 2, Lift_Value: 800_000 }),
      ]),
      VAT,
    );
    expect(plan.contracts[0]?.valueSantim).toBe(200_000_000);
  });

  /**
   * The rule that matters most in a sheet with one row per lift: a figure that
   * belongs to the agreement is repeated down its rows because that is the
   * natural thing to type, and reading it once per row multiplies the order
   * book by the number of lifts.
   */
  it('counts an agreement figure once however many rows repeat it', () => {
    const plan = buildElevatorPlan(
      book([
        lift({ Contract_Value: 4_000_000, Collected_To_Date: 1_000_000 }),
        lift({
          Elevator_ID: 'AGR-2024-001-L02',
          Lift_No: 2,
          Contract_Value: 4_000_000,
          Collected_To_Date: 1_000_000,
        }),
      ]),
      VAT,
    );
    expect(plan.contracts[0]?.valueSantim).toBe(400_000_000);
    expect(plan.contracts[0]?.collectedSantim).toBe(100_000_000);
  });

  it('takes the sheet answer on VAT over the one given on the page', () => {
    const plan = buildElevatorPlan(
      book([lift({ Contract_Value: 4_000_000, VAT_Inclusive: 'yes' })]),
      { vatTreatment: 'exclusive', vatRateBps: 1500 },
    );
    expect(plan.contracts[0]?.valueEnteredInclusive).toBe(true);
  });

  it('reads "no" as no rather than as a non-empty string', () => {
    const plan = buildElevatorPlan(
      book([lift({ Contract_Value: 4_000_000, VAT_Inclusive: 'no' })]),
      { vatTreatment: 'inclusive', vatRateBps: 1500 },
    );
    expect(plan.contracts[0]?.valueEnteredInclusive).toBe(false);
  });

  it('reports lift prices that disagree with the agreement price', () => {
    const plan = buildElevatorPlan(
      book([lift({ Lift_Value: 1_000_000, Contract_Value: 4_000_000 })]),
      VAT,
    );
    // The lift figures win — they say which machine is worth what.
    expect(plan.contracts[0]?.valueSantim).toBe(100_000_000);
    expect(plan.issues.some((i) => /add up to less/.test(i.reason))).toBe(true);
  });

  it('keeps the dollars the client pays the factory out of the birr', () => {
    const plan = buildElevatorPlan(
      book([lift({ Contract_Value: 4_000_000, Equipment_Paid_Direct_USD: '48500' })]),
      VAT,
    );
    expect(plan.contracts[0]?.equipmentPaidDirectUsdCents).toBe(4_850_000);
    expect(plan.contracts[0]?.valueSantim).toBe(400_000_000);
  });

  it('flags collecting more than the contract is worth', () => {
    const plan = buildElevatorPlan(
      book([lift({ Contract_Value: 1_000_000, Collected_To_Date: 1_500_000 })]),
      VAT,
    );
    expect(plan.issues.some((i) => /More has been collected/.test(i.reason))).toBe(true);
  });

  it('treats a blank money cell as unknown, not as zero collected', () => {
    const plan = buildElevatorPlan(book([lift({ Contract_Value: 4_000_000 })]), VAT);
    expect(plan.contracts[0]?.collectedSantim).toBeNull();
  });
});

/**
 * The register has no payment schedule, and a contract with no terms is refused
 * outright — its value would be money nobody could ever invoice. One term for
 * the full amount is the explicit assumption; these pin it so it cannot quietly
 * become none again, which is what made the first import of this file fail.
 */
describe('payment terms', () => {
  it('gives every contract one term for the full amount', () => {
    const plan = buildElevatorPlan(book([lift({ Contract_Value: 4_000_000 })]), VAT);
    const terms = plan.contracts[0]?.milestones ?? [];
    expect(terms).toHaveLength(1);
    expect(terms[0]?.shareBps).toBe(10_000);
  });

  it('says so, so the real schedule gets entered', () => {
    const plan = buildElevatorPlan(book([lift()]), VAT);
    expect(plan.issues.some((i) => /no payment schedule/.test(i.reason))).toBe(true);
  });

  it('marks the term paid only once the sheet says it is settled in full', () => {
    const part = buildElevatorPlan(
      book([lift({ Contract_Value: 4_000_000, Collected_To_Date: 1_000_000 })]),
      VAT,
    );
    expect(part.contracts[0]?.milestones[0]?.paid).toBe(false);

    const full = buildElevatorPlan(
      book([lift({ Contract_Value: 4_000_000, Collected_To_Date: 4_000_000 })]),
      VAT,
    );
    expect(full.contracts[0]?.milestones[0]?.paid).toBe(true);
  });

  it('does not mark an unpriced contract paid just because both are zero', () => {
    const plan = buildElevatorPlan(book([lift()]), VAT);
    expect(plan.contracts[0]?.milestones[0]?.paid).toBe(false);
  });
});
