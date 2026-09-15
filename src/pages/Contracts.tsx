/**
 * Contract list, with the renewal board.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { setRenewalStatus, subscribeContracts, updateContractStatus } from '../data/contracts.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatETB } from '../lib/money.js';
import { renewalView, sortByUrgency, type RenewalStatus } from '../lib/renewal.js';
import { DualDateText } from '../components/DualDateInput.js';
import { ContractForm } from './ContractForm.js';
import type { Client, Contract } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { StatusChip, StatusSelect } from '../components/StatusSelect.js';
import { DataTable } from '../components/DataTable.js';
import { statusLabel } from '../lib/status.js';

export function Contracts() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageContracts');
  const [editing, setEditing] = useState<WithId<Contract> | 'new' | null>(null);

  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e, { activeOnly: true }), [], 'load clients');

  return (
    <>
      <div className="page-head">
        <h1>Contracts</h1>
      {/* print-only */}
      <PrintHeader title="Contracts" subtitle="contracts" />
        <PrintButton label="Print list" />
        {editable && editing === null && (
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            New contract
          </button>
        )}
      </div>

      {contracts.error && <p className="error" role="alert">{contracts.error}</p>}

      {editing !== null && user !== null && (
        <ContractForm
          initial={editing === 'new' ? null : editing}
          clients={clients.rows}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      <RenewalBoard contracts={contracts.rows} editable={editable} uid={user?.uid ?? null} />

      <h2 className="section-heading">All contracts</h2>
      {contracts.loading && <p className="muted">Loading…</p>}
      {!contracts.loading && contracts.rows.length === 0 && !contracts.error && (
        <p className="muted">No contracts yet.</p>
      )}

      {contracts.rows.length > 0 && (
        <DataTable
          rows={contracts.rows}
          rowKey={(k) => k.id}
          noun="contracts"
          columns={[
            {
              key: 'contract',
              label: 'Contract',
              value: (k) => k.title,
              text: (k) => `${k.title} ${k.contractNo}`,
              render: (k) => (
                <>
                  <strong>{k.title}</strong>
                  <br />
                  <span className="muted mono">{k.contractNo}</span>
                </>
              ),
            },
            { key: 'client', label: 'Client', value: (k) => k.clientName, filterable: true },
            {
              key: 'type',
              label: 'Type',
              value: (k) => k.type.replace(/_/g, ' '),
              filterable: true,
            },
            {
              key: 'net',
              label: 'Net',
              numeric: true,
              value: (k) => k.valueNetSantim,
              render: (k) => formatETB(k.valueNetSantim, { withSymbol: false }),
            },
            {
              key: 'vat',
              label: 'VAT',
              numeric: true,
              value: (k) => k.vatSantim,
              render: (k) => <span className="muted">{formatETB(k.vatSantim, { withSymbol: false })}</span>,
            },
            {
              key: 'total',
              label: 'Total',
              numeric: true,
              value: (k) => k.valueGrossSantim,
              render: (k) => <span className="strong">{formatETB(k.valueGrossSantim, { withSymbol: false })}</span>,
            },
            {
              key: 'ends',
              label: 'Ends',
              value: (k) => k.endDate.at.toDate(),
              render: (k) => <DualDateText value={k.endDate} />,
            },
            {
              key: 'status',
              label: 'Status',
              value: (k) => k.status,
              filterable: true,
              text: (k) => statusLabel('contract', k.status),
              render: (k) =>
                editable && user !== null ? (
                  <StatusSelect
                    kind="contract"
                    id={`k-status-${k.id}`}
                    value={k.status}
                    onChange={(value) => {
                      void updateContractStatus(k.id, value as Contract['status'], user.uid);
                    }}
                  />
                ) : (
                  <StatusChip kind="contract" value={k.status} />
                ),
            },
            ...(editable
              ? [
                  {
                    key: 'actions',
                    label: 'Actions',
                    unsortable: true,
                    value: () => '',
                    render: (k: WithId<Contract>) => (
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(k)}>Edit</button>
                        <DeleteButton
                          target={{ kind: 'contract', id: k.id, name: k.contractNo, status: k.status }}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

/**
 * Renewal board.
 *
 * Only maintenance-style contracts with an end date are worth chasing, and a
 * contract someone has already picked up drops out of the urgent buckets rather
 * than nagging the team who are already dealing with it.
 */
function RenewalBoard({
  contracts,
  editable,
  uid,
}: {
  contracts: readonly WithId<Contract>[];
  editable: boolean;
  uid: string | null;
}) {
  const asOf = new Date();
  const { busy, error, run } = useAsyncAction('update this renewal');

  const rows = sortByUrgency(
    contracts
      .filter((k) => k.status === 'active' || k.status === 'expired')
      .map((k) => ({
        contract: k,
        renewal: renewalView(
          {
            endDate: k.endDate.at.toDate(),
            renewalWindowDays: k.renewalWindowDays,
            storedStatus: k.renewalStatus,
            contractStatus: k.status,
          },
          asOf,
        ),
      }))
      .filter((r) => r.renewal.bucket !== 'later'),
  );

  if (rows.length === 0) {
    return (
      <div className="banner banner-ok" role="status">
        No contracts are approaching renewal in the next 90 days.
      </div>
    );
  }

  const urgent = rows.filter((r) => r.renewal.urgency === 'critical' || r.renewal.urgency === 'high');

  return (
    <section className="card">
      <h2>Renewals</h2>
      {urgent.length > 0 ? (
        <p className="muted">
          <strong>{urgent.length}</strong> contract{urgent.length === 1 ? '' : 's'} need attention —
          lapsed or expiring within 30 days.
        </p>
      ) : (
        <p className="muted">Nothing urgent; these are approaching their window.</p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Contract</th>
              <th scope="col">Client</th>
              <th scope="col">Ends</th>
              <th scope="col" className="num">Days</th>
              <th scope="col" className="num">Value</th>
              <th scope="col">Renewal</th>
              {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ contract, renewal }) => (
              <tr key={contract.id} className={renewal.urgency === 'critical' ? 'row-danger' : undefined}>
                <td><strong>{contract.title}</strong></td>
                <td>{contract.clientName}</td>
                <td><DualDateText value={contract.endDate} /></td>
                <td className="num">
                  {renewal.daysUntilExpiry < 0 ? (
                    <span className="danger-text">{Math.abs(renewal.daysUntilExpiry)} overdue</span>
                  ) : (
                    renewal.daysUntilExpiry
                  )}
                </td>
                <td className="num">{formatETB(contract.valueGrossSantim, { withSymbol: false })}</td>
                <td><span className={`risk-badge risk-${renewal.urgency}`}>{renewal.status.replace(/_/g, ' ')}</span></td>
                {editable && (
                  <td>
                    <select
                      aria-label={`Renewal status for ${contract.title}`}
                      value={renewal.status}
                      disabled={busy || uid === null}
                      onChange={(e) => {
                        if (uid === null) return;
                        void run(() => setRenewalStatus(contract.id, e.target.value as RenewalStatus, uid));
                      }}
                    >
                      <option value="not_due">Not due</option>
                      <option value="due">Due</option>
                      <option value="in_negotiation">In negotiation</option>
                      <option value="renewed">Renewed</option>
                      <option value="lapsed">Lapsed</option>
                    </select>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
