/**
 * The two tools for getting the data back into shape: finding records entered
 * twice, and clearing the app to start again.
 *
 * BOTH ARE DESTRUCTIVE, AND THEY ARE NOT EQUALLY SO
 *   Removing a duplicate is an ordinary delete and goes through the ordinary
 *   policy: a record something depends on is refused, with the reasons named.
 *   Clearing the app is not ordinary and nothing can be undone, so it asks for
 *   the word RESET to be typed rather than for a click somebody can make by
 *   reflex on the way to something else.
 *
 * THE SCAN SUGGESTS; IT DOES NOT DECIDE
 *   It marks which record to keep and says why, and every removal is a separate
 *   confirmed action. Nothing here merges: a merge moves references, and a
 *   wrong merge is far harder to undo than a wrong delete.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { assessTarget, deleteTarget } from '../data/deletion.js';
import { scanForDuplicates, type DuplicateScan } from '../data/duplicates.js';
import { resetApp, type ResetProgress } from '../data/reset.js';
import { describeReset, keptOutcomes, type ResetReport } from '../lib/reset-plan.js';
import { extraCount, type DuplicateCandidate } from '../lib/duplicates.js';
import { describeFirestoreError } from '../data/repository.js';
import type { DeletableKind } from '../lib/deletion.js';

export function Maintenance() {
  return (
    <>
      <DuplicateFinder />
      <ResetPanel />
    </>
  );
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

function DuplicateFinder() {
  const { user } = useAuth();
  const [scans, setScans] = useState<DuplicateScan[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [refused, setRefused] = useState<Record<string, string>>({});

  async function scan() {
    setBusy(true);
    setError(null);
    try {
      setScans(await scanForDuplicates());
      setRemoved(new Set());
      setRefused({});
    } catch (cause) {
      setError(describeFirestoreError(cause, 'look for duplicates'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(kind: DeletableKind, record: DuplicateCandidate) {
    if (user === null) return;
    setError(null);
    try {
      // The ordinary policy decides. A duplicate with invoices against it is
      // not a duplicate you can quietly drop.
      const verdict = await assessTarget({ kind, id: record.id, name: record.name });
      if (!verdict.allowed) {
        setRefused((r) => ({ ...r, [record.id]: verdict.reason }));
        return;
      }
      await deleteTarget({ kind, id: record.id, name: record.name }, user.uid);
      setRemoved((r) => new Set(r).add(record.id));
    } catch (cause) {
      setError(describeFirestoreError(cause, 'remove that record'));
    }
  }

  const total = scans === null ? 0 : scans.reduce((sum, s) => sum + extraCount(s.groups), 0);

  return (
    <section className="card">
      <h2>Records entered twice</h2>
      <p className="muted">
        Looks for clients, contracts, projects and lifts that appear to be the same thing
        entered more than once — the same reference, or the same name once spacing, case and
        PLC/LLC are set aside. The import itself cannot duplicate: it writes by a reference
        taken from the workbook, so running it again overwrites the same records.
      </p>

      {error !== null && <p className="error" role="alert">{error}</p>}

      <button type="button" onClick={() => void scan()} disabled={busy}>
        {busy ? 'Looking…' : scans === null ? 'Look for duplicates' : 'Look again'}
      </button>

      {scans !== null && total === 0 && (
        <p className="verdict verdict-healthy">
          No duplicates found across {scans.reduce((sum, s) => sum + s.examined, 0)} records.
        </p>
      )}

      {scans !== null && total > 0 && (
        <>
          <p className="verdict verdict-watch">
            {total} record{total === 1 ? '' : 's'} look like copies of something else.
          </p>
          {scans
            .filter((s) => s.groups.length > 0)
            .map((scan) => (
              <div key={scan.kind} className="dup-kind">
                <h3>{scan.label}</h3>
                {scan.groups.map((group) => (
                  <div key={`${scan.kind}-${group.key}`} className="dup-group">
                    <p className="dup-head">
                      <strong>{group.keep.name || group.keep.code || group.key}</strong>{' '}
                      <span className="muted">· matched on {group.reason}</span>
                    </p>
                    <p className="muted">{group.why}</p>
                    <ul className="dup-list">
                      <li className="dup-keep">
                        <span className="chip chip-ok">Keeping</span> {group.keep.name}{' '}
                        {group.keep.code !== null && <span className="muted mono">{group.keep.code}</span>}
                      </li>
                      {group.extras.map((extra) => (
                        <li key={extra.id}>
                          {removed.has(extra.id) ? (
                            <span className="muted">Removed — {extra.name}</span>
                          ) : (
                            <>
                              <span>{extra.name}</span>{' '}
                              {extra.code !== null && <span className="muted mono">{extra.code}</span>}{' '}
                              {extra.references > 0 && (
                                <span className="muted">
                                  · {extra.references} record{extra.references === 1 ? '' : 's'} point at this one
                                </span>
                              )}
                              <button
                                type="button"
                                className="danger"
                                onClick={() => void remove(scan.kind, extra)}
                                disabled={user === null}
                              >
                                Remove
                              </button>
                              {refused[extra.id] !== undefined && (
                                <p className="error">{refused[extra.id]}</p>
                              )}
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

const CONFIRM_WORD = 'RESET';

function ResetPanel() {
  const [typed, setTyped] = useState('');
  const [progress, setProgress] = useState<ResetProgress | null>(null);
  const [report, setReport] = useState<ResetReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setReport(null);
    setProgress({ label: 'Starting', done: 0, total: 1, deleted: 0 });
    try {
      setReport(await resetApp(setProgress));
      setTyped('');
    } catch (cause) {
      setError(describeFirestoreError(cause, 'clear the app'));
    } finally {
      setProgress(null);
    }
  }

  return (
    <section className="card danger-zone">
      <h2>Start from scratch</h2>
      <p className="muted">
        Deletes every client, contract, programme, project, lift, technician, subcontractor,
        invoice, voucher, callout, maintenance visit, board and card, and restarts document
        numbering. <strong>This cannot be undone.</strong>
      </p>
      <p className="muted">
        Two things survive: your sign-in, so you are not locked out of the app you just cleared,
        and the audit log, which is the record that this happened. The settings above are kept
        too — the VAT rate and the withholding rates are configuration, not data.
      </p>

      {error !== null && <p className="error" role="alert">{error}</p>}

      {report === null ? (
        <>
          <div className="field">
            <label htmlFor="reset-confirm">
              Type <strong>{CONFIRM_WORD}</strong> to enable the button
            </label>
            <input
              id="reset-confirm"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              disabled={progress !== null}
            />
          </div>
          <button
            type="button"
            className="danger"
            disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || progress !== null}
            onClick={() => void run()}
          >
            {progress === null ? 'Delete everything' : 'Deleting…'}
          </button>
          {progress !== null && (
            <p className="muted" role="status" aria-live="polite">
              {progress.label}: {progress.done} of {progress.total} collections · {progress.deleted}{' '}
              records deleted.
            </p>
          )}
        </>
      ) : (
        <div>
          <p className="verdict verdict-healthy">{describeReset(report)}</p>
          {keptOutcomes(report).length > 0 && (
            <dl className="figure-list">
              {keptOutcomes(report).map((outcome) => (
                <div key={outcome.path}>
                  <dt>{outcome.label}</dt>
                  <dd>
                    {outcome.kept} kept <span className="muted">· {outcome.reason}</span>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="muted">
            Open <strong>Import data</strong> to load the workbook again, or start entering by hand.
          </p>
        </div>
      )}
    </section>
  );
}
