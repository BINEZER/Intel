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
import { setPhaseBlocked, updatePhaseProgress } from '../data/projects.js';
import { useAsyncAction } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { nextActionablePhase, sequenceWarnings, type PhaseStatus } from '../lib/phases.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../lib/stages.js';
import { DualDateText } from './DualDateInput.js';
import type { ProjectPhase } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

// Dependencies come from the FOURTEEN-stage template, which is what projects are
// actually seeded with. Reading them from the old five-phase template meant the
// keys never matched and out-of-sequence work was silently never flagged.
// Stages a manager added by hand have no dependencies — nothing knows where
// they sit in the chain, and guessing would produce warnings nobody can act on.
const DEPENDS_ON = new Map(ELEVATOR_STAGE_TEMPLATE.map((s) => [s.key as string, s.dependsOn as readonly string[]]));

export function PhaseTracker({
  projectId,
  phases,
}: {
  projectId: string;
  phases: readonly WithId<ProjectPhase>[];
}) {
  const { user, role } = useAuth();
  const editable = can(role, 'updatePhaseProgress');
  const { busy, error, run } = useAsyncAction('update this phase');

  const withDeps = phases.map((p) => ({
    key: p.key,
    weightBps: p.weightBps,
    progressBps: p.progressBps,
    status: p.status,
    dependsOn: DEPENDS_ON.get(p.key) ?? [],
  }));
  const warnings = new Map(sequenceWarnings(withDeps).map((w) => [w.key, w]));
  const next = nextActionablePhase(withDeps);

  return (
    <section className="card">
      <h2>Phases</h2>
      {next !== null && (
        <p className="muted">
          Next up: <strong>{phases.find((p) => p.key === next.key)?.name ?? next.key}</strong>
        </p>
      )}
      {error && <p className="error" role="alert">{error}</p>}

      <ul className="phase-list">
        {phases.map((phase) => (
          <PhaseRow
            key={phase.id}
            projectId={projectId}
            phase={phase}
            warning={warnings.get(phase.key)?.message ?? null}
            editable={editable && user !== null}
            uid={user?.uid ?? ''}
            busy={busy}
            run={run}
          />
        ))}
      </ul>
    </section>
  );
}

function PhaseRow({
  projectId,
  phase,
  warning,
  editable,
  uid,
  busy,
  run,
}: {
  projectId: string;
  phase: WithId<ProjectPhase>;
  warning: string | null;
  editable: boolean;
  uid: string;
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T | null>;
}) {
  // Local draft so dragging the slider does not fire a write per pixel.
  const [draft, setDraft] = useState(phase.progressBps);
  const dirty = draft !== phase.progressBps;

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
          <strong>{phase.seq}. {phase.name}</strong>
          <span className="muted"> · {formatBps(phase.weightBps, 0)} of the project</span>
        </div>
        <span className={statusClass[phase.status]}>{phase.status.replace(/_/g, ' ')}</span>
      </div>

      {warning !== null && <p className="warn-text">⚠ {warning}</p>}

      <div className="phase-progress">
        <input
          type="range"
          min={0}
          max={10_000}
          step={500}
          value={draft}
          disabled={!editable || busy}
          aria-label={`${phase.name} progress`}
          onChange={(e) => setDraft(Number(e.target.value))}
        />
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
