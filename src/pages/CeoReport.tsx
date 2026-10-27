/**
 * The report to the chief executive.
 *
 * One page, four horizons. Pick a week, month, quarter or year; the page builds
 * the report from the records as they stand, says what happened, and says what
 * is due in the period ahead. Nothing on it is typed in by a person, which is
 * the only reason it can be trusted to go to a board without being checked line
 * by line first.
 *
 * It exports as Word, PowerPoint or PDF — all three editable, none of them a
 * picture of a report.
 */

import { useMemo, useRef, useState } from 'react';
import { subscribeProjects } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { subscribeDisbursements } from '../data/disbursements.js';
import { usePortfolioDetail } from '../data/portfolio.js';
import { useCollection } from '../data/useCollection.js';
import {
  REPORT_FOCUSES,
  buildCeoReport,
  type ReportFocus,
  periodProgressNote,
  type CeoReport as CeoReportModel,
  type Metric,
  type ReportInputs,
  type ReportSection,
  type ReportTable,
} from '../lib/ceo-report.js';
import {
  PERIOD_KINDS,
  nextPeriod,
  periodContaining,
  previousPeriod,
  type CalendarBasis,
  type Period,
  type PeriodKind,
} from '../lib/period.js';
import { collectChartImages, exportDocx, exportPdf, exportPptx } from '../lib/report-export.js';
import { ELEVATOR_STAGE_TEMPLATE } from '../lib/stages.js';
import { ReportChart } from '../components/ReportChart.js';
import { formatDual } from '../lib/ethiopic.js';
import { normaliseProjectType } from '../lib/project-kind.js';
import { subscribeLiveTasks } from '../data/boards.js';
import type { Contract, Disbursement, Invoice, Project, Task } from '../lib/schema.js';

const KIND_LABEL: Record<PeriodKind, string> = {
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Annual',
};

const DEPENDS_ON = new Map(
  ELEVATOR_STAGE_TEMPLATE.map((s) => [s.key as string, s.dependsOn as readonly string[]]),
);

