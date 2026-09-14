/**
 * Contract editor.
 *
 * The VAT breakdown updates live as the user types, and switches between
 * exclusive and inclusive pricing without them re-deriving anything by hand —
 * "4,830,000 all in" and "4,200,000 plus VAT" are the same contract, and getting
 * that wrong is a 630,000 birr mistake.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { addVat, extractVat, formatETB, VAT_RATE_BPS } from '../lib/money.js';
import { DEFAULT_SUPPLY_INSTALL_SHARES, validateShares, type MilestoneShare } from '../lib/milestones.js';
import { renewalAlertAt } from '../lib/renewal.js';
import { formatDual } from '../lib/ethiopic.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { MoneyInput } from '../components/MoneyInput.js';
import { MilestoneEditor } from '../components/MilestoneEditor.js';
import { useAsyncAction } from '../data/useCollection.js';
import { createContract } from '../data/contracts.js';
import { FormPanel } from '../components/FormPanel.js';
import { ReminderEditor } from '../components/ReminderEditor.js';
import type { Client, Contract, ContractType, DualDate, Reminder } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function ContractForm({
  clients,
  uid,
  onDone,
}: {
  clients: readonly WithId<Client>[];
  uid: string;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [contractNo, setContractNo] = useState('');
  const [type, setType] = useState<ContractType>('supply_install');
  const [valueSantim, setValueSantim] = useState(0);
  const [inclusive, setInclusive] = useState(false);
  const [signedDate, setSignedDate] = useState<DualDate | null>(null);
  const [startDate, setStartDate] = useState<DualDate | null>(null);
  const [endDate, setEndDate] = useState<DualDate | null>(null);
  const [renewalWindowDays, setRenewalWindowDays] = useState(60);
  const [autoRenew, setAutoRenew] = useState(false);
  const [responseHours, setResponseHours] = useState(4);
  const [resolutionHours, setResolutionHours] = useState(24);
  const [visitsPerYear, setVisitsPerYear] = useState(12);
  const [shares, setShares] = useState<MilestoneShare[]>(DEFAULT_SUPPLY_INSTALL_SHARES);
  const [warrantyMonths, setWarrantyMonths] = useState(12);
  const [warrantyAlertDays, setWarrantyAlertDays] = useState(60);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const { busy, error, run } = useAsyncAction('create this contract');

  // The same derivation the repository uses on write, shown live.
  const breakdown = useMemo(
    () => (inclusive ? extractVat(valueSantim, VAT_RATE_BPS) : addVat(valueSantim, VAT_RATE_BPS)),
    [valueSantim, inclusive],
  );

  const isMaintenance = type === 'maintenance';
  const shareValidation = validateShares(shares);
  const client = clients.find((c) => c.id === clientId);

  const alertAt = useMemo(
    () => (endDate === null ? null : renewalAlertAt(endDate.at.toDate(), renewalWindowDays)),
    [endDate, renewalWindowDays],
  );

  const ready =
    clientId !== '' &&
    title.trim() !== '' &&
    valueSantim > 0 &&
    signedDate !== null &&
    startDate !== null &&
    endDate !== null &&
    shareValidation.ok;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || client === undefined) return;

    const result = await run(() =>
      createContract(
        {
          contractNo: contractNo.trim() || `C-${Date.now()}`,
          type,
          clientId,
          clientName: client.name,
          title: title.trim(),
          currency: 'ETB',
          valueNetSantim: valueSantim,
          vatRateBps: VAT_RATE_BPS,
          valueEnteredInclusive: inclusive,
          signedDate: signedDate as DualDate,
          startDate: startDate as DualDate,
          endDate: endDate as DualDate,
          autoRenew,
          renewalWindowDays,
          reminders,
          // The warranty clock starts at HANDOVER, which has not happened yet,
          // so the end date is left null rather than guessed from the contract
          // end. A warranty dated from the wrong day expires on the wrong day.
          ...(warrantyMonths > 0
            ? { warranty: { months: warrantyMonths, startsOn: null, endsOn: null, alertDays: warrantyAlertDays } }
            : {}),
          renewalStatus: 'not_due',
          ...(isMaintenance
            ? {
                sla: {
                  responseHours,
                  resolutionHours,
                  preventiveVisitsPerYear: visitsPerYear,
                  metrics: {
                    callouts: 0,
                    breaches: 0,
                    avgResponseHours: 0,
                    visitsCompletedThisYear: 0,
                    lastComputedAt: signedDate.at,
                  },
                },
              }
            : {}),
          status: 'draft',
          attachments: [],
        },
        shares,
        uid,
      ),
    );
    if (result !== null) onDone();
  }

  return (
    <FormPanel
      title="New contract"
      description="The contract carries the value, the VAT and the payment milestones. Those milestones are what the whole cash forecast is built from."
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-client">Client <span className="req" aria-hidden="true">*</span></label>
            <select id="k-client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {clients.length === 0 && <p className="hint">Add a client first.</p>}
          </div>

          <div className="field">
            <label htmlFor="k-no">Contract number</label>
            <input id="k-no" value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="Auto" />
          </div>

          <div className="field form-wide">
            <label htmlFor="k-title">Title <span className="req" aria-hidden="true">*</span></label>
            <input
              id="k-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Supply and installation of 3 passenger lifts"
            />
          </div>

          <div className="field">
            <label htmlFor="k-type">Type</label>
            <select id="k-type" value={type} onChange={(e) => setType(e.target.value as ContractType)}>
              <option value="supply_install">Supply &amp; install</option>
              <option value="maintenance">Maintenance</option>
              <option value="modernization">Modernisation</option>
              <option value="other">Other</option>
            </select>
          </div>

          <MoneyInput
            label={inclusive ? 'Contract value (VAT inclusive)' : 'Contract value (excluding VAT)'}
            value={valueSantim}
            onChange={setValueSantim}
            required
          />

          <div className="field checkbox">
            <label>
              <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
              Value agreed VAT-inclusive
            </label>
            <p className="hint">Tick when the client negotiated an all-in figure.</p>
          </div>
        </div>

        {valueSantim > 0 && (
          <div className="vat-summary">
            <div><span className="muted">Net</span><strong>{formatETB(breakdown.netSantim)}</strong></div>
            <div><span className="muted">VAT @ 15%</span><strong>{formatETB(breakdown.vatSantim)}</strong></div>
            <div className="total"><span className="muted">Client pays</span><strong>{formatETB(breakdown.grossSantim)}</strong></div>
          </div>
        )}

        <div className="form-grid dates">
          <DualDateInput label="Signed" value={signedDate} onChange={setSignedDate} required />
          <DualDateInput label="Start" value={startDate} onChange={setStartDate} required />
          <DualDateInput label="End" value={endDate} onChange={setEndDate} required />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-window">Renewal alert window (days)</label>
            <input
              id="k-window"
              type="number"
              min={0}
              value={renewalWindowDays}
              onChange={(e) => setRenewalWindowDays(Math.max(0, Number(e.target.value) || 0))}
            />
            {alertAt !== null && (
              <p className="hint">Alert starts {formatDual(alertAt)}</p>
            )}
          </div>

          <div className="field checkbox">
            <label>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              Auto-renews
            </label>
          </div>

          <div className="field">
            <label htmlFor="k-warranty">Warranty / defects liability (months)</label>
            <input
              id="k-warranty"
              type="number"
              min={0}
              max={120}
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
            />
            <p className="hint">
              Runs from handover, not from signing, so the clock starts when the project actually
              hands over. Zero if there is no warranty.
            </p>
          </div>

          <div className="field">
            <label htmlFor="k-warranty-alert">Warn before warranty ends (days)</label>
            <input
              id="k-warranty-alert"
              type="number"
              min={0}
              max={365}
              value={warrantyAlertDays}
              disabled={warrantyMonths === 0}
              onChange={(e) => setWarrantyAlertDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
            />
            <p className="hint">
              Long enough to inspect every unit and raise a claim while defects are still ours to fix
              for free.
            </p>
          </div>
        </div>

        {isMaintenance && (
          <fieldset className="sla-fields">
            <legend>Service level</legend>
            <p className="hint">
              Snapshotted onto every callout logged under this contract, so a later
              renegotiation cannot rewrite whether a past callout breached.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="k-response">Response (hours)</label>
                <input id="k-response" type="number" min={0} step={0.5} value={responseHours}
                  onChange={(e) => setResponseHours(Number(e.target.value) || 0)} />
              </div>
              <div className="field">
                <label htmlFor="k-resolution">Resolution (hours)</label>
                <input id="k-resolution" type="number" min={0} step={0.5} value={resolutionHours}
                  onChange={(e) => setResolutionHours(Number(e.target.value) || 0)} />
              </div>
              <div className="field">
                <label htmlFor="k-visits">Preventive visits per year</label>
                <input id="k-visits" type="number" min={0} value={visitsPerYear}
                  onChange={(e) => setVisitsPerYear(Number(e.target.value) || 0)} />
              </div>
            </div>
          </fieldset>
        )}

        <MilestoneEditor shares={shares} onChange={setShares} contract={breakdown} />

        <ReminderEditor
          reminders={reminders}
          onChange={setReminders}
          sourceLabel={contractNo.trim() === '' ? 'This contract' : contractNo.trim()}
        />

        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Create contract'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
        {!ready && !busy && (
          <p className="hint">
            {shareValidation.ok
              ? 'Complete the client, title, value and all three dates.'
              : 'Payment schedule must total 100%.'}
          </p>
        )}
      </form>
    </FormPanel>
  );
}

export type { Contract };
