/**
 * ETB amount input.
 *
 * The user types birr; the component emits santim. Nothing above this line ever
 * handles a float, which is how the integer-santim rule survives contact with a
 * text field.
 */

import { useId, useState } from 'react';
import { birrToSantim, formatETB, santimToBirr } from '../lib/money.js';

export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  required = false,
  disabled = false,
}: {
  label: string;
  /** Santim. */
  value: number;
  onChange: (santim: number) => void;
  hint?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  // Held as text so a half-typed "1200." does not get mangled mid-keystroke.
  const [text, setText] = useState(() => (value === 0 ? '' : String(santimToBirr(value))));
  const [touched, setTouched] = useState(false);

  const parsed = parseBirr(text);
  const showError = touched && text.trim() !== '' && parsed === null;

  function update(next: string) {
    setText(next);
    const santim = parseBirr(next);
    onChange(santim === null ? 0 : santim);
  }

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>
      <div className="money-input">
        <span className="prefix">ETB</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          required={required}
          disabled={disabled}
          aria-invalid={showError}
          onChange={(e) => update(e.target.value)}
          onBlur={() => setTouched(true)}
        />
      </div>
      {value > 0 && <p className="hint">{formatETB(value)}</p>}
      {hint && !showError && <p className="hint">{hint}</p>}
      {showError && <p className="error" role="alert">Enter an amount, e.g. 1200000 or 1200000.50</p>}
    </div>
  );
}

/** Accepts thousands separators and at most two decimals. */
function parseBirr(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return birrToSantim(Number(cleaned));
}
