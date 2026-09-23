/**
 * Program roll-up.
 *
 * The one thing worth guarding: a program's progress is weighted by CONTRACT
 * VALUE, not by project count. A 24M tower at 20% and a 400k lift at 100% do
 * not average to 60% done in any sense a chief executive would accept.
 */

import { describe, expect, it } from 'vitest';
import { rollUpProgram, rollUpProgramAsOf, sortPrograms, type ProgramProject } from '../program.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

function project(over: Partial<ProgramProject> = {}): ProgramProject {
  return {
    id: 'p1',
    projectNo: 'PRJ-001',
    title: 'Tower lift 1',
    clientName: 'Addis Towers',
    status: 'in_progress',
    progressBps: 5000,
    contractId: null,
    contractNetSantim: 10_000_000,
    invoicedNetSantim: 4_000_000,
    collectedGrossSantim: 3_000_000,
    subcontractNetSantim: 1_500_000,
    plannedEnd: utc(2026, 12, 31),
    actualEnd: null,
    inDanger: false,
    ...over,
  };
}

describe('rollUpProgram', () => {
  it('weights progress by contract value, not by project count', () => {
    const rollup = rollUpProgram([
      project({ id: 'big', contractNetSantim: 24_000_000, progressBps: 2000 }),
      project({ id: 'small', contractNetSantim: 400_000, progressBps: 10_000 }),
    ]);

    // Count-average would be 60%. Value-weighted is 2131 bps.
    const expected = Math.round((2000 * 24_000_000 + 10_000 * 400_000) / 24_400_000);
    expect(rollup.progressBps).toBe(expected);
    expect(rollup.progressBps).toBeLessThan(3000);
    expect(rollup.weightedBy).toBe('value');
  });

  it('falls back to a plain mean only when there is no value to weight by, and says so', () => {
    const rollup = rollUpProgram([
      project({ id: 'a', contractNetSantim: 0, progressBps: 2000 }),
      project({ id: 'b', contractNetSantim: 0, progressBps: 8000 }),
    ]);
    expect(rollup.progressBps).toBe(5000);
    expect(rollup.weightedBy).toBe('count');
  });

  it('reports no weighting basis at all for an empty program', () => {
    const rollup = rollUpProgram([]);
    expect(rollup.weightedBy).toBeNull();
    expect(rollup.progressBps).toBe(0);
    expect(rollup.plannedEnd).toBeNull();
  });

  it('sums the money and derives margin from what was invoiced, not contracted', () => {
    const rollup = rollUpProgram([project(), project({ id: 'p2' })]);

    expect(rollup.contractNetSantim).toBe(20_000_000);
    expect(rollup.invoicedNetSantim).toBe(8_000_000);
    expect(rollup.unbilledNetSantim).toBe(12_000_000);
    expect(rollup.outstandingNetSantim).toBe(2_000_000);
    // Margin is realised: invoiced less cost, not contracted less cost.
    expect(rollup.grossMarginSantim).toBe(8_000_000 - 3_000_000);
  });

  it('never reports negative unbilled work when a project is over-invoiced', () => {
    const rollup = rollUpProgram([project({ contractNetSantim: 1_000_000, invoicedNetSantim: 1_500_000 })]);
    expect(rollup.unbilledNetSantim).toBe(0);
  });

  it('takes the program end from the LAST project to finish', () => {
    const rollup = rollUpProgram([
      project({ id: 'a', plannedEnd: utc(2026, 6, 30) }),
      project({ id: 'b', plannedEnd: utc(2027, 3, 15) }),
    ]);
    expect(rollup.plannedEnd?.toISOString().slice(0, 10)).toBe('2027-03-15');
  });

  it('counts overdue projects only when it knows the date', () => {
    const projects = [
      project({ id: 'a', plannedEnd: utc(2026, 1, 31) }),
      project({ id: 'b', plannedEnd: utc(2027, 1, 31) }),
      // Already finished, so not overdue however old its planned end is.
      project({ id: 'c', status: 'completed', plannedEnd: utc(2025, 1, 31) }),
    ];
    expect(rollUpProgram(projects).overdue).toBe(0);
    expect(rollUpProgramAsOf(projects, utc(2026, 9, 14)).overdue).toBe(1);
  });
});

