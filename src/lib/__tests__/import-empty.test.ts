/**
 * A workbook that is not the master workbook.
 *
 * The importer is deliberately tolerant of a missing sheet: the rosters and the
 * subcontractor trackers are optional, and a file without them still imports.
 * The cost of that tolerance is that a file with NONE of the sheets produces a
 * plan of zeros and no issues — there were no rows to find fault with — which
 * on screen is indistinguishable from an importer that has stopped working.
 *
 * These tests pin the distinction the page relies on to tell somebody they
 * picked the wrong file.
 */

import { describe, expect, it } from 'vitest';
import {
  buildImportPlan,
  planIsEmpty,
  sheetsFound,
  sheetsWithRows,
  SOURCE_SHEETS,
  type Workbook,
} from '../import-master.js';

const OPTIONS = { vatTreatment: 'exclusive' as const, vatRateBps: 1500 };

describe('a file that is not the master workbook', () => {
  it('reads as empty rather than as an error', () => {
    const wrongFile: Workbook = {
      Sheet1: [{ Name: 'Abebe', Amount: 400 }],
      Summary: [{ Total: 400 }],
    };
    const plan = buildImportPlan(wrongFile, OPTIONS);

    expect(planIsEmpty(plan)).toBe(true);
    // The point of the guard: no issues either, so an issue list cannot be what
    // tells somebody the file is wrong.
    expect(plan.issues).toEqual([]);
    expect(sheetsFound(wrongFile)).toEqual([]);
    expect(sheetsWithRows(wrongFile)).toEqual([]);
  });

  it('is empty for a file with no sheets at all', () => {
    expect(planIsEmpty(buildImportPlan({}, OPTIONS))).toBe(true);
    expect(sheetsFound({})).toEqual([]);
  });

  it('counts a sheet that is present but has no rows as present', () => {
    // A tab that came through with its headers and none of its rows IS the
    // right workbook. Telling somebody holding the correct file that none of
    // the sheets are in it sends them hunting for a file they already have.
    expect(sheetsFound({ Agreements_Master: [] })).toEqual(['Agreements_Master']);
    // It carries nothing, though, and that is the separate thing to say.
    expect(sheetsWithRows({ Agreements_Master: [] })).toEqual([]);
  });

  it('names the sheets it did recognise', () => {
    expect(sheetsFound({ Projects_Master: [{ a: 1 }], Nonsense: [{ b: 2 }] })).toEqual([
      'Projects_Master',
    ]);
  });
});

describe('a workbook with real rows', () => {
  it('is not reported as empty', () => {
    const plan = buildImportPlan(
      {
        Agreements_Master: [
          {
            Agreement_ID: 'AGR-2026-001',
            Agreement_Name: 'Bole Tower',
            Contract_Value: 4_000_000,
            Currency: 'ETB',
          },
        ],
      },
      OPTIONS,
    );

    expect(planIsEmpty(plan)).toBe(false);
    expect(plan.contracts).toHaveLength(1);
  });

  it('every sheet the importer reads is listed for the page to show', () => {
    // Guards against a sheet being added to the mapper and not to the list the
    // page shows, which would have it reported as "not in this file" forever.
    const everySheet: Workbook = {};
    for (const name of SOURCE_SHEETS) everySheet[name] = [{ x: 1 }];
    expect(sheetsFound(everySheet)).toEqual([...SOURCE_SHEETS]);
  });
});

/**
 * The list is only as good as its agreement with the mapper.
 *
 * A self-consistent list proves nothing: if a sheet is added to the mapper and
 * not here, the page reports it as "not in this file" for ever and the guard
 * starts lying about a workbook that is in fact correct. So the source is read
 * and every sheet it asks for is checked against the list.
 */
describe('the list agrees with the mapper', () => {
  it('covers every sheet either mapper reads', async () => {
    const { readFile } = await import('node:fs/promises');
    const sources = await Promise.all([
      readFile(new URL('../import-master.ts', import.meta.url), 'utf8'),
      readFile(new URL('../import-people.ts', import.meta.url), 'utf8'),
    ]);

    const asked = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/\bsheet\('([^']+)'\)/g)) {
        asked.add(match[1] as string);
      }
    }

    expect(asked.size).toBeGreaterThan(0);
    expect([...asked].sort()).toEqual([...SOURCE_SHEETS].sort());
  });
});
