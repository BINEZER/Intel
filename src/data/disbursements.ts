/**
 * Subcontractor disbursement repository — the WHT side.
 *
 * Every figure is computed by `computeDisbursement`, never taken from a form.
 * The security rules re-check that WHT sits on the VAT-exclusive base and that
 * net payable equals gross less WHT, so a disbursement that does not reconcile
 * is refused by the database itself.
 */

import { deleteDoc, doc, getDocs, orderBy, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import type { Disbursement, DualDate, Role, Subcontractor } from '../lib/schema.js';
import { availableTransitions, type PayoutStatus } from '../lib/payout-workflow.js';
import { computeDisbursement, type WhtCategory } from '../lib/money.js';
import { gregorianPeriodKey, periodKeyFor } from '../lib/returns.js';
import { stampCreate, stampUpdate } from './audit.js';
import { nextSequence } from './counters.js';
import { collectionRef, getOne, newId, subscribe, type WithId } from './repository.js';
import { formatInvoiceNo } from '../lib/invoicing.js';
import { db } from '../firebase.js';

const PATH = 'disbursements';

export interface CreateDisbursementInput {
  subcontractor: Pick<WithId<Subcontractor>, 'id' | 'name' | 'tin' | 'hasTin' | 'vatRegistered'>;
  projectId: string;
  phaseId: string;
  phaseName: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate: DualDate;
  /** VAT-exclusive base from the subcontractor's invoice. */
  netSantim: number;
  whtCategory: WhtCategory;
  /**
   * Set when the supplier invoiced in a foreign currency. `netSantim` above is
   * already its ETB equivalent — this records what was actually billed and the
   * rate that produced the ETB figure, so the conversion stays reproducible
   * after the birr moves.
   */
  foreign?: { currency: 'ETB' | 'USD'; amount: number; rateMicros: number; rateSource: string };
  /** Override the statutory rate when the subcontract sets one. */
  overrideWhtRateBps?: number;
  vatRateBps?: number;
  thresholds?: { goodsSantim: number; servicesSantim: number };
}

export function subscribeDisbursements(
  onData: (rows: WithId<Disbursement>[]) => void,
  onError: (error: Error) => void,
  options: { projectId?: string; status?: Disbursement['status'] } = {},
) {
  let q = query(collectionRef(PATH), orderBy('supplierInvoiceDate.at', 'desc'));
  if (options.projectId !== undefined) {
    q = query(
      collectionRef(PATH),
      where('projectId', '==', options.projectId),
      orderBy('phaseId'),
      orderBy('paymentDate.at'),
    );
  } else if (options.status !== undefined) {
    q = query(collectionRef(PATH), where('status', '==', options.status), orderBy('supplierInvoiceDate.at', 'desc'));
  }
  return subscribe<Disbursement>(q, onData, onError);
}

/** Every disbursement in one Ethiopian month — the WHT return query. */
export function subscribeDisbursementsForPeriod(
  periodEc: string,
  onData: (rows: WithId<Disbursement>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Disbursement>(
    query(collectionRef(PATH), where('whtPeriodEc', '==', periodEc), where('status', 'in', ['approved', 'paid'])),
    onData,
    onError,
  );
}

export function getDisbursement(id: string) {
  return getOne<Disbursement>(PATH, id);
}

/**
 * Create a draft payment voucher with every tax figure derived.
 *
 * Nothing here is trusted from the UI: the caller supplies the supplier's net
 * invoice amount and category, and the WHT engine decides the rest — including
 * the 30% penalty rate when the supplier cannot produce a TIN.
 */
export async function createDisbursement(
  input: CreateDisbursementInput,
  uid: string,
): Promise<{ id: string; voucherNo: string }> {
  const breakdown = computeDisbursement({
    netSantim: input.netSantim,
    category: input.whtCategory,
    supplierVatRegistered: input.subcontractor.vatRegistered,
    supplierHasTin: input.subcontractor.hasTin,
    ...(input.overrideWhtRateBps === undefined ? {} : { overrideWhtRateBps: input.overrideWhtRateBps }),
    ...(input.vatRateBps === undefined ? {} : { vatRateBps: input.vatRateBps }),
    ...(input.thresholds === undefined ? {} : { thresholds: input.thresholds }),
  });

  const voucherNo = formatInvoiceNo('PV', await nextSequence('disbursement'));
  const invoiceDate = input.supplierInvoiceDate.at.toDate();
  const id = newId(PATH);

  await setDoc(doc(db, PATH, id), {
    voucherNo,
    subcontractorId: input.subcontractor.id,
    subcontractorName: input.subcontractor.name,
    subcontractorTin: input.subcontractor.tin,
    projectId: input.projectId,
    phaseId: input.phaseId,
    phaseName: input.phaseName,
    supplierInvoiceNo: input.supplierInvoiceNo,
    supplierInvoiceDate: input.supplierInvoiceDate,
    paymentDate: null,
    currency: 'ETB',
    netSantim: breakdown.netSantim,
    vatRateBps: breakdown.vatRateBps,
    supplierVatSantim: breakdown.supplierVatSantim,
    grossSantim: breakdown.grossSantim,
    whtCategory: breakdown.whtCategory,
    whtRateBps: breakdown.whtRateBps,
    whtBaseSantim: breakdown.whtBaseSantim,
    whtSantim: breakdown.whtSantim,
    netPayableSantim: breakdown.netPayableSantim,
    ...(breakdown.whtExemptReason === undefined ? {} : { whtExemptReason: breakdown.whtExemptReason }),
    ...(input.foreign === undefined
      ? {}
      : { foreign: { ...input.foreign, rateDate: input.supplierInvoiceDate.at } }),
    whtRemittedDate: null,
    status: 'draft',
    workflow: EMPTY_WORKFLOW,
    whtPeriodEc: periodKeyFor(invoiceDate),
    whtPeriodGc: gregorianPeriodKey(invoiceDate),
    ...stampCreate(uid),
  });

  return { id, voucherNo };
}

const EMPTY_WORKFLOW = {
  requestedAt: null, requestedBy: null,
  checkedAt: null, checkedBy: null,
  approvedAt: null, approvedBy: null,
  paidAt: null, paidBy: null,
  rejectedAt: null, rejectedBy: null,
  heldAt: null, heldBy: null,
  reason: null,
};

/**
 * Move a voucher along the payout workflow.
 *
 * The transition is validated against `availableTransitions` FIRST, using the
 * stamps already on the record. That is what enforces separation of duties: the
 * person who confirmed the work happened may not release the money for it, and
 * a client that has simply hidden the button is not enforcement.
 *
 * Every step writes its own timestamp and actor. Waiting time is read from
 * those, never from `updatedAt`, which moves whenever anyone touches the record.
 */
export async function advanceDisbursement(
  id: string,
  to: PayoutStatus,
  actor: { uid: string; role: Role | null },
  options: { reason?: string } = {},
): Promise<void> {
  const current = await getDisbursement(id);
  if (current === null) throw new Error('That payment voucher no longer exists.');

  const workflow = { ...EMPTY_WORKFLOW, ...(current.workflow ?? {}) };
  const context = {
    uid: actor.uid,
    role: actor.role,
    actors: {
      ...(workflow.requestedBy === null ? {} : { requested: workflow.requestedBy }),
      ...(workflow.checkedBy === null ? {} : { checked: workflow.checkedBy }),
      ...(workflow.approvedBy === null ? {} : { approved: workflow.approvedBy }),
    },
  };

  const transition = availableTransitions(current.status, context).find((t) => t.to === to);
  if (transition === undefined) {
    throw new Error(`A voucher that is ${current.status} cannot go straight to ${to}.`);
  }
  if (transition.blockedBy !== null) throw new Error(transition.blockedBy);

  // A rejection or a hold with no reason is a dead end for whoever picks it up
  // next, so the reason is required rather than merely invited.
  if ((to === 'rejected' || to === 'on_hold') && (options.reason ?? '').trim() === '') {
    throw new Error(`Say why the voucher is being ${to === 'rejected' ? 'rejected' : 'put on hold'}.`);
  }

  const now = Timestamp.now();
  const stamp: Record<string, unknown> = { status: to, ...stampUpdate(actor.uid) };

  if (to === 'requested') { stamp['workflow.requestedAt'] = now; stamp['workflow.requestedBy'] = actor.uid; }
  if (to === 'checked')   { stamp['workflow.checkedAt'] = now;   stamp['workflow.checkedBy'] = actor.uid; }
  if (to === 'approved')  { stamp['workflow.approvedAt'] = now;  stamp['workflow.approvedBy'] = actor.uid; stamp['approvedBy'] = actor.uid; }
  if (to === 'rejected')  { stamp['workflow.rejectedAt'] = now;  stamp['workflow.rejectedBy'] = actor.uid; }
  if (to === 'on_hold')   { stamp['workflow.heldAt'] = now;      stamp['workflow.heldBy'] = actor.uid; }
  if (options.reason !== undefined) stamp['workflow.reason'] = options.reason.trim();
  // Releasing a hold clears the reason, so a stale explanation cannot linger on
  // a voucher that has moved on.
  if (to === 'checked' && current.status === 'on_hold') stamp['workflow.reason'] = null;

  await updateDoc(doc(db, PATH, id), stamp);
}

/** Kept for callers that only ever approve; the workflow path is preferred. */
export async function approveDisbursement(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), {
    status: 'approved',
    approvedBy: uid,
    'workflow.approvedAt': Timestamp.now(),
    'workflow.approvedBy': uid,
    ...stampUpdate(uid),
  });
}

