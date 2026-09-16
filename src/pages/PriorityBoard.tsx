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

export interface PriorityRow extends Omit<ProjectPriority, 'computedAt'> {
  title: string;
  clientName: string;
}

export function PriorityBoard({ rows, horizonDays }: { rows: readonly PriorityRow[]; horizonDays: number }) {
  const totals = portfolioTotals(rows);

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
                <th scope="col" className="num">Billable soon</th>
                <th scope="col" className="num">Left to bill</th>
                <th scope="col" className="num">Impact</th>
                <th scope="col">Risk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.projectId} className={row.risk.inDanger ? 'row-danger' : undefined}>
                  <td className="num">{row.rank}</td>
                  <td>
                    <strong>{row.title}</strong>
                    <br />
                    <span className="muted">{row.clientName}</span>
                  </td>
                  <td className="num strong">{formatETB(row.expectedReceivableSantim)}</td>
                  <td className="num">
                    {row.overdueReceivableSantim > 0 ? (
                      <span className="danger-text">{formatETB(row.overdueReceivableSantim)}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">{formatETB(row.nearTermBillableSantim)}</td>
                  <td className="num muted">{formatETB(row.unbilledContractSantim)}</td>
                  <td className="num">{formatBps(row.impactScoreBps, 0)}</td>
                  <td><RiskBadge risk={row.risk} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
