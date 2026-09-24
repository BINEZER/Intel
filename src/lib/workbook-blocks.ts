/**
 * Recover the original sheets from a consolidated workbook.
 *
 * WHAT HAPPENED TO THE FILE
 *   The master workbook was consolidated: tabs that used to stand alone were
 *   stacked into one, each block introduced by a banner row reading
 *
 *       ▼ From: Elevator_List_Full  (142 rows)
 *
 *   with the block's real header on the row after it. So `Elevator_List` is not
 *   a renamed `Elevator_List_Full` — it CONTAINS it, followed by a second block
 *   of last month's version.
 *
 * WHY THIS IS A PRE-PASS AND NOT A REWRITE OF THE MAPPER
 *   Every sheet the importer reads is still in the file, with the same columns
 *   and the same meaning; only its address changed. Teaching the mapper each
 *   new tab name and offset would mean changing it again at the next
 *   consolidation, and every rule it has learned about these rows would have to
 *   be re-tested. Putting the sheets back where they were leaves the mapper —
 *   and everything proved about it — untouched.
 *
 * THE DECLARED COUNT IS THE BLOCK'S EXTENT, AND IT COUNTS ITS OWN HEADER
 *   Across every block in the real file the count is exactly one more than the
 *   rows of data beneath it, so `(142 rows)` means a header and 141 rows. That
 *   consistency is the evidence it is machine-written by whatever consolidated
 *   the file, not maintained by hand, so it is trusted.
 *
 *   It has to be. The last block in a tab has no following banner to stop at,
 *   and reading to the end of the sheet swept 15 rows of unrelated trailing
 *   content into `Eng_Technicians_List` — which is read as a roster, so those
 *   rows would have become people. Over-reading invents records; the count
 *   prevents it. A block still never runs past the next banner, and where the
 *   two disagree the block says so rather than resolving it silently.
 *
 *   A block is never allowed to overwrite a real tab of the same name. A sheet
 *   that exists in its own right is the more direct source, and a stacked copy
 *   of it is more likely to be a snapshot.
 */

import type { Row, Workbook } from './import-master.js';

/** One cell as the spreadsheet reader hands it over. */
export type Cell = string | number | boolean | Date | null | undefined;

/** A sheet as rows of cells, headers included — positional, not keyed. */
export type Grid = readonly (readonly Cell[])[];

export interface SheetBlock {
  /** The name to file these rows under. */
  name: string;
  rows: Row[];
  /** The tab the block was found in, or null when the tab is not consolidated. */
  foundIn: string | null;
  /**
   * The count the banner declared, present only where it disagrees with the
   * rows found (the count includes the header, so agreement means `rows + 1`).
   */
  declaredRows?: number;
  /**
   * Rows that sat between the end of the declared block and the next banner,
   * and were therefore not read. Usually trailing notes under the last block
   * of a tab; a large number here means the count and the file have diverged.
   */
  rowsBeyondTheCount?: number;
}

/**
 * Read a banner row.
 *
 * The marker character is optional and the spacing is not trusted: this is a
 * human-generated header, and the one thing that must be exact is the name.
 */
export function parseBanner(value: Cell): { sheet: string; rows: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*[▼▾▽>]*\s*From:\s*(.+?)\s*\(\s*(\d+)\s*rows?\s*\)\s*$/.exec(value);
  if (match === null) return null;
  const sheet = (match[1] ?? '').trim();
  if (sheet === '') return null;
  return { sheet, rows: Number(match[2]) };
}

/** True when every cell in the row is empty. */
function isBlank(row: readonly Cell[] | undefined): boolean {
  if (row === undefined) return true;
  return row.every((cell) => cell === null || cell === undefined || cell === '');
}

/**
 * Turn a header row and the rows beneath it into keyed rows.
 *
 * Blank and duplicate headers are given positional names rather than dropped:
 * a column the mapper does not read costs nothing, and a column silently
 * merged into its neighbour costs a value.
 */
