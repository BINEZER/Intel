/**
 * A table you can sort and narrow.
 *
 * Every list in the app runs through this, so the behaviour is the same
 * everywhere: click a heading to sort, click again to reverse, a third time to
 * put it back. A search box narrows on what is displayed, and a column that
 * repeats offers a dropdown of its values.
 *
 * WHAT THE CALLER SUPPLIES
 *   Both a `value` (what to sort and filter on — the number, the date) and a
 *   `render` (what the cell shows). Keeping them apart is the point: sorting a
 *   money column by its formatted string puts ETB 9,000 above ETB 40,000.
 *
 * WHAT IS PRINTED
 *   Whatever is on screen. Somebody who filters to one client and presses Print
 *   expects that client's rows, not all 129 — the filter IS the report.
 */

import { useMemo, useState, type ReactNode } from 'react';
import {
  EMPTY_FILTER,
  activeFilterCount,
  distinctValues,
  filterRows,
  nextSort,
  sortRows,
  type ColumnSpec,
  type FilterState,
  type SortState,
} from '../lib/table.js';

export interface DataColumn<Row> extends ColumnSpec<Row> {
  /** What the cell shows. Defaults to the sort value, rendered as text. */
  render?: (row: Row) => ReactNode;
  /** Plain text for the search box and for a column dropdown. */
  text?: (row: Row) => string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  caption,
  rowClass,
  empty = 'Nothing here yet.',
  noun = 'rows',
}: {
  rows: readonly Row[];
  columns: readonly DataColumn<Row>[];
  rowKey: (row: Row) => string;
  caption?: string;
  rowClass?: (row: Row) => string | undefined;
  empty?: string;
  /** What the rows are, for "showing 12 of 129 contracts". */
  noun?: string;
}) {
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);

  const textOf = (row: Row, column: ColumnSpec<Row>) => {
    const full = columns.find((c) => c.key === column.key);
    if (full?.text !== undefined) return full.text(row);
    const value = column.value(row);
    return value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value);
  };

  const shown = useMemo(() => {
    const narrowed = filterRows(rows, columns, filter, textOf);
    return sortRows(narrowed, columns, sort);
    // `textOf` is derived from columns; listing it would re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, filter, sort]);

  const dropdowns = useMemo(
    () =>
      columns
        .filter((c) => c.filterable === true)
        .map((c) => ({ column: c, values: distinctValues(rows, c) }))
        .filter((d) => d.values.length > 1),
    [rows, columns],
  );

  const filtersOn = activeFilterCount(filter);

  return (
    <>
      <div className="table-controls no-print">
        <input
          type="search"
          className="table-search"
          placeholder={`Search ${noun}…`}
          value={filter.search}
          onChange={(event) => setFilter((f) => ({ ...f, search: event.target.value }))}
          aria-label={`Search ${noun}`}
        />
        {dropdowns.map(({ column, values }) => (
          <select
            key={column.key}
            value={filter.columns[column.key] ?? ''}
            aria-label={`Filter by ${column.label}`}
            onChange={(event) =>
              setFilter((f) => ({
                ...f,
                columns: { ...f.columns, [column.key]: event.target.value },
              }))
            }
          >
            <option value="">All {column.label.toLowerCase()}</option>
            {values.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        ))}
        {filtersOn > 0 && (
          <button type="button" onClick={() => setFilter(EMPTY_FILTER)}>
            Clear {filtersOn === 1 ? 'filter' : 'filters'}
          </button>
        )}
        <span className="muted table-count">
          {filtersOn > 0
            ? `Showing ${shown.length} of ${rows.length} ${noun}`
            : `${rows.length} ${noun}`}
        </span>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          {caption !== undefined && <caption>{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => {
                const sorted = sort.key === column.key;
                const canSort = column.unsortable !== true;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.numeric === true ? 'num' : undefined}
                    aria-sort={
                      !sorted ? 'none' : sort.direction === 'asc' ? 'ascending' : 'descending'
                    }
                  >
                    {canSort ? (
                      <button
                        type="button"
                        className={`th-sort ${sorted ? 'is-sorted' : ''}`}
                        onClick={() => setSort((s) => nextSort(s, column.key))}
                      >
                        {column.label}
                        <span aria-hidden="true" className="th-arrow">
                          {sorted ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)} className={rowClass?.(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric === true ? 'num' : undefined}>
                    {column.render === undefined ? textOf(row, column) : column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown.length === 0 && (
        <p className="muted">
          {rows.length === 0 ? empty : `No ${noun} match. Clear the filters to see all ${rows.length}.`}
        </p>
      )}
    </>
  );
}
