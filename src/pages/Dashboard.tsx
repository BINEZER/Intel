import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import { downloadCsv, reportFilename, toCsv } from '../lib/csv.js';
import { PROJECT_STATUSES } from '../lib/status.js';
import type { Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const pct = (value: number) => Math.round(Math.max(0, Math.min(10000, value)) / 100);
const dateText = (value: Project['plannedStart'] | Project['plannedEnd'] | Project['actualEnd']): string =>
  value?.at?.toDate().toLocaleDateString() ?? '';

export function Dashboard() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.rows.filter((p) =>
      !q || [p.projectNo, p.title, p.clientName, p.site?.address, p.currentStage?.name, p.status]
        .some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [projects.rows, search]);
  const active = projects.rows.filter((p) => !['completed', 'cancelled', 'terminated'].includes(p.status));
  const now = new Date();
  const completedThisMonth = projects.rows.filter((p) => {
    const completedAt = p.actualEnd?.at?.toDate();
    return p.status === 'completed' && completedAt !== undefined && completedAt.getFullYear() === now.getFullYear() && completedAt.getMonth() === now.getMonth();
  }).length;
  const delayed = active.filter((p) => !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < now.getTime());
  const awaitingHandover = active.filter((p) => p.currentStage?.key === 'authority_inspection');

  function exportCsv() {
    const columns = [
      { header: 'Project number', value: (p: WithId<Project>) => p.projectNo },
      { header: 'Project', value: (p: WithId<Project>) => p.title },
      { header: 'Client', value: (p: WithId<Project>) => p.clientName },
      { header: 'Site address', value: (p: WithId<Project>) => p.site?.address ?? '' },
      { header: 'Current phase', value: (p: WithId<Project>) => p.currentStage?.name ?? '' },
      { header: 'Progress (%)', value: (p: WithId<Project>) => pct(p.progressBps) },
      { header: 'Status', value: (p: WithId<Project>) => PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status },
      { header: 'Planned start', value: (p: WithId<Project>) => dateText(p.plannedStart) },
      { header: 'Planned end', value: (p: WithId<Project>) => dateText(p.plannedEnd) },
      { header: 'Actual completion', value: (p: WithId<Project>) => dateText(p.actualEnd) },
    ];
    downloadCsv(reportFilename('project-report', now.toISOString().slice(0, 10)), toCsv(columns, rows));
  }

  return (
    <div className="project-home dashboard-report">
      <div className="page-head no-print">
        <div>
          <p className="eyebrow">INTELMOTION · ELEVATOR PROJECTS</p>
          <h1>Project overview</h1>
          <p className="muted">A clear view of every installation and its current progress.</p>
        </div>
        <div className="report-actions">
          <button type="button" onClick={() => window.print()}>Print report</button>
          <button type="button" className="primary" onClick={exportCsv} disabled={projects.loading || rows.length === 0}>Export CSV</button>
          <Link className="button-link primary" to="/projects">View projects</Link>
        </div>
      </div>

      <div className="report-print-heading"><h1>IntelMotion — Project Report</h1><p>Generated {now.toLocaleString()}</p></div>
      {projects.error && <p className="error no-print" role="alert">{projects.error}</p>}

      <div className="project-metrics">
        <article className="project-metric"><span>Total projects</span><strong>{projects.rows.length}</strong></article>
        <article className="project-metric"><span>Active projects</span><strong>{active.length}</strong></article>
        <article className="project-metric"><span>Past planned end</span><strong>{delayed.length}</strong></article>
        <article className="project-metric"><span>Inspection / handover</span><strong>{awaitingHandover.length}</strong></article>
        <article className="project-metric"><span>Completed this month</span><strong>{completedThisMonth}</strong></article>
      </div>

      <section className="card project-list-card">
        <div className="section-heading no-print">
          <div><h2>Project register</h2><p className="muted">{rows.length} of {projects.rows.length} projects · Open a project for phases and assigned personnel.</p></div>
          <label className="project-search">
            <span className="visually-hidden">Search projects</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, client, site or phase…" />
          </label>
        </div>
        {projects.loading ? <p className="muted">Loading projects…</p> :
          rows.length === 0 ? <p className="muted">{projects.rows.length === 0 ? 'No projects have been added yet.' : 'No matching projects.'}</p> : (
            <div className="project-table-wrap">
              <table className="data-table project-overview-table">
                <thead><tr><th>Project</th><th>Client / site</th><th>Current phase</th><th>Progress</th><th>Status</th><th>Planned end</th></tr></thead>
                <tbody>
                  {rows.map((p: WithId<Project>) => {
                    const overdue = !['completed', 'cancelled', 'terminated'].includes(p.status) && !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < now.getTime();
                    return <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`} className="project-name-link no-print"><strong>{p.title}</strong><small>{p.projectNo}</small></Link><span className="print-only"><strong>{p.title}</strong><small>{p.projectNo}</small></span></td>
                      <td>{p.clientName}<small>{p.site?.address ?? '—'}</small></td>
                      <td>{p.currentStage?.name ?? 'Not started'}</td>
                      <td><div className="mini-progress"><span style={{width:`${pct(p.progressBps)}%`}} /></div><small>{pct(p.progressBps)}%</small></td>
                      <td><span className={`project-status status-${p.status}`}>{PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status}</span>{overdue && <small className="overdue-label">Past planned end</small>}</td>
                      <td>{dateText(p.plannedEnd) || '—'}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