describe('sortPrograms', () => {
  it('puts danger above size', () => {
    const rows = [
      { key: 'big', rollup: rollUpProgram([project({ contractNetSantim: 90_000_000 })]) },
      { key: 'troubled', rollup: rollUpProgram([project({ contractNetSantim: 1_000_000, inDanger: true })]) },
    ];
    expect(sortPrograms(rows)[0]?.key).toBe('troubled');
  });

  it('falls back to money at stake when nothing is in danger', () => {
    const rows = [
      { key: 'small', rollup: rollUpProgram([project({ contractNetSantim: 1_000_000 })]) },
      { key: 'big', rollup: rollUpProgram([project({ contractNetSantim: 90_000_000 })]) },
    ];
    expect(sortPrograms(rows)[0]?.key).toBe('big');
  });
});

describe('a programme with a cancelled job on it', () => {
  const member = (over: Partial<ProgramProject> = {}): ProgramProject => ({
    id: 'p1',
    projectNo: 'PRJ-1',
    title: 'LIFT-01',
    clientName: 'Addis Towers PLC',
    status: 'in_progress',
    progressBps: 0,
    contractId: null,
    contractNetSantim: 1_000_000_00,
    invoicedNetSantim: 0,
    collectedGrossSantim: 0,
    subcontractNetSantim: 0,
    plannedEnd: new Date(Date.UTC(2026, 11, 31)),
    actualEnd: null,
    inDanger: false,
    ...over,
  });

  it('does not let a cancelled lift drag the programme down', () => {
    // Two lifts on one site, one finished and one cancelled. The programme is
    // done: there is nothing left to build. Counting the cancelled one at 0%
    // reported it as half finished.
    const rollup = rollUpProgram([
      member({ id: 'a', status: 'completed', progressBps: 10_000 }),
      member({ id: 'b', status: 'cancelled', progressBps: 0 }),
    ]);
    expect(rollup.progressBps).toBe(10_000);
    expect(rollup.abandoned).toBe(1);
  });

  it('treats terminated the same as cancelled', () => {
    const rollup = rollUpProgram([
      member({ id: 'a', status: 'completed', progressBps: 10_000 }),
      member({ id: 'b', status: 'terminated', progressBps: 2_000 }),
    ]);
    expect(rollup.progressBps).toBe(10_000);
  });

  it('drops the cancelled value from the commitment as well', () => {
    // The other half of the damage: its value inflated the denominator, so
    // even the weighting was wrong.
    const rollup = rollUpProgram([
      member({ id: 'a', contractNetSantim: 1_000_000_00 }),
      member({ id: 'b', status: 'cancelled', contractNetSantim: 9_000_000_00 }),
    ]);
    expect(rollup.contractNetSantim).toBe(1_000_000_00);
  });

  it('still counts money that really moved on a cancelled job', () => {
    // It was invoiced for and it was paid. Dropping it would make the
    // programme's cash disagree with the bank.
    const rollup = rollUpProgram([
      member({ id: 'a' }),
      member({
        id: 'b',
        status: 'cancelled',
        invoicedNetSantim: 300_000_00,
        collectedGrossSantim: 200_000_00,
        subcontractNetSantim: 50_000_00,
      }),
    ]);
    expect(rollup.invoicedNetSantim).toBe(300_000_00);
    expect(rollup.collectedGrossSantim).toBe(200_000_00);
    expect(rollup.subcontractNetSantim).toBe(50_000_00);
  });

  it('keeps every project in the member count, so the list and the count agree', () => {
    const rollup = rollUpProgram([member({ id: 'a' }), member({ id: 'b', status: 'cancelled' })]);
    expect(rollup.projects).toBe(2);
    expect(rollup.abandoned).toBe(1);
  });

  it('does not let a cancelled job hold the programme open', () => {
    const rollup = rollUpProgram([
      member({ id: 'a', plannedEnd: new Date(Date.UTC(2026, 5, 30)) }),
      member({ id: 'b', status: 'cancelled', plannedEnd: new Date(Date.UTC(2027, 11, 31)) }),
    ]);
    expect(rollup.plannedEnd?.getUTCFullYear()).toBe(2026);
  });

  it('reports no progress rather than zero when every job was cancelled', () => {
    const rollup = rollUpProgram([member({ id: 'a', status: 'cancelled' })]);
    expect(rollup.weightedBy).toBeNull();
    expect(rollup.abandoned).toBe(1);
  });
});

