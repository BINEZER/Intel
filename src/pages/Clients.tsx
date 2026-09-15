/**
 * Client list and editor.
 */

import { useState, type FormEvent } from 'react';
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
              render: (client) => <strong>{client.name}</strong>,
            },
            {
              key: 'tin',
              label: 'TIN',
              value: (client) => client.tin,
              render: (client) =>
                client.tin === '' ? <span className="muted">—</span> : <span className="mono">{client.tin}</span>,
            },
            {
              key: 'vat',
              label: 'VAT',
              value: (client) => (client.vatRegistered ? 'Registered' : 'Not registered'),
              filterable: true,
              render: (client) =>
                client.vatRegistered ? 'Registered' : <span className="muted">Not registered</span>,
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
              render: (client) => <StatusChip kind="client" value={client.status} />,
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

function ClientForm({
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
          tin: initial.tin,
          vatRegistered: initial.vatRegistered,
          ...(initial.vatRegNo === undefined ? {} : { vatRegNo: initial.vatRegNo }),
          address: initial.address,
          contacts: initial.contacts?.length > 0 ? initial.contacts : EMPTY.contacts,
          status: initial.status,
          ...(initial.notes === undefined ? {} : { notes: initial.notes }),
        },
  );
  const { busy, error, run } = useAsyncAction(initial === null ? 'create this client' : 'update this client');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await run(async () =>
      initial === null ? createClient(form, uid) : updateClient(initial.id, form, uid),
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
          <label htmlFor="c-tin">TIN</label>
          <input
            id="c-tin"
            value={form.tin}
            onChange={(e) => setForm({ ...form, tin: e.target.value })}
          />
          <p className="hint">Required on every VAT invoice issued to this client.</p>
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
          <label htmlFor="c-subcity">Sub-city</label>
          <input
            id="c-subcity"
            value={form.address.subCity ?? ''}
            placeholder="Bole"
            onChange={(e) => setForm({ ...form, address: { ...form.address, subCity: e.target.value } })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-woreda">Woreda</label>
          <input
            id="c-woreda"
            value={form.address.woreda ?? ''}
            onChange={(e) => setForm({ ...form, address: { ...form.address, woreda: e.target.value } })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-street">Street / building</label>
          <input
            id="c-street"
            value={form.address.street ?? ''}
            placeholder="Africa Avenue, Getu Commercial Centre, 4th floor"
            onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })}
          />
        </div>

        <div className="field">
          <label htmlFor="c-landmark">Landmark</label>
          <input
            id="c-landmark"
            value={form.address.landmark ?? ''}
            placeholder="Opposite Edna Mall"
            onChange={(e) => setForm({ ...form, address: { ...form.address, landmark: e.target.value } })}
          />
          <p className="hint">
            In Addis a landmark does more work than a street name. This is what goes on the delivery note.
          </p>
        </div>

        <div className="field">
          <label htmlFor="c-pobox">P.O. Box</label>
          <input
            id="c-pobox"
            value={form.address.poBox ?? ''}
            onChange={(e) => setForm({ ...form, address: { ...form.address, poBox: e.target.value } })}
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
            kind="client"
            id="c-status"
            value={form.status}
            onChange={(value) => setForm({ ...form, status: value as Client['status'] })}
          />
        </div>

        <div className="field checkbox">
          <label>
            <input
              type="checkbox"
              checked={form.vatRegistered}
              onChange={(e) => setForm({ ...form, vatRegistered: e.target.checked })}
            />
            VAT registered
          </label>
        </div>

        {error && <p className="error form-wide" role="alert">{error}</p>}

        <div className="form-actions form-wide">
          <button type="submit" className="primary" disabled={busy || form.name.trim() === ''}>
            {busy ? 'Saving…' : 'Save client'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
