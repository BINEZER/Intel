/**
 * Technician repository.
 */

import { addDoc, doc, orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { Technician } from '../lib/schema.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getOne, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'technicians';

export type TechnicianInput = Omit<Technician, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

export function subscribeTechnicians(
  onData: (rows: WithId<Technician>[]) => void,
  onError: (error: Error) => void,
  options: { activeOnly?: boolean } = {},
) {
  const q = options.activeOnly
    ? query(collectionRef(PATH), where('status', '==', 'active'), orderBy('name'))
    : query(collectionRef(PATH), orderBy('name'));
  return subscribe<Technician>(q, onData, onError);
}

export function getTechnician(id: string) {
  return getOne<Technician>(PATH, id);
}

export async function createTechnician(input: TechnicianInput, uid: string): Promise<string> {
  const ref = await addDoc(collectionRef(PATH), { ...stripReserved(input), ...stampCreate(uid) });
  return ref.id;
}

export async function updateTechnician(
  id: string,
  input: Partial<TechnicianInput>,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}
