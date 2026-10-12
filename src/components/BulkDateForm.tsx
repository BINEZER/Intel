/**
 * Giving a date to several payment terms at once.
 *
 * Shows, before anything is written, exactly which date each term would get — and,
 * where a date has already passed, how many terms that will immediately mark as
 * ready to invoice. That second line is the point of the preview: dating an
 * unbilled term in the past is a claim that it is owed and unbilled, and doing it
 * to a term that was in fact paid outside the app raises a false alarm.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { setMilestoneDates } from '../data/contracts.js';
import { useAsyncAction } from '../data/useCollection.js';
import { FormPanel } from './FormPanel.js';
import { DualDateInput } from './DualDateInput.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { formatDual } from '../lib/ethiopic.js';
import { formatETB } from '../lib/money.js';
import { describePlan, flaggedByPastDate, planDates, type BulkMode, type BulkTerm } from '../lib/term-bulk.js';
import { toTimestamp } from '../firebase.js';
import type { DualDate } from '../lib/schema.js';

export function BulkDateForm({
  terms,
  labels,
  uid,
  onDone,
}: {
  terms: readonly BulkTerm[];
  labels: ReadonlyMap<string, string>;
  uid: string;
  onDone: (saved: boolean) => void;
}) {
  const { busy, error, run } = useAsyncAction('date these payment terms');
  const [kind, setKind] = useState<'same' | 'spread'>('same');
  const [first, setFirst] = useState<DualDate | null>(null);
  const [gapText, setGapText] = useState('1');

  const gapMonths = Math.max(0, Math.min(36, Math.round(Number(gapText) || 0)));
  const asOf = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const plan = useMemo(() => {
    if (first === null) return [];
    const date = first.at.toDate();
    const mode: BulkMode = kind === 'same' ? { kind: 'same', date } : { kind: 'spread', first: date, gapMonths };
    return planDates(terms, mode);
  }, [terms, first, kind, gapMonths]);

  const flagged = useMemo(() => flaggedByPastDate(plan, terms, asOf), [plan, terms, asOf]);
  const skipped = terms.length - plan.length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (first === null || plan.length === 0) return;
    const done = await run(async () => {
      await setMilestoneDates(
        plan.map((c) => ({
          contractId: c.contractId,
          termId: c.termId,
          dueDate: dualDateFromGregorian(c.dueDate, toTimestamp, first.enteredIn),
        })),
        uid,
      );
      return true;
    });
    if (done !== null) onDone(true);
  }

  return (
    <FormPanel
      title={`Date ${terms.length} payment term${terms.length === 1 ? '' : 's'}`}
      description="A term with a date becomes ready to invoice when the date arrives, and appears in the cash forecast in the month it falls due."
      onClose={() => onDone(false)}
    >
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}

        <fieldset>
          <legend>How</legend>
          <label className="check">
            <input type="radio" name="bulk-kind" checked={kind === 'same'} onChange={() => setKind('same')} /> All on one date
          </label>
          <label className="check">
            <input type="radio" name="bulk-kind" checked={kind === 'spread'} onChange={() => setKind('spread')} /> One after another
            <span className="muted"> — the first on the date below, then each a set number of months later, within each contract in the order the terms are paid</span>
          </label>
        </fieldset>

        <div className="form-grid">
          <DualDateInput label={kind === 'same' ? 'Falls due' : 'The first falls due'} value={first} onChange={setFirst} required />
          {kind === 'spread' && (
            <div className="field">
              <label htmlFor="bulk-gap">Months between each</label>
              <input id="bulk-gap" type="number" min="0" max="36" step="1" value={gapText} onChange={(e) => setGapText(e.target.value)} />
              <p className="hint">0 puts them all on the same date.</p>
            </div>
          )}
        </div>

        {first !== null && (
          <>
            <h3>{describePlan(plan)}</h3>
            {skipped > 0 && (
              <p className="muted">
                {skipped} selected term{skipped === 1 ? ' is' : 's are'} paid or waived and will be left as {skipped === 1 ? 'it is' : 'they are'}.
              </p>
            )}
            <ul className="plain-list">
              {plan.slice(0, 8).map((change) => (
                <li key={change.termId}>
                  {labels.get(change.termId) ?? change.termId} → <strong>{formatDual(change.dueDate)}</strong>
                </li>
              ))}
            </ul>
            {plan.length > 8 && <p className="muted">…and {plan.length - 8} more.</p>}

            {flagged.count > 0 && (
              <p className="banner banner-warn" role="status">
                {flagged.count} of these {flagged.count === 1 ? 'date has' : 'dates have'} already come, so {flagged.count === 1 ? 'that term' : 'those terms'} will
                show as <strong>ready to invoice</strong> straight away — {formatETB(flagged.santim)} with VAT. If any was already billed or paid outside the app,
                leave it undated instead, or it will be a false alarm on the list.
              </p>
            )}
          </>
        )}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || first === null || plan.length === 0}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={() => onDone(false)} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
