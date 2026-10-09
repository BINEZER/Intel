/**
 * Delete, with the consequences shown before the act rather than after.
 *
 * The confirm step is not a formality. It is where the reference check runs,
 * so the second click is made knowing either what the delete takes with it, or
 * why it will not happen. A dialog that only says "are you sure?" teaches
 * people to click through it; one that says "this contract still has 4
 * projects and 2 invoices against it" is read.
 *
 * The check runs when the button is FIRST pressed, not on render: it costs
 * several reads, and a list of two hundred clients must not fire six hundred
 * count queries to draw its rows.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { assessTarget, deleteTarget, type DeletionTarget } from '../data/deletion.js';
import { describeFirestoreError } from '../data/repository.js';
import type { DeletionVerdict } from '../lib/deletion.js';

export function DeleteButton({
  target,
  onDeleted,
  label = 'Delete',
}: {
  target: DeletionTarget;
  onDeleted?: () => void;
  label?: string;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<DeletionVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setOpen(true);
    setError(null);
    setVerdict(null);
    setBusy(true);
    try {
      setVerdict(await assessTarget(target));
    } catch (cause) {
      setError(describeFirestoreError(cause, `check what depends on ${target.name}`));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(force = false) {
    if (user === null) return;
    setBusy(true);
    setError(null);
    try {
      await deleteTarget(target, user.uid, { force });
      setOpen(false);
      onDeleted?.();
    } catch (cause) {
      setError(describeFirestoreError(cause, `delete ${target.name}`));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="subtle-danger" onClick={() => void begin()}>
        {label}
      </button>
    );
  }

  return (
    <div
      className={`delete-confirm ${verdict !== null && !verdict.allowed && !verdict.forceable ? 'is-blocked' : ''}`}
      role="group"
      aria-label={`Delete ${target.name}`}
    >
      {busy && verdict === null && <p className="muted">Checking what depends on this…</p>}

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {verdict !== null && (
        <>
          <p className={verdict.allowed ? undefined : verdict.forceable ? 'warning-text' : 'muted'}>
            {verdict.reason}
          </p>

          {verdict.cascade.length > 0 && (
            <p className="muted">Also deletes {verdict.cascade.join(', ')}.</p>
          )}

          {/* The warning, in full, BEFORE the button that goes past it. */}
          {verdict.forceable && verdict.leftBehind.length > 0 && (
            <>
              <p><strong>If you delete it anyway:</strong></p>
              <ul className="plain-list">
                {verdict.leftBehind.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </>
          )}

          {verdict.alternative !== null && <p className="muted">{verdict.alternative}</p>}

          <div className="delete-actions">
            {verdict.allowed && (
              <button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>
                {busy ? 'Deleting…' : `Yes, delete ${target.name}`}
              </button>
            )}
            {!verdict.allowed && verdict.forceable && (
              <button type="button" className="danger" disabled={busy} onClick={() => void confirm(true)}>
                {busy ? 'Deleting…' : `Delete ${target.name} anyway`}
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} disabled={busy}>
              {verdict.allowed || verdict.forceable ? 'Keep it' : 'Close'}
            </button>
          </div>
        </>
      )}

      {verdict === null && !busy && (
        <button type="button" onClick={() => setOpen(false)}>
          Close
        </button>
      )}
    </div>
  );
}
