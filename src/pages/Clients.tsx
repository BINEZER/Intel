/**
 * Client list and editor.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { createClient, subscribeClients, updateClient, type ClientInput } from '../data/clients.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { FormPanel } from '../components/FormPanel.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import type { Client } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { StatusChip, StatusSelect } from '../components/StatusSelect.js';
import { DataTable } from '../components/DataTable.js';
import { statusLabel } from '../lib/status.js';

const EMPTY: ClientInput = {
  name: '',
  tin: '',
  vatRegistered: true,
  address: { city: 'Addis Ababa' },
  contacts: [{ name: '', phone: '' }],
  status: 'active',
};

export function Clients() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageClients');
  const { rows, loading, error } = useCollection<Client>(
    (onData, onError) => subscribeClients(onData, onError),
    [],
    'load clients',
  );
  const [editing, setEditing] = useState<WithId<Client> | 'new' | null>(null);
  const statusAction = useAsyncAction('update client status');

  return (
    <>
      <div className="page-head">
        <h1>Clients</h1>
        <div className="page-actions">
          <PrintButton label="Print list" />
          {editable && (
            <button type="button" className="primary" onClick={() => setEditing('new')}>
              Add client
            </button>
          )}
        </div>
      </div>

      <PrintHeader title="Clients" subtitle={`${rows.length} on the register`} />

      {editing !== null && user !== null && (
        <ClientForm
          initial={editing === 'new' ? null : editing}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {statusAction.error && <p className="error" role="alert">{statusAction.error}</p>}
      {loading && <p className="muted">Loading clients…</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="muted">No clients yet.{editable && ' Add the first one to start writing contracts.'}</p>
      )}

      {rows.length > 0 && (
        <DataTable
          rows={rows}
          rowKey={(client) => client.id}
          noun="clients"
          columns={[
            {
              key: 'name',
              label: 'Name',
              value: (client) => client.name,
              render: (client) => (
                <Link to={`/clients/${client.id}`}>
                  <strong>{client.name}</strong>
                </Link>
              ),
            },
            {
              key: 'city',
              label: 'City',
              value: (client) => client.address?.city ?? '',
              filterable: true,
            },
            {
              key: 'contact',
              label: 'Contact',
              value: (client) => client.contacts?.[0]?.name ?? '',
              text: (client) =>
                `${client.contacts?.[0]?.name ?? ''} ${client.contacts?.[0]?.phone ?? ''}`.trim(),
              render: (client) =>
                client.contacts?.[0] === undefined ? (
                  <span className="muted">—</span>
                ) : (
                  <>
                    {client.contacts[0].name}
                    <br />
                    <span className="muted">{client.contacts[0].phone}</span>
                  </>
                ),
            },
            {
              key: 'status',
              label: 'Status',
              value: (client) => client.status,
              filterable: true,
              text: (client) => statusLabel('client', client.status),
              render: (client) => editable && user !== null ? (
                <StatusSelect
                  compact
                  kind="client"
                  id={`client-status-${client.id}`}
                  value={client.status}
                  disabled={statusAction.busy}
                  onChange={(value) => void statusAction.run(() => updateClient(client.id, { status: value as Client['status'] }, user.uid))}
                />
              ) : <StatusChip kind="client" value={client.status} />,
            },
            ...(editable
              ? [
                  {
                    key: 'actions',
                    label: 'Actions',
                    unsortable: true,
                    value: () => '',
                    render: (client: WithId<Client>) => (
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(client)}>Edit</button>
                        <DeleteButton target={{ kind: 'client', id: client.id, name: client.name }} />
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

export function ClientForm({
  initial,
  uid,
  onDone,
}: {
  initial: WithId<Client> | null;
  uid: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<ClientInput>(() =>
    initial === null
      ? EMPTY
      : {
          // Optional fields are spread only when present. Firestore rejects an
          // explicit `undefined` value outright, so this is a write-path
          // requirement, not just a TypeScript one.
          name: initial.name,
          ...(initial.nameAm === undefined ? {} : { nameAm: initial.nameAm }),
          tin: '',
          vatRegistered: true,
          address: {
            city: initial.address?.city ?? '',
            ...(initial.address?.street ? { street: initial.address.street } : {}),
          },
          contacts: initial.contacts?.length > 0 ? initial.contacts : EMPTY.contacts,
          status: initial.status,
          ...(initial.notes === undefined ? {} : { notes: initial.notes }),
        },
  );
  const { busy, error, run } = useAsyncAction(initial === null ? 'create this client' : 'update this client');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const payload: ClientInput = { ...form, tin: '', vatRegistered: true, vatRegNo: undefined };
    const result = await run(async () =>
      initial === null ? createClient(payload, uid) : updateClient(initial.id, payload, uid),
    );
    if (result !== null) onDone();
  }

  const contact = form.contacts[0] ?? { name: '', phone: '' };

  return (
    <FormPanel
      title={initial === null ? 'New client' : `Edit ${initial.name}`}
      description="Everything else hangs off a client — contracts, projects and invoices all point back here."
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)} className="form-grid">
        <div className="field">
          <label htmlFor="c-name">Name <span className="req" aria-hidden="true">*</span></label>
          <input
            id="c-name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-city">City</label>
          <input
            id="c-city"
            value={form.address.city}
            onChange={(e) => setForm({ ...form, address: { ...form.address, city: e.target.value } })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-street">Address</label>
          <input
            id="c-street"
            value={form.address.street ?? ''}
            placeholder="Africa Avenue, Getu Commercial Centre, 4th floor"
            onChange={(e) => setForm({ ...form, address: { city: form.address.city, street: e.target.value } })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-contact">Primary contact</label>
          <input
            id="c-contact"
            value={contact.name}
            onChange={(e) => setForm({ ...form, contacts: [{ ...contact, name: e.target.value }] })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-phone">Phone</label>
          <input
            id="c-phone"
            value={contact.phone}
            onChange={(e) => setForm({ ...form, contacts: [{ ...contact, phone: e.target.value }] })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-status">Status</label>
          <StatusSelect
            compact
            kind="client"
            id="c-status"
            value={form.status}
            onChange={(value) => setForm({ ...form, status: value as Client['status'] })}
          />
        </div>

        {error && <p className="error form-wide" role="alert">{error}</p>}

        <div className="form-actions form-wide">
          <button type="submit" className="primary" disabled={busy || form.name.trim() === ''}>
            {busy ? 'Saving…' : initial === null ? 'Save client' : 'Save changes'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
