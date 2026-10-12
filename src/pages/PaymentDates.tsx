/**
 * Payment dates: every unbilled term that has no date, across all contracts.
 *
 * WHY A PAGE OF ITS OWN
 *   A date is what makes a payment term visible to the ready-to-invoice nudge and
 *   the cash forecast. An imported book has hundreds of terms with none, spread
 *   over a hundred contracts, and dating them from each contract page in turn is
 *   a day's work. Here they are in one list: tick the ones that share a date, or
 *   a pattern, and date them together.
 *
 * WHAT IT LEAVES OUT
 *   Terms already billed (an invoice points at them), settled, or on a contract
 *   that is not being billed. And, unless asked, terms already tied to a stage —
 *   those are released by their stage and need no date to be seen.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeInvoices } from '../data/invoices.js';
import { usePortfolioDetail } from '../data/portfolio.js';
import { subscribeProjects } from '../data/projects.js';
import { useCollection } from '../data/useCollection.js';
import { useAuth } from '../auth/AuthProvider.js';
import { BulkDateForm } from '../components/BulkDateForm.js';
import { KpiTile } from '../components/KpiTile.js';
import { formatETB } from '../lib/money.js';
import type { BulkTerm } from '../lib/term-bulk.js';
import type { Contract, Invoice, Project } from '../lib/schema.js';

// Contracts that can be billed: not a draft, not stopped.
const BILLED_CONTRACT = new Set(['active', 'completed', 'expired']);

export function PaymentDates() {
  const { user } = useAuth();
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const invoices = useCollection<Invoice>((d, e) => subscribeInvoices(d, e), [], 'load invoices');
  const detail = usePortfolioDetail(projects.rows, contracts.rows, invoices.rows);

  const [filter, setFilter] = useState('');
  const [includeStaged, setIncludeStaged] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [dating, setDating] = useState(false);

  const contractById = useMemo(() => new Map(contracts.rows.map((c) => [c.id, c])), [contracts.rows]);

  // Every undated, unbilled term — before the search box narrows it.
  const undated = useMemo(() => {
    const billed = new Set(
      invoices.rows.filter((i) => i.status !== 'void' && i.milestoneId !== null).map((i) => i.milestoneId as string),
    );
    return detail.milestones
      .filter((m) => {
        const contract = contractById.get(m.contractId);
        return (
          contract !== undefined &&
          BILLED_CONTRACT.has(contract.status) &&
          (m.status === 'pending' || m.status === 'ready_to_invoice') &&
          m.dueDate === null &&
          (includeStaged || m.phaseId === undefined) &&
          !billed.has(m.id)
        );
      })
      .sort((a, b) => {
        const ca = contractById.get(a.contractId)?.contractNo ?? '';
        const cb = contractById.get(b.contractId)?.contractNo ?? '';
        return ca.localeCompare(cb, undefined, { numeric: true }) || a.seq - b.seq;
      });
  }, [detail.milestones, invoices.rows, contractById, includeStaged]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return undated;
    return undated.filter((m) => {
      const c = contractById.get(m.contractId);
      return `${c?.contractNo ?? ''} ${c?.title ?? ''} ${c?.clientName ?? ''} ${m.name}`.toLowerCase().includes(needle);
    });
  }, [undated, filter, contractById]);

  const pickedTerms = useMemo(
    () =>
      undated
        .filter((m) => picked.has(m.id))
        .map((m): BulkTerm => ({
          contractId: m.contractId, termId: m.id, seq: m.seq, name: m.name, status: m.status, grossSantim: m.grossSantim, dueDate: null,
        })),
    [undated, picked],
  );
  const labels = useMemo(
    () => new Map(undated.map((m) => [m.id, `${contractById.get(m.contractId)?.contractNo ?? '?'} · ${m.name}`])),
    [undated, contractById],
  );

  const error = contracts.error ?? projects.error ?? invoices.error ?? detail.error;
  if (error !== null) return <p className="error" role="alert">{error}</p>;
  if (contracts.loading || projects.loading || invoices.loading) return <p className="muted">Loading…</p>;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickedSantim = pickedTerms.reduce((a, t) => a + t.grossSantim, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payment dates</h1>
          <p className="muted">
            Unbilled payment terms with no date. A term is only flagged as ready to invoice, or counted in a
            month of the cash forecast, once it has a date or a stage — so these are invisible to both until
            they are dated.
          </p>
        </div>
      </div>

      <section className="kpis">
        <KpiTile
          label="Terms with no date"
          value={detail.loading ? '…' : String(undated.length)}
          detail={<span className="muted">across {new Set(undated.map((m) => m.contractId)).size} contracts</span>}
        />
        <KpiTile
          label="Worth"
          value={formatETB(undated.reduce((a, m) => a + m.grossSantim, 0))}
          detail={<span className="muted">with VAT, not yet billed</span>}
        />
        <KpiTile label="Selected" value={String(picked.size)} detail={<span className="muted">{formatETB(pickedSantim)}</span>} />
      </section>

      {dating && user !== null && (
        <BulkDateForm
          terms={pickedTerms}
          labels={labels}
          uid={user.uid}
          onDone={(saved) => {
            setDating(false);
            if (saved) {
              setPicked(new Set());
              detail.reload();
            }
          }}
        />
      )}

      <section className="card">
        <div className="form-actions no-print">
          <input
            type="search"
            aria-label="Search the terms"
            placeholder="Search contract, client or term…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <label className="check">
            <input type="checkbox" checked={includeStaged} onChange={(e) => setIncludeStaged(e.target.checked)} /> Also show terms already tied to a stage
          </label>
        </div>
        <div className="form-actions no-print">
          <button type="button" onClick={() => setPicked((c) => new Set([...c, ...shown.map((m) => m.id)]))} disabled={shown.length === 0}>
            Select all {shown.length} shown
          </button>
          {picked.size > 0 && (
            <>
              <button type="button" className="primary" onClick={() => setDating(true)}>Date {picked.size} selected</button>
              <button type="button" onClick={() => setPicked(new Set())}>Clear</button>
            </>
          )}
        </div>

        {detail.loading ? (
          <p className="muted">Reading the payment terms…</p>
        ) : shown.length === 0 ? (
          <p className="muted">
            {undated.length === 0
              ? 'Every unbilled payment term has a date, or is released by a stage.'
              : 'No term matches that search.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table className="milestone-table">
              <thead>
                <tr>
                  <th scope="col"><span className="visually-hidden">Select</span></th>
                  <th scope="col">Contract</th>
                  <th scope="col">Term</th>
                  <th scope="col">With VAT</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => {
                  const c = contractById.get(m.contractId);
                  return (
                    <tr key={m.id}>
                      <td data-label="Select">
                        <input type="checkbox" aria-label={`Select ${c?.contractNo ?? ''} ${m.name}`} checked={picked.has(m.id)} onChange={() => toggle(m.id)} />
                      </td>
                      <td data-label="Contract" data-primary>
                        <Link to={`/contracts/${m.contractId}`}><strong>{c?.contractNo ?? m.contractId}</strong></Link>
                        <br />
                        <span className="muted">{c?.clientName}</span>
                      </td>
                      <td data-label="Term">{m.name}{m.phaseId !== undefined && <span className="muted"> · tied to a stage</span>}</td>
                      <td data-label="With VAT" className="num">{formatETB(m.grossSantim, { withSymbol: false })}</td>
                      <td data-label="Status">{m.status.replace(/_/g, ' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
