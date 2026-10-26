import type { ReactNode } from 'react';

export interface DateRange {
  from: string;
  to: string;
}

export const EMPTY_DATE_RANGE: DateRange = { from: '', to: '' };

export function inDateRange(value: Date | null | undefined, range: DateRange): boolean {
  if (range.from === '' && range.to === '') return true;
  if (value == null || Number.isNaN(value.getTime())) return false;
  const day = value.toISOString().slice(0, 10);
  return (range.from === '' || day >= range.from) && (range.to === '' || day <= range.to);
}

export function DateRangeFilter({
  range, onChange, label,
}: {
  range: DateRange;
  onChange: (range: DateRange) => void;
  label: string;
}): ReactNode {
  return (
    <div className="table-controls no-print date-range-filter" role="group" aria-label={`${label} date range`}>
      <span className="muted">Filter by {label}</span>
      <label>From <input type="date" value={range.from} aria-label={`${label} from date`} onChange={(e) => onChange({ ...range, from: e.target.value })} /></label>
      <label>To <input type="date" value={range.to} aria-label={`${label} to date`} onChange={(e) => onChange({ ...range, to: e.target.value })} /></label>
      {(range.from !== '' || range.to !== '') && <button type="button" onClick={() => onChange(EMPTY_DATE_RANGE)}>Clear dates</button>}
    </div>
  );
}
