/**
 * The subcontractor payout pipeline.
 *
 * A voucher that has sat for three weeks and one raised yesterday both read as
 * "approved" on the disbursements list. This page is about the difference: how
 * long each payment has been waiting, and who it is waiting on.
 *
 * It also reports what a subcontractor would say about us — the median time we
 * take to pay — because that is the honest half of their scorecard.
 */

import { useMemo, useState } from 'react';
import { subscribeDisbursements } from '../data/disbursements.js';
import { useCollection } from '../data/useCollection.js';
import {
  ageVoucher,
  buildPayoutPipeline,
  payeeStanding,
  stepLabel,
  type PayoutVoucher,
} from '../lib/payout-workflow.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { formatDual } from '../lib/ethiopic.js';
import { PayoutActions } from '../components/PayoutActions.js';
import type { Disbursement } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';

function toVoucher(row: WithId<Disbursement>): PayoutVoucher {
  const workflow = row.workflow;
  return {
    id: row.id,
    voucherNo: row.voucherNo,
    subcontractorName: row.subcontractorName,
    projectId: row.projectId,
    phaseName: row.phaseName,
    status: row.status,
    netSantim: row.netSantim,
    netPayableSantim: row.netPayableSantim,
    supplierInvoiceDate: row.supplierInvoiceDate.at.toDate(),
    trail: {
      requestedAt: workflow?.requestedAt?.toDate() ?? null,
      checkedAt: workflow?.checkedAt?.toDate() ?? null,
      approvedAt: workflow?.approvedAt?.toDate() ?? null,
      // Fall back to the payment date on vouchers written before the workflow
      // existed, so their timing is not silently lost from the averages.
      paidAt: workflow?.paidAt?.toDate() ?? row.paymentDate?.at.toDate() ?? null,
      rejectedAt: workflow?.rejectedAt?.toDate() ?? null,
      heldAt: workflow?.heldAt?.toDate() ?? null,
    },
  };
}

