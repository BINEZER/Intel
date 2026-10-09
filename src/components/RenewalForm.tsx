/**
 * Renewing a maintenance agreement.
 *
 * A renewal is the moment the fee is renegotiated, so the fee is the first thing
 * asked and is set against what the client pays now. The term, the start and the
 * lifts follow from the agreement being renewed: a year, beginning the day it
 * ends, with the same lifts moving across.
 *
 * Money still owed on the agreement being renewed is stated before the switch.
 * It stays on that agreement and is still collected; renewing does not forgive
 * or move it.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getMilestones } from '../data/contracts.js';
import { renewMaintenanceContract } from '../data/lifecycle.js';
import { useAsyncAction } from '../data/useCollection.js';
import { FormPanel } from './FormPanel.js';
import { MoneyInput } from './MoneyInput.js';
import { DualDateInput } from './DualDateInput.js';
import { formatETB, VAT_RATE_BPS } from '../lib/money.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { nextAgreementNo, outstandingOn, serviceFeeFigures, wholeMonthsBetween } from '../lib/service-agreement.js';
import type { WithId } from '../data/repository.js';
import type { Contract, DualDate, PaymentMilestone } from '../lib/schema.js';

export function RenewalForm({
  contract,
  uid,
  onDone,
}: {
  contract: WithId<Contract>;
  uid: string;
  onDone: (newContractId: string | null) => void;
}) {
  const { busy, error, run } = useAsyncAction('renew this agreement');

  const oldMonths = wholeMonthsBetween(contract.startDate.at.toDate(), contract.endDate.at.toDate());
  // What the client pays now. Older agreements carry no monthly fee, so it is
  // worked back from the total over the term.
  const currentFee = contract.serviceFee?.monthlyNetSantim ?? Math.round(contract.valueNetSantim / oldMonths);

  const [fee, setFee] = useState(currentFee);
  const [months, setMonths] = useState(String(oldMonths));
  // The day the old one ends: no gap in cover, no month billed twice.
  const [startsOn, setStartsOn] = useState<DualDate | null>(() =>
    dualDateFromGregorian(contract.endDate.at.toDate(), toTimestamp, 'GC'),
  );
  const [terms, setTerms] = useState<PaymentMilestone[] | null>(null);

  useEffect(() => {
    let live = true;
    void getMilestones(contract.id)
      .then((rows) => { if (live) setTerms(rows); })
      .catch(() => { if (live) setTerms([]); });
    return () => { live = false; };
  }, [contract.id]);

  const term = Math.max(1, Math.round(Number(months) || 0));
  const figures = useMemo(() => serviceFeeFigures(fee, term, VAT_RATE_BPS), [fee, term]);
  const owed = terms === null ? null : outstandingOn(terms);
  const change = currentFee > 0 ? ((fee - currentFee) / currentFee) * 100 : 0;
  const newNo = nextAgreementNo(contract.contractNo);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (startsOn === null) return;
    const id = await run(() =>
      renewMaintenanceContract(
        contract,
        { monthlyNetSantim: fee, months: term, vatRateBps: VAT_RATE_BPS, startsOn: startsOn.at.toDate() },
        uid,
      ),
    );
    if (id !== null) onDone(id);
  }

  return (
    <FormPanel
      title={`Renew ${contract.contractNo}`}
      description={`Writes the next agreement, ${newNo}, for ${contract.clientName}. The lifts move across to it and ${contract.contractNo} is marked renewed and completed.`}
      onClose={() => onDone(null)}
    >
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}

        {owed !== null && owed.count > 0 && (
          <p className="banner banner-warn" role="status">
            {owed.count} payment{owed.count === 1 ? '' : 's'} on {contract.contractNo} {owed.count === 1 ? 'is' : 'are'} still
            unpaid — {formatETB(owed.santim)} including VAT. Renewing does not change that; {owed.count === 1 ? 'it stays' : 'they stay'} on
            {' '}{contract.contractNo} and {owed.count === 1 ? 'is' : 'are'} still collected.
          </p>
        )}

        <div className="field-row">
          <div className="field">
            <MoneyInput label="Monthly fee, VAT-exclusive" value={fee} onChange={setFee} required />
            <p className="field-hint">
              Now {formatETB(currentFee)} a month
              {fee !== currentFee && currentFee > 0 && (
                <> · {change >= 0 ? '+' : ''}{change.toFixed(1)}% on the renewal</>
              )}
              .
            </p>
          </div>
          <div className="field">
            <label htmlFor="renew-term">Term, in months</label>
            <input id="renew-term" type="number" min="1" max="60" value={months} onChange={(e) => setMonths(e.target.value)} />
            <p className="field-hint">One payment term is created per month.</p>
          </div>
        </div>

        <div className="form-grid dates">
          <DualDateInput
            label="Starts"
            value={startsOn}
            onChange={setStartsOn}
            required
            hint="The day the current agreement ends, so there is no gap and no month billed twice."
          />
        </div>

        <dl className="figure-list">
          <div>
            <dt>Client pays a month</dt>
            <dd>{formatETB(figures.monthly.grossSantim)} <span className="muted">VAT included</span></dd>
          </div>
          <div>
            <dt>Over the term</dt>
            <dd>
              {formatETB(figures.term.netSantim)} <span className="muted">VAT-exclusive</span>
              {' · '}
              {formatETB(figures.term.grossSantim)} <span className="muted">with VAT</span>
            </dd>
          </div>
          <div>
            <dt>Lifts</dt>
            <dd>
              {contract.serviceFee?.unitCount ?? 0} <span className="muted">move to the new agreement</span>
            </dd>
          </div>
        </dl>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || fee <= 0 || startsOn === null}>
            {busy ? 'Renewing…' : `Renew as ${newNo}`}
          </button>
          <button type="button" onClick={() => onDone(null)} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
