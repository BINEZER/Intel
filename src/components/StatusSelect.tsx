/**
 * Pick a status, with the sentence that tells it from its neighbours.
 *
 * "Cancelled" and "Terminated" look interchangeable in a dropdown and are not:
 * one job never started and owes nobody anything, the other stopped after work
 * was done and may still need settling. The hint for the current choice is
 * shown under the control, so the difference is visible at the moment of
 * choosing rather than in a manual nobody has.
 */

import {
  statusChipClass,
  statusHint,
  statusLabel,
  statusOptions,
  type StatusKind,
} from '../lib/status.js';

export function StatusSelect({
  kind,
  value,
  onChange,
  id,
  disabled,
}: {
  kind: StatusKind;
  value: string;
  onChange: (value: string) => void;
  id: string;
  disabled?: boolean;
}) {
  const options = statusOptions(kind);
  const hint = statusHint(kind, value);
  const known = options.some((option) => option.value === value);

  return (
    <>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-describedby={hint === null ? undefined : `${id}-hint`}
      >
        {/* A stored value the vocabulary does not know still has to be
            selectable, or opening the form would silently change it. */}
        {!known && <option value={value}>{value.replace(/_/g, ' ')}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== null && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
    </>
  );
}

/** The status as a coloured chip, for lists. */
export function StatusChip({ kind, value }: { kind: StatusKind; value: string }) {
  return <span className={statusChipClass(kind, value)}>{statusLabel(kind, value)}</span>;
}
