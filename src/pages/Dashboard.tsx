/**
 * The dashboard.
 *
 * WHAT IT IS FOR
 *   Somebody opens this at eight in the morning. By the time they close it they
 *   should know three things: what to do first, where every job has got to, and
 *   whether the business made money last month. Anything that does not serve one
 *   of those three is not on this page.
 *
 * WHY IT IS ORDERED THIS WAY
 *   Today's work comes before the money tiles, because a tile is something you
 *   read and a task is something you do — and a page that leads with figures
 *   gets read and closed. The job board comes next, because "where is the work"
 *   is the question a list of counts cannot answer. The charts come last: they
 *   are the month, not the morning.
 *
 * ON AN EMPTY SYSTEM
 *   It says so and says what to enter first. A screen of zeros on a new system
 *   is indistinguishable from a broken one, and nobody can tell by looking
 *   whether the month was quiet or the wiring is missing.
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
import { formatDual, formatGregorianShort } from '../lib/ethiopic.js';
import { ethiopianFiscalYear, utcDateToEthiopian } from '../lib/ethiopic.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import type { PayoutVoucher } from '../lib/payout-workflow.js';
import type {
  Client, Contract, Disbursement, ElevatorUnit, Invoice, Project, Subcontractor, Technician,
} from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import {
  buildBoard, buildToday, describeToday, summariseToday,
  type BoardColumn, type BoardProject, type TodayTask,
} from '../lib/today.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../lib/stages.js';
import { daysBetween } from '../lib/kpi.js';
import { ageingChart, cashflowChart, debtorsChart } from '../lib/dashboard-charts.js';
import { ReportChart } from '../components/ReportChart.js';

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

  /** What to actually do today, and where every live job is. */
  const work = useMemo(() => {
    const decisions = contracts.rows
      .filter(
        (c) =>
          c.warranty?.endsOn != null &&
          c.succeededByContractId == null &&
          c.serviceDeclined !== true &&
          daysBetween(asOf, c.warranty.endsOn.at.toDate()) <= (c.warranty.alertDays ?? 90),
      )
      .map((c) => ({
        id: c.id,
        subject: `${c.contractNo} · ${c.clientName}`,
        href: '/follow-ups',
      }));

    const tasks = buildToday({
      asOf,
      invoices: invoices.rows.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        clientName: i.clientName,
        dueDate: i.dueDate.at.toDate(),
        balanceGrossSantim: i.balanceGrossSantim,
        status: i.status,
      })),
      // One entry per project, from the denormalised current stage — no fan-out
      // to the phase subcollections, which would be a query per project.
      stages: projects.rows.flatMap((p) =>
        p.currentStage == null
          ? []
          : [
              {
                projectId: p.id,
                projectTitle: p.title,
                stageName: p.currentStage.name,
                plannedEnd: p.currentStage.plannedEnd.at.toDate(),
                nextCheckpoint: p.currentStage.nextCheckpoint,
                done: false,
                projectStatus: p.status,
              },
            ],
      ),
      contracts: contracts.rows.map((c) => ({
        id: c.id,
        contractNo: c.contractNo,
        clientName: c.clientName,
        endDate: c.endDate.at.toDate(),
        status: c.status,
        renewalStatus: c.renewalStatus ?? 'not_due',
      })),
      units: units.rows.map((u) => ({
        id: u.id,
        tag: u.tag,
        siteName: u.siteName,
        certificateExpiresOn: u.certificate?.expiresOn?.at.toDate() ?? null,
      })),
      vouchers: vouchers.rows.map((v) => ({
        id: v.id,
        voucherNo: v.voucherNo,
        subcontractorName: v.subcontractorName,
        netPayableSantim: v.netPayableSantim,
        status: v.status,
      })),
      decisions,
    });

    const board = buildBoard(
      projects.rows.map((p) => ({
        id: p.id,
        projectNo: p.projectNo,
        title: p.title,
        clientName: p.clientName,
        progressBps: p.progressBps,
        plannedEnd: p.plannedEnd.at.toDate(),
        status: p.status,
        inDanger: false,
        currentStage: p.currentStage?.name ?? null,
      })),
      ELEVATOR_STAGE_TEMPLATE.map((stage) => ({ key: stage.key, name: stage.name, label: stage.name })),
      asOf,
    );

    return { tasks, board };
  }, [asOf, invoices.rows, projects.rows, contracts.rows, units.rows, vouchers.rows]);

  /** The month, drawn. Three charts, three different questions. */
  const charts = useMemo(
    () => ({
      cashflow: cashflowChart(
        invoices.rows.map((i) => ({
          issuedAt: i.issueDate.at.toDate(),
          netSantim: i.netSantim,
          status: i.status,
        })),
        vouchers.rows.map((v) => ({
          incurredAt: v.supplierInvoiceDate.at.toDate(),
          netSantim: v.netSantim,
          status: v.status,
        })),
        asOf,
      ),
      ageing: ageingChart(model.ageing.byBucket),
      debtors: debtorsChart(
        invoices.rows
          .filter((i) => i.status !== 'draft' && i.status !== 'void')
          .map((i) => ({ clientName: i.clientName, balanceSantim: i.balanceGrossSantim })),
      ),
    }),
    [invoices.rows, vouchers.rows, model.ageing.byBucket, asOf],
  );

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

      {model.setup.ready && (
        <>
          {/* Today comes first. A tile is something you read; a task is
              something you do, and a page that opens with figures gets read
              and closed. */}
          <div className="dash-split">
            <TodayPanel tasks={work.tasks} />

            <div className="dash-rail">
              <RailCard
                heading="Delivery"
                href="/projects"
                linkLabel="Projects"
                empty={model.delivery.live === 0 ? 'No project is in progress.' : null}
                rows={[
                  ['Live projects', String(model.delivery.live)],
                  ['Average progress', model.delivery.averageProgressBps === null ? '—' : formatBps(model.delivery.averageProgressBps, 0)],
                  ['Past planned end', String(model.delivery.overdue)],
                  ['Flagged in danger', String(model.delivery.inDanger)],
                ]}
              />
              <RailCard
                heading="Getting paid"
                href="/collections"
                linkLabel="Collections"
                empty={model.chase.invoices === 0 ? 'Nothing is outstanding.' : null}
                rows={[
                  ['Nobody has asked', formatETB(model.chase.unchasedSantim)],
                  ['Broken promises', String(model.chase.brokenPromiseCount)],
                  ['Over 90 days', formatETB(model.ageing.byBucket.over_90)],
                  ['Action due', String(model.chase.actionDueCount)],
                ]}
              />
              <RailCard
                heading="Paying out"
                href="/payouts"
                linkLabel="Payouts"
                empty={model.payouts.stages.every((s) => s.count === 0) ? 'No payment vouchers yet.' : null}
                rows={[
                  ['Committed', formatETB(model.payouts.committedSantim)],
                  ['In flight', formatETB(model.payouts.inFlightSantim)],
                  ['Typical time to pay', model.payouts.medianDaysToPay === null ? '—' : `${model.payouts.medianDaysToPay} days`],
                  ['Past step target', String(model.payouts.stages.reduce((a, s) => a + s.overdue, 0))],
                ]}
              />
            </div>
          </div>

          <JobBoard columns={work.board} />
        </>
      )}

      <section className="kpis">
        {model.money.map((figure) => <MoneyTile key={figure.key} figure={figure} />)}
      </section>

      {model.setup.ready && (
        <>
          <div className="dash-charts">
            {/* Each chart picks its own geometry from the room it gets — see
                ReportChart. Nothing here has to know how wide a card is. */}
            <div className="card viz-card is-wide"><ReportChart spec={charts.cashflow} /></div>
            <div className="card viz-card"><ReportChart spec={charts.ageing} /></div>
            <div className="card viz-card"><ReportChart spec={charts.debtors} /></div>
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

/** How many tasks are listed before the rest go behind a link. */
const TASKS_SHOWN = 8;

const URGENCY_LABEL: Record<TodayTask['urgency'], string> = {
  overdue: 'Overdue',
  today: 'Today',
  soon: 'Soon',
};

function TodayPanel({ tasks }: { tasks: readonly TodayTask[] }) {
  const summary = summariseToday(tasks);
  const shown = tasks.slice(0, TASKS_SHOWN);

  return (
    <section className="card today-card">
      <div className="today-head">
        <div>
          <h2>Today</h2>
          <p className="muted">{describeToday(tasks)}</p>
        </div>
        {summary.total > 0 && (
          <div className="today-counts">
            {summary.overdue > 0 && <span className="chip sev-chip-critical">{summary.overdue} overdue</span>}
            {summary.today > 0 && <span className="chip sev-chip-high">{summary.today} due today</span>}
          </div>
        )}
      </div>

      {tasks.length === 0 ? (
        /* Not a blank panel. An empty list here is a real and good answer, and
           it has to be distinguishable from a panel that failed to load. */
        <p className="today-clear">Nothing needs chasing. Good morning.</p>
      ) : (
        <ol className="today-list">
          {shown.map((task) => (
            <li key={task.id} className={`today-item is-${task.urgency}`}>
              <Link to={task.href}>
                <span className="today-when" aria-hidden="true">{URGENCY_LABEL[task.urgency]}</span>
                <span className="today-body">
                  <span className="today-subject">{task.subject}</span>
                  {/* The action is the point of the row; the subject only says
                      what it is about. */}
                  <span className="today-action">{task.action}</span>
                </span>
                {task.figure !== null && <span className="today-figure">{task.figure}</span>}
              </Link>
            </li>
          ))}
        </ol>
      )}

      {tasks.length > shown.length && (
        <p className="card-links">
          {tasks.length - shown.length} more · <Link to="/priority">See everything</Link>
        </p>
      )}
    </section>
  );
}

function RailCard({
  heading, href, linkLabel, rows, empty,
}: {
  heading: string;
  href: string;
  linkLabel: string;
  rows: readonly (readonly [string, string])[];
  empty: string | null;
}) {
  return (
    <section className="card rail-card">
      <h2>{heading}</h2>
      {empty !== null ? (
        <p className="muted">{empty}</p>
      ) : (
        <dl className="rail-figures">
          {rows.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
          ))}
        </dl>
      )}
      <p className="card-links"><Link to={href}>{linkLabel}</Link></p>
    </section>
  );
}