describe('a programme where several projects share one contract', () => {
  const lift = (id: string, over: Partial<ProgramProject> = {}): ProgramProject => ({
    id,
    projectNo: id,
    title: id,
    clientName: 'Addis Towers PLC',
    status: 'in_progress',
    progressBps: 10_000,
    contractId: 'k1',
    // Every project reports the WHOLE contract value, which is what happens
    // when no project carries a share of its own — imported ones never do.
    contractNetSantim: 40_000_000_00,
    invoicedNetSantim: 0,
    collectedGrossSantim: 0,
    subcontractNetSantim: 0,
    plannedEnd: new Date(Date.UTC(2026, 8, 30)),
    actualEnd: null,
    inDanger: false,
    ...over,
  });

  it('counts the contract once, not once per lift', () => {
    // Four lifts on one ETB 40m agreement is an ETB 40m programme. Adding the
    // projects up made it ETB 160m — the sort of figure somebody repeats in a
    // meeting before anybody checks it.
    const rollup = rollUpProgram([lift('a'), lift('b'), lift('c'), lift('d')]);
    expect(rollup.contractNetSantim).toBe(40_000_000_00);
  });

  it('adds the contracts up when they really are different agreements', () => {
    const rollup = rollUpProgram([
      lift('a', { contractId: 'k1', contractNetSantim: 40_000_000_00 }),
      lift('b', { contractId: 'k2', contractNetSantim: 10_000_000_00 }),
    ]);
    expect(rollup.contractNetSantim).toBe(50_000_000_00);
  });

  it('keeps a project that is under no contract on its own figure', () => {
    // Nothing to share with, so nothing to deduplicate against.
    const rollup = rollUpProgram([
      lift('a', { contractId: null, contractNetSantim: 5_000_000_00 }),
      lift('b', { contractId: null, contractNetSantim: 3_000_000_00 }),
    ]);
    expect(rollup.contractNetSantim).toBe(8_000_000_00);
  });

  it('does not count a cancelled project’s contract at all', () => {
    const rollup = rollUpProgram([
      lift('a', { contractId: 'k1', contractNetSantim: 40_000_000_00 }),
      lift('b', { contractId: 'k2', contractNetSantim: 10_000_000_00, status: 'cancelled' }),
    ]);
    expect(rollup.contractNetSantim).toBe(40_000_000_00);
  });
});

describe('how the programme average is worked out', () => {
  const lift = (id: string, progressBps: number, over: Partial<ProgramProject> = {}): ProgramProject => ({
    id, projectNo: id, title: id, clientName: 'A', status: 'in_progress', progressBps,
    contractId: 'k1', contractNetSantim: 40_000_000_00,
    invoicedNetSantim: 0, collectedGrossSantim: 0, subcontractNetSantim: 0,
    plannedEnd: new Date(Date.UTC(2026, 8, 30)), actualEnd: null, inDanger: false, ...over,
  });

  it('is the plain average when the lifts share one agreement', () => {
    // Two finished and one at 60% is 86.67%. Weighting by a value every lift
    // reports identically divided four copies by one and produced 100%.
    const rollup = rollUpProgram([lift('a', 10_000), lift('b', 10_000), lift('c', 6_000)]);
    expect(rollup.progressBps).toBe(8_667);
    expect(rollup.weightedBy).toBe('count');
  });

  it('weights by value when the projects really are on different contracts', () => {
    // A 9-million job at 100% and a 1-million job at 0% is 90% of the money.
    const rollup = rollUpProgram([
      lift('a', 10_000, { contractId: 'k1', contractNetSantim: 9_000_000_00 }),
      lift('b', 0, { contractId: 'k2', contractNetSantim: 1_000_000_00 }),
    ]);
    expect(rollup.progressBps).toBe(9_000);
    expect(rollup.weightedBy).toBe('value');
  });

  it('never reports more than complete', () => {
    const rollup = rollUpProgram([lift('a', 10_000), lift('b', 10_000)]);
    expect(rollup.progressBps).toBe(10_000);
  });
});
