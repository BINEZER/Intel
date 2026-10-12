/**
 * Cash forecast: what is expected to come in, month by month, and what has to be
 * done to get it.
 *
 * "EXPECTED" MEANS DUE, NOT PREDICTED
 *   An invoice is placed by its due date and a payment term by its own. Nothing
 *   here guesses when a client will actually pay — that is a judgement about a
 *   client, and a forecast that quietly made it for every client would be wrong
 *   about most of them. What it does is separate money that needs COLLECTING
 *   (already invoiced) from money that needs BILLING (not yet), because the first
 *   needs a phone call and the second needs a document.
 *
 * WHAT IT DOES NOT PAD
 *   Money with no date has its own row. The dated rows are exactly the dated
 *   money, so the total of this month is never inflated by a term somebody has
 *   not yet scheduled.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { pipelineInputs } from '../data/pipeline.js';
import { usePortfolioDetail } from '../data/portfolio.js';
import { subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import { KpiTile } from '../components/KpiTile.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { ReadyToInvoiceList } from '../components/ReadyToInvoiceList.js';
import { bucketTotal, cashForecast, readyToInvoice, type BucketKey, type CashBucket } from '../lib/cash-pipeline.js';
import { formatETB } from '../lib/money.js';
import { formatDual } from '../lib/ethiopic.js';
import type { CalendarBasis } from '../lib/period.js';
import type { Contract, Invoice, Project } from '../lib/schema.js';

const BUCKET_NOTE: Record<BucketKey, string> = {
  overdue: 'Past its date. Money to collect is overdue; money to bill should already have gone out.',
  this: '',
  next: '',
  later: 'Beyond next month.',
  undated:
    'No date, and no finished stage to release it. Give a term a date on its contract and it moves into a month.',
};

export function Cash() {
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const detail = usePortfolioDetail(projects.rows, contracts.rows, invoices.rows);
  const [basis, setBasis] = useState<CalendarBasis>('gregorian');

  const asOf = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  }, []);

  const pipeline = useMemo(
    () => pipelineInputs(contracts.rows, invoices.rows, detail),
    [contracts.rows, invoices.rows, detail],
  );
  const forecast = useMemo(
    () => cashForecast(pipeline.contracts, pipeline.terms, pipeline.stages, pipeline.invoices, pipeline.receipts, asOf, basis),
    [pipeline, asOf, basis],
  );
  const ready = useMemo(
    () => readyToInvoice(pipeline.contracts, pipeline.terms, pipeline.stages, pipeline.invoices, asOf),
    [pipeline, asOf],
  );

  const error = contracts.error ?? projects.error ?? invoices.error ?? detail.error;
  const loading = contracts.loading || projects.loading || invoices.loading;
  if (error !== null) return <p className="error" role="alert">{error}</p>;
  if (loading) return <p className="muted">Loading…</p>;

  const bucket = (key: BucketKey) => forecast.buckets.find((b) => b.key === key) as CashBucket;
  const labelOf = (b: CashBucket) =>
    b.key === 'this'
      ? `This month — ${forecast.thisMonth.label}`
      : b.key === 'next'
        ? `Next month — ${forecast.nextMonth.label}`
        : b.label;
  const altOf = (b: CashBucket) =>
    b.key === 'this' ? forecast.thisMonth.altLabel : b.key === 'next' ? forecast.nextMonth.altLabel : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cash forecast</h1>
          <p className="muted">
            Money due, month by month — invoices by their due date, payment terms by their own. Not a
            prediction of when anybody will pay.
          </p>
        </div>
        <div className="page-actions no-print">
          <div className="mode-toggle" role="group" aria-label="Calendar for the months">
            {(['gregorian', 'ethiopian'] as const).map((b) => (
              <button key={b} type="button" className={basis === b ? 'active' : undefined} aria-pressed={basis === b} onClick={() => setBasis(b)}>
                {b === 'gregorian' ? 'Gregorian' : 'Ethiopian'}
              </button>
            ))}
          </div>
          <PrintButton label="Print this page" />
        </div>
      </div>
      <PrintHeader title="Cash forecast" subtitle={forecast.thisMonth.label} />

      <section className="kpis">
        <KpiTile
          label="Received this month"
          value={formatETB(forecast.receivedThisMonthSantim)}
          status="good"
          detail={<span className="muted">{forecast.thisMonth.label}</span>}
        />
        <KpiTile
          label="Already due"
          value={formatETB(bucketTotal(bucket('overdue')))}
          status={bucketTotal(bucket('overdue')) > 0 ? 'bad' : 'good'}
          detail={<span className="muted">past its date, not yet in</span>}
        />
        <KpiTile
          label="Due this month"
          value={formatETB(bucketTotal(bucket('this')))}
          detail={<span className="muted">still to come</span>}
        />
        <KpiTile
          label="Due next month"
          value={formatETB(bucketTotal(bucket('next')))}
          detail={<span className="muted">{forecast.nextMonth.label}</span>}
        />
        <KpiTile
          label="Ready to invoice"
          value={formatETB(forecast.readyNowSantim)}
          status={forecast.readyNowSantim > 0 ? 'bad' : 'good'}
          detail={<span className="muted">earned, not yet billed</span>}
        />
      </section>

      {detail.loading && <p className="muted">Reading the payment terms…</p>}

      <section className="card">
        <h2>By month</h2>
        <div className="table-scroll">
          <table className="milestone-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col" className="num">To collect <span className="muted">(invoiced)</span></th>
                <th scope="col" className="num">To bill <span className="muted">(not yet invoiced)</span></th>
                <th scope="col" className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {forecast.buckets.map((b) => (
                <tr key={b.key} className={b.key === 'overdue' && bucketTotal(b) > 0 ? 'row-danger' : undefined}>
                  <td data-label="When">
                    <strong>{labelOf(b)}</strong>
                    {altOf(b) !== null && <span className="muted"> · {altOf(b)}</span>}
                    {BUCKET_NOTE[b.key] !== '' && <><br /><span className="muted">{BUCKET_NOTE[b.key]}</span></>}
                  </td>
                  <td className="num" data-label="To collect">{money(b.collectSantim)}</td>
                  <td className="num" data-label="To bill">{money(b.billSantim)}</td>
                  <td className="num strong" data-label="Total">{money(bucketTotal(b))}</td>
                </tr>
              ))}
              <tr>
                <td data-label="When"><strong>Everything</strong></td>
                <td className="num" data-label="To collect">{money(forecast.buckets.reduce((a, b) => a + b.collectSantim, 0))}</td>
                <td className="num" data-label="To bill">{money(forecast.buckets.reduce((a, b) => a + b.billSantim, 0))}</td>
                <td className="num strong" data-label="Total">{money(forecast.buckets.reduce((a, b) => a + bucketTotal(b), 0))}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {forecast.maintenanceSantim > 0 && (
          <p className="muted">
            {formatETB(forecast.maintenanceSantim)} of this is monthly maintenance.
          </p>
        )}
      </section>

      <ReadyToInvoiceList items={ready} loading={detail.loading} />

      {forecast.buckets
        .filter((b) => b.items.length > 0)
        .map((b) => (
          <details key={b.key} className="card" open={b.key === 'overdue' || b.key === 'this'}>
            <summary>
              <strong>{labelOf(b)}</strong> — {b.items.length} item{b.items.length === 1 ? '' : 's'}, {formatETB(bucketTotal(b))}
            </summary>
            <ul className="related-list">
              {b.items.slice(0, 25).map((item) => (
                <li key={item.id}>
                  <div className="related-main">
                    <Link to={item.contractId === null ? '/finance/invoices' : `/contracts/${item.contractId}`}>
                      <strong>{item.label}</strong>
                    </Link>
                    <span className="muted related-detail">
                      {item.clientName}
                      {item.dueOn !== null && <> · {formatDual(item.dueOn)}</>}
                      {item.maintenance ? ' · maintenance' : ''}
                    </span>
                  </div>
                  <div className="related-meta">
                    <span className="chip no-caps">{item.action === 'collect' ? 'to collect' : 'to bill'}</span>
                  </div>
                  <div className="related-meta strong">{formatETB(item.amountSantim)}</div>
                </li>
              ))}
            </ul>
            {b.items.length > 25 && <p className="muted">…and {b.items.length - 25} smaller items.</p>}
          </details>
        ))}
    </>
  );
}

/** An empty cell for nothing, so a column of zeros does not read as data. */
function money(santim: number) {
  return santim === 0 ? <span className="muted">—</span> : formatETB(santim);
}
