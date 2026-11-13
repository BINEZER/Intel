import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { db, toTimestamp } from '../firebase.js';
import { useCollection } from '../data/useCollection.js';
import { subscribeProjects, subscribePhases } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { collectionRef } from '../data/repository.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { stampCreate, stampUpdate } from '../data/audit.js';
import { estimateInstallationCrewDays, type InstallationDurationStandard } from '../lib/installation-planning.js';
import {
  analyseInstallationHistory, scheduleInstallation,
  type InstallationBooking, type InstallationDiscipline, type InstallationPhasePlan,
  type InstallationTeam, type WorkCalendar,
} from '../lib/installation-scheduler.js';
import type { ElevatorUnit, Project, ProjectAssignment, ProjectPhase, Technician } from '../lib/schema.js';

type TeamDoc = InstallationTeam & { createdAt?: unknown; updatedAt?: unknown; createdBy?: string; updatedBy?: string };
type BookingDoc = InstallationBooking & { createdAt?: unknown; updatedAt?: unknown; createdBy?: string; updatedBy?: string };
type PerformanceDoc = { projectId: string; projectNo: string; phaseId: string; phaseName: string; discipline: InstallationDiscipline; liftType: string; stops: number; capacityKg: number; actualCrewDays: number; completed: boolean };

const DEFAULT_CALENDAR: WorkCalendar = { workingWeekdays: [1, 2, 3, 4, 5], holidays: [] };
const CONFIG_ID = 'installationDurationStandards';

function iso(date: Date): string { return date.toISOString().slice(0, 10); }
function inferDiscipline(phase: ProjectPhase): InstallationDiscipline {
  const key = (phase.key + ' ' + phase.name).toLowerCase();
  if (/commission|test|inspection|handover/.test(key)) return 'commissioning';
  if (/electr|wiring|cable/.test(key)) return 'electrical';
  return 'mechanical';
}

