/**
 * Project list and creation.
 */

import { useMemo, useState, type FormEvent } from 'react';
import {
  type ProjectType,
} from '../lib/project-kind.js';
import { Link } from 'react-router-dom';
import { toTimestamp } from '../firebase.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  createProject,
  subscribeProjects,
  updateProject,
  updateProjectStatus,
} from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { DEFAULT_TEMPLATE_KEY, projectTemplate } from '../lib/project-templates.js';
import { FormPanel } from '../components/FormPanel.js';
import type { DualDate, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { ListControls } from '../components/ListControls.js';

export function Projects() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [editing, setEditing] = useState<WithId<Project> | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const rows = projects.rows.filter((p) => {
    const q = search.trim().toLowerCase();
    return !q || [p.projectNo, p.title, p.clientName, p.site?.address]
      .some((v) => String(v ?? '').toLowerCase().includes(q));
  });

  return <>
    <div className="page-head">
      <div><h1>Projects</h1><p className="muted">All elevator installation projects in one place.</p></div>
      {editable && user && editing === null && <button type="button" className="primary" onClick={() => setEditing('new')}>New project</button>}
    </div>
    {projects.error && <p className="error" role="alert">{projects.error}</p>}
    {editing !== null && user && <ProjectForm initial={editing === 'new' ? null : editing} uid={user.uid} onDone={() => setEditing(null)} />}
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
            <td>{p.clientName}<small>{p.site?.address ?? '—'}</small></td>
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
  uid,
  onDone,
}: {
  initial: WithId<Project> | null;
  uid: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [clientName, setClientName] = useState(initial?.clientName ?? '');
  const [units, setUnits] = useState(initial?.units?.length ?? 1);
  const templateKey = initial?.templateKey ?? DEFAULT_TEMPLATE_KEY;
  const type: ProjectType = initial?.type ?? 'elevator';
  const [projectNo, setProjectNo] = useState(initial?.projectNo ?? `P-${Date.now()}`);
  const [parentProjectId, setParentProjectId] = useState(initial?.parentProjectId ?? '');
  const [agreementReference, setAgreementReference] = useState(initial?.agreementReference ?? '');
  const [address, setAddress] = useState(initial?.site?.address ?? '');
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(initial?.plannedStart ?? null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(initial?.plannedEnd ?? null);
  const [startDateEdited, setStartDateEdited] = useState(initial !== null);
  const [endDateEdited, setEndDateEdited] = useState(initial !== null);
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'planned');
  const { busy, error, run } = useAsyncAction(
    initial === null ? 'create this project' : 'save this project',
  );

  const allProjects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects').rows;
  const template = projectTemplate(templateKey);

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

  const ready = title.trim() !== '' && clientName.trim() !== '' && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const normalizedClient = clientName.trim();
    const normalizedClientId = initial?.clientId || `manual-${normalizedClient.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const normalizedProjectNo = projectNo.trim();
    if (allProjects.some((project) => project.id !== initial?.id && project.projectNo.trim().toLocaleLowerCase() === normalizedProjectNo.toLocaleLowerCase())) {
      await run(async () => { throw new Error('That project number is already in use. Choose a unique number.'); });
      return;
    }

    const input = {
      projectNo: normalizedProjectNo,
      type,
      title: title.trim(),
      clientId: normalizedClientId,
      clientName: normalizedClient,
      contractId: null,
      agreementReference: agreementReference.trim(),
      site: {
        name: title.trim(),
        city: '',
        ...(address.trim() === '' ? {} : { address: address.trim() }),
      },
      parentProjectId: parentProjectId === '' ? null : parentProjectId,
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
      description={initial === null ? 'Enter the project details and dates.' : 'Update the project details and dates.'}
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

          {initial === null && (
            <div className="field">
              <label htmlFor="p-units">Number of elevators</label>
              <input id="p-units" type="number" min={1} value={units} onChange={(e) => setUnits(Number(e.target.value) || 1)} />
            </div>
          )}
        </div>
          )}
        </div>

        <div className="form-grid dates">
          <DualDateInput label="Planned start" value={plannedStart} onChange={(value) => { setStartDateEdited(true); setPlannedStart(value); }} required />
          <DualDateInput label="Planned end" value={plannedEnd} onChange={(value) => { setEndDateEdited(true); setPlannedEnd(value); }} required />
        </div>

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
}          <div className="field">
            <label htmlFor="p-client">Client <span className="req" aria-hidden="true">*</span></label>
            <input id="p-client" required value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Enter client name" />
          </div>

          <div className="field">
            <label htmlFor="p-agreement">Agreement / reference</label>
            <input id="p-agreement" value={agreementReference} onChange={(e) => setAgreementReference(e.target.value)} placeholder="Enter agreement number or reference" />
          </div>

          <div className="field">
            <label htmlFor="p-address">Site address</label>
            <input id="p-address" value={address} placeholder="Street, building, area or landmark" onChange={(e) => setAddress(e.target.value)} />
          </div>


