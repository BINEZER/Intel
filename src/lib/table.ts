/**
 * Sorting and filtering a list, without the sort lying about the data.
 *
 * TWO THINGS GO WRONG IN HAND-ROLLED TABLE SORTS
 *
 *   Money and dates get sorted as the strings they are displayed as. "ETB
 *   9,000" then sorts above "ETB 40,000" because "9" beats "4", and the
 *   largest contract on the page ends up in the middle of the list. Every
 *   column here therefore carries a SORT VALUE that is the underlying number
 *   or date, separate from the text shown in the cell.
 *
 *   Blanks sort to the top. A column of overdue days where half the rows have
 *   no date puts every blank first, so the one thing the sort was for — the
 *   worst row — is buried. Blanks always sort last here, in both directions,
 *   because "no value" is not smaller than every value; it is absent.
 *
 * The search box matches on what is DISPLAYED, because that is what somebody
 * is looking at when they type.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  /** Column key, or null while the list is in its natural order. */
  key: string | null;
  direction: SortDirection;
}

/** What a column can be sorted and filtered on. */
export type CellValue = string | number | Date | null | undefined;

export interface ColumnSpec<Row> {
  key: string;
  /** The heading. */
  label: string;
  /** The value to sort and filter on. Never the formatted string. */
  value: (row: Row) => CellValue;
  /** Right-aligned numeric column. */
  numeric?: boolean;
  /** Offer a dropdown of the distinct values in this column. */
  filterable?: boolean;
  /** Excluded from sorting — an actions column, for instance. */
  unsortable?: boolean;
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

function isBlank(value: CellValue): boolean {
  return value === null || value === undefined || value === '';
}

/**
 * Compare two cells of the same column.
 *
 * Numbers compare as numbers, dates as instants, everything else
 * case-insensitively and numerically-aware, so LIFT-2 comes before LIFT-10.
 */
export function compareValues(a: CellValue, b: CellValue): number {
  if (isBlank(a) && isBlank(b)) return 0;
  // Blanks last in BOTH directions: absent is not "smaller than everything".
  if (isBlank(a)) return 1;
  if (isBlank(b)) return -1;

  if (a instanceof Date || b instanceof Date) {
    const left = a instanceof Date ? a.getTime() : Number(a);
    const right = b instanceof Date ? b.getTime() : Number(b);
    return left - right;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Sort rows by one column.
 *
 * Blanks stay at the bottom when the direction flips, so `direction` is applied
 * to the comparison of two present values only.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnSpec<Row>[],
  sort: SortState,
): Row[] {
  if (sort.key === null) return [...rows];
  const column = columns.find((c) => c.key === sort.key);
  if (column === undefined) return [...rows];

  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    if (isBlank(a) && isBlank(b)) return 0;
    if (isBlank(a)) return 1;
    if (isBlank(b)) return -1;
    return compareValues(a, b) * sign;
  });
}

/** Clicking a heading: same column flips, a new column starts ascending. */
export function nextSort(current: SortState, key: string): SortState {
  if (current.key !== key) return { key, direction: 'asc' };
  return current.direction === 'asc'
    ? { key, direction: 'desc' }
    : // A third click clears it, so a list can be put back to its natural order
      // — which for most of these pages is the order somebody chose.
      { key: null, direction: 'asc' };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Column key -> the exact value chosen from its dropdown. */
export type ColumnFilters = Record<string, string>;

function asText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * The distinct values in a column, for its dropdown.
 *
 * Only worth offering where the column actually repeats: a dropdown of two
 * hundred distinct contract titles is a worse search box.
 */
export function distinctValues<Row>(
  rows: readonly Row[],
  column: ColumnSpec<Row>,
  limit = 40,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    const text = asText(column.value(row));
    if (text !== '') seen.add(text);
    if (seen.size > limit) return [];
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export interface FilterState {
  /** Free text, matched against every column's displayed text. */
  search: string;
  columns: ColumnFilters;
}

export const EMPTY_FILTER: FilterState = { search: '', columns: {} };

/**
 * Apply the search box and the column dropdowns.
 *
 * Search terms are AND-ed: typing "adera 2024" finds the row that matches both,
 * which is how people expect a search box to narrow rather than widen.
 */
export function filterRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnSpec<Row>[],
  filter: FilterState,
  /** The text actually rendered, where it differs from the sort value. */
  displayText?: (row: Row, column: ColumnSpec<Row>) => string,
): Row[] {
  const terms = filter.search
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t !== '');
  const active = Object.entries(filter.columns).filter(([, value]) => value !== '');

  const textOf = (row: Row, column: ColumnSpec<Row>) =>
    displayText === undefined ? asText(column.value(row)) : displayText(row, column);

  return rows.filter((row) => {
    for (const [key, wanted] of active) {
      const column = columns.find((c) => c.key === key);
      if (column === undefined) continue;
      if (asText(column.value(row)) !== wanted) return false;
    }
    if (terms.length === 0) return true;
    const haystack = columns.map((c) => textOf(row, c)).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** How many filters are on, for the "showing 12 of 129" line. */
export function activeFilterCount(filter: FilterState): number {
  return (
    (filter.search.trim() === '' ? 0 : 1) +
    Object.values(filter.columns).filter((v) => v !== '').length
  );
}
