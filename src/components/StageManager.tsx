/**
 * Editing a project's stage list.
 *
 * The fourteen standard stages fit a typical supply-and-install job. Real ones
 * differ — a refurbishment adds demolition, a lift from local stock never sees
 * customs, one client insists on a witnessed load test nobody else asks for — so
 * the list is the manager's to change.
 *
 * What the manager never has to do is the arithmetic. Weights must total 100%
 * for "62% complete" to mean anything, so every edit here rebalances the others
 * automatically and says, in plain words, what it did.
 */

import { useEffect, useState } from 'react';
import { can } from '../auth/roles.js';
import { useAuth } from '../auth/AuthProvider.js';
import {
  addProjectStage,
  moveProjectStage,
  normaliseProjectStageWeights,
  removeProjectStage,
  renameProjectStage,
  setProjectStageWeight,
} from '../data/projects.js';
import { useAsyncAction } from '../data/useCollection.js';
import { getMilestones, setMilestoneSchedule } from '../data/contracts.js';
import { updatePhaseCheckpoints } from '../data/projects.js';
import { formatBps } from '../lib/kpi.js';
import { TOTAL_BPS, weightsTotal } from '../lib/stage-edit.js';
import { stageOwner } from '../lib/stages.js';
import type { PaymentMilestone, ProjectPhase } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const OWNER_LABEL: Record<ReturnType<typeof stageOwner>, string> = {
  us: 'Us',
  client: 'Client',
  supplier: 'Supplier',
  authority: 'Authority',
};

