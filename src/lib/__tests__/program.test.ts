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
