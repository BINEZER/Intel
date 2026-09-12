/**
 * Project crew and their allocations.
 *
 * Allocation is the weight each technician carries in the project's team score,
 * so it is shown next to every name rather than buried in an edit form — a lead
 * at 60% moves the project's number six times as much as a helper at 10%, and
 * anyone reading the score should be able to see why.
 */

import { useState } from 'react';
import { can } from '../auth/roles.js';
import { useAuth } from '../auth/AuthProvider.js';
import { assignTechnician, endAssignment, subscribeAssignments } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import type { ProjectAssignment, Technician } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ProjectTeam({
  projectId,
  technicians,
}: {
  projectId: string;
  technicians: readonly WithId<Technician>[];
}) {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const { rows, loading, error } = useCollection<ProjectAssignment>(
    (d, e) => subscribeAssignments(projectId, d, e),
    [projectId],
    'load the project team',
  );
  const action = useAsyncAction('change the project team');

  const [technicianId, setTechnicianId] = useState('');
  const [allocationPercent, setAllocationPercent] = useState(50);
  const [assignmentRole, setAssignmentRole] = useState<ProjectAssignment['role']>('technician');

  const assigned = new Set(rows.map((r) => r.technicianId));
  const available = technicians.filter((t) => !assigned.has(t.id) && t.status === 'active');

  async function add() {
    const technician = technicians.find((t) => t.id === technicianId);
    if (technician === undefined || user === null) return;
    const done = await action.run(() =>
      assignTechnician(
        {
          projectId,
          technicianId,
          technicianName: technician.name,
          role: assignmentRole,
          allocationBps: Math.round(allocationPercent * 100),
          phaseIds: [],
          startDate: dualDateFromGregorian(new Date(), toTimestamp, 'GC'),
          endDate: null,
          active: true,
        },
        user.uid,
      ),
    );
    if (done !== null) setTechnicianId('');
  }

  return (
    <section className="card">
      <h2>Team</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {action.error && <p className="error" role="alert">{action.error}</p>}
      {loading && <p className="muted">Loading team…</p>}

      {!loading && rows.length === 0 && (
        <p className="warn-text">
          Nobody is assigned. A live project with no technician has no owner, and it
          flags as a risk.
        </p>
      )}

      {rows.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Technician</th>
              <th scope="col">Role</th>
              <th scope="col" className="num">Allocation</th>
              {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((assignment) => (
              <tr key={assignment.id}>
                <td><strong>{assignment.technicianName}</strong></td>
                <td>{assignment.role}</td>
                <td className="num">{formatBps(assignment.allocationBps, 0)}</td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      disabled={action.busy || user === null}
                      onClick={() => {
                        if (user === null) return;
                        void action.run(() => endAssignment(assignment.id, user.uid));
                      }}
                    >
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editable && (
        <div className="form-grid assign-row">
          <div className="field">
            <label htmlFor="assign-tech">Add technician</label>
            <select id="assign-tech" value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
              <option value="">Select…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {available.length === 0 && <p className="hint">No unassigned active technicians.</p>}
          </div>

          <div className="field">
            <label htmlFor="assign-role">Role</label>
            <select
              id="assign-role"
              value={assignmentRole}
              onChange={(e) => setAssignmentRole(e.target.value as ProjectAssignment['role'])}
            >
              <option value="lead">Lead</option>
              <option value="technician">Technician</option>
              <option value="helper">Helper</option>
              <option value="supervisor">Supervisor</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="assign-alloc">Allocation %</label>
            <input
              id="assign-alloc"
              type="number"
              min={1}
              max={100}
              value={allocationPercent}
              onChange={(e) => setAllocationPercent(Number(e.target.value) || 0)}
            />
            <p className="hint">Weights this technician in the project's team score.</p>
          </div>

          <div className="field">
            <button
              type="button"
              className="primary"
              disabled={action.busy || technicianId === ''}
              onClick={() => void add()}
            >
              Assign
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
