import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { db } from '../firebase.js';
import { useCollection } from '../data/useCollection.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { collectionRef } from '../data/repository.js';
import { DualDateText } from '../components/DualDateInput.js';
import {
  estimateInstallationCrewDays,
  validateInstallationStandard,
  type InstallationDurationStandard,
} from '../lib/installation-planning.js';
import type { ElevatorUnit, Project, ProjectAssignment, Technician } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { stampUpdate } from '../data/audit.js';

const CONFIG_ID = 'installationDurationStandards';

function emptyStandard(): InstallationDurationStandard {
  return {
    id: crypto.randomUUID(),
    label: '',
    minStops: 1,
    maxStops: 8,
    minCapacityKg: 0,
    maxCapacityKg: 1000,
    elevatorType: '',
    minSpeedMps: null,
    maxSpeedMps: null,
    mechanicalDays: 0,
    electricalDays: 0,
    commissioningDays: 0,
  };
}

function dateValue(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value + 'T00:00:00');
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function InstallationPlanner() {
  const { user, role } = useAuth();
  const canConfigure = can(role, 'manageConfig');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load installation projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lift specifications');
  const technicians = useCollection<Technician>((d, e) => subscribeTechnicians(d, e, { activeOnly: true }), [], 'load installation teams');
  const [assignments, setAssignments] = useState<WithId<ProjectAssignment>[]>([]);
  const [standards, setStandards] = useState<InstallationDurationStandard[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<'schedule' | 'capacity' | 'standards'>('schedule');

  useEffect(() => onSnapshot(
    query(collectionRef('projectAssignments'), where('active', '==', true)),
    (snapshot) => setAssignments(snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as ProjectAssignment) }))),
    (error) => setConfigError(error.message),
  ), []);

  useEffect(() => {
    let alive = true;
    void getDoc(doc(db, 'config', CONFIG_ID)).then((snapshot) => {
      if (!alive) return;
      const rows = snapshot.exists() ? snapshot.data().standards : [];
      setStandards(Array.isArray(rows) ? rows as InstallationDurationStandard[] : []);
    }).catch((error: unknown) => {
      if (alive) setConfigError(error instanceof Error ? error.message : 'Could not load duration standards.');
    }).finally(() => { if (alive) setConfigLoading(false); });
    return () => { alive = false; };
  }, []);

  const installationProjects = useMemo(
    () => projects.rows.filter((p) => ['elevator', 'modernisation'].includes(p.type) && !['completed', 'cancelled'].includes(p.status)),
    [projects.rows],
  );
  const unitsByProject = useMemo(() => {
    const map = new Map<string, WithId<ElevatorUnit>[]>();
    for (const unit of units.rows) {
      if (!unit.installedByProjectId) continue;
      const rows = map.get(unit.installedByProjectId) ?? [];
      rows.push(unit);
      map.set(unit.installedByProjectId, rows);
    }
    return map;
  }, [units.rows]);
  const projectById = useMemo(() => new Map(projects.rows.map((p) => [p.id, p])), [projects.rows]);
  const assignmentByProject = useMemo(() => {
    const map = new Map<string, WithId<ProjectAssignment>[]>();
    for (const assignment of assignments) {
      const rows = map.get(assignment.projectId) ?? [];
      rows.push(assignment);
      map.set(assignment.projectId, rows);
    }
    return map;
  }, [assignments]);
  const scheduled = useMemo(() => installationProjects
    .filter((p) => {
      const start = p.plannedStart?.at.toDate();
      if (!start) return true;
      const lower = dateValue(from);
      const upper = dateValue(to);
      return (lower === null || start >= lower) && (upper === null || start <= upper);
    })
    .sort((a, b) => a.plannedStart.at.toMillis() - b.plannedStart.at.toMillis()), [installationProjects, from, to]);

  const workload = useMemo(() => {
    const rows = technicians.rows.filter((t) => t.discipline === 'installation' || t.discipline === 'both');
    return rows.map((person) => {
      const today = new Date();
      const active = assignments.filter((a) => a.technicianId === person.id && a.startDate.at.toDate() <= today && (a.endDate === null || a.endDate.at.toDate() >= today));
      const allocationBps = active.reduce((sum, a) => sum + a.allocationBps, 0);
      return { person, active, allocationBps, overAllocated: allocationBps > 10_000 };
    }).sort((a, b) => b.allocationBps - a.allocationBps);
  }, [technicians.rows, assignments]);

  async function saveStandards() {
    if (!user) return;
    const invalid = standards.map(validateInstallationStandard).find((message) => message !== null);
    if (invalid) { setSaveMessage(invalid); return; }
    const ids = standards.map((row) => row.id);
    if (new Set(ids).size !== ids.length) { setSaveMessage('Each benchmark must have a unique ID.'); return; }
    setSaving(true);
    setSaveMessage(null);
    try {
      await setDoc(doc(db, 'config', CONFIG_ID), { standards, ...stampUpdate(user.uid) }, { merge: true });
      setSaveMessage('Duration benchmarks saved.');
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : 'Could not save benchmarks.');
    } finally { setSaving(false); }
  }

  function updateStandard(id: string, patch: Partial<InstallationDurationStandard>) {
    setStandards((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/projects">Projects</Link> / Installation planning</p>
          <h1>Installation planning</h1>
          <p className="muted">Schedule elevator work, check crew commitments and estimate installation effort from lift specifications.</p>
        </div>
      </div>

      <section className="card">
        <div className="page-actions planner-tabs" role="group" aria-label="Planner views">
          <button type="button" className={view === 'schedule' ? 'primary' : ''} onClick={() => setView('schedule')}>Project schedule</button>
          <button type="button" className={view === 'capacity' ? 'primary' : ''} onClick={() => setView('capacity')}>Team capacity</button>
          <button type="button" className={view === 'standards' ? 'primary' : ''} onClick={() => setView('standards')}>Duration standards</button>
        </div>
      </section>

      {view === 'schedule' && (
        <>
          <section className="card">
            <h2>Installation portfolio</h2>
            <div className="form-grid planner-filters">
              <label>Planned start from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label>Planned start to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
              <p className="hint">{scheduled.length} active installation / modernisation projects</p>
            </div>
            {projects.loading && <p className="muted">Loading projects…</p>}
            {projects.error && <p className="error" role="alert">{projects.error}</p>}
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Project</th><th>Site</th><th>Planned period</th><th>Lifts & specification</th><th>Assigned people</th><th>Estimated crew-days</th><th>Status</th></tr></thead>
                <tbody>
                  {scheduled.map((project) => {
                    const fleet = unitsByProject.get(project.id) ?? [];
                    const assigned = assignmentByProject.get(project.id) ?? [];
                    const estimates = fleet.map((unit) => estimateInstallationCrewDays(unit, standards));
                    const known = estimates.filter((item) => item !== null);
                    const estimateTotal = known.reduce((sum, item) => sum + item.totalCrewDays, 0);
                    return (
                      <tr key={project.id}>
                        <td><Link to={`/projects/${project.id}`}><strong>{project.projectNo} · {project.title}</strong></Link><small className="muted">{project.clientName}</small></td>
                        <td>{project.site?.name || project.site?.city}</td>
                        <td><DualDateText value={project.plannedStart} /> – <DualDateText value={project.plannedEnd} /></td>
                        <td>{fleet.length ? fleet.map((unit) => <div key={unit.id}>{unit.tag}: {unit.capacityKg ?? '—'} kg · {unit.stops ?? '—'} stops · {unit.type ?? 'type n/a'}</div>) : <span className="muted">No linked lift records</span>}</td>
                        <td>{assigned.length ? assigned.map((a) => <div key={a.id}>{a.technicianName} · {(a.allocationBps / 100).toFixed(0)}%</div>) : <span className="warn-text">No team assigned</span>}</td>
                        <td>{fleet.length === 0 ? '—' : known.length === fleet.length ? `${estimateTotal} crew-days` : <span className="warn-text">Benchmark/spec missing ({known.length}/{fleet.length})</span>}</td>
                        <td>{project.status.replace(/_/g, ' ')}</td>
                      </tr>
                    );
                  })}
                  {!projects.loading && scheduled.length === 0 && <tr><td colSpan={7} className="muted">No installation projects in this date range.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="hint">Estimates are totals of discipline-specific crew-days across linked lifts. They are not calendar durations until team availability and phase sequencing are scheduled.</p>
          </section>
        </>
      )}

      {view === 'capacity' && (
        <section className="card">
          <h2>Installation team commitments</h2>
          <p className="muted">Current active project allocations. More than 100% combined allocation is flagged as a scheduling conflict; this is a capacity warning, not a booking engine.</p>
          {technicians.loading && <p className="muted">Loading people…</p>}
          {technicians.error && <p className="error" role="alert">{technicians.error}</p>}
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Technician</th><th>Discipline / trades</th><th>Active projects</th><th>Combined allocation</th><th>Availability signal</th></tr></thead>
              <tbody>
                {workload.map(({ person, active, allocationBps, overAllocated }) => (
                  <tr key={person.id}>
                    <td><strong>{person.name}</strong><small className="muted">{person.employeeNo}</small></td>
                    <td>{person.discipline} · {person.trades.join(', ') || 'Trades not specified'}</td>
                    <td>{active.length ? active.map((a) => <div key={a.id}><Link to={`/projects/${a.projectId}`}>{a.technicianName === person.name ? a.projectId : a.projectId}</Link> · {a.role}</div>) : 'Unassigned'}</td>
                    <td>{(allocationBps / 100).toFixed(0)}%</td>
                    <td>{overAllocated ? <span className="error">Over-allocated</span> : allocationBps === 0 ? <span className="muted">Available (no active allocation)</span> : <span className="ok-text">Within allocation limit</span>}</td>
                  </tr>
                ))}
                {!technicians.loading && workload.length === 0 && <tr><td colSpan={5} className="muted">No active installation technicians are registered.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view === 'standards' && (
        <section className="card">
          <h2>Installation duration benchmarks</h2>
          <p className="muted">Management-maintained planning standards. Enter validated crew-days for each lift specification band. No assumed IntelMotion rates are preloaded.</p>
          {configLoading && <p className="muted">Loading standards…</p>}
          {configError && <p className="error" role="alert">{configError}</p>}
          {!canConfigure && <p className="hint">Only administrators can change these shared benchmarks. Ask an administrator to configure standards agreed with Technical Management.</p>}
          {standards.map((row) => (
            <div className="planner-standard" key={row.id}>
              <label>Benchmark name<input disabled={!canConfigure} value={row.label} onChange={(e) => updateStandard(row.id, { label: e.target.value })} /></label>
              <div className="form-grid">
                <label>Min stops<input disabled={!canConfigure} type="number" min="1" value={row.minStops} onChange={(e) => updateStandard(row.id, { minStops: Number(e.target.value) })} /></label>
                <label>Max stops<input disabled={!canConfigure} type="number" min="1" value={row.maxStops} onChange={(e) => updateStandard(row.id, { maxStops: Number(e.target.value) })} /></label>
                <label>Min capacity (kg)<input disabled={!canConfigure} type="number" min="0" value={row.minCapacityKg} onChange={(e) => updateStandard(row.id, { minCapacityKg: Number(e.target.value) })} /></label>
                <label>Max capacity (kg)<input disabled={!canConfigure} type="number" min="0" value={row.maxCapacityKg} onChange={(e) => updateStandard(row.id, { maxCapacityKg: Number(e.target.value) })} /></label>
                <label>Elevator type (blank = any)<input disabled={!canConfigure} value={row.elevatorType} onChange={(e) => updateStandard(row.id, { elevatorType: e.target.value })} /></label>
                <label>Mechanical crew-days<input disabled={!canConfigure} type="number" min="0" step="0.5" value={row.mechanicalDays} onChange={(e) => updateStandard(row.id, { mechanicalDays: Number(e.target.value) })} /></label>
                <label>Electrical crew-days<input disabled={!canConfigure} type="number" min="0" step="0.5" value={row.electricalDays} onChange={(e) => updateStandard(row.id, { electricalDays: Number(e.target.value) })} /></label>
                <label>Commissioning crew-days<input disabled={!canConfigure} type="number" min="0" step="0.5" value={row.commissioningDays} onChange={(e) => updateStandard(row.id, { commissioningDays: Number(e.target.value) })} /></label>
              </div>
              {canConfigure && <button type="button" onClick={() => setStandards((rows) => rows.filter((item) => item.id !== row.id))}>Remove benchmark</button>}
            </div>
          ))}
          {canConfigure && (
            <div className="page-actions">
              <button type="button" onClick={() => setStandards((rows) => [...rows, emptyStandard()])}>Add benchmark</button>
              <button type="button" className="primary" disabled={saving || configLoading} onClick={() => void saveStandards()}>{saving ? 'Saving…' : 'Save benchmarks'}</button>
            </div>
          )}
          {saveMessage && <p className={saveMessage.includes('saved') ? 'ok-text' : 'error'} role="status">{saveMessage}</p>}
          <p className="hint">If two standards match the same lift, or a lift is missing stops/capacity/type data required by a standard, no estimate is shown. This avoids silently applying the wrong duration.</p>
        </section>
      )}
    </>
  );
}
