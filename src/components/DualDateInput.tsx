/**
 * Dual-calendar date input.
 *
 * The user picks a date in either calendar; the component always emits a
 * `DualDate` whose source of truth is a Gregorian UTC timestamp. An Ethiopian
 * date is converted BEFORE it is handed upward, so nothing downstream ever
 * sees an EC value it might mistake for Gregorian.
 *
 * Switching mode mid-edit preserves the date the user already chose.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ETHIOPIAN_MONTHS,
  formatEthiopian,
  formatGregorianShort,
  utcDateToEthiopian,
} from '../lib/ethiopic.js';
import {
  ecDayOptions,
  pagumeHint,
  parseEcParts,
  parseIsoDate,
  toEcParts,
  toIsoDate,
  type EcInputParts,
} from '../lib/date-input.js';
import { dualDateFromEthiopian, dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import type { CalendarSystem, DualDate } from '../lib/schema.js';

export interface DualDateInputProps {
  label: string;
  /** The current value, or null for an empty field. */
  value: DualDate | null;
  onChange: (value: DualDate | null) => void;
  /** Which calendar the picker opens in. An existing value reopens in the calendar it was typed in. */
  defaultMode?: CalendarSystem;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
}

const EMPTY_EC: EcInputParts = { day: '', month: '', year: '' };