export function CeoReport() {
  const [focus, setFocus] = useState<ReportFocus>('overall');
  const [kind, setKind] = useState<PeriodKind>('month');
  const [basis, setBasis] = useState<CalendarBasis>('gregorian');
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const printable = useRef<HTMLDivElement>(null);

  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  // Board tasks, for the achievements report only. Everything else in this
  // file is a figure the business is managed on; a ticked card is not one.
  const tasks = useCollection<Task>((d, e) => subscribeLiveTasks(d, e), [], 'load tasks');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const disbursements = useCollection<Disbursement>(
    (d, e) => subscribeDisbursements(d, e),
    [],
    'load subcontractor payments',
  );
  const detail = usePortfolioDetail(projects.rows, contracts.rows, invoices.rows);

  const period = useMemo(() => periodContaining(kind, basis, anchor), [kind, basis, anchor]);
  const asOf = useMemo(() => new Date(), []);

  const report = useMemo<CeoReportModel>(() => {
    const projectById = new Map(projects.rows.map((p) => [p.id, p]));
    const phaseIdByKey = new Map(detail.stages.map((s) => [`${s.projectId}:${s.key}`, s.id]));

    const inputs: ReportInputs = {
      companyName: 'IntelMotion',
      period,
      asOf,
      projects: projects.rows.map((p) => ({
        id: p.id,
        projectNo: p.projectNo,
        title: p.title,
        clientName: p.clientName,
        type: normaliseProjectType(p.type),
        status: p.status,
        progressBps: p.progressBps,
        contractNetSantim: p.financials.contractNetSantim,
        plannedEnd: p.plannedEnd.at.toDate(),
        actualStart: p.actualStart?.at.toDate() ?? null,
        actualEnd: p.actualEnd?.at.toDate() ?? null,
      })),
      stages: detail.stages.map((s) => {
        const project = projectById.get(s.projectId);
        return {
          projectId: s.projectId,
          projectTitle: project?.title ?? s.projectId,
          clientName: project?.clientName ?? '',
          phaseId: s.id,
          stageKey: s.key,
          stageName: s.name,
          weightBps: s.weightBps,
          progressBps: s.progressBps,
          status: s.status,
          plannedEnd: s.plannedEnd?.at.toDate() ?? null,
          actualStart: s.actualStart?.at.toDate() ?? null,
          actualEnd: s.actualEnd?.at.toDate() ?? null,
          // Dependencies are template knowledge, resolved to the ids THIS project
          // actually has — a stage a manager deleted must not leave a phantom
          // predecessor that blocks everything downstream for ever.
          dependsOnPhaseIds: (DEPENDS_ON.get(s.key) ?? [])
            .map((key) => phaseIdByKey.get(`${s.projectId}:${key}`))
            .filter((id): id is string => id !== undefined),
        };
      }),
      invoices: invoices.rows.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        clientName: i.clientName,
        projectId: i.projectId,
        issuedAt: i.issueDate.at.toDate(),
        dueDate: i.dueDate.at.toDate(),
        netSantim: i.netSantim,
        vatSantim: i.vatSantim,
        grossSantim: i.grossSantim,
        status: i.status,
        receipts: (detail.receipts.get(i.id) ?? []).map((r) => ({
          receivedAt: r.receivedDate.at.toDate(),
          amountGrossSantim: r.amountGrossSantim,
          clientWhtSantim: r.clientWhtSantim,
        })),
      })),
      disbursements: disbursements.rows.map((d) => ({
        voucherNo: d.voucherNo,
        projectId: d.projectId,
        subcontractorName: d.subcontractorName,
        requestedAt: d.createdAt.toDate(),
        paidAt: d.paymentDate?.at.toDate() ?? null,
        netSantim: d.netSantim,
        supplierVatSantim: d.supplierVatSantim,
        whtSantim: d.whtSantim,
        netPayableSantim: d.netPayableSantim,
        status: d.status,
      })),
      milestones: detail.milestones.map((m) => {
        const contract = contracts.rows.find((c) => c.id === m.contractId);
        return {
          milestoneId: m.id,
          contractId: m.contractId,
          contractNo: contract?.contractNo ?? '',
          projectId: contract?.projectId ?? null,
          clientName: contract?.clientName ?? '',
          name: m.name,
          phaseId: m.phaseId ?? null,
          grossSantim: m.grossSantim,
          status: m.status,
          dueDate: m.dueDate?.at.toDate() ?? null,
        };
      }),
      contracts: contracts.rows.map((c) => ({
        id: c.id,
        contractNo: c.contractNo,
        clientName: c.clientName,
        title: c.title,
        type: c.type,
        signedDate: c.signedDate.at.toDate(),
        endDate: c.endDate.at.toDate(),
        renewalAlertAt: c.renewalAlertAt?.toDate() ?? null,
        status: c.status,
        valueGrossSantim: c.valueGrossSantim,
      })),
      tasks: tasks.rows.map((t) => ({
        title: t.title,
        completedAt: t.completedAt?.toDate() ?? null,
        archived: t.archived,
      })),
    };

    return buildCeoReport(inputs, focus);
  }, [projects.rows, contracts.rows, invoices.rows, disbursements.rows, detail, period, asOf]);

  const loading = projects.loading || contracts.loading || invoices.loading || disbursements.loading || detail.loading;
  const loadError =
    projects.error ?? contracts.error ?? invoices.error ?? disbursements.error ?? detail.error;
  const partial = periodProgressNote(period, asOf);

  async function runExport(format: 'docx' | 'pptx') {
    setExporting(format);
    setExportError(null);
    try {
      if (format === 'pptx') {
        await exportPptx(report);
      } else {
        const images = printable.current === null ? new Map() : await collectChartImages(printable.current);
        await exportDocx(report, images);
      }
    } catch {
      setExportError(`The ${format.toUpperCase()} could not be produced. The report itself is unaffected — try again, or use another format.`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <>
      <div className="report-controls no-print">
        <h1>Executive report</h1>

        <div className="report-toolbar">
          <fieldset className="focus-set">
            <legend>Report on</legend>
            {REPORT_FOCUSES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={focus === option.value ? 'primary' : ''}
                aria-pressed={focus === option.value}
                title={option.hint}
                onClick={() => setFocus(option.value)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>

          <fieldset>
            <legend>Period</legend>
            {PERIOD_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                className={kind === option ? 'primary' : ''}
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
              >
                {KIND_LABEL[option]}
              </button>
            ))}
          </fieldset>

          <fieldset>
            <legend>Calendar</legend>
            <button
              type="button"
              className={basis === 'gregorian' ? 'primary' : ''}
              aria-pressed={basis === 'gregorian'}
              onClick={() => setBasis('gregorian')}
            >
              Gregorian
            </button>
            <button
              type="button"
              className={basis === 'ethiopian' ? 'primary' : ''}
              aria-pressed={basis === 'ethiopian'}
              onClick={() => setBasis('ethiopian')}
              title="Months of 30 days, quarters and a fiscal year running 1 Hamle to 30 Sene."
            >
              Ethiopian
            </button>
          </fieldset>

          <fieldset>
            <legend>Which {kind}</legend>
            <PeriodStepper period={period} onChange={(next) => setAnchor(next.start)} />
          </fieldset>

          <fieldset>
            <legend>Export</legend>
            <button type="button" disabled={exporting !== null} onClick={() => void runExport('docx')}>
              {exporting === 'docx' ? 'Building…' : 'Word'}
            </button>
            <button type="button" disabled={exporting !== null} onClick={() => void runExport('pptx')}>
              {exporting === 'pptx' ? 'Building…' : 'PowerPoint'}
            </button>
            <button
              type="button"
              disabled={exporting !== null}
              onClick={() => exportPdf()}
              title="Opens your browser's print dialog — choose “Save as PDF” as the destination."
            >
              PDF
            </button>
          </fieldset>
        </div>

        {exportError !== null && <p className="error" role="alert">{exportError}</p>}
        {loadError !== null && <p className="error" role="alert">{loadError}</p>}
        {loading && <p className="muted">Gathering records…</p>}
      </div>

      <article className="report-sheet" ref={printable}>
        <header className="report-head">
          <p className="report-brand">{report.companyName.toUpperCase()}</p>
          <h2>{report.title}</h2>
          <p className="muted">
            {report.period.label} · {report.periodRange}
          </p>
          <p className="muted">
            {report.period.altLabel} · prepared {formatDual(report.generatedAt)} · compared against{' '}
            {report.comparison.label}
          </p>
          {partial !== null && <p className="warn-text">{partial}</p>}
        </header>

        <section className="report-block">
          <h3>Executive summary</h3>
          {report.executiveSummary.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </section>

        <section className="report-block">
          <h3>Headline figures</h3>
          <div className="metric-grid">
            {report.headline.map((metric) => (
              <MetricTile key={metric.key} metric={metric} />
            ))}
          </div>
        </section>

        {report.sections.map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}

        {/* Only when there IS something below it: a heading with nothing under
            it promises a section that is not there. */}
        {report.plan.length > 0 && (
          <section className="report-block report-plan-head">
            <h3>The {report.ahead.kind} ahead — {report.ahead.label}</h3>
            <p className="muted">
              Everything below is derived from dates and milestones already recorded. It is what the
              records commit us to, not a forecast.
            </p>
          </section>
        )}

        {report.plan.map((section) => (
          <SectionBlock key={section.id} section={section} />
        ))}

        <footer className="report-foot muted">
          Generated from {report.companyName}'s project, contract, invoice and payment records on{' '}
          {formatDual(report.generatedAt)}. Every figure traces to a stored document; nothing is estimated.
        </footer>
      </article>
    </>
  );
}

function PeriodStepper({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  return (
    <span className="period-stepper">
      <button type="button" aria-label={`Previous ${period.kind}`} onClick={() => onChange(previousPeriod(period))}>
        ←
      </button>
      <span className="period-label">{period.shortLabel}</span>
      <button type="button" aria-label={`Next ${period.kind}`} onClick={() => onChange(nextPeriod(period))}>
        →
      </button>
    </span>
  );
}

function MetricTile({ metric }: { metric: Metric }) {
  // A metric moving the wrong way for what it measures is the only thing worth
  // colouring. Direction alone is meaningless: cost falling is good news.
  const tone =
    metric.direction === null || metric.direction === 'flat' || metric.polarity === 'neutral'
      ? 'flat'
      : (metric.direction === 'up') === (metric.polarity === 'higher_is_better')
        ? 'good'
        : 'bad';

  return (
    <div className={`metric-tile tone-${tone}`}>
      <p className="metric-label">{metric.label}</p>
      <p className="metric-value">{metric.value}</p>
      <p className="metric-note muted">
        {metric.direction === 'up' ? '▲ ' : metric.direction === 'down' ? '▼ ' : ''}
        {metric.note}
      </p>
    </div>
  );
}

function SectionBlock({ section }: { section: ReportSection }) {
  return (
    <section className="report-block">
      <h3>{section.heading}</h3>
      {section.narrative.map((paragraph) => (
        <p key={paragraph.slice(0, 40)}>{paragraph}</p>
      ))}

      {section.metrics !== undefined && section.metrics.length > 0 && (
        <div className="metric-grid">
          {section.metrics.map((metric) => (
            <MetricTile key={metric.key} metric={metric} />
          ))}
        </div>
      )}

      {section.chart !== undefined && (
        <div data-chart-id={section.chart.id}>
          <ReportChart spec={section.chart} />
        </div>
      )}

      {section.table !== undefined && <DataTable table={section.table} />}
    </section>
  );
}

function DataTable({ table }: { table: ReportTable }) {
  if (table.rows.length === 0) {
    return (
      <p className="muted">
        <strong>{table.caption}.</strong> {table.emptyMessage}
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption>{table.caption}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === 'right' ? 'num' : ''}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={`${row[table.columns[0]?.key ?? ''] ?? ''}-${index}`}>
              {table.columns.map((column) => (
                <td key={column.key} className={column.align === 'right' ? 'num' : ''}>
                  {row[column.key] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
