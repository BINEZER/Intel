/**
 * Subcontractor disbursement repository — the WHT side.
 *
 * Every figure is computed by `computeDisbursement`, never taken from a form.
 * The security rules re-check that WHT sits on the VAT-exclusive base and that
 * net payable equals gross less WHT, so a disbursement that does not reconcile
 * is refused by the database itself.
 */

import { deleteDoc, doc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore';
import type { Disbursement, DualDate, Subcontractor } from '../lib/schema.js';
import { computeDisbursement, type WhtCategory } from '../lib/money.js';
import { gregorianPeriodKey, periodKeyFor } from '../lib/returns.js';
import { stampCreate, stampUpdate } from './audit.js';
import { nextSequence } from './counters.js';
import { collectionRef, getOne, newId, subscribe, type WithId } from './repository.js';
import { formatInvoiceNo } from '../lib/invoicing.js';
import { db } from '../firebase.js';
import { setDoc } from 'firebase/firestore';

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
    whtRemittedDate: null,
    status: 'draft',
    whtPeriodEc: periodKeyFor(invoiceDate),
    whtPeriodGc: gregorianPeriodKey(invoiceDate),
    ...stampCreate(uid),
  });

  return { id, voucherNo };
}

export async function approveDisbursement(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { status: 'approved', approvedBy: uid, ...stampUpdate(uid) });
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
    paymentDate: details.paymentDate,
    ...(details.paymentMethod === undefined ? {} : { paymentMethod: details.paymentMethod }),
    ...(details.bankRef === undefined ? {} : { bankRef: details.bankRef }),
    ...(whtCertificateNo === null ? {} : { whtCertificateNo }),
    ...stampUpdate(uid),
  });

  return { whtCertificateNo };
}

export async function rejectDisbursement(id: string, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, id), { status: 'rejected', ...stampUpdate(uid) });
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
