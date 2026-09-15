/**
 * Technicians and subcontractors: the two kinds of people who do the work.
 *
 * WHY ONE PAGE FOR BOTH
 *   They appear together on every roster the business already keeps, and the
 *   difference between them is the point: one is on the payroll and is scored
 *   on KPIs, the other is a supplier and is paid through a voucher that
 *   withholds tax. Putting them side by side makes the distinction visible
 *   rather than something you have to remember which menu holds.
 *
 * WHY THE TIN IS SHOUTED ABOUT
 *   Withholding on a subcontractor is 2% on goods or 3% on services — but 30%
 *   when they have no TIN. That is not a validation nicety: it is the
 *   difference between paying somebody and paying the tax authority most of
 *   what you owe them. A subcontractor with no TIN therefore says so in the
 *   list, in red, rather than leaving a field quietly blank.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  createSubcontractor,
  subscribeSubcontractors,
  updateSubcontractor,
} from '../data/subcontractors.js';
import { createTechnician, subscribeTechnicians, updateTechnician } from '../data/technicians.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { FormPanel } from '../components/FormPanel.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { WHT, type WhtCategory } from '../lib/money.js';
import type { WithId } from '../data/repository.js';
import type { Subcontractor, Technician } from '../lib/schema.js';

/** Basis points as a percentage, for a sentence a person reads. */
const pct = (bps: number): string => String(bps / 100);

/** Comma-separated text to a trimmed list, and back. */
function toList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

