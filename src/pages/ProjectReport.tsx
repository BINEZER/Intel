/**
 * One project, as a document.
 *
 * WHY THIS IS SEPARATE FROM THE PROJECT PAGE
 *   The project page is a place to WORK: tick a stage, assign a technician,
 *   record a certificate. Its controls are the point of it. A document is the
 *   opposite — it has to survive leaving the screen, which means it carries its
 *   own identity, states its figures in birr rather than in percentages, and
 *   shows the invoices the figures came from so the reader can check rather
 *   than believe.
 *
 *   Both exist because both questions get asked. "What is happening on this
 *   job" is answered by the project page; "show me this job" — to a client, a
 *   bank, a partner, or the person deciding whether to release the next payment
 *   — is answered here.
 *
 * IT WORKS FOR ANY KIND OF WORK
 *   The lift panels appear only on lift work. An office renovation gets the
 *   same money, the same stages, the same team and the same dates, without a
 *   column of empty machinery. See `lib/project-kind.ts`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, subscribePhases } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { subscribeDisbursements } from '../data/disbursements.js';
import { subscribeUnits } from '../data/units.js';
import { useCollection } from '../data/useCollection.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { DualDateText } from '../components/DualDateInput.js';
import { formatETB } from '../lib/money.js';
import { isElevatorWork, projectTypeLabel } from '../lib/project-kind.js';
import { describeAccount, projectAccount } from '../lib/project-report.js';
import type { ReportedDisbursement, ReportedInvoice } from '../lib/project-report.js';
import type {
  Contract,
  Disbursement,
  ElevatorUnit,
  Invoice,
  Project,
  ProjectPhase,
} from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

/** Basis points as a percentage, for progress and margin alike. */
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;

/** A Firestore dual date as milliseconds, or a fallback when it is not set. */
const millis = (value: { at: { toMillis(): number } } | null | undefined, fallback: number) =>
  value?.at?.toMillis() ?? fallback;

