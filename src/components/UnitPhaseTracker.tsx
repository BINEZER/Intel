import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { updateUnit } from '../data/units.js';
import { useAsyncAction } from '../data/useCollection.js';
import type { ElevatorUnit } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { formatBps } from '../lib/kpi.js';

/** Optional independent progress for each machine; project-level phases remain unchanged. */
export function UnitPhaseTracker({ unit }: { unit: WithId<ElevatorUnit> }) {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  const phases = unit.installationPhases ?? [];
  const { busy, error, run } = useAsyncAction('save lift installation phases');
  const [newName, setNewName] = useState('');

  async function save(next: NonNullable<ElevatorUnit['installationPhases']>) {
    if (user === null) return;
    await run(() => updateUnit(unit.id, { installationPhases: next }, user.uid));
  }

  return (
    <section className="card">
      <h2>Installation phases for this lift</h2>
      <p className="muted">Track this lift independently when lifts in the same project progress at different speeds. This does not change the project's overall phase tracker.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {unit.installationPhases === undefined ? (
        editable ? <button type="button" className="primary" disabled={busy} onClick={() => void save([
          { id: 'shaft', name: 'Shaft preparation', progressBps: 0 },
          { id: 'rails', name: 'Rail installation', progressBps: 0 },
          { id: 'assembly', name: 'Lift assembly', progressBps: 0 },
          { id: 'testing', name: 'Testing & commissioning', progressBps: 0 },
          { id: 'handover', name: 'Inspection & handover', progressBps: 0 },
        ])}>Track this lift separately</button> : <p className="muted">Following project-level phases.</p>
      ) : (
        <>
          {phases.length === 0 && <p className="muted">No phases yet. Add the phases needed for this lift.</p>}
          <ul className="phase-list">
            {phases.map((phase) => (
              <li key={phase.id} className="phase-row">
                <div className="field">
                  <label htmlFor={`unit-phase-name-${unit.id}-${phase.id}`}>Phase</label>
                  <input id={`unit-phase-name-${unit.id}-${phase.id}`} defaultValue={phase.name} disabled={!editable || busy}
                    onBlur={(e) => { const name=e.target.value.trim(); if(name && name!==phase.name) void save(phases.map(p=>p.id===phase.id?{...p,name}:p)); }} />
                </div>
                <div className="phase-progress">
                  <input type="range" min={0} max={10000} step={500} value={phase.progressBps} disabled={!editable || busy}
                    aria-label={`${phase.name} progress`}
                    onChange={(e) => { const progressBps=Number(e.target.value); void save(phases.map(p=>p.id===phase.id?{...p,progressBps}:p)); }} />
                  <span className="phase-pct">{formatBps(phase.progressBps,0)}</span>
                  {editable && <button type="button" disabled={busy} onClick={() => void save(phases.filter(p=>p.id!==phase.id))}>Remove</button>}
                </div>
              </li>
            ))}
          </ul>
          {editable && (
            <form className="add-stage" onSubmit={(e) => { e.preventDefault(); const name=newName.trim(); if(!name) return; void save([...phases,{id: crypto.randomUUID(),name,progressBps:0}]).then(()=>setNewName('')); }}>
              <label>New phase <input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="e.g. Door alignment" /></label>
              <button type="submit" className="primary" disabled={busy || !newName.trim()}>Add phase</button>
              <button type="button" disabled={busy} onClick={() => void save([])}>Clear phases</button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
