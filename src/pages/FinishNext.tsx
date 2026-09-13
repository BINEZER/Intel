/**
 * "Finish next" — unfinished work ranked by the cash it releases.
 *
 * The priority board answers which PROJECT deserves attention. This answers the
 * sharper question: which single piece of work, finished this week, releases the
 * most money. The answer routinely crosses project boundaries.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { useCollection } from '../data/useCollection.js';
import { buildUnlockReport, type UnlockMilestoneInput, type UnlockStageInput } from '../lib/unlock.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { KpiTile } from '../components/KpiTile.js';
import type { Contract, Project } from '../lib/schema.js';

const OWNER_LABEL: Record<string, string> = {
  us: 'Our crew',
  client: 'Client',
  supplier: 'Supplier',
  authority: 'Authority',
};

export function FinishNext({
  stages,
  milestones,
}: {
  stages: readonly UnlockStageInput[];
  milestones: readonly UnlockMilestoneInput[];
}) {
  const asOf = new Date();
  const report = useMemo(() => buildUnlockReport(stages, milestones, asOf), [stages, milestones, asOf]);

  return (
    <>
      <h1>Finish next</h1>
      <p className="muted">
        Unfinished work ranked by the money its completion releases, across every
        project. Work our own crew can act on is listed first.
      </p>

      <section className="kpis">
        <KpiTile
          label="We can unlock"
          value={formatETB(report.actionableSantim)}
          status={report.actionableSantim > 0 ? 'good' : 'unknown'}
          detail={<span className="muted">work our crew can start now</span>}
          title="Milestones gated on stages we own, with no unfinished predecessor."
        />
        <KpiTile
          label="Waiting on others"
          value={formatETB(report.waitingOnOthersSantim)}
          status={report.waitingOnOthersSantim > 0 ? 'warn' : 'unknown'}
          detail={<span className="muted">client, supplier or authority</span>}
          title="Money held up by someone else. Chasing it is a phone call, not a crew."
        />
        <KpiTile
          label="Blocked"
          value={formatETB(report.blockedSantim)}
          status={report.blockedSantim > 0 ? 'bad' : 'good'}
          detail={<span className="muted">predecessor unfinished</span>}
        />
        <KpiTile
          label="Total gated"
          value={formatETB(report.totalGatedSantim)}
          detail={<span className="muted">not yet invoiced</span>}
        />
      </section>

      {report.rows.length === 0 ? (
        <p className="muted">
          No unfinished work has a payment milestone attached to it. Link milestones to
          stages on a contract's payment schedule and they will appear here.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Work to finish</th>
                <th scope="col">Project</th>
                <th scope="col">Waiting on</th>
                <th scope="col" className="num">Done</th>
                <th scope="col" className="num">Releases</th>
                <th scope="col">Milestones</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => (
                <tr
                  key={`${row.projectId}-${row.phaseId}`}
                  className={row.actionable ? undefined : 'row-muted'}
                >
                  <td className="num muted">{index + 1}</td>
                  <td>
                    <strong>{row.stageName}</strong>
                    {row.overdue && <><br /><span className="danger-text">overdue</span></>}
                    {row.blockedByPhaseIds.length > 0 && (
                      <><br /><span className="warn-text">predecessor unfinished</span></>
                    )}
                    {row.status === 'blocked' && <><br /><span className="warn-text">blocked</span></>}
                  </td>
                  <td>
                    <Link to={`/projects/${row.projectId}`}>{row.projectTitle}</Link>
                    <br />
                    <span className="muted">{row.clientName}</span>
                  </td>
                  <td>
                    <span className={row.actionable ? 'chip chip-ok' : 'chip'}>
                      {OWNER_LABEL[row.owner] ?? row.owner}
                    </span>
                  </td>
                  <td className="num">{formatBps(row.progressBps, 0)}</td>
                  <td className="num strong">{formatETB(row.gatedSantim, { withSymbol: false })}</td>
                  <td className="muted">
                    {row.milestones.map((m) => m.name).join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Route wrapper: pulls the live stages and milestones this view needs. */
export function FinishNextRoute() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');

  // Stages and milestones live in subcollections, so a portfolio-wide view needs
  // them gathered per project. Until a Cloud Function denormalises this, the page
  // renders from what the project documents already carry.
  const stages: UnlockStageInput[] = [];
  const milestones: UnlockMilestoneInput[] = [];

  const loading = projects.loading || contracts.loading;
  const error = projects.error ?? contracts.error;

  return (
    <>
      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      <FinishNext stages={stages} milestones={milestones} />
    </>
  );
}
