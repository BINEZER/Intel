/**
 * Recovering the original sheets from a consolidated workbook.
 *
 * The shapes here are taken from the real file: the banner text, the marker
 * character, the double space before the count, and the blank row between one
 * block and the next banner.
 */

import { describe, expect, it } from 'vitest';
import { buildWorkbook, parseBanner, splitSheet, type Cell, type Grid } from '../workbook-blocks.js';

describe('reading a banner', () => {
  it('reads the form the file actually uses', () => {
    expect(parseBanner('▼ From: Elevator_List_Full  (142 rows)')).toEqual({
      sheet: 'Elevator_List_Full',
      rows: 142,
    });
  });

  it('does not depend on the marker or the spacing', () => {
    expect(parseBanner('From: HR_Roster (27 rows)')).toEqual({ sheet: 'HR_Roster', rows: 27 });
    expect(parseBanner('  ▽  From:   Sch_Gantt_2  ( 22 rows )  ')).toEqual({
      sheet: 'Sch_Gantt_2',
      rows: 22,
    });
  });

  it('reads a single row without tripping on the plural', () => {
    expect(parseBanner('▼ From: Maint_Contracts (1 row)')).toEqual({
      sheet: 'Maint_Contracts',
      rows: 1,
    });
  });

  it('is not fooled by ordinary text', () => {
    expect(parseBanner('From: Abebe')).toBeNull();
    expect(parseBanner('Payment received from: the client (2 rows)')).toBeNull();
    expect(parseBanner(null)).toBeNull();
    expect(parseBanner(42)).toBeNull();
  });
});

/** The real `HR_Technicians` layout: three blocks, blank row before each banner. */
const consolidated: Grid = [
  ['▼ From: HR_Roster  (3 rows)'],
  ['No.', 'Name', 'Phone'],
  [1, 'Fasika', '0911'],
  [2, 'Abraham', '0912'],
  [],
  ['▼ From: HR_Roster_Prev  (2 rows)'],
  ['No.', 'Name', 'Phone'],
  [1, 'Yosef', '0913'],
];

describe('splitting a consolidated tab', () => {
  it('recovers each block under its original name', () => {
    const blocks = splitSheet('HR_Technicians', consolidated);
    expect(blocks.map((b) => b.name)).toEqual(['HR_Roster', 'HR_Roster_Prev']);
    expect(blocks.every((b) => b.foundIn === 'HR_Technicians')).toBe(true);
  });

  it('uses the row after the banner as the header', () => {
    const [current] = splitSheet('HR_Technicians', consolidated);
    expect(current?.rows).toEqual([
      { 'No.': 1, Name: 'Fasika', Phone: '0911' },
      { 'No.': 2, Name: 'Abraham', Phone: '0912' },
    ]);
  });

  it('stops at the next banner and drops the blank row between', () => {
    const blocks = splitSheet('HR_Technicians', consolidated);
    expect(blocks[0]?.rows).toHaveLength(2);
    expect(blocks[1]?.rows).toEqual([{ 'No.': 1, Name: 'Yosef', Phone: '0913' }]);
  });

  it('reads the count as including the header row', () => {
    // Across every block in the real file the count is exactly one more than
    // the data beneath it, so `(3 rows)` is a header and two rows.
    const counted: Grid = [
      ['▼ From: HR_Roster  (3 rows)'],
      ['Name'],
      ['Fasika'],
      ['Abraham'],
    ];
    const [block] = splitSheet('HR_Technicians', counted);
    expect(block?.rows).toHaveLength(2);
    // No complaint: the count and the rows agree.
    expect(block?.declaredRows).toBeUndefined();
    expect(block?.rowsBeyondTheCount).toBeUndefined();
  });

  it('stops the last block at its count instead of running to the end of the tab', () => {
    // The real failure this prevents: the last block of HR_Technicians has no
    // banner after it, and reading to the end of the sheet swept 15 rows of
    // trailing notes into a roster — which would have become people.
    const trailing: Grid = [
      ['▼ From: Eng_Technicians_List  (3 rows)'],
      ['Name'],
      ['Fasika'],
      ['Abraham'],
      [],
      ['Notes below, not technicians'],
      ['Ordered spare parts'],
    ];
    const [block] = splitSheet('HR_Technicians', trailing);
    expect(block?.rows).toEqual([{ Name: 'Fasika' }, { Name: 'Abraham' }]);
    // Said out loud rather than resolved silently.
    expect(block?.rowsBeyondTheCount).toBe(2);
  });

  it('never runs past the next banner, even if the count says to', () => {
    const overreaching: Grid = [
      ['▼ From: HR_Roster  (99 rows)'],
      ['Name'],
      ['Fasika'],
      ['▼ From: HR_Roster_Prev  (2 rows)'],
      ['Name'],
      ['Yosef'],
    ];
    const blocks = splitSheet('HR_Technicians', overreaching);
    expect(blocks[0]?.rows).toEqual([{ Name: 'Fasika' }]);
    expect(blocks[1]?.rows).toEqual([{ Name: 'Yosef' }]);
    // The count was wrong and the block says so.
    expect(blocks[0]?.declaredRows).toBe(99);
  });

  it('reads an ordinary tab as itself', () => {
    const plain: Grid = [
      ['Project_ID', 'Contract_ID'],
      ['PRJ-1', 'AGR-1'],
    ];
    const blocks = splitSheet('Projects_Master', plain);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.name).toBe('Projects_Master');
    expect(blocks[0]?.foundIn).toBeNull();
    expect(blocks[0]?.rows).toEqual([{ Project_ID: 'PRJ-1', Contract_ID: 'AGR-1' }]);
  });

  it('gives blank and repeated headers positional names rather than merging them', () => {
    const messy: Grid = [
      ['Name', null, 'Name'],
      ['Fasika', 'x', 'Abraham'],
    ];
    const [block] = splitSheet('Odd', messy);
    expect(block?.rows).toEqual([{ Name: 'Fasika', __EMPTY_1: 'x', Name_1: 'Abraham' }]);
  });
});

