/**
 * Chasing receivables: request → letter → follow-up → receipt.
 *
 * An ageing report says an invoice is 74 days old. It does not say whether
 * anyone asked for the money, whether the letter reached the right desk, or
 * whether the client promised to pay on a date that has since passed. This page
 * is about those facts, because they are what decides the next phone call.
 *
 * The list leads with BROKEN PROMISES, then with money nobody has chased at all
 * — the cheapest collection action available is always the first one nobody
 * has taken.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { subscribeInvoices } from '../data/invoices.js';
import { loadChaseData, recordCollectionStep, type InvoiceChaseData } from '../data/collections.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  CHASE_ACTION_META,
  chaseActionLabel,
  chaseState,
  DEFAULT_CADENCE,
  sortChase,
  summariseChase,
  type ChaseAction,
  type ChaseInvoice,
  type ChaseState,
} from '../lib/collection-chase.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { formatETB } from '../lib/money.js';
import { formatDual } from '../lib/ethiopic.js';
import type { Invoice } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function Collections() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageInvoices') && user !== null;

  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const [chase, setChase] = useState<Map<string, InvoiceChaseData>>(new Map());
  const [loadingChase, setLoadingChase] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const asOf = useMemo(() => new Date(), []);
  const idKey = invoices.rows.map((i) => i.id).join(',');

  useEffect(() => {
    if (invoices.rows.length === 0) return;
    let cancelled = false;
    setLoadingChase(true);
    loadChaseData(invoices.rows)
      .then((data) => { if (!cancelled) setChase(data); })
      .catch(() => { /* the ageing is still worth showing without the log */ })
      .finally(() => { if (!cancelled) setLoadingChase(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey, reloadKey]);

  const rows = useMemo(() => {
    const scored = invoices.rows
      .filter((i) => i.status !== 'draft' && i.status !== 'void')
      .map((invoice) => {
        const data = chase.get(invoice.id);
        const chaseInvoice: ChaseInvoice = {
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          clientName: invoice.clientName,
          issuedAt: invoice.issueDate.at.toDate(),
          dueDate: invoice.dueDate.at.toDate(),
          grossSantim: invoice.grossSantim,
          balanceSantim: invoice.balanceGrossSantim,
          status: invoice.status,
          receipts: data?.receipts ?? [],
        };
        return {
          invoice: chaseInvoice,
          source: invoice,
          steps: data?.steps ?? [],
          // Dates inside the recommendation sentences are written in both
          // calendars, like every other date in the app.
          state: chaseState(chaseInvoice, data?.steps ?? [], asOf, DEFAULT_CADENCE, formatDual),
        };
      });

    return sortChase(scored);
  }, [invoices.rows, chase, asOf]);

  const summary = summariseChase(rows);
  const live = rows.filter((r) => r.state.stage !== 'settled' && r.state.stage !== 'written_off');

  return (
    <>
      <h1>Collections</h1>
      <p className="muted">
        Every unpaid invoice and what has actually been done about it. Broken promises come first,
        then money nobody has chased — asking is free and it is the step most often skipped.
      </p>

      {invoices.error !== null && <p className="error" role="alert">{invoices.error}</p>}
      {(invoices.loading || loadingChase) && <p className="muted">Loading the chase log…</p>}

      <section className="kpis">
        <div className="metric-tile">
          <p className="metric-label">Outstanding</p>
          <p className="metric-value">{formatETB(summary.outstandingSantim)}</p>
          <p className="metric-note muted">across {summary.invoices} invoices</p>
        </div>
        <div className={`metric-tile ${summary.unchasedCount > 0 ? 'tone-bad' : ''}`}>
          <p className="metric-label">Nobody has asked</p>
          <p className="metric-value">{formatETB(summary.unchasedSantim)}</p>
          <p className="metric-note muted">
            {summary.unchasedCount} invoice{summary.unchasedCount === 1 ? '' : 's'} with no request on record
          </p>
        </div>
        <div className={`metric-tile ${summary.brokenPromiseCount > 0 ? 'tone-bad' : ''}`}>
          <p className="metric-label">Broken promises</p>
          <p className="metric-value">{formatETB(summary.brokenPromiseSantim)}</p>
          <p className="metric-note muted">
            {summary.brokenPromiseCount} client{summary.brokenPromiseCount === 1 ? '' : 's'} said a date and missed it
          </p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Promised</p>
          <p className="metric-value">{formatETB(summary.promisedSantim)}</p>
          <p className="metric-note muted">a date still in the future</p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Action due today</p>
          <p className="metric-value">{formatETB(summary.actionDueSantim)}</p>
          <p className="metric-note muted">{summary.actionDueCount} to pick up</p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Disputed</p>
          <p className="metric-value">{formatETB(summary.disputedSantim)}</p>
          <p className="metric-note muted">chasing will not collect these</p>
        </div>
      </section>

      {live.length === 0 && !invoices.loading ? (
        <p className="muted">Nothing is outstanding. Every issued invoice has been settled.</p>
      ) : (
        <ul className="chase-list">
          {live.map((row) => (
            <ChaseRow
              key={row.invoice.id}
              invoice={row.invoice}
              source={row.source}
              state={row.state}
              steps={row.steps}
              editable={editable}
              uid={user?.uid ?? ''}
              userName={user?.email?.split('@')[0] ?? 'Unknown'}
              open={openId === row.invoice.id}
              onToggle={() => setOpenId(openId === row.invoice.id ? null : row.invoice.id)}
              onRecorded={() => setReloadKey((k) => k + 1)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ChaseRow({
  invoice,
  state,
  steps,
  editable,
  uid,
  userName,
  open,
  onToggle,
  onRecorded,
}: {
  invoice: ChaseInvoice;
  source: WithId<Invoice>;
  state: ChaseState;
  steps: readonly { id: string; action: ChaseAction; at: Date; byName: string; contactName: string; note: string; promisedDate?: Date; promisedAmountSantim?: number; deliveryRef?: string }[];
  editable: boolean;
  uid: string;
  userName: string;
  open: boolean;
  onToggle: () => void;
  onRecorded: () => void;
}) {
  const urgent = state.brokenPromises.length > 0 || state.stage === 'not_started';

  return (
    <li className={`chase-row ${urgent ? 'is-urgent' : ''} stage-${state.stage}`}>
      <div className="chase-head">
        <div>
          <strong>{invoice.invoiceNo}</strong>
          <span className="muted"> · {invoice.clientName}</span>
        </div>
        <span className={`chip chase-chip-${state.stage}`}>{state.stageLabel}</span>
        <span className="muted">
          {state.daysOverdue > 0 ? `${state.daysOverdue} days overdue` : `due ${formatDual(invoice.dueDate)}`}
        </span>
        <strong className="chase-amount">{formatETB(invoice.balanceSantim)}</strong>
      </div>

      <p className="chase-reason">{state.reason}</p>

      <p className="muted chase-meta">
        {state.lastContactAt === null
          ? 'No contact on record.'
          : `Last contact ${state.daysSinceContact} days ago.`}
        {state.letterDelivered ? ' Letter delivered.' : ' No letter delivered.'}
        {state.contactAttempts > 0 && ` ${state.contactAttempts} follow-up${state.contactAttempts === 1 ? '' : 's'}.`}
      </p>

      {state.brokenPromises.map((promise) => (
        <p key={promise.stepId} className="warn-text">
          ⚠ {promise.contactName} promised {formatETB(promise.promisedAmountSantim)} by{' '}
          {formatDual(promise.promisedDate)} — {promise.daysLate} days late.
        </p>
      ))}

      <div className="chase-actions">
        {state.nextAction !== null && (
          <span className={state.nextActionOverdue ? 'chase-next overdue' : 'chase-next'}>
            Next: {state.nextActionLabel}
            {state.nextActionDueAt !== null && ` · ${state.nextActionOverdue ? 'due now' : `by ${formatDual(state.nextActionDueAt)}`}`}
          </span>
        )}
        <button type="button" onClick={onToggle}>
          {open ? 'Hide log' : `Log (${steps.length})`}
        </button>
      </div>

      {open && (
        <div className="chase-log">
          {steps.length === 0 ? (
            <p className="muted">Nothing recorded yet.</p>
          ) : (
            <ol className="timeline">
              {[...steps].reverse().map((step) => (
                <li key={step.id} className={`timeline-entry chase-step-${step.action}`}>
                  <div className="timeline-head">
                    <strong>{chaseActionLabel(step.action)}</strong>
                    <span className="muted">{formatDual(step.at)}</span>
                    <span className="muted">· {step.byName} → {step.contactName}</span>
                  </div>
                  {step.note !== '' && <p>{step.note}</p>}
                  {step.promisedDate !== undefined && (
                    <p className="muted">
                      Promised {step.promisedAmountSantim === undefined ? 'the balance' : formatETB(step.promisedAmountSantim)} by{' '}
                      {formatDual(step.promisedDate)}
                    </p>
                  )}
                  {step.deliveryRef !== undefined && <p className="muted">Their reference: {step.deliveryRef}</p>}
                </li>
              ))}
            </ol>
          )}

          {editable && (
            <StepForm
              invoiceId={invoice.id}
              suggested={state.nextAction}
              uid={uid}
              userName={userName}
              onRecorded={onRecorded}
            />
          )}
        </div>
      )}
    </li>
  );
}

function StepForm({
  invoiceId,
  suggested,
  uid,
  userName,
  onRecorded,
}: {
  invoiceId: string;
  suggested: ChaseAction | null;
  uid: string;
  userName: string;
  onRecorded: () => void;
}) {
  const [action, setAction] = useState<ChaseAction>(suggested ?? 'follow_up_call');
  const [contactName, setContactName] = useState('');
  const [note, setNote] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState('');
  const { busy, error, run } = useAsyncAction('record this step');

  const meta = CHASE_ACTION_META.find((m) => m.key === action);
  const isPromise = action === 'promise_to_pay';
  const isLetter = action === 'letter_delivered';
  const ready = contactName.trim() !== '' && (!isPromise || promisedDate !== '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;

    const promised = promisedDate === '' ? null : new Date(`${promisedDate}T00:00:00Z`);
    const amountSantim = promisedAmount === '' ? undefined : Math.round(Number(promisedAmount) * 100);

    const result = await run(() =>
      recordCollectionStep(
        invoiceId,
        {
          action,
          at: dualDateFromGregorian(new Date(), toTimestamp, 'GC'),
          byName: userName,
          contactName: contactName.trim(),
          note: note.trim(),
          ...(isLetter && deliveryRef.trim() !== '' ? { deliveryRef: deliveryRef.trim() } : {}),
          ...(promised === null ? {} : { promisedDate: dualDateFromGregorian(promised, toTimestamp, 'GC') }),
          ...(amountSantim === undefined || Number.isNaN(amountSantim) ? {} : { promisedAmountSantim: amountSantim }),
        },
        uid,
      ),
    );

    if (result !== null) {
      setContactName('');
      setNote('');
      setDeliveryRef('');
      setPromisedDate('');
      setPromisedAmount('');
      onRecorded();
    }
  }

  return (
    <form className="step-form" onSubmit={(e) => void submit(e)}>
      <h4>Record what happened</h4>
      <div className="form-grid">
        <div className="field">
          <label htmlFor={`act-${invoiceId}`}>What</label>
          <select id={`act-${invoiceId}`} value={action} onChange={(e) => setAction(e.target.value as ChaseAction)}>
            {CHASE_ACTION_META.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          {meta !== undefined && <p className="hint">{meta.description}</p>}
        </div>

        <div className="field">
          <label htmlFor={`who-${invoiceId}`}>Who you dealt with <span className="req" aria-hidden="true">*</span></label>
          <input id={`who-${invoiceId}`} required value={contactName} placeholder="Ato Bekele, finance"
            onChange={(e) => setContactName(e.target.value)} />
        </div>

        {isLetter && (
          <div className="field">
            <label htmlFor={`ref-${invoiceId}`}>Their reference on the stamped copy</label>
            <input id={`ref-${invoiceId}`} value={deliveryRef} placeholder="REG/2026/411"
              onChange={(e) => setDeliveryRef(e.target.value)} />
          </div>
        )}

        {isPromise && (
          <>
            <div className="field">
              <label htmlFor={`pd-${invoiceId}`}>Promised by <span className="req" aria-hidden="true">*</span></label>
              <input id={`pd-${invoiceId}`} type="date" required value={promisedDate}
                onChange={(e) => setPromisedDate(e.target.value)} />
              <p className="hint">
                A promise with no date is a brush-off. Without one nothing will ever chase it.
              </p>
            </div>
            <div className="field">
              <label htmlFor={`pa-${invoiceId}`}>Promised amount (birr)</label>
              <input id={`pa-${invoiceId}`} type="number" min={0} step={0.01} value={promisedAmount}
                placeholder="the whole balance" onChange={(e) => setPromisedAmount(e.target.value)} />
            </div>
          </>
        )}

        <div className="field field-wide">
          <label htmlFor={`note-${invoiceId}`}>What was said</label>
          <input id={`note-${invoiceId}`} value={note}
            placeholder="Said the payment is with the general manager for signature."
            onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="primary" disabled={busy || !ready}>
        {busy ? 'Recording…' : 'Record'}
      </button>
    </form>
  );
}
