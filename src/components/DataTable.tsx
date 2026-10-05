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
 * ON A PHONE OR A TABLET HELD UPRIGHT
 *   A table with ten columns cannot be read in 390 pixels. It used to scroll
 *   sideways inside its card, which kept the page from overflowing but hid the
 *   columns that mattered — on the contracts list the value and the status were
 *   off-screen while the narrowest, least useful columns took the room, and
 *   nothing said there was more to the right.
 *
 *   So below the width where the sidebar becomes a drawer, each row becomes a
 *   card: the first column is its title and every other column is a labelled
 *   line beneath it. The labels come from `data-label` on each cell and the
 *   layout is entirely CSS — the same markup, the same sort and filter, the same
 *   print output, so nothing here has to be kept in step with a second
 *   mobile-only table.
 *
 *   The headers are hidden in that layout, and the headers were how a table was
 *   sorted. A "Sort by" menu stands in for them, built from the same columns.
 *
 * WHAT IS PRINTED
 *   Whatever is on screen. Somebody who filters to one client and presses Print
 *   expects that client's rows, not all 129 — the filter IS the report.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { NumberListsToggle, useListsNumbered } from './NumberListsToggle.js';
import { rowNumberWidth } from '../lib/list-numbering.js';
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
  const numbered = useListsNumbered();

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
        <SortMenu columns={columns} sort={sort} onSort={setSort} />
        <NumberListsToggle />
        <span className="muted table-count">
          {filtersOn > 0
            ? `Showing ${shown.length} of ${rows.length} ${noun}`
            : `${rows.length} ${noun}`}
        </span>
      </div>

      <div className="table-scroll">
        <table className="data-table" role="table">
          {caption !== undefined && <caption>{caption}</caption>}
          <thead>
            <tr role="row">
              {/* Not a column of data: nothing sorts or filters by it, and the
                  heading is a symbol rather than a word so it takes no room. */}
              {numbered && (
                <th scope="col" className="row-number-col" aria-label="Row number">
                  #
                </th>
              )}
              {columns.map((column) => {
                const sorted = sort.key === column.key;
                const canSort = column.unsortable !== true;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    role="columnheader"
                    className={cellClass(column)}
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
          {/* The roles restore the table semantics that a `display: block` card
              layout strips in Safari, so a screen reader still hears rows and
              columns rather than a stream of loose text. */}
          <tbody role="rowgroup">
            {shown.map((row, index) => (
              <tr key={rowKey(row)} className={rowClass?.(row)} role="row">
                {numbered && (
                  <td
                    role="cell"
                    data-label="#"
                    className="row-number-col"
                    style={{ '--row-number-ch': rowNumberWidth(shown.length) } as CSSProperties}
                  >
                    {index + 1}
                  </td>
                )}
                {columns.map((column, position) => (
                  <td
                    key={column.key}
                    role="cell"
                    // What the cell is, for the card layout. The actions column
                    // has no label: a row of buttons does not need to be told it
                    // is a row of buttons.
                    data-label={column.key === 'actions' ? '' : column.label}
                    // The first column is the card's heading and wears no label.
                    data-primary={position === 0 ? '' : undefined}
                    className={cellClass(column)}
                  >
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

/**
 * Sort without the headers.
 *
 * Only shown where the headers are hidden (see the stylesheet), and built from
 * the same sortable columns so the two can never disagree about what can be
 * sorted. Each column appears twice, once per direction, because on a phone
 * "tap the heading again to reverse it" is not available.
 */
function SortMenu<Row>({
  columns,
  sort,
  onSort,
}: {
  columns: readonly DataColumn<Row>[];
  sort: SortState;
  onSort: (state: SortState) => void;
}) {
  const sortable = columns.filter((c) => c.unsortable !== true && c.key !== 'actions');
  if (sortable.length === 0) return null;
  const current = sort.key === null ? '' : `${sort.key}:${sort.direction}`;
  return (
    <select
      className="table-sort-menu"
      aria-label="Sort by"
      value={current}
      onChange={(event) => {
        const value = event.target.value;
        if (value === '') {
          onSort({ key: null, direction: 'asc' });
          return;
        }
        const at = value.lastIndexOf(':');
        onSort({ key: value.slice(0, at), direction: value.slice(at + 1) === 'desc' ? 'desc' : 'asc' });
      }}
    >
      <option value="">Default order</option>
      {sortable.map((column) => (
        <optgroup key={column.key} label={column.label}>
          <option value={`${column.key}:asc`}>{column.label} — A to Z, low to high</option>
          <option value={`${column.key}:desc`}>{column.label} — Z to A, high to low</option>
        </optgroup>
      ))}
    </select>
  );
}

/**
 * The class a header or body cell wears.
 *
 * The actions column is pinned to the right edge by CSS, because on a table too
 * wide for its card the first thing to scroll out of reach was the Edit/Delete
 * column — the one you were reaching for.
 */
function cellClass<T>(column: { key: string; numeric?: boolean }): string | undefined {
  const classes = [
    column.numeric === true ? 'num' : '',
    column.key === 'actions' ? 'actions-col' : '',
  ].filter((c) => c !== '');
  return classes.length === 0 ? undefined : classes.join(' ');
}
