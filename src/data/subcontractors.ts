/**
 * Subcontractor repository.
 */

import { addDoc, doc, orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { Subcontractor } from '../lib/schema.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getOne, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'subcontractors';

export type SubcontractorInput = Omit<
  Subcontractor,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'
>;

export function subscribeSubcontractors(
  onData: (rows: WithId<Subcontractor>[]) => void,
  onError: (error: Error) => void,
  options: { activeOnly?: boolean } = {},
) {
  const q = options.activeOnly
    ? query(collectionRef(PATH), where('status', '==', 'active'), orderBy('name'))
    : query(collectionRef(PATH), orderBy('name'));
  return subscribe<Subcontractor>(q, onData, onError);
}

export function getSubcontractor(id: string) {
  return getOne<Subcontractor>(PATH, id);
}

export async function createSubcontractor(input: SubcontractorInput, uid: string): Promise<string> {
  const ref = await addDoc(collectionRef(PATH), { ...stripReserved(input), ...stampCreate(uid) });
  return ref.id;
}

export async function updateSubcontractor(
  id: string,
  input: Partial<SubcontractorInput>,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}
