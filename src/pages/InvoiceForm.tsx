/**
 * Raise an invoice.
 *
 * WHY THIS EXISTS
 *   It did not. `createDraftInvoice` has been in the data layer since module 2
 *   and nothing in the app ever called it, so there was no way to bill a client
 *   — which also meant every figure downstream of an invoice (revenue, VAT
 *   output, receivables, the collections ladder, the whole dashboard) read zero
 *   on a system with a hundred and sixty real jobs in it.
 *
 * FROM A MILESTONE, OR FROM NOTHING
 *   Most invoices here settle a payment milestone that was agreed when the
 *   contract was signed. Picking the milestone fills the line in at the figure
 *   the contract says, so the invoice cannot quietly disagree with the contract
 *   it bills against. A free-form invoice is still allowed — call-outs, spares
 *   and variations are real — but it is the second option, not the first.
 *
 * IT CREATES A DRAFT, NOT AN INVOICE
 *   The number is claimed when you issue it, not here. A draft has no tax
 *   significance, and burning sequence numbers on abandoned drafts leaves gaps
 *   in the VAT sequence that nobody can explain to ERCA later.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeContracts, getMilestones } from '../data/contracts.js';
import { subscribeProjects } from '../data/projects.js';
import { createDraftInvoice } from '../data/invoices.js';
import { useCollection } from '../data/useCollection.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { MoneyInput } from '../components/MoneyInput.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { totalInvoice, type InvoiceLineInput } from '../lib/invoicing.js';
import { formatETB } from '../lib/money.js';
import type { Client, Contract, DualDate, PaymentMilestone, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

/** Standard Ethiopian VAT. A line may be zero-rated; the header rate may not. */
const VAT_STANDARD_BPS = 1500;

/** How long a client has to pay, unless the contract says otherwise. */
const DEFAULT_TERMS_DAYS = 30;

interface LineDraft {
  key: string;
  description: string;
  qty: string;
  unitNetSantim: number;
  vatable: boolean;
}