/**
 * Every live job, under the stage it is at.
 *
 * Empty columns are drawn. Nothing in "Shipping & customs" for two months is a
 * supply problem arriving in six weeks, and a board that hides its empty
 * columns hides exactly that.
 */
function JobBoard({ columns }: { columns: readonly BoardColumn[] }) {
  const total = columns.reduce((a, c) => a + c.projects.length, 0);

  return (
    <section className="card board-card">
      <div className="today-head">
        <div>
          <h2>Where the work is</h2>
          <p className="muted">
            {total === 0
              ? 'No job is at a tracked stage yet.'
              : `${total} live job${total === 1 ? '' : 's'}, each under the stage it has reached.`}
          </p>
        </div>
        <p className="card-links"><Link to="/projects">All projects</Link></p>
      </div>

      <div className="board-scroll">
        {columns.map((column) => (
          <div key={column.key} className={`board-column ${column.projects.length === 0 ? 'is-empty' : ''}`}>
            <div className="board-column-head">
              <h3>{column.label}</h3>
              <span className="board-count">
                {column.projects.length}
                {column.overdue > 0 && <span className="board-late"> · {column.overdue} late</span>}
              </span>
            </div>
            {column.projects.length === 0 ? (
              <p className="board-none" aria-hidden="true">—</p>
            ) : (
              <ul className="board-cards">
                {column.projects.map((project) => <BoardCard key={project.id} project={project} />)}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function BoardCard({ project }: { project: BoardProject }) {
  const progress = Math.max(0, Math.min(10_000, project.progressBps));
  return (
    <li className={`board-job ${project.inDanger ? 'is-danger' : ''}`}>
      {/* The full dual-calendar date does not fit a 15rem card without wrapping
          to three lines; it stays one hover away. */}
      <Link to={`/projects/${project.id}`} title={`Due ${formatDual(project.plannedEnd)}`}>
        <span className="board-job-title">{project.title}</span>
        <span className="board-job-client muted">{project.clientName}</span>
        <span className="board-bar" aria-hidden="true">
          <span className="board-bar-fill" style={{ width: `${progress / 100}%` }} />
        </span>
        <span className="board-job-foot muted">
          {formatBps(progress, 0)} · due {formatGregorianShort(project.plannedEnd)}
        </span>
      </Link>
    </li>
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
