/**
 * Reading a finished job whole, and removing it.
 *
 * ONE SNAPSHOT, THREE USES
 *   The job is read once into an `ArchiveJob`. That snapshot is what is judged
 *   (`assessArchive`), what is written to the backup, and — after being read
 *   AGAIN and compared by fingerprint — what is deleted. Reading it separately
 *   for each purpose would let the three disagree, and "the backup is of
 *   something other than what was removed" is the failure this whole feature
 *   exists to prevent.
 *
 * ORDER OF REMOVAL
 *   The contract goes last. Every earlier step leaves the job still findable and
 *   still passing the checks, so a removal that is interrupted can simply be
 *   finished; deleting the contract first would leave projects and invoices
 *   nobody could reach from any page.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
  writeBatch,
  type DocumentReference,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampCreate, stampUpdate } from './audit.js';
import { collectionRef, subscribe, type WithId } from './repository.js';
import type { ArchiveJob, ArchiveVerdict, JobDoc } from '../lib/archive.js';
import type { ArchiveRecord, Contract } from '../lib/schema.js';

const ARCHIVES = 'archives';
export const archiveIdFor = (contractId: string) => `arc-${contractId}`;

/** Firestore's `in` operator takes at most 30 values. */
const IN_LIMIT = 30;
/** A batch may hold 500 writes; leave room for the record and the contract. */
const BATCH_SIZE = 400;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function whereIn(path: string, field: string, values: readonly string[]) {
  const found = await Promise.all(
    chunks(values, IN_LIMIT).map((group) => getDocs(query(collection(db, path), where(field, 'in', group)))),
  );
  return found.flatMap((snapshot) => snapshot.docs);
}

function uniqueById<T extends { id: string }>(docs: readonly T[]): T[] {
  return [...new Map(docs.map((d) => [d.id, d])).values()];
}

const asDoc = <T,>(d: { id: string; data(): unknown }): JobDoc<T> => ({ id: d.id, data: d.data() as T });

/**
 * Read everything that belongs to a contract's job.
 * Returns null when the contract does not exist.
 */
