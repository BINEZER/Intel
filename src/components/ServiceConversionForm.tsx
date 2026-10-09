/**
 * Turning a finished installation into a paying service agreement.
 *
 * The one number that matters is the monthly fee, so it is the one number this
 * asks for first. The start date, the term and the lifts covered follow from the
 * contract being replaced, but each can be changed — a contract that was
 * imported has no warranty dates to start from, and a client with two buildings
 * does not always want both serviced.
 *
 * The annual figure is shown as it is typed because a monthly fee is easy to
 * agree to and hard to judge: "8,500 a month" reads as small until it is
 * "102,000 a year across 2 lifts", which is the number worth negotiating.
 *
 * WHAT IT WARNS ABOUT
 *   Money still owed on the installation. The service agreement does not
 *   replace those payments, and "full payment, then warranty, then service" is
 *   the order people expect — so if there is an unpaid balance it is stated
 *   before the switch, not discovered after. It is a warning rather than a
 *   block: a client can be mid-retention and still sign a service agreement.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { convertToServiceContract, loadConversionContext, type ConversionContext } from '../data/lifecycle.js';
import { useAsyncAction } from '../data/useCollection.js';
import { FormPanel } from './FormPanel.js';
import { MoneyInput } from './MoneyInput.js';
import { DualDateInput } from './DualDateInput.js';
import { formatETB, VAT_RATE_BPS } from '../lib/money.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import {
  DEFAULT_SERVICE_TERM_MONTHS,
  feePerLift,
  outstandingOn,
  serviceFeeFigures,
} from '../lib/service-agreement.js';
import { describeFirestoreError, type WithId } from '../data/repository.js';
import type { Contract, DualDate } from '../lib/schema.js';

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
  const [months, setMonths] = useState(String(DEFAULT_SERVICE_TERM_MONTHS));
  // From the day the free warranty ends, so there is no gap in cover and no
  // month billed twice. Without a recorded warranty there is nothing to infer
  // it from, so it starts today and the person says otherwise.
  const [startsOn, setStartsOn] = useState<DualDate | null>(() =>
    dualDateFromGregorian(contract.warranty?.endsOn?.at.toDate() ?? new Date(), toTimestamp, 'GC'),
  );
  const [context, setContext] = useState<ConversionContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    void loadConversionContext(contract)
      .then((loaded) => {
        if (!live) return;
        setContext(loaded);
        // Pre-tick the lifts installed under this contract that nobody services yet.
        setChosen(
          new Set(
            loaded.lifts
              .filter((lift) => lift.installedHere && lift.maintenanceContractId === null)
              .map((lift) => lift.id),
          ),
        );
      })
      .catch((cause: unknown) => {
        if (live) setLoadError(describeFirestoreError(cause, 'read the lifts and payments'));
      });
    return () => { live = false; };
  }, [contract]);

  const term = Math.max(1, Math.round(Number(months) || 0));
  const figures = useMemo(() => serviceFeeFigures(monthly, term, VAT_RATE_BPS), [monthly, term]);
  const owed = context === null ? null : outstandingOn(context.terms);
  const perLift = feePerLift(monthly, chosen.size);

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (startsOn === null) return;
    const done = await run(async () => {
      await convertToServiceContract(
        contract,
        {
          monthlyNetSantim: monthly,
          months: term,
          vatRateBps: VAT_RATE_BPS,
          startsOn: startsOn.at.toDate(),
          unitIds: [...chosen],
        },
        uid,
      );
      return true;
    });
    if (done !== null) onDone();
  }

  return (
    <FormPanel
      title={`Maintenance agreement for ${contract.clientName}`}
      description={`Follows ${contract.contractNo}. This switches the client from the installation contract to a monthly maintenance agreement, and links the two so the history stays together.`}
      onClose={onDone}
    >
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}
        {loadError !== null && <p className="error" role="alert">{loadError}</p>}

        {owed !== null && owed.count > 0 && (
          <p className="banner banner-warn" role="status">
            {owed.count} payment{owed.count === 1 ? '' : 's'} on {contract.contractNo} {owed.count === 1 ? 'is' : 'are'} still
            unpaid — {formatETB(owed.santim)} including VAT. The maintenance agreement does not replace
            {owed.count === 1 ? ' it' : ' them'}; they stay on the installation contract and are still collected.
          </p>
        )}
        {owed !== null && owed.count === 0 && context !== null && context.terms.length > 0 && (
          <p className="banner banner-ok" role="status">
            Every payment on {contract.contractNo} is settled.
          </p>
        )}

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
            <p className="field-hint">Usually one year. One payment term is created per month.</p>
          </div>
        </div>

        <div className="form-grid dates">
          <DualDateInput
            label="Starts"
            value={startsOn}
            onChange={setStartsOn}
            required
            hint={
              contract.warranty?.endsOn === null || contract.warranty === undefined
                ? 'No warranty end is recorded on this contract, so it starts today unless you change it.'
                : 'The day the free warranty ends, so there is no gap and no month billed twice.'
            }
          />
        </div>

        <fieldset>
          <legend>Lifts covered</legend>
          {context === null && loadError === null && <p className="muted">Loading the client's lifts…</p>}
          {context !== null && context.lifts.length === 0 && (
            <p className="muted">
              This client has no lifts on the register yet. You can still create the agreement and link the
              lifts from the Lifts page afterwards.
            </p>
          )}
          {context !== null && context.lifts.length > 0 && (
            <ul className="check-list">
              {context.lifts.map((lift) => {
                const taken = lift.maintenanceContractId !== null;
                return (
                  <li key={lift.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosen.has(lift.id)}
                        disabled={taken}
                        onChange={() => toggle(lift.id)}
                      />{' '}
                      {lift.tag} · {lift.siteName}
                      {lift.installedHere && <span className="chip no-caps">installed under this contract</span>}
                      {taken && (
                        <span className="muted"> — already under {lift.maintenanceContractNo ?? 'another agreement'}</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="hint">
            {chosen.size} lift{chosen.size === 1 ? '' : 's'} selected
            {perLift === null ? '' : ` · ${formatETB(perLift)} per lift per month before VAT`}
          </p>
        </fieldset>

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
        </dl>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || monthly <= 0 || startsOn === null}>
            {busy ? 'Creating…' : 'Create the maintenance agreement'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
