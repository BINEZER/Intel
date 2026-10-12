/**
 * Priority board: which project, given attention this week, unlocks the most
 * cash soonest.
 *
 * Every row shows the ETB behind its rank. A ranking a manager cannot audit is
 * a ranking they will override, and an overridden ranking is worthless.
 */

import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { portfolioTotals } from '../lib/priority.js';
import type { ProjectPriority } from '../lib/schema.js';
import { KpiTile } from '../components/KpiTile.js';
import { DangerBanner, RiskBadge, RiskFlagList } from '../components/RiskAlerts.js';
import { ReadyToInvoiceList } from '../components/ReadyToInvoiceList.js';
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
  /** Everything that can be invoiced now, projects and maintenance alike. */
  ready: readonly ReadyItem[];
  maintenance: readonly MaintenanceRow[];
  /** True while the payment terms are still being read. */
  termsLoading: boolean;
}) {
  const totals = portfolioTotals(rows);
  const readySantim = ready.reduce((a, r) => a + r.amountSantim, 0);

  return (
    <>
      <h1>Priority</h1>
      <p className="muted">
        Ranked by cash reachable within {horizonDays} days. Money already earned but
        uncollected outranks money still to be built.
      </p>

      <DangerBanner projects={rows} />

      <section className="kpis">
        <KpiTile
          label="Expected receivable"
          value={formatETB(totals.expectedReceivableSantim)}
          detail={<span className="muted">within {horizonDays} days</span>}
        />
        <KpiTile
          label="Overdue"
          value={formatETB(totals.overdueReceivableSantim)}
          status={totals.overdueReceivableSantim > 0 ? 'bad' : 'good'}
          detail={<span className="muted">earned, awaiting collection</span>}
        />
        <KpiTile
          label="Ready to invoice"
          value={formatETB(readySantim)}
          status={readySantim > 0 ? 'bad' : 'good'}
          detail={<span className="muted">{ready.length} term{ready.length === 1 ? '' : 's'}, earned and unbilled</span>}
        />
        <KpiTile
          label="Billable soon"
          value={formatETB(totals.nearTermBillableSantim)}
          detail={<span className="muted">milestones within horizon</span>}
        />
        <KpiTile
          label="Left to bill"
          value={formatETB(totals.unbilledContractSantim)}
          detail={<span className="muted">across the portfolio</span>}
        />
        <KpiTile
          label="In danger"
          value={`${totals.inDanger} / ${totals.projects}`}
          status={totals.inDanger > 0 ? 'bad' : 'good'}
        />
      </section>

      {termsLoading && <p className="muted">Reading the payment terms…</p>}

      <ReadyToInvoiceList items={ready} loading={termsLoading} />

      <h2>Projects</h2>
      <div className="table-scroll">
        <div className="table-scroll">
          <table className="priority-table">
            <caption className="visually-hidden">
              Projects ranked by expected receivable within {horizonDays} days
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Project</th>
                <th scope="col" className="num">Expected</th>
                <th scope="col" className="num">Overdue</th>
                <th scope="col" className="num">Ready to invoice</th>
                <th scope="col" className="num">Billable soon</th>
                <th scope="col" className="num">Left to bill</th>
                <th scope="col" className="num">Impact</th>
                <th scope="col">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId} className={row.risk.inDanger ? 'row-danger' : undefined}>
                  <td className="num" data-label="#">{row.rank}</td>
                  <td data-label="Project" data-primary>
                    <strong>{row.title}</strong>
                    <br />
                    <span className="muted">{row.clientName}</span>
                  </td>
                  <td className="num strong" data-label="Expected">{formatETB(row.expectedReceivableSantim)}</td>
                  <td className="num" data-label="Overdue">
                    {row.overdueReceivableSantim > 0 ? (
                      <span className="danger-text">{formatETB(row.overdueReceivableSantim)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" data-label="Ready to invoice">
                    {row.readyToInvoiceSantim > 0 ? (
                      <span className="danger-text">{formatETB(row.readyToInvoiceSantim)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" data-label="Billable soon">{formatETB(row.nearTermBillableSantim)}</td>
                  <td className="num muted" data-label="Left to bill">{formatETB(row.unbilledContractSantim)}</td>
                  <td className="num" data-label="Impact">{formatBps(row.impactScoreBps, 0)}</td>
                  <td data-label="Risk"><RiskBadge risk={row.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <MaintenanceSection rows={maintenance} loading={termsLoading} />

      <h2>Why each project ranks where it does</h2>
      {rows.map((row) => (
        <section key={row.projectId} className="card">
          <h2>
            {row.rank}. {row.title} <RiskBadge risk={row.risk} />
          </h2>
          <p className="muted">
            {formatETB(row.expectedReceivableSantim)} reachable within {horizonDays} days
          </p>

          <h3>Why it ranks here</h3>
          <ul className="driver-list">
            {row.drivers.map((driver) => (
              <li key={driver.label}>
                <span className="driver-label">{driver.label}</span>
                {driver.amountSantim > 0 && (
                  <span className="driver-amount">{formatETB(driver.amountSantim)}</span>
                )}
                <span className="muted"> — {driver.note}</span>
              </li>
            ))}
          </ul>

          {row.risk.flags.length > 0 && (
            <>
              <h3>Risk flags</h3>
              <RiskFlagList flags={row.risk.flags} />
            </>
          )}
        </section>
      ))}
    </>
  );
}

/**
 * Maintenance agreements with money waiting on them.
 *
 * Separate from the projects above because an agreement has no project to rank,
 * and ranked by ETB rather than by share of the agreement — see `rankMaintenance`.
 */
function MaintenanceSection({ rows, loading }: { rows: readonly MaintenanceRow[]; loading: boolean }) {
  return (
    <section className="card" aria-label="Maintenance agreements">
      <h2>
        Maintenance agreements <span className="muted related-count">{loading ? '…' : rows.length}</span>
      </h2>
      <p className="muted">
        Monthly fees owed or falling due. Ranked by the money waiting, weighted the same way as the
        projects: billed and overdue and earned-but-unbilled count in full, billed and not yet due at
        60%, and months coming up less the further off they are.
      </p>
      {rows.length === 0 ? (
        <p className="muted">{loading ? 'Reading…' : 'No maintenance agreement has money waiting.'}</p>
      ) : (
        <div className="table-scroll">
          <table className="priority-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Agreement</th>
                <th scope="col" className="num">Overdue</th>
                <th scope="col" className="num">Ready to invoice</th>
                <th scope="col" className="num">Billed, not yet due</th>
                <th scope="col" className="num">Coming up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.contractId}>
                  <td className="num" data-label="#">{index + 1}</td>
                  <td data-label="Agreement" data-primary>
                    <Link to={`/contracts/${row.contractId}`}>
                      <strong>{row.contractNo}</strong>
                    </Link>
                    <br />
                    <span className="muted">{row.clientName}</span>
                  </td>
                  <td className="num" data-label="Overdue">
                    {row.overdueSantim > 0 ? (
                      <span className="danger-text">
                        {formatETB(row.overdueSantim)}
                        {row.oldestOverdueDays !== null && <span className="muted"> · {row.oldestOverdueDays} days</span>}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" data-label="Ready to invoice">
                    {row.readyNowSantim > 0 ? (
                      <span className="danger-text">
                        {formatETB(row.readyNowSantim)}
                        <span className="muted"> · {row.readyCount} month{row.readyCount === 1 ? '' : 's'}</span>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num" data-label="Billed, not yet due">
                    {row.currentSantim > 0 ? formatETB(row.currentSantim) : <span className="muted">—</span>}
                  </td>
                  <td className="num" data-label="Coming up">
                    {row.upcomingSantim > 0 ? formatETB(row.upcomingSantim) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
