/**
 * Deleting a record, after checking nothing still points at it.
 *
 * Firestore does not cascade and does not enforce foreign keys, so both jobs
 * are done here:
 *
 *   COUNTING FIRST. Every check is a `limit`ed count query, so asking "does
 *   anything point at this client" costs one small read per collection rather
 *   than loading the collection. The counts feed `assessDeletion`, which holds
 *   the policy; this file only gathers the facts and carries out the verdict.
 *
 *   CASCADING BY HAND. A contract's payment terms and a project's stages live
 *   in subcollections, which a document delete leaves behind — invisible,
 *   un-listed, and still billable against a contract that no longer exists.
 *   They are deleted in the same batch as their parent.
 */

import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  query,
  where,
  writeBatch,
  type Query,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampUpdate } from './audit.js';
import { assessDeletion, type DeletableKind, type DeletionVerdict, type Reference } from '../lib/deletion.js';

/** One counted query. `limit` is not used: a count aggregation is one read. */
async function countOf(q: Query): Promise<number> {
  const snapshot = await getCountFromServer(q);
  return snapshot.data().count;
}

function whereEq(path: string, field: string, value: string): Query {
  return query(collection(db, path), where(field, '==', value));
}

async function countAll(
  specs: readonly { label: string; query: Query }[],
): Promise<Reference[]> {
  const counts = await Promise.all(specs.map((spec) => countOf(spec.query)));
  return specs.map((spec, index) => ({ label: spec.label, count: counts[index] as number }));
}

// ---------------------------------------------------------------------------
// What points at what
// ---------------------------------------------------------------------------

async function clientReferences(id: string): Promise<Reference[]> {
  return countAll([
    { label: 'contracts', query: whereEq('contracts', 'clientId', id) },
    { label: 'projects', query: whereEq('projects', 'clientId', id) },
    { label: 'invoices', query: whereEq('invoices', 'clientId', id) },
    { label: 'lifts', query: whereEq('units', 'clientId', id) },
  ]);
}

async function contractReferences(id: string): Promise<Reference[]> {
  return countAll([
    { label: 'projects', query: whereEq('projects', 'contractId', id) },
    { label: 'invoices', query: whereEq('invoices', 'contractId', id) },
  ]);
}

async function projectReferences(id: string): Promise<Reference[]> {
  return countAll([
    { label: 'invoices', query: whereEq('invoices', 'projectId', id) },
    { label: 'payment vouchers', query: whereEq('disbursements', 'projectId', id) },
    { label: 'sub-projects', query: whereEq('projects', 'parentProjectId', id) },
  ]);
}

/**
 * A lift's service history is NOT keyed by its document id.
 *
 * Callouts and visits record `unitTag` — "LIFT-01" — because that is what the
 * technician writes on the sheet. A tag is not unique across buildings, so the
 * client has to be part of the match; querying `unitId` would compile, return
 * zero every time, and give a safety check that never once said no.
 */
async function unitReferences(unit: { tag: string; clientId: string }): Promise<Reference[]> {
  const byTag = (path: string): Query =>
    query(
      collection(db, path),
      where('clientId', '==', unit.clientId),
      where('unitTag', '==', unit.tag),
    );
  return countAll([
    { label: 'callouts', query: byTag('callouts') },
    { label: 'maintenance visits', query: byTag('maintenanceVisits') },
  ]);
}

