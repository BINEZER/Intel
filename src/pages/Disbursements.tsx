/**
 * Subcontractor payment vouchers.
 *
 * The WHT breakdown is shown before the voucher is created, because the number
 * that matters — what actually leaves the bank — is not the number on the
 * subcontractor's invoice.
 */

import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  approveDisbursement,
  createDisbursement,
  payDisbursement,
  rejectDisbursement,
  subscribeDisbursements,
} from '../data/disbursements.js';
import { subscribeSubcontractors } from '../data/subcontractors.js';
import { subscribeProjects } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { computeDisbursement, formatETB, type WhtCategory } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { DualDateInput, DualDateText } from '../components/DualDateInput.js';
import { PayoutActions } from '../components/PayoutActions.js';
import { CurrencyAmountInput, emptyAmount, type CurrencyAmount } from '../components/CurrencyAmountInput.js';
import { formatConverted, RATE_SCALE } from '../lib/currency.js';
import type { Disbursement, DualDate, Project, Subcontractor } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { DeleteButton } from '../components/DeleteButton.js';

export function Disbursements() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageDisbursements');
  const [creating, setCreating] = useState(false);

  const rows = useCollection<Disbursement>((d, e) => subscribeDisbursements(d, e), [], 'load disbursements');
  const subcontractors = useCollection<Subcontractor>(
    (d, e) => subscribeSubcontractors(d, e, { activeOnly: true }), [], 'load subcontractors');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');

  return (
    <>
      <div className="page-head">
        <h1>Disbursements</h1>
        {editable && !creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)}>New voucher</button>
        )}
      </div>

      {rows.error && <p className="error" role="alert">{rows.error}</p>}

      {creating && user !== null && (
        <DisbursementForm
          subcontractors={subcontractors.rows}
          projects={projects.rows}
          uid={user.uid}
          onDone={() => setCreating(false)}
        />
      )}

      {rows.loading && <p className="muted">Loading…</p>}
      {!rows.loading && rows.rows.length === 0 && !rows.error && (
        <p className="muted">No payment vouchers yet.</p>
      )}

      {rows.rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Voucher</th>
                <th scope="col">Subcontractor</th>
                <th scope="col">Phase</th>
                <th scope="col" className="num">Net</th>
                <th scope="col" className="num">Their VAT</th>
                <th scope="col" className="num">Invoice</th>
                <th scope="col" className="num">WHT</th>
                <th scope="col" className="num">We pay</th>
                <th scope="col">Status</th>
                {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((voucher) => (
                <VoucherRow key={voucher.id} voucher={voucher}
                  editable={editable && user !== null} uid={user?.uid ?? ''} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function VoucherRow({
  voucher,
  editable,
  uid,
}: {
  voucher: WithId<Disbursement>;
  editable: boolean;
  uid: string;
}) {
  const { busy, error, run } = useAsyncAction('update this voucher');

  return (
    <tr>
      <td>
        <strong className="mono">{voucher.voucherNo}</strong>
        {voucher.whtCertificateNo !== undefined && (
          <><br /><span className="muted mono">{voucher.whtCertificateNo}</span></>
        )}
        {error && <p className="error">{error}</p>}
      </td>
      <td>
        {voucher.subcontractorName}
        {voucher.subcontractorTin.trim() === '' && (
          <><br /><span className="danger-text">no TIN</span></>
        )}
      </td>
      <td>{voucher.phaseName}</td>
      <td className="num">
        {formatETB(voucher.netSantim, { withSymbol: false })}
        {voucher.foreign !== undefined && (
          <><br /><span className="muted">
            {voucher.foreign.currency} {(voucher.foreign.amount / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </span></>
        )}
      </td>
      <td className="num muted">{formatETB(voucher.supplierVatSantim, { withSymbol: false })}</td>
      <td className="num">{formatETB(voucher.grossSantim, { withSymbol: false })}</td>
      <td className="num">
        {voucher.whtSantim > 0 ? (
          <>
            {formatETB(voucher.whtSantim, { withSymbol: false })}
            <br /><span className="muted">{formatBps(voucher.whtRateBps, 0)}</span>
          </>
        ) : (
          <span className="muted" title={voucher.whtExemptReason ?? undefined}>—</span>
        )}
      </td>
      <td className="num strong">{formatETB(voucher.netPayableSantim, { withSymbol: false })}</td>
      <td>
        <span className="chip">{voucher.status}</span>
        {voucher.paymentDate !== null && (
          <><br /><span className="muted"><DualDateText value={voucher.paymentDate} /></span></>
        )}
      </td>
      {editable && (
        <td className="actions-cell">
          <PayoutActions voucher={voucher} />
          <DeleteButton
            target={{
              kind: 'disbursement',
              id: voucher.id,
              name: voucher.voucherNo || 'this draft',
              status: voucher.status,
            }}
          />
        </td>
      )}
    </tr>
  );
}

function DisbursementForm({
  subcontractors,
  projects,
  uid,
  onDone,
}: {
  subcontractors: readonly WithId<Subcontractor>[];
  projects: readonly WithId<Project>[];
  uid: string;
  onDone: () => void;
}) {
  const [subcontractorId, setSubcontractorId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [phaseName, setPhaseName] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState<DualDate | null>(null);
  // Imported equipment is usually invoiced in USD; the ETB equivalent inside
  // this value is what every tax figure is computed from.
  const [amount, setAmount] = useState<CurrencyAmount>(() => emptyAmount('ETB'));
  const [category, setCategory] = useState<WhtCategory>('services');
  const netSantim = amount.baseAmountSantim;
  const { busy, error, run } = useAsyncAction('create this voucher');

  const subcontractor = subcontractors.find((s) => s.id === subcontractorId);

  // The same engine the write path uses, previewed live.
  const breakdown = useMemo(
    () =>
      subcontractor === undefined || netSantim <= 0
        ? null
        : computeDisbursement({
            netSantim,
            category,
            supplierVatRegistered: subcontractor.vatRegistered,
            supplierHasTin: subcontractor.hasTin,
          }),
    [subcontractor, netSantim, category],
  );

  const ready = subcontractor !== undefined && projectId !== '' && netSantim > 0 && invoiceDate !== null;

  async function submit() {
    if (!ready || subcontractor === undefined) return;
    const done = await run(() =>
      createDisbursement(
        {
          subcontractor: {
            id: subcontractor.id, name: subcontractor.name, tin: subcontractor.tin,
            hasTin: subcontractor.hasTin, vatRegistered: subcontractor.vatRegistered,
          },
          projectId,
          phaseId: '',
          phaseName: phaseName.trim() || 'General',
          supplierInvoiceNo: supplierInvoiceNo.trim(),
          supplierInvoiceDate: invoiceDate as DualDate,
          netSantim,
          whtCategory: category,
          ...(amount.currency === 'ETB'
            ? {}
            : {
                foreign: {
                  currency: amount.currency,
                  amount: amount.amount,
                  rateMicros: amount.rateMicros,
                  rateSource: 'NBE daily',
                },
              }),
        },
        uid,
      ),
    );
    if (done !== null) onDone();
  }

  return (
    <section className="card">
      <h2>New payment voucher</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="d-sub">Subcontractor <span className="req" aria-hidden="true">*</span></label>
          <select id="d-sub" value={subcontractorId} onChange={(e) => setSubcontractorId(e.target.value)}>
            <option value="">Select…</option>
            {subcontractors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {subcontractor !== undefined && !subcontractor.hasTin && (
            <p className="warn-text">No TIN on file — withholding applies at 30%.</p>
          )}
        </div>

        <div className="field">
          <label htmlFor="d-project">Project <span className="req" aria-hidden="true">*</span></label>
          <select id="d-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="d-phase">Phase</label>
          <input id="d-phase" value={phaseName} onChange={(e) => setPhaseName(e.target.value)}
            placeholder="Shaft preparation" />
        </div>

        <div className="field">
          <label htmlFor="d-inv">Their invoice number</label>
          <input id="d-inv" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
        </div>

        <CurrencyAmountInput
          label="Invoice amount (excluding VAT)"
          value={amount}
          onChange={setAmount}
          defaultRateMicros={RATE_SCALE}
          hint="The VAT-exclusive base. Withholding is charged on this, never on the VAT-inclusive total."
          required
        />

        <div className="field">
          <label htmlFor="d-cat">Withholding category</label>
          <select id="d-cat" value={category} onChange={(e) => setCategory(e.target.value as WhtCategory)}>
            <option value="services">Services / works (3%)</option>
            <option value="goods">Supply of goods (2%)</option>
            <option value="exempt">Exempt</option>
          </select>
        </div>
      </div>

      <DualDateInput label="Their invoice date" value={invoiceDate} onChange={setInvoiceDate} required />

      {breakdown !== null && (
        <div className="vat-summary">
          <div>
            <span className="muted">Their net</span>
            <strong>{formatETB(breakdown.netSantim)}</strong>
            {amount.currency !== 'ETB' && (
              <span className="muted">
                invoiced {formatConverted({
                  currency: amount.currency,
                  amount: amount.amount,
                  baseAmountSantim: amount.baseAmountSantim,
                  rateMicros: amount.rateMicros,
                  rateDate: new Date(),
                  rateSource: 'NBE daily',
                })}
              </span>
            )}
          </div>
          <div><span className="muted">Their VAT</span><strong>{formatETB(breakdown.supplierVatSantim)}</strong></div>
          <div><span className="muted">Their invoice</span><strong>{formatETB(breakdown.grossSantim)}</strong></div>
          <div>
            <span className="muted">WHT @ {formatBps(breakdown.whtRateBps, 0)}</span>
            <strong>−{formatETB(breakdown.whtSantim)}</strong>
          </div>
          <div className="total"><span className="muted">We pay</span><strong>{formatETB(breakdown.netPayableSantim)}</strong></div>
        </div>
      )}

      {breakdown?.whtExemptReason === 'below_threshold' && (
        <p className="hint">Below the per-transaction threshold — no withholding applies.</p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="form-actions">
        <button type="button" className="primary" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Create voucher'}
        </button>
        <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
      </div>
    </section>
  );
}
