/**
 * Project detail: phases, certification, team and live KPIs.
 *
 * The KPIs here are computed from what is actually stored — phase progress,
 * assignments, the contract — rather than from a snapshot, so the page never
 * shows a figure the underlying records do not support.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getProject, subscribePhases, subscribeProjects, updateProjectStatus } from '../data/projects.js';
import { subscribeInvoices } from '../data/invoices.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { RelatedList, type RelatedItem } from '../components/RelatedList.js';
import { StatusChip, StatusSelect } from '../components/StatusSelect.js';
import { formatETB } from '../lib/money.js';
import { ProjectForm } from './Projects.js';
import { UnitForm } from './Units.js';
import { getPaymentStagesForProject, subscribeContracts } from '../data/contracts.js';
import { subscribeUnits, updateUnit } from '../data/units.js';
import { subscribeClients } from '../data/clients.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { LinkPicker } from '../components/LinkPicker.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { computeProjectKpis } from '../lib/kpi.js';
import { assessProjectRisk } from '../lib/risk.js';
import { rollUpProgress } from '../lib/phases.js';
import { PhaseTracker } from '../components/PhaseTracker.js';
import { StageManager } from '../components/StageManager.js';
import { CertificationPanel } from '../components/CertificationPanel.js';
import { ProjectTeam } from '../components/ProjectTeam.js';
import { RiskFlagList } from '../components/RiskAlerts.js';
import { ProjectKpiPanel } from './ProjectKpis.js';
import { getKpiDefinitions, getKpiTargets } from '../data/config.js';
import { DEFAULT_KPI_DEFINITIONS, type KpiDefinition } from '../lib/kpi-definitions.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DualDateText } from '../components/DualDateInput.js';
import { isElevatorWork, projectTypeLabel, projectTypeShort } from '../lib/project-kind.js';
import { describeFleet, describeMake, describeSpec } from '../lib/lift-spec.js';
import type { Client, Contract, ElevatorUnit, Invoice, KpiTargets, Project, ProjectPhase, Technician } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const { busy: statusSaving, error: statusError, run: saveStatus } = useAsyncAction('update project status');
  const { busy: unitStatusSaving, error: unitStatusError, run: saveUnitStatus } = useAsyncAction('update lift status');
  const [project, setProject] = useState<WithId<Project> | null>(null);
  const [kpiTargets, setKpiTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS });
  const [kpiDefinitions, setKpiDefinitions] = useState<KpiDefinition[]>(DEFAULT_KPI_DEFINITIONS);
  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Bumped after a link is changed. The project is fetched once rather than
   * subscribed, so without this the page would keep showing the old contract
   * until somebody navigated away and back.
   */
  const [reloadAt, setReloadAt] = useState(0);
  const reload = () => setReloadAt((n) => n + 1);
  const navigate = useNavigate();
  /** The form open on this page, if any: this project, or one of the records listed on it. */
  const [editing, setEditing] = useState<
    { kind: 'project'; row: WithId<Project> } | { kind: 'unit'; row: WithId<ElevatorUnit> } | null
  >(null);

  const phases = useCollection<ProjectPhase>(
    (d, e) => subscribePhases(projectId ?? '', d, e),
    [projectId],
    'load the project phases',
  );
  // The two ends of the link this project sits in the middle of: the contract
  // that pays for it, and the lifts it puts in. See lib/scope.ts.
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const allProjects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const invoices = useCollection<Invoice>(
    (d, e) => subscribeInvoices(d, e, { projectId: projectId ?? '' }),
    [projectId],
    'load invoices',
  );

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
    let cancelled = false;
    void Promise.all([getKpiTargets(), getKpiDefinitions()]).then(([targets, definitions]) => {
      if (cancelled) return;
      setKpiTargets(targets);
      setKpiDefinitions(definitions);
    }).catch(() => { /* use shipped defaults if KPI settings cannot be read */ });
    return () => { cancelled = true; };
  }, []);

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
  }, [projectId, reloadAt]);

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
          {editable && user !== null ? (
            <div className="field inline-field no-print">
              <label htmlFor="project-detail-status">Status</label>
              <StatusSelect
                compact
                kind="project"
                id="project-detail-status"
                value={project.status}
                disabled={statusSaving}
                onChange={(value) => {
                  void saveStatus(async () => {
                    await updateProjectStatus(project.id, value as Project['status'], user.uid);
                    reload();
                    return true;
                  });
                }}
              />
            </div>
          ) : (
            <span className="chip">{project.status.replace(/_/g, ' ')}</span>
          )}
          {statusSaving && <span className="muted" role="status">Saving status…</span>}
          {statusError && <p className="error no-print" role="alert">{statusError}</p>}
      {unitStatusError && <p className="error no-print" role="alert">{unitStatusError}</p>}
          {editable && user !== null && (
            <>
              <button type="button" className="no-print" onClick={() => setEditing({ kind: 'project', row: project })}>
                Edit project
              </button>
              <DeleteButton
                target={{ kind: 'project', id: project.id, name: project.projectNo }}
                onDeleted={() => navigate('/projects')}
              />
            </>
          )}
        </div>
      </div>

      {editing !== null && user !== null && (
        <>
          {editing.kind === 'project' && (
            <ProjectForm
              initial={editing.row}
              clients={clients.rows}
              uid={user.uid}
              onDone={() => {
                setEditing(null);
                reload();
              }}
            />
          )}
          {editing.kind === 'unit' && <UnitForm initial={editing.row} uid={user.uid} onDone={() => setEditing(null)} />}
        </>
      )}

      <ProjectLinks
        project={project}
        parentProject={allProjects.rows.find((p) => p.id === project.parentProjectId) ?? null}
        contract={contracts.rows.find((k) => k.id === project.contractId) ?? null}
        clients={clients.rows}
        allContracts={contracts.rows}
        uid={user?.uid ?? null}
        editable={editable}
        onChanged={reload}
      />

      <ProjectRelated
        project={project}
        units={units.rows.filter((u) => u.installedByProjectId === project.id)}
        subProjects={allProjects.rows.filter((p) => p.parentProjectId === project.id)}
        invoices={invoices.rows}
        editable={editable && user !== null}
        uid={user?.uid ?? null}
        canInvoices={can(role, 'manageInvoices')}
        projectStatusSaving={statusSaving}
        onProjectStatusChange={(projectId, nextStatus) => {
          if (user === null) return;
          void saveStatus(async () => {
            await updateProjectStatus(projectId, nextStatus, user.uid);
            reload();
            return true;
          });
        }}
        unitStatusSaving={unitStatusSaving}
        onUnitStatusChange={(unitId, nextStatus) => {
          if (user === null) return;
          void saveUnitStatus(async () => {
            await updateUnit(unitId, { status: nextStatus }, user.uid);
            reload();
            return true;
          });
        }}
        loading={{ units: units.loading, children: allProjects.loading, invoices: invoices.loading }}
        onEditUnit={(row) => setEditing({ kind: 'unit', row })}
        onEditProject={(row) => setEditing({ kind: 'project', row })}
      />

      {risk.flags.length > 0 && (
        <section className="card">
          <h2>Risk</h2>
          <RiskFlagList flags={risk.flags} />
        </section>
      )}

      <section className="project-performance" aria-label="Project performance indicators">
        <h2>Project performance</h2>
        <ProjectKpiPanel kpi={kpi} targets={kpiTargets} definitions={kpiDefinitions} />
      </section>

      {phases.error && <p className="error" role="alert">{phases.error}</p>}
      {phases.rows.length > 0 && <PhaseTracker projectId={project.id} phases={phases.rows} />}
      <StageManager projectId={project.id} phases={phases.rows} paymentsByPhase={paymentsByPhase} contractId={project.contractId} />

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
  parentProject,
  contract,
  clients,
  allContracts,
  uid,
  editable,
  onChanged,
}: {
  project: WithId<Project>;
  parentProject: WithId<Project> | null;
  contract: WithId<Contract> | null;
  clients: readonly WithId<Client>[];
  allContracts: readonly WithId<Contract>[];
  uid: string | null;
  editable: boolean;
  onChanged: () => void;
}) {
  return (
    <section className="card link-panel">
      <div className="link-half">
        <h2>Client &amp; project hierarchy</h2>
        <p className="link-title">
          <Link to={`/clients/${project.clientId}`}>{project.clientName}</Link>
          <LinkPicker
            kind="project.client"
            recordId={project.id}
            currentId={project.clientId}
            currentLabel={project.clientName}
            options={clients.map((client) => ({ id: client.id, label: client.name }))}
            uid={uid}
            editable={editable}
            onDone={onChanged}
          />
        </p>
        <p className="muted">
          {parentProject === null ? (
            'Top-level project'
          ) : (
            <>Sub-project of <Link to={`/projects/${parentProject.id}`}>{parentProject.title}</Link></>
          )}
          {editable && ' · Change the parent in Edit project.'}
        </p>
      </div>

      <div className="link-half">
        <h2>Contract</h2>
        {contract === null ? (
          <p className="muted">
            {project.contractId === null
              ? 'This project is not under a contract. Variations and warranty work often are not.'
              : 'The contract this project names could not be found. It may have been deleted.'}{' '}
            <LinkPicker
              kind="project.contract"
              recordId={project.id}
              currentId={project.contractId}
              currentLabel={null}
              options={allContracts.map((item) => ({ id: item.id, label: item.contractNo, hint: item.title }))}
              uid={uid}
              editable={editable}
              onDone={onChanged}
            />
          </p>
        ) : (
          <>
            <p className="link-title">
              <Link to={`/contracts/${contract.id}`}>{contract.contractNo}</Link>
              <LinkPicker
                kind="project.contract"
                recordId={project.id}
                currentId={project.contractId}
                currentLabel={contract.contractNo}
                options={allContracts.map((item) => ({ id: item.id, label: item.contractNo, hint: item.title }))}
                uid={uid}
                editable={editable}
                onDone={onChanged}
              />
            </p>
            <p className="muted">{contract.title}</p>
          </>
        )}
      </div>
    </section>
  );
}

