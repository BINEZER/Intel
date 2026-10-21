import { describe, expect, it } from 'vitest';
import {
  applyCollectedToMilestones,
  buildImportPlan,
  financeBlocks,
  groupIssues,
  normaliseAgreementId,
  normaliseProjectId,
  parseFinanceRemarks,
  paymentSchedules,
  planSummary,
  type Workbook,
} from '../import-master.js';

const OPTS = { vatTreatment: 'exclusive' as const, vatRateBps: 1500 };

describe('key normalisation', () => {
  it('re-pads the payment sheet ids so they join', () => {
    // Agreements_Master writes AGR-2019-001; Agreement_Payment_Plan writes
    // AGR-2019-01. Without this not one payment schedule finds its contract,
    // and the failure is silent — the contract just looks like one nobody
    // wrote terms for.
    expect(normaliseAgreementId('AGR-2019-01')).toBe('AGR-2019-001');
    expect(normaliseAgreementId('AGR-2019-001')).toBe('AGR-2019-001');
    expect(normaliseAgreementId('AGR-2019-1')).toBe('AGR-2019-001');
  });

  it('refuses anything that is not an agreement id', () => {
    expect(normaliseAgreementId('8 stop 630kg')).toBeNull();
    expect(normaliseAgreementId(null)).toBeNull();
    expect(normaliseAgreementId('PRJ-2019-101')).toBeNull();
    expect(normaliseProjectId('PRJ-2019-101')).toBe('PRJ-2019-101');
  });
});

describe('finance remarks', () => {
  it('reads the phase and amount out of the packed string', () => {
    expect(
      parseFinanceRemarks('Phase=Advance; %=0.5; Amount=680149.62; Remaining=0.0; Requested=nan'),
    ).toEqual({ phase: 'Advance', amount: 680149.62 });
  });

  it('returns nulls rather than guessing when the string is empty', () => {
    expect(parseFinanceRemarks('')).toEqual({ phase: null, amount: null });
  });
});

describe('finance blocks', () => {
  const rows = [
    { Finance_Remarks: 'Phase=Advance; Amount=400', Payment_Status: 'Paid', Amount_Paid: 400 },
    { Finance_Remarks: 'Phase=Bill received; Amount=300', Payment_Status: 'Paid', Amount_Paid: 300 },
    { Finance_Remarks: 'Phase=After comissioning; Amount=300', Payment_Status: 'Not Started', Amount_Paid: null },
    { Finance_Remarks: 'Phase=Total; Amount=1000', Payment_Status: 'Paid', Amount_Paid: 1000 },
    { Finance_Remarks: 'Phase=Advance; Amount=50', Payment_Status: 'Paid', Amount_Paid: 50 },
    { Finance_Remarks: 'Phase=Total; Amount=200', Payment_Status: 'Not Started', Amount_Paid: null },
  ];

  it('splits on the Total row and sums only what was actually paid', () => {
    const blocks = financeBlocks(rows);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ totalBirr: 1000, paidBirr: 700 });
    // The Total row itself is the contract value, not a receipt — counting it
    // would double the collected figure on every fully-paid contract.
    expect(blocks[1]).toMatchObject({ totalBirr: 200, paidBirr: 50 });
  });
});

describe('payment schedules', () => {
  it('rescales terms that do not total 100%', () => {
    const issues: never[] = [];
    const schedules = paymentSchedules(
      [
        { Agreement_ID: 'AGR-2021-01', Term_No: 1, Term_Name: 'Advance', '%': 0.4 },
        { Agreement_ID: 'AGR-2021-01', Term_No: 2, Term_Name: 'Bill receipt', '%': 0.4 },
        { Agreement_ID: 'AGR-2021-01', Term_No: 3, Term_Name: 'Handover', '%': 0.1 },
      ],
      issues,
    );
    const terms = schedules.get('AGR-2021-001');
    expect(terms).toBeDefined();
    // A schedule with a gap is a contract nobody can invoice against, so the
    // 90% as written is rescaled to close at exactly 100%.
    expect(terms!.reduce((a, t) => a + t.shareBps, 0)).toBe(10_000);
    expect(terms!.map((t) => t.name)).toEqual(['Advance', 'Bill receipt', 'Handover']);
  });

  it('orders terms by Term_No rather than sheet order', () => {
    const schedules = paymentSchedules(
      [
        { Agreement_ID: 'AGR-2021-01', Term_No: 3, Term_Name: 'Third', '%': 0.2 },
        { Agreement_ID: 'AGR-2021-01', Term_No: 1, Term_Name: 'First', '%': 0.5 },
        { Agreement_ID: 'AGR-2021-01', Term_No: 2, Term_Name: 'Second', '%': 0.3 },
      ],
      [],
    );
    expect(schedules.get('AGR-2021-001')!.map((t) => t.name)).toEqual(['First', 'Second', 'Third']);
  });
});

