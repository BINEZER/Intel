/**
 * One contract: what sits under it, then the contract's own terms.
 *
 * The lists come first — its projects, its lifts, its invoices — because that is
 * what somebody opening a contract is trying to see, and what they most often
 * need to correct or remove. The figures, dates and payment schedule follow.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeContracts, subscribeMilestones } from '../data/contracts.js';
import { subscribeInvoicesForContract } from '../data/invoices.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { useCollection } from '../data/useCollection.js';
import type { WithId } from '../data/repository.js';
import type { Client, Contract, ElevatorUnit, Invoice, PaymentMilestone, Project } from '../lib/schema.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { DualDateText } from '../components/DualDateInput.js';
import { RelatedList, type RelatedItem } from '../components/RelatedList.js';
import { ServiceConversionForm } from '../components/ServiceConversionForm.js';
import { StatusChip } from '../components/StatusSelect.js';
import { describeMake } from '../lib/lift-spec.js';
import { formatETB } from '../lib/money.js';
import { projectTypeShort } from '../lib/project-kind.js';
import { describeFee, wholeMonthsBetween } from '../lib/service-agreement.js';
import { ContractForm } from './ContractForm.js';
import { canConvert } from './Contracts.js';
import { ProjectForm } from './Projects.js';
import { UnitForm } from './Units.js';

type Editing =
  | { kind: 'contract' }
  | { kind: 'convert' }
  | { kind: 'project'; row: WithId<Project> }
  | { kind: 'unit'; row: WithId<ElevatorUnit> };

export function ContractDetail() {
  const { contractId = '' } = useParams<{ contractId: string }>();
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing | null>(null);

  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  const invoices = useCollection<Invoice>(
    (d, e) => subscribeInvoicesForContract(contractId, d, e),
    [contractId],
    'load invoices',
  );
  const terms = useCollection<PaymentMilestone>(
    (d, e) => subscribeMilestones(contractId, d, e),
    [contractId],
    'load payment terms',
  );

  const contract = contracts.rows.find((k) => k.id === contractId) ?? null;
  const editableContract = can(role, 'manageContracts');
  const editableProjects = can(role, 'manageProjects');

  // The lifts a contract has to do with: the ones its projects installed, and
  // the ones it services. For an installation contract that is the first set; for
  // a maintenance agreement, the second; a hand-over contract can have both.
  const myProjects = useMemo(() => projects.rows.filter((p) => p.contractId === contractId), [projects.rows, contractId]);
  const myUnits = useMemo(() => {
    const installed = new Set(myProjects.map((p) => p.id));
    return units.rows.filter(
      (u) =>
        (u.installedByProjectId !== null && installed.has(u.installedByProjectId)) ||
        u.maintenanceContractId === contractId,
    );
  }, [units.rows, myProjects, contractId]);

  // Close an open form when the contract it was opened for disappears (deleted).
  useEffect(() => {
    if (!contracts.loading && contract === null) setEditing(null);
  }, [contracts.loading, contract]);

  if (contracts.loading) return <p className="muted">Loading contract…</p>;
  if (contract === null) {
    return (
      <>
        <p className="error" role="alert">That contract does not exist. It may have been deleted or archived.</p>
        <Link to="/contracts">Back to contracts</Link>
      </>
    );
  }

  const followedBy =
    contract.succeededByContractId == null
      ? null
      : (contracts.rows.find((k) => k.id === contract.succeededByContractId) ?? null);
  const follows =
    contract.supersedesContractId === undefined
      ? null
      : (contracts.rows.find((k) => k.id === contract.supersedesContractId) ?? null);

  const projectItems: RelatedItem[] = myProjects.map((p) => ({
    key: p.id,
    to: `/projects/${p.id}`,
    title: p.title,
    detail: `${p.projectNo} · ${p.site?.name ?? '—'} · ${projectTypeShort(p.type)}`,
    meta: <StatusChip kind="project" value={p.status} />,
    ...(editableProjects ? { onEdit: () => setEditing({ kind: 'project', row: p }) } : {}),
    ...(editableProjects ? { deleteTarget: { kind: 'project' as const, id: p.id, name: p.projectNo } } : {}),
  }));

  const installedIds = new Set(myProjects.map((p) => p.id));
  const liftItems: RelatedItem[] = myUnits.map((u) => {
    const installed = u.installedByProjectId !== null && installedIds.has(u.installedByProjectId);
    const serviced = u.maintenanceContractId === contractId;
    return {
      key: u.id,
      to: `/units/${u.id}`,
      title: `${u.tag} · ${u.siteName}`,
      detail: `${u.unitCode}${describeMake(u) === null ? '' : ` · ${describeMake(u)}`} · ${
        installed && serviced ? 'installed and serviced under this contract' : installed ? 'installed under this contract' : 'serviced under this contract'
      }`,
      meta: <span className="chip no-caps">{u.status.replace(/_/g, ' ')}</span>,
      ...(editableProjects ? { onEdit: () => setEditing({ kind: 'unit', row: u }) } : {}),
      ...(editableProjects
        ? { deleteTarget: { kind: 'unit' as const, id: u.id, name: u.tag, unit: { tag: u.tag, clientId: u.clientId } } }
        : {}),
    };
  });

  const invoiceItems: RelatedItem[] = [...invoices.rows]
    .sort((a, b) => b.issueDate.at.toMillis() - a.issueDate.at.toMillis())
    .map((i) => ({
      key: i.id,
      to: '/finance/invoices',
      title: i.invoiceNo === '' ? 'Draft invoice' : i.invoiceNo,
      detail: (
        <>
          {formatETB(i.grossSantim)} with VAT · issued <DualDateText value={i.issueDate} />
        </>
      ),
      meta: <span className="chip no-caps">{i.status.replace(/_/g, ' ')}</span>,
      ...(can(role, 'manageInvoices')
        ? { deleteTarget: { kind: 'invoice' as const, id: i.id, name: i.invoiceNo === '' ? 'this draft' : i.invoiceNo, status: i.status } }
        : {}),
    }));

  const months = wholeMonthsBetween(contract.startDate.at.toDate(), contract.endDate.at.toDate());
  const fee = describeFee(contract.serviceFee, months);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/contracts">Contracts</Link></p>
          <h1>{contract.title}</h1>
          <p className="muted">
            <span className="mono">{contract.contractNo}</span> ·{' '}
            <Link to={`/clients/${contract.clientId}`}>{contract.clientName}</Link> · {contract.type.replace(/_/g, ' ')}
          </p>
          {followedBy !== null && (
            <p className="muted">Followed by <Link to={`/contracts/${followedBy.id}`}>{followedBy.contractNo}</Link>.</p>
          )}
          {follows !== null && (
            <p className="muted">Follows <Link to={`/contracts/${follows.id}`}>{follows.contractNo}</Link>.</p>
          )}
        </div>
        <div className="chip-row">
          <StatusChip kind="contract" value={contract.status} />
          {editableContract && user !== null && (
            <>
              <button type="button" onClick={() => setEditing({ kind: 'contract' })}>Edit contract</button>
              {canConvert(contract) && (
                <button type="button" onClick={() => setEditing({ kind: 'convert' })}>To maintenance</button>
              )}
              <DeleteButton
                target={{ kind: 'contract', id: contract.id, name: contract.contractNo, status: contract.status }}
                onDeleted={() => navigate('/contracts')}
              />
            </>
          )}
        </div>
      </div>

      {editing !== null && user !== null && (
        <>
          {editing.kind === 'contract' && (
            <ContractForm initial={contract} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />
          )}
          {editing.kind === 'convert' && (
            <ServiceConversionForm contract={contract} uid={user.uid} onDone={() => setEditing(null)} />
          )}
          {editing.kind === 'project' && (
            <ProjectForm initial={editing.row} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />
          )}
          {editing.kind === 'unit' && <UnitForm initial={editing.row} uid={user.uid} onDone={() => setEditing(null)} />}
        </>
      )}

      <RelatedList title="Projects" items={projectItems} loading={projects.loading} empty="No project is under this contract." />
      <RelatedList
        title="Lifts"
        items={liftItems}
        loading={units.loading}
        empty="No lift is installed or serviced under this contract."
      />
      <RelatedList title="Invoices" items={invoiceItems} loading={invoices.loading} empty="No invoice has been raised against this contract." />

      <section className="card">
        <h2>Contract</h2>
        <dl className="detail-grid">
          <div><dt>Value before VAT</dt><dd>{formatETB(contract.valueNetSantim)}</dd></div>
          <div><dt>VAT</dt><dd>{formatETB(contract.vatSantim)}</dd></div>
          <div><dt>Client pays</dt><dd>{formatETB(contract.valueGrossSantim)}</dd></div>
          {fee !== null && <div><dt>Maintenance fee</dt><dd>{fee}</dd></div>}
          <div><dt>Signed</dt><dd><DualDateText value={contract.signedDate} /></dd></div>
          <div><dt>Starts</dt><dd><DualDateText value={contract.startDate} /></dd></div>
          <div><dt>Ends</dt><dd><DualDateText value={contract.endDate} /></dd></div>
          <div>
            <dt>Renewal</dt>
            <dd>
              {contract.renewalStatus.replace(/_/g, ' ')} · alert {contract.renewalWindowDays} days before
              {contract.autoRenew ? ' · auto-renews' : ''}
            </dd>
          </div>
          {contract.warranty !== undefined && (
            <div>
              <dt>Warranty</dt>
              <dd>
                {contract.warranty.months} months
                {contract.warranty.endsOn === null ? ' · not started' : <> · ends <DualDateText value={contract.warranty.endsOn} /></>}
              </dd>
            </div>
          )}
          {contract.serviceDeclined === true && <div><dt>Service</dt><dd>Client declined</dd></div>}
        </dl>
      </section>

      <section className="card">
        <h2>Payment schedule</h2>
        {terms.loading ? (
          <p className="muted">Loading…</p>
        ) : terms.rows.length === 0 ? (
          <p className="muted">No payment terms.</p>
        ) : (
          <div className="table-scroll">
            <table className="milestone-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Term</th>
                  <th scope="col">Due</th>
                  <th scope="col">With VAT</th>
                  <th scope="col">Received</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {terms.rows.map((t) => (
                  <tr key={t.id}>
                    <td data-label="#">{t.seq}</td>
                    <td data-label="Term">{t.name}</td>
                    <td data-label="Due">{t.dueDate === null ? <span className="muted">—</span> : <DualDateText value={t.dueDate} />}</td>
                    <td data-label="With VAT" className="num">{formatETB(t.grossSantim, { withSymbol: false })}</td>
                    <td data-label="Received" className="num">
                      {formatETB(t.status === 'paid' ? t.grossSantim : (t.receivedGrossSantim ?? 0), { withSymbol: false })}
                    </td>
                    <td data-label="Status">{t.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
