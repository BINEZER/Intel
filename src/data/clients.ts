/**
 * Client repository.
 */

import { addDoc, deleteDoc, doc, orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { Client } from '../lib/schema.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getOne, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'clients';

export type ClientInput = Omit<Client, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

export function subscribeClients(
  onData: (rows: WithId<Client>[]) => void,
  onError: (error: Error) => void,
  options: { activeOnly?: boolean } = {},
) {
  const q = options.activeOnly
    ? query(collectionRef(PATH), where('status', '==', 'active'), orderBy('name'))
    : query(collectionRef(PATH), orderBy('name'));
  return subscribe<Client>(q, onData, onError);
}

export function getClient(id: string) {
  return getOne<Client>(PATH, id);
}

export async function createClient(input: ClientInput, uid: string): Promise<string> {
  const ref = await addDoc(collectionRef(PATH), { ...stripReserved(input), ...stampCreate(uid) });
  return ref.id;
}

export async function updateClient(id: string, input: Partial<ClientInput>, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}

/** Admin-only, and only for a client created in error — otherwise deactivate. */
export async function deleteClient(id: string): Promise<void> {
  await deleteDoc(doc(db, PATH, id));
}

export function deactivateClient(id: string, uid: string): Promise<void> {
  return updateClient(id, { status: 'inactive' }, uid);
}
