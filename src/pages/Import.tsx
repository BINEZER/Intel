/**
 * Load the consolidated project master workbook.
 *
 * The workbook is read in the browser and written to Firestore as the signed-in
 * user. Nothing about the business is baked into this app — the file is the
 * source, and it can be loaded again whenever a newer one exists.
 *
 * The screen is deliberately a three-step gate: choose the file, read what the
 * import found and what it refused, and only then write. An import of this size
 * that starts writing before anyone has seen the issue list is an import nobody
 * can trust afterwards.
 */

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { KpiTile } from '../components/KpiTile.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { formatETB } from '../lib/money.js';
import {
  buildImportPlan,
  groupIssues,
  planSummary,
  type ImportIssue,
  type ImportPlan,
  type Workbook,
} from '../lib/import-master.js';
import { runImport, type ImportProgress, type ImportResult } from '../data/import-run.js';
import { describeFirestoreError } from '../data/repository.js';

type VatTreatment = 'inclusive' | 'exclusive';

/** Read the workbook in a worker-free way: one file, parsed on demand. */
async function readWorkbook(file: File): Promise<Workbook> {
  // Loaded on demand: the parser is about half a megabyte, and nobody who is
  // not importing should pay for it.
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { cellDates: true });
  const out: Workbook = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (sheet === undefined) continue;
    out[name] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
  }
  return out;
}

const SEVERITY_LABEL: Record<ImportIssue['severity'], string> = {
  skipped: 'Left out',
  warning: 'Check',
  repaired: 'Repaired',
};

