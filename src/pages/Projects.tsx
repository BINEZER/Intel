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
import { toTimestamp } from '../firebase.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
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
import { DateRangeFilter, EMPTY_DATE_RANGE, inDateRange, type DateRange } from '../components/DateRangeFilter.js';
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
  const [search, setSearch] = useState('');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e, { activeOnly: true }), [], 'load clients');
  const rows = projects.rows.filter((p) => {
    const q = search.trim().toLowerCase();
    return !q || [p.projectNo, p.title, p.clientName, p.site?.name, p.site?.city]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  });

  return <>
    <div className="page-head">
      <div><h1>Projects</h1><p className="muted">All elevator installation projects in one place.</p></div>
      {editable && user && editing === null && <button type="button" className="primary" onClick={() => setEditing('new')}>New project</button>}
    </div>
    {projects.error && <p className="error" role="alert">{projects.error}</p>}
    {editing !== null && user && <ProjectForm initial={editing === 'new' ? null : editing} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />}
    <section className="card project-list-card">
      <div className="section-heading"><div><h2>Project register</h2><p className="muted">{projects.rows.length} projects</p></div>
        <label className="project-search"><span className="visually-hidden">Search projects</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by project, client or site…" />
        </label>
      </div>
      {projects.loading ? <p className="muted">Loading projects…</p> : rows.length === 0 ?
        <p className="muted">{projects.rows.length === 0 ? 'No projects yet. Add the first project when ready.' : 'No matching projects.'}</p> :
        <div className="project-table-wrap"><table className="data-table project-overview-table">
          <thead><tr><th>Project</th><th>Client / site</th><th>Current phase</th><th>Progress</th><th>Status</th><th>Planned completion</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td><Link to={`/projects/${p.id}`} className="project-name-link"><strong>{p.title}</strong><small>{p.projectNo}</small></Link></td>
            <td>{p.clientName}<small>{p.site?.name}{p.site?.city ? ` · ${p.site.city}` : ''}</small></td>
            <td>{p.currentStage?.name ?? 'Not started'}</td>
            <td><div className="mini-progress"><span style={{width:`${Math.max(0,Math.min(100,p.progressBps/100))}%`}} /></div><small>{Math.round(p.progressBps/100)}%</small></td>
            <td><span className={`project-status status-${p.status}`}>{p.status.replace(/_/g,' ')}</span></td>
            <td>{p.plannedEnd?.at?.toDate().toLocaleDateString() ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </>;
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
  const [projectNo, setProjectNo] = useState(initial?.projectNo ?? `P-${Date.now()}`);
  const [parentProjectId, setParentProjectId] = useState(initial?.parentProjectId ?? '');
  const [contractId, setContractId] = useState(initial?.contractId ?? '');
  const [address, setAddress] = useState(initial?.site?.address ?? '');
  const [reminders, setReminders] = useState<Reminder[]>(initial?.reminders ?? []);
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(initial?.plannedStart ?? null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(initial?.plannedEnd ?? null);
  const [startDateEdited, setStartDateEdited] = useState(initial !== null);
  const [endDateEdited, setEndDateEdited] = useState(initial !== null);
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'planned');
  const { busy, error, run } = useAsyncAction(
    initial === null ? 'create this project' : 'save this project',
  );

  const allProjects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects').rows;
  const contractRows = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts').rows;
  const template = projectTemplate(templateKey);

  function chooseContract(nextId: string) {
    setContractId(nextId);
    if (initial !== null || nextId === '') return;
    const agreement = contractRows.find((item) => item.id === nextId);
    if (agreement === undefined) return;
    if (!startDateEdited) setPlannedStart(agreement.signedDate);
    if (!endDateEdited) {
      const end = new Date(agreement.signedDate.at.toDate());
      end.setUTCDate(end.getUTCDate() + 150);
      setPlannedEnd(dualDateFromGregorian(end, toTimestamp, agreement.signedDate.enteredIn));
    }
  }

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

    const normalizedProjectNo = projectNo.trim();
    if (allProjects.some((project) => project.id !== initial?.id && project.projectNo.trim().toLocaleLowerCase() === normalizedProjectNo.toLocaleLowerCase())) {
      await run(async () => { throw new Error('That project number is already in use. Choose a unique number.'); });
      return;
    }

    const input = {
      projectNo: normalizedProjectNo,
      type,
      title: title.trim(),
      clientId,
      clientName: client.name,
      contractId: contractId === '' ? null : contractId,
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
            <select id="p-client" required value={clientId} onChange={(e) => {
              const nextClientId = e.target.value;
              setClientId(nextClientId);
              if (contractId !== '' && !contractRows.some((item) => item.id === contractId && item.clientId === nextClientId)) {
                setContractId('');
                if (!startDateEdited) setPlannedStart(null);
                if (!endDateEdited) setPlannedEnd(null);
              }
            }}>
              <option value="">Select a client…</option>
              {clientChoices(clients, currentClient).map((c) => (
                <option key={c.id} value={c.id}>{clientOptionLabel(c)}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="p-contract">Agreement / contract</label>
            <select id="p-contract" value={contractId} onChange={(e) => chooseContract(e.target.value)}>
              <option value="">No linked contract</option>
              {contractRows.filter((k) => k.clientId === clientId).map((k) => (
                <option key={k.id} value={k.id}>{k.contractNo} · {k.title}</option>
              ))}
            </select>
            <p className="hint">Choose the signed agreement to link this project to the client commitment.</p>
          </div>

          <div className="field">
            <label htmlFor="p-number">Project number / code <span className="req" aria-hidden="true">*</span></label>
            <input id="p-number" required value={projectNo} onChange={(e) => setProjectNo(e.target.value)}
              placeholder="P-2026-001" />
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
          <DualDateInput label="Planned start" value={plannedStart} onChange={(value) => { setStartDateEdited(true); setPlannedStart(value); }} required />
          <DualDateInput label="Planned end" value={plannedEnd} onChange={(value) => { setEndDateEdited(true); setPlannedEnd(value); }} required />
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
