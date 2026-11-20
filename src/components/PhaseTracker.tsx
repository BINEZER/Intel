/**
 * Phase progress tracker.
 *
 * Engineers move the slider; the project total re-rolls on save. Out-of-sequence
 * work is flagged but never blocked — real sites overlap, and software that
 * refuses to record what is actually happening just gets worked around.
 */

import { useState } from 'react';
import { can } from '../auth/roles.js';
import { useAuth } from '../auth/AuthProvider.js';
import { addProjectStage, setCheckpoint, setPhaseBlocked, setPhasesCompletion, updateProjectStage, updatePhaseProgress } from '../data/projects.js';
import { describeCheckpoints, isTracked, phaseProgressBps as getPhaseProgressBps } from '../lib/checkpoints.js';
import { useAsyncAction } from '../data/useCollection.js';
import { WORKBOOK_SOURCE } from '../lib/stage-backfill.js';
import { formatBps } from '../lib/kpi.js';
import { nextActionablePhase, type PhaseStatus } from '../lib/phases.js';
import { DualDateText } from './DualDateInput.js';
import type { ProjectPhase } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function PhaseTracker({
  projectId,
  phases,
}: {
  projectId: string;
  phases: readonly WithId<ProjectPhase>[];
}) {
  const { user, role } = useAuth();
  const editable = can(role, 'updatePhaseProgress');
  const canManageStages = can(role, 'manageProjects');
  const { busy, error, run } = useAsyncAction('update this phase');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newWeight, setNewWeight] = useState('5');

  const withDeps = phases.map((p) => ({ key: p.key, weightBps: p.weightBps, progressBps: p.progressBps, status: p.status, dependsOn: [] as string[] }));
  const next = nextActionablePhase(withDeps);
  const allComplete = phases.length > 0 && phases.every((phase) => getPhaseProgressBps(phase) === 10_000);

  return (
    <section className="card">
      <div className="phase-section-head">
        <div><h2>Phases</h2><p className="muted">Phase weights determine each phase’s contribution to overall project progress. Total: 100%.</p></div>
        {canManageStages && user !== null && <button type="button" className="quiet-button" disabled={busy} onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Add phase'}</button>}
        {editable && user !== null && (
          <label className="collective-phase-check">
            <input
              type="checkbox"
              checked={allComplete}
              disabled={busy || phases.length === 0}
              onChange={(event) => void run(() => setPhasesCompletion(projectId, phases.map((phase) => phase.id), event.target.checked, user.uid))}
            />
            <span>Complete entire project</span>
          </label>
        )}
      </div>
      {next !== null && (
        <p className="muted">
          Next up: <strong>{phases.find((p) => p.key === next.key)?.name ?? next.key}</strong>
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {adding && canManageStages && user !== null && <div className="phase-add-form">
        <label>Phase name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Shaft modification" /></label>
        <label>Weight (% of project)<input type="number" min="0.01" max="99.99" step="0.01" value={newWeight} onChange={(e) => setNewWeight(e.target.value)} /></label>
        <button type="button" className="primary" disabled={busy || !newName.trim() || !Number.isFinite(Number(newWeight)) || Number(newWeight) <= 0 || Number(newWeight) >= 100} onClick={() => void run(async () => { await addProjectStage(projectId, { name: newName.trim(), weightBps: Math.round(Number(newWeight) * 100), afterId: phases[phases.length - 1]?.id ?? null }, user.uid); setNewName(''); setAdding(false); return true; })}>Add phase</button>
      </div>}

      <ul className="phase-list">
        {phases.map((phase) => (
          <PhaseRow
            key={phase.id}
            projectId={projectId}
            phase={phase}
            editable={editable && user !== null}
            uid={user?.uid ?? ''}
            busy={busy}
            run={run}
            onToggleComplete={(done) => setPhasesCompletion(projectId, [phase.id], done, user?.uid ?? '')}
          />
        ))}
      </ul>
    </section>
  );
}

function PhaseRow({
  projectId,
  phase,
  editable,
  uid,
  busy,
  run,
  onToggleComplete,
}: {
  projectId: string;
  phase: WithId<ProjectPhase>;
  editable: boolean;
  uid: string;
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
  onToggleComplete: (done: boolean) => Promise<unknown>;
}) {
  // Local draft so dragging the slider does not fire a write per pixel. Only a
  // hand-made stage still has a slider; see below.
  const [draft, setDraft] = useState(phase.progressBps);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(phase.name);
  const [weightDraft, setWeightDraft] = useState((phase.weightBps / 100).toString());
  const dirty = draft !== phase.progressBps;
  const tracked = isTracked(phase);

  const statusClass: Record<PhaseStatus, string> = {
    not_started: 'chip',
    in_progress: 'chip chip-active',
    blocked: 'chip chip-blocked',
    completed: 'chip chip-ok',
  };

  return (
    <li className={`phase-row ${phase.status === 'blocked' ? 'is-blocked' : ''}`}>
      <div className="phase-head">
        <div>
          <label className="phase-complete-check">
            <input
              type="checkbox"
              checked={getPhaseProgressBps(phase) === 10_000}
              disabled={!editable || busy}
              aria-label={`Mark phase ${phase.seq}, ${phase.name}, complete`}
              onChange={(event) => void run(() => onToggleComplete(event.target.checked))}
            />
            <strong>{phase.seq}. {phase.name}</strong>
          </label>
          <span className="muted"> · {formatBps(phase.weightBps, 0)} of the project</span>
        </div>
        <div className="phase-row-actions">
          {editable && <button type="button" className="quiet-button" disabled={busy} onClick={() => { setNameDraft(phase.name); setWeightDraft((phase.weightBps / 100).toString()); setEditingName((v) => !v); }}>Edit phase</button>}
          <span className={statusClass[phase.status]}>{phase.status.replace(/_/g, ' ')}</span>
        </div>
      </div>


      {editingName && editable && <div className="phase-edit-form">
        <label>Phase name<input aria-label={`Phase ${phase.seq} name`} value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} /></label>
        <label>Weight (% of project)<input aria-label={`Phase ${phase.seq} weight`} type="number" min="0.01" max="99.99" step="0.01" value={weightDraft} onChange={(e) => setWeightDraft(e.target.value)} /></label>
        <button type="button" className="primary" disabled={busy || !nameDraft.trim() || !Number.isFinite(Number(weightDraft)) || Number(weightDraft) <= 0 || Number(weightDraft) >= 100} onClick={() => void run(async () => { await updateProjectStage(projectId, phase.id, { name: nameDraft.trim(), weightBps: Math.round(Number(weightDraft) * 100) }, uid); setEditingName(false); return true; })}>Save phase</button>
        <button type="button" disabled={busy} onClick={() => setEditingName(false)}>Cancel</button>
        <p className="muted">Changing this weight automatically adjusts the other phases so all phase weights remain exactly 100%.</p>
      </div>}

      {tracked ? (
        <CheckpointList
          projectId={projectId}
          phase={phase}
          editable={editable}
          uid={uid}
          busy={busy}
          run={run}
        />
      ) : (
        <div className="phase-progress">
          {/* Only a stage somebody added by hand gets here. Everything on an
              elevator project is ticked off rather than estimated. */}
          <label className="phase-manual-progress">Completion (%)
            <input type="number" min="0" max="100" step="1" value={draft / 100}
              disabled={!editable || busy} aria-label={`${phase.name} completion percentage`}
              onChange={(e) => setDraft(Math.min(10_000, Math.max(0, Math.round(Number(e.target.value || 0) * 100))))} />
          </label>
          <input type="range" min={0} max={10_000} step={100} value={draft} disabled={!editable || busy}
            aria-label={`${phase.name} progress slider`} onChange={(e) => setDraft(Number(e.target.value))} />
          <span className="phase-pct">{formatBps(draft, 0)}</span>
          {dirty && editable && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void run(() => updatePhaseProgress(projectId, phase.id, draft, uid))}
            >
              Save
            </button>
          )}
        </div>
      )}

      <div className="phase-progress">
        {editable && (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(() =>
                setPhaseBlocked(projectId, phase.id, phase.status !== 'blocked', phase.progressBps, uid),
              )
            }
          >
            {phase.status === 'blocked' ? 'Unblock' : 'Block'}
          </button>
        )}
      </div>

      <p className="muted phase-dates">
        Planned <DualDateText value={phase.plannedStart} /> → <DualDateText value={phase.plannedEnd} />
        {phase.actualEnd !== null && (
          <> · Completed <DualDateText value={phase.actualEnd} /></>
        )}
      </p>
    </li>
  );
}