export function StageManager({
  projectId,
  phases,
  paymentsByPhase,
  contractId,
}: {
  projectId: string;
  phases: readonly WithId<ProjectPhase>[];
  paymentsByPhase: ReadonlyMap<string, string[]>;
  contractId: string | null;
}) {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  const { busy, error, run } = useAsyncAction('change the stages');
  const [note, setNote] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<WithId<PaymentMilestone>[]>([]);
  const [substepDrafts, setSubstepDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    if (contractId === null) { setMilestones([]); return () => { cancelled = true; }; }
    void getMilestones(contractId).then((rows) => { if (!cancelled) setMilestones(rows); })
      .catch(() => { if (!cancelled) setMilestones([]); });
    return () => { cancelled = true; };
  }, [contractId]);
  const uid = user?.uid ?? '';

  const total = weightsTotal(
    phases.map((p) => ({ id: p.id, seq: p.seq, key: p.key, name: p.name, weightBps: p.weightBps, progressBps: p.progressBps })),
  );
  const drifted = total !== TOTAL_BPS;

  /** Every edit returns the sentence describing what it did; show that, not "Saved". */
  const apply = (fn: () => Promise<{ note: string }>) =>
    void run(async () => {
      const result = await fn();
      setNote(result.note);
      setConfirmingId(null);
      return result;
    });

  if (!editable) {
    return (
      <section className="card stage-manager-panel">
        <h2>Project stages</h2>
        <p className="muted">This project has {phases.length} stages. Your account can view them, but only an admin or manager can change the stage list.</p>
        <ol className="stage-readonly-list">
          {phases.map((phase) => <li key={phase.id}>{phase.seq}. {phase.name} <span className="muted">· {formatBps(phase.weightBps, 0)}</span></li>)}
        </ol>
      </section>
    );
  }

  return (
    <section className="card stage-manager-panel">
      <div className="stage-manager-heading">
        <h2>Manage project stages</h2>
        <span className="muted">
          {phases.length} stages · {formatBps(total, 0)} of the project
          {drifted ? ' — does not add up to 100%' : ''}
        </span>
      </div>

        <p className="muted">
          Add work this job needs, delete work it does not, and set what each stage is worth.
          The other stages are adjusted automatically so the total always comes to 100%.
        </p>

        {error !== null && <p className="error" role="alert">{error}</p>}
        {note !== null && <p className="note" role="status">{note}</p>}

        {drifted && (
          <p className="warn-text">
            ⚠ These stages add up to {formatBps(total, 0)}, not 100%, so this project's progress figure is
            understating or overstating the work.{' '}
            <button type="button" disabled={busy} onClick={() => apply(() => normaliseProjectStageWeights(projectId, uid))}>
              Fix the weights
            </button>
          </p>
        )}

        <div className="table-scroll">
          <table className="stage-table">
            <caption className="sr-only">Project stages, their share of the work, and who has to move</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Stage</th>
                <th scope="col">Share of project</th>
                <th scope="col">Waiting on</th>
                <th scope="col">Payment</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {phases.map((phase, index) => {
                const payments = paymentsByPhase.get(phase.id) ?? [];
                const assignedMilestones = milestones.filter((m) => m.phaseId === phase.id);
                return (
                  <tr key={phase.id}>
                    <td className="num">{phase.seq}</td>
                    <td>
                      <StageNameField
                        name={phase.name}
                        busy={busy}
                        onSave={(name) => apply(() => renameProjectStage(projectId, phase.id, name, uid))}
                      />
                    </td>
                    <td>
                      <StageWeightField
                        name={phase.name}
                        weightBps={phase.weightBps}
                        busy={busy}
                        onSave={(weightBps) => apply(() => setProjectStageWeight(projectId, phase.id, weightBps, uid))}
                      />
                    </td>
                    <td><span className="chip">{OWNER_LABEL[stageOwner(phase.key)]}</span></td>
                    <td>
                      {contractId === null ? <span className="muted">Link a contract first</span> : (
                        <div className="stage-payment-links">
                          {milestones.map((milestone) => (
                            <label key={milestone.id} className="stage-payment-option">
                              <input
                                type="checkbox"
                                checked={milestone.phaseId === phase.id}
                                disabled={busy || (milestone.phaseId !== undefined && milestone.phaseId !== phase.id)}
                                onChange={(event) => {
                                  const phaseId = event.target.checked ? phase.id : null;
                                  void run(async () => {
                                    await setMilestoneSchedule(contractId, milestone.id, { phaseId }, uid);
                                    setMilestones(await getMilestones(contractId));
                                    return { note: event.target.checked
                                      ? "Linked " + milestone.name + " to " + phase.name + "."
                                      : "Unlinked " + milestone.name + "." };
                                  });
                                }}
                              />
                              <span>{milestone.name} · {formatBps(milestone.shareBps, 0)}</span>
                            </label>
                          ))}
                          {milestones.length === 0 && <span className="muted">No payment milestones on this contract</span>}
                        </div>
                      )}
                      {assignedMilestones.length > 0 && <span className="muted">{assignedMilestones.length} linked</span>}
                    </td>
                    <td className="stage-actions">
                      <button
                        type="button"
                        disabled={busy || index === 0}
                        aria-label={`Move ${phase.name} earlier`}
                        onClick={() => apply(() => moveProjectStage(projectId, phase.id, 'up', uid))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={busy || index === phases.length - 1}
                        aria-label={`Move ${phase.name} later`}
                        onClick={() => apply(() => moveProjectStage(projectId, phase.id, 'down', uid))}
                      >
                        ↓
                      </button>
                      {confirmingId === phase.id ? (
                        <>
                          <button
                            type="button"
                            className="danger"
                            disabled={busy}
                            onClick={() => apply(() => removeProjectStage(projectId, phase.id, uid, payments))}
                          >
                            Delete for good
                          </button>
                          <button type="button" disabled={busy} onClick={() => setConfirmingId(null)}>Keep</button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Delete ${phase.name}`}
                          onClick={() => { setNote(null); setConfirmingId(phase.id); }}
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="stage-substeps">
          <h3>Stage sub-steps</h3>
          <p className="muted">Add one sub-step per line. Completed sub-steps are preserved when their names are retained.</p>
          {phases.map((phase) => {
            const current = phase.checkpoints ?? [];
            const draft = substepDrafts[phase.id] ?? current.map((item) => item.label).join('\\n');
            return (
              <div className="stage-substep-editor" key={phase.id}>
                <label>
                  <strong>{phase.seq}. {phase.name}</strong>
                  <textarea
                    rows={Math.max(2, Math.min(6, draft.split('\\n').length))}
                    value={draft}
                    disabled={busy}
                    placeholder="Enter each sub-step on a new line"
                    onChange={(event) => setSubstepDrafts((old) => ({ ...old, [phase.id]: event.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || draft.split('\\n').map((v) => v.trim()).filter(Boolean).join('\\n') === current.map((item) => item.label).join('\\n')}
                  onClick={() => apply(async () => {
                    await updatePhaseCheckpoints(projectId, phase.id, draft.split('\\n'), uid);
                    setSubstepDrafts((old) => { const next = { ...old }; delete next[phase.id]; return next; });
                    return { note: "Updated sub-steps for " + phase.name + "." };
                  })}
                >Save sub-steps</button>
              </div>
            );
          })}
        </div>

        {confirmingId !== null && (
          <p className="warn-text">
            Deleting <strong>{phases.find((p) => p.id === confirmingId)?.name}</strong> also deletes the progress
            recorded against it. Its share of the work is spread over the remaining stages.
          </p>
        )}

        <AddStageForm projectId={projectId} phases={phases} busy={busy} uid={uid} onDone={apply} />
    </section>
  );
}

/** Rename in place. Saves on blur or Enter; Escape puts the old name back. */
function StageNameField({
  name,
  busy,
  onSave,
}: {
  name: string;
  busy: boolean;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(name);
  const dirty = draft.trim() !== name && draft.trim() !== '';

  return (
    <input
      type="text"
      className="inline-edit"
      value={draft}
      disabled={busy}
      aria-label={`Name of stage ${name}`}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && dirty) onSave(draft);
        if (e.key === 'Escape') setDraft(name);
      }}
      onBlur={() => (dirty ? onSave(draft) : setDraft(name))}
    />
  );
}

/**
 * Weight in whole percent, because that is how the number is discussed. Stored
 * in basis points, so a rebalanced stage can hold a share like 7.43% without
 * the display forcing it to a round number it is not.
 */
function StageWeightField({
  name,
  weightBps,
  busy,
  onSave,
}: {
  name: string;
  weightBps: number;
  busy: boolean;
  onSave: (weightBps: number) => void;
}) {
  const [draft, setDraft] = useState(String(weightBps / 100));
  const parsed = Math.round(Number(draft) * 100);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= TOTAL_BPS;
  const dirty = valid && parsed !== weightBps;

  return (
    <span className="weight-field">
      <input
        type="number"
        className="inline-edit num"
        min={0.01}
        max={100}
        step={0.5}
        value={draft}
        disabled={busy}
        aria-label={`Share of the project for ${name}, in percent`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && dirty) onSave(parsed);
          if (e.key === 'Escape') setDraft(String(weightBps / 100));
        }}
      />
      <span aria-hidden="true">%</span>
      {dirty && (
        <button type="button" className="primary" disabled={busy} onClick={() => onSave(parsed)}>
          Save
        </button>
      )}
    </span>
  );
}

function AddStageForm({
  projectId,
  phases,
  busy,
  uid,
  onDone,
}: {
  projectId: string;
  phases: readonly WithId<ProjectPhase>[];
  busy: boolean;
  uid: string;
  onDone: (fn: () => Promise<{ note: string }>) => void;
}) {
  const [name, setName] = useState('');
  const [percent, setPercent] = useState('5');
  const [afterId, setAfterId] = useState<string>(phases[phases.length - 1]?.id ?? '');

  const weightBps = Math.round(Number(percent) * 100);
  const ready = name.trim() !== '' && Number.isFinite(weightBps) && weightBps >= 1;

  return (
    <form
      className="add-stage"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onDone(async () => {
          const result = await addProjectStage(
            projectId,
            { name: name.trim(), weightBps, afterId: afterId === '' ? null : afterId },
            uid,
          );
          setName('');
          return result;
        });
      }}
    >
      <h3>Add a stage</h3>
      <div className="form-row">
        <label>
          What happens
          <input
            type="text"
            value={name}
            disabled={busy}
            placeholder="e.g. Shaft modification works"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Share of the project
          <span className="weight-field">
            <input
              type="number"
              className="num"
              min={0.01}
              max={100}
              step={0.5}
              value={percent}
              disabled={busy}
              onChange={(e) => setPercent(e.target.value)}
            />
            <span aria-hidden="true">%</span>
          </span>
        </label>
        <label>
          Comes after
          <select value={afterId} disabled={busy} onChange={(e) => setAfterId(e.target.value)}>
            <option value="">(first stage of the project)</option>
            {phases.map((phase) => (
              <option key={phase.id} value={phase.id}>{phase.seq}. {phase.name}</option>
            ))}
          </select>
        </label>
      </div>
      <button type="submit" className="primary" disabled={busy || !ready}>Add stage</button>
    </form>
  );
}