async function subcontractorReferences(id: string): Promise<Reference[]> {
  return countAll([
    { label: 'payment vouchers', query: whereEq('disbursements', 'subcontractorId', id) },
  ]);
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

export interface DeletionTarget {
  kind: DeletableKind;
  id: string;
  name: string;
  /** Needed for invoices and vouchers, where the policy turns on it. */
  status?: string;
  /**
   * Needed for a lift: its service history is keyed by tag within a client, not
   * by document id, so both are required to find it.
   */
  unit?: { tag: string; clientId: string };
}

/**
 * Refuse to assess a lift without the fields its history is keyed by.
 *
 * Defaulting them would make a forgotten field look like a clean bill of
 * health: the query would match nothing and the delete would be waved through.
 * A check that cannot run must stop, not pass.
 */
function requireUnit(target: DeletionTarget): { tag: string; clientId: string } {
  if (target.unit === undefined) {
    throw new Error(
      `Cannot check lift ${target.name} for service history without its tag and client.`,
    );
  }
  return target.unit;
}

/**
 * Whether this record can go, and what goes with it.
 *
 * Called when the user opens the confirm step, not on every render: it costs
 * several reads, and a list of two hundred clients must not fire six hundred
 * count queries to draw a row of buttons.
 */
export async function assessTarget(target: DeletionTarget): Promise<DeletionVerdict> {
  const { kind, id, name } = target;

  const references = await (kind === 'client'
    ? clientReferences(id)
    : kind === 'contract'
      ? contractReferences(id)
      : kind === 'project'
        ? projectReferences(id)
        : kind === 'unit'
          ? unitReferences(requireUnit(target))
          : kind === 'subcontractor'
            ? subcontractorReferences(id)
            : Promise.resolve<Reference[]>([]));

  const cascade = await cascadeOf(kind, id);

  return assessDeletion({
    kind,
    name,
    references,
    cascade,
    ...(target.status === undefined ? {} : { status: target.status }),
  });
}

/** What lives inside the record and will go with it. */
async function cascadeOf(kind: DeletableKind, id: string): Promise<Reference[]> {
  if (kind === 'contract') {
    return [{ label: 'payment terms', count: await countOf(collection(db, `contracts/${id}/milestones`)) }];
  }
  if (kind === 'project') {
    return [{ label: 'stages', count: await countOf(collection(db, `projects/${id}/phases`)) }];
  }
  if (kind === 'program') {
    return [
      { label: 'projects released', count: await countOf(whereEq('projects', 'programId', id)) },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Doing
// ---------------------------------------------------------------------------

/**
 * Delete the record, re-checking first.
 *
 * The verdict shown in the confirm step can be seconds old, and in that time
 * somebody else may have raised an invoice against the contract being deleted.
 * Re-asking costs a few reads and closes the window.
 */
export async function deleteTarget(target: DeletionTarget, uid: string): Promise<void> {
  const verdict = await assessTarget(target);
  if (!verdict.allowed) throw new Error(verdict.reason);

  switch (target.kind) {
    case 'contract':
      return deleteWithSubcollection(`contracts/${target.id}/milestones`, 'contracts', target.id);
    case 'project':
      return deleteWithSubcollection(`projects/${target.id}/phases`, 'projects', target.id);
    case 'program':
      return deleteProgramReleasingMembers(target.id, uid);
    case 'client':
      return deleteDoc(doc(db, 'clients', target.id));
    case 'unit':
      return deleteDoc(doc(db, 'units', target.id));
    case 'subcontractor':
      return deleteDoc(doc(db, 'subcontractors', target.id));
    case 'invoice':
      return deleteWithSubcollection(`invoices/${target.id}/receipts`, 'invoices', target.id);
    case 'disbursement':
      return deleteDoc(doc(db, 'disbursements', target.id));
  }
}

/**
 * Delete the children and the parent in one batch.
 *
 * Deleting the parent first would, on any failure between the two, leave a
 * subcollection nothing can reach: not listed anywhere, not deletable through
 * the app, and still holding figures.
 */
async function deleteWithSubcollection(
  childPath: string,
  parentPath: string,
  parentId: string,
): Promise<void> {
  const children = await getDocs(collection(db, childPath));
  const batch = writeBatch(db);
  for (const child of children.docs) batch.delete(child.ref);
  batch.delete(doc(db, parentPath, parentId));
  await batch.commit();
}

/**
 * Deleting a program ungroups its projects; it never deletes them.
 *
 * The release happens in the SAME batch as the delete, so no failure can leave
 * projects pointing at a program that is gone — which reads on every page as a
 * project belonging to nothing.
 */
async function deleteProgramReleasingMembers(id: string, uid: string): Promise<void> {
  const members = await getDocs(whereEq('projects', 'programId', id));
  const batch = writeBatch(db);
  for (const member of members.docs) {
    batch.update(member.ref, { programId: null, ...stampUpdate(uid) });
  }
  batch.delete(doc(db, 'programs', id));
  await batch.commit();
}