/**
 * The stage's checkpoints, as things to tick.
 *
 * Each tick writes immediately and re-rolls the project figure, because the
 * alternative — tick several, then press Save — invites somebody to tick four
 * boxes, get interrupted, and lose them. A checkpoint is one fact; recording it
 * should cost one click.
 */
function CheckpointList({
  projectId,
  phase,
  editable,
  uid,
  busy,
  run,
}: {
  projectId: string;
  phase: WithId<ProjectPhase>;
  editable: boolean;
  uid: string;
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
}) {
  const checkpoints = phase.checkpoints ?? [];
  const done = checkpoints.filter((c) => c.doneAt !== null).length;

  return (
    <div className="checkpoints">
      <div className="checkpoint-head">
        <span className="muted">{describeCheckpoints(checkpoints)}</span>
        <span className="phase-pct">{formatBps(phase.progressBps, 0)}</span>
      </div>
      <div
        className="checkpoint-bar"
        role="img"
        aria-label={`${done} of ${checkpoints.length} checkpoints complete`}
      >
        <span style={{ width: `${(done / Math.max(1, checkpoints.length)) * 100}%` }} />
      </div>
      <ul className="checkpoint-list">
        {checkpoints.map((checkpoint) => (
          <li key={checkpoint.key}>
            <label className={checkpoint.doneAt === null ? undefined : 'is-done'}>
              <input
                type="checkbox"
                checked={checkpoint.doneAt !== null}
                disabled={!editable || busy}
                onChange={(event) =>
                  void run(() =>
                    setCheckpoint(projectId, phase.id, checkpoint.key, event.target.checked, uid),
                  )
                }
              />
              <span>{checkpoint.label}</span>
              {/* A tick that came from the spreadsheet is not a sign-off. It
                  says so, so nobody reads a back-filled job as one somebody
                  walked round and checked. */}
              {checkpoint.doneBy === WORKBOOK_SOURCE && (
                <span className="chip from-workbook" title="Marked from the imported workbook, not signed off on site">
                  from the workbook
                </span>
              )}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
