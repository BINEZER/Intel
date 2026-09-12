/**
 * Project detail: phases, certification, team and live KPIs.
 *
 * The KPIs here are computed from what is actually stored — phase progress,
 * assignments, the contract — rather than from a snapshot, so the page never
 * shows a figure the underlying records do not support.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, subscribePhases } from '../data/projects.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { useCollection } from '../data/useCollection.js';
import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import { rollUpProgress } from '../lib/phases.js';
import { PhaseTracker } from '../components/PhaseTracker.js';
import { CertificationPanel } from '../components/CertificationPanel.js';
import { ProjectTeam } from '../components/ProjectTeam.js';
import { RiskFlagList } from '../components/RiskAlerts.js';
import { ProjectKpiPanel } from './ProjectKpis.js';
import { DualDateText } from '../components/DualDateInput.js';
import type { Project, ProjectPhase, Technician } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<WithId<Project> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const phases = useCollection<ProjectPhase>(
    (d, e) => subscribePhases(projectId ?? '', d, e),
    [projectId],
    'load the project phases',
  );
  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e, { activeOnly: true }),
    [],
    'load technicians',
  );

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;
    getProject(projectId)
      .then((found) => {
        if (cancelled) return;
        if (found === null) setLoadError('That project does not exist.');
        else setProject(found);
      })
      .catch(() => {
        if (!cancelled) setLoadError('Could not load that project.');
      });
    return () => { cancelled = true; };
  }, [projectId]);

  if (loadError !== null) {
    return (
      <>
        <p className="error" role="alert">{loadError}</p>
        <Link to="/projects">Back to projects</Link>
      </>
    );
  }
  if (project === null) return <p className="muted">Loading project…</p>;

  const asOf = new Date();
  const inspectionPhase = phases.rows.find((p) => p.certification !== undefined);

  // Recompute from the live phases rather than trusting the stored roll-up, so a
  // stale write can never make this page disagree with its own phase list.
  const progressBps = phases.rows.length > 0 ? rollUpProgress(phases.rows) : project.progressBps;

  const kpi = computeProjectKpis(
    {
      plannedStart: project.plannedStart.at.toDate(),
      plannedEnd: project.plannedEnd.at.toDate(),
      actualStart: project.actualStart?.at.toDate() ?? null,
      actualEnd: project.actualEnd?.at.toDate() ?? null,
      progressBps,
      status: project.status,
      contractNetSantim: project.financials?.contractNetSantim ?? 0,
      subcontractCostNetSantim: project.financials?.subcontractCostNetSantim ?? 0,
      invoicedNetSantim: project.financials?.invoicedNetSantim ?? 0,
      invoicedGrossSantim: project.financials?.contractGrossSantim ?? 0,
      collectedGrossSantim: project.financials?.collectedGrossSantim ?? 0,
      phases: phases.rows.map((p) => ({
        key: p.key,
        status: p.status,
        actualStart: p.actualStart?.at.toDate() ?? null,
        actualEnd: p.actualEnd?.at.toDate() ?? null,
        ...(p.certification === undefined
          ? {}
          : { certification: { result: p.certification.result, attempts: p.certification.attempts ?? 0 } }),
      })),
      settledInvoices: [],
    },
    asOf,
  );

  const risk = assessProjectRisk({
    kpi,
    status: project.status,
    overdueReceivableSantim: 0,
    oldestOverdueDays: null,
    assignedTechnicians: 0,
    expiredCertifications: 0,
    teamRepeatCalloutBps: null,
    daysSinceProgressChange: null,
  });

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/projects">Projects</Link></p>
          <h1>{project.title}</h1>
          <p className="muted">
            {project.clientName} · {project.site?.name} · planned handover{' '}
            <DualDateText value={project.plannedEnd} />
          </p>
        </div>
        <span className="chip">{project.status.replace(/_/g, ' ')}</span>
      </div>

      {risk.flags.length > 0 && (
        <section className="card">
          <h2>Risk</h2>
          <RiskFlagList flags={risk.flags} />
        </section>
      )}

      <ProjectKpiPanel kpi={kpi} />

      {phases.error && <p className="error" role="alert">{phases.error}</p>}
      {phases.rows.length > 0 && <PhaseTracker projectId={project.id} phases={phases.rows} />}

      {inspectionPhase !== undefined && (
        <CertificationPanel projectId={project.id} phase={inspectionPhase} />
      )}

      <ProjectTeam projectId={project.id} technicians={technicians.rows} />
    </>
  );
}
