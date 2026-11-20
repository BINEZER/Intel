import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, subscribePhases, updateProjectStatus } from '../data/projects.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { PhaseTracker } from '../components/PhaseTracker.js';
import { CertificationPanel } from '../components/CertificationPanel.js';
import { ProjectTeam } from '../components/ProjectTeam.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { DualDateText } from '../components/DualDateInput.js';
import type { Project, ProjectPhase, Technician } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [project, setProject] = useState<WithId<Project> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { busy, error, run } = useAsyncAction('update project status');
  const phases = useCollection<ProjectPhase>(
    (d, e) => subscribePhases(projectId ?? '', d, e), [projectId], 'load project phases',
  );
  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e, { activeOnly: true }), [], 'load technicians',
  );

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    getProject(projectId).then((row) => {
      if (cancelled) return;
      if (row === null) setLoadError('Project not found.');
      else { setProject(row); setLoadError(null); }
    }).catch(() => { if (!cancelled) setLoadError('Could not load this project.'); });
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  if (loadError) return <section className="card"><p className="error">{loadError}</p><Link to="/projects">Back to projects</Link></section>;
  if (!project) return <p className="muted">Loading project…</p>;

  const inspection = phases.rows.find((phase) => phase.certification !== undefined);
  const address = [project.site?.address, project.site?.subCity, project.site?.city].filter(Boolean).join(', ');

  return (
    <div className="project-detail-page">
      <p className="back-link"><Link to="/projects">← All projects</Link></p>
      <div className="page-head project-detail-head">
        <div>
          <p className="eyebrow">{project.projectNo}</p>
          <h1>{project.title}</h1>
          <p className="muted">{project.clientName} · {project.site?.name}{project.site?.city ? ` · ${project.site.city}` : ''}</p>
        </div>
        {editable && user && <div className="field inline-field">
          <label htmlFor="project-status">Project status</label>
          <StatusSelect id="project-status" kind="project" compact value={project.status} disabled={busy}
            onChange={(value) => void run(async () => {
              await updateProjectStatus(project.id, value as Project['status'], user.uid);
              setReloadKey((n) => n + 1);
              return true;
            })} />
        </div>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <section className="project-facts-grid">
        <article className="project-fact"><span>Client</span><strong>{project.clientName}</strong></article>
        <article className="project-fact"><span>Site</span><strong>{project.site?.name || '—'}</strong><small>{address || 'Location not recorded'}</small></article>
        <article className="project-fact"><span>Planned start</span><strong><DualDateText value={project.plannedStart} /></strong></article>
        <article className="project-fact"><span>Planned completion</span><strong><DualDateText value={project.plannedEnd} /></strong></article>
        <article className="project-fact"><span>Elevators</span><strong>{project.units?.length ?? 0}</strong><small>{(project.units ?? []).map((unit) => unit.tag).join(', ')}</small></article>
        <article className="project-fact"><span>Overall progress</span><strong>{Math.round((project.progressBps ?? 0) / 100)}%</strong><div className="mini-progress"><span style={{width:`${Math.max(0,Math.min(100,project.progressBps/100))}%`}} /></div></article>
      </section>

      {phases.error && <p className="error" role="alert">{phases.error}</p>}
      {phases.rows.length > 0 && <PhaseTracker projectId={project.id} phases={phases.rows} />}
      {inspection && <CertificationPanel projectId={project.id} phase={inspection} />}
      <ProjectTeam projectId={project.id} technicians={technicians.rows} />
    </div>
  );
}
