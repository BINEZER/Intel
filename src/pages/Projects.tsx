/**
 * Minimal project register and project entry form.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { createProject, subscribeActiveProjectAssignments, subscribeProjects, updateProject } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { FormPanel } from '../components/FormPanel.js';
import { StatusSelect } from '../components/StatusSelect.js';
import { DEFAULT_TEMPLATE_KEY } from '../lib/project-templates.js';
import type { DualDate, Project, ProjectAssignment } from '../lib/schema.js';
import { PROJECT_STATUSES } from '../lib/status.js';
import type { WithId } from '../data/repository.js';
import type { ProjectType } from '../lib/project-kind.js';

export function Projects() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const [editing, setEditing] = useState<WithId<Project> | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [phaseFilter, setPhaseFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [sortBy, setSortBy] = useState('plannedEnd');
  const [sortDirection, setSortDirection] = useState('asc');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const assignments = useCollection<ProjectAssignment>((d, e) => subscribeActiveProjectAssignments(d, e), [], 'load project assignments');
  const now = new Date();
  const peopleByProject = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of assignments.rows) {
      const list = map.get(row.projectId) ?? [];
      if (!list.includes(row.technicianName)) list.push(row.technicianName);
      map.set(row.projectId, list);
    }
    return map;
  }, [assignments.rows]);
  const phases = useMemo(() => [...new Set(projects.rows.map((p) => p.currentStage?.name).filter((v): v is string => Boolean(v)))].sort(), [projects.rows]);
  const assignees = useMemo(() => [...new Set(assignments.rows.map((a) => a.technicianName))].sort((a,b) => a.localeCompare(b)), [assignments.rows]);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = projects.rows.filter((p) => {
      const names = peopleByProject.get(p.id) ?? [];
      const overdue = !['completed','cancelled','terminated'].includes(p.status) && !!p.plannedEnd?.at && p.plannedEnd.at.toDate().getTime() < now.getTime();
      const matchesSearch = !q || [p.projectNo,p.title,p.clientName,p.site?.address,p.currentStage?.name,...names].some((v) => String(v ?? '').toLowerCase().includes(q));
      return matchesSearch
        && (statusFilter === 'all' || p.status === statusFilter)
        && (phaseFilter === 'all' || p.currentStage?.name === phaseFilter)
        && (assigneeFilter === 'all' || names.includes(assigneeFilter))
        && (scheduleFilter === 'all' || (scheduleFilter === 'overdue' ? overdue : scheduleFilter === 'on-track' ? !overdue && !['completed','cancelled','terminated'].includes(p.status) : p.status === scheduleFilter));
    });
    const dateValue = (value: Project['plannedStart'] | Project['plannedEnd'] | Project['actualEnd']) => value?.at?.toDate().getTime() ?? 0;
    const sorted = [...filtered].sort((a,b) => {
      let cmp = 0;
      if (sortBy === 'progress') cmp = a.progressBps - b.progressBps;
      else if (sortBy === 'plannedStart') cmp = dateValue(a.plannedStart) - dateValue(b.plannedStart);
      else if (sortBy === 'plannedEnd') cmp = dateValue(a.plannedEnd) - dateValue(b.plannedEnd);
      else if (sortBy === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortBy === 'client') cmp = a.clientName.localeCompare(b.clientName);
      else cmp = a.title.localeCompare(b.title);
      return sortDirection === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [projects.rows, peopleByProject, search, statusFilter, phaseFilter, assigneeFilter, scheduleFilter, sortBy, sortDirection, now]);
  const resetFilters = () => { setSearch(''); setStatusFilter('all'); setPhaseFilter('all'); setAssigneeFilter('all'); setScheduleFilter('all'); setSortBy('plannedEnd'); setSortDirection('asc'); };

  return <>
    <div className="page-head">
      <div><h1>Projects</h1><p className="muted">All elevator installation projects in one place.</p></div>
      {editable && user && editing === null && <button type="button" className="primary" onClick={() => setEditing('new')}>New project</button>}
    </div>
    {projects.error && <p className="error" role="alert">{projects.error}</p>}
    {assignments.error && <p className="error" role="alert">{assignments.error}</p>}
    {editing !== null && user && <ProjectForm initial={editing === 'new' ? null : editing} uid={user.uid} onDone={() => setEditing(null)} />}
    <section className="card project-list-card">
      <div className="section-heading">
        <div><h2>Project register</h2><p className="muted">Showing {rows.length} of {projects.rows.length} projects</p></div>
        <label className="project-search"><span className="visually-hidden">Search projects</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search project, client, site or assigned person…" />
        </label>
      </div>
      <div className="project-filters">
        <label>Status<select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label>Current phase<select value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)}><option value="all">All phases</option>{phases.map((phase) => <option key={phase} value={phase}>{phase}</option>)}</select></label>
        <label>Assigned to<select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}><option value="all">All personnel</option>{assignees.map((person) => <option key={person} value={person}>{person}</option>)}</select></label>
        <label>Schedule<select value={scheduleFilter} onChange={(e) => setScheduleFilter(e.target.value)}><option value="all">All projects</option><option value="overdue">Overdue</option><option value="on-track">Active / not overdue</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label>Sort by<select value={sortBy} onChange={(e) => setSortBy(e.target.value)}><option value="plannedEnd">Planned completion</option><option value="plannedStart">Planned start</option><option value="name">Project name</option><option value="client">Client</option><option value="progress">Progress</option><option value="status">Status</option></select></label>
        <label>Order<select value={sortDirection} onChange={(e) => setSortDirection(e.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        <button type="button" className="quiet-button" onClick={resetFilters}>Clear filters</button>
      </div>
      {projects.loading || assignments.loading ? <p className="muted">Loading projects…</p> : rows.length === 0 ?
        <p className="muted">{projects.rows.length === 0 ? 'No projects yet. Add the first project when ready.' : 'No projects match these filters.'}</p> :
        <div className="project-table-wrap"><table className="data-table project-overview-table">
          <thead><tr><th>Project</th><th>Client</th><th>Assigned to</th><th>Phase</th><th>Progress / status</th><th>Planned completion</th></tr></thead>
          <tbody>{rows.map((p) => <tr key={p.id}>
            <td><Link to={`/projects/${p.id}`} className="project-name-link"><strong>{p.title}</strong><small>{p.projectNo}</small></Link></td>
            <td>{p.clientName}</td>
            <td>{(peopleByProject.get(p.id) ?? []).length ? (peopleByProject.get(p.id) ?? []).join(', ') : '—'}</td>
            <td>{p.currentStage?.name ?? 'Not started'}</td>
            <td><div className="project-progress-status"><div className="mini-progress"><span style={{width:`${Math.max(0,Math.min(100,p.progressBps/100))}%`}} /></div><div><small>{Math.round(p.progressBps/100)}%</small><span className={`project-status status-${p.status}`}>{PROJECT_STATUSES.find((s) => s.value === p.status)?.label ?? p.status}</span></div></div></td>
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
  const [projectNo, setProjectNo] = useState(initial?.projectNo ?? '');
  const [address, setAddress] = useState(initial?.site?.address ?? '');
  const [units, setUnits] = useState(initial?.units?.length ?? 1);
  const [plannedStart, setPlannedStart] = useState<DualDate | null>(initial?.plannedStart ?? null);
  const [plannedEnd, setPlannedEnd] = useState<DualDate | null>(initial?.plannedEnd ?? null);
  const [status, setStatus] = useState<Project['status']>(initial?.status ?? 'planned');
  const { busy, error, run } = useAsyncAction(initial === null ? 'create this project' : 'save this project');
  const allProjectsState = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'check project numbers');
  const allProjects = allProjectsState.rows;
  useEffect(() => {
    if (initial !== null || allProjectsState.loading || projectNo !== '') return;
    const used = new Set(allProjects.map((project) => project.projectNo.trim().toUpperCase()));
    let next = 1;
    while (next <= 999 && used.has(`IM${String(next).padStart(3, '0')}`)) next += 1;
    if (next <= 999) setProjectNo(`IM${String(next).padStart(3, '0')}`);
  }, [initial, allProjectsState.loading, allProjects, projectNo]);
  const validProjectNo = /^IM\d{1,3}$/i.test(projectNo.trim());
  const ready = title.trim() !== '' && clientName.trim() !== '' && validProjectNo && plannedStart !== null && plannedEnd !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const normalizedProjectNo = projectNo.trim().toUpperCase();
    if (!/^IM\d{1,3}$/.test(normalizedProjectNo)) {
      await run(async () => { throw new Error('Use IM followed by no more than three digits (for example, IM001).'); });
      return;
    }
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
          <label htmlFor="p-number">Project reference <span className="req" aria-hidden="true">*</span></label>
          <input id="p-number" required maxLength={5} value={projectNo} onChange={(e) => setProjectNo(e.target.value.toUpperCase().replace(/[^IM0-9]/g, ''))} placeholder="IM001" />
          <small className="muted">Automatically generated; editable. Format: IM + up to 3 digits.</small>
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