export async function loadJob(contractId: string): Promise<(ArchiveJob & { refs: JobRefs }) | null> {
  const contractSnap = await getDoc(doc(db, 'contracts', contractId));
  if (!contractSnap.exists()) return null;
  const contract = asDoc<ArchiveJob['contract']['data']>(contractSnap);
  const stored = contractSnap.data() as Contract;

  const [termDocs, directProjects] = await Promise.all([
    getDocs(collection(db, `contracts/${contractId}/milestones`)),
    getDocs(query(collection(db, 'projects'), where('contractId', '==', contractId))),
  ]);

  // One level of sub-projects, which is all the model allows.
  const parentIds = directProjects.docs.map((d) => d.id);
  const children = parentIds.length === 0 ? [] : await whereIn('projects', 'parentProjectId', parentIds);
  const projectDocs = uniqueById([...directProjects.docs, ...children]);
  const projectIds = projectDocs.map((d) => d.id);

  const [stageSnaps, invoiceByContract, invoiceByProject, voucherDocs, assignmentDocs, taskByContract, taskByProject, unitDocs] =
    await Promise.all([
      Promise.all(projectIds.map((id) => getDocs(collection(db, `projects/${id}/phases`)))),
      getDocs(query(collection(db, 'invoices'), where('contractId', '==', contractId))),
      projectIds.length === 0 ? Promise.resolve([]) : whereIn('invoices', 'projectId', projectIds),
      projectIds.length === 0 ? Promise.resolve([]) : whereIn('disbursements', 'projectId', projectIds),
      projectIds.length === 0 ? Promise.resolve([]) : whereIn('projectAssignments', 'projectId', projectIds),
      getDocs(query(collection(db, 'tasks'), where('contractId', '==', contractId))),
      projectIds.length === 0 ? Promise.resolve([]) : whereIn('tasks', 'projectId', projectIds),
      projectIds.length === 0 ? Promise.resolve([]) : whereIn('units', 'installedByProjectId', projectIds),
    ]);

  const invoiceDocs = uniqueById([...invoiceByContract.docs, ...invoiceByProject]);
  const [receiptSnaps, stepSnaps] = await Promise.all([
    Promise.all(invoiceDocs.map((d) => getDocs(collection(db, `invoices/${d.id}/receipts`)))),
    Promise.all(invoiceDocs.map((d) => getDocs(collection(db, `invoices/${d.id}/collectionSteps`)))),
  ]);

  let successor: ArchiveJob['successor'] = null;
  if (typeof stored.succeededByContractId === 'string') {
    const next = await getDoc(doc(db, 'contracts', stored.succeededByContractId));
    if (next.exists()) {
      const n = next.data() as Contract;
      successor = { id: next.id, contractNo: n.contractNo, status: n.status };
    }
  }

  // Service records that mention the job are NOT part of it. Counted so the
  // person is told they stay; read by id only, never loaded.
  const serviceRefs = async (path: string) => {
    const [byContract, byProject] = await Promise.all([
      getDocs(query(collection(db, path), where('contractId', '==', contractId))),
      path === 'callouts' && projectIds.length > 0 ? whereIn(path, 'projectId', projectIds) : Promise.resolve([]),
    ]);
    return new Set([...byContract.docs.map((d) => d.id), ...byProject.map((d) => d.id)]).size;
  };
  const [callouts, visits] = await Promise.all([serviceRefs('callouts'), serviceRefs('maintenanceVisits')]);

  const refs: JobRefs = {
    terms: termDocs.docs.map((d) => d.ref),
    stages: stageSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
    receipts: receiptSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
    chaseSteps: stepSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
    invoices: invoiceDocs.map((d) => d.ref),
    vouchers: voucherDocs.map((d) => d.ref),
    assignments: assignmentDocs.map((d) => d.ref),
    tasks: uniqueById([...taskByContract.docs, ...taskByProject]).map((d) => d.ref),
    projects: projectDocs.map((d) => d.ref),
    units: unitDocs.map((d) => d.ref),
  };

  return {
    contract,
    terms: termDocs.docs.map((d) => asDoc(d)),
    projects: projectDocs.map((d) => asDoc(d)),
    stages: stageSnaps.flatMap((s, index) =>
      s.docs.map((d) => ({ ...asDoc<Record<string, unknown>>(d), projectId: projectIds[index] as string })),
    ),
    invoices: invoiceDocs.map((d) => asDoc(d)),
    receipts: receiptSnaps.flatMap((s, index) =>
      s.docs.map((d) => ({ ...asDoc<Record<string, unknown>>(d), invoiceId: (invoiceDocs[index] as { id: string }).id })),
    ),
    chaseSteps: stepSnaps.flatMap((s, index) =>
      s.docs.map((d) => ({ ...asDoc<Record<string, unknown>>(d), invoiceId: (invoiceDocs[index] as { id: string }).id })),
    ),
    vouchers: voucherDocs.map((d) => asDoc(d)),
    assignments: assignmentDocs.map((d) => asDoc(d)),
    tasks: uniqueById([...taskByContract.docs, ...taskByProject]).map((d) => asDoc(d)),
    units: unitDocs.map((d) => asDoc(d)),
    successor,
    staying: { callouts, visits },
    refs,
  };
}

/** The document references, kept beside the data so what is deleted is what was read. */
export interface JobRefs {
  terms: DocumentReference[];
  stages: DocumentReference[];
  receipts: DocumentReference[];
  chaseSteps: DocumentReference[];
  invoices: DocumentReference[];
  vouchers: DocumentReference[];
  assignments: DocumentReference[];
  tasks: DocumentReference[];
  projects: DocumentReference[];
  units: DocumentReference[];
}

export interface BackupInfo {
  fileStem: string;
  contentSha256: string;
}

type Write = (batch: WriteBatch) => void;

/**
 * Everything the removal does except the contract and the record, leaves first.
 * The lifts are re-pointed before their projects go, so a lift is never left
 * naming a project that no longer exists.
 */
function removalWrites(job: ArchiveJob & { refs: JobRefs }, contractNo: string, uid: string): Write[] {
  const writes: Write[] = [];
  for (const unit of job.refs.units) {
    writes.push((b) =>
      b.update(unit, { installedByProjectId: null, installedUnderContractNo: contractNo, ...stampUpdate(uid) }),
    );
  }
  const leafFirst: DocumentReference[][] = [
    job.refs.receipts, job.refs.chaseSteps, job.refs.stages, job.refs.invoices, job.refs.vouchers,
    job.refs.assignments, job.refs.tasks, job.refs.projects, job.refs.terms,
  ];
  for (const refs of leafFirst) for (const ref of refs) writes.push((b) => b.delete(ref));
  return writes;
}