const emptyLine = (): LineDraft => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  qty: '1',
  unitNetSantim: 0,
  vatable: true,
});

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function InvoiceForm({ onDone }: { onDone: (invoiceId: string | null) => void }) {
  const { user } = useAuth();
  const uid = user?.uid ?? '';

  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');

  const [clientId, setClientId] = useState('');
  const [contractId, setContractId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [milestones, setMilestones] = useState<WithId<PaymentMilestone>[]>([]);
  const [milestoneError, setMilestoneError] = useState<string | null>(null);

  const today = useMemo(() => new Date(), []);
  const [issueDate, setIssueDate] = useState<DualDate | null>(
    () => dualDateFromGregorian(today, toTimestamp, 'GC'),
  );
  const [dueDate, setDueDate] = useState<DualDate | null>(
    () => dualDateFromGregorian(addDays(today, DEFAULT_TERMS_DAYS), toTimestamp, 'GC'),
  );

  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const client = clients.rows.find((c) => c.id === clientId) ?? null;

  // Only this client's contracts and projects are offerable. A picker listing
  // all 129 contracts invites billing the wrong one, and the client is the
  // thing the user knows first.
  const clientContracts = contracts.rows.filter((c) => c.clientId === clientId);
  const clientProjects = projects.rows.filter((p) => p.clientId === clientId);

  // --- milestones for the chosen contract ---------------------------------

  useEffect(() => {
    if (contractId === '') {
      setMilestones([]);
      setMilestoneId('');
      return;
    }
    let live = true;
    setMilestoneError(null);
    getMilestones(contractId)
      .then((rows) => {
        if (live) setMilestones(rows);
      })
      .catch((e: unknown) => {
        if (live) setMilestoneError(e instanceof Error ? e.message : 'Could not load the milestones.');
      });
    return () => {
      live = false;
    };
  }, [contractId]);

  /** Milestones still worth billing. One already invoiced must not be billed twice. */
  const billable = milestones.filter((m) => m.status === 'pending' || m.status === 'ready_to_invoice');

  function chooseMilestone(id: string) {
    setMilestoneId(id);
    const milestone = milestones.find((m) => m.id === id);
    if (milestone === undefined) return;
    // Fill the line at the figure the CONTRACT says, so the invoice cannot
    // quietly disagree with the agreement it bills against.
    setLines([
      {
        key: milestone.id,
        description: milestone.name,
        qty: '1',
        unitNetSantim: milestone.netSantim,
        vatable: milestone.vatSantim > 0,
      },
    ]);
  }

  // --- totals --------------------------------------------------------------

  const lineInputs: InvoiceLineInput[] = lines
    .map((line) => ({
      description: line.description.trim(),
      qty: Number(line.qty),
      unitNetSantim: line.unitNetSantim,
      vatRateBps: line.vatable ? VAT_STANDARD_BPS : 0,
    }))
    .filter((line) => line.description !== '' && Number.isFinite(line.qty) && line.qty > 0);

  const totals = totalInvoice(lineInputs);

  const problems: string[] = [];
  if (clientId === '') problems.push('Choose the client.');
  if (issueDate === null) problems.push('The issue date is not a valid date.');
  if (dueDate === null) problems.push('The due date is not a valid date.');
  if (lineInputs.length === 0) problems.push('Add at least one line with a description and a quantity.');
  if (totals.netSantim <= 0) problems.push('The invoice adds up to nothing — check the amounts.');
  if (issueDate !== null && dueDate !== null && dueDate.at.toDate() < issueDate.at.toDate()) {
    problems.push('The due date is before the issue date.');
  }

  async function submit() {
    if (problems.length > 0 || client === null || issueDate === null || dueDate === null) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createDraftInvoice(
        {
          clientId: client.id,
          clientName: client.name,
          clientTin: client.tin,
          contractId: contractId === '' ? null : contractId,
          projectId: projectId === '' ? null : projectId,
          milestoneId: milestoneId === '' ? null : milestoneId,
          issueDate,
          dueDate,
          lines: lineInputs,
        },
        uid,
      );
      onDone(id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save the draft.');
      setSaving(false);
    }
  }

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  return (
    <section className="card invoice-form">
      <h2>New invoice</h2>
      <p className="muted">
        This saves a <strong>draft</strong>. The invoice number is claimed when you issue it, so an
        abandoned draft never leaves a gap in the VAT sequence.
      </p>

      {error !== null && <p className="error" role="alert">{error}</p>}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="inv-client">Client <span className="req" aria-hidden="true">*</span></label>
          <select
            id="inv-client"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setContractId('');
              setProjectId('');
              setMilestoneId('');
            }}
          >
            <option value="">Choose a client…</option>
            {clients.rows.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="inv-contract">Contract <span className="muted">(optional)</span></label>
          <select
            id="inv-contract"
            value={contractId}
            onChange={(e) => {
              setContractId(e.target.value);
              setMilestoneId('');
            }}
            disabled={clientId === ''}
          >
            <option value="">Not against a contract</option>
            {clientContracts.map((c) => (
              <option key={c.id} value={c.id}>{c.contractNo} · {c.title}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="inv-project">Project <span className="muted">(optional)</span></label>
          <select
            id="inv-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={clientId === ''}
          >
            <option value="">Not against a project</option>
            {clientProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.projectNo} · {p.title}</option>
            ))}
          </select>
        </div>
      </div>

      {contractId !== '' && (
        <div className="milestone-pick">
          <h3>Bill a payment milestone</h3>
          {milestoneError !== null ? (
            <p className="error">{milestoneError}</p>
          ) : billable.length === 0 ? (
            <p className="muted">
              {milestones.length === 0
                ? 'This contract has no payment milestones recorded.'
                : 'Every milestone on this contract has been invoiced already.'}
            </p>
          ) : (
            <ul className="milestone-list">
              {billable.map((m) => (
                <li key={m.id} className={milestoneId === m.id ? 'is-chosen' : ''}>
                  <button type="button" onClick={() => chooseMilestone(m.id)}>
                    <span className="milestone-name">{m.name}</span>
                    <span className="muted">{(m.shareBps / 100).toFixed(0)}% of the contract</span>
                    <span className="milestone-figure">{formatETB(m.netSantim)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="form-grid">
        <DualDateInput label="Issue date" value={issueDate} onChange={setIssueDate} required />
        <DualDateInput
          label="Due date"
          value={dueDate}
          onChange={setDueDate}
          required
          hint={`${DEFAULT_TERMS_DAYS} days from issue unless the contract says otherwise`}
        />
      </div>

      <h3>Lines</h3>
      <div className="invoice-lines">
        {lines.map((line) => (
          <div key={line.key} className="invoice-line">
            <div className="field">
              <label htmlFor={`line-desc-${line.key}`}>Description</label>
              <input
                id={`line-desc-${line.key}`}
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                placeholder="What is being billed"
              />
            </div>
            <div className="field field-qty">
              <label htmlFor={`line-qty-${line.key}`}>Qty</label>
              <input
                id={`line-qty-${line.key}`}
                type="text"
                inputMode="decimal"
                value={line.qty}
                onChange={(e) => updateLine(line.key, { qty: e.target.value })}
              />
            </div>
            <MoneyInput
              label="Unit price (net)"
              value={line.unitNetSantim}
              onChange={(santim) => updateLine(line.key, { unitNetSantim: santim })}
            />
            <div className="field checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={line.vatable}
                  onChange={(e) => updateLine(line.key, { vatable: e.target.checked })}
                />
                VAT 15%
              </label>
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                className="line-remove"
                onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                aria-label={`Remove line: ${line.description || 'untitled'}`}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="card-links">
        <button type="button" onClick={() => setLines((c) => [...c, emptyLine()])}>
          Add another line
        </button>
      </p>

      <dl className="invoice-totals">
        <div><dt>Net</dt><dd>{formatETB(totals.netSantim)}</dd></div>
        <div><dt>VAT</dt><dd>{formatETB(totals.vatSantim)}</dd></div>
        <div className="is-total"><dt>Total</dt><dd>{formatETB(totals.grossSantim)}</dd></div>
      </dl>

      {problems.length > 0 && (
        /* What is missing, not a greyed-out button that explains nothing. */
        <ul className="form-problems">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <p className="form-actions">
        <button
          type="button"
          className="primary"
          disabled={problems.length > 0 || saving}
          onClick={() => void submit()}
        >
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" onClick={() => onDone(null)} disabled={saving}>Cancel</button>
      </p>
    </section>
  );
}
