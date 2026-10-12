/**
 * Money that can be invoiced today and has not been.
 *
 * Shown wherever somebody is deciding what to do with their time — the priority
 * board, the cash forecast, the dashboard — because it is the cheapest cash in
 * the business: one person, one document, and the clock on collection starts.
 */

import { Link } from 'react-router-dom';
import { describeReady, sumReady, type ReadyItem } from '../lib/cash-pipeline.js';
import { formatETB } from '../lib/money.js';

export function ReadyToInvoiceList({
  items,
  limit = 8,
  loading = false,
}: {
  items: readonly ReadyItem[];
  limit?: number;
  loading?: boolean;
}) {
  const shown = items.slice(0, limit);
  const hidden = items.length - shown.length;

  return (
    <section className="card ready-to-invoice" aria-label="Ready to invoice">
      <h2>
        Ready to invoice{' '}
        <span className="muted related-count">{loading ? '…' : items.length}</span>
      </h2>
      {loading && items.length === 0 ? (
        <p className="muted">Checking which payment terms are ready…</p>
      ) : items.length === 0 ? (
        <p className="muted">
          Nothing is waiting to be billed. A payment term shows up here once the stage it is tied to
          is complete, or its own date arrives.
        </p>
      ) : (
        <>
          <p>
            <strong>{formatETB(sumReady(items))}</strong> with VAT is earned and not yet invoiced.
          </p>
          <ul className="related-list">
            {shown.map((item) => (
              <li key={item.termId}>
                <div className="related-main">
                  <Link to={`/contracts/${item.contractId}`}>
                    <strong>{item.contractNo} · {item.termName}</strong>
                  </Link>
                  <span className="muted related-detail">
                    {item.clientName} — {describeReady(item)}
                    {item.maintenance ? ' · monthly maintenance' : ''}
                  </span>
                </div>
                <div className="related-meta strong">{formatETB(item.amountSantim)}</div>
              </li>
            ))}
          </ul>
          {hidden > 0 && <p className="muted">…and {hidden} more.</p>}
        </>
      )}
    </section>
  );
}