export function DualDateInput({
  label,
  value,
  onChange,
  defaultMode = 'GC',
  required = false,
  disabled = false,
  hint,
}: DualDateInputProps) {
  const baseId = useId();
  const [mode, setMode] = useState<CalendarSystem>(value?.enteredIn ?? defaultMode);
  const [iso, setIso] = useState(() => (value ? toIsoDate(value.at.toDate()) : ''));
  const [ec, setEc] = useState<EcInputParts>(() => (value ? toEcParts(value.at.toDate()) : EMPTY_EC));
  const [touched, setTouched] = useState(false);

  /*
   * Adopt a value the PARENT changed.
   *
   * The two fields below are this component's own state, seeded once on mount,
   * so until now a parent that set the date itself — the contract form
   * proposing an end date six months after signing — changed the value and the
   * box on screen stayed empty.
   *
   * Only a value this component did not itself emit is adopted, tracked by the
   * instant last sent out. Without that guard every keystroke would round-trip
   * through the parent and fight the half-typed text in the box.
   */
  const lastEmitted = useRef<number | null>(value?.at.toMillis() ?? null);
  const incoming = value?.at.toMillis() ?? null;
  useEffect(() => {
    if (incoming === lastEmitted.current) return;
    lastEmitted.current = incoming;
    if (value === null) {
      setIso('');
      setEc(EMPTY_EC);
      return;
    }
    const at = value.at.toDate();
    setIso(toIsoDate(at));
    setEc(toEcParts(at));
  }, [incoming, value]);

  const parsed = useMemo(
    () => (mode === 'GC' ? parseIsoDate(iso) : parseEcParts(ec)),
    [mode, iso, ec],
  );

  // Only complain once the user has engaged and left something genuinely wrong —
  // a half-typed year is not an error.
  const showError = touched && !parsed.ok && !parsed.incomplete;
  const errorText = !parsed.ok && !parsed.incomplete ? parsed.error : null;

  function emitGregorian(next: ReturnType<typeof parseIsoDate>) {
    const built = next.ok ? dualDateFromGregorian(next.value, toTimestamp, 'GC') : null;
    lastEmitted.current = built?.at.toMillis() ?? null;
    onChange(built);
  }

  function emitEthiopian(next: ReturnType<typeof parseEcParts>) {
    const built = next.ok ? dualDateFromEthiopian(next.value, toTimestamp) : null;
    lastEmitted.current = built?.at.toMillis() ?? null;
    onChange(built);
  }

  function updateIso(nextIso: string) {
    setIso(nextIso);
    const next = parseIsoDate(nextIso);
    if (next.ok) setEc(toEcParts(next.value));
    emitGregorian(next);
  }

  function updateEc(patch: Partial<EcInputParts>) {
    const nextEc = { ...ec, ...patch };
    setEc(nextEc);
    const next = parseEcParts(nextEc);
    if (next.ok) {
      // Keep the hidden GC field in step so switching mode is lossless.
      setIso(toIsoDate(dualDateFromEthiopian(next.value, toTimestamp).at.toDate()));
    }
    emitEthiopian(next);
  }

  /**
   * Switching calendars must never change or clear the chosen date.
   * Both field sets are already kept in step by updateIso/updateEc, so this
   * only has to flip the mode and re-emit so `enteredIn` reflects the
   * calendar now in use.
   */
  function switchMode(next: CalendarSystem) {
    if (next === mode) return;
    setMode(next);
    // Parse inside each branch so the result type stays narrow.
    if (next === 'GC') emitGregorian(parseIsoDate(iso));
    else emitEthiopian(parseEcParts(ec));
  }

  const preview = value ? value.at.toDate() : null;
  const dayOptions = ecDayOptions(ec.year, ec.month);
  const leapNote = mode === 'EC' && ec.month === '13' ? pagumeHint(ec.year) : null;

  return (
    <fieldset className="dual-date" disabled={disabled}>
      <legend>
        {label}
        {required && <span aria-hidden="true" className="req"> *</span>}
      </legend>

      <div className="mode-toggle" role="group" aria-label={`${label}: calendar`}>
        {(['GC', 'EC'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? 'active' : ''}
            aria-pressed={mode === m}
            onClick={() => switchMode(m)}
          >
            {m === 'GC' ? 'Gregorian' : 'ኢትዮጵያ (Ethiopian)'}
          </button>
        ))}
      </div>

      {mode === 'GC' ? (
        <>
          {/* A <legend> labels the fieldset, not the control — screen readers
              still need a label bound to the input itself. */}
          <label className="visually-hidden" htmlFor={`${baseId}-gc`}>
            {label} — Gregorian date
          </label>
          <input
            id={`${baseId}-gc`}
            type="date"
            value={iso}
            required={required}
            aria-invalid={showError}
            aria-describedby={`${baseId}-preview`}
            onChange={(e) => updateIso(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </>
      ) : (
        <div className="ec-fields" onBlur={() => setTouched(true)}>
          <label className="visually-hidden" htmlFor={`${baseId}-ec-day`}>Day</label>
          <select
            id={`${baseId}-ec-day`}
            value={ec.day}
            aria-invalid={showError}
            onChange={(e) => updateEc({ day: e.target.value })}
          >
            <option value="">Day</option>
            {dayOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor={`${baseId}-ec-month`}>Month</label>
          <select
            id={`${baseId}-ec-month`}
            value={ec.month}
            aria-invalid={showError}
            onChange={(e) => updateEc({ month: e.target.value })}
          >
            <option value="">Month</option>
            {ETHIOPIAN_MONTHS.map((name, i) => (
              <option key={name} value={i + 1}>{i + 1}. {name}</option>
            ))}
          </select>

          <label className="visually-hidden" htmlFor={`${baseId}-ec-year`}>Year</label>
          <input
            id={`${baseId}-ec-year`}
            type="text"
            inputMode="numeric"
            placeholder="Year"
            size={5}
            value={ec.year}
            aria-invalid={showError}
            onChange={(e) => updateEc({ year: e.target.value })}
          />
        </div>
      )}

      {/* The live cross-calendar preview: the user always sees both readings. */}
      <p id={`${baseId}-preview`} className="preview" aria-live="polite">
        {preview ? (
          mode === 'GC' ? (
            <>Ethiopian: <strong>{formatEthiopian(utcDateToEthiopian(preview))}</strong></>
          ) : (
            <>Gregorian: <strong>{formatGregorianShort(preview)}</strong> — this is what is saved</>
          )
        ) : (
          <span className="muted">No date selected</span>
        )}
      </p>

      {leapNote && <p className="hint">{leapNote}</p>}
      {hint && !errorText && <p className="hint">{hint}</p>}
      {showError && <p className="error" role="alert">{errorText}</p>}
    </fieldset>
  );
}

/** Read-only dual-calendar label, for tables and detail views. */
export function DualDateText({ value }: { value: DualDate | null }) {
  if (value === null) return <span className="muted">—</span>;
  const date = value.at.toDate();
  return (
    // Gregorian leads; the Ethiopian reading follows, quieter. Both are always
    // shown — the Ethiopian one is what a government filing is dated by.
    <span className="dual-text" title={`${value.ecPeriod} · FY ${value.ecFiscalYear}`}>
      {formatGregorianShort(date)}
      <span className="sep"> · </span>
      <span className="muted">{formatEthiopian(utcDateToEthiopian(date))} EC</span>
    </span>
  );
}
