/**
 * Invoice and receipt repository.
 *
 * An issued invoice is a tax document. The rules make its number, net and VAT
 * immutable once issued; this layer keeps the status and settlement fields in
 * step with the receipts underneath them.
 */

import {
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import type { DualDate, Invoice, Receipt } from '../lib/schema.js';
import {
  deriveInvoiceStatus,
  formatInvoiceNo,
  settle,
  totalInvoice,
  type InvoiceLineInput,
} from '../lib/invoicing.js';
import { gregorianPeriodKey, periodKeyFor } from '../lib/returns.js';
import { termStatusAfterSettlement } from '../lib/payment-backfill.js';
import { stampCreate, stampUpdate, stripReserved } from './audit.js';
import { nextSequence } from './counters.js';
import { collectionRef, getMany, getOne, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'invoices';
const receiptPath = (invoiceId: string) => `${PATH}/${invoiceId}/receipts`;

export interface CreateInvoiceInput {
  clientId: string;
  clientName: string;
  clientTin: string;
  contractId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  issueDate: DualDate;
  dueDate: DualDate;
  lines: readonly InvoiceLineInput[];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function subscribeInvoices(
  onData: (rows: WithId<Invoice>[]) => void,
  onError: (error: Error) => void,
  options: { status?: Invoice['status']; projectId?: string } = {},
) {
  let q = query(collectionRef(PATH), orderBy('issueDate.at', 'desc'));
  if (options.projectId !== undefined) {
    q = query(collectionRef(PATH), where('projectId', '==', options.projectId), orderBy('issueDate.at', 'desc'));
  } else if (options.status !== undefined) {
    q = query(collectionRef(PATH), where('status', '==', options.status), orderBy('dueDate.at'));
  }
  return subscribe<Invoice>(q, onData, onError);
}

/** Every invoice in one Ethiopian month — the VAT return query. */
export function subscribeInvoicesForPeriod(
  periodEc: string,
  onData: (rows: WithId<Invoice>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<Invoice>(
    query(collectionRef(PATH), where('vatPeriodEc', '==', periodEc), orderBy('issueDate.at')),
    onData,
    onError,
  );
}

export function getInvoice(id: string) {
  return getOne<Invoice>(PATH, id);
}

export function getReceipts(invoiceId: string) {
  return getMany<Receipt>(query(collectionRef(receiptPath(invoiceId)), orderBy('receivedDate.at')));
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a draft invoice.
 *
 * Totals are computed here from the lines rather than accepted from the caller,
 * so the reconciliation the security rules enforce (`gross == net + vat`) can
 * never fail for an arithmetic reason. The number is NOT assigned yet — a draft
 * has no tax significance, and burning sequence numbers on abandoned drafts
 * would leave gaps nobody can explain.
 */
export async function createDraftInvoice(input: CreateInvoiceInput, uid: string): Promise<string> {
  const totals = totalInvoice(input.lines);
  const issuedAt = input.issueDate.at.toDate();

  const ref = await addDoc(collectionRef(PATH), {
    invoiceNo: '',
    clientId: input.clientId,
    clientName: input.clientName,
    clientTin: input.clientTin,
    contractId: input.contractId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: 'ETB',
    lines: totals.lines.map((line) => ({
      description: line.description,
      qty: line.qty,
      unitNetSantim: line.unitNetSantim,
      lineNetSantim: line.lineNetSantim,
      vatRateBps: line.vatRateBps,
    })),
    netSantim: totals.netSantim,
    // A mixed-rate invoice has no single header rate; 0 would be a lie, so the
    // dominant-rate field records the blended reality only when lines agree.
    vatRateBps: totals.vatRateBps ?? 0,
    vatSantim: totals.vatSantim,
    grossSantim: totals.grossSantim,
    paidGrossSantim: 0,
    balanceGrossSantim: totals.grossSantim,
    status: 'draft',
    vatPeriodEc: periodKeyFor(issuedAt),
    vatPeriodGc: gregorianPeriodKey(issuedAt),
    ...stampCreate(uid),
  });

  return ref.id;
}

/**
 * Issue a draft: assign the sequential number and lock the tax figures.
 *
 * The number is claimed from a transactional counter at this moment and not
 * before, so the sequence follows the order invoices were actually issued.
 */
export async function issueInvoice(invoiceId: string, uid: string, prefix = 'INV'): Promise<string> {
  const sequence = await nextSequence('invoice');
  const invoiceNo = formatInvoiceNo(prefix, sequence);
  await updateDoc(doc(db, PATH, invoiceId), { invoiceNo, status: 'issued', ...stampUpdate(uid) });
  // The contract's own schedule has to hear about it, or the term it bills stays
  // "pending" for ever. See `settleTermFor` below.
  await markTerm(invoiceId, 'invoiced', null, uid);
  return invoiceNo;
}

/**
 * Tell a contract's payment term what its invoice has done.
 *
 * THE GAP THIS CLOSES
 *   An invoice records which term it bills, and nothing ever told the term. So a
 *   client could be invoiced and pay in full while the contract still showed
 *   every term open — the schedule only ever reflected what the workbook import
 *   had said, and drifted from the truth from the first invoice onwards.
 *
 * WHY IT IS BEST-EFFORT
 *   The money is already recorded by the time this runs: the invoice and its
 *   receipt are the financial record, and the term's status is a convenience on
 *   top of them. If this write fails — the term was deleted, the schedule was
 *   rebuilt, a rule refuses it — the invoice must still stand. So it is not in
 *   the receipt's batch and it does not throw; a term that falls behind its
 *   invoice is a display problem, and losing a receipt is not.
 */
async function markTerm(
  invoiceId: string,
  status: 'invoiced' | 'part_paid' | 'paid',
  money: { receivedGrossSantim: number; paidOn: DualDate | null } | null,
  uid: string,
): Promise<void> {
  try {
    const invoice = await getOne<Invoice>(PATH, invoiceId);
    if (invoice === null) return;
    const { contractId, milestoneId } = invoice;
    if (contractId === null || milestoneId === null || milestoneId === '') return;
    await updateDoc(doc(db, `contracts/${contractId}/milestones`, milestoneId), {
      status,
      invoiceId,
      ...(money === null
        ? {}
        : {
            receivedGrossSantim: money.receivedGrossSantim,
            // The date goes on only once the term is fully settled: on a part
            // payment it would read as "paid on" a day the term was not.
            ...(status === 'paid' && money.paidOn !== null ? { paidOn: money.paidOn } : {}),
          }),
      ...stampUpdate(uid),
    });
  } catch {
    // Deliberately swallowed, for the reason above.
  }
}

/**
 * Record a receipt and re-derive the invoice's settlement in one batch.
 *
 * `clientWhtSantim` is withholding the CLIENT deducted and remitted to ERCA on
 * our behalf. It settles the invoice without arriving as cash — recording it as
 * an unpaid balance would mean chasing money nobody owes.
 */
export async function recordReceipt(
  invoiceId: string,
  invoice: Pick<Invoice, 'grossSantim' | 'status' | 'dueDate'>,
  receipt: {
    receivedDate: DualDate;
    amountGrossSantim: number;
    method: Receipt['method'];
    bankRef?: string;
    clientWhtSantim: number;
    clientWhtCertificateNo?: string;
  },
  uid: string,
): Promise<void> {
  const existing = await getReceipts(invoiceId);
  const all = [
    ...existing.map((r) => ({
      amountGrossSantim: r.amountGrossSantim,
      clientWhtSantim: r.clientWhtSantim ?? 0,
    })),
    { amountGrossSantim: receipt.amountGrossSantim, clientWhtSantim: receipt.clientWhtSantim },
  ];

  const settlement = settle(invoice.grossSantim, all);
  const status = deriveInvoiceStatus(
    invoice.status,
    settlement,
    invoice.dueDate.at.toDate(),
    new Date(),
  );

  const batch = writeBatch(db);
  batch.set(doc(collectionRef(receiptPath(invoiceId))), {
    receivedDate: receipt.receivedDate,
    amountGrossSantim: receipt.amountGrossSantim,
    method: receipt.method,
    ...(receipt.bankRef === undefined ? {} : { bankRef: receipt.bankRef }),
    clientWhtSantim: receipt.clientWhtSantim,
    ...(receipt.clientWhtCertificateNo === undefined
      ? {}
      : { clientWhtCertificateNo: receipt.clientWhtCertificateNo }),
    ...stampCreate(uid),
  });

  batch.update(doc(db, PATH, invoiceId), {
    paidGrossSantim: settlement.paidGrossSantim,
    balanceGrossSantim: settlement.balanceSantim,
    status,
    ...stampUpdate(uid),
  });

  await batch.commit();

  /*
   * Tell the contract's term what happened, with the money.
   *
   * A part payment makes the term `part_paid`, not `invoiced`: the client HAS
   * paid something and the term should say so. What it must not do is close the
   * term — the remainder is still owed and still has to be chased.
   */
  await markTerm(
    invoiceId,
    termStatusAfterSettlement(settlement.balanceSantim, settlement.paidGrossSantim),
    { receivedGrossSantim: settlement.paidGrossSantim, paidOn: receipt.receivedDate },
    uid,
  );
}

/**
 * Void an issued invoice.
 *
 * Voiding preserves the number and the figures — an issued invoice is never
 * deleted, because the sequence must stay explicable. Only a draft can be
 * removed outright.
 */
export async function voidInvoice(invoiceId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, PATH, invoiceId), { status: 'void', ...stampUpdate(uid) });
}

export async function updateDraftInvoice(
  invoiceId: string,
  input: Partial<CreateInvoiceInput>,
  uid: string,
): Promise<void> {
  const patch: Record<string, unknown> = { ...stripReserved(input as Record<string, unknown>) };
  if (input.lines !== undefined) {
    const totals = totalInvoice(input.lines);
    patch['lines'] = totals.lines;
    patch['netSantim'] = totals.netSantim;
    patch['vatSantim'] = totals.vatSantim;
    patch['grossSantim'] = totals.grossSantim;
    patch['balanceGrossSantim'] = totals.grossSantim;
    patch['vatRateBps'] = totals.vatRateBps ?? 0;
  }
  await updateDoc(doc(db, PATH, invoiceId), { ...patch, ...stampUpdate(uid) });
}

export async function deleteDraftInvoice(invoiceId: string): Promise<void> {
  const receipts = await getDocs(collectionRef(receiptPath(invoiceId)));
  const batch = writeBatch(db);
  for (const receipt of receipts.docs) batch.delete(receipt.ref);
  await batch.commit();
  await deleteDoc(doc(db, PATH, invoiceId));
}

/** Marks overdue invoices, for a nightly pass. */
export async function refreshOverdue(uid: string, asOf: Date = new Date()): Promise<number> {
  const snapshot = await getDocs(
    query(collectionRef(PATH), where('status', 'in', ['issued', 'partially_paid'])),
  );
  const batch = writeBatch(db);
  let count = 0;
  for (const docSnapshot of snapshot.docs) {
    const invoice = docSnapshot.data() as Invoice;
    if (invoice.dueDate.at.toDate() < asOf && invoice.balanceGrossSantim > 0) {
      batch.update(docSnapshot.ref, { status: 'overdue', ...stampUpdate(uid) });
      count++;
    }
  }
  if (count > 0) await batch.commit();
  return count;
}