export function Import() {
  const { user } = useAuth();
  const [workbook, setWorkbook] = useState<Workbook | null>(null);
  const [fileName, setFileName] = useState('');
  const [vatTreatment, setVatTreatment] = useState<VatTreatment | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [showAllIssues, setShowAllIssues] = useState(false);

  const plan: ImportPlan | null = useMemo(() => {
    if (workbook === null || vatTreatment === null) return null;
    try {
      return buildImportPlan(workbook, { vatTreatment, vatRateBps: 1500 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }, [workbook, vatTreatment]);

  const summary = plan === null ? null : planSummary(plan);

  const onFile = useCallback(async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setResult(null);
    setReading(true);
    try {
      setWorkbook(await readWorkbook(file));
      setFileName(file.name);
    } catch (cause) {
      setError(
        `Could not read that file: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      setWorkbook(null);
    } finally {
      setReading(false);
    }
  }, []);

  async function write() {
    if (plan === null || user === null) return;
    setError(null);
    setProgress({ stage: 'Starting', written: 0, total: 0 });
    try {
      setResult(await runImport(plan, user.uid, setProgress));
    } catch (cause) {
      setError(describeFirestoreError(cause, 'import the workbook'));
    } finally {
      setProgress(null);
    }
  }

  const groups = useMemo(() => groupIssues(plan?.issues ?? []), [plan]);

  return (
    <div className="page">
      <PrintHeader title="Workbook import" />
      <div className="page-head">
        <div>
          <h1>Import the project master</h1>
          <p className="muted">
            Reads the consolidated workbook and creates the clients, contracts, projects and lifts
            it describes. Running it twice updates the same records rather than making a second
            copy, so it is safe to correct the file and load it again.
          </p>
        </div>
        <PrintButton />
      </div>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {/* --- step 1 ---------------------------------------------------- */}
      <section className="card">
        <h2>1. Choose the file</h2>
        <p className="muted">
          The <code>.xlsx</code> master, as exported. Nothing is written until you press Import at
          the bottom of this page.
        </p>
        <input
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => void onFile(event.target.files?.[0])}
          disabled={reading || progress !== null}
        />
        {reading && <p className="muted">Reading…</p>}
        {workbook !== null && (
          <p className="muted">
            Read <strong>{fileName}</strong> — {Object.keys(workbook).length} sheets.
          </p>
        )}
      </section>

      {/* --- step 2 ---------------------------------------------------- */}
      {workbook !== null && (
        <section className="card">
          <h2>2. Does the contract value include VAT?</h2>
          <p className="muted">
            Nothing in the workbook answers this, and it moves every figure in the system by 15%, so
            it is not guessed. If a contract is written as ETB 4,642,074.42, is that what the client
            pays in total, or the figure VAT is added to?
          </p>
          <div className="choice-row">
            <label className="choice">
              <input
                type="radio"
                name="vat"
                checked={vatTreatment === 'inclusive'}
                onChange={() => setVatTreatment('inclusive')}
              />
              <span>
                <strong>The value includes VAT</strong>
                <span className="muted"> — the net is backed out at 15%.</span>
              </span>
            </label>
            <label className="choice">
              <input
                type="radio"
                name="vat"
                checked={vatTreatment === 'exclusive'}
                onChange={() => setVatTreatment('exclusive')}
              />
              <span>
                <strong>VAT is added on top</strong>
                <span className="muted"> — the value is the net, and 15% is added.</span>
              </span>
            </label>
          </div>
        </section>
      )}

      {/* --- step 3 ---------------------------------------------------- */}
      {summary !== null && plan !== null && (
        <>
          <section className="card">
            <h2>3. What this will create</h2>
            <div className="kpis">
              <KpiTile label="Clients" value={summary.clients} />
              <KpiTile label="Contracts" value={summary.contracts} />
              <KpiTile
                label="Programs"
                value={summary.programs}
                detail={<span className="muted">agreements with several lifts</span>}
              />
              <KpiTile label="Projects" value={summary.projects} />
              <KpiTile
                label="Lifts"
                value={summary.units}
                detail={<span className="muted">of {summary.projects} projects</span>}
              />
              <KpiTile label="Payment terms" value={summary.milestones} />
            </div>
            <dl className="figure-list">
              <div>
                <dt>Contract value</dt>
                <dd>{formatETB(summary.contractValueSantim)}</dd>
              </div>
              <div>
                <dt>Recorded as collected</dt>
                <dd>
                  {formatETB(summary.collectedSantim)}{' '}
                  <span className="muted">
                    on {summary.contractsWithPayments} of {summary.contracts} contracts
                  </span>
                </dd>
              </div>
            </dl>
            <p className="muted">
              The workbook only carries a usable payment history for{' '}
              {summary.contractsWithPayments} agreements. The rest are imported with their payment
              schedule set out but nothing marked as received, which is the honest starting point —
              a contract showing no collection is a contract to check, not a contract that has paid.
            </p>
          </section>

          <section className="card">
            <div className="viz-head">
              <div>
                <h2>What was left out, changed, or needs a look</h2>
                <p className="muted">
                  {summary.skipped} left out · {summary.repaired} repaired · {summary.warnings} to
                  check, in {groups.length} kinds. Nothing is dropped silently.
                </p>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">What</th>
                    <th scope="col" className="num">Rows</th>
                    <th scope="col">Why</th>
                    <th scope="col">Which</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={`${group.severity}-${group.sheet}-${group.reason}`}>
                      <td>
                        <span className={`chip import-chip-${group.severity}`}>
                          {SEVERITY_LABEL[group.severity]}
                        </span>
                        <br />
                        <span className="muted">{group.sheet}</span>
                      </td>
                      <td className="num">{group.refs.length}</td>
                      <td>{group.reason}</td>
                      <td className="muted">
                        <RefList refs={group.refs} expanded={showAllIssues} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setShowAllIssues((v) => !v)}>
              {showAllIssues ? 'Show fewer rows' : 'List every affected row'}
            </button>
          </section>

          <section className="card">
            <h2>4. Import</h2>
            {result === null ? (
              <>
                <p className="muted">
                  Writes {summary.clients + summary.contracts + summary.projects + summary.units}{' '}
                  records plus {summary.milestones} payment terms. Records already loaded from a
                  previous run are updated in place; payment schedules on contracts that already
                  exist are left alone, in case they have been invoiced against.
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void write()}
                  disabled={progress !== null || user === null}
                >
                  {progress === null ? 'Import into the app' : 'Importing…'}
                </button>
                {progress !== null && (
                  <p className="muted" role="status" aria-live="polite">
                    {progress.stage}: {progress.written} of {progress.total} records written.
                  </p>
                )}
              </>
            ) : (
              <ImportDone result={result} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** The affected rows, short by default: the reason is the message, not the list. */
function RefList({ refs, expanded }: { refs: readonly string[]; expanded: boolean }) {
  const limit = expanded ? refs.length : 4;
  const shown = refs.slice(0, limit);
  return (
    <>
      {shown.join(', ')}
      {refs.length > shown.length && ` … and ${refs.length - shown.length} more`}
    </>
  );
}

function ImportDone({ result }: { result: ImportResult }) {
  const line = (map: Record<string, number>) =>
    Object.entries(map)
      .map(([key, count]) => `${count} ${key}`)
      .join(', ') || 'none';

  return (
    <div>
      <p className="verdict verdict-healthy">Import finished.</p>
      <dl className="figure-list">
        <div>
          <dt>Created</dt>
          <dd>{line(result.created)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{line(result.updated)}</dd>
        </div>
        {result.schedulesPreserved > 0 && (
          <div>
            <dt>Payment schedules left alone</dt>
            <dd>
              {result.schedulesPreserved}{' '}
              <span className="muted">contracts that already existed</span>
            </dd>
          </div>
        )}
      </dl>
      <p className="muted">
        Open Clients, Contracts, Projects or Lifts to see the records. If something looks wrong,
        correct the workbook and import it again — the same rows land on the same records.
      </p>
    </div>
  );
}
