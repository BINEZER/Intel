/**
 * Priority board: the next actions most likely to unlock cash or prevent delay.
 * Financial detail belongs in Receivables and Cash forecast; this page decides
 * what to do next.
 */

import { formatETB } from '../lib/money.js';
import { portfolioTotals } from '../lib/priority.js';
import type { ProjectPriority } from '../lib/schema.js';
import { KpiTile } from '../components/KpiTile.js';
import { RiskBadge, RiskFlagList } from '../components/RiskAlerts.js';
import { Link } from 'react-router-dom';
import type { MaintenanceRow, ReadyItem } from '../lib/cash-pipeline.js';

export interface PriorityRow extends Omit<ProjectPriority, 'computedAt'> {
  title: string;
  clientName: string;
  /** Earned and not yet invoiced: terms whose stage is done or whose date has come. */
  readyToInvoiceSantim: number;
}

export function PriorityBoard({
  rows,
  horizonDays,
  ready,
  maintenance,
  termsLoading,
}: {
  rows: readonly PriorityRow[];
  horizonDays: number;
  ready: readonly ReadyItem[];
  maintenance: readonly MaintenanceRow[];
  termsLoading: boolean;
}) {
  const totals = portfolioTotals(rows);
  const readySantim = ready.reduce((a, r) => a + r.amountSantim, 0);
  const visibleRows = rows.slice(0, 5);
  const remainingRows = rows.slice(5);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Priority</h1>
          <p className="muted">What to act on first to unlock cash or prevent a costly delay. Ranked using cash at stake and project risk over the next {horizonDays} days.</p>
        </div>
      </header>

      <section className="kpis" aria-label="Priority summary">
        <KpiTile
          label="Cash reachable"
          value={formatETB(totals.expectedReceivableSantim)}
          detail={<span className="muted">within {horizonDays} days</span>}
        />
        <KpiTile
          label="Overdue"
          value={formatETB(totals.overdueReceivableSantim)}
          status={totals.overdueReceivableSantim > 0 ? 'bad' : 'good'}
          detail={<Link to="/collections">Work collections</Link>}
        />
        <KpiTile
          label="Ready to invoice"
          value={formatETB(readySantim)}
          status={readySantim > 0 ? 'bad' : 'good'}
          detail={<Link to="/invoices">Create / review invoices</Link>}
        />
        <KpiTile
          label="Projects at risk"
          value={String(totals.inDanger)}
          status={totals.inDanger > 0 ? 'bad' : 'good'}
          detail={<span className="muted">of {totals.projects} projects</span>}
        />
      </section>

      {termsLoading && <p className="muted">Updating invoiceable amounts…</p>}

      <section aria-labelledby="priority-actions-heading">
        <div className="section-heading">
          <h2 id="priority-actions-heading">Act on these first</h2>
          <span className="muted">Top {Math.min(5, rows.length)} of {rows.length} projects</span>
        </div>
        {rows.length === 0 ? (
          <div className="card"><p className="muted">No active projects to prioritize.</p></div>
        ) : (
          <div className="priority-actions">
            {visibleRows.map((row) => <PriorityAction key={row.projectId} row={row} horizonDays={horizonDays} />)}
          </div>
        )}
        {remainingRows.length > 0 && (
          <details className="card priority-more">
            <summary>Show the other {remainingRows.length} projects</summary>
            <div className="priority-actions">
              {remainingRows.map((row) => <PriorityAction key={row.projectId} row={row} horizonDays={horizonDays} />)}
            </div>
          </details>
        )}
      </section>

      <MaintenanceSection rows={maintenance} loading={termsLoading} />
    </>
  );
}