/**
 * Mark a voucher paid and issue the withholding certificate.
 *
 * The certificate is the subcontractor's proof they can claim the credit, so it
 * is issued at payment rather than left to a month-end scramble — and only when
 * something was actually withheld.
 */
export async function payDisbursement(
  id: string,
  details: {
    paymentDate: DualDate;
    paymentMethod: Disbursement['paymentMethod'];
    bankRef?: string;
    whtSantim: number;
  },
  uid: string,
): Promise<{ whtCertificateNo: string | null }> {
  const whtCertificateNo =
    details.whtSantim > 0 ? formatInvoiceNo('WHT', await nextSequence('whtCertificate')) : null;

  await updateDoc(doc(db, PATH, id), {
    status: 'paid',
    'workflow.paidAt': Timestamp.now(),
    'workflow.paidBy': uid,
    paymentDate: details.paymentDate,
    ...(details.paymentMethod === undefined ? {} : { paymentMethod: details.paymentMethod }),
    ...(details.bankRef === undefined ? {} : { bankRef: details.bankRef }),
    ...(whtCertificateNo === null ? {} : { whtCertificateNo }),
    ...stampUpdate(uid),
  });

  return { whtCertificateNo };
}

export async function rejectDisbursement(id: string, uid: string, reason: string): Promise<void> {
  if (reason.trim() === '') throw new Error('Say why the voucher is being rejected.');
  await updateDoc(doc(db, PATH, id), {
    status: 'rejected',
    'workflow.rejectedAt': Timestamp.now(),
    'workflow.rejectedBy': uid,
    'workflow.reason': reason.trim(),
    ...stampUpdate(uid),
  });
}

export async function markWhtRemitted(id: string, remittedDate: DualDate, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { whtRemittedDate: remittedDate, ...stampUpdate(uid) });
}

export async function deleteDraftDisbursement(id: string): Promise<void> {
  await deleteDoc(doc(db, PATH, id));
}

/** All disbursements on a project, for the financial roll-up. */
export async function listProjectDisbursements(projectId: string): Promise<WithId<Disbursement>[]> {
  const snapshot = await getDocs(query(collectionRef(PATH), where('projectId', '==', projectId)));
  return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Disbursement) }));
}