export function Payouts() {
  const rows = useCollection<Disbursement>((d, e) => subscribeDisbursements(d, e), [], 'load payment vouchers');
  const [stage, setStage] = useState<string>('open');
  const asOf = useMemo(() => new Date(), []);

  const vouchers = useMemo(() => rows.rows.map(toVoucher), [rows.rows]);
  const pipeline = useMemo(() => buildPayoutPipeline(vouchers, asOf), [vouchers, asOf]);

  const OPEN = ['requested', 'checked', 'approved', 'on_hold'];
  const shown = useMemo(() => {
    const filtered =
      stage === 'all'
        ? vouchers
        : stage === 'open'
          ? vouchers.filter((v) => OPEN.includes(v.status))
          : vouchers.filter((v) => v.status === stage);

    // Longest wait first: the page exists to surface what has stopped moving.
    return filtered
      .map((voucher) => ({ voucher, ageing: ageVoucher(voucher, asOf), source: rows.rows.find((r) => r.id === voucher.id) }))
      .sort((a, b) => b.ageing.daysAtStep - a.ageing.daysAtStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vouchers, stage, asOf, rows.rows]);

  const payees = useMemo(() => {
    const names = [...new Set(vouchers.map((v) => v.subcontractorName))];
    return names
      .map((name) => payeeStanding(name, vouchers.filter((v) => v.subcontractorName === name), asOf))
      .sort((a, b) => b.outstandingSantim - a.outstandingSantim);
  }, [vouchers, asOf]);

  return (
    <>
      <h1>Payouts</h1>
      {/* print-only */}
      <PrintHeader title="Payouts" subtitle="payment vouchers" />
      <div className="page-actions no-print"><PrintButton label="Print this page" /></div>
      <p className="muted">
        Where every subcontractor payment is and how long it has been there. A voucher that has sat
        for three weeks and one raised yesterday both read as "approved" everywhere else.
      </p>

      {rows.error !== null && <p className="error" role="alert">{rows.error}</p>}
      {rows.loading && <p className="muted">Loading…</p>}

      <section className="kpis">
        <div className="metric-tile">
          <p className="metric-label">Committed</p>
          <p className="metric-value">{formatETB(pipeline.committedSantim)}</p>
          <p className="metric-note muted">approved and unpaid — no longer a decision</p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">In flight</p>
          <p className="metric-value">{formatETB(pipeline.inFlightSantim)}</p>
          <p className="metric-note muted">submitted, waiting on verification or approval</p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Typical time to pay</p>
          <p className="metric-value">
            {pipeline.medianDaysToPay === null ? '—' : `${pipeline.medianDaysToPay} days`}
          </p>
          <p className="metric-note muted">
            median from request to payment{pipeline.medianDaysToPay === null ? ' — nothing paid yet' : ''}
          </p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Paid on time</p>
          <p className="metric-value">
            {pipeline.onTimeRateBps === null ? '—' : formatBps(pipeline.onTimeRateBps, 0)}
          </p>
          <p className="metric-note muted">inside the approval target</p>
        </div>
      </section>

      <section className="card">
        <h2>The pipeline</h2>
        <ul className="pipeline">
          {pipeline.stages.filter((s) => s.count > 0).map((s) => (
            <li key={s.key} className={s.overdue > 0 ? 'is-stuck' : ''}>
              <button type="button" onClick={() => setStage(s.key)}>
                <strong>{s.label}</strong>
                <span className="pipeline-count">{s.count}</span>
                <span className="muted">{formatETB(s.netPayableSantim)}</span>
                {s.overdue > 0 && (
                  <span className="warn-text">{s.overdue} past target · oldest {s.oldestDays} days</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="filter-row">
          <button type="button" className={stage === 'open' ? 'primary' : ''} onClick={() => setStage('open')}>Open</button>
          <button type="button" className={stage === 'all' ? 'primary' : ''} onClick={() => setStage('all')}>All</button>
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="muted">No voucher is in that state.</p>
      ) : (
        <ul className="voucher-list">
          {shown.map(({ voucher, ageing, source }) => (
            <li key={voucher.id} className={`voucher-row ${ageing.overdue ? 'is-stuck' : ''}`}>
              <div className="chase-head">
                <div>
                  <strong>{voucher.voucherNo}</strong>
                  <span className="muted"> · {voucher.subcontractorName} · {voucher.phaseName}</span>
                </div>
                <span className="chip">{stepLabel(voucher.status)}</span>
                <span className={ageing.overdue ? 'warn-text' : 'muted'}>
                  {ageing.daysAtStep} day{ageing.daysAtStep === 1 ? '' : 's'} here
                  {ageing.overdue && ` · target is ${ageing.targetDays}`}
                </span>
                <strong className="chase-amount">{formatETB(voucher.netPayableSantim)}</strong>
              </div>

              <p className="muted chase-meta">
                Waiting on {ageing.waitingOn}.
                {ageing.daysSinceRequest !== null && ` Requested ${ageing.daysSinceRequest} days ago.`}
                {ageing.daysToPay !== null && ` Paid in ${ageing.daysToPay} days.`}
              </p>

              {source?.workflow?.reason != null && source.workflow.reason !== '' && (
                <p className="warn-text">⚠ {source.workflow.reason}</p>
              )}

              {source?.workflow?.requestedAt != null && (
                <p className="muted chase-meta">
                  Requested {formatDual(source.workflow.requestedAt.toDate())}
                  {source.workflow.checkedAt != null && ` · verified ${formatDual(source.workflow.checkedAt.toDate())}`}
                  {source.workflow.approvedAt != null && ` · approved ${formatDual(source.workflow.approvedAt.toDate())}`}
                </p>
              )}

              {source !== undefined && <PayoutActions voucher={source} />}
            </li>
          ))}
        </ul>
      )}

      <section className="card">
        <h2>What our subcontractors would say</h2>
        <p className="muted">
          A subcontractor paid ninety days late who still turns up is performing well. Reading their
          delivery figures without this is unfair to them.
        </p>
        {payees.length === 0 ? (
          <p className="muted">No payment vouchers yet.</p>
        ) : (
          <ul className="pick-list">
            {payees.map((payee) => (
              <li key={payee.subcontractorName}>
                <span><strong>{payee.subcontractorName}</strong> — {payee.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
