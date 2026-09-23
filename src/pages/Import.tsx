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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  repairImportedDates,
  type DateRepairProgress,
  type DateRepairResult,
} from '../data/date-repair.js';
import {
  backfillImportedStages,
  type BackfillProgress,
  type BackfillResult,
} from '../data/stage-backfill.js';
import { hasImportedRecords } from '../data/import-state.js';
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
  const [repairProgress, setRepairProgress] = useState<DateRepairProgress | null>(null);
  const [repairResult, setRepairResult] = useState<DateRepairResult | null>(null);
  const [showAllIssues, setShowAllIssues] = useState(false);
  const [showAllChanges, setShowAllChanges] = useState(false);
  const [stageProgress, setStageProgress] = useState<BackfillProgress | null>(null);
  const [stageResult, setStageResult] = useState<BackfillResult | null>(null);
  /**
   * Whether anything is loaded yet — null until the answer is back.
   *
   * It decides the ORDER of the steps below, not merely their wording. See
   * `data/import-state.ts`: on a database somebody has just cleared, the two
   * repair steps have nothing to act on and running them in the order they are
   * numbered leaves every project at 0%.
   */
  const [loaded, setLoaded] = useState<boolean | null>(null);

  useEffect(() => {
    if (user === null) return;
    let live = true;
    void hasImportedRecords()
      .then((yes) => { if (live) setLoaded(yes); })
      // Not worth an error banner: if this cannot be answered the page falls
      // back to the full sequence, which is the safe assumption — it offers a
      // repair that finds nothing rather than hiding a load that is needed.
      .catch(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, [user]);

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
    setRepairResult(null);
    setStageResult(null);
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

  /**
   * Correct the dates without touching anything else.
   *
   * Separate from `write` on purpose: a full import overwrites every field from
   * the workbook, and by now these records carry decisions the workbook has
   * never heard of. See `data/date-repair.ts`.
   */
  async function repairDates() {
    if (plan === null || user === null) return;
    setError(null);
    setRepairProgress({ stage: 'Starting', examined: 0, total: 0 });
    try {
      setRepairResult(await repairImportedDates(plan, user.uid, setRepairProgress));
    } catch (cause) {
      setError(describeFirestoreError(cause, 'correct the dates'));
    } finally {
      setRepairProgress(null);
    }
  }

  /**
   * Give the imported projects the stage trackers the import never created.
   *
   * Separate from both the import and the date repair: it writes only to
   * projects that have NO stages, so it can never overwrite progress somebody
   * recorded. See `data/stage-backfill.ts`.
   */
  async function backfillStages() {
    if (plan === null || user === null) return;
    setError(null);
    setStageProgress({ stage: 'Starting', examined: 0, total: 0 });
    try {
      setStageResult(await backfillImportedStages(plan, user.uid, setStageProgress));
    } catch (cause) {
      setError(describeFirestoreError(cause, 'set up the stage trackers'));
    } finally {
      setStageProgress(null);
    }
  }

  const groups = useMemo(() => groupIssues(plan?.issues ?? []), [plan]);

  /*
   * The three steps that act on the database, as functions rather than markup
   * in place: the ORDER they are offered in depends on whether anything is
   * loaded, and the number in each heading has to follow that order rather
   * than be written into it.
   */
  function dateStep(n: number) {
    return (
        <section className="card">
          <h2>{n}. Correct the dates already loaded</h2>
          {repairResult === null ? (
            <>
              <p className="muted">
                The first import read every date from this workbook one day early. This puts
                them right and changes <strong>nothing else</strong> — a contract you have put
                on hold stays on hold, a project you marked terminated stays terminated, and
                every payment record is left exactly as it is. Only dates that are actually
                wrong are rewritten.
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void repairDates()}
                disabled={repairProgress !== null || progress !== null || user === null}
              >
                {repairProgress === null ? 'Correct the dates' : 'Correcting…'}
              </button>
              {repairProgress !== null && (
                <p className="muted" role="status" aria-live="polite">
                  Checking {repairProgress.stage}: {repairProgress.examined} of{' '}
                  {repairProgress.total} records.
                </p>
              )}
            </>
          ) : (
            <DatesCorrected
              result={repairResult}
              expanded={showAllChanges}
              onToggle={() => setShowAllChanges((v) => !v)}
            />
          )}
        </section>
    );
  }

  function stageStep(n: number) {
    return (
        <section className="card">
          <h2>{n}. Set up the stage trackers</h2>
          {stageResult === null ? (
            <>
              <p className="muted">
                The projects loaded from the workbook have no stages, so they all read 0% however
                much of them is built. This creates the fourteen installation stages on each one
                and marks the stages the workbook says are already behind the job. It only ever
                touches a project that has <strong>no</strong> stages — anything your crews have
                recorded is left exactly as it is.
                {loaded === false && (
                  <>
                    {' '}
                    <strong>Run this after the load above</strong> — it acts on the projects that
                    are stored, so on an empty database it would find none.
                  </>
                )}
              </p>
              <button
                type="button"
                className="primary"
                onClick={() => void backfillStages()}
                disabled={stageProgress !== null || progress !== null || repairProgress !== null || user === null}
              >
                {stageProgress === null ? 'Set up the trackers' : 'Setting up…'}
              </button>
              {stageProgress !== null && (
                <p className="muted" role="status" aria-live="polite">
                  {stageProgress.stage}: {stageProgress.examined} of {stageProgress.total}{' '}
                  projects.
                </p>
              )}
            </>
          ) : (
            <StagesBuilt result={stageResult} />
          )}
        </section>
    );
  }

  /** Takes the summary rather than reading it: it is narrowed at the call site. */
  function loadStep(n: number, summary: ReturnType<typeof planSummary>) {
    return (
        <section className="card">
          <h2>{n}. Load everything from the workbook</h2>
          {loaded === false ? (
            <p className="muted">
              This is the first load, so it writes everything and overwrites nothing.
            </p>
          ) : (
            <p className="muted">
              Only needed for a first load, or after editing the workbook itself. It writes every
              field from the spreadsheet over what is stored, so anything changed in the app since
              the last import — a status, a warranty term, a handover date — goes back to what the
              spreadsheet says. To fix dates alone, use step 4 instead.
            </p>
          )}
          {result === null ? (
            <>
              <p className="muted">
                Writes{' '}
                {summary.clients +
                  summary.contracts +
                  summary.projects +
                  summary.units +
                  summary.technicians +
                  summary.subcontractors}{' '}
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

    );
  }

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
              <KpiTile label="Technicians" value={summary.technicians} />
              <KpiTile
                label="Subcontractors"
                value={summary.subcontractors}
                detail={<span className="muted">all need a TIN adding</span>}
              />
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

          {/*
            Ordered by what is actually there. On a database somebody has just
            cleared, the load has to come FIRST — the stage back-fill would run
            against no projects and write nothing, and the date repair is for
            records written by the old importer, which these are not. Numbered
            one to six they read as a sequence, and a person following that
            sequence on an empty database ends up with every project at 0%.
          */}
          {loaded === false ? (
            <>
              {loadStep(4, summary)}
              {stageStep(5)}
              <p className="muted">
                Nothing is loaded yet, so those are the only two steps that apply. The date
                correction is for records written by an older version of the importer; a fresh
                load reads every date correctly.
              </p>
            </>
          ) : (
            <>
              {dateStep(4)}
              {stageStep(5)}
              {loadStep(6, summary)}
            </>
          )}        </>
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

/**
 * What the date correction did.
 *
 * The COUNT is the headline, but a count alone asks to be trusted. The first
 * few changes are shown with the day they were on and the day they are on now,
 * so the figure can be checked against the workbook rather than believed.
 */
function DatesCorrected({
  result,
  expanded,
  onToggle,
}: {
  result: DateRepairResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  const fields = Object.values(result.fields).reduce((sum, n) => sum + n, 0);
  const documents = Object.values(result.corrected).reduce((sum, n) => sum + n, 0);
  const shown = expanded ? result.changes : result.changes.slice(0, 8);

  if (fields === 0) {
    return (
      <div>
        <p className="verdict verdict-healthy">Every date is already correct.</p>
        <p className="muted">
          Nothing was changed. {result.alreadyRight} dates were checked against the workbook and
          all of them match.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="verdict verdict-healthy">
        {fields} date{fields === 1 ? '' : 's'} corrected across {documents} record
        {documents === 1 ? '' : 's'}.
      </p>
      <dl className="figure-list">
        {Object.entries(result.corrected)
          .filter(([, count]) => count > 0)
          .map(([name, count]) => (
            <div key={name}>
              <dt>{LABEL[name] ?? name}</dt>
              <dd>
                {count} corrected{' '}
                <span className="muted">of {result.examined[name] ?? 0} checked</span>
              </dd>
            </div>
          ))}
        {result.alreadyRight > 0 && (
          <div>
            <dt>Already right</dt>
            <dd>
              {result.alreadyRight} <span className="muted">left untouched</span>
            </dd>
          </div>
        )}
        {result.missing > 0 && (
          <div>
            <dt>No longer in the app</dt>
            <dd>
              {result.missing} <span className="muted">deleted since the import</span>
            </dd>
          </div>
        )}
      </dl>

      <table className="data-table">
        <caption className="sr-only">Dates changed by the correction</caption>
        <thead>
          <tr>
            <th scope="col">Record</th>
            <th scope="col">Date</th>
            <th scope="col">Was</th>
            <th scope="col">Now</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((change) => (
            <tr key={`${change.collection}-${change.label}-${change.field}`}>
              <td>{change.label}</td>
              <td>{FIELD_LABEL[change.field] ?? change.field}</td>
              <td className="muted">{change.from}</td>
              <td>{change.to}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.changes.length > shown.length && (
        <button type="button" onClick={onToggle}>
          Show all {result.changes.length} changes
        </button>
      )}
      {expanded && result.changes.length > 8 && (
        <button type="button" onClick={onToggle}>
          Show fewer
        </button>
      )}

      <p className="muted">
        Nothing but these dates was written. Open Contracts or Projects to check a few against the
        workbook.
      </p>
    </div>
  );
}

/** Collection names as the app says them. */
const LABEL: Record<string, string> = {
  programs: 'Programs',
  contracts: 'Contracts',
  projects: 'Projects',
};

/** Field names as the forms say them. */
const FIELD_LABEL: Record<string, string> = {
  signedDate: 'Signed',
  startDate: 'Start',
  endDate: 'End',
  plannedStart: 'Planned start',
  plannedEnd: 'Planned end',
};

/**
 * What the stage back-fill did.
 *
 * The number that matters is not how many trackers were created — it is how
 * many jobs now report a progress figure that came from somewhere, and how
 * many are still blank because the workbook had nothing to say about them.
 * The second number is the honest one, so it is not buried.
 */
function StagesBuilt({ result }: { result: BackfillResult }) {
  if (result.backfilled === 0) {
    return (
      <div>
        <p className="verdict verdict-healthy">Every project already has its stages.</p>
        <p className="muted">
          Nothing was changed. {result.alreadyHadStages} of {result.examined} projects were checked
          and all of them already had a tracker.
        </p>
      </div>
    );
  }

  const measured = result.backfilled - result.openedEmpty;

  return (
    <div>
      <p className="verdict verdict-healthy">
        {result.backfilled} project{result.backfilled === 1 ? '' : 's'} now have stage trackers.
      </p>
      <dl className="figure-list">
        <div>
          <dt>Trackers created</dt>
          <dd>
            {result.backfilled} <span className="muted">· {result.stagesCreated} stages in total</span>
          </dd>
        </div>
        <div>
          <dt>Progress set from the workbook</dt>
          <dd>
            {measured}{' '}
            <span className="muted">where the workbook said how far the job had got</span>
          </dd>
        </div>
        {result.openedEmpty > 0 && (
          <div>
            <dt>Opened at zero</dt>
            <dd>
              {result.openedEmpty}{' '}
              <span className="muted">
                the workbook said nothing about these, so nothing was assumed — tick the stages as
                the crews confirm them
              </span>
            </dd>
          </div>
        )}
        {result.alreadyHadStages > 0 && (
          <div>
            <dt>Left alone</dt>
            <dd>
              {result.alreadyHadStages}{' '}
              <span className="muted">already had stages, so their progress was not touched</span>
            </dd>
          </div>
        )}
        {result.missing > 0 && (
          <div>
            <dt>No longer in the app</dt>
            <dd>
              {result.missing} <span className="muted">deleted since the import</span>
            </dd>
          </div>
        )}
      </dl>

      <p className="muted">
        A stage marked complete here was marked from the spreadsheet, not signed off by anybody —
        the tracker says so on each one. Open any project to see its stages and correct them.
      </p>
    </div>
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
