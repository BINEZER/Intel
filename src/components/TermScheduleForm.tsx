/**
 * Dating a payment term and tying it to the stage that releases it.
 *
 * The two things that make a term visible to the rest of the app. A term with a
 * date becomes ready to invoice when the date arrives; a term tied to a stage
 * becomes ready when the stage is complete. Imported contracts carry neither, and
 * this is how they get one — one term at a time, from the contract it belongs to.
 */

import { useState, type FormEvent } from 'react';
import { setMilestoneSchedule } from '../data/contracts.js';
import { useAsyncAction } from '../data/useCollection.js';
import { FormPanel } from './FormPanel.js';
import { DualDateInput } from './DualDateInput.js';
import { termScheduleRights } from '../lib/milestones.js';
import { formatETB } from '../lib/money.js';
import type { WithId } from '../data/repository.js';
import type { DualDate, PaymentMilestone } from '../lib/schema.js';

export interface StageChoice {
  id: string;
  label: string;
}

export function TermScheduleForm({
  contractId,
  term,
  stages,
  uid,
  onDone,
}: {
  contractId: string;
  term: WithId<PaymentMilestone>;
  stages: readonly StageChoice[];
  uid: string;
  onDone: () => void;
}) {
  const rights = termScheduleRights(term.status);
  const { busy, error, run } = useAsyncAction('save this payment term');
  const [dueDate, setDueDate] = useState<DualDate | null>(term.dueDate ?? null);
  const [phaseId, setPhaseId] = useState(term.phaseId ?? '');

  // A term can name a stage that has since been deleted. Keep it selectable so the
  // select is never left blank (which would make the browser refuse to submit),
  // and say what it is.
  const known = stages.some((s) => s.id === phaseId);
  const options: StageChoice[] =
    phaseId !== '' && !known ? [{ id: phaseId, label: 'A stage that no longer exists' }, ...stages] : [...stages];

  const dateChanged =
    (dueDate?.at.toMillis() ?? null) !== (term.dueDate?.at.toMillis() ?? null);
  const stageChanged = phaseId !== (term.phaseId ?? '');
  const changed = (rights.date && dateChanged) || (rights.stage && stageChanged);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!changed) return;
    const done = await run(async () => {
      await setMilestoneSchedule(
        contractId,
        term.id,
        {
          ...(rights.date && dateChanged ? { dueDate } : {}),
          ...(rights.stage && stageChanged ? { phaseId: phaseId === '' ? null : phaseId } : {}),
        },
        uid,
      );
      return true;
    });
    if (done !== null) onDone();
  }

  return (
    <FormPanel
      title={`Schedule ${term.name}`}
      description={`${formatETB(term.grossSantim)} with VAT · ${term.status.replace(/_/g, ' ')}. A term with a date becomes ready to invoice when the date arrives; a term tied to a stage, when that stage is complete.`}
      onClose={onDone}
    >
      <form onSubmit={(event) => void submit(event)}>
        {rights.reason !== null && <p className="muted">{rights.reason} Its schedule is no longer changed.</p>}
        {error !== null && <p className="error" role="alert">{error}</p>}

        <div className="form-grid">
          {rights.date && (
            <DualDateInput
              label="Falls due"
              value={dueDate}
              onChange={setDueDate}
              hint="Leave empty for no date. The term is then released only by its stage."
            />
          )}

          {rights.stage && (
            <div className="field">
              <label htmlFor="term-stage">Released by stage</label>
              <select id="term-stage" value={phaseId} onChange={(e) => setPhaseId(e.target.value)}>
                <option value="">Not tied to a stage</option>
                {options.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              {stages.length === 0 && (
                <p className="hint">This contract has no project with stages yet, so there is nothing to tie it to.</p>
              )}
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !changed || (!rights.date && !rights.stage)}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