describe('a block whose header is not the row under the banner', () => {
  it('steps over a title row', () => {
    // Ops_Collection_Status opens with its title on its own line. Taking the
    // row under the banner on faith gave the block one column called "PROJECT
    // TRACKER for colletion" and made the real header the first row of data.
    // The real title row is not clean: it carries two stray labels out in
    // columns 16 and 17, which is why a plain "has a few values" test let it
    // through. Their DISTANCE from the left is what marks the row as a caption,
    // so the fixture keeps them out there.
    const strays: Cell[] = Array.from({ length: 17 }, () => null);
    strays[0] = 'PROJECT TRACKER for colletion';
    strays[15] = 'HOLD';
    strays[16] = 'APPROVAL MEASUREMENT';
    const titled: Grid = [
      ['▼ From: Ops_Collection_Status  (4 rows)'],
      strays,
      ['NO.', 'PROJECT', 'DATES', 'ASSIGNED TO', 'TOTAL CONTRACT VALUE', 'COMPLETED PAYMENT', 'REMAINDER'],
      [1, 'Ato Bedrudin', null, null, 4701920.46, 2350960.23, 2350960.23],
      [2, 'Ato Hailu', null, null, 3893389.38, 1946694.69, 1946694.69],
    ];
    const [block] = splitSheet('Collections', titled);
    expect(block?.rows.map((r) => [r['PROJECT'], r['COMPLETED PAYMENT']])).toEqual([
      ['Ato Bedrudin', 2350960.23],
      ['Ato Hailu', 1946694.69],
    ]);
    // The count spans the title and the header, so it still agrees.
    expect(block?.declaredRows).toBeUndefined();
  });

  it('steps over an entirely blank row', () => {
    const blankFirst: Grid = [
      ['▼ From: Fin_Receivables_Agreements  (3 rows)'],
      [null, null, null],
      ['S.N', 'Name of Organization', 'Total Amount', 'Amount paid up to now'],
      [1, 'Someone', 400, 100],
    ];
    const [block] = splitSheet('Fin_Receivables', blankFirst);
    expect(block?.rows).toEqual([
      { 'S.N': 1, 'Name of Organization': 'Someone', 'Total Amount': 400, 'Amount paid up to now': 100 },
    ]);
  });

  it('does not take a row of names for a title', () => {
    // Eng_Technicians_List is a rota: names across the columns and no header row
    // at all. An earlier rule judged its first row a title because the row below
    // was wider, consumed it as the header, and lost a technician.
    const rota: Grid = [
      ['▼ From: Eng_Technicians_List  (3 rows)'],
      ['FASIKA', 'ATO MILION', 'MAW'],
      ['DEJENE', 'COL MEGERSSA', 'DR MEGERSA', 'WUBLAND'],
    ];
    const [block] = splitSheet('HR_Technicians', rota);
    // The names stay data; the first row is not eaten.
    expect(Object.keys(block?.rows[0] ?? {})).toContain('FASIKA');
    expect(block?.rows).toHaveLength(1);
  });

  it('keeps a narrow header when nothing reads as a title', () => {
    const narrow: Grid = [
      ['▼ From: Maint_Contracts  (3 rows)'],
      ['Name', 'Amount'],
      ['Bole Tower', 1000],
      ['Kazanchis', 2000],
    ];
    const [block] = splitSheet('Maint_Contracts_Service', narrow);
    expect(block?.rows).toEqual([
      { Name: 'Bole Tower', Amount: 1000 },
      { Name: 'Kazanchis', Amount: 2000 },
    ]);
  });
});

describe('building the workbook', () => {
  it('files recovered blocks under the names the mapper reads', () => {
    const { workbook, recovered } = buildWorkbook([
      { name: 'HR_Technicians', grid: consolidated },
    ]);
    expect(workbook['HR_Roster']).toHaveLength(2);
    expect(workbook['HR_Roster_Prev']).toHaveLength(1);
    expect(recovered.map((b) => b.name)).toEqual(['HR_Roster', 'HR_Roster_Prev']);
  });

  it('never lets a stacked copy displace a tab of the same name', () => {
    // A sheet that stands in its own right is the more direct source; a block
    // with the same name inside another tab is more likely to be a snapshot.
    const { workbook } = buildWorkbook([
      {
        name: 'HR_Roster',
        grid: [
          ['Name'],
          ['The real one'],
        ],
      },
      { name: 'HR_Technicians', grid: consolidated },
    ]);
    expect(workbook['HR_Roster']).toEqual([{ Name: 'The real one' }]);
  });

  it('keeps ordinary tabs reachable under their own name', () => {
    const { workbook } = buildWorkbook([
      { name: 'Elevator_Assets', grid: [['Project_ID'], ['PRJ-1']] },
    ]);
    expect(workbook['Elevator_Assets']).toEqual([{ Project_ID: 'PRJ-1' }]);
  });

  it('survives an empty sheet', () => {
    const { workbook } = buildWorkbook([{ name: 'Blank', grid: [] }]);
    expect(workbook['Blank']).toEqual([]);
  });
});
