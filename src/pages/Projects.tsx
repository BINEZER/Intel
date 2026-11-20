/**
 * Minimal project register and project entry form.
 */
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { createProject, subscribeProjects, updateProject } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { FormPanel } from '../components/FormPanel.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { DEFAULT_TEMPLATE_KEY } from '../lib/project-templates.js';
import type { DualDate, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import type { ProjectType } from '../lib/project-kind.js';

export function Projects() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [editing, setEditing] = useState<WithId<Project> | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.rows.filter((p) =>
      !q || [p.projectNo, p.title, p.clientName, p.site?.address]
        .some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [projects.rows, search]);

  return <>
    <div className="page-head">
      <div><h1>Projects</h1><p className="muted">All elevator installation projects in one place.</p></div>
      {editable && user && editing === null && <button type="button" className="primary" onClick={() => setEditing('new')}>New project</button>}
    </div>
    {projects.error && <p className="error" role="alert">{projects.error}</p>}
    {editing !== null && user && <ProjectForm initial={editing === 'new' ? null : editing} uid={user.uid} onDone={() => setEditing(null)} />}
    <section className="card project-list-card">
      <div className="section-heading">
        <div><h2>Project register</h2><p className="muted">{projects.rows.length} projects</p></div>
        <label className="project-search"><span className="visually-hidden">Search projects</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, client or site address…" />
        </label>
      </div>
      {projects.loading ? <p className="muted">Loading projects…</p> : rows.length === 0 ?
        <p className="muted">{projects.rows.length === 0 ? 'No projects yet. Add the first project when ready.' : 'No matching projects.'}</p> :
        <div className="project-table-wrap"><table className="data-table project-overview-table">
          <thead><tr><th>Project</th><th>Client / site address</th><th>Current phase</th><th>Progress</th><th>Status</th><th>Planned completion</th></tr></thead>
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

export function ProjectForm({ initial, uid, onDone }: {
  initial: WithId<Project> | null;
  uid: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [clientName, setClientName] = useState(initial?.clientName ?? '');
  const [agreementReference, setAgreementReference] = useState(initial?.agreementReference ?? '');
  const [projectNo, setProjectNo] = useState(initial?.projectNo ?? `P-${Date.now()}`);
  const [address, setAddress] = useState(initial?.site?.address ?? '');
  const [units, setUnits] = useState(initial?.units?.length ?? 1);
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(initial?.plannedStart ?? null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(initial?.plannedEnd ?? null);
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'planned');
  const { busy, error, run } = useAsyncAction(initial === null ? 'create this project' : 'save this project');
  const allProjects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'check project numbers').rows;
  const ready = title.trim() !== '' && clientName.trim() !== '' && projectNo.trim() !== '' && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const normalizedProjectNo = projectNo.trim();
    if (allProjects.some((p) => p.id !== initial?.id && p.projectNo.trim().toLowerCase() === normalizedProjectNo.toLowerCase())) {
      await run(async () => { throw new Error('That project number is already in use. Choose a unique number.'); });
      return;
    }
    const normalizedClient = clientName.trim();
    const input = {
      projectNo: normalizedProjectNo,
      type: (initial?.type ?? 'elevator') as ProjectType,
      title: title.trim(),
      clientId: initial?.clientId ?? `manual-${Date.now()}`,
      clientName: normalizedClient,
      contractId: null,
      agreementReference: agreementReference.trim(),
      site: { name: title.trim(), city: '', ...(address.trim() ? { address: address.trim() } : {}) },
      parentProjectId: initial?.parentProjectId ?? null,
      units: initial === null
        ? Array.from({ length: Math.max(1, units) }, (_, i) => ({ tag: `LIFT-${String(i + 1).padStart(2, '0')}` }))
        : initial.units,
      plannedStart: plannedStart as DualDate,
      plannedEnd: plannedEnd as DualDate,
      actualStart: initial?.actualStart ?? null,
      actualEnd: initial?.actualEnd ?? null,
      status,
    };
    const saved = await run(async () => {
      if (initial === null) {
        await createProject(input, uid, { plannedStart: plannedStart as DualDate, plannedEnd: plannedEnd as DualDate, templateKey: DEFAULT_TEMPLATE_KEY });
      } else {
        await updateProject(initial.id, input, uid);
      }
      return true;
    });
    if (saved !== null) onDone();
  }

  return <FormPanel title={initial === null ? 'New project' : `Edit ${initial.title}`}
    description="Enter the basic project details, agreement reference and planned dates." onClose={onDone}>
    <form onSubmit={(e) => void submit(e)}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="p-client">Client <span className="req" aria-hidden="true">*</span></label>
          <input id="p-client" required value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Type client name" />
        </div>
        <div className="field">
          <label htmlFor="p-agreement">Agreement / reference</label>
          <input id="p-agreement" value={agreementReference} onChange={(e) => setAgreementReference(e.target.value)} placeholder="Type agreement number or reference" />
        </div>
        <div className="field">
          <label htmlFor="p-number">Project number / code <span className="req" aria-hidden="true">*</span></label>
          <input id="p-number" required value={projectNo} onChange={(e) => setProjectNo(e.target.value)} placeholder="P-2026-001" />
        </div>
        <div className="field">
          <label htmlFor="p-title">Project name <span className="req" aria-hidden="true">*</span></label>
          <input id="p-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bole Tower — 3 passenger lifts" />
        </div>
        <div className="field">
          <label htmlFor="p-address">Site address</label>
          <input id="p-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, building, area or landmark" />
        </div>
        {initial === null && <div className="field">
          <label htmlFor="p-units">Number of elevators</label>
          <input id="p-units" type="number" min={1} value={units} onChange={(e) => setUnits(Number(e.target.value) || 1)} />
        </div>}
        <div className="field">
          <label htmlFor="p-status">Project status</label>
          <StatusSelect kind="project" id="p-status" value={status} onChange={(value) => setStatus(value as Project['status'])} />
        </div>
      </div>
      <div className="form-grid dates">
        <DualDateInput label="Planned start" value={plannedStart} onChange={setPlannedStart} required />
        <DualDateInput label="Planned end" value={plannedEnd} onChange={setPlannedEnd} required />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy || !ready}>{busy ? 'Saving…' : initial === null ? 'Create project' : 'Save changes'}</button>
        <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </form>
  </FormPanel>;
}