function keyRows(header: readonly Cell[], body: Grid): Row[] {
  const names = header.map((cell, index) => {
    const name = typeof cell === 'string' ? cell.trim() : cell === null || cell === undefined ? '' : String(cell);
    return name === '' ? `__EMPTY_${index}` : name;
  });
  const seen = new Map<string, number>();
  const unique = names.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count}`;
  });

  const rows: Row[] = [];
  for (const line of body) {
    if (isBlank(line)) continue;
    const row: Row = {};
    unique.forEach((name, index) => {
      row[name] = line[index] ?? null;
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Split one tab into the blocks it holds.
 *
 * A tab with no banner yields itself, read the ordinary way: first row the
 * header, the rest the data.
 */
export function splitSheet(name: string, grid: Grid): SheetBlock[] {
  const banners: Array<{ at: number; sheet: string; rows: number }> = [];
  grid.forEach((row, index) => {
    const banner = parseBanner(row[0]);
    if (banner !== null) banners.push({ at: index, ...banner });
  });

  if (banners.length === 0) {
    const [header, ...body] = grid;
    if (header === undefined) return [{ name, rows: [], foundIn: null }];
    return [{ name, rows: keyRows(header, body), foundIn: null }];
  }

  const blocks: SheetBlock[] = [];
  banners.forEach((banner, index) => {
    const header = grid[banner.at + 1];
    if (header === undefined) return;

    // The count spans the header too, so the last row of data sits at
    // `at + rows`. Whichever comes first, that or the next banner.
    const nextBanner = banners[index + 1]?.at ?? grid.length;
    const declaredEnd = banner.at + banner.rows + 1;
    const end = Math.min(nextBanner, declaredEnd);

    const rows = keyRows(header, grid.slice(banner.at + 2, end));
    // What was there to read, had the count not stopped it. Reported rather
    // than acted on: the count is the safer of the two and stays in charge.
    const available = keyRows(header, grid.slice(banner.at + 2, nextBanner)).length;

    blocks.push({
      name: banner.sheet,
      rows,
      foundIn: name,
      ...(available === rows.length ? {} : { rowsBeyondTheCount: available - rows.length }),
      ...(rows.length === banner.rows - 1 ? {} : { declaredRows: banner.rows }),
    });
  });
  return blocks;
}

/**
 * Build the workbook the mapper expects from the tabs as they are in the file.
 *
 * Both addresses are kept: the tab's own name and every block inside it. A
 * mapper that already reads `Elevator_Assets` keeps working, and one that reads
 * `Elevator_List_Full` starts working again.
 */
export function buildWorkbook(sheets: ReadonlyArray<{ name: string; grid: Grid }>): {
  workbook: Workbook;
  /** Every block recovered from inside a consolidated tab, for the report. */
  recovered: SheetBlock[];
} {
  const workbook: Workbook = {};
  const recovered: SheetBlock[] = [];

  // Tabs first, so a stacked copy can never displace a sheet that stands in its
  // own right.
  for (const sheet of sheets) {
    const blocks = splitSheet(sheet.name, sheet.grid);
    const own = blocks.find((b) => b.foundIn === null);
    if (own !== undefined) workbook[sheet.name] = own.rows;
    else workbook[sheet.name] = readConsolidatedTabItself(sheet.grid);
  }

  for (const sheet of sheets) {
    for (const block of splitSheet(sheet.name, sheet.grid)) {
      if (block.foundIn === null) continue;
      recovered.push(block);
      if (workbook[block.name] === undefined) workbook[block.name] = block.rows;
    }
  }

  return { workbook, recovered };
}

/**
 * A consolidated tab read under its own name.
 *
 * Kept so nothing that referred to the tab starts reading undefined, but it is
 * the banner row as a header over the first block's rows — which is exactly the
 * garbage that made this pre-pass necessary. Deliberately not used by anything
 * that matters.
 */
function readConsolidatedTabItself(grid: Grid): Row[] {
  const [header, ...body] = grid;
  if (header === undefined) return [];
  return keyRows(header, body);
}
