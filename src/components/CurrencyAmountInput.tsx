/**
 * Amount input with a currency selector and an exchange rate.
 *
 * The user types an amount in whichever currency the counterparty invoiced. The
 * component always emits BOTH that amount and its ETB equivalent, with the rate
 * that produced it — because tax is computed on the ETB figure and a rate
 * without a date is not reproducible.
 *
 * The ETB equivalent is shown live and labelled as the taxable figure, so nobody
 * approves a USD number while thinking about birr.
 */

import { useId, useState } from 'react';
import {
  CURRENCIES,
  formatMoney,
  formatRate,
  majorToMinor,
  minorToMajor,
  parseRate,
  RATE_SCALE,
  toBaseSantim,
  type Currency,
} from '../lib/currency.js';

export interface CurrencyAmount {
  currency: Currency;
  /** Integer minor units in `currency`. */
  amount: number;
  /** ETB equivalent, in santim. */
  baseAmountSantim: number;
  rateMicros: number;
}

export function CurrencyAmountInput({
  label,
  value,
  onChange,
  defaultRateMicros,
  rateSource = 'NBE daily',
  hint,
  required = false,
  disabled = false,
}: {
  label: string;
  value: CurrencyAmount;
  onChange: (next: CurrencyAmount) => void;
  /** Working rate from config/fxRates; overridable per transaction. */
  defaultRateMicros: number;
  rateSource?: string;
  hint?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const baseId = useId();
  const [amountText, setAmountText] = useState(() =>
    value.amount === 0 ? '' : String(minorToMajor(value.amount, value.currency)),
  );
  const [rateText, setRateText] = useState(() => formatRate(value.rateMicros || defaultRateMicros));
  const [touched, setTouched] = useState(false);

  const isForeign = value.currency !== 'ETB';
  const parsedAmount = parseAmount(amountText, value.currency);
  const parsedRate = isForeign ? parseRate(rateText) : RATE_SCALE;

  const amountInvalid = touched && amountText.trim() !== '' && parsedAmount === null;
  const rateInvalid = touched && isForeign && parsedRate === null;

  function emit(next: { currency?: Currency; amount?: number | null; rateMicros?: number | null }) {
    const currency = next.currency ?? value.currency;
    const amount = next.amount === undefined ? value.amount : (next.amount ?? 0);
    const rateMicros =
      currency === 'ETB' ? RATE_SCALE : (next.rateMicros === undefined ? value.rateMicros : next.rateMicros) ?? defaultRateMicros;

    onChange({
      currency,
      amount,
      rateMicros,
      baseAmountSantim: toBaseSantim({ amount, currency }, rateMicros),
    });
  }

  function changeCurrency(currency: Currency) {
    // Keep the number the user typed and re-derive the ETB figure. Converting
    // the amount itself would silently restate a price nobody agreed to.
    const rateMicros = currency === 'ETB' ? RATE_SCALE : (parsedRate ?? defaultRateMicros);
    if (currency !== 'ETB') setRateText(formatRate(rateMicros));
    emit({ currency, amount: parsedAmount ?? 0, rateMicros });
  }

  return (
    <div className="field currency-field">
      <label htmlFor={`${baseId}-amount`}>
        {label}
        {required && <span className="req" aria-hidden="true"> *</span>}
      </label>

      <div className="currency-row">
        <label className="visually-hidden" htmlFor={`${baseId}-currency`}>{label} currency</label>
        <select
          id={`${baseId}-currency`}
          className="currency-select"
          value={value.currency}
          disabled={disabled}
          onChange={(e) => changeCurrency(e.target.value as Currency)}
        >
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <input
          id={`${baseId}-amount`}
          type="text"
          inputMode="decimal"
          value={amountText}
          required={required}
          disabled={disabled}
          aria-invalid={amountInvalid}
          onChange={(e) => {
            setAmountText(e.target.value);
            emit({ amount: parseAmount(e.target.value, value.currency) });
          }}
          onBlur={() => setTouched(true)}
        />
      </div>

      {isForeign && (
        <div className="currency-rate">
          <label htmlFor={`${baseId}-rate`}>Rate — ETB per 1 {value.currency}</label>
          <input
            id={`${baseId}-rate`}
            type="text"
            inputMode="decimal"
            value={rateText}
            disabled={disabled}
            aria-invalid={rateInvalid}
            onChange={(e) => {
              setRateText(e.target.value);
              emit({ rateMicros: parseRate(e.target.value) });
            }}
            onBlur={() => setTouched(true)}
          />
          <span className="muted">{rateSource}</span>
        </div>
      )}

      {value.amount > 0 && (
        <p className={isForeign ? 'currency-base' : 'hint'}>
          {isForeign ? (
            <>
              <strong>{formatMoney({ amount: value.baseAmountSantim, currency: 'ETB' })}</strong>
              {' '}— the figure VAT and withholding are computed on
            </>
          ) : (
            formatMoney({ amount: value.amount, currency: 'ETB' })
          )}
        </p>
      )}

      {hint && !amountInvalid && !rateInvalid && <p className="hint">{hint}</p>}
      {amountInvalid && <p className="error" role="alert">Enter an amount, e.g. 45000 or 45000.50</p>}
      {rateInvalid && <p className="error" role="alert">Enter a positive rate, e.g. 120.4567</p>}
    </div>
  );
}

export function emptyAmount(currency: Currency = 'ETB', rateMicros = RATE_SCALE): CurrencyAmount {
  return { currency, amount: 0, baseAmountSantim: 0, rateMicros };
}

function parseAmount(text: string, currency: Currency): number | null {
  const cleaned = text.trim().replace(/,/g, '');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return majorToMinor(Number(cleaned), currency);
}
