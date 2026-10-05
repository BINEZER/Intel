/**
 * Contract list, with the renewal board.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { getMilestones, setRenewalStatus, subscribeContracts, updateContractStatus } from '../data/contracts.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { formatETB } from '../lib/money.js';
import { describeTermStatus } from '../lib/payment-backfill.js';
import { renewalView, sortByUrgency, type RenewalStatus } from '../lib/renewal.js';
import { DualDateText } from '../components/DualDateInput.js';
import { ContractForm } from './ContractForm.js';
import type { Client, Contract, PaymentMilestone } from '../lib/schema.js';
import { describeFirestoreError, type WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { directSupplyOf, formatUSD } from '../lib/direct-supply.js';
import { StatusChip, StatusSelect } from '../components/StatusSelect.js';
import { DataTable } from '../components/DataTable.js';
import { statusLabel } from '../lib/status.js';
import { Link } from 'react-router-dom';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { contractScope, describeScope, type ScopeProject, type ScopeUnit } from '../lib/scope.js';
import { formatBps } from '../lib/kpi.js';
import { describeFee, wholeMonthsBetween } from '../lib/service-agreement.js';
import { ServiceConversionForm } from '../components/ServiceConversionForm.js';
import type { ElevatorUnit, Project } from '../lib/schema.js';

/**
 * Can this contract hand over to a maintenance agreement?
 *
 * Installation and modernisation work ends and is followed by service; a
 * maintenance contract is renewed rather than converted. One that has already
 * been followed, or that never got going or was ended badly, is not offered.
 */
function canConvert(contract: Contract): boolean {
  return (
    (contract.type === 'supply_install' || contract.type === 'modernization') &&
    contract.succeededByContractId == null &&
    contract.serviceDeclined !== true &&
    contract.status !== 'draft' &&
    contract.status !== 'terminated'
  );
}

