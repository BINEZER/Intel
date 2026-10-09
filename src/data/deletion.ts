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
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  query,
  where,
  writeBatch,
  type Query,
  type WriteBatch,
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
    { label: 'lifts', query: whereEq('units', 'maintenanceContractId', id) },
    { label: 'callouts', query: whereEq('callouts', 'contractId', id) },
    { label: 'maintenance visits', query: whereEq('maintenanceVisits', 'contractId', id) },
  ]);
}

async function projectReferences(id: string): Promise<Reference[]> {
  return countAll([
    { label: 'invoices', query: whereEq('invoices', 'projectId', id) },
    { label: 'payment vouchers', query: whereEq('disbursements', 'projectId', id) },
    { label: 'sub-projects', query: whereEq('projects', 'parentProjectId', id) },
    { label: 'lifts', query: whereEq('units', 'installedByProjectId', id) },
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
 *
 * `force` is for the person who has read the warning and wants it gone anyway.
 * It only ever lifts a refusal that was ABOUT other records pointing at this
 * one (`verdict.forceable`); an issued invoice or an approved voucher is still
 * refused whatever is passed.
 */
export async function deleteTarget(
  target: DeletionTarget,
  uid: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const verdict = await assessTarget(target);
  if (!verdict.allowed && !(options.force === true && verdict.forceable)) {
    throw new Error(verdict.reason);
  }

  switch (target.kind) {
    case 'contract':
      return deleteContractUnlinking(target.id, uid);
    case 'project':
      return deleteProjectUnlinking(target.id, uid);
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
    case 'technician':
      // Unreachable: the policy refuses every technician, and the security
      // rules refuse the write too. Kept so adding a kind cannot silently fall
      // through to doing nothing.
      throw new Error('A technician is set to inactive rather than deleted.');
  }
}

type Write = (batch: WriteBatch) => void;
/** A batch holds 500 writes; stay well inside it. */
const BATCH_SIZE = 400;

/**
 * Run the unlinking writes, then delete the record itself in the LAST batch.
 *
 * The record goes last so that an interruption leaves it still there and still
 * deletable — running the delete again simply finishes the job. Deleting it
 * first would strand whatever had not yet been unlinked, pointing at nothing
 * with no page left to fix it from.
 */
async function runUnlinking(writes: readonly Write[], last: Write): Promise<void> {
  for (let i = 0; i < writes.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const write of writes.slice(i, i + BATCH_SIZE)) write(batch);
    await batch.commit();
  }
  const final = writeBatch(db);
  last(final);
  await final.commit();
}

/**
 * Delete a contract, and let go of everything that pointed at it.
 *
 * Its projects, invoices and lifts are NOT deleted — they are unlinked, so each
 * carries on as a record in its own right. An invoice in particular is never
 * removed as a side effect of something else.
 */
async function deleteContractUnlinking(id: string, uid: string): Promise<void> {
  const stamp = stampUpdate(uid);
  const [projects, invoices, units, predecessors, terms] = await Promise.all([
    getDocs(whereEq('projects', 'contractId', id)),
    getDocs(whereEq('invoices', 'contractId', id)),
    getDocs(whereEq('units', 'maintenanceContractId', id)),
    // An installation contract that names this one as its successor would go on
    // saying a service agreement took over when there is none — and the
    // follow-up engine would stop asking about a decision that is now open again.
    getDocs(whereEq('contracts', 'succeededByContractId', id)),
    getDocs(collection(db, `contracts/${id}/milestones`)),
  ]);

  const writes: Write[] = [
    ...projects.docs.map<Write>((d) => (b) => b.update(d.ref, { contractId: null, ...stamp })),
    ...invoices.docs.map<Write>((d) => (b) => b.update(d.ref, { contractId: null, ...stamp })),
    ...units.docs.map<Write>((d) => (b) =>
      b.update(d.ref, { maintenanceContractId: null, maintenanceContractNo: null, ...stamp }),
    ),
    ...predecessors.docs.map<Write>((d) => (b) => b.update(d.ref, { succeededByContractId: null, ...stamp })),
    ...terms.docs.map<Write>((d) => (b) => b.delete(d.ref)),
  ];
  await runUnlinking(writes, (b) => b.delete(doc(db, 'contracts', id)));
}

/**
 * Delete a project, its stages and its crew, and let go of the rest.
 *
 * A payment term tied to one of its stages loses that tie: a term whose stage
 * no longer exists would otherwise never become due, and nothing would ever
 * say so.
 */
async function deleteProjectUnlinking(id: string, uid: string): Promise<void> {
  const stamp = stampUpdate(uid);
  const project = await getDoc(doc(db, 'projects', id));
  const contractId = project.exists() ? ((project.data()['contractId'] as string | null) ?? null) : null;

  const [phases, invoices, units, children, tasks, assignments] = await Promise.all([
    getDocs(collection(db, `projects/${id}/phases`)),
    getDocs(whereEq('invoices', 'projectId', id)),
    getDocs(whereEq('units', 'installedByProjectId', id)),
    getDocs(whereEq('projects', 'parentProjectId', id)),
    getDocs(whereEq('tasks', 'projectId', id)),
    getDocs(whereEq('projectAssignments', 'projectId', id)),
  ]);

  const phaseIds = new Set(phases.docs.map((d) => d.id));
  const tiedTerms =
    contractId === null
      ? []
      : (await getDocs(collection(db, `contracts/${contractId}/milestones`))).docs.filter((d) =>
          phaseIds.has(String(d.data()['phaseId'] ?? '')),
        );

  const writes: Write[] = [
    ...invoices.docs.map<Write>((d) => (b) => b.update(d.ref, { projectId: null, ...stamp })),
    ...units.docs.map<Write>((d) => (b) => b.update(d.ref, { installedByProjectId: null, ...stamp })),
    ...children.docs.map<Write>((d) => (b) => b.update(d.ref, { parentProjectId: null, ...stamp })),
    ...tasks.docs.map<Write>((d) => (b) => b.update(d.ref, { projectId: deleteField(), ...stamp })),
    ...tiedTerms.map<Write>((d) => (b) => b.update(d.ref, { phaseId: deleteField(), ...stamp })),
    // Crew assignments mean nothing without the project they assign to.
    ...assignments.docs.map<Write>((d) => (b) => b.delete(d.ref)),
    ...phases.docs.map<Write>((d) => (b) => b.delete(d.ref)),
  ];
  await runUnlinking(writes, (b) => b.delete(doc(db, 'projects', id)));
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
