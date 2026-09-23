/**
 * Change what a record belongs to, from wherever you happen to be looking.
 *
 * WHY IT SAVES IN PLACE RATHER THAN OPENING A FORM
 *   Correcting one wrong link used to mean finding the record in its own list,
 *   opening the form, changing one field and saving the other twenty — which
 *   is how somebody ends up hunting through four pages to fix one detail.
 *   Here the link is the control: pick, and it is written.
 *
 * THE CONFIRMATION IS THE SENTENCE, NOT A DIALOG
 *   Moving a lift to another client moves its service history with it. Rather
 *   than an "are you sure" nobody reads, the change is named in words —
 *   "Change the client from Addis Towers PLC to Ayat Real Estate" — and
 *   confirmed with a button that repeats it.
 */

import { useState } from 'react';
import { relink } from '../data/relink.js';
import { describeFirestoreError } from '../data/repository.js';
import {
  canClear,
  describeRelink,
  isChange,
  LINK_NOUN,
  type LinkKind,
  type LinkTarget,
} from '../lib/relink.js';

export interface LinkOption {
  id: string;
  label: string;
  /** Shown after the label in lighter type, e.g. a client name. */
  hint?: string;
}

export function LinkPicker({
  kind,
  recordId,
  currentId,
  currentLabel,
  options,
  uid,
  editable,
  onDone,
}: {
  kind: LinkKind;
  recordId: string;
  currentId: string | null | undefined;
  /** What the link currently points at, for the sentence. */
  currentLabel: string | null;
  options: readonly LinkOption[];
  uid: string | null;
  editable: boolean;
  /** Called after a successful write, so the page can refresh. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!editable || uid === null) return null;

  const target: LinkTarget | null =
    picked === ''
      ? null
      : { id: picked, label: options.find((o) => o.id === picked)?.label ?? picked };

  const changed = isChange(currentId, target?.id ?? null);

  async function save() {
    if (!changed) { setOpen(false); return; }
    setBusy(true);
    setError(null);
    try {
      await relink(kind, recordId, target, uid as string);
      setOpen(false);
      onDone?.();
    } catch (cause) {
      setError(describeFirestoreError(cause, `change the ${LINK_NOUN[kind]}`));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="link-change no-print"
        onClick={() => {
          setPicked(currentId ?? '');
          setError(null);
          setOpen(true);
        }}
      >
        {currentId === null || currentId === undefined ? `Set ${LINK_NOUN[kind]}` : 'Change'}
      </button>
    );
  }

  /* Every element here is phrasing content, and deliberately so: the picker is
     rendered inside the paragraph that carries the link it changes, and a <div>
     or a <p> in there is invalid HTML. Spans blockified by the grid lay out
     identically without breaking the document. */
  return (
    <span className="link-edit no-print">
      <label className="visually-hidden" htmlFor={`link-${kind}-${recordId}`}>
        Choose the {LINK_NOUN[kind]}
      </label>
      <select
        id={`link-${kind}-${recordId}`}
        value={picked}
        disabled={busy}
        onChange={(event) => setPicked(event.target.value)}
      >
        {/* Offered only where the link is allowed to be empty — a project with
            no client is not a state this app should be able to reach. */}
        {canClear(kind) && <option value="">— none —</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
            {option.hint === undefined ? '' : ` · ${option.hint}`}
          </option>
        ))}
      </select>

      <span className="muted link-says">{describeRelink(kind, currentLabel, target)}</span>

      {error !== null && <span className="error" role="alert">{error}</span>}

      <span className="link-actions">
        <button type="button" className="primary" disabled={busy || !changed} onClick={() => void save()}>
          {busy ? 'Saving…' : changed ? 'Save the change' : 'No change'}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </span>
  );
}
