/**
 * Financial reporting.
 *
 * Every figure traces to an invoice, a disbursement or a contract. Nothing here
 * is entered by hand, and nothing is carried forward from a previous version of
 * itself — a report that can disagree with its own source records is worse than
 * no report.
 */

import { useMemo, useState } from 'react';
import { subscribeInvoices } from '../data/invoices.js';
import { subscribeDisbursements } from '../data/disbursements.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeContracts } from '../data/contracts.js';
import { useCollection } from '../data/useCollection.js';
import {
  buildCashflowForecast,
  buildPeriodSeries,
  buildProjectStatement,
  currentFiscalYear,
  fiscalYearRange,
  isInFiscalYear,
  summarisePortfolio,
  type ProjectStatement,
} from '../lib/reporting.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { downloadCsv, money, percent, reportFilename, toCsv } from '../lib/csv.js';
import { KpiTile } from '../components/KpiTile.js';
import { TrendChart } from '../components/TrendChart.js';
import type { Contract, Disbursement, Invoice, Project } from '../lib/schema.js';

export function Reports() {
  const [fiscalYear, setFiscalYear] = useState(() => currentFiscalYear());

  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const disbursements = useCollection<Disbursement>((d, e) => subscribeDisbursements(d, e), [], 'load disbursements');

  const range = fiscalYearRange(fiscalYear);
  const asOf = new Date();

  const inYear = useMemo(() => {
    const inv = invoices.rows.filter((i) => isInFiscalYear(i.issueDate.at.toDate(), fiscalYear));
    const dis = disbursements.rows.filter((d) =>
      isInFiscalYear(d.supplierInvoiceDate.at.toDate(), fiscalYear),
    );
    return { invoices: inv, disbursements: dis };
  }, [invoices.rows, disbursements.rows, fiscalYear]);

  const statements: ProjectStatement[] = useMemo(
    () =>
      projects.rows.map((project) => {
        const contract = contracts.rows.find((c) => c.id === project.contractId) ?? null;
        return buildProjectStatement(
          { projectId: project.id, title: project.title, clientName: project.clientName },
          contract === null
            ? null
            : {
                netSantim: contract.valueNetSantim,
                vatSantim: contract.vatSantim,
                grossSantim: contract.valueGrossSantim,
              },
          inYear.invoices
            .filter((i) => i.projectId === project.id)
            .map((i) => ({
              invoiceNo: i.invoiceNo,
              issuedAt: i.issueDate.at.toDate(),
              dueDate: i.dueDate.at.toDate(),
              netSantim: i.netSantim,
              vatSantim: i.vatSantim,
              grossSantim: i.grossSantim,
              status: i.status,
              // Receipts live in a subcollection; the denormalized balance on
              // the invoice is what has actually been settled.
              receipts: [{ amountGrossSantim: i.paidGrossSantim, clientWhtSantim: 0 }],
            })),
          inYear.disbursements
            .filter((d) => d.projectId === project.id)
            .map((d) => ({
              voucherNo: d.voucherNo,
              subcontractorName: d.subcontractorName,
              phaseName: d.phaseName,
              paidAt: d.paymentDate?.at.toDate() ?? null,
              netSantim: d.netSantim,
              supplierVatSantim: d.supplierVatSantim,
              whtSantim: d.whtSantim,
              netPayableSantim: d.netPayableSantim,
              status: d.status,
            })),
        );
      }),
    [projects.rows, contracts.rows, inYear],
  );

  const portfolio = summarisePortfolio(statements);

  const series = useMemo(
    () =>
      buildPeriodSeries(
        inYear.invoices.map((i) => ({
          periodEc: i.vatPeriodEc, netSantim: i.netSantim, vatSantim: i.vatSantim, status: i.status,
        })),
        inYear.disbursements.map((d) => ({
          periodEc: d.whtPeriodEc, netSantim: d.netSantim,
          supplierVatSantim: d.supplierVatSantim, whtSantim: d.whtSantim, status: d.status,
        })),
      ),
    [inYear],
  );

  const cashflow = useMemo(
    () =>
      buildCashflowForecast(
        invoices.rows
          .filter((i) => i.status !== 'draft' && i.status !== 'void')
          .map((i) => ({ dueDate: i.dueDate.at.toDate(), balanceSantim: i.balanceGrossSantim })),
        disbursements.rows
          .filter((d) => d.status === 'approved')
          .map((d) => ({ dueDate: d.paymentDate?.at.toDate() ?? null, netPayableSantim: d.netPayableSantim })),
        asOf,
      ),
    [invoices.rows, disbursements.rows, asOf],
  );

  const loading = projects.loading || invoices.loading || disbursements.loading;
  const error = projects.error ?? contracts.error ?? invoices.error ?? disbursements.error;

  function exportStatements() {
    const csv = toCsv<ProjectStatement>(
      [
        { header: 'Project', value: (s) => s.title },
        { header: 'Client', value: (s) => s.clientName },
        { header: 'Contract net (ETB)', value: (s) => money(s.revenue.contractNetSantim) },
        { header: 'Invoiced net (ETB)', value: (s) => money(s.revenue.invoicedNetSantim) },
        { header: 'Output VAT (ETB)', value: (s) => money(s.tax.outputVatSantim) },
        { header: 'Collected (ETB)', value: (s) => money(s.revenue.collectedGrossSantim) },
        { header: 'Withheld by client (ETB)', value: (s) => money(s.revenue.withheldByClientSantim) },
        { header: 'Outstanding (ETB)', value: (s) => money(s.revenue.outstandingGrossSantim) },
        { header: 'Unbilled (ETB)', value: (s) => money(s.revenue.unbilledNetSantim) },
        { header: 'Subcontract cost net (ETB)', value: (s) => money(s.costs.subcontractNetSantim) },
        { header: 'Input VAT (ETB)', value: (s) => money(s.tax.inputVatSantim) },
        { header: 'Net VAT payable (ETB)', value: (s) => money(s.tax.netVatPayableSantim) },
        { header: 'WHT withheld (ETB)', value: (s) => money(s.tax.whtWithheldSantim) },
        { header: 'Contract margin (ETB)', value: (s) => money(s.margin.grossSantim) },
        { header: 'Contract margin %', value: (s) => percent(s.margin.grossBps) },
        { header: 'Realised margin (ETB)', value: (s) => money(s.margin.realisedSantim) },
        { header: 'Realised margin %', value: (s) => percent(s.margin.realisedBps) },
        { header: 'Net cash (ETB)', value: (s) => money(s.netCashSantim) },
      ],
      statements,
    );
    downloadCsv(reportFilename('project-statements', `fy${fiscalYear}`), csv);
  }

  function exportSeries() {
    const csv = toCsv(
      [
        { header: 'Period (EC)', value: (r: (typeof series)[number]) => r.periodEc },
        { header: 'Revenue net (ETB)', value: (r) => money(r.revenueNetSantim) },
        { header: 'Output VAT (ETB)', value: (r) => money(r.outputVatSantim) },
        { header: 'Cost net (ETB)', value: (r) => money(r.costNetSantim) },
        { header: 'Input VAT (ETB)', value: (r) => money(r.inputVatSantim) },
        { header: 'Margin (ETB)', value: (r) => money(r.marginSantim) },
        { header: 'Margin %', value: (r) => percent(r.marginBps) },
        { header: 'Net VAT payable (ETB)', value: (r) => money(r.netVatPayableSantim) },
        { header: 'WHT withheld (ETB)', value: (r) => money(r.whtWithheldSantim) },
        { header: 'Invoices', value: (r) => r.invoices },
        { header: 'Vouchers', value: (r) => r.vouchers },
      ],
      series,
    );
    downloadCsv(reportFilename('monthly-summary', `fy${fiscalYear}`), csv);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">{range.label}</p>
        </div>
        <div className="field inline-field">
          <label htmlFor="fy">Fiscal year</label>
          <select id="fy" value={fiscalYear} onChange={(e) => setFiscalYear(Number(e.target.value))}>
            {[0, 1, 2, 3].map((back) => {
              const year = currentFiscalYear() - back;
              return <option key={year} value={year}>FY {year}</option>;
            })}
          </select>
        </div>
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      <section className="kpis">
        <KpiTile label="Contract value" value={formatETB(portfolio.contractNetSantim)}
          detail={<span className="muted">{portfolio.projects} project{portfolio.projects === 1 ? '' : 's'}, VAT-exclusive</span>} />
        <KpiTile label="Invoiced" value={formatETB(portfolio.invoicedNetSantim)}
          detail={<span className="muted">{formatETB(portfolio.unbilledNetSantim)} left to bill</span>} />
        <KpiTile label="Collected" value={formatETB(portfolio.collectedGrossSantim)}
          detail={<span className="muted">{formatETB(portfolio.outstandingGrossSantim)} outstanding</span>}
          status={portfolio.outstandingGrossSantim > portfolio.collectedGrossSantim ? 'warn' : 'good'} />
        <KpiTile label="Gross margin" value={formatBps(portfolio.grossMarginBps)}
          detail={<span className="muted">{formatETB(portfolio.grossMarginSantim)}</span>} />
        <KpiTile label="Net VAT position" value={formatETB(portfolio.netVatPayableSantim)}
          detail={<span className="muted">output less input</span>}
          status={portfolio.netVatPayableSantim > 0 ? 'warn' : 'good'} />
        <KpiTile label="Loss-making" value={portfolio.lossMakingProjects}
          status={portfolio.lossMakingProjects > 0 ? 'bad' : 'good'}
          detail={<span className="muted">by realised margin</span>}
          title="Projects where the cost committed already exceeds what has been billed." />
      </section>

      <TrendChart rows={series} title="Monthly trend" />

      <section className="card">
        <div className="viz-head">
          <div>
            <h2>Cash-flow outlook</h2>
            <p className="muted">
              Money owed to us against payments we have approved. Overdue amounts are
              listed first and separately — they are not a forecast.
            </p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Window</th>
                <th scope="col" className="num">Expected in</th>
                <th scope="col" className="num">Committed out</th>
                <th scope="col" className="num">Net</th>
                <th scope="col" className="num">Running</th>
              </tr>
            </thead>
            <tbody>
              {cashflow.buckets.map((bucket) => (
                <tr key={bucket.bucket} className={bucket.bucket.startsWith('due') ? undefined : 'row-danger'}>
                  <td>{bucket.label}</td>
                  <td className="num">{formatETB(bucket.inflowSantim, { withSymbol: false })}</td>
                  <td className="num">{formatETB(bucket.outflowSantim, { withSymbol: false })}</td>
                  <td className={`num ${bucket.netSantim < 0 ? 'danger-text' : ''}`}>
                    {formatETB(bucket.netSantim, { withSymbol: false })}
                  </td>
                  <td className={`num strong ${bucket.cumulativeSantim < 0 ? 'danger-text' : ''}`}>
                    {formatETB(bucket.cumulativeSantim, { withSymbol: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="viz-head">
          <div>
            <h2>Project statements</h2>
            <p className="muted">
              Contract margin is what the job is worth if it finishes as sold.
              Realised margin is what has been earned on the work billed so far.
            </p>
          </div>
          <div className="form-actions inline-actions">
            <button type="button" onClick={exportStatements}>Export statements</button>
            <button type="button" onClick={exportSeries}>Export monthly</button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Project</th>
                <th scope="col" className="num">Contract</th>
                <th scope="col" className="num">Invoiced</th>
                <th scope="col" className="num">Collected</th>
                <th scope="col" className="num">Outstanding</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col" className="num">Contract margin</th>
                <th scope="col" className="num">Realised margin</th>
                <th scope="col" className="num">Net cash</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.projectId} className={s.margin.realisedSantim < 0 ? 'row-danger' : undefined}>
                  <td>
                    <strong>{s.title}</strong><br />
                    <span className="muted">{s.clientName}</span>
                  </td>
                  <td className="num">{formatETB(s.revenue.contractNetSantim, { withSymbol: false })}</td>
                  <td className="num">{formatETB(s.revenue.invoicedNetSantim, { withSymbol: false })}</td>
                  <td className="num">{formatETB(s.revenue.collectedGrossSantim, { withSymbol: false })}</td>
                  <td className="num">
                    {s.revenue.outstandingGrossSantim > 0
                      ? <span className="danger-text">{formatETB(s.revenue.outstandingGrossSantim, { withSymbol: false })}</span>
                      : <span className="muted">—</span>}
                  </td>
                  <td className="num">{formatETB(s.costs.subcontractNetSantim, { withSymbol: false })}</td>
                  <td className="num">{formatBps(s.margin.grossBps)}</td>
                  <td className={`num strong ${s.margin.realisedSantim < 0 ? 'danger-text' : ''}`}>
                    {formatBps(s.margin.realisedBps)}
                  </td>
                  <td className="num">{formatETB(s.netCashSantim, { withSymbol: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {statements.length === 0 && !loading && (
          <p className="muted">No projects with activity in {range.label}.</p>
        )}
      </section>
    </>
  );
}
