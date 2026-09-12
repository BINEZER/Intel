/**
 * Monthly VAT and WHT returns.
 *
 * These produce the numbers a filing is built from. They are not the
 * declaration, and the accountant signs the return — the page says so, because
 * a screen that looks like a filing invites being treated as one.
 */

import { useState } from 'react';
import { subscribeInvoicesForPeriod } from '../data/invoices.js';
import { subscribeDisbursementsForPeriod } from '../data/disbursements.js';
import { useCollection } from '../data/useCollection.js';
import { buildVatReturn, buildWhtReturn, describeVatReturn } from '../lib/returns.js';
import { formatETB } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { ETHIOPIAN_MONTHS, utcDateToEthiopian } from '../lib/ethiopic.js';
import { KpiTile } from '../components/KpiTile.js';
import type { Disbursement, Invoice } from '../lib/schema.js';

export function Returns() {
  const today = utcDateToEthiopian(new Date());
  const [year, setYear] = useState(today.year);
  const [month, setMonth] = useState(today.month);

  const periodEc = `EC-${year}-${String(month).padStart(2, '0')}`;

  const invoices = useCollection<Invoice>(
    (d, e) => subscribeInvoicesForPeriod(periodEc, d, e),
    [periodEc],
    'load invoices for this period',
  );
  const disbursements = useCollection<Disbursement>(
    (d, e) => subscribeDisbursementsForPeriod(periodEc, d, e),
    [periodEc],
    'load disbursements for this period',
  );

  const vat = buildVatReturn(periodEc, invoices.rows, disbursements.rows);
  const wht = buildWhtReturn(
    periodEc,
    disbursements.rows.map((d) => ({
      voucherNo: d.voucherNo,
      subcontractorId: d.subcontractorId,
      subcontractorName: d.subcontractorName,
      subcontractorTin: d.subcontractorTin,
      whtCategory: d.whtCategory,
      whtRateBps: d.whtRateBps,
      whtBaseSantim: d.whtBaseSantim,
      whtSantim: d.whtSantim,
      certificateNo: d.whtCertificateNo,
      status: d.status,
    })),
  );

  return (
    <>
      <h1>Tax returns</h1>
      <p className="muted">
        Filed on the Ethiopian calendar month. These are the figures a return is
        built from — not the declaration itself.
      </p>

      <section className="card">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="ret-month">Month</label>
            <select id="ret-month" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {ETHIOPIAN_MONTHS.map((name, i) => (
                <option key={name} value={i + 1}>{i + 1}. {name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ret-year">Year (EC)</label>
            <input id="ret-year" type="number" value={year}
              onChange={(e) => setYear(Number(e.target.value) || today.year)} />
          </div>
        </div>
        <p className="hint">Period key <code>{periodEc}</code></p>
      </section>

      {(invoices.error ?? disbursements.error) !== null && (
        <p className="error" role="alert">{invoices.error ?? disbursements.error}</p>
      )}

      <section className="card">
        <h2>VAT</h2>
        <p className="muted">{describeVatReturn(vat)}</p>

        <div className="kpis">
          <KpiTile label="Output VAT" value={formatETB(vat.outputVatSantim)}
            detail={<span className="muted">{vat.invoiceCount} invoice{vat.invoiceCount === 1 ? '' : 's'} · {formatETB(vat.outputNetSantim)} net</span>}
            title="VAT charged on supplies made. Declared on issue, not on payment." />
          <KpiTile label="Input VAT" value={formatETB(vat.inputVatSantim)}
            detail={<span className="muted">{vat.disbursementCount} purchase{vat.disbursementCount === 1 ? '' : 's'} · {formatETB(vat.inputNetSantim)} net</span>}
            title="VAT charged to us by VAT-registered subcontractors, reclaimable." />
          <KpiTile
            label={vat.payableSantim > 0 ? 'Payable to ERCA' : 'Credit carried forward'}
            value={formatETB(vat.payableSantim > 0 ? vat.payableSantim : vat.creditCarriedForwardSantim)}
            status={vat.payableSantim > 0 ? 'warn' : 'good'}
          />
        </div>

        {(vat.excludedDrafts > 0 || vat.excludedVoids > 0) && (
          <p className="hint">
            Excluded from this return: {vat.excludedDrafts} draft
            {vat.excludedDrafts === 1 ? '' : 's'} and {vat.excludedVoids} void
            {vat.excludedVoids === 1 ? '' : 's'}. Drafts were never issued, so they carry
            no VAT — but check none should have been.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Withholding tax</h2>
        <div className="kpis">
          <KpiTile label="Total withheld" value={formatETB(wht.totalWhtSantim)}
            detail={<span className="muted">on {formatETB(wht.totalBaseSantim)} of purchases</span>} />
          <KpiTile label="Suppliers" value={wht.bySupplier.length} />
          <KpiTile
            label="Certificates outstanding"
            value={wht.missingCertificates}
            status={wht.missingCertificates > 0 ? 'bad' : 'good'}
            detail={<span className="muted">owed to suppliers</span>}
            title="A supplier who cannot produce their certificate cannot claim the credit."
          />
          {wht.noTinPayments > 0 && (
            <KpiTile label="No-TIN payments" value={wht.noTinPayments} status="warn"
              detail={<span className="muted">withheld at 30%</span>} />
          )}
        </div>

        {wht.bySupplier.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col">TIN</th>
                  <th scope="col" className="num">Payments</th>
                  <th scope="col" className="num">Base</th>
                  <th scope="col" className="num">Rate</th>
                  <th scope="col" className="num">Withheld</th>
                  <th scope="col" className="num">Certificates due</th>
                </tr>
              </thead>
              <tbody>
                {wht.bySupplier.map((supplier) => (
                  <tr key={supplier.subcontractorId}>
                    <td><strong>{supplier.subcontractorName}</strong></td>
                    <td className="mono">
                      {supplier.hasTin ? supplier.subcontractorTin : <span className="danger-text">none</span>}
                    </td>
                    <td className="num">{supplier.payments}</td>
                    <td className="num">{formatETB(supplier.baseSantim, { withSymbol: false })}</td>
                    <td className="num">{formatBps(supplier.effectiveRateBps)}</td>
                    <td className="num strong">{formatETB(supplier.whtSantim, { withSymbol: false })}</td>
                    <td className="num">
                      {supplier.missingCertificates > 0
                        ? <span className="danger-text">{supplier.missingCertificates}</span>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {wht.bySupplier.length === 0 && !disbursements.loading && (
          <p className="muted">No withholding recorded in {periodEc}.</p>
        )}
      </section>
    </>
  );
}
