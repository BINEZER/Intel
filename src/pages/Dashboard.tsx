import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { subscribeActiveProjectAssignments, subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import { downloadCsv, reportFilename, toCsv } from '../lib/csv.js';
import { PROJECT_STATUSES } from '../lib/status.js';
import type { Project, ProjectAssignment } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const pct = (value: number) => Math.round(Math.max(0, Math.min(10000, value)) / 100);
const dateText = (value: Project['plannedStart'] | Project['plannedEnd'] | Project['actualEnd']): string =>
  value?.at?.toDate().toLocaleDateString() ?? '';

export function Dashboard() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const assignments = useCollection<ProjectAssignment>((d, e) => subscribeActiveProjectAssignments(d, e), [], 'load project assignments');
  const peopleByProject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of assignments.rows) {
      const names = map.get(row.projectId) ?? [];
      const label = row.role === 'subcontractor' ? `${row.technicianName} (Subcontractor)` : `${row.technicianName} (${row.role})`;
      if (!names.includes(label)) names.push(label);
      map.set(row.projectId, names);
    }
    return map;
  }, [assignments.rows]);
  const active = projects.rows.filter((p) => !['completed', 'cancelled', 'terminated'].includes(p.status));
  const now = new Date();
  const completedThisMonth = projects.rows.filter((p) => {
    const completedAt = p.actualEnd?.at?.toDate();
    return p.status === 'completed' && completedAt !== undefined && completedAt.getFullYear() === now.getFullYear() && completedAt.getMonth() === now.getMonth();
  }).length;
  const delayed = active.filter((p) => !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < now.getTime());
  const phaseCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const project of projects.rows) {
      const name = project.currentStage?.name ?? 'Not started';
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [projects.rows]);
  const awaitingHandover = active.filter((p) => p.currentStage?.key === 'authority_inspection');

  function exportCsv() {
    const columns = [
      { header: 'Project number', value: (p: WithId<Project>) => p.projectNo },
      { header: 'Project', value: (p: WithId<Project>) => p.title },
      { header: 'Client', value: (p: WithId<Project>) => p.clientName },
      { header: 'Site address', value: (p: WithId<Project>) => p.site?.address ?? '' },
      { header: 'Assigned personnel', value: (p: WithId<Project>) => (peopleByProject.get(p.id) ?? []).join('; ') },
      { header: 'Current phase', value: (p: WithId<Project>) => p.currentStage?.name ?? '' },
      { header: 'Progress (%)', value: (p: WithId<Project>) => pct(p.progressBps) },
      { header: 'Status', value: (p: WithId<Project>) => PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status },
      { header: 'Planned start', value: (p: WithId<Project>) => dateText(p.plannedStart) },
      { header: 'Planned end', value: (p: WithId<Project>) => dateText(p.plannedEnd) },
      { header: 'Actual completion', value: (p: WithId<Project>) => dateText(p.actualEnd) },
    ];
    downloadCsv(reportFilename('project-report', now.toISOString().slice(0, 10)), toCsv(columns, projects.rows));
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
          <button type="button" className="primary" onClick={exportCsv} disabled={projects.loading || projects.rows.length === 0}>Export CSV</button>
          <Link className="button-link primary" to="/projects">View projects</Link>
        </div>
      </div>

      <div className="report-print-heading"><h1>IntelMotion — Project Report</h1><p>Generated {now.toLocaleString()}</p></div>
      {projects.error && <p className="error no-print" role="alert">{projects.error}</p>}
      {assignments.error && <p className="error no-print" role="alert">{assignments.error}</p>}

      <div className="project-metrics">
        <article className="project-metric"><span>Total projects</span><strong>{projects.rows.length}</strong></article>
        <article className="project-metric"><span>Active projects</span><strong>{active.length}</strong></article>
        <article className="project-metric"><span>Past planned end</span><strong>{delayed.length}</strong></article>
        <article className="project-metric"><span>Inspection / handover</span><strong>{awaitingHandover.length}</strong></article>
        <article className="project-metric"><span>Completed this month</span><strong>{completedThisMonth}</strong></article>
      </div>

      <div className="dashboard-charts">
        <section className="card dashboard-chart-card">
          <div className="dashboard-chart-heading"><div><h2>Projects by status</h2><p className="muted">Current portfolio distribution</p></div><strong>{projects.rows.length} total</strong></div>
          {projects.loading ? <p className="muted">Loading chart…</p> : projects.rows.length === 0 ? <p className="muted">No project data yet.</p> : (
            <div className="status-chart-layout">
              <div className="status-donut" role="img" aria-label={PROJECT_STATUSES.map((s) => `${s.label}: ${projects.rows.filter((p) => p.status === s.value).length}`).join(', ')}>
                <svg viewBox="0 0 160 160" aria-hidden="true">
                  <circle cx="80" cy="80" r="59" fill="none" stroke="var(--surface-2)" strokeWidth="20" />
                  {PROJECT_STATUSES.map((status, index) => {
                    const count = projects.rows.filter((p) => p.status === status.value).length;
                    const circumference = 2 * Math.PI * 59;
                    const length = projects.rows.length ? count / projects.rows.length * circumference : 0;
                    const offset = PROJECT_STATUSES.slice(0, index).reduce((sum, prior) => sum + projects.rows.filter((p) => p.status === prior.value).length / projects.rows.length * circumference, 0);
                    const colors = ['#8A9BB2','#2D8A65','#D69B35','#2877C7','#A0A8B5','#B85B58'];
                    return count ? <circle key={status.value} cx="80" cy="80" r="59" fill="none" stroke={colors[index % colors.length]} strokeWidth="20" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" /> : null;
                  })}
                </svg>
                <div className="status-donut-center"><strong>{projects.rows.length}</strong><span>Projects</span></div>
              </div>
              <ul className="chart-legend">
                {PROJECT_STATUSES.map((status, index) => {
                  const count = projects.rows.filter((p) => p.status === status.value).length;
                  const colors = ['#8A9BB2','#2D8A65','#D69B35','#2877C7','#A0A8B5','#B85B58'];
                  return <li key={status.value}><span className="chart-legend-dot" style={{background:colors[index % colors.length]}} /><span>{status.label}</span><strong>{count}</strong></li>;
                })}
              </ul>
            </div>
          )}
        </section>
        <section className="card dashboard-chart-card">
          <div className="dashboard-chart-heading"><div><h2>Projects by current phase</h2><p className="muted">Where active work is concentrated</p></div></div>
          {projects.loading ? <p className="muted">Loading chart…</p> : phaseCounts.length === 0 ? <p className="muted">No phase information available yet.</p> : (
            <div className="phase-chart-list">
              {phaseCounts.map((phase) => <div className="phase-chart-row" key={phase.name}>
                <div><span>{phase.name}</span><strong>{phase.count}</strong></div>
                <div className="phase-chart-track"><span style={{width:`${phase.count / Math.max(1, projects.rows.length) * 100}%`}} /></div>
              </div>)}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