describe('applying collected cash to a schedule', () => {
  const shares = [
    { name: 'Advance', shareBps: 4000 },
    { name: 'Bill receipt', shareBps: 4000 },
    { name: 'Handover', shareBps: 2000 },
  ];

  it('settles terms in order until the money runs out', () => {
    const milestones = applyCollectedToMilestones(shares, 1_000_000, 800_000);
    expect(milestones.map((m) => m.paid)).toEqual([true, true, false]);
  });

  it('leaves a part-paid term open', () => {
    // Marking it paid would hide a live receivable, which is the one thing a
    // collections list exists to show.
    const milestones = applyCollectedToMilestones(shares, 1_000_000, 500_000);
    expect(milestones.map((m) => m.paid)).toEqual([true, false, false]);
  });

  it('marks nothing paid when nothing was collected', () => {
    expect(applyCollectedToMilestones(shares, 1_000_000, 0).every((m) => !m.paid)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The whole plan, on a workbook shaped like the real one
// ---------------------------------------------------------------------------

function workbook(): Workbook {
  return {
    Agreements_Master: [
      {
        Agreement_ID: 'AGR-2021-001',
        'Agreement_Name ': 'Mohammad shemsu RE',
        Location: 'Lafto',
        'Contact Person': 'Ato Seifu',
        Agreement_Date: new Date(2021, 4, 10),
        'Completion date': new Date(2021, 10, 10),
        Contract_Value: 4_642_074.42,
        Currency: 'ETB',
        Agreement_Status: 'Service',
        Status: 'Completed',
      },
      {
        Agreement_ID: 'AGR-2021-005',
        'Agreement_Name ': 'Abay Alemnew BC',
        Location: 'Bahir dar',
        Contract_Value: 1_360_299.24,
        Currency: 'ETB',
        Agreement_Status: 'Closed',
      },
      {
        // The USD twin of AGR-2021-005: equipment cost, not a client contract.
        Agreement_ID: 'AGR-2021-005',
        'Agreement_Name ': 'Abay Alemnew BC',
        Contract_Value: 28_740,
        Currency: 'USD',
      },
      { 'Agreement_Name ': '8 stop 630kg', Contract_Value: 95_600, Currency: 'USD' },
    ],
    Agreement_Payment_Plan: [
      { Agreement_ID: 'AGR-2021-01', Term_No: 1, Term_Name: 'Advance payment', '%': 0.4 },
      { Agreement_ID: 'AGR-2021-01', Term_No: 2, Term_Name: 'Bill receipt', '%': 0.4 },
      { Agreement_ID: 'AGR-2021-01', Term_No: 3, Term_Name: 'Installation start', '%': 0.1 },
      { Agreement_ID: 'AGR-2021-01', Term_No: 4, Term_Name: 'After Handover', '%': 0.1 },
    ],
    Project_Finance: [
      // Note the Agreement_ID says 001 while the figures belong to 005.
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Paid', Amount_Paid: 680_149.62, Finance_Remarks: 'Phase=Advance; Amount=680149.62' },
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Paid', Amount_Paid: 408_089.772, Finance_Remarks: 'Phase=Guide Rail; Amount=408089.772' },
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Paid', Amount_Paid: 1_360_299.24, Finance_Remarks: 'Phase=Total; Amount=1360299.24' },
      // The same agreement again, from another of the merged source files —
      // an older snapshot showing less collected.
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Paid', Amount_Paid: 680_149.62, Finance_Remarks: 'Phase=Advance; Amount=680149.62' },
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Not Started', Amount_Paid: null, Finance_Remarks: 'Phase=Guide Rail; Amount=408089.772' },
      { Agreement_ID: 'AGR-2021-001', Payment_Status: 'Paid', Amount_Paid: 1_360_299.24, Finance_Remarks: 'Phase=Total; Amount=1360299.24' },
    ],
    Projects_Master: [
      { Project_ID: 'PRJ-2021-101', Agreement_ID: 'AGR-2021-001', Elevator_No: 'LIFT-01', 'Project_Name (auto/optional)': 'Mohammed Shemsu RE-01', Capacity_kg: 630, Stops: 5, Project_Status: 'Completed' },
      { Project_ID: 'PRJ-2021-102', Agreement_ID: 'AGR-2021-001', Elevator_No: 'LIFT-02', 'Project_Name (auto/optional)': 'Mohammed Shemsu RE-02', Capacity_kg: 630, Stops: 5, Project_Status: 'Completed' },
      { Project_ID: 'PRJ-2021-201', Agreement_ID: 'AGR-2021-005', Elevator_No: 'LIFT-01', 'Project_Name (auto/optional)': 'Abay Alemnew BC - LIFT-01', Capacity_kg: 450, Stops: 3, Project_Status: 'Warranty' },
      { Project_ID: 'PRJ-2021-900', Agreement_ID: 'AGR-9999-999', 'Project_Name (auto/optional)': 'Orphan', Project_Status: 'Planning' },
      { KL_Compliance: 'Missing KL', Overdue_Flag: 0 }, // padding row
    ],
    Elevator_Assets: [
      { Project_ID: 'PRJ-2021-201', Agreement_ID: 'AGR-2021-005', KL_Number: 745_052, Capacity_kg: 450, Stops: 3, 'Project Name': 'AST-ELV-2021-001' },
    ],
    Elevator_List_Full: [
      { 'Project_Name (auto/optional)': 'Abay Alemnew BC - LIFT-01', 'SPEED (m/sec)': 1, Type: 'ATLAS BASIC SP', STOPS: 3, KG: 450 },
      // No Elevator_Assets row for this one: its only record is here, by name.
      { 'Project_Name (auto/optional)': 'Mohammed Shemsu RE-01', 'SPEED (m/sec)': 1.6, Type: 'GIGAS R SP', STOPS: 5, KG: 630, 'KL_Number (6 digits)': 761718 },
      { 'Project_Name (auto/optional)': 'Nobody Owns This', 'SPEED (m/sec)': 1, Type: 'ATLAS BASIC SP' },
    ],
  };
}

describe('buildImportPlan', () => {
  it('imports the agreements that are real contracts', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.contracts.map((c) => c.contractNo)).toEqual(['AGR-2021-001', 'AGR-2021-005']);
    expect(plan.clients.map((c) => c.name)).toEqual(['Mohammad shemsu RE', 'Abay Alemnew BC']);
  });

  it('keeps a USD row as a figure ON the contract, never as a contract', () => {
    // It is the lift, bought by the client straight from the factory. Loading
    // it as a second contract would duplicate the agreement and inflate the
    // order book; dropping it lost the size of the job. So it is attached.
    const plan = buildImportPlan(workbook(), OPTS);
    const matching = plan.contracts.filter((c) => c.contractNo === 'AGR-2021-005');
    expect(matching).toHaveLength(1);
    expect(matching[0]?.equipmentPaidDirectUsdCents).toBeGreaterThan(0);

    const said = plan.issues.find((i) => i.ref.includes('AGR-2021-005') && i.reason.includes('directly'));
    expect(said?.severity).toBe('repaired');
    expect(said?.reason).toContain('in no total');
  });

  it('carries no birr figure for it, so nothing can add it up', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const contract = plan.contracts.find((c) => c.contractNo === 'AGR-2021-005');
    // The contract's own ETB value is untouched by the dollar row beside it.
    expect(contract?.valueSantim).toBeGreaterThanOrEqual(0);
    expect(Object.keys(contract ?? {}).filter((k) => k.toLowerCase().includes('usd')))
      .toEqual(['equipmentPaidDirectUsdCents']);
  });

  it('leaves a contract with no USD row carrying nothing', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.contracts.find((c) => c.contractNo === 'AGR-2021-001')?.equipmentPaidDirectUsdCents)
      .toBeNull();
  });

  it('excludes stray cells that are not agreements', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.issues.some((i) => i.ref === '8 stop 630kg' && i.severity === 'skipped')).toBe(true);
  });

  it('joins the payment schedule through the re-padded id', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const contract = plan.contracts.find((c) => c.contractNo === 'AGR-2021-001')!;
    expect(contract.milestones.map((m) => m.name)).toEqual([
      'Advance payment', 'Bill receipt', 'Installation start', 'After Handover',
    ]);
    expect(contract.milestones.reduce((a, m) => a + m.shareBps, 0)).toBe(10_000);
  });

  it('puts the payment block against the contract whose value it matches, not the id it claims', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const claimed = plan.contracts.find((c) => c.contractNo === 'AGR-2021-001')!;
    const actual = plan.contracts.find((c) => c.contractNo === 'AGR-2021-005')!;
    // The rows say AGR-2021-001; the money is Abay Alemnew's.
    expect(claimed.collectedSantim).toBeNull();
    expect(actual.collectedSantim).toBe(108_823_939); // 1,088,239.392 birr
  });

  it('falls back to the standard schedule and flags it', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const contract = plan.contracts.find((c) => c.contractNo === 'AGR-2021-005')!;
    expect(contract.milestones).toHaveLength(4);
    expect(
      plan.issues.some((i) => i.ref === 'AGR-2021-005' && i.reason.includes('standard supply-and-install')),
    ).toBe(true);
  });

  it('drops projects whose agreement was not imported, rather than orphaning them', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.projects.map((p) => p.projectNo)).toEqual([
      'PRJ-2021-101', 'PRJ-2021-102', 'PRJ-2021-201',
    ]);
    expect(plan.issues.some((i) => i.ref.includes('Orphan'))).toBe(true);
  });

  it('ignores the formula padding rows', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    // Projects_Master runs to 1028 rows of which only 163 are projects; the
    // rest carry nothing but formula output.
    expect(plan.projects).toHaveLength(3);
  });

  it('raises a program where one agreement carries several lifts', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.programs.map((p) => p.name)).toEqual(['Mohammad shemsu RE']);
    const grouped = plan.projects.filter((p) => p.programKey === 'AGR-2021-001');
    expect(grouped).toHaveLength(2);
    // A single-lift agreement is just a project; it does not need a program.
    expect(plan.projects.find((p) => p.projectNo === 'PRJ-2021-201')!.programKey).toBeNull();
  });

  it('builds the lift from its asset row and its spec row', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const unit = plan.units.find((u) => u.projectKey === 'PRJ-2021-201')!;
    expect(unit).toMatchObject({
      klNumber: '745052',
      capacityKg: 450,
      stops: 3,
      speedMps: 1,
      model: 'ATLAS BASIC SP',
      status: 'in_service', // the project is in warranty, so the lift is running
    });
  });

  it('collapses repeated snapshots of a payment block instead of adding them up', () => {
    // The finance sheet carries each agreement about six times over, once per
    // merged source file. Summing them would report a client as having paid
    // six times what they owe.
    const plan = buildImportPlan(workbook(), OPTS);
    const actual = plan.contracts.find((c) => c.contractNo === 'AGR-2021-005')!;
    expect(actual.collectedSantim).toBe(108_823_939);
  });

  it('recovers a lift whose asset row was lost, by project name', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    const recovered = plan.units.find((u) => u.projectKey === 'PRJ-2021-101');
    expect(recovered).toBeDefined();
    expect(recovered).toMatchObject({ klNumber: '761718', speedMps: 1.6, model: 'GIGAS R SP' });
  });

  it('does not create a second unit when both sheets describe the same lift', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.units.filter((u) => u.projectKey === 'PRJ-2021-201')).toHaveLength(1);
  });

  it('flags a project that ends up with no lift at all', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(
      plan.issues.some((i) => i.ref === 'PRJ-2021-102' && i.reason.includes('will not appear in the service list')),
    ).toBe(true);
  });

  it('reports a lift whose project was never imported', () => {
    const plan = buildImportPlan(workbook(), OPTS);
    expect(plan.issues.some((i) => i.ref === 'Nobody Owns This' && i.severity === 'skipped')).toBe(true);
  });

  it('carries the VAT treatment the operator chose onto every contract', () => {
    const inclusive = buildImportPlan(workbook(), { vatTreatment: 'inclusive', vatRateBps: 1500 });
    expect(inclusive.contracts.every((c) => c.valueEnteredInclusive)).toBe(true);
    const exclusive = buildImportPlan(workbook(), OPTS);
    expect(exclusive.contracts.every((c) => !c.valueEnteredInclusive)).toBe(true);
  });

  it('summarises what will be written', () => {
    const summary = planSummary(buildImportPlan(workbook(), OPTS));
    expect(summary).toMatchObject({
      clients: 2, projectGroups: 1, contracts: 2, projects: 3, units: 2, contractsWithPayments: 1,
    });
    expect(summary.contractValueSantim).toBe(600_237_366); // 4,642,074.42 + 1,360,299.24
    expect(summary.skipped).toBeGreaterThan(0);
  });
});

describe('grouping the issue report', () => {
  it('collapses repeated reasons and keeps every reference', () => {
    const grouped = groupIssues([
      { severity: 'warning', sheet: 'A', ref: 'r1', reason: 'same' },
      { severity: 'skipped', sheet: 'A', ref: 'r2', reason: 'other' },
      { severity: 'warning', sheet: 'A', ref: 'r3', reason: 'same' },
    ]);
    expect(grouped).toHaveLength(2);
    // Left-out rows lead: they are the ones that change what is in the app.
    expect(grouped[0]).toMatchObject({ severity: 'skipped', refs: ['r2'] });
    expect(grouped[1]!.refs).toEqual(['r1', 'r3']);
  });

  it('does not merge the same sentence from different sheets', () => {
    const grouped = groupIssues([
      { severity: 'skipped', sheet: 'A', ref: 'r1', reason: 'same' },
      { severity: 'skipped', sheet: 'B', ref: 'r2', reason: 'same' },
    ]);
    expect(grouped).toHaveLength(2);
  });
});
