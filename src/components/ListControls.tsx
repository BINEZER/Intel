/**
 * The search box, filters and sort control for a list that is NOT a table.
 *
 * Projects and programs are shown as cards, because a project carries a
 * progress bar and a family of sub-projects that a table row cannot hold. They
 * still have to be findable in a list of 163, so they get the same controls a
 * table header gives — the same `filterRows` and `sortRows` behind them, so
 * money and dates sort as numbers here too.
 */

import type { ReactNode } from 'react';
import { NumberListsToggle } from './NumberListsToggle.js';
import {
  EMPTY_FILTER,
  activeFilterCount,
  distinctValues,
  type ColumnSpec,
  type FilterState,
  type SortState,
} from '../lib/table.js';

export function ListControls<Row>({
  rows,
  shown,
  columns,
  filter,
  onFilter,
  sort,
  onSort,
  noun,
}: {
  rows: readonly Row[];
  shown: number;
  columns: readonly ColumnSpec<Row>[];
  filter: FilterState;
  onFilter: (next: FilterState) => void;
  sort: SortState;
  onSort: (next: SortState) => void;
  noun: string;
}): ReactNode {
  const dropdowns = columns
    .filter((c) => c.filterable === true)
    .map((c) => ({ column: c, values: distinctValues(rows, c) }))
    .filter((d) => d.values.length > 1);
  const filtersOn = activeFilterCount(filter);

  return (
    <div className="table-controls no-print">
      <input
        type="search"
        className="table-search"
        placeholder={`Search ${noun}…`}
        value={filter.search}
        onChange={(event) => onFilter({ ...filter, search: event.target.value })}
        aria-label={`Search ${noun}`}
      />

      {dropdowns.map(({ column, values }) => (
        <select
          key={column.key}
          value={filter.columns[column.key] ?? ''}
          aria-label={`Filter by ${column.label}`}
          onChange={(event) =>
            onFilter({ ...filter, columns: { ...filter.columns, [column.key]: event.target.value } })
          }
        >
          <option value="">All {column.label.toLowerCase()}</option>
          {values.map((value) => (
            <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
          ))}
        </select>
      ))}

      {/* One control rather than clickable headings: there are no headings on a
          card list, and a hidden sort menu is a sort nobody finds. */}
      <select
        value={sort.key === null ? '' : `${sort.key}:${sort.direction}`}
        aria-label={`Sort ${noun}`}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onSort({ key: null, direction: 'asc' });
            return;
          }
          const [key, direction] = raw.split(':');
          onSort({ key: key as string, direction: direction === 'desc' ? 'desc' : 'asc' });
        }}
      >
        <option value="">Default order</option>
        {columns
          .filter((c) => c.unsortable !== true)
          .flatMap((c) => [
            <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{c.label} ↑</option>,
            <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{c.label} ↓</option>,
          ])}
      </select>

      {filtersOn > 0 && (
        <button type="button" onClick={() => onFilter(EMPTY_FILTER)}>
          Clear {filtersOn === 1 ? 'filter' : 'filters'}
        </button>
      )}
      <NumberListsToggle />
      <span className="muted table-count">
        {filtersOn > 0 ? `Showing ${shown} of ${rows.length} ${noun}` : `${rows.length} ${noun}`}
      </span>
    </div>
  );
}