export function ProjectReport() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<WithId<Project> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const asOf = useMemo(() => Date.now(), []);

  const phases = useCollection<ProjectPhase>(
    (d, e) => subscribePhases(projectId ?? '', d, e),
    [projectId],
    'load the stages',
  );
  const invoices = useCollection<Invoice>(
    (d, e) => subscribeInvoices(d, e, { projectId: projectId ?? '' }),
    [projectId],
    'load the invoices',
  );
  const payments = useCollection<Disbursement>(
    (d, e) => subscribeDisbursements(d, e, { projectId: projectId ?? '' }),
    [projectId],
    'load the supplier payments',
  );
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');

  useEffect(() => {
    if (projectId === undefined) return;
    let cancelled = false;
    getProject(projectId)
      .then((found) => {
        if (cancelled) return;
        if (found === null) setLoadError('That project could not be found.');
        else setProject(found);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const account = useMemo(() => {
    const reportedInvoices: ReportedInvoice[] = invoices.rows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      netSantim: i.netSantim,
      vatSantim: i.vatSantim,
      grossSantim: i.grossSantim,
      paidGrossSantim: i.paidGrossSantim,
      balanceGrossSantim: i.balanceGrossSantim,
      issuedAtMillis: millis(i.issueDate, asOf),
      dueAtMillis: millis(i.dueDate, asOf),
    }));
    const reportedPayments: ReportedDisbursement[] = payments.rows.map((d) => ({
      id: d.id,
      voucherNo: d.voucherNo,
      supplierName: d.subcontractorName,
      status: d.status,
      netSantim: d.netSantim,
      grossSantim: d.grossSantim,
      whtSantim: d.whtSantim,
      netPayableSantim: d.netPayableSantim,
      paidAtMillis: d.paymentDate === null ? null : millis(d.paymentDate, asOf),
    }));
    return projectAccount(
      project?.financials?.contractNetSantim ?? 0,
      reportedInvoices,
      reportedPayments,
      asOf,
    );
  }, [project, invoices.rows, payments.rows, asOf]);

  if (loadError !== null) return <p className="error" role="alert">{loadError}</p>;
  if (project === null) return <p className="muted">Loading…</p>;

  const contract = contracts.rows.find((k) => k.id === project.contractId) ?? null;
  const projectUnits = units.rows.filter((u) => u.installedByProjectId === project.id);
  const lift = isElevatorWork(project.type);

  return (
    <div className="page project-report">
      <PrintHeader
        title={`${project.projectNo} · ${project.title}`}
        subtitle={`${projectTypeLabel(project.type)} for ${project.clientName}`}
      />

      <div className="page-head">
        <div>
          <p className="muted no-print">
            <Link to={`/projects/${project.id}`}>← Back to the project</Link>
          </p>
          <h1>{project.title}</h1>
          <p className="muted">
            {project.projectNo} · {projectTypeLabel(project.type)} · {project.clientName}
          </p>
        </div>
        <div className="page-actions">
          <span className="chip">{project.status.replace(/_/g, ' ')}</span>
          <PrintButton label="Print or save as PDF" />
        </div>
      </div>

      <section className="card">
        <h2>The job</h2>
        <dl className="figure-list">
          <div><dt>Client</dt><dd>{project.clientName}</dd></div>
          <div><dt>Site</dt><dd>{project.site?.name}{project.site?.city === undefined ? '' : ` · ${project.site.city}`}</dd></div>
          <div><dt>Kind of work</dt><dd>{projectTypeLabel(project.type)}</dd></div>
          <div>
            <dt>Contract</dt>
            <dd>
              {contract === null ? (
                <span className="muted">Not under a contract.</span>
              ) : (
                <Link to={`/contracts/${contract.id}`}>
                  {contract.contractNo} · {contract.title}
                </Link>
              )}
            </dd>
          </div>
          <div><dt>Planned start</dt><dd><DualDateText value={project.plannedStart} /></dd></div>
          <div><dt>Planned handover</dt><dd><DualDateText value={project.plannedEnd} /></dd></div>
          <div><dt>Progress</dt><dd>{pct(project.progressBps)}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>Money</h2>
        <p className="muted">{describeAccount(account)}</p>
        <div className="metric-grid">
          <Figure label="Contract value" value={formatETB(account.contractNetSantim)} note="net of VAT" />
          <Figure label="Invoiced" value={formatETB(account.billedGrossSantim)} note="including VAT" />
          <Figure label="Collected" value={formatETB(account.collectedGrossSantim)} note="received against those invoices" />
          <Figure
            label="Outstanding"
            value={formatETB(account.outstandingGrossSantim)}
            note={
              account.overdueInvoices === 0
                ? 'billed, not yet received'
                : `${formatETB(account.overdueGrossSantim)} of it past due`
            }
          />
          <Figure
            label="Not yet billed"
            value={formatETB(Math.abs(account.unbilledNetSantim))}
            note={account.unbilledNetSantim < 0 ? 'billed BEYOND the contract value' : 'of the contract, net'}
          />
          <Figure label="Supplier cost paid" value={formatETB(account.costNetSantim)} note="net of VAT" />
          <Figure
            label="Margin to date"
            value={formatETB(account.marginToDateSantim)}
            note={
              account.marginBps === null
                ? 'no contract value recorded'
                : `${pct(account.marginBps)} of contract value — not profit until the job is finished`
            }
          />
        </div>
      </section>

      <section className="card">
        <h2>Invoices</h2>
        {invoices.error !== null && <p className="error" role="alert">{invoices.error}</p>}
        {invoices.rows.length === 0 ? (
          <p className="muted">No invoice has been raised against this project.</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">Invoices raised against this project</caption>
            <thead>
              <tr>
                <th scope="col">Number</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Gross</th>
                <th scope="col" className="num">Paid</th>
                <th scope="col" className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {invoices.rows.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="mono">{invoice.invoiceNo}</td>
                  <td><DualDateText value={invoice.issueDate} /></td>
                  <td><DualDateText value={invoice.dueDate} /></td>
                  <td>{invoice.status.replace(/_/g, ' ')}</td>
                  <td className="num">{formatETB(invoice.grossSantim)}</td>
                  <td className="num">{formatETB(invoice.paidGrossSantim)}</td>
                  <td className="num">{formatETB(invoice.balanceGrossSantim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>Supplier payments</h2>
        {payments.error !== null && <p className="error" role="alert">{payments.error}</p>}
        {payments.rows.length === 0 ? (
          <p className="muted">No supplier payment has been recorded against this project.</p>
        ) : (
          <>
            <table className="data-table">
              <caption className="sr-only">Supplier payments on this project</caption>
              <thead>
                <tr>
                  <th scope="col">Voucher</th>
                  <th scope="col">Supplier</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Net</th>
                  <th scope="col" className="num">Withheld</th>
                  <th scope="col" className="num">Paid out</th>
                </tr>
              </thead>
              <tbody>
                {payments.rows.map((payment) => (
                  <tr key={payment.id}>
                    <td className="mono">{payment.voucherNo}</td>
                    <td>{payment.subcontractorName}</td>
                    <td>{payment.status.replace(/_/g, ' ')}</td>
                    <td className="num">{formatETB(payment.netSantim)}</td>
                    <td className="num">{formatETB(payment.whtSantim)}</td>
                    <td className="num">{formatETB(payment.netPayableSantim)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {account.whtHeldSantim > 0 && (
              <p className="muted">
                {formatETB(account.whtHeldSantim)} was withheld from suppliers on this project and
                is owed to the authority.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>Stages</h2>
        {phases.error !== null && <p className="error" role="alert">{phases.error}</p>}
        {phases.rows.length === 0 ? (
          <p className="muted">No stage is set up on this project.</p>
        ) : (
          <table className="data-table">
            <caption className="sr-only">Stages on this project</caption>
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">Weight</th>
              </tr>
            </thead>
            <tbody>
              {phases.rows.map((phase) => (
                <tr key={phase.id}>
                  <td>{phase.name}</td>
                  <td>{phase.status.replace(/_/g, ' ')}</td>
                  <td className="num">{pct(phase.weightBps)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Only on lift work. A renovation with an empty lift table reads as a
          renovation that has lost its lifts. */}
      {lift && (
        <section className="card">
          <h2>Lifts</h2>
          {projectUnits.length === 0 ? (
            <p className="muted">
              No lift on the register names this project as the one that installed it.
            </p>
          ) : (
            <table className="data-table">
              <caption className="sr-only">Lifts installed under this project</caption>
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Code</th>
                  <th scope="col">Brand</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {projectUnits.map((unit) => (
                  <tr key={unit.id}>
                    <td>{unit.tag}</td>
                    <td className="mono">{unit.unitCode}</td>
                    <td>{unit.brand ?? '—'}</td>
                    <td>{unit.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}

/** One figure, with the sentence that says what it means underneath. */
function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="metric-tile">
      <p className="muted metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="muted metric-note">{note}</p>
    </div>
  );
}
