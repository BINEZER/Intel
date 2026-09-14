/**
 * Unit repository, and the service records that hang off a lift.
 *
 * Callouts and maintenance visits are top-level collections keyed by `unitTag`
 * and `contractId` — they were written before units had identities of their own.
 * `matchesUnit` in lib/service-history is the single place that reconciles the
 * two, so when units carry a stable id everywhere it is one function to change
 * rather than every page that shows a history.
 */

import { doc, limit, orderBy, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import type { Callout, ElevatorUnit, MaintenanceVisit } from '../lib/schema.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { collectionRef, getMany, getOne, newId, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'units';
const CALLOUTS = 'callouts';
const VISITS = 'maintenanceVisits';

export type UnitInput = Omit<ElevatorUnit, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

export function subscribeUnits(
  onData: (rows: WithId<ElevatorUnit>[]) => void,
  onError: (error: Error) => void,
  options: { status?: ElevatorUnit['status']; servicedOnly?: boolean } = {},
) {
  // "Serviced" is the view a service manager wants: lifts under a live
  // maintenance contract, which is not the same as lifts we installed.
  const constraints = [
    ...(options.status === undefined ? [] : [where('status', '==', options.status)]),
    ...(options.servicedOnly === true ? [where('maintenanceContractId', '!=', null)] : []),
  ];
  return subscribe<ElevatorUnit>(query(collectionRef(PATH), ...constraints), onData, onError);
}

export function getUnit(id: string) {
  return getOne<ElevatorUnit>(PATH, id);
}

/**
 * Callouts for a site.
 *
 * Queried by SITE rather than by tag: one round trip brings back every lift in
 * the building, and the per-unit split happens in memory through `matchesUnit`.
 * Querying per tag would be one read per lift for a page that shows them all.
 */
export function getSiteCallouts(siteName: string, max = 500) {
  return getMany<Callout>(
    query(collectionRef(CALLOUTS), where('siteName', '==', siteName), orderBy('reportedAt', 'desc'), limit(max)),
  );
}

export function getSiteVisits(siteName: string, max = 500) {
  return getMany<MaintenanceVisit>(
    query(collectionRef(VISITS), where('siteName', '==', siteName), orderBy('scheduledDate.at', 'desc'), limit(max)),
  );
}

export function subscribeSiteCallouts(
  siteName: string,
  onData: (rows: WithId<Callout>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Callout>(
    query(collectionRef(CALLOUTS), where('siteName', '==', siteName), orderBy('reportedAt', 'desc'), limit(500)),
    onData,
    onError,
  );
}

export function subscribeSiteVisits(
  siteName: string,
  onData: (rows: WithId<MaintenanceVisit>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<MaintenanceVisit>(
    query(collectionRef(VISITS), where('siteName', '==', siteName), orderBy('scheduledDate.at', 'desc'), limit(500)),
    onData,
    onError,
  );
}

export async function createUnit(input: UnitInput, uid: string): Promise<string> {
  const id = newId(PATH);
  const batch = writeBatch(db);
  batch.set(doc(db, PATH, id), { ...stripReserved(input), ...stampCreate(uid) });
  await batch.commit();
  return id;
}

export async function updateUnit(id: string, input: Partial<UnitInput>, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { ...stripReserved(input), ...stampUpdate(uid) });
}

/**
 * A manager's own note about the machine.
 *
 * Kept apart from maintenance findings on purpose. A finding is what an engineer
 * saw on a dated visit and is part of the record; a remark is what the business
 * thinks about the lift — "client keeps refusing the door operator quote" — and
 * rewriting the first to say the second would corrupt the service history.
 */
export async function setUnitRemarks(id: string, remarks: string, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { remarks, ...stampUpdate(uid) });
}