export function InstallationSchedule() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load installation projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lift specifications');
  const technicians = useCollection<Technician>((d, e) => subscribeTechnicians(d, e, { activeOnly: true }), [], 'load installation staff');
  const teams = useCollection<TeamDoc>((d, e) => onSnapshot(query(collectionRef('installationTeams'), where('active', '==', true)), (s) => d(s.docs.map((x) => ({ ...(x.data() as TeamDoc), id: x.id }))), e), [], 'load installation teams');
  const bookings = useCollection<BookingDoc>((d, e) => onSnapshot(query(collectionRef('installationBookings'), where('status', 'in', ['tentative', 'confirmed'])), (s) => d(s.docs.map((x) => ({ ...(x.data() as BookingDoc), id: x.id }))), e), [], 'load installation bookings');
  const history = useCollection<PerformanceDoc>((d, e) => onSnapshot(collectionRef('installationPerformance'), (s) => d(s.docs.map((x) => ({ id: x.id, ...(x.data() as PerformanceDoc) }))), e), [], 'load installation performance');
  const legacyAssignments = useCollection<ProjectAssignment>((d, e) => onSnapshot(query(collectionRef('projectAssignments'), where('active', '==', true)), (s) => d(s.docs.map((x) => ({ id: x.id, ...(x.data() as ProjectAssignment) }))), e), [], 'load current project allocations');
  const [projectId, setProjectId] = useState('');
  const [startDate, setStartDate] = useState(iso(new Date()));
  const [teamName, setTeamName] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [discipline, setDiscipline] = useState<InstallationDiscipline>('mechanical');
  const [calendar, setCalendar] = useState<WorkCalendar>(DEFAULT_CALENDAR);
  const [holidayText, setHolidayText] = useState('');
  const [standards, setStandards] = useState<InstallationDurationStandard[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [tab, setTab] = useState<'gantt' | 'teams' | 'history'>('gantt');

  const installationProjects = projects.rows.filter((p) => ['elevator', 'modernisation'].includes(p.type) && !['completed', 'cancelled'].includes(p.status));
  const selected = installationProjects.find((p) => p.id === projectId) ?? installationProjects[0];
  const phases = useCollection<ProjectPhase>((d, e) => selected ? subscribePhases(selected.id, d, e) : (() => undefined), [selected?.id], 'load project phases');
  const projectUnits = useMemo(() => selected ? units.rows.filter((u) => u.installedByProjectId === selected.id) : [], [units.rows, selected?.id]);

  useEffect(() => {
    let active = true;
    void import('firebase/firestore').then(({ getDoc }) => getDoc(doc(db, 'config', CONFIG_ID))).then((snap) => {
      if (active && snap.exists()) setStandards(Array.isArray(snap.data().standards) ? snap.data().standards as InstallationDurationStandard[] : []);
    }).catch(() => { if (active) setMessage('Could not load duration standards.'); });
    return () => { active = false; };
  }, []);

  const phasePlans = useMemo<InstallationPhasePlan[]>(() => phases.rows.map((phase) => {
    const metadata = phase.installation;
    const discipline = metadata?.discipline ?? inferDiscipline(phase);
    const liftEstimates = projectUnits.map((unit) => estimateInstallationCrewDays(unit, standards)).filter((x) => x !== null);
    const estimate = liftEstimates.length === projectUnits.length && projectUnits.length > 0
      ? liftEstimates.reduce((sum, row) => sum + (discipline === 'mechanical' ? row!.mechanicalCrewDays : discipline === 'electrical' ? row!.electricalCrewDays : row!.commissioningCrewDays), 0)
      : null;
    return {
      id: phase.id, name: phase.name, discipline,
      crewDays: metadata?.estimatedCrewDays ?? estimate ?? 0,
      dependencies: metadata?.dependencies ?? (phase.seq > 1 && phases.rows[phase.seq - 2] ? [phases.rows[phase.seq - 2]!.id] : []),
      requiresSiteReadiness: metadata?.requiresSiteReadiness ?? ['mechanical', 'electrical'].includes(discipline),
      siteReady: metadata?.siteReady ?? false,
      plannedStart: phase.plannedStart?.at?.toDate ? iso(phase.plannedStart.at.toDate()) : null,
      plannedEnd: phase.plannedEnd?.at?.toDate ? iso(phase.plannedEnd.at.toDate()) : null,
      actualStart: phase.actualStart?.at?.toDate ? iso(phase.actualStart.at.toDate()) : null,
      actualEnd: phase.actualEnd?.at?.toDate ? iso(phase.actualEnd.at.toDate()) : null,
      actualCrewDays: metadata?.actualCrewDays ?? null,
      assignedTeamId: metadata?.assignedTeamId ?? null,
      status: phase.status === 'completed' ? 'completed' : phase.status === 'in_progress' ? 'in_progress' : phase.status === 'blocked' ? 'blocked' : 'not_started',
    };
  }), [phases.rows, projectUnits, standards]);

  const historySummary = useMemo(() => analyseInstallationHistory(history.rows.map((row) => ({
    discipline: row.discipline, liftType: row.liftType, stops: row.stops, capacityKg: row.capacityKg,
    actualCrewDays: row.actualCrewDays, status: row.completed ? 'completed' : 'in_progress',
  }))), [history.rows]);

  async function createTeam() {
    if (!user || !teamName.trim() || !supervisorId || memberIds.length === 0) return;
    const supervisor = technicians.rows.find((t) => t.id === supervisorId);
    if (!supervisor) return;
    setSaving(true); setMessage('');
    try {
      const ref = doc(collectionRef('installationTeams'));
      const row: InstallationTeam = { id: ref.id, name: teamName.trim(), supervisorId, supervisorName: supervisor.name, memberIds: [...new Set([supervisorId, ...memberIds])], disciplines: [discipline], active: true };
      await setDoc(ref, { ...row, ...stampCreate(user.uid) });
      setTeamName(''); setSupervisorId(''); setMemberIds([]);
      setMessage('Team saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save team.'); }
    finally { setSaving(false); }
  }

  async function generateSchedule() {
    if (!user || !selected || !editable) return;
    if (!phases.rows.length) { setMessage('This project has no phases to schedule.'); return; }
    setSaving(true); setMessage('');
    try {
      const legacyBookings: InstallationBooking[] = legacyAssignments.rows.filter((a) => a.projectId !== selected.id).map((a) => ({ id: `legacy:${a.id}`, projectId: a.projectId, phaseId: 'existing-assignment', resourceType: 'technician', resourceId: a.technicianId, resourceName: a.technicianName, memberIds: [a.technicianId], discipline: 'mechanical', startDate: iso(a.startDate.at.toDate()), endDate: a.endDate ? iso(a.endDate.at.toDate()) : '9999-12-31', allocationBps: a.allocationBps, status: 'confirmed' }));
      const protectedPhaseIds = new Set(phases.rows.filter((p) => p.status === 'completed' || p.status === 'in_progress').map((p) => p.id));
      const retainedBookings = bookings.rows.filter((b) => b.projectId === selected.id && protectedPhaseIds.has(b.phaseId));
      const otherBookings = bookings.rows.filter((b) => b.projectId !== selected.id);
      const result = scheduleInstallation(phasePlans, teams.rows, [...otherBookings, ...retainedBookings, ...legacyBookings], startDate, { ...calendar, holidays: holidayText.split(',').map((x) => x.trim()).filter(Boolean) });
      const batch = writeBatch(db);

      for (const row of result.phases) {
        if (row.status === 'completed' || row.status === 'in_progress') continue;
        const phaseRef = doc(db, 'projects', selected.id, 'phases', row.id);
        const current = phases.rows.find((p) => p.id === row.id)!;
        const planMeta = {
          ...(current.installation ?? {}),
          discipline: row.discipline,
          estimatedCrewDays: row.crewDays || null,
          actualCrewDays: row.actualCrewDays ?? null,
          dependencies: row.dependencies,
          requiresSiteReadiness: row.requiresSiteReadiness,
          siteReady: row.siteReady,
          assignedTeamId: row.assignedTeamId,
        };
        if (row.scheduleState === 'scheduled' && row.plannedStart && row.plannedEnd) {
          batch.update(phaseRef, {
            plannedStart: dualDateFromGregorian(new Date(row.plannedStart + 'T00:00:00'), toTimestamp, 'GC'),
            plannedEnd: dualDateFromGregorian(new Date(row.plannedEnd + 'T00:00:00'), toTimestamp, 'GC'),
            installation: planMeta, ...stampUpdate(user.uid),
          });
        } else {
          batch.update(phaseRef, { status: 'blocked', installation: planMeta, ...stampUpdate(user.uid) });
        }
      }
      for (const row of bookings.rows.filter((b) => b.projectId === selected.id && b.status !== 'cancelled' && !protectedPhaseIds.has(b.phaseId))) {
        batch.update(doc(db, 'installationBookings', row.id), { status: 'cancelled', ...stampUpdate(user.uid) });
      }
      for (const row of result.bookings) {
        const ref = doc(collectionRef('installationBookings'));
        batch.set(ref, { ...row, id: ref.id, projectId: selected.id, status: 'confirmed', ...stampCreate(user.uid) });
      }
      await batch.commit();
      setMessage(result.conflicts.length ? `Schedule saved with ${result.conflicts.length} blocker(s). Review the warnings below.` : 'Schedule saved and team bookings confirmed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not generate schedule.'); }
    finally { setSaving(false); }
  }

  async function setSiteReady(phase: InstallationPhasePlan, ready: boolean) {
    if (!user || !selected || !editable) return;
    const current = phases.rows.find((p) => p.id === phase.id);
    if (!current) return;
    const metadata = { ...(current.installation ?? {}), discipline: phase.discipline, estimatedCrewDays: phase.crewDays || null, actualCrewDays: phase.actualCrewDays ?? null, dependencies: phase.dependencies, requiresSiteReadiness: phase.requiresSiteReadiness, siteReady: ready, siteReadyApprovedBy: ready ? user.uid : null, siteReadyApprovedAt: ready ? toTimestamp(new Date()) : null, assignedTeamId: phase.assignedTeamId };
    await updateDoc(doc(db, 'projects', selected.id, 'phases', phase.id), { installation: metadata, ...stampUpdate(user.uid) });
  }

  async function setDependencies(phase: InstallationPhasePlan, dependencies: string[]) {
    if (!user || !selected || !editable || dependencies.includes(phase.id)) return;
    const current = phases.rows.find((row) => row.id === phase.id);
    if (!current) return;
    const metadata = { ...(current.installation ?? {}), discipline: phase.discipline, estimatedCrewDays: phase.crewDays || null, actualCrewDays: phase.actualCrewDays ?? null, dependencies, requiresSiteReadiness: phase.requiresSiteReadiness, siteReady: phase.siteReady, assignedTeamId: phase.assignedTeamId };
    await updateDoc(doc(db, 'projects', selected.id, 'phases', phase.id), { installation: metadata, ...stampUpdate(user.uid) });
  }

  async function setReadinessRequired(phase: InstallationPhasePlan, required: boolean) {
    if (!user || !selected || !editable) return;
    const current = phases.rows.find((row) => row.id === phase.id);
    if (!current) return;
    const metadata = { ...(current.installation ?? {}), discipline: phase.discipline, estimatedCrewDays: phase.crewDays || null, actualCrewDays: phase.actualCrewDays ?? null, dependencies: phase.dependencies, requiresSiteReadiness: required, siteReady: phase.siteReady, assignedTeamId: phase.assignedTeamId };
    await updateDoc(doc(db, 'projects', selected.id, 'phases', phase.id), { installation: metadata, ...stampUpdate(user.uid) });
  }

  async function recordActual(phase: InstallationPhasePlan, value: number) {
    if (!user || !selected || !Number.isFinite(value) || value <= 0) return;
    const phaseRecord = phases.rows.find((row) => row.id === phase.id);
    if (phaseRecord?.status !== 'completed') { setMessage('Record actual crew-days after the phase is marked completed.'); return; }
    if (projectUnits.length !== 1) { setMessage('Historical benchmark capture currently requires exactly one linked lift per project. Multi-lift actuals are not attributed to individual lift specifications.'); return; }
    const lift = projectUnits[0]!;
    const metadata = { ...(phaseRecord.installation ?? {}), discipline: phase.discipline, estimatedCrewDays: phase.crewDays || null, actualCrewDays: value, dependencies: phase.dependencies, requiresSiteReadiness: phase.requiresSiteReadiness, siteReady: phase.siteReady, assignedTeamId: phase.assignedTeamId };
    setSaving(true);
    try {
      await updateDoc(doc(db, 'projects', selected.id, 'phases', phase.id), { installation: metadata, ...stampUpdate(user.uid) });
      const recordId = `${selected.id}_${phase.id}`;
      const performanceRef = doc(db, 'installationPerformance', recordId);
      const existingPerformance = await getDoc(performanceRef);
      await setDoc(performanceRef, {
        projectId: selected.id, projectNo: selected.projectNo, phaseId: phase.id, phaseName: phase.name,
        discipline: phase.discipline, liftType: lift.type ?? 'Unspecified', stops: lift.stops ?? 0,
        capacityKg: lift.capacityKg ?? 0, actualCrewDays: value, completed: true, ...(existingPerformance.exists() ? stampUpdate(user.uid) : stampCreate(user.uid)),
      }, { merge: true });
      setMessage('Actual crew-days recorded for historical analysis.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not record actual performance.'); }
    finally { setSaving(false); }
  }

  const scheduleBookings = bookings.rows.filter((b) => b.status !== 'cancelled');
  const today = iso(new Date());
  const ganttStart = phasePlans.map((p) => p.plannedStart).filter((x): x is string => Boolean(x)).sort()[0] ?? today;
  const ganttEnd = phasePlans.map((p) => p.plannedEnd).filter((x): x is string => Boolean(x)).sort().at(-1) ?? today;
  const totalDays = Math.max(1, Math.ceil((new Date(ganttEnd).getTime() - new Date(ganttStart).getTime()) / 86400000) + 1);

  return (
    <>
      <div className="page-head"><div><p className="muted"><Link to="/installation-planner">Installation planning</Link> / Scheduling</p><h1>Installation schedule</h1><p className="muted">Book crews, plan dependencies, protect site readiness and learn from actual installation performance.</p></div></div>
      <section className="card">
        <div className="page-actions planner-tabs">
          <button type="button" className={tab === 'gantt' ? 'primary' : ''} onClick={() => setTab('gantt')}>Gantt & scheduling</button>
          <button type="button" className={tab === 'teams' ? 'primary' : ''} onClick={() => setTab('teams')}>Teams & bookings</button>
          <button type="button" className={tab === 'history' ? 'primary' : ''} onClick={() => setTab('history')}>Historical performance</button>
        </div>
        {message && <p className="hint" role="status">{message}</p>}
      </section>

      {tab === 'gantt' && <section className="card">
        <h2>Automatic schedule and rescheduling</h2>
        <div className="form-grid planner-filters">
          <label>Installation project<select value={selected?.id ?? ''} onChange={(e) => setProjectId(e.target.value)}><option value="">Select project</option>{installationProjects.map((p) => <option key={p.id} value={p.id}>{p.projectNo} · {p.title}</option>)}</select></label>
          <label>Earliest project start<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>Working weekdays<select multiple value={calendar.workingWeekdays.map(String)} onChange={(e) => setCalendar((c) => ({ ...c, workingWeekdays: Array.from(e.target.selectedOptions).map((o) => Number(o.value)) }))}><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option><option value="7">Sunday</option></select></label>\n          <label>Public holidays (comma-separated dates)<input type="text" placeholder="2026-01-07, 2026-04-10" value={holidayText} onChange={(e) => setHolidayText(e.target.value)} /></label>
        </div>
        {selected && <p className="muted">Site: {selected.site.name}, {selected.site.city} · {projectUnits.length} linked lift(s)</p>}
        {editable && <button type="button" className="primary" disabled={saving || phases.loading || teams.loading || !selected} onClick={() => void generateSchedule()}>{saving ? 'Scheduling…' : 'Generate / reschedule project'}</button>}
        <p className="hint">Rescheduling replaces this project's future planner bookings and updates its phase dates. Existing bookings for other projects remain protected. Review the proposed timeline and readiness blockers before confirming.</p>
        <div className="table-scroll">
          <table className="data-table"><thead><tr><th>Phase</th><th>Discipline</th><th>Estimated crew-days</th><th>Site readiness</th><th>Dependencies</th><th>Team</th><th>Planned dates</th><th>Actual crew-days</th></tr></thead>
          <tbody>{phasePlans.map((p) => <tr key={p.id}>
            <td>{p.name}</td><td>{p.discipline}</td><td>{p.crewDays || 'No benchmark'}</td>
            <td><label><input type="checkbox" checked={p.requiresSiteReadiness} disabled={!editable} onChange={(e) => void setReadinessRequired(p, e.target.checked)} /> Required</label>{p.requiresSiteReadiness && <label><input type="checkbox" checked={p.siteReady} disabled={!editable} onChange={(e) => void setSiteReady(p, e.target.checked)} /> Approved</label>}</td>
            <td><select multiple aria-label={`Dependencies for ${p.name}`} value={p.dependencies} disabled={!editable} onChange={(e) => void setDependencies(p, Array.from(e.target.selectedOptions).map((o) => o.value))}>{phases.rows.filter((r) => r.id !== p.id && r.seq < (phases.rows.find((x) => x.id === p.id)?.seq ?? 0)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
            <td>{teams.rows.find((t) => t.id === p.assignedTeamId)?.name ?? 'Auto-select'}</td>
            <td>{p.plannedStart ?? '—'} – {p.plannedEnd ?? '—'}</td>
            <td><input aria-label={`Actual crew-days for ${p.name}`} type="number" min="0.5" step="0.5" defaultValue={p.actualCrewDays ?? ''} disabled={!editable} onBlur={(e) => { const v = Number(e.target.value); if (v > 0 && v !== p.actualCrewDays) void recordActual(p, v); }} /></td>
          </tr>)}</tbody></table>
        </div>
        <h3>Timeline</h3>
        <div className="installation-gantt">{phasePlans.map((p) => {
          const start = p.plannedStart ? Math.max(0, (new Date(p.plannedStart).getTime() - new Date(ganttStart).getTime()) / 86400000) : 0;
          const duration = p.plannedStart && p.plannedEnd ? Math.max(1, (new Date(p.plannedEnd).getTime() - new Date(p.plannedStart).getTime()) / 86400000 + 1) : 0;
          return <div className="installation-gantt-row" key={p.id}><span>{p.name}</span><div className="installation-gantt-track"><div className={`installation-gantt-bar ${p.status === 'completed' ? 'is-complete' : ''} ${p.plannedStart ? '' : 'is-blocked'}`} style={{ marginLeft: `${start / totalDays * 100}%`, width: `${duration / totalDays * 100}%` }} title={p.plannedStart ? `${p.plannedStart} to ${p.plannedEnd}` : 'Not scheduled / blocked'} /></div></div>;
        })}</div>
      </section>}

      {tab === 'teams' && <section className="card">
        <h2>Installation teams</h2><p className="muted">Teams are reusable resources. Individual members are checked across team bookings to prevent double allocation.</p>
        <div className="form-grid">
          <label>Team name<input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></label>
          <label>Supervisor<select value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}><option value="">Select supervisor</option>{technicians.rows.filter((t) => t.discipline !== 'service').map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Discipline<select value={discipline} onChange={(e) => setDiscipline(e.target.value as InstallationDiscipline)}><option value="mechanical">Mechanical</option><option value="electrical">Electrical</option><option value="commissioning">Commissioning</option></select></label>
          <label>Members (Ctrl/Cmd-click for multiple)<select multiple value={memberIds} onChange={(e) => setMemberIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>{technicians.rows.filter((t) => t.discipline !== 'service').map((t) => <option key={t.id} value={t.id}>{t.name} · {t.trades.join(', ')}</option>)}</select></label>
        </div>
        {editable && <button type="button" className="primary" disabled={saving || !teamName.trim() || !supervisorId || !memberIds.length} onClick={() => void createTeam()}>Save team</button>}
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Team</th><th>Supervisor</th><th>Discipline</th><th>Members</th><th>Active bookings</th></tr></thead><tbody>{teams.rows.map((t) => <tr key={t.id}><td>{t.name}</td><td>{t.supervisorName}</td><td>{t.disciplines.join(', ')}</td><td>{t.memberIds.map((id) => technicians.rows.find((x) => x.id === id)?.name ?? id).join(', ')}</td><td>{scheduleBookings.filter((b) => b.resourceId === t.id).length}</td></tr>)}</tbody></table></div>
        <h3>Team booking calendar</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Project</th><th>Team</th><th>Phase</th><th>Period</th><th>Discipline</th><th>Status</th></tr></thead><tbody>{scheduleBookings.sort((a,b)=>a.startDate.localeCompare(b.startDate)).map((b) => <tr key={b.id}><td>{projects.rows.find((p) => p.id === b.projectId)?.projectNo ?? b.projectId}</td><td>{b.resourceName}</td><td>{b.phaseId}</td><td>{b.startDate} – {b.endDate}</td><td>{b.discipline}</td><td>{b.status}</td></tr>)}</tbody></table></div>
      </section>}

      {tab === 'history' && <section className="card">
        <h2>Historical installation performance</h2><p className="muted">Only completed phase records with explicitly captured actual crew-days are included. Suggestions use the median, not an invented company target, and do not overwrite management standards.</p>
        <div className="cards"><div className="card stat"><p className="muted">Recorded phase actuals</p><p className="figure">{history.rows.length}</p></div><div className="card stat"><p className="muted">Specification groups</p><p className="figure">{historySummary.length}</p></div></div>
        <div className="table-scroll"><table className="data-table"><thead><tr><th>Discipline</th><th>Lift type</th><th>Stops</th><th>Capacity</th><th>Sample</th><th>Average crew-days</th><th>Median / suggestion</th></tr></thead><tbody>{historySummary.map((row) => <tr key={`${row.discipline}-${row.liftType}-${row.minStops}-${row.minCapacityKg}`}><td>{row.discipline}</td><td>{row.liftType}</td><td>{row.minStops}</td><td>{row.minCapacityKg} kg</td><td>{row.sampleSize}</td><td>{row.averageCrewDays.toFixed(1)}</td><td>{row.suggestedCrewDays.toFixed(1)}</td></tr>)}{historySummary.length === 0 && <tr><td colSpan={7} className="muted">No validated historical actuals yet. Record actual crew-days against completed one-lift project phases to start building benchmarks.</td></tr>}</tbody></table></div>
      </section>}
    </>
  );
}
