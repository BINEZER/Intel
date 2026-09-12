/**
 * Client list and editor.
 */

import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { createClient, subscribeClients, updateClient, type ClientInput } from '../data/clients.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import type { Client } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

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
        {editable && (
          <button type="button" className="primary" onClick={() => setEditing('new')}>
            Add client
          </button>
        )}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <p className="muted">Loading clients…</p>}
      {!loading && rows.length === 0 && !error && (
        <p className="muted">No clients yet.{editable && ' Add the first one to start writing contracts.'}</p>
      )}

      {rows.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">TIN</th>
                <th scope="col">VAT</th>
                <th scope="col">City</th>
                <th scope="col">Contact</th>
                <th scope="col">Status</th>
                {editable && <th scope="col"><span className="visually-hidden">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((client) => (
                <tr key={client.id}>
                  <td><strong>{client.name}</strong></td>
                  <td className="mono">{client.tin || <span className="muted">—</span>}</td>
                  <td>{client.vatRegistered ? 'Registered' : <span className="muted">Not registered</span>}</td>
                  <td>{client.address?.city ?? '—'}</td>
                  <td>
                    {client.contacts?.[0] ? (
                      <>
                        {client.contacts[0].name}
                        <br />
                        <span className="muted">{client.contacts[0].phone}</span>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <span className={client.status === 'active' ? 'chip chip-ok' : 'chip'}>
                      {client.status}
                    </span>
                  </td>
                  {editable && (
                    <td>
                      <button type="button" onClick={() => setEditing(client)}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing !== null && user !== null && (
        <ClientForm
          initial={editing === 'new' ? null : editing}
          uid={user.uid}
          onDone={() => setEditing(null)}
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
    <section className="card">
      <h2>{initial === null ? 'New client' : `Edit ${initial.name}`}</h2>
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
          <select
            id="c-status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as Client['status'] })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
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
    </section>
  );
}
