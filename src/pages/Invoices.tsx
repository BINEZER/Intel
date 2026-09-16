/**
 * Invoice list, issue flow, and receipt capture.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { issueInvoice, recordReceipt, subscribeInvoices, voidInvoice } from '../data/invoices.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatETB } from '../lib/money.js';
import { AGE_BUCKET_LABELS, ageReceivables } from '../lib/invoicing.js';
import { formatBps } from '../lib/kpi.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { DualDateText } from '../components/DualDateInput.js';
import { MoneyInput } from '../components/MoneyInput.js';
import { KpiTile } from '../components/KpiTile.js';
import type { Invoice, Receipt } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { DataTable } from '../components/DataTable.js';
import { InvoiceForm } from './InvoiceForm.js';

export function Invoices() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageInvoices');
  const { rows, loading, error } = useCollection<Invoice>(
    (d, e) => subscribeInvoices(d, e),
    [],
    'load invoices',
  );
  const [receipting, setReceipting] = useState<WithId<Invoice> | null>(null);
  const [creating, setCreating] = useState(false);

  const asOf = new Date();
  // Receipts live in a subcollection, so this ages on the denormalized balance
  // the invoice itself carries — refreshed whenever a receipt is recorded.
  const ageing = ageReceivables(
    rows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo || '(draft)',
      clientName: i.clientName,
      dueDate: i.dueDate.at.toDate(),
      grossSantim: i.grossSantim,
      receipts: [{ amountGrossSantim: i.grossSantim - i.balanceGrossSantim, clientWhtSantim: 0 }],
      status: i.status,
    })),
    asOf,
  );

  return (
    <>
      <div className="page-head">
        <h1>Invoices</h1>
        {editable && !creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>
            New invoice
          </button>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {creating && <InvoiceForm onDone={() => setCreating(false)} />}

      {!loading && rows.length === 0 && !creating && (
        /* Nothing billed yet is not an error, and it is not a blank page: it is
           the one thing standing between this system and every money figure in
           it. */
        <section className="card">
          <h2>No invoice has been raised yet</h2>
          <p className="muted">
            Revenue, VAT, receivables, the collections ladder and the dashboard charts all start
            with an issued invoice. Most invoices here settle a payment milestone agreed in the
            contract — pick the client and the contract and the figure fills itself in.
          </p>
          {editable && (
            <p className="form-actions">
              <button type="button" className="primary" onClick={() => setCreating(true)}>
                Raise the first invoice
              </button>
            </p>
          )}
        </section>
      )}

      <section className="kpis">
        <KpiTile
          label="Outstanding"
          value={formatETB(ageing.totalSantim)}
          detail={<span className="muted">{ageing.rows.length} unpaid invoice{ageing.rows.length === 1 ? '' : 's'}</span>}
        />
        <KpiTile
          label="Overdue"
          value={formatETB(ageing.overdueSantim)}
          status={ageing.overdueSantim > 0 ? 'bad' : 'good'}
        />
        <KpiTile
          label="Over 90 days"
          value={formatETB(ageing.byBucket.over_90)}
          status={ageing.byBucket.over_90 > 0 ? 'bad' : 'good'}
          detail={<span className="muted">{formatBps(ageing.over90Bps)} of debt</span>}
          title="The collectability signal: debt this old rarely arrives without intervention."
        />
      </section>

      <section className="card">
        <h2>Ageing</h2>
        <div className="kpis">
          {(Object.keys(AGE_BUCKET_LABELS) as (keyof typeof AGE_BUCKET_LABELS)[]).map((bucket) => (
            <KpiTile
              key={bucket}
              label={AGE_BUCKET_LABELS[bucket]}
              value={formatETB(ageing.byBucket[bucket], { withSymbol: false })}
              status={bucket === 'over_90' && ageing.byBucket[bucket] > 0 ? 'bad' : 'unknown'}
            />
          ))}
        </div>
      </section>

      {rows.length > 0 && (
        <DataTable
          rows={rows}
          rowKey={(invoice) => invoice.id}
          noun="invoices"
          rowClass={(invoice) => (invoice.status === 'overdue' ? 'row-danger' : undefined)}
          columns={[
            {
              key: 'invoiceNo',
              label: 'Invoice',
              value: (invoice) => invoice.invoiceNo,
              render: (invoice) => (
                <>
                  <strong className="mono">{invoice.invoiceNo || '—'}</strong>
                  {invoice.vatRateBps === 0 && invoice.vatSantim > 0 && (
                    <><br /><span className="muted">mixed rates</span></>
                  )}
                </>
              ),
            },
            { key: 'client', label: 'Client', value: (invoice) => invoice.clientName, filterable: true },
            {
              key: 'issued',
              label: 'Issued',
              value: (invoice) => invoice.issueDate.at.toDate(),
              render: (invoice) => <DualDateText value={invoice.issueDate} />,
            },
            {
              key: 'due',
              label: 'Due',
              value: (invoice) => invoice.dueDate.at.toDate(),
              render: (invoice) => <DualDateText value={invoice.dueDate} />,
            },
            {
              key: 'net',
              label: 'Net',
              numeric: true,
              value: (invoice) => invoice.netSantim,
              render: (invoice) => formatETB(invoice.netSantim, { withSymbol: false }),
            },
            {
              key: 'vat',
              label: 'VAT',
              numeric: true,
              value: (invoice) => invoice.vatSantim,
              render: (invoice) => (
                <span className="muted">{formatETB(invoice.vatSantim, { withSymbol: false })}</span>
              ),
            },
            {
              key: 'total',
              label: 'Total',
              numeric: true,
              value: (invoice) => invoice.grossSantim,
              render: (invoice) => (
                <span className="strong">{formatETB(invoice.grossSantim, { withSymbol: false })}</span>
              ),
            },
            {
              key: 'balance',
              label: 'Balance',
              numeric: true,
              value: (invoice) => invoice.balanceGrossSantim,
              render: (invoice) =>
                invoice.balanceGrossSantim > 0 ? (
                  <span className="danger-text">
                    {formatETB(invoice.balanceGrossSantim, { withSymbol: false })}
                  </span>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            {
              key: 'status',
              label: 'Status',
              value: (invoice) => invoice.status,
              filterable: true,
              render: (invoice) => <span className="chip">{invoice.status.replace(/_/g, ' ')}</span>,
            },
            ...(editable && user !== null
              ? [
                  {
                    key: 'actions',
                    label: 'Actions',
                    unsortable: true,
                    value: () => '',
                    render: (invoice: WithId<Invoice>) => (
                      <InvoiceActions
                        invoice={invoice}
                        uid={user.uid}
                        onReceipt={() => setReceipting(invoice)}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {receipting !== null && user !== null && (
        <ReceiptForm invoice={receipting} uid={user.uid} onDone={() => setReceipting(null)} />
      )}
    </>
  );
}

/**
 * The actions for one invoice.
 *
 * Its own component because each row needs its own busy flag and its own error
 * line: issuing one invoice must not grey out the buttons on every other row.
 */
function InvoiceActions({
  invoice,
  uid,
  onReceipt,
}: {
  invoice: WithId<Invoice>;
  uid: string;
  onReceipt: () => void;
}) {
  const { busy, error, run } = useAsyncAction('update this invoice');

  return (
    <div className="row-actions">
      {invoice.status === 'draft' && (
        <button type="button" className="primary" disabled={busy}
          onClick={() => void run(() => issueInvoice(invoice.id, uid))}>
          Issue
        </button>
      )}
      {invoice.status !== 'draft' && invoice.status !== 'void' && invoice.balanceGrossSantim > 0 && (
        <button type="button" onClick={onReceipt}>Record payment</button>
      )}
      {invoice.status !== 'void' && (
        <button type="button" disabled={busy}
          onClick={() => void run(() => voidInvoice(invoice.id, uid))}>
          Void
        </button>
      )}
      {/* Only a draft can be deleted. An issued number is part of the VAT
          sequence, and the button says so rather than disappearing. */}
      <DeleteButton
        target={{
          kind: 'invoice',
          id: invoice.id,
          name: invoice.invoiceNo || 'this draft',
          status: invoice.status,
        }}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}

/**
 * Receipt capture.
 *
 * Client withholding is a first-class field, not an afterthought: if a client
 * withholds 2% and remits 98%, the invoice is SETTLED. Recording only the cash
 * would leave 2% sitting in receivables forever, and the priority board would
 * chase money nobody owes.
 */
function ReceiptForm({
  invoice,
  uid,
  onDone,
}: {
  invoice: WithId<Invoice>;
  uid: string;
  onDone: () => void;
}) {
  const [amountSantim, setAmountSantim] = useState(invoice.balanceGrossSantim);
  const [clientWhtSantim, setClientWhtSantim] = useState(0);
  const [method, setMethod] = useState<Receipt['method']>('bank_transfer');
  const [bankRef, setBankRef] = useState('');
  const { busy, error, run } = useAsyncAction('record this payment');

  const settles = amountSantim + clientWhtSantim;
  const remaining = invoice.balanceGrossSantim - settles;

  async function submit() {
    const done = await run(() =>
      recordReceipt(
        invoice.id,
        { grossSantim: invoice.grossSantim, status: invoice.status, dueDate: invoice.dueDate },
        {
          receivedDate: dualDateFromGregorian(new Date(), toTimestamp, 'GC'),
          amountGrossSantim: amountSantim,
          method,
          ...(bankRef.trim() === '' ? {} : { bankRef: bankRef.trim() }),
          clientWhtSantim,
        },
        uid,
      ),
    );
    if (done !== null) onDone();
  }

  return (
    <section className="card">
      <h2>Record payment — {invoice.invoiceNo}</h2>
      <p className="muted">
        Outstanding {formatETB(invoice.balanceGrossSantim)} on a total of {formatETB(invoice.grossSantim)}.
      </p>

      <div className="form-grid">
        <MoneyInput label="Cash received" value={amountSantim} onChange={setAmountSantim} required />
        <MoneyInput
          label="Withheld by client"
          value={clientWhtSantim}
          onChange={setClientWhtSantim}
          hint="Tax the client deducted and remitted to ERCA on our behalf. This settles the invoice — it is not a debt."
        />
        <div className="field">
          <label htmlFor="r-method">Method</label>
          <select id="r-method" value={method} onChange={(e) => setMethod(e.target.value as Receipt['method'])}>
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cpo">CPO</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-ref">Bank reference</label>
          <input id="r-ref" value={bankRef} onChange={(e) => setBankRef(e.target.value)} />
        </div>
      </div>

      <div className="vat-summary">
        <div><span className="muted">Settles</span><strong>{formatETB(settles)}</strong></div>
        <div className="total">
          <span className="muted">{remaining > 0 ? 'Still outstanding' : 'Invoice cleared'}</span>
          <strong>{formatETB(Math.max(0, remaining))}</strong>
        </div>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="primary" disabled={busy || settles <= 0}
          onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Record payment'}
        </button>
        <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </section>
  );
}
