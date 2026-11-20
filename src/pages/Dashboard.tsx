import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import type { Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const pct = (value: number) => Math.round(Math.max(0, Math.min(10000, value)) / 100);

export function Dashboard() {
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.rows.filter((p) =>
      !q || [p.projectNo, p.title, p.clientName, p.site?.name, p.site?.city]
        .some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [projects.rows, search]);
  const active = projects.rows.filter((p) => !['completed', 'cancelled', 'terminated'].includes(p.status));
  const delayed = active.filter((p) => !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < Date.now());
  const awaitingHandover = active.filter((p) =>
    p.currentStage?.key === 'authority_inspection',
  );

  return (
    <div className="project-home">
      <div className="page-head">
        <div>
          <p className="eyebrow">INTELMOTION · ELEVATOR PROJECTS</p>
          <h1>Project overview</h1>
          <p className="muted">A clear view of every installation and its current progress.</p>
        </div>
        <Link className="button-link primary" to="/projects">View projects</Link>
      </div>

      {projects.error && <p className="error" role="alert">{projects.error}</p>}

      <div className="project-metrics">
        <article className="project-metric"><span>Total projects</span><strong>{projects.rows.length}</strong></article>
        <article className="project-metric"><span>Active projects</span><strong>{active.length}</strong></article>
        <article className="project-metric"><span>Past planned end</span><strong>{delayed.length}</strong></article>
        <article className="project-metric"><span>Inspection / handover</span><strong>{awaitingHandover.length}</strong></article>
      </div>

      <section className="card project-list-card">
        <div className="section-heading">
          <div><h2>Projects</h2><p className="muted">Open a project to see its phases, checkpoints and assigned personnel.</p></div>
          <label className="project-search">
            <span className="visually-hidden">Search projects</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, client or site…" />
          </label>
        </div>
        {projects.loading ? <p className="muted">Loading projects…</p> :
          rows.length === 0 ? <p className="muted">{projects.rows.length === 0 ? 'No projects have been added yet.' : 'No matching projects.'}</p> : (
            <div className="project-table-wrap">
              <table className="data-table project-overview-table">
                <thead><tr><th>Project</th><th>Client / site</th><th>Current phase</th><th>Progress</th><th>Status</th><th>Planned end</th></tr></thead>
                <tbody>
                  {rows.map((p: WithId<Project>) => {
                    const overdue = !['completed', 'cancelled'].includes(p.status) && !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < Date.now();
                    return <tr key={p.id}>
                      <td><Link to={`/projects/${p.id}`} className="project-name-link"><strong>{p.title}</strong><small>{p.projectNo}</small></Link></td>
                      <td>{p.clientName}<small>{p.site?.name}{p.site?.city ? ` · ${p.site.city}` : ''}</small></td>
                      <td>{p.currentStage?.name ?? 'Not started'}</td>
                      <td><div className="mini-progress"><span style={{width:`${pct(p.progressBps)}%`}} /></div><small>{pct(p.progressBps)}%</small></td>
                      <td><span className={`project-status status-${p.status}`}>{p.status.replace(/_/g,' ')}</span>{overdue && <small className="overdue-label">Past planned end</small>}</td>
                      <td>{p.plannedEnd?.at?.toDate().toLocaleDateString() ?? '—'}</td>
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
