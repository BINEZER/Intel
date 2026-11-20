import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import { downloadCsv, reportFilename, toCsv } from '../lib/csv.js';
import { PROJECT_STATUSES } from '../lib/status.js';
import type { Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

function dateText(value: Project['plannedStart'] | Project['plannedEnd'] | Project['actualEnd']): string {
  return value?.at?.toDate().toLocaleDateString() ?? '';
}

export function Reports() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load project report');
  const [query, setQuery] = useState('');
  const now = new Date();
  const active = projects.rows.filter((p) => !['completed', 'cancelled', 'terminated'].includes(p.status));
  const completedThisMonth = projects.rows.filter((p) => {
    const d = p.actualEnd?.at?.toDate();
    return p.status === 'completed' && d !== undefined && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
  const overdue = active.filter((p) => !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < now.getTime());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.rows.filter((p) => !q || [p.projectNo, p.title, p.clientName, p.site?.address, p.currentStage?.name, p.status]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [projects.rows, query]);

  function exportCsv() {
    const columns = [
      { header: 'Project number', value: (p: WithId<Project>) => p.projectNo },
      { header: 'Project', value: (p: WithId<Project>) => p.title },
      { header: 'Client', value: (p: WithId<Project>) => p.clientName },
      { header: 'Site address', value: (p: WithId<Project>) => p.site?.address ?? '' },
      { header: 'Current phase', value: (p: WithId<Project>) => p.currentStage?.name ?? '' },
      { header: 'Progress (%)', value: (p: WithId<Project>) => Math.round(p.progressBps / 100) },
      { header: 'Status', value: (p: WithId<Project>) => p.status.replace(/_/g, ' ') },
      { header: 'Planned start', value: (p: WithId<Project>) => dateText(p.plannedStart) },
      { header: 'Planned end', value: (p: WithId<Project>) => dateText(p.plannedEnd) },
      { header: 'Actual completion', value: (p: WithId<Project>) => dateText(p.actualEnd) },
    ];
    downloadCsv(reportFilename('project-report', now.toISOString().slice(0, 10)), toCsv(columns, rows));
  }

  return <div className="project-report-page">
    <div className="page-head no-print">
      <div><p className="eyebrow">INTELMOTION · PROJECT CONTROL</p><h1>Project reporting</h1>
        <p className="muted">A printable and downloadable snapshot of project progress.</p></div>
      <div className="report-actions">
        <button type="button" onClick={() => window.print()}>Print report</button>
        <button type="button" className="primary" onClick={exportCsv}>Export CSV</button>
      </div>
    </div>
    <div className="report-print-heading"><h1>IntelMotion — Project Report</h1><p>Generated {now.toLocaleString()}</p></div>
    {projects.error && <p className="error" role="alert">{projects.error}</p>}
    <div className="project-metrics report-metrics">
      <article className="project-metric"><span>Total projects</span><strong>{projects.rows.length}</strong></article>
      <article className="project-metric"><span>Active projects</span><strong>{active.length}</strong></article>
      <article className="project-metric"><span>Past planned end</span><strong>{overdue.length}</strong></article>
      <article className="project-metric"><span>Completed this month</span><strong>{completedThisMonth}</strong></article>
    </div>
    <section className="card project-list-card">
      <div className="section-heading no-print"><div><h2>Project register</h2><p className="muted">{rows.length} of {projects.rows.length} projects</p></div>
        <label className="project-search"><span className="visually-hidden">Filter report</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by project, client, address or phase…" />
        </label>
      </div>
      {projects.loading ? <p className="muted">Loading report…</p> : <div className="project-table-wrap">
        <table className="data-table project-overview-table">
          <thead><tr><th>Project</th><th>Client / site address</th><th>Current phase</th><th>Progress</th><th>Status</th><th>Planned end</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td><Link className="project-name-link no-print" to={`/projects/${p.id}`}><strong>{p.title}</strong><small>{p.projectNo}</small></Link><span className="print-only"><strong>{p.title}</strong><small>{p.projectNo}</small></span></td>
            <td>{p.clientName}<small>{p.site?.address ?? '—'}</small></td>
            <td>{p.currentStage?.name ?? 'Not started'}</td>
            <td>{Math.round(p.progressBps / 100)}%</td>
            <td>{PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status}</td>
            <td>{dateText(p.plannedEnd) || '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  </div>;
}
