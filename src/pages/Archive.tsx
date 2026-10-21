/**
 * Archive: take a finished job out of the app, once it is safely backed up.
 *
 * NOTHING HERE HAPPENS BY ITSELF
 *   The page lists the contracts that look finished and waits. Removing one is a
 *   deliberate sequence — review what is in it, save the backup, confirm — and
 *   each step has to be done before the next is available.
 *
 * WHAT STAYS
 *   The client, the lifts, the maintenance agreement and the service history.
 *   Only the installation job — its contract, projects, invoices and so on — is
 *   removed, which is what `lib/archive.ts` is for.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { DataTable } from '../components/DataTable.js';
import { DualDateText } from '../components/DualDateInput.js';
import { KpiTile } from '../components/KpiTile.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeProjects } from '../data/projects.js';
import {
  finishInterruptedRemoval,
  loadJob,
  removeJob,
  subscribeArchives,
} from '../data/archive.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import type { WithId } from '../data/repository.js';
import { archiveCandidate, assessArchive, type ArchiveJob, type ArchiveVerdict } from '../lib/archive.js';
import {
  backupFileStem,
  backupFileText,
  contentText,
  sha256Hex,
  workbookSheets,
} from '../lib/archive-backup.js';
import { formatDual } from '../lib/ethiopic.js';
import { formatETB } from '../lib/money.js';
import type { ArchiveRecord, Contract, Project } from '../lib/schema.js';

export function Archive() {
  const { user, role } = useAuth();
  const allowed = can(role, 'archiveJobs');
  const [reviewing, setReviewing] = useState<WithId<Contract> | null>(null);

  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const archives = useCollection<ArchiveRecord>((d, e) => subscribeArchives(d, e), [], 'load the archive');

  const rows = useMemo(() => {
    const byId = new Map(contracts.rows.map((c) => [c.id, c]));
    return contracts.rows
      .filter((c) => c.type !== 'maintenance' && c.status === 'completed')
      .map((contract) => {
        const statuses = projects.rows.filter((p) => p.contractId === contract.id).map((p) => p.status);
        const verdict = archiveCandidate(contract, statuses);
        const followedBy =
          contract.succeededByContractId != null
            ? (byId.get(contract.succeededByContractId)?.contractNo ?? 'a maintenance agreement')
            : contract.serviceDeclined === true
              ? 'Client declined service'
              : '—';
        return { contract, ...verdict, followedBy };
      });
  }, [contracts.rows, projects.rows]);

  const ready = rows.filter((r) => r.ready);
  const waiting = rows.filter((r) => !r.ready);
  const stillActive = contracts.rows.filter((c) => c.type !== 'maintenance' && c.status !== 'completed').length;
  const interrupted = archives.rows.filter((a) => a.status === 'removing');
  const { busy: finishing, error: finishError, run: runFinish } = useAsyncAction('finish this removal');

  if (!allowed) {
    return (
      <div className="page">
        <h1>Archive</h1>
        <p className="muted">Only an administrator can remove finished jobs from the app.</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Archive</h1>
          <p className="muted">
            Projects are archived together with their installation contract as one backup package. First mark
            every project under that contract Completed, then mark the contract Completed and resolve the
            warranty/service decision. When it becomes eligible below, open it, save the backup to your own
            files, and confirm removal. Nothing is deleted automatically.
          </p>
        </div>
      </div>

      <div className="kpis">
        <KpiTile label="Ready to review" value={ready.length} detail={<span className="muted">finished and handed over</span>} />
        <KpiTile label="Completed, not ready" value={waiting.length} detail={<span className="muted">see the reason below</span>} />
        <KpiTile label="Already archived" value={archives.rows.length} detail={<span className="muted">backup files you hold</span>} />
      </div>

      {interrupted.map((record) => (
        <div key={record.id} className="banner banner-warn" role="status">
          <p>
            <strong>{record.contractNo}</strong> was only part-way removed — the connection dropped before it
            finished. The backup is still valid. Finish the removal to tidy it up.
          </p>
          <button
            type="button"
            className="primary"
            disabled={finishing || user === null}
            onClick={() => user !== null && void runFinish(() => finishInterruptedRemoval(record.contractId, user.uid))}
          >
            {finishing ? 'Finishing…' : 'Finish removing it'}
          </button>
        </div>
      ))}
      {finishError !== null && <p className="error" role="alert">{finishError}</p>}

      {reviewing !== null && user !== null && (
        <JobReview contract={reviewing} uid={user.uid} onClose={() => setReviewing(null)} />
      )}

      <section className="card">
        <h2>Ready to review</h2>
        <p className="muted">
          Completed installation contracts whose projects are all completed and which a maintenance
          agreement has followed (or whose client declined service). The money and paperwork are checked
          when you open one.
        </p>
        {contracts.loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <DataTable
            rows={ready}
            rowKey={(r) => r.contract.id}
            noun="contracts"
            empty="No finished jobs are ready yet."
            columns={[
              {
                key: 'contract',
                label: 'Contract',
                value: (r) => r.contract.title,
                text: (r) => `${r.contract.title} ${r.contract.contractNo}`,
                render: (r) => (
                  <>
                    <strong>{r.contract.title}</strong>
                    <br />
                    <span className="muted mono">{r.contract.contractNo}</span>
                  </>
                ),
              },
              { key: 'client', label: 'Client', value: (r) => r.contract.clientName, filterable: true },
              {
                key: 'value',
                label: 'Value (net)',
                numeric: true,
                value: (r) => r.contract.valueNetSantim,
                render: (r) => formatETB(r.contract.valueNetSantim, { withSymbol: false }),
              },
              {
                key: 'ended',
                label: 'Ended',
                value: (r) => r.contract.endDate.at.toDate(),
                render: (r) => <DualDateText value={r.contract.endDate} />,
              },
              { key: 'followed', label: 'Followed by', value: (r) => r.followedBy },
              {
                key: 'actions',
                label: 'Actions',
                unsortable: true,
                value: () => '',
                render: (r) => (
                  <button type="button" onClick={() => setReviewing(r.contract)}>
                    Review
                  </button>
                ),
              },
            ]}
          />
        )}
      </section>

      {waiting.length > 0 && (
        <details className="card">
          <summary>
            <strong>{waiting.length} completed contract{waiting.length === 1 ? '' : 's'} not ready yet</strong>
          </summary>
          <ul className="plain-list">
            {waiting.map((r) => (
              <li key={r.contract.id}>
                <strong>{r.contract.contractNo}</strong> · {r.contract.clientName} — <span className="muted">{r.reason}</span>
              </li>
            ))}
          </ul>
          {stillActive > 0 && (
            <p className="muted">
              {stillActive} other installation contract{stillActive === 1 ? ' is' : 's are'} not completed, so
              {stillActive === 1 ? ' it is' : ' they are'} not listed.
            </p>
          )}
        </details>
      )}

      <section className="card">
        <h2>Already archived</h2>
        <p className="muted">
          What is kept of each removed job: its figures and invoice numbers, and the fingerprint of the
          backup file that holds the rest. The invoice numbers are here so a gap in the sequence can be
          explained.
        </p>
        <DataTable
          rows={archives.rows}
          rowKey={(a) => a.id}
          noun="archived jobs"
          empty="Nothing has been archived."
          columns={[
            {
              key: 'when',
              label: 'Archived',
              value: (a) => a.createdAt?.toDate?.() ?? new Date(0),
              render: (a) => (a.createdAt?.toDate ? formatDual(a.createdAt.toDate()) : '—'),
            },
            {
              key: 'contract',
              label: 'Contract',
              value: (a) => a.contractNo,
              text: (a) => `${a.contractNo} ${a.title}`,
              render: (a) => (
                <>
                  <strong>{a.contractNo}</strong>
                  <br />
                  <span className="muted">{a.title}</span>
                </>
              ),
            },
            { key: 'client', label: 'Client', value: (a) => a.clientName, filterable: true },
            {
              key: 'followed',
              label: 'Followed by',
              value: (a) => a.followedBy?.contractNo ?? (a.serviceDeclined ? 'Declined' : '—'),
            },
            {
              key: 'invoices',
              label: 'Invoice numbers',
              value: (a) => a.invoiceNumbers.length,
              numeric: true,
              text: (a) => a.invoiceNumbers.join(' '),
              render: (a) =>
                a.invoiceNumbers.length === 0
                  ? '—'
                  : a.invoiceNumbers.length === 1
                    ? a.invoiceNumbers[0]
                    : `${a.invoiceNumbers[0]} … ${a.invoiceNumbers[a.invoiceNumbers.length - 1]} (${a.invoiceNumbers.length})`,
            },
            {
              key: 'gross',
              label: 'Invoiced (with VAT)',
              numeric: true,
              value: (a) => a.invoicedGrossSantim,
              render: (a) => formatETB(a.invoicedGrossSantim, { withSymbol: false }),
            },
            {
              key: 'backup',
              label: 'Backup',
              value: (a) => a.backup.contentSha256,
              text: (a) => `${a.backup.fileStem} ${a.backup.contentSha256}`,
              render: (a) => (
                <span title={`${a.backup.fileStem}\nSHA-256 ${a.backup.contentSha256}`}>
                  <span className="mono">{a.backup.contentSha256.slice(0, 12)}</span>
                  {a.status === 'removing' && <span className="chip no-caps"> unfinished</span>}
                </span>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviewing one job
// ---------------------------------------------------------------------------

type LoadedJob = Awaited<ReturnType<typeof loadJob>> & object;

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function JobReview({ contract, uid, onClose }: { contract: WithId<Contract>; uid: string; onClose: () => void }) {
  const [job, setJob] = useState<LoadedJob | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saved, setSaved] = useState({ excel: false, json: false });
  const [acknowledged, setAcknowledged] = useState(false);
  const [typed, setTyped] = useState('');
  const [removed, setRemoved] = useState<ArchiveVerdict | null>(null);
  const { busy, error, run } = useAsyncAction('remove this job');

  async function read() {
    setLoadError(null);
    try {
      const loaded = await loadJob(contract.id);
      if (loaded === null) {
        setLoadError('This contract no longer exists.');
        return;
      }
      setJob(loaded);
      setHash(await sha256Hex(contentText(loaded)));
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'Could not read the job.');
    }
  }
  useEffect(() => {
    void read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id]);

  const verdict = useMemo(() => (job === null ? null : assessArchive(job, new Date())), [job]);
  const stem = job === null ? '' : backupFileStem(job);
  const bothSaved = saved.excel && saved.json;
  const canRemove =
    verdict?.eligible === true && bothSaved && acknowledged && typed.trim() === contract.contractNo && !busy;

  async function downloadExcel(current: ArchiveJob, v: ArchiveVerdict, sha: string) {
    const XLSX = await import('xlsx');
    const book = XLSX.utils.book_new();
    for (const sheet of workbookSheets(current, v, { exportedAt: new Date().toISOString(), contentSha256: sha })) {
      const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
      ws['!cols'] = (sheet.rows[0] ?? []).map((_, col) => ({
        wch: Math.min(48, Math.max(10, ...sheet.rows.map((r) => String(r[col] ?? '').length))),
      }));
      XLSX.utils.book_append_sheet(book, ws, sheet.name);
    }
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    saveBlob(
      new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `${stem}.xlsx`,
    );
    setSaved((s) => ({ ...s, excel: true }));
  }

  function downloadJson(current: ArchiveJob, sha: string) {
    const text = backupFileText(current, { exportedAt: new Date().toISOString(), exportedBy: uid, contentSha256: sha });
    saveBlob(new Blob([text], { type: 'application/json' }), `${stem}.json`);
    setSaved((s) => ({ ...s, json: true }));
  }

  async function remove() {
    const outcome = await run(async () => {
      // Read it again: what is deleted must be what was backed up, not what the
      // job looked like when this panel opened.
      const fresh = await loadJob(contract.id);
      if (fresh === null) throw new Error('This contract no longer exists.');
      const freshHash = await sha256Hex(contentText(fresh));
      if (freshHash !== hash) {
        setJob(fresh);
        setHash(freshHash);
        setSaved({ excel: false, json: false });
        setAcknowledged(false);
        throw new Error(
          'Something on this job changed after the backup was taken, so the backup no longer matches. Nothing was removed. Save the backup again, then confirm.',
        );
      }
      const fresher = assessArchive(fresh, new Date());
      if (!fresher.eligible) throw new Error(fresher.blockers[0] ?? 'This job can no longer be removed.');
      await removeJob(fresh, fresher, { fileStem: backupFileStem(fresh), contentSha256: freshHash }, uid);
      return fresher;
    });
    if (outcome !== null) setRemoved(outcome);
  }

  if (removed !== null) {
    return (
      <section className="card">
        <p className="verdict verdict-healthy">{contract.contractNo} has been removed from the app.</p>
        <p>
          The client, the lifts and the maintenance agreement are untouched. Keep the two backup files
          somewhere safe — they are now the only full record of this job.
          {removed.invoiceNumbers.length > 0 && ` Invoice numbers ${removed.invoiceNumbers.join(', ')} are listed under Already archived.`}
        </p>
        <button type="button" onClick={onClose}>Done</button>
      </section>
    );
  }

  return (
    <section className="card" aria-label={`Review ${contract.contractNo}`}>
      <div className="page-head">
        <div>
          <h2>{contract.title}</h2>
          <p className="muted">
            <span className="mono">{contract.contractNo}</span> · {contract.clientName}
          </p>
        </div>
        <button type="button" onClick={onClose} disabled={busy}>Close</button>
      </div>

      {loadError !== null && <p className="error" role="alert">{loadError}</p>}
      {job === null && loadError === null && <p className="muted">Reading everything that belongs to this job…</p>}

      {verdict !== null && job !== null && (
        <>
          {!verdict.eligible && (
            <div className="banner banner-danger" role="alert">
              <strong>This cannot be removed yet.</strong>
              <ul>{verdict.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            </div>
          )}

          <div className="form-grid">
            <div>
              <h3>Will be removed</h3>
              <ul className="plain-list">
                {verdict.removes.map((r) => (
                  <li key={r.label}><strong>{r.count}</strong> {r.count === 1 ? r.one : r.label}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Stays in the app</h3>
              <ul className="plain-list">{verdict.stays.map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>

          {verdict.invoiceNumbers.length > 0 && (
            <p className="muted">
              Invoice numbers leaving with it: {verdict.invoiceNumbers.join(', ')} — {formatETB(verdict.totals.invoicedGrossSantim)}
              {' '}invoiced with VAT, {formatETB(verdict.totals.receivedGrossSantim)} received.
            </p>
          )}

          {verdict.warnings.map((w) => (
            <p key={w} className="banner banner-warn">{w}</p>
          ))}

          {verdict.eligible && hash !== null && (
            <>
              <h3>1. Save the backup</h3>
              <p className="muted">
                Two files: an Excel workbook you can open and read, and a complete data file that holds every
                field exactly as stored. Keep both together, somewhere that is not this app.
              </p>
              <div className="form-actions">
                <button type="button" className={saved.excel ? undefined : 'primary'} onClick={() => void downloadExcel(job, verdict, hash)}>
                  {saved.excel ? '✓ Excel saved — save again' : 'Download Excel backup'}
                </button>
                <button type="button" className={saved.json ? undefined : 'primary'} onClick={() => downloadJson(job, hash)}>
                  {saved.json ? '✓ Data file saved — save again' : 'Download data file'}
                </button>
              </div>
              <p className="muted">Fingerprint <span className="mono">{hash.slice(0, 16)}…</span> — printed inside both files.</p>

              <h3>2. Confirm</h3>
              <label className="check">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  disabled={!bothSaved}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />{' '}
                I have saved both files somewhere safe and understand this cannot be undone from the app.
              </label>
              <div className="field">
                <label htmlFor="archive-confirm">Type the contract number, <span className="mono">{contract.contractNo}</span>, to confirm</label>
                <input
                  id="archive-confirm"
                  value={typed}
                  disabled={!bothSaved}
                  autoComplete="off"
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              {error !== null && <p className="error" role="alert">{error}</p>}
              <div className="form-actions">
                <button type="button" className="danger" disabled={!canRemove} onClick={() => void remove()}>
                  {busy ? 'Removing…' : `Remove ${contract.contractNo} from the app`}
                </button>
                <button type="button" onClick={onClose} disabled={busy}>Keep it</button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
