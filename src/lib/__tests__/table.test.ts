import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  activeFilterCount,
  compareValues,
  distinctValues,
  filterRows,
  nextSort,
  sortRows,
  type ColumnSpec,
  type SortState,
} from '../table.js';

interface Row {
  name: string;
  value: number;
  due: Date | null;
  status: string;
}

const rows: Row[] = [
  { name: 'Adera Hospital', value: 40_000_00, due: new Date(Date.UTC(2026, 0, 10)), status: 'active' },
  { name: 'Bole Tower', value: 9_000_00, due: null, status: 'completed' },
  { name: 'Ayat Estate', value: 125_000_00, due: new Date(Date.UTC(2025, 5, 1)), status: 'active' },
  { name: 'LIFT-10', value: 0, due: new Date(Date.UTC(2027, 2, 3)), status: 'draft' },
  { name: 'LIFT-2', value: 500_00, due: null, status: 'draft' },
];

const columns: ColumnSpec<Row>[] = [
  { key: 'name', label: 'Name', value: (r) => r.name },
  { key: 'value', label: 'Value', value: (r) => r.value, numeric: true },
  { key: 'due', label: 'Due', value: (r) => r.due },
  { key: 'status', label: 'Status', value: (r) => r.status, filterable: true },
];

describe('comparing cells', () => {
  it('compares money as a number, not as the string it is shown as', () => {
    // "ETB 9,000" beats "ETB 40,000" alphabetically, which is how the biggest
    // contract on the page ends up in the middle of the list.
    expect(compareValues(9_000_00, 40_000_00)).toBeLessThan(0);
  });

  it('compares dates as instants', () => {
    expect(compareValues(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2026, 0, 1)))).toBeLessThan(0);
  });

  it('orders text the way a person reads reference numbers', () => {
    expect(compareValues('LIFT-2', 'LIFT-10')).toBeLessThan(0);
  });

  it('is case-insensitive', () => {
    expect(compareValues('adera', 'ADERA')).toBe(0);
  });
});

describe('sorting', () => {
  it('sorts a money column by size', () => {
    const sorted = sortRows(rows, columns, { key: 'value', direction: 'desc' });
    expect(sorted.map((r) => r.value)).toEqual([125_000_00, 40_000_00, 9_000_00, 500_00, 0]);
  });

  it('keeps blanks at the bottom whichever way the column is sorted', () => {
    // A column of dates where half the rows are blank must not bury the row
    // the sort was for under every row that has no date at all.
    const asc = sortRows(rows, columns, { key: 'due', direction: 'asc' });
    expect(asc.slice(-2).every((r) => r.due === null)).toBe(true);

    const desc = sortRows(rows, columns, { key: 'due', direction: 'desc' });
    expect(desc.slice(-2).every((r) => r.due === null)).toBe(true);
  });

  it('leaves the list alone when nothing is sorted', () => {
    expect(sortRows(rows, columns, { key: null, direction: 'asc' })).toEqual(rows);
  });

  it('ignores a column that is not there', () => {
    expect(sortRows(rows, columns, { key: 'nope', direction: 'asc' })).toEqual(rows);
  });

  it('does not mutate the rows it was given', () => {
    const before = [...rows];
    sortRows(rows, columns, { key: 'value', direction: 'asc' });
    expect(rows).toEqual(before);
  });
});

describe('clicking a heading', () => {
  it('goes ascending, descending, then back to the natural order', () => {
    let sort: SortState = { key: null, direction: 'asc' };
    sort = nextSort(sort, 'value');
    expect(sort).toEqual({ key: 'value', direction: 'asc' });
    sort = nextSort(sort, 'value');
    expect(sort).toEqual({ key: 'value', direction: 'desc' });
    // A third click clears it, so the list can be put back the way it was.
    sort = nextSort(sort, 'value');
    expect(sort).toEqual({ key: null, direction: 'asc' });
  });

  it('starts a different column ascending', () => {
    expect(nextSort({ key: 'value', direction: 'desc' }, 'name')).toEqual({
      key: 'name',
      direction: 'asc',
    });
  });
});

describe('filtering', () => {
  it('narrows on an exact column value', () => {
    const found = filterRows(rows, columns, { search: '', columns: { status: 'active' } });
    expect(found.map((r) => r.name)).toEqual(['Adera Hospital', 'Ayat Estate']);
  });

  it('searches across every column', () => {
    expect(filterRows(rows, columns, { search: 'bole', columns: {} })).toHaveLength(1);
    expect(filterRows(rows, columns, { search: 'completed', columns: {} })).toHaveLength(1);
  });

  it('narrows rather than widens on several words', () => {
    // Typing more must find less. OR-ing the terms is the behaviour that makes
    // a search box useless on a long list.
    expect(filterRows(rows, columns, { search: 'adera active', columns: {} })).toHaveLength(1);
    expect(filterRows(rows, columns, { search: 'adera bole', columns: {} })).toHaveLength(0);
  });

  it('combines the search box with the dropdowns', () => {
    const found = filterRows(rows, columns, { search: 'ayat', columns: { status: 'active' } });
    expect(found).toHaveLength(1);
    expect(filterRows(rows, columns, { search: 'ayat', columns: { status: 'draft' } })).toHaveLength(0);
  });

  it('returns everything when nothing is set', () => {
    expect(filterRows(rows, columns, EMPTY_FILTER)).toHaveLength(rows.length);
  });

  it('searches the text actually rendered where that differs', () => {
    // The cell shows "ETB 400.00"; the sort value is 40000 santim. Somebody
    // typing what they can see has to find it.
    const found = filterRows(
      rows,
      columns,
      { search: 'etb', columns: {} },
      (row, column) => (column.key === 'value' ? `ETB ${row.value / 100}` : String(column.value(row))),
    );
    expect(found).toHaveLength(rows.length);
  });
});

describe('the dropdown values', () => {
  it('lists each distinct value once, in order', () => {
    expect(distinctValues(rows, columns[3]!)).toEqual(['active', 'completed', 'draft']);
  });

  it('offers nothing where the column barely repeats', () => {
    // A dropdown of two hundred distinct titles is a worse search box.
    expect(distinctValues(rows, columns[0]!, 2)).toEqual([]);
  });
});

describe('counting what is on', () => {
  it('counts the search box and each dropdown', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
    expect(activeFilterCount({ search: 'x', columns: { status: 'active' } })).toBe(2);
    expect(activeFilterCount({ search: '   ', columns: { status: '' } })).toBe(0);
  });
});