function ProjectRelated({
  project,
  units,
  subProjects,
  invoices,
  editable,
  uid,
  canInvoices,
  projectStatusSaving,
  onProjectStatusChange,
  unitStatusSaving,
  onUnitStatusChange,
  loading,
  onEditUnit,
  onEditProject,
}: {
  project: WithId<Project>;
  units: readonly WithId<ElevatorUnit>[];
  subProjects: readonly WithId<Project>[];
  invoices: readonly WithId<Invoice>[];
  editable: boolean;
  uid: string | null;
  canInvoices: boolean;
  projectStatusSaving: boolean;
  onProjectStatusChange: (projectId: string, status: Project['status']) => void;
  unitStatusSaving: boolean;
  onUnitStatusChange: (unitId: string, status: ElevatorUnit['status']) => void;
  loading: { units: boolean; children: boolean; invoices: boolean };
  onEditUnit: (row: WithId<ElevatorUnit>) => void;
  onEditProject: (row: WithId<Project>) => void;
}) {
  const fleet = describeFleet(units.map((unit) => ({ tag: unit.tag, spec: unit })));

  const unitItems: RelatedItem[] = units.map((unit) => ({
    key: unit.id,
    to: `/units/${unit.id}`,
    title: unit.tag,
    detail: [
      unit.unitCode,
      describeMake(unit),
      describeSpec(unit),
    ].filter((part): part is string => part !== null && part !== '').join(' · '),
    meta: editable && uid !== null ? (
      <select
        aria-label={`Status for ${unit.tag}`}
        value={unit.status}
        disabled={unitStatusSaving}
        onChange={(event) => onUnitStatusChange(unit.id, event.target.value as ElevatorUnit['status'])}
      >
        {(['under_installation', 'in_service', 'out_of_service', 'decommissioned'] as ElevatorUnit['status'][]).map((value) => (
          <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
        ))}
      </select>
    ) : <span className="chip no-caps">{unit.status.replace(/_/g, ' ')}</span>,
    ...(editable ? { onEdit: () => onEditUnit(unit) } : {}),
    ...(editable
      ? { deleteTarget: { kind: 'unit' as const, id: unit.id, name: unit.tag, unit: { tag: unit.tag, clientId: unit.clientId } } }
      : {}),
  }));

  const childItems: RelatedItem[] = subProjects.map((child) => ({
    key: child.id,
    to: `/projects/${child.id}`,
    title: child.title,
    detail: `${child.projectNo} · ${child.site?.name ?? '—'}`,
    meta: editable && uid !== null ? (
      <div className="field inline">
        <label className="sr-only" htmlFor={`child-status-${child.id}`}>Status for {child.title}</label>
        <StatusSelect
          kind="project"
          id={`child-status-${child.id}`}
          value={child.status}
          disabled={projectStatusSaving}
          compact
          onChange={(value) => onProjectStatusChange(child.id, value as Project['status'])}
        />
      </div>
    ) : <StatusChip kind="project" value={child.status} />,
    ...(editable ? { onEdit: () => onEditProject(child) } : {}),
    ...(editable ? { deleteTarget: { kind: 'project' as const, id: child.id, name: child.projectNo } } : {}),
  }));

  const invoiceItems: RelatedItem[] = [...invoices]
    .sort((a, b) => b.issueDate.at.toMillis() - a.issueDate.at.toMillis())
    .map((invoice) => ({
      key: invoice.id,
      to: '/finance/invoices',
      title: invoice.invoiceNo === '' ? 'Draft invoice' : invoice.invoiceNo,
      detail: (
        <>
          {formatETB(invoice.grossSantim)} with VAT · issued <DualDateText value={invoice.issueDate} />
        </>
      ),
      meta: <span className="chip no-caps">{invoice.status.replace(/_/g, ' ')}</span>,
      ...(canInvoices
        ? {
            deleteTarget: {
              kind: 'invoice' as const,
              id: invoice.id,
              name: invoice.invoiceNo === '' ? 'this draft' : invoice.invoiceNo,
              status: invoice.status,
            },
          }
        : {}),
    }));

  return (
    <>
      <RelatedList
        title="Lifts on this project"
        items={unitItems}
        loading={loading.units}
        hint={fleet}
        empty={
          isElevatorWork(project.type) ? (
            <>
              No lift on the register names this project as the one that installed it.{' '}
              <Link to="/units">Open the register</Link> to link them.
            </>
          ) : (
            <>
              {projectTypeLabel(project.type)} — no lift is expected on this job. If one is involved after
              all, link it from the <Link to="/units">lift register</Link>.
            </>
          )
        }
      />
      {(subProjects.length > 0 || loading.children) && (
        <RelatedList title="Sub-projects" items={childItems} loading={loading.children} empty="No sub-projects." />
      )}
      <RelatedList
        title="Invoices"
        items={invoiceItems}
        loading={loading.invoices}
        empty="No invoice has been raised against this project."
      />
    </>
  );
}