function PriorityAction({ row, horizonDays }: { row: PriorityRow; horizonDays: number }) {
  let action: string;
  let reason: string;
  let href: string;

  if (row.overdueReceivableSantim > 0) {
    action = 'Follow up overdue payment';
    reason = `${formatETB(row.overdueReceivableSantim)} is already invoiced and overdue.`;
    href = '/collections';
  } else if (row.readyToInvoiceSantim > 0) {
    action = 'Issue the invoice';
    reason = `${formatETB(row.readyToInvoiceSantim)} is earned and waiting to be invoiced.`;
    href = '/invoices';
  } else if (row.risk.inDanger) {
    action = 'Resolve the highest project risk';
    reason = row.risk.flags[0]?.message ?? 'This project has an open risk flag.';
    href = `/projects/${row.projectId}`;
  } else if (row.nearTermBillableSantim > 0) {
    action = 'Advance the next billable milestone';
    reason = `${formatETB(row.nearTermBillableSantim)} may become billable within ${horizonDays} days.`;
    href = `/projects/${row.projectId}`;
  } else {
    action = 'Review project progress';
    reason = 'No immediate collection or invoicing action was identified; check progress and blockers.';
    href = `/projects/${row.projectId}`;
  }

  return (
    <article className={`card priority-action${row.risk.inDanger ? ' priority-action-risk' : ''}`}>
      <div className="priority-action-rank">{row.rank}</div>
      <div className="priority-action-main">
        <div className="priority-action-title">
          <h3><Link to={`/projects/${row.projectId}`}>{row.title}</Link></h3>
          <RiskBadge risk={row.risk} />
        </div>
        <p className="muted priority-client">{row.clientName}</p>
        <p className="priority-reason">{reason}</p>
        <Link className="button-link" to={href}>{action} →</Link>
        <details className="priority-explanation">
          <summary>Why ranked #{row.rank}</summary>
          <ul className="driver-list">
            {row.drivers.map((driver) => (
              <li key={driver.label}>
                <strong>{driver.label}</strong>
                {driver.amountSantim > 0 && <> · {formatETB(driver.amountSantim)}</>}
                <span className="muted"> — {driver.note}</span>
              </li>
            ))}
          </ul>
          {row.risk.flags.length > 0 && <RiskFlagList flags={row.risk.flags} />}
        </details>
      </div>
      <div className="priority-action-cash">
        <span className="muted">Cash in horizon</span>
        <strong>{formatETB(row.expectedReceivableSantim)}</strong>
      </div>
    </article>
  );
}

function MaintenanceSection({ rows, loading }: { rows: readonly MaintenanceRow[]; loading: boolean }) {
  if (!loading && rows.length === 0) return null;

  return (
    <details className="card priority-maintenance">
      <summary>Maintenance agreements with money waiting <span className="muted">({loading ? '…' : rows.length})</span></summary>
      <p className="muted">Kept separate from project ranking. Use the agreement to follow up collection or billing.</p>
      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="priority-table">
            <thead><tr>
              <th scope="col">Agreement</th>
              <th scope="col" className="num">Overdue</th>
              <th scope="col" className="num">Ready to invoice</th>
              <th scope="col" className="num">Not yet due</th>
              <th scope="col" className="num">Coming up</th>
            </tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.contractId}>
                  <td data-label="Agreement" data-primary>
                    <Link to={`/contracts/${row.contractId}`}><strong>{row.contractNo}</strong></Link>
                    <br /><span className="muted">{row.clientName}</span>
                  </td>
                  <td className="num" data-label="Overdue">
                    {row.overdueSantim > 0 ? <span className="danger-text">{formatETB(row.overdueSantim)}{row.oldestOverdueDays !== null && <span className="muted"> · {row.oldestOverdueDays}d</span>}</span> : <span className="muted">—</span>}
                  </td>
                  <td className="num" data-label="Ready to invoice">{row.readyNowSantim > 0 ? formatETB(row.readyNowSantim) : <span className="muted">—</span>}</td>
                  <td className="num" data-label="Not yet due">{row.currentSantim > 0 ? formatETB(row.currentSantim) : <span className="muted">—</span>}</td>
                  <td className="num" data-label="Coming up">{row.upcomingSantim > 0 ? formatETB(row.upcomingSantim) : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
