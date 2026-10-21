/**
 * Project list and creation.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  PROJECT_TYPES,
  isElevatorWork,
  normaliseProjectType,
  projectTypeLabel,
  projectTypeShort,
  typeForTemplate,
  type SelectableProjectType,
} from '../lib/project-kind.js';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { clientChoices, clientOptionLabel, resolveClient } from '../lib/client-choice.js';
import { subscribeContracts } from '../data/contracts.js';
import {
  createProject,
  subscribeProjects,
  updateProject,
  updateProjectStatus,
} from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { DualDateInput, DualDateText } from '../components/DualDateInput.js';
import { DEFAULT_TEMPLATE_KEY, PROJECT_TEMPLATES, projectTemplate } from '../lib/project-templates.js';
import { ProgressBar } from '../components/KpiTile.js';
import { expectedProgressBps } from '../lib/kpi.js';
import { FormPanel } from '../components/FormPanel.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { buildTree, sortTree, type TreeProject } from '../lib/project-tree.js';
import { ReminderEditor } from '../components/ReminderEditor.js';
import type { Client, Contract, DualDate, Project, Reminder } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { StatusChip, StatusSelect } from '../components/StatusSelect.js';
import { ListControls } from '../components/ListControls.js';
import {
  EMPTY_FILTER,
  filterRows,
  sortRows,
  type ColumnSpec,
  type FilterState,
  type SortState,
} from '../lib/table.js';
import { statusLabel } from '../lib/status.js';

export function Projects() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [editing, setEditing] = useState<WithId<Project> | 'new' | null>(null);
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortState>({ key: null, direction: 'asc' });

  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e, { activeOnly: true }), [], 'load clients');
  // Resolved here rather than denormalised onto the project: a contract number
  // copied onto 163 projects goes stale the day one contract is renumbered.
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const contractById = useMemo(
    () => new Map(contracts.rows.map((k) => [k.id, k])),
    [contracts.rows],
  );

  const asOf = useMemo(() => new Date(), []);

  /**
   * Parents with their sub-projects nested under them.
   *
   * A tower is one job commercially and several operationally. Flattened, the
   * page shows five unrelated projects where there is one commitment.
   */
  const columns: ColumnSpec<WithId<Project>>[] = useMemo(
    () => [
      { key: 'title', label: 'Name', value: (p) => p.title },
      { key: 'projectNo', label: 'Number', value: (p) => p.projectNo },
      { key: 'client', label: 'Client', value: (p) => p.clientName, filterable: true },
      // Filterable, so the lift business and the rest can each be looked at
      // alone. Without it a company doing both can only ever see the total.
      {
        key: 'kind',
        label: 'Kind',
        value: (p) => projectTypeShort(p.type),
        filterable: true,
      },
      { key: 'status', label: 'Status', value: (p) => p.status, filterable: true },
      { key: 'city', label: 'City', value: (p) => p.site?.city ?? '', filterable: true },
      { key: 'progress', label: 'Progress', value: (p) => p.progressBps },
      { key: 'plannedEnd', label: 'Planned end', value: (p) => p.plannedEnd.at.toDate() },
      {
        key: 'value',
        label: 'Contract value',
        value: (p) => p.financials?.contractNetSantim ?? 0,
      },
    ],
    [],
  );

  /**
   * Narrowed and ordered BEFORE the tree is built.
   *
   * Filtering afterwards would leave a sub-project whose parent was filtered
   * out floating at the top level, which reads as a separate job.
   */
  const visible = useMemo(() => {
    const narrowed = filterRows(projects.rows, columns, filter, (row, column) =>
      column.key === 'status' ? statusLabel('project', row.status) : String(column.value(row) ?? ''),
    );
    return sortRows(narrowed, columns, sort);
  }, [projects.rows, columns, filter, sort]);

  const tree = useMemo(
    () =>
      sortTree(
        buildTree(
          visible.map<TreeProject & { source: typeof projects.rows[number] }>((p) => ({
            id: p.id,
            projectNo: p.projectNo,
            title: p.title,
            clientName: p.clientName,
            parentProjectId: p.parentProjectId ?? null,
            status: p.status,
            progressBps: p.progressBps,
            contractNetSantim: p.financials?.contractNetSantim ?? 0,
            plannedEnd: p.plannedEnd.at.toDate(),
            inDanger: false,
            source: p,
          })),
          asOf,
        ),
      ),
    [visible, asOf],
  );

  return (
    <>
      <div className="page-head">
        <h1>Projects</h1>
        <div className="page-actions">
          <PrintButton label="Print list" />
          {editable && editing === null && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>New project</button>
          )}
        </div>
      </div>

      <PrintHeader title="Projects" subtitle={`${projects.rows.length} on the books`} />

      {projects.error && <p className="error" role="alert">{projects.error}</p>}

      {editing !== null && user !== null && (
        <ProjectForm
          initial={editing === 'new' ? null : editing}
          clients={clients.rows}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      {projects.rows.length > 0 && (
        <ListControls
          rows={projects.rows}
          shown={visible.length}
          columns={columns}
          filter={filter}
          onFilter={setFilter}
          sort={sort}
          onSort={setSort}
          noun="projects"
        />
      )}

      {projects.loading && <p className="muted">Loading…</p>}
      {!projects.loading && projects.rows.length === 0 && !projects.error && (
        <p className="muted">No projects yet.</p>
      )}

      <div className="project-cards">
        {tree.map(({ project: node, children, rolled, hasChildren }) => {
          const project = node.source;
          const expected = expectedProgressBps(
            project.plannedStart.at.toDate(),
            project.plannedEnd.at.toDate(),
            asOf,
          );
          const behind = project.progressBps < expected;
          return (
            <article key={project.id} className="card project-card">
              <div className="page-head">
                <div>
                  <h2><Link to={`/projects/${project.id}`}>{project.title}</Link></h2>
                  <p className="muted">
                    {project.clientName} ·{' '}
                    {projectTypeShort(project.type)}
                    {/* A lift count belongs on lift work. "0 units" on an
                        office renovation is not a fact about the job, it is
                        the shape of a different job showing through. */}
                    {isElevatorWork(project.type) && (
                      <>
                        {' · '}
                        {project.units?.length ?? 0} unit{project.units?.length === 1 ? '' : 's'}
                      </>
                    )}
                  </p>
                  {/* Which agreement pays for this. A project with no contract
                      is a real state — variations and warranty work — and it
                      says so rather than showing a blank. */}
                  <p className="muted project-contract">
                    {project.contractId === null ? (
                      <span className="chip chip-status-idle">No contract</span>
                    ) : (
                      <>
                        Under{' '}
                        <Link to={`/contracts/${project.contractId}`}>
                          {contractById.get(project.contractId)?.contractNo ?? 'a contract'}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                {editable && user !== null ? <ProjectStatusControl project={project} uid={user.uid} /> : <StatusChip kind="project" value={project.status} />}
              </div>

              <ProgressBar progressBps={project.progressBps} expectedBps={expected} />
              <p className="muted">
                {formatBps(project.progressBps, 0)} built · plan says {formatBps(expected, 0)} by now
                {behind && <span className="warn-text"> · behind schedule</span>}
              </p>

              <dl className="kv compact">
                <dt>Planned end</dt>
                <dd><DualDateText value={project.plannedEnd} /></dd>
                <dt>Contract value</dt>
                <dd>{formatETB(project.financials?.contractGrossSantim ?? 0)}</dd>
              </dl>

              {hasChildren && (
                <div className="subprojects">
                  <p className="family-figures">
                    {children.length} sub-project{children.length === 1 ? '' : 's'} ·{' '}
                    {formatBps(rolled.progressBps, 0)} across the family
                    {rolled.weightedBy === 'value' ? ' weighted by value' : ''} ·{' '}
                    {formatETB(rolled.contractNetSantim)} contracted
                    {rolled.overdue > 0 && (
                      <span className="warn-text"> · {rolled.overdue} past planned end</span>
                    )}
                  </p>
                  <ul className="subproject-list">
                    {children.map((child) => (
                      <li key={child.id}>
                        <Link to={`/projects/${child.id}`}>{child.projectNo} {child.title}</Link>
                        <span className="muted">
                          {formatBps(child.progressBps, 0)} · {formatETB(child.contractNetSantim)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {editable && user !== null && (
                <div className="card-actions">
                  <ProjectStatusControl project={project} uid={user.uid} />
                  <button type="button" onClick={() => setEditing(project)}>Edit</button>
                  <DeleteButton
                    target={{ kind: 'project', id: project.id, name: project.projectNo }}
                  />
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}


/**
 * A status change is a small, frequent action, so it should save in place
 * without opening the full project form and clearly report failure.
 */
function ProjectStatusControl({ project, uid }: { project: WithId<Project>; uid: string }) {
  const [selected, setSelected] = useState<Project['status']>(project.status);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAsyncAction('update project status');

  // Keep the picker aligned with the live Firestore record, including changes
  // made by another manager.
  useEffect(() => {
    setSelected(project.status);
    setSaved(false);
  }, [project.status]);

  async function saveStatus(value: string) {
    const next = value as Project['status'];
    setSelected(next);
    setSaved(false);
    const result = await run(async () => {
      await updateProjectStatus(project.id, next, uid);
      return true;
    });
    if (result !== null) setSaved(true);
  }

  return (
    <div className="field inline project-status-control">
      <label htmlFor={`p-status-${project.id}`}>Status</label>
      <StatusSelect
        compact
        kind="project"
        id={`p-status-${project.id}`}
        value={selected}
        disabled={busy}
        onChange={(value) => void saveStatus(value)}
      />
      {busy && <span className="muted" role="status">Saving…</span>}
      {!busy && saved && <span className="success-text" role="status">Saved</span>}
      {error && <span className="error" role="alert">{error}</span>}
    </div>
  );
}

export function ProjectForm({
  initial,
  clients,
  uid,
  onDone,
}: {
  initial: WithId<Project> | null;
  clients: readonly { id: string; name: string }[];
  uid: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const currentClient = initial === null ? null : { id: initial.clientId, name: initial.clientName };
  const [city, setCity] = useState(initial?.site?.city ?? 'Addis Ababa');
  const [units, setUnits] = useState(initial?.units?.length ?? 1);
  const [templateKey, setTemplateKey] = useState(initial?.templateKey ?? DEFAULT_TEMPLATE_KEY);
  /**
   * The kind of work, which used to be inferred from the template and never
   * shown. A template is a starting point for the STAGES; the kind of work is
   * a fact about the job, and a fact nobody can correct is a fact that stays
   * wrong. Choosing a template still proposes it — see `chooseTemplate`.
   */
  const [type, setType] = useState<SelectableProjectType>(() =>
    initial === null
      ? typeForTemplate(DEFAULT_TEMPLATE_KEY)
      : normaliseProjectType(initial.type),
  );
  /** Once the kind has been set by hand, a template must not overwrite it. */
  const [typeIsProposed, setTypeIsProposed] = useState(initial === null);
  const [parentProjectId, setParentProjectId] = useState(initial?.parentProjectId ?? '');
  const [address, setAddress] = useState(initial?.site?.address ?? '');
  const [reminders, setReminders] = useState<Reminder[]>(initial?.reminders ?? []);
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(initial?.plannedStart ?? null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(initial?.plannedEnd ?? null);
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'planned');
  const { busy, error, run } = useAsyncAction(
    initial === null ? 'create this project' : 'save this project',
  );

  const allProjects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects').rows;
  const template = projectTemplate(templateKey);

  /**
   * Picking a template proposes the matching kind of work, and stops doing so
   * the moment the kind is set by hand. A default that quietly overwrites what
   * somebody chose is worse than no default at all.
   */
  function chooseTemplate(key: string) {
    setTemplateKey(key);
    if (typeIsProposed) setType(typeForTemplate(key));
  }

  /**
   * Projects can nest under other projects. Exclude the current project and
   * its descendants so selecting a parent cannot create a cycle.
   */
  const parentCandidates = allProjects.filter((candidate) => {
    if (candidate.id === initial?.id) return false;
    let ancestor = candidate;
    const visited = new Set<string>();
    while (ancestor.parentProjectId) {
      if (ancestor.parentProjectId === initial?.id) return false;
      if (visited.has(ancestor.parentProjectId)) return false;
      visited.add(ancestor.parentProjectId);
      const next = allProjects.find((project) => project.id === ancestor.parentProjectId);
      if (next === undefined) break;
      ancestor = next;
    }
    return true;
  });

  const ready = title.trim() !== '' && clientId !== '' && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const client = resolveClient(clients, clientId, currentClient);
    if (!ready || client === null) return;

    const input = {
      projectNo: initial?.projectNo ?? `P-${Date.now()}`,
      type,
      title: title.trim(),
      clientId,
      clientName: client.name,
      contractId: initial?.contractId ?? null,
      site: {
        name: title.trim(),
        city,
        ...(address.trim() === '' ? {} : { address: address.trim() }),
      },
      parentProjectId: parentProjectId === '' ? null : parentProjectId,
      reminders,
      // On an edit the existing lifts are kept: they carry per-unit progress,
      // and rebuilding the list from a count would throw that away.
      units:
        initial === null
          ? Array.from({ length: Math.max(1, units) }, (_, i) => ({
              tag: `LIFT-${String(i + 1).padStart(2, '0')}`,
            }))
          : initial.units,
      plannedStart: plannedStart as DualDate,
      plannedEnd: plannedEnd as DualDate,
      actualStart: initial?.actualStart ?? null,
      actualEnd: initial?.actualEnd ?? null,
      // An edit must not reset a project somebody paused or completed.
      status,
    };

    const result = await run(async () => {
      if (initial === null) {
        await createProject(input, uid, {
          plannedStart: plannedStart as DualDate,
          plannedEnd: plannedEnd as DualDate,
          templateKey,
        });
      } else {
        // The stages are NOT rebuilt from the template on an edit — they carry
        // ticked checkpoints and recorded dates. Stages are changed on the
        // project page, where the consequences are visible.
        await updateProject(initial.id, input, uid);
      }
      return true;
    });
    if (result !== null) onDone();
  }

  return (
    <FormPanel
      title={initial === null ? 'New project' : `Edit ${initial.title}`}
      description={
        initial === null
          ? 'Pick the kind of job and its stages are created for you. Every stage can be renamed, reweighted, reordered or deleted afterwards — the template is a starting point, not a rule.'
          : 'The stages are not touched by this form — they carry ticked checkpoints and recorded dates. Change them on the project page.'
      }
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="p-client">Client <span className="req" aria-hidden="true">*</span></label>
            <select id="p-client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clientChoices(clients, currentClient).map((c) => (
                <option key={c.id} value={c.id}>{clientOptionLabel(c)}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="p-title">Title <span className="req" aria-hidden="true">*</span></label>
            <input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Bole Tower — 3 passenger lifts" />
          </div>

          <div className="field">
            <label htmlFor="p-city">City</label>
            <input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="p-address">Site address</label>
            <input id="p-address" value={address}
              placeholder="Africa Avenue, Getu Commercial Centre"
              onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="p-parent">Sub-project of</label>
            <select id="p-parent" value={parentProjectId}
              onChange={(e) => setParentProjectId(e.target.value)}>
              <option value="">Not a sub-project</option>
              {parentCandidates.map((p) => (
                <option key={p.id} value={p.id}>{p.projectNo} · {p.title}</option>
              ))}
            </select>
            <p className="hint">
              A tower is one job commercially and several operationally — per block, per lift, per
              phase. The parent holds the commitment; this holds the work.
            </p>
          </div>

          <div className="field">
            <label htmlFor="p-template">Kind of job</label>
            <select id="p-template" value={templateKey} onChange={(e) => chooseTemplate(e.target.value)}>
              {PROJECT_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            </select>
            <p className="hint">{template.description}</p>
          </div>

          <div className="field">
            <label htmlFor="p-type">Kind of work</label>
            <select
              id="p-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as SelectableProjectType);
                setTypeIsProposed(false);
              }}
            >
              {PROJECT_TYPES.map((t) => (
                <option key={t} value={t}>{projectTypeLabel(t)}</option>
              ))}
            </select>
            <p className="hint">
              {typeIsProposed
                ? 'Taken from the kind of job above. Change it if this is something else.'
                : 'What the reports count this job as. Lift work and other work are reported both together and apart.'}
            </p>
          </div>

          <div className="field">
            <label htmlFor="p-status">Project status</label>
            <StatusSelect
              kind="project"
              id="p-status"
              value={status}
              onChange={(value) => setStatus(value as Project['status'])}
            />
          </div>

          {/* Asked only where there are lifts to count. On a renovation the
              field has no answer, and a required-looking box with no answer is
              how a form teaches people to type something untrue. */}
          {initial === null && isElevatorWork(type) && (
            <div className="field">
              <label htmlFor="p-units">Units</label>
              <input id="p-units" type="number" min={1} value={units}
                onChange={(e) => setUnits(Number(e.target.value) || 1)} />
              <p className="hint">How many lifts this project puts in.</p>
            </div>
          )}
        </div>

        <div className="form-grid dates">
          <DualDateInput label="Planned start" value={plannedStart} onChange={setPlannedStart} required />
          <DualDateInput label="Planned end" value={plannedEnd} onChange={setPlannedEnd} required />
        </div>

        <details className="stage-preview">
          <summary>
            Stages that will be created ({template.stages.length})
          </summary>
          <p className="hint">
            Each stage records who has to move for it to finish. A project stalled in
            customs and one stalled because the crew has not mobilised need different
            interventions, so they are tracked apart. Payment milestones are attached
            to stages on the contract's payment schedule. All of this is editable
            once the project exists.
          </p>
          <ol className="stage-list">
            {template.stages.map((stage) => (
              <li key={stage.key}>
                <div>
                  <strong>{stage.name}</strong>
                  <span className="muted"> · {(stage.weightBps / 100).toFixed(0)}%</span>
                  {stage.commonlyGatesPayment && (
                    <span className="chip chip-ok stage-pay">payment</span>
                  )}
                </div>
                <p className="muted">{stage.description}</p>
                <span className={`chip owner-${stage.owner}`}>
                  {stage.owner === 'us' ? 'our crew' : stage.owner}
                </span>
              </li>
            ))}
          </ol>
        </details>

        <ReminderEditor
          reminders={reminders}
          onChange={setReminders}
          sourceLabel={title.trim() === '' ? 'This project' : title.trim()}
        />

        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? (initial === null ? 'Creating…' : 'Saving…') : initial === null ? 'Create project' : 'Save changes'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
