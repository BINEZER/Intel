/**
 * Turning a finished installation into a paying service agreement.
 *
 * The one number that matters is the monthly fee, so it is the one number this
 * asks for. Everything else — the term, the lifts covered, the payment terms,
 * the renewal date — follows from it and from the contract being replaced.
 *
 * The annual figure is shown as it is typed because a monthly fee is easy to
 * agree to and hard to judge: "8,500 a month" reads as small until it is
 * "102,000 a year across 2 lifts", which is the number worth negotiating.
 */

import { useState, type FormEvent } from 'react';
import { convertToServiceContract } from '../data/lifecycle.js';
import { useAsyncAction } from '../data/useCollection.js';
import { FormPanel } from './FormPanel.js';
import { MoneyInput } from './MoneyInput.js';
import { formatETB, VAT_RATE_BPS } from '../lib/money.js';
import type { Contract } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ServiceConversionForm({
  contract,
  uid,
  onDone,
}: {
  contract: WithId<Contract>;
  uid: string;
  onDone: () => void;
}) {
  const { busy, error, run } = useAsyncAction('set up the service agreement');
  const [monthly, setMonthly] = useState(0);
  const [months, setMonths] = useState('12');

  const term = Math.max(1, Math.round(Number(months) || 0));
  const annual = monthly * term;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await run(async () => {
      await convertToServiceContract(
        contract,
        {
          monthlyNetSantim: monthly,
          months: term,
          vatRateBps: VAT_RATE_BPS,
          // From the day the free warranty ends, so there is no gap in cover
          // and no month billed twice.
          startsOn: contract.warranty?.endsOn?.at.toDate() ?? new Date(),
        },
        uid,
      );
      return true;
    });
    if (done !== null) onDone();
  }

  return (
    <FormPanel
      title={`Service agreement for ${contract.clientName}`}
      description={`Replaces ${contract.contractNo} when its warranty ends. The lifts installed under that contract come across with it.`}
      onClose={onDone}
    >
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}

        <div className="field-row">
          <div className="field">
            <MoneyInput
              label="Monthly fee, VAT-exclusive"
              value={monthly}
              onChange={setMonthly}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="svc-term">Term, in months</label>
            <input
              id="svc-term"
              type="number"
              min="1"
              max="60"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
            <p className="field-hint">One payment term is created per month.</p>
          </div>
        </div>

        <dl className="figure-list">
          <div>
            <dt>Over the term</dt>
            <dd>{formatETB(annual)} <span className="muted">VAT-exclusive</span></dd>
          </div>
          <div>
            <dt>Starts</dt>
            <dd>
              {contract.warranty?.endsOn === null || contract.warranty === undefined
                ? 'today'
                : 'the day the free warranty ends, so there is no gap and no month billed twice'}
            </dd>
          </div>
        </dl>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || monthly <= 0}>
            {busy ? 'Creating…' : 'Create the service agreement'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
