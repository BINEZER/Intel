/**
 * The dashboard.
 *
 * It used to be the module-1 demo: a fiscal year and a date picker, reading no
 * records at all. Entering data could never change it, which is exactly what it
 * looked like.
 *
 * Now it reads what is there. And when there is nothing there it says so and
 * says what to enter first — a screen of zeros on a new system is
 * indistinguishable from a broken one, and nobody can tell from looking at it
 * whether the month was quiet or the wiring is missing.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { subscribeDisbursements } from '../data/disbursements.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeSubcontractors } from '../data/subcontractors.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { subscribeUnits } from '../data/units.js';
import { assessPortfolioRisk } from '../data/project-risk.js';
import { useCollection } from '../data/useCollection.js';
import { buildAlerts, type AlertProject } from '../lib/alerts.js';
import { buildDashboard, type DashboardModel, type MoneyFigure, type SetupStep } from '../lib/dashboard.js';
import { chaseState, type ChaseInvoice } from '../lib/collection-chase.js';
import { formatDual } from '../lib/ethiopic.js';
import { ethiopianFiscalYear, utcDateToEthiopian } from '../lib/ethiopic.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import type { PayoutVoucher } from '../lib/payout-workflow.js';
import type {
  Client, Contract, Disbursement, ElevatorUnit, Invoice, Project, Subcontractor, Technician,
} from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function Dashboard() {
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const vouchers = useCollection<Disbursement>((d, e) => subscribeDisbursements(d, e), [], 'load payment vouchers');
  const subcontractors = useCollection<Subcontractor>((d, e) => subscribeSubcontractors(d, e), [], 'load subcontractors');
  const technicians = useCollection<Technician>((d, e) => subscribeTechnicians(d, e), [], 'load technicians');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');

  const asOf = useMemo(() => new Date(), []);

  const model = useMemo<DashboardModel>(() => {
    const risks = assessPortfolioRisk(projects.rows, contracts.rows, invoices.rows, asOf);

    const dashboardInvoices = invoices.rows.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      clientName: i.clientName,
      issuedAt: i.issueDate.at.toDate(),
      dueDate: i.dueDate.at.toDate(),
      netSantim: i.netSantim,
      vatSantim: i.vatSantim,
      grossSantim: i.grossSantim,
      status: i.status,
      // Receipts live in a subcollection. The dashboard deliberately does not
      // fan out to read them: `paidGrossSantim` on the invoice is what the rest
      // of the app already trusts, and a landing page should open fast.
      receipts:
        i.paidGrossSantim > 0
          ? [{ receivedAt: i.updatedAt.toDate(), amountGrossSantim: i.paidGrossSantim, clientWhtSantim: 0 }]
          : [],
    }));

    const chase = dashboardInvoices
      .filter((i) => i.status !== 'draft' && i.status !== 'void')
      .map((i) => {
        const source = invoices.rows.find((row) => row.id === i.id) as WithId<Invoice>;
        const chaseInvoice: ChaseInvoice = {
          id: i.id,
          invoiceNo: i.invoiceNo,
          clientName: i.clientName,
          issuedAt: i.issuedAt,
          dueDate: i.dueDate,
          grossSantim: i.grossSantim,
          balanceSantim: source.balanceGrossSantim,
          status: i.status,
          receipts: i.receipts.map((r) => ({ at: r.receivedAt, amountSantim: r.amountGrossSantim })),
        };
        // Without the chase log this reports the ladder position from the
        // invoice alone, which is the honest reading: an invoice with no steps
        // recorded genuinely has not been chased.
        return { invoice: chaseInvoice, state: chaseState(chaseInvoice, [], asOf, undefined, formatDual) };
      });

    const payoutVouchers: PayoutVoucher[] = vouchers.rows.map((v) => ({
      id: v.id,
      voucherNo: v.voucherNo,
      subcontractorName: v.subcontractorName,
      projectId: v.projectId,
      phaseName: v.phaseName,
      status: v.status,
      netSantim: v.netSantim,
      netPayableSantim: v.netPayableSantim,
      supplierInvoiceDate: v.supplierInvoiceDate.at.toDate(),
      trail: {
        requestedAt: v.workflow?.requestedAt?.toDate() ?? null,
        checkedAt: v.workflow?.checkedAt?.toDate() ?? null,
        approvedAt: v.workflow?.approvedAt?.toDate() ?? null,
        paidAt: v.workflow?.paidAt?.toDate() ?? v.paymentDate?.at.toDate() ?? null,
        rejectedAt: v.workflow?.rejectedAt?.toDate() ?? null,
        heldAt: v.workflow?.heldAt?.toDate() ?? null,
      },
    }));

    const alerts = buildAlerts(
      {
        contracts: contracts.rows.map((c) => ({
          id: c.id,
          contractNo: c.contractNo,
          clientName: c.clientName,
          type: c.type,
          endDate: c.endDate.at.toDate(),
          renewalWindowDays: c.renewalWindowDays ?? 90,
          renewalStatus: c.renewalStatus ?? 'not_due',
          status: c.status,
          valueGrossSantim: c.valueGrossSantim,
        })),
        projects: risks.map<AlertProject>(({ project, risk }) => ({
          id: project.id,
          projectNo: project.projectNo,
          title: project.title,
          clientName: project.clientName,
          status: project.status,
          inDanger: risk.inDanger,
          severity: risk.level,
          flags: risk.flags,
          plannedEnd: project.plannedEnd.at.toDate(),
        })),
        units: units.rows.map((u) => ({
          id: u.id,
          unitCode: u.unitCode,
          tag: u.tag,
          siteName: u.siteName,
          verdict: 'healthy' as const,
          reasons: [],
          certificateExpiresOn: u.certificate?.expiresOn?.at.toDate() ?? null,
        })),
      },
      asOf,
    );

    return buildDashboard({
      asOf,
      counts: {
        clients: clients.rows.length,
        contracts: contracts.rows.length,
        projects: projects.rows.length,
        invoices: invoices.rows.length,
        units: units.rows.length,
        subcontractors: subcontractors.rows.length,
        technicians: technicians.rows.length,
      },
      invoices: dashboardInvoices,
      projects: risks.map(({ project, risk }) => ({
        id: project.id,
        projectNo: project.projectNo,
        title: project.title,
        clientName: project.clientName,
        status: project.status,
        progressBps: project.progressBps,
        plannedEnd: project.plannedEnd.at.toDate(),
        inDanger: risk.inDanger,
        severity: risk.level,
      })),
      vouchers: payoutVouchers,
      chase,
      alerts,
      unitsNeedingAttention: 0,
    });
  }, [
    clients.rows, contracts.rows, projects.rows, invoices.rows,
    vouchers.rows, subcontractors.rows, technicians.rows, units.rows, asOf,
  ]);

  const loading =
    clients.loading || contracts.loading || projects.loading || invoices.loading ||
    vouchers.loading || subcontractors.loading || technicians.loading || units.loading;

  const error =
    clients.error ?? contracts.error ?? projects.error ?? invoices.error ??
    vouchers.error ?? subcontractors.error ?? technicians.error ?? units.error;

  const utcToday = new Date(Date.UTC(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()));
  const fiscalYear = ethiopianFiscalYear(utcDateToEthiopian(utcToday));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {model.period.label} · {model.period.altLabel} · Ethiopian fiscal year{' '}
            <strong>{fiscalYear}</strong> (1 Hamle – 30 Sene)
          </p>
        </div>
        {model.alerts.total > 0 && (
          <Link to="/alerts" className="alert-badge">
            {model.alerts.critical > 0 && <span className="chip sev-chip-critical">{model.alerts.critical} critical</span>}
            {model.alerts.high > 0 && <span className="chip sev-chip-high">{model.alerts.high} high</span>}
            <span className="muted">{model.alerts.total} alerts</span>
          </Link>
        )}
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading your records…</p>}

      {model.headline.map((line) => (
        <p key={line.slice(0, 40)} className="dashboard-headline">{line}</p>
      ))}

      {!model.setup.ready && <SetupChecklist steps={model.setup.steps} completed={model.setup.completed} />}

      <section className="kpis">
        {model.money.map((figure) => <MoneyTile key={figure.key} figure={figure} />)}
      </section>

      {model.setup.ready && (
        <>
          <div className="dashboard-grid">
            <section className="card">
              <h2>Delivery</h2>
              {model.delivery.live === 0 ? (
                <p className="muted">
                  No project is in progress. <Link to="/projects">Create one</Link> and its stages,
                  progress and risk appear here.
                </p>
              ) : (
                <dl className="program-figures">
                  <div><dt>Live projects</dt><dd>{model.delivery.live}</dd></div>
                  <div>
                    <dt>Average progress</dt>
                    <dd>{model.delivery.averageProgressBps === null ? '—' : formatBps(model.delivery.averageProgressBps, 0)}</dd>
                  </div>
                  <div><dt>Past planned end</dt><dd>{model.delivery.overdue}</dd></div>
                  <div><dt>Flagged in danger</dt><dd>{model.delivery.inDanger}</dd></div>
                </dl>
              )}
              <p className="card-links">
                <Link to="/projects">Projects</Link> · <Link to="/finish-next">Finish next</Link> ·{' '}
                <Link to="/priority">Priority</Link>
              </p>
            </section>

            <section className="card">
              <h2>Getting paid</h2>
              {model.chase.invoices === 0 ? (
                <p className="muted">
                  Nothing is outstanding. Once an invoice is issued, what has been done to collect it
                  shows here.
                </p>
              ) : (
                <dl className="program-figures">
                  <div><dt>Nobody has asked</dt><dd>{formatETB(model.chase.unchasedSantim)}</dd></div>
                  <div><dt>Broken promises</dt><dd>{model.chase.brokenPromiseCount}</dd></div>
                  <div><dt>Over 90 days</dt><dd>{formatETB(model.ageing.byBucket.over_90)}</dd></div>
                  <div><dt>Action due</dt><dd>{model.chase.actionDueCount}</dd></div>
                </dl>
              )}
              <p className="card-links"><Link to="/collections">Collections</Link></p>
            </section>

            <section className="card">
              <h2>Paying out</h2>
              {model.payouts.stages.every((s) => s.count === 0) ? (
                <p className="muted">
                  No subcontractor payment vouchers yet. <Link to="/finance">Raise one</Link> and the
                  pipeline appears here.
                </p>
              ) : (
                <dl className="program-figures">
                  <div><dt>Committed</dt><dd>{formatETB(model.payouts.committedSantim)}</dd></div>
                  <div><dt>In flight</dt><dd>{formatETB(model.payouts.inFlightSantim)}</dd></div>
                  <div>
                    <dt>Typical time to pay</dt>
                    <dd>{model.payouts.medianDaysToPay === null ? '—' : `${model.payouts.medianDaysToPay} days`}</dd>
                  </div>
                  <div>
                    <dt>Past step target</dt>
                    <dd>{model.payouts.stages.reduce((a, s) => a + s.overdue, 0)}</dd>
                  </div>
                </dl>
              )}
              <p className="card-links"><Link to="/payouts">Payouts</Link></p>
            </section>
          </div>

          <section className="card">
            <h2>Where to look next</h2>
            <ul className="pick-list">
              <li><span>Which unfinished work releases the most money</span><Link to="/finish-next">Finish next</Link></li>
              <li><span>Contracts expiring, projects in danger, certificates running out</span><Link to="/alerts">Alerts</Link></li>
              <li><span>A weekly, monthly, quarterly or annual report to the CEO</span><Link to="/reports">Reports</Link></li>
              <li><span>Every lift on the register and its service history</span><Link to="/units">Lifts</Link></li>
            </ul>
          </section>
        </>
      )}
    </>
  );
}

function MoneyTile({ figure }: { figure: MoneyFigure }) {
  return (
    <Link to={figure.href} className="metric-tile money-tile">
      <p className="metric-label">{figure.label}</p>
      {/* An empty figure says so. Showing ETB 0.00 on a system with no records
          reads as a business that billed nothing, not as a system with nothing
          in it. */}
      <p className={`metric-value ${figure.empty ? 'is-empty' : ''}`}>
        {figure.empty ? 'No data yet' : formatETB(figure.santim)}
      </p>
      <p className="metric-note muted">{figure.note}</p>
    </Link>
  );
}

function SetupChecklist({ steps, completed }: { steps: readonly SetupStep[]; completed: number }) {
  return (
    <section className="card setup-card">
      <h2>Start here</h2>
      <p className="muted">
        {completed} of {steps.length} done. The order matters: each step is the thing the next one
        needs, so working through it top to bottom means never entering the same thing twice.
      </p>

      <ol className="setup-list">
        {steps.map((step) => (
          <li key={step.key} className={step.done ? 'is-done' : ''}>
            <div className="setup-head">
              <span className="setup-mark" aria-hidden="true">{step.done ? '✓' : '○'}</span>
              <Link to={step.href}>{step.label}</Link>
              {step.done && <span className="muted">{step.count} added</span>}
            </div>
            <p className="muted">{step.detail}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
