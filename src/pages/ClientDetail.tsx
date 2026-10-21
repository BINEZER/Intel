/**
 * One client: everything the company has with them, then the client's own details.
 *
 * The lists come first. A client page is opened to answer "what do we have with
 * these people" — their contracts, their projects, their lifts — and, as often,
 * to correct or remove one of them. Putting the address and the contact numbers
 * above all of that made the answer a scroll away.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { subscribeClients } from '../data/clients.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeProjects } from '../data/projects.js';
import { subscribeUnits } from '../data/units.js';
import { useCollection } from '../data/useCollection.js';
import type { WithId } from '../data/repository.js';
import type { Client, Contract, ElevatorUnit, Project } from '../lib/schema.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { DualDateText } from '../components/DualDateInput.js';
import { RelatedList, type RelatedItem } from '../components/RelatedList.js';
import { StatusChip } from '../components/StatusSelect.js';
import { describeMake } from '../lib/lift-spec.js';
import { formatETB } from '../lib/money.js';
import { projectTypeShort } from '../lib/project-kind.js';
import { ContractForm } from './ContractForm.js';
import { ClientForm } from './Clients.js';
import { ProjectForm } from './Projects.js';
import { UnitForm } from './Units.js';

type Editing =
  | { kind: 'client' }
  | { kind: 'new-contract' }
  | { kind: 'contract'; row: WithId<Contract> }
  | { kind: 'project'; row: WithId<Project> }
  | { kind: 'unit'; row: WithId<ElevatorUnit> };

export function ClientDetail() {
  const { clientId = '' } = useParams<{ clientId: string }>();
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Editing | null>(null);

  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');

  const client = clients.rows.find((c) => c.id === clientId) ?? null;
  const canEditClient = can(role, 'manageClients');
  const canEditContracts = can(role, 'manageContracts');
  const canEditProjects = can(role, 'manageProjects');

  const mine = useMemo(
    () => ({
      contracts: contracts.rows.filter((k) => k.clientId === clientId),
      projects: projects.rows.filter((p) => p.clientId === clientId),
      units: units.rows.filter((u) => u.clientId === clientId),
    }),
    [contracts.rows, projects.rows, units.rows, clientId],
  );

  if (clients.loading) return <p className="muted">Loading client…</p>;
  if (client === null) {
    return (
      <>
        <p className="error" role="alert">That client does not exist. It may have been deleted.</p>
        <Link to="/clients">Back to clients</Link>
      </>
    );
  }

  const contractItems: RelatedItem[] = mine.contracts.map((k) => ({
    key: k.id,
    to: `/contracts/${k.id}`,
    title: k.title,
    detail: (
      <>
        {k.contractNo} · {k.type.replace(/_/g, ' ')} · {formatETB(k.valueNetSantim)} net · ends{' '}
        <DualDateText value={k.endDate} />
      </>
    ),
    meta: <StatusChip kind="contract" value={k.status} />,
    ...(canEditContracts ? { onEdit: () => setEditing({ kind: 'contract', row: k }) } : {}),
    ...(canEditContracts
      ? { deleteTarget: { kind: 'contract' as const, id: k.id, name: k.contractNo, status: k.status } }
      : {}),
  }));

  const projectItems: RelatedItem[] = mine.projects.map((p) => ({
    key: p.id,
    to: `/projects/${p.id}`,
    title: p.title,
    detail: `${p.projectNo} · ${p.site?.name ?? '—'} · ${projectTypeShort(p.type)}`,
    meta: <StatusChip kind="project" value={p.status} />,
    ...(canEditProjects ? { onEdit: () => setEditing({ kind: 'project', row: p }) } : {}),
    ...(canEditProjects ? { deleteTarget: { kind: 'project' as const, id: p.id, name: p.projectNo } } : {}),
  }));

  const liftItems: RelatedItem[] = mine.units.map((u) => ({
    key: u.id,
    to: `/units/${u.id}`,
    title: `${u.tag} · ${u.siteName}`,
    detail: `${u.unitCode}${describeMake(u) === null ? '' : ` · ${describeMake(u)}`}${
      u.maintenanceContractNo === null ? '' : ` · serviced under ${u.maintenanceContractNo}`
    }`,
    meta: <span className="chip no-caps">{u.status.replace(/_/g, ' ')}</span>,
    ...(canEditProjects ? { onEdit: () => setEditing({ kind: 'unit', row: u }) } : {}),
    ...(canEditProjects
      ? { deleteTarget: { kind: 'unit' as const, id: u.id, name: u.tag, unit: { tag: u.tag, clientId: u.clientId } } }
      : {}),
  }));

  const contact = client.contacts?.[0];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/clients">Clients</Link></p>
          <h1>{client.name}</h1>
          <p className="muted">
            {[client.address?.street, client.address?.city].filter((part) => part !== undefined && part !== '').join(', ') || '—'}
          </p>
        </div>
        <div className="chip-row">
          <StatusChip kind="client" value={client.status} />
          {canEditContracts && user !== null && (
            <button type="button" className="primary" onClick={() => setEditing({ kind: 'new-contract' })}>Add contract</button>
          )}
          {canEditClient && user !== null && (
            <>
              <button type="button" onClick={() => setEditing({ kind: 'client' })}>Edit client</button>
              <DeleteButton
                target={{ kind: 'client', id: client.id, name: client.name }}
                onDeleted={() => navigate('/clients')}
              />
            </>
          )}
        </div>
      </div>

      {editing !== null && user !== null && (
        <>
          {editing.kind === 'client' && <ClientForm initial={client} uid={user.uid} onDone={() => setEditing(null)} />}
          {editing.kind === 'new-contract' && <ContractForm initial={null} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />}
          {editing.kind === 'contract' && (
            <ContractForm initial={editing.row} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />
          )}
          {editing.kind === 'project' && (
            <ProjectForm initial={editing.row} clients={clients.rows} uid={user.uid} onDone={() => setEditing(null)} />
          )}
          {editing.kind === 'unit' && <UnitForm initial={editing.row} uid={user.uid} onDone={() => setEditing(null)} />}
        </>
      )}

      {(contracts.error ?? projects.error ?? units.error) !== null && (
        <p className="error" role="alert">{contracts.error ?? projects.error ?? units.error}</p>
      )}

      <RelatedList
        title="Contracts"
        items={contractItems}
        loading={contracts.loading}
        empty="No contracts with this client."
      />
      <RelatedList
        title="Projects"
        items={projectItems}
        loading={projects.loading}
        empty="No projects for this client."
      />
      <RelatedList
        title="Lifts"
        items={liftItems}
        loading={units.loading}
        empty="No lifts on the register for this client."
      />

      <section className="card">
        <h2>Details</h2>
        <dl className="detail-grid">
          <div><dt>Name in Amharic</dt><dd>{client.nameAm ?? '—'}</dd></div>
          <div>
            <dt>Address</dt>
            <dd>
              {[client.address?.street, client.address?.city]
                .filter((part) => part !== undefined && part !== '')
                .join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt>Main contact</dt>
            <dd>{contact === undefined ? '—' : `${contact.name} · ${contact.phone}`}</dd>
          </div>
          {client.notes !== undefined && client.notes !== '' && (
            <div><dt>Notes</dt><dd>{client.notes}</dd></div>
          )}
        </dl>
        {(client.contacts?.length ?? 0) > 1 && (
          <>
            <h3>Other contacts</h3>
            <ul className="plain-list">
              {client.contacts.slice(1).map((c) => (
                <li key={`${c.name}-${c.phone}`}>{c.name}{c.role === undefined ? '' : ` (${c.role})`} · {c.phone}{c.email === undefined ? '' : ` · ${c.email}`}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