/** The record of what was removed — figures and numbers, not the job itself. */
export function archiveRecordFor(
  job: ArchiveJob,
  verdict: ArchiveVerdict,
  backup: BackupInfo,
  status: ArchiveRecord['status'],
): Omit<ArchiveRecord, 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'> {
  const c = job.contract.data as unknown as Contract;
  return {
    contractId: job.contract.id,
    contractNo: c.contractNo,
    title: c.title,
    clientId: c.clientId,
    clientName: c.clientName,
    contractType: c.type,
    valueNetSantim: c.valueNetSantim,
    valueGrossSantim: c.valueGrossSantim,
    startDate: c.startDate,
    endDate: c.endDate,
    followedBy: job.successor === null ? null : { contractId: job.successor.id, contractNo: job.successor.contractNo },
    serviceDeclined: c.serviceDeclined === true,
    projectNos: job.projects.map((p) => p.data.projectNo),
    removed: Object.fromEntries(verdict.removes.map((r) => [r.label, r.count])),
    invoiceNumbers: verdict.invoiceNumbers,
    invoicedNetSantim: verdict.totals.invoicedNetSantim,
    invoicedVatSantim: verdict.totals.invoicedVatSantim,
    invoicedGrossSantim: verdict.totals.invoicedGrossSantim,
    receivedGrossSantim: verdict.totals.receivedGrossSantim,
    backup,
    status,
  };
}

/**
 * Remove the job and write its record.
 *
 * A job that fits in one write is removed atomically, record and all: either
 * the app has the job or it has the record, never neither and never both. A
 * larger one is removed in steps, with the record written first as `removing`
 * and flipped to `done` in the same write as the contract's deletion, so an
 * interruption leaves something that says it is unfinished and can be finished.
 */
export async function removeJob(
  job: ArchiveJob & { refs: JobRefs },
  verdict: ArchiveVerdict,
  backup: BackupInfo,
  uid: string,
): Promise<void> {
  const contractRef = doc(db, 'contracts', job.contract.id);
  const recordRef = doc(db, ARCHIVES, archiveIdFor(job.contract.id));
  const writes = removalWrites(job, job.contract.data.contractNo, uid);

  if (writes.length + 2 <= BATCH_SIZE) {
    const batch = writeBatch(db);
    batch.set(recordRef, { ...archiveRecordFor(job, verdict, backup, 'done'), ...stampCreate(uid) });
    for (const write of writes) write(batch);
    batch.delete(contractRef);
    await batch.commit();
    return;
  }

  const first = writeBatch(db);
  first.set(recordRef, { ...archiveRecordFor(job, verdict, backup, 'removing'), ...stampCreate(uid) });
  await first.commit();
  await finishRemoval(job, uid, writes);
}

/**
 * Carry on a removal that was interrupted.
 *
 * Re-reads what is left of the job and removes it. No fingerprint comparison:
 * part of the job is already gone, so the comparison would fail, and the backup
 * it would be compared against was already confirmed before anything was
 * deleted.
 */
export async function finishInterruptedRemoval(contractId: string, uid: string): Promise<void> {
  const job = await loadJob(contractId);
  if (job === null) throw new Error('That contract is already gone — nothing is left to remove.');
  await finishRemoval(job, uid, removalWrites(job, job.contract.data.contractNo, uid));
}

async function finishRemoval(
  job: ArchiveJob & { refs: JobRefs },
  uid: string,
  writes: readonly Write[],
): Promise<void> {
  for (const group of chunks(writes, BATCH_SIZE)) {
    const batch = writeBatch(db);
    for (const write of group) write(batch);
    await batch.commit();
  }
  const last = writeBatch(db);
  last.delete(doc(db, 'contracts', job.contract.id));
  last.update(doc(db, ARCHIVES, archiveIdFor(job.contract.id)), { status: 'done', ...stampUpdate(uid) });
  await last.commit();
}

export function subscribeArchives(
  onData: (rows: WithId<ArchiveRecord>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<ArchiveRecord>(query(collectionRef(ARCHIVES), orderBy('createdAt', 'desc')), onData, onError);
}
