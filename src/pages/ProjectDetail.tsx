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
import { getPaymentStagesForProject, subscribeContracts } from '../data/contracts.js';
import { subscribeUnits } from '../data/units.js';
import { subscribePrograms } from '../data/programs.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { useCollection } from '../data/useCollection.js';
import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import { rollUpProgress } from '../lib/phases.js';
import { PhaseTracker } from '../components/PhaseTracker.js';
import { StageManager } from '../components/StageManager.js';
import { CertificationPanel } from '../components/CertificationPanel.js';
import { ProjectTeam } from '../components/ProjectTeam.js';
import { RiskFlagList } from '../components/RiskAlerts.js';
import { ProjectKpiPanel } from './ProjectKpis.js';
import { DualDateText } from '../components/DualDateInput.js';
import { isElevatorWork, projectTypeLabel, projectTypeShort } from '../lib/project-kind.js';
import { describeFleet, describeMake, describeSpec } from '../lib/lift-spec.js';
import type { Contract, ElevatorUnit, Program, Project, ProjectPhase, Technician } from '../lib/schema.js';
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
  // The two ends of the link this project sits in the middle of: the contract
  // that pays for it, and the lifts it puts in. See lib/scope.ts.
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  // The commitment this job is one part of. A tower is one programme and four
  // projects, and from a project you have to be able to get back up to it.
  const programs = useCollection<Program>((d, e) => subscribePrograms(d, e), [], 'load programmes');

  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e, { activeOnly: true }),
    [],
    'load technicians',
  );

  // Which stages release money. Loaded once rather than subscribed: it changes
  // when a contract is signed, not while someone is looking at the tracker, and
  // it exists to stop a stage being deleted out from under a payment.
  const [paymentsByPhase, setPaymentsByPhase] = useState<ReadonlyMap<string, string[]>>(new Map());

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;
    getPaymentStagesForProject(projectId)
      .then((found) => { if (!cancelled) setPaymentsByPhase(found); })
      .catch(() => { /* the tracker still works; deletion just loses its guard */ });
    return () => { cancelled = true; };
  }, [projectId]);

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
        <div className="chip-row">
          <Link className="button-link no-print" to={`/projects/${project.id}/report`}>
            Full report
          </Link>
          {/* The kind of work, said out loud. An office renovation and a lift
              installation looked identical here, which is how one gets read as
              the other in a meeting. */}
          <span className="chip">{projectTypeShort(project.type)}</span>
          <span className="chip">{project.status.replace(/_/g, ' ')}</span>
        </div>
      </div>

      <ProjectLinks
        project={project}
        contract={contracts.rows.find((k) => k.id === project.contractId) ?? null}
        program={programs.rows.find((g) => g.id === project.programId) ?? null}
        units={units.rows.filter((u) => u.installedByProjectId === project.id)}
      />

      {risk.flags.length > 0 && (
        <section className="card">
          <h2>Risk</h2>
          <RiskFlagList flags={risk.flags} />
        </section>
      )}

      <ProjectKpiPanel kpi={kpi} />

      {phases.error && <p className="error" role="alert">{phases.error}</p>}
      {phases.rows.length > 0 && <PhaseTracker projectId={project.id} phases={phases.rows} />}
      {phases.rows.length > 0 && (
        <StageManager projectId={project.id} phases={phases.rows} paymentsByPhase={paymentsByPhase} />
      )}

      {inspectionPhase !== undefined && (
        <CertificationPanel projectId={project.id} phase={inspectionPhase} />
      )}

      <ProjectTeam projectId={project.id} technicians={technicians.rows} />
    </>
  );
}

/**
 * Where this project sits: the contract above it, the lifts below it.
 *
 * Both directions on one panel, because the questions arrive together — "who
 * agreed to pay for this" and "which machines come out of it" — and answering
 * one of them by making somebody search the other page is not answering it.
 */
function ProjectLinks({
  project,
  contract,
  program,
  units,
}: {
  project: WithId<Project>;
  contract: WithId<Contract> | null;
  program: WithId<Program> | null;
  units: readonly WithId<ElevatorUnit>[];
}) {
  return (
    <section className="card link-panel">
      <div className="link-half">
        <h2>Client & programme</h2>
        <p className="link-title">
          <Link to={`/clients?client=${project.clientId}`}>{project.clientName}</Link>
        </p>
        {program === null ? (
          <p className="muted">
            {project.programId === null || project.programId === undefined
              ? 'Stand-alone project — not part of a programme. A site with several lifts is usually one programme and one project per lift.'
              : 'The programme this project names could not be found. It may have been deleted.'}
          </p>
        ) : (
          <>
            <p className="muted">
              <Link to={`/programs/${program.id}`}>{program.name}</Link>
            </p>
            <p className="muted mono">{program.programNo}</p>
            <p className="muted">
              The programme's progress is the average across its projects — weighted by contract
              value where they are on separate agreements, and a plain average where they share
              one, as the lifts of a single building do.
            </p>
          </>
        )}
      </div>

      <div className="link-half">
        <h2>Contract</h2>
        {contract === null ? (
          <p className="muted">
            {project.contractId === null
              ? 'This project is not under a contract. Variations and warranty work often are not — but if this one should be, set it on the project.'
              : 'The contract this project names could not be found. It may have been deleted.'}
          </p>
        ) : (
          <>
            <p className="link-title">
              <Link to={`/contracts?contract=${contract.id}`}>{contract.title}</Link>
            </p>
            <p className="muted mono">{contract.contractNo}</p>
            <p className="muted">
              A contract can cover several projects across several sites; this is one of them.
            </p>
          </>
        )}
      </div>

      <div className="link-half">
        <h2>Lifts on this project</h2>
        {units.length === 0 ? (
          /*
           * What "no lifts" MEANS depends on the work. On a lift job it is a
           * gap to go and fill; on a renovation it is simply the right answer,
           * and sending somebody to the lift register to fix it is sending them
           * to fix something that is not broken.
           */
          isElevatorWork(project.type) ? (
            <p className="muted">
              No lift on the register names this project as the one that installed it.{' '}
              <Link to="/units">Open the register</Link> to link them.
            </p>
          ) : (
            <p className="muted">
              {projectTypeLabel(project.type)} — no lift is expected on this job. If one is
              involved after all, link it from the <Link to="/units">lift register</Link>.
            </p>
          )
        ) : (
          <>
            {/* One line for the whole set, because four identical lifts in a
                shaft bank is the common case and the same spec four times is
                noise where "4 × 630 kg · 8 stops" is information. */}
            {describeFleet(units.map((unit) => ({ tag: unit.tag, spec: unit }))) !== null && (
              <p className="muted">
                {describeFleet(units.map((unit) => ({ tag: unit.tag, spec: unit })))}
              </p>
            )}
            <ul className="link-units">
              {units.map((unit) => (
                <li key={unit.id}>
                  <Link to={`/units/${unit.id}`}>{unit.tag}</Link>
                  <span className="muted">
                    {unit.unitCode}
                    {describeMake(unit) === null ? '' : ` · ${describeMake(unit)}`} ·{' '}
                    {unit.status.replace(/_/g, ' ')}
                  </span>
                  {/* The specification, read from the LIFT and never from a
                      copy on the project — see schema.ts. */}
                  {describeSpec(unit) !== null && (
                    <span className="muted lift-spec">{describeSpec(unit)}</span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
