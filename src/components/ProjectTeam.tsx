import { useState } from 'react';
import { can } from '../auth/roles.js';
import { useAuth } from '../auth/AuthProvider.js';
import { assignTechnician, endAssignment, subscribeAssignments } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import type { ProjectAssignment } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ProjectTeam({ projectId }: { projectId: string }) {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const { rows, loading, error } = useCollection<ProjectAssignment>(
    (d, e) => subscribeAssignments(projectId, d, e), [projectId], 'load assigned personnel',
  );
  const action = useAsyncAction('update assigned personnel');
  const [technicianName, setTechnicianName] = useState('');
  const [assignmentRole, setAssignmentRole] = useState<ProjectAssignment['role']>('technician');
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');

  async function add() {
    const name = technicianName.trim();
    if (!name || !user) return;
    const technicianId = `manual-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const start = new Date(startDate + 'T00:00:00');
    const end = endDate ? new Date(endDate + 'T00:00:00') : null;
    if (Number.isNaN(start.getTime()) || (end && (Number.isNaN(end.getTime()) || end < start))) return;
    const saved = await action.run(() => assignTechnician({
      projectId, technicianId, technicianName: name, role: assignmentRole,
      assignmentType: 'shared', allocationBps: 10000, phaseIds: [],
      startDate: dualDateFromGregorian(start, toTimestamp, 'GC'),
      endDate: end ? dualDateFromGregorian(end, toTimestamp, 'GC') : null, active: true,
    }, user.uid));
    if (saved !== null) setTechnicianName('');
  }

  return <section className="card team-card">
    <div className="section-heading"><div><h2>Assigned personnel</h2><p className="muted">Who is responsible for this project.</p></div></div>
    {error && <p className="error" role="alert">{error}</p>}
    {action.error && <p className="error" role="alert">{action.error}</p>}
    {loading ? <p className="muted">Loading assignments…</p> : rows.length === 0 ?
      <p className="muted">No personnel assigned yet.</p> :
      <div className="team-list">{rows.map((row) => <div className="team-person" key={row.id}>
        <div className="team-avatar">{row.technicianName.trim().charAt(0).toUpperCase()}</div>
        <div className="team-person-info"><strong>{row.technicianName}</strong><span>{row.role.replace(/_/g,' ')}</span></div>
        <div className="team-period">{row.startDate.at.toDate().toLocaleDateString()} – {row.endDate?.at.toDate().toLocaleDateString() ?? 'Ongoing'}</div>
        {editable && <button type="button" className="quiet-button" disabled={action.busy || !user}
          onClick={() => user && void action.run(() => endAssignment(row.id, user.uid))}>Remove</button>}
      </div>)}</div>}
    {editable && <div className="team-add">
      <label className="field"><span>Technician / assigned person</span><input value={technicianName} onChange={(e) => setTechnicianName(e.target.value)} placeholder="Type full name" /></label>
      <label className="field"><span>Role</span><select value={assignmentRole} onChange={(e) => setAssignmentRole(e.target.value as ProjectAssignment['role'])}>
        <option value="lead">Lead</option><option value="supervisor">Supervisor</option><option value="technician">Technician</option><option value="helper">Helper</option>
      </select></label>
      <label className="field"><span>Start date</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
      <label className="field"><span>End date (optional)</span><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
      <button type="button" className="primary team-add-button" disabled={!technicianName.trim() || action.busy || !user} onClick={() => void add()}>Assign</button>
    </div>}
  </section>;
}