export function Contracts() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageContracts');
  const [editing, setEditing] = useState<WithId<Contract> | 'new' | null>(null);
  const [converting, setConverting] = useState<WithId<Contract> | null>(null);

  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e, { activeOnly: true }), [], 'load clients');
  // What each contract actually covers lives on the projects and the lifts, not
  // on the contract — see lib/scope.ts for why the link runs that way.
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');

  const scopeProjects = useMemo<ScopeProject[]>(
    () =>
      projects.rows.map((p) => ({
        id: p.id,
        projectNo: p.projectNo,
        title: p.title,
        contractId: p.contractId,
        clientId: p.clientId,
        siteName: p.site?.name ?? '',
        status: p.status,
        progressBps: p.progressBps,
        contractNetSantim: p.financials?.contractNetSantim ?? null,
      })),
    [projects.rows],
  );

  const scopeUnits = useMemo<ScopeUnit[]>(
    () =>
      units.rows.map((u) => ({
        id: u.id,
        unitCode: u.unitCode,
        tag: u.tag,
        siteName: u.siteName,
        installedByProjectId: u.installedByProjectId,
        maintenanceContractId: u.maintenanceContractId,
        status: u.status,
      })),
    [units.rows],
  );

  const scopeOf = useMemo(() => {
    const byContract = new Map<string, ReturnType<typeof contractScope>>();
    for (const contract of contracts.rows) {
      byContract.set(contract.id, contractScope(
        {
          id: contract.id,
          contractNo: contract.contractNo,
          clientId: contract.clientId,
          valueNetSantim: contract.valueNetSantim,
          status: contract.status,
        },
        scopeProjects,
        scopeUnits,
      ));
    }
    return byContract;
  }, [contracts.rows, scopeProjects, scopeUnits]);

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

      {converting !== null && user !== null && (
        <ServiceConversionForm contract={converting} uid={user.uid} onDone={() => setConverting(null)} />
      )}

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
                  {k.type === 'maintenance' && k.serviceFee !== undefined && (
                    <>
                      <br />
                      <span className="chip no-caps" title="The monthly fee the client agreed, before VAT">
                        {describeFee(
                          k.serviceFee,
                          wholeMonthsBetween(k.startDate.at.toDate(), k.endDate.at.toDate()),
                        )}
                      </span>
                    </>
                  )}
                  {k.succeededByContractId != null && (
                    <>
                      <br />
                      <Link className="muted" to={`/contracts?contract=${k.succeededByContractId}`}>
                        now on a maintenance agreement →
                      </Link>
                    </>
                  )}
                  {/* Under the title rather than in a money column: every
                      column to the right is birr, and a dollar figure sitting
                      among them is read as one however it is labelled. */}
                  {directSupplyOf(k) !== null && (
                    <>
                      <br />
                      <span className="chip direct-usd" title="Paid by the client to the manufacturer — not ours, and in no total here">
                        {formatUSD(directSupplyOf(k)?.amountUsdCents ?? 0)} paid direct
                      </span>
                    </>
                  )}
                </>
              ),
            },
            { key: 'client', label: 'Client', value: (k) => k.clientName, filterable: true },
            {
              key: 'scope',
              label: 'Covers',
              // Sorted by how many lifts it covers — the size of the job — not
              // by the sentence, which would sort "10 lifts" above "2 lifts".
              value: (k) => scopeOf.get(k.id)?.unitCount ?? 0,
              numeric: true,
              text: (k) => {
                const scope = scopeOf.get(k.id);
                return scope === undefined ? '' : describeScope(scope);
              },
              render: (k) => {
                const scope = scopeOf.get(k.id);
                if (scope === undefined) return <span className="muted">—</span>;
                return <ScopeCell scope={scope} />;
              },
            },
            {
              key: 'type',
              label: 'Type',
              value: (k) => k.type.replace(/_/g, ' '),
              filterable: true,
            },
            {
              key: 'payments',
              label: 'Paid',
              // Not sortable on anything meaningful: the terms are not loaded
              // until somebody asks for them, so there is no figure to sort by
              // without a hundred extra reads on every page load.
              value: () => '',
              render: (k) => <PaymentsCell contractId={k.id} />,
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
              // The LABEL, not the stored value: the filter dropdown is built
              // from this, and a menu reading "active / completed / terminated"
              // in lower case looks like database internals leaking through.
              value: (k) => statusLabel('contract', k.status),
              filterable: true,
              text: (k) => statusLabel('contract', k.status),
              render: (k) =>
                editable && user !== null ? (
                  <StatusSelect
                    compact
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
                        {canConvert(k) && (
                          <button
                            type="button"
                            title="Switch this client to a monthly maintenance agreement"
                            onClick={() => setConverting(k)}
                          >
                            To maintenance
                          </button>
                        )}
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

      {/*
        * Below the list, not above it.
        *
        * Every contract here is also in the list above, with the same figures —
        * and with six-month terms on a book going back to 2019, "approaching
        * renewal" is most of the book. Putting a hundred duplicated rows first
        * meant scrolling past the whole thing to reach the one contract you
        * came to edit. The renewal question is real, but it is a question you
        * go and ask, not one that should stand between you and the register.
        */}
      <RenewalBoard
        contracts={contracts.rows}
        editable={editable}
        uid={user?.uid ?? null}
        onEdit={setEditing}
      />
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
  onEdit,
}: {
  contracts: readonly WithId<Contract>[];
  editable: boolean;
  uid: string | null;
  onEdit: (contract: WithId<Contract>) => void;
}) {
  const asOf = new Date();
  const { busy, error, run } = useAsyncAction('update this renewal');
  const [open, setOpen] = useState(false);

  const rows = sortByUrgency(
    contracts
      // A contract a maintenance agreement has taken over is not lapsing, it
      // has been succeeded; the agreement is what comes up for renewal.
      .filter((k) => (k.status === 'active' || k.status === 'expired') && k.succeededByContractId == null)
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
  const lapsed = rows.filter((r) => r.renewal.bucket === 'lapsed');

  return (
    <section className="card">
      <div className="page-head">
        <div>
          <h2>Renewals</h2>
          {/*
            * The counts ARE the summary. Closed, this section answers "is there
            * anything to chase" in one line; open, it is the working list. It
            * starts closed because on a book this size the answer is usually
            * "yes, a hundred of them", and a hundred rows is a report rather
            * than a prompt.
            */}
          <p className="muted">
            {urgent.length > 0 ? (
              <>
                <strong>{urgent.length}</strong> need attention
                {lapsed.length > 0 && <> · {lapsed.length} already lapsed</>}
                {' · '}
                {rows.length} in the next 90 days
              </>
            ) : (
              <>Nothing urgent. {rows.length} approaching their window.</>
            )}
          </p>
        </div>
        <button type="button" className="no-print" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide renewals' : `Show ${rows.length} renewal${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {!open ? null : (
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
                    <div className="row-actions">
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
                      {/* So a contract can be corrected from the row that
                          flagged it, rather than by hunting for it again in
                          the list above. */}
                      <button type="button" onClick={() => onEdit(contract)}>Edit</button>
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

/**
 * What a contract covers, and the projects that deliver it.
 *
 * The count alone does not say whether three projects is one building or three,
 * and that difference decides whether one crew can do it — so the sites are
 * named, and each project is a link, because "which ones?" is the next question
 * every time.
 */
/**
 * What has been paid on a contract, and when.
 *
 * LOADED ON DEMAND, ONE CONTRACT AT A TIME
 *   The terms live in a subcollection, so showing them for every row would be a
 *   hundred extra reads on a page that already loads a hundred contracts. Almost
 *   nobody wants all of them at once; the one they are looking at, they want in
 *   full. So the summary is free and the detail costs a click.
 *
 * WHY THE DATE IS THE POINT
 *   "Half collected" is a fact about the contract; "half collected, the advance
 *   on 21 June 2024 and nothing since" is a fact somebody can act on. The date
 *   is what turns a balance into a story, and the ones with no date are marked
 *   as such rather than left looking undated by accident.
 */
function PaymentsCell({ contractId }: { contractId: string }) {
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<WithId<PaymentMilestone>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || terms !== null) return;
    let live = true;
    void getMilestones(contractId)
      .then((rows) => { if (live) setTerms(rows); })
      .catch((cause: unknown) => {
        if (live) setError(describeFirestoreError(cause, 'read the payment terms'));
      });
    return () => { live = false; };
  }, [open, terms, contractId]);

  // Fully settled terms, for the date of the most recent one.
  const fullyPaid = terms === null ? null : terms.filter((term) => term.status === 'paid');
  /*
   * Everything that has actually come in, part payments included.
   *
   * A summary that counted only fully settled terms would report a contract with
   * ETB 500,000 received against one term as having collected nothing, which is
   * the same mistake as calling a part-paid term "invoiced".
   */
  const receivedSantim =
    terms === null
      ? 0
      : terms.reduce(
          (sum, t) =>
            sum + (t.status === 'paid' ? t.grossSantim : (t.receivedGrossSantim ?? 0)),
          0,
        );
  const latest =
    fullyPaid === null
      ? null
      : fullyPaid
          .map((term) => term.paidOn ?? null)
          .filter((date): date is NonNullable<PaymentMilestone['paidOn']> => date !== null)
          .sort((a, b) => b.at.toMillis() - a.at.toMillis())[0] ?? null;

  return (
    <div className="scope-cell">
      <button type="button" className="link-button no-print" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide payments' : 'Payments'}
      </button>

      {open && error !== null && (
        <p className="error" role="alert">{error}</p>
      )}

      {open && terms !== null && (
        <>
          {receivedSantim > 0 ? (
            <span className="muted scope-progress">
              {formatETB(receivedSantim)} received
              {latest !== null && (
                <>
                  {' · last '}
                  <DualDateText value={latest} />
                </>
              )}
            </span>
          ) : (
            <span className="muted scope-progress">Nothing received yet</span>
          )}
          <ul className="scope-projects">
            {terms.map((term) => (
              <li key={term.id}>
                <span>{term.name}</span>
                <span className="muted">
                  {formatETB(term.grossSantim, { withSymbol: false })} ·{' '}
                  {term.status === 'paid' ? (
                    term.paidOn == null ? (
                      /* Settled by the workbook, which recorded no date for it.
                         Said out loud: an undated receipt is a gap in the
                         record, not a payment that happened today. */
                      <span title="The source recorded no date for this payment">paid, date unknown</span>
                    ) : (
                      <>paid <DualDateText value={term.paidOn} /></>
                    )
                  ) : term.status === 'part_paid' ? (
                    /* The money that arrived is named. "Part paid" on its own
                       tells somebody cash came without saying how much, which is
                       the question they were about to ask. */
                    <>
                      part paid — {formatETB(term.receivedGrossSantim ?? 0, { withSymbol: false })} in,{' '}
                      <strong>
                        {formatETB(
                          Math.max(0, term.grossSantim - (term.receivedGrossSantim ?? 0)),
                          { withSymbol: false },
                        )}{' '}
                        still owed
                      </strong>
                    </>
                  ) : (
                    describeTermStatus(term.status)
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ScopeCell({ scope }: { scope: ReturnType<typeof contractScope> }) {
  const [open, setOpen] = useState(false);

  if (scope.projectCount === 0 && scope.unitCount === 0) {
    return (
      <span className="muted">
        Nothing linked yet
      </span>
    );
  }

  return (
    <div className="scope-cell">
      <span className="scope-line">{describeScope(scope)}</span>
      {scope.progress.bps !== null && (
        <span className="muted scope-progress">
          {formatBps(scope.progress.bps, 0)} delivered
          {/* Named, because a weighted average and a plain one disagree and the
              reader cannot tell which they are looking at. */}
          {scope.progress.basis === 'value' ? ' (by value)' : ''}
        </span>
      )}

      {scope.projectCount > 0 && (
        <>
          <button type="button" className="link-button no-print" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide' : 'Show'} {scope.projectCount === 1 ? 'the project' : `all ${scope.projectCount} projects`}
          </button>
          {open && (
            <ul className="scope-projects">
              {scope.projects.map((project) => (
                <li key={project.id}>
                  <Link to={`/projects/${project.id}`}>{project.title}</Link>
                  <span className="muted">
                    {project.siteName === '' ? 'no site' : project.siteName} ·{' '}
                    {formatBps(project.progressBps, 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