export function People() {
  const { role } = useAuth();
  const editable = can(role, 'manageProjects');

  return (
    <div className="page">
      <PrintHeader title="Technicians and subcontractors" />
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">
            Our technicians, and the subcontractors we pay. A technician is scored on KPIs; a
            subcontractor is paid through a voucher that withholds tax.
          </p>
        </div>
        <PrintButton label="Print list" />
      </div>

      <Technicians editable={editable} />
      <Subcontractors editable={editable} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technicians
// ---------------------------------------------------------------------------

const DISCIPLINE_LABEL: Record<Technician['discipline'], string> = {
  installation: 'Installation',
  service: 'Service',
  both: 'Both',
};

function Technicians({ editable }: { editable: boolean }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState<WithId<Technician> | 'new' | null>(null);
  const { rows, loading, error } = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e),
    [],
    'load technicians',
  );

  return (
    <section className="card">
      <div className="viz-head">
        <div>
          <h2>Technicians</h2>
          <p className="muted">
            {rows.length} on the roster. An expiring competency card raises an alert, so keep the
            certifications up to date.
          </p>
        </div>
        {editable && editing === null && (
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            Add technician
          </button>
        )}
      </div>

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {editing !== null && user !== null && (
        <TechnicianForm
          initial={editing === 'new' ? null : editing}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      {rows.length === 0 && !loading ? (
        <p className="muted">Nobody yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Phone</th>
                <th scope="col">Does</th>
                <th scope="col">Trades</th>
                <th scope="col">Cards</th>
                <th scope="col">Status</th>
                {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((technician) => (
                <tr key={technician.id}>
                  <td>
                    <strong>{technician.name}</strong>
                    <br />
                    <span className="muted mono">{technician.employeeNo}</span>
                  </td>
                  <td>{technician.phone || <span className="muted">—</span>}</td>
                  <td>{DISCIPLINE_LABEL[technician.discipline]}</td>
                  <td className="muted">
                    {technician.trades.length === 0 ? '—' : technician.trades.join(', ')}
                  </td>
                  <td className="num">
                    {technician.certifications.length === 0 ? (
                      <span className="muted">none</span>
                    ) : (
                      technician.certifications.length
                    )}
                  </td>
                  <td>
                    <span className={`chip chip-status-${technician.status === 'active' ? 'good' : 'idle'}`}>
                      {technician.status.replace(/_/g, ' ')}
                    </span>
                  </td>
                  {editable && (
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(technician)}>Edit</button>
                        <DeleteButton
                          target={{ kind: 'technician', id: technician.id, name: technician.name }}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TechnicianForm({
  initial,
  uid,
  onDone,
}: {
  initial: WithId<Technician> | null;
  uid: string;
  onDone: () => void;
}) {
  const { busy, error, run } = useAsyncAction('save the technician');
  const [name, setName] = useState(initial?.name ?? '');
  const [employeeNo, setEmployeeNo] = useState(initial?.employeeNo ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [discipline, setDiscipline] = useState<Technician['discipline']>(
    initial?.discipline ?? 'both',
  );
  const [trades, setTrades] = useState((initial?.trades ?? []).join(', '));
  const [hours, setHours] = useState(String((initial?.contractedMinutesPerWeek ?? 2400) / 60));
  const [status, setStatus] = useState<Technician['status']>(initial?.status ?? 'active');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minutes = Math.round(Number(hours) * 60);
    const input = {
      employeeNo: employeeNo.trim(),
      name: name.trim(),
      uid: initial?.uid ?? null,
      subcontractorId: initial?.subcontractorId ?? null,
      phone: phone.trim(),
      discipline,
      trades: toList(trades),
      certifications: initial?.certifications ?? [],
      contractedMinutesPerWeek: Number.isFinite(minutes) && minutes > 0 ? minutes : 2400,
      status,
    };
    const done = await run(async () => {
      if (initial === null) await createTechnician(input, uid);
      else await updateTechnician(initial.id, input, uid);
      return true;
    });
    if (done !== null) onDone();
  }

  return (
    <FormPanel
      title={initial === null ? 'New technician' : `Edit ${initial.name}`}
      onClose={onDone}
    >
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="t-name">Name</label>
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="t-no">Employee number</label>
            <input
              id="t-no"
              value={employeeNo}
              onChange={(e) => setEmployeeNo(e.target.value)}
              placeholder="T-001"
            />
          </div>
          <div className="field">
            <label htmlFor="t-phone">Phone</label>
            <input id="t-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="t-disc">What they do</label>
            <select
              id="t-disc"
              value={discipline}
              onChange={(e) => setDiscipline(e.target.value as Technician['discipline'])}
            >
              <option value="installation">Installation</option>
              <option value="service">Service and maintenance</option>
              <option value="both">Both</option>
            </select>
            <p className="field-hint">
              Installers are judged on stages delivered, service technicians on callouts closed.
              Scoring an installer on response time produces nothing but blanks.
            </p>
          </div>
          <div className="field">
            <label htmlFor="t-hours">Hours a week</label>
            <input
              id="t-hours"
              type="number"
              min="1"
              max="80"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <p className="field-hint">Used for the utilisation figure on Performance.</p>
          </div>
          <div className="field">
            <label htmlFor="t-status">Status</label>
            <select
              id="t-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Technician['status'])}
            >
              <option value="active">Active</option>
              <option value="on_leave">On leave</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="t-trades">Trades</label>
          <input
            id="t-trades"
            value={trades}
            onChange={(e) => setTrades(e.target.value)}
            placeholder="mechanical, electrical, door adjustment"
          />
          <p className="field-hint">Separate with commas.</p>
        </div>

        {initial !== null && initial.certifications.length > 0 && (
          <p className="muted">
            {initial.certifications.length} competency card
            {initial.certifications.length === 1 ? '' : 's'} on file:{' '}
            {initial.certifications.map((c) => c.name).join(', ')}.
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}

// ---------------------------------------------------------------------------
// Subcontractors
// ---------------------------------------------------------------------------

const WHT_LABEL: Record<WhtCategory, string> = {
  goods: `Goods — ${pct(WHT.GOODS_BPS)}% withheld`,
  services: `Services — ${pct(WHT.SERVICES_BPS)}% withheld`,
  exempt: 'Exempt — nothing withheld',
};

function Subcontractors({ editable }: { editable: boolean }) {
  const { user } = useAuth();
  const [editing, setEditing] = useState<WithId<Subcontractor> | 'new' | null>(null);
  const { rows, loading, error } = useCollection<Subcontractor>(
    (d, e) => subscribeSubcontractors(d, e),
    [],
    'load subcontractors',
  );

  const missingTin = rows.filter((row) => !row.hasTin).length;

  return (
    <section className="card">
      <div className="viz-head">
        <div>
          <h2>Subcontractors</h2>
          <p className="muted">
            {rows.length} on file. Their TIN sets the withholding rate on every voucher we raise.
          </p>
        </div>
        {editable && editing === null && (
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            Add subcontractor
          </button>
        )}
      </div>

      {missingTin > 0 && (
        <p className="warn-text">
          {missingTin} subcontractor{missingTin === 1 ? ' has' : 's have'} no TIN, so a voucher
          raised against them withholds {pct(WHT.NO_TIN_BPS)}% instead of{' '}
          {pct(WHT.GOODS_BPS)}% or {pct(WHT.SERVICES_BPS)}%. Add the TIN before paying.
        </p>
      )}

      {error !== null && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading…</p>}

      {editing !== null && user !== null && (
        <SubcontractorForm
          initial={editing === 'new' ? null : editing}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      {rows.length === 0 && !loading ? (
        <p className="muted">None yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">TIN</th>
                <th scope="col">Withholding</th>
                <th scope="col">Trades</th>
                <th scope="col">Bank</th>
                <th scope="col">Status</th>
                {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((sub) => (
                <tr key={sub.id} className={sub.hasTin ? undefined : 'row-danger'}>
                  <td>
                    <strong>{sub.name}</strong>
                    {sub.contacts[0] !== undefined && (
                      <>
                        <br />
                        <span className="muted">{sub.contacts[0].phone}</span>
                      </>
                    )}
                  </td>
                  <td>
                    {sub.hasTin ? (
                      <span className="mono">{sub.tin}</span>
                    ) : (
                      <span className="danger-text">none</span>
                    )}
                  </td>
                  <td>
                    {sub.hasTin ? (
                      WHT_LABEL[sub.defaultWhtCategory]
                    ) : (
                      <span className="danger-text">{pct(WHT.NO_TIN_BPS)}% — no TIN</span>
                    )}
                  </td>
                  <td className="muted">{sub.trades.length === 0 ? '—' : sub.trades.join(', ')}</td>
                  <td className="muted">
                    {sub.bank.accountNo === '' ? '—' : `${sub.bank.name} ${sub.bank.accountNo}`}
                  </td>
                  <td>
                    <span className={`chip chip-status-${sub.status === 'active' ? 'good' : sub.status === 'suspended' ? 'warn' : 'bad'}`}>
                      {sub.status}
                    </span>
                  </td>
                  {editable && (
                    <td>
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(sub)}>Edit</button>
                        <DeleteButton
                          target={{ kind: 'subcontractor', id: sub.id, name: sub.name }}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SubcontractorForm({
  initial,
  uid,
  onDone,
}: {
  initial: WithId<Subcontractor> | null;
  uid: string;
  onDone: () => void;
}) {
  const { busy, error, run } = useAsyncAction('save the subcontractor');
  const [name, setName] = useState(initial?.name ?? '');
  const [tin, setTin] = useState(initial?.tin ?? '');
  const [vatRegistered, setVatRegistered] = useState(initial?.vatRegistered ?? false);
  const [vatRegNo, setVatRegNo] = useState(initial?.vatRegNo ?? '');
  const [category, setCategory] = useState<WhtCategory>(initial?.defaultWhtCategory ?? 'services');
  const [trades, setTrades] = useState((initial?.trades ?? []).join(', '));
  const [bankName, setBankName] = useState(initial?.bank.name ?? '');
  const [accountName, setAccountName] = useState(initial?.bank.accountName ?? '');
  const [accountNo, setAccountNo] = useState(initial?.bank.accountNo ?? '');
  const [contactName, setContactName] = useState(initial?.contacts[0]?.name ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contacts[0]?.phone ?? '');
  const [status, setStatus] = useState<Subcontractor['status']>(initial?.status ?? 'active');

  // The flag is derived rather than asked separately: two controls that can
  // disagree about whether somebody has a TIN is a bug waiting to be entered.
  const hasTin = tin.trim() !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      name: name.trim(),
      tin: tin.trim(),
      hasTin,
      vatRegistered,
      ...(vatRegNo.trim() === '' ? {} : { vatRegNo: vatRegNo.trim() }),
      defaultWhtCategory: category,
      trades: toList(trades),
      bank: { name: bankName.trim(), accountName: accountName.trim(), accountNo: accountNo.trim() },
      contacts:
        contactName.trim() === '' && contactPhone.trim() === ''
          ? []
          : [{ name: contactName.trim() || name.trim(), phone: contactPhone.trim() }],
      status,
    };
    const done = await run(async () => {
      if (initial === null) await createSubcontractor(input, uid);
      else await updateSubcontractor(initial.id, input, uid);
      return true;
    });
    if (done !== null) onDone();
  }

  return (
    <FormPanel title={initial === null ? 'New subcontractor' : `Edit ${initial.name}`} onClose={onDone}>
      <form onSubmit={(event) => void submit(event)}>
        {error !== null && <p className="error" role="alert">{error}</p>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="s-name">Name</label>
            <input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="s-tin">TIN</label>
            <input id="s-tin" value={tin} onChange={(e) => setTin(e.target.value)} inputMode="numeric" />
            <p className={hasTin ? 'field-hint' : 'field-hint danger-text'}>
              {hasTin
                ? `Withholding at ${category === 'goods' ? pct(WHT.GOODS_BPS) : category === 'services' ? pct(WHT.SERVICES_BPS) : '0'}%.`
                : `No TIN means withholding at ${pct(WHT.NO_TIN_BPS)}%, not ${pct(WHT.GOODS_BPS)}% or ${pct(WHT.SERVICES_BPS)}%.`}
            </p>
          </div>
          <div className="field">
            <label htmlFor="s-status">Status</label>
            <select
              id="s-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as Subcontractor['status'])}
            >
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="blacklisted">Blacklisted</option>
            </select>
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="s-wht">Usually supplies</label>
            <select
              id="s-wht"
              value={category}
              onChange={(e) => setCategory(e.target.value as WhtCategory)}
            >
              <option value="services">{WHT_LABEL.services}</option>
              <option value="goods">{WHT_LABEL.goods}</option>
              <option value="exempt">{WHT_LABEL.exempt}</option>
            </select>
            <p className="field-hint">
              The default on a new voucher. It can still be changed per payment.
            </p>
          </div>
          <div className="field">
            <label htmlFor="s-trades">Trades</label>
            <input
              id="s-trades"
              value={trades}
              onChange={(e) => setTrades(e.target.value)}
              placeholder="installation, steel structure work"
            />
            <p className="field-hint">Separate with commas.</p>
          </div>
        </div>

        <div className="field checkbox">
          <label>
            <input
              type="checkbox"
              checked={vatRegistered}
              onChange={(e) => setVatRegistered(e.target.checked)}
            />
            VAT registered — their invoices carry 15% we can reclaim
          </label>
        </div>

        {vatRegistered && (
          <div className="field">
            <label htmlFor="s-vatno">VAT registration number</label>
            <input id="s-vatno" value={vatRegNo} onChange={(e) => setVatRegNo(e.target.value)} />
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="s-bank">Bank</label>
            <input id="s-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-acname">Account name</label>
            <input id="s-acname" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-acno">Account number</label>
            <input id="s-acno" value={accountNo} onChange={(e) => setAccountNo(e.target.value)} />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="s-cname">Contact</label>
            <input id="s-cname" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="s-cphone">Contact phone</label>
            <input id="s-cphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || name.trim() === ''}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
