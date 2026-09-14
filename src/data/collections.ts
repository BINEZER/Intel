/**
 * The chase log: who asked, when the letter landed, what they promised.
 *
 * Steps are APPEND-ONLY. The record of what a client said on a date is exactly
 * the thing an escalation — or a lawyer — later rests on, and a log that can be
 * tidied up afterwards is not evidence of anything. The security rules refuse
 * updates and deletes outright, so this is not merely a convention.
 */

import { doc, orderBy, query, writeBatch } from 'firebase/firestore';
import type { CollectionStep, Invoice } from '../lib/schema.js';
import type { ChaseStep } from '../lib/collection-chase.js';
import { getReceipts } from './invoices.js';
import { stampCreate, stripReserved } from './audit.js';
import { collectionRef, getMany, newId, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const INVOICES = 'invoices';
const stepPath = (invoiceId: string) => `${INVOICES}/${invoiceId}/collectionSteps`;

export type CollectionStepInput = Omit<
  CollectionStep,
  'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'
>;

export function subscribeCollectionSteps(
  invoiceId: string,
  onData: (rows: WithId<CollectionStep>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<CollectionStep>(
    query(collectionRef(stepPath(invoiceId)), orderBy('at.at')),
    onData,
    onError,
  );
}

export function getCollectionSteps(invoiceId: string) {
  return getMany<CollectionStep>(query(collectionRef(stepPath(invoiceId)), orderBy('at.at')));
}

/**
 * Record a chase step.
 *
 * A promise with no date is not a promise — it is a brush-off, and recording it
 * as one means the invoice sits in "promised" for ever waiting on a date that
 * will never arrive.
 */
export async function recordCollectionStep(
  invoiceId: string,
  input: CollectionStepInput,
  uid: string,
): Promise<string> {
  if (input.action === 'promise_to_pay' && input.promisedDate === undefined) {
    throw new Error('A promise needs a date. Without one it is not a promise, and nothing will ever chase it.');
  }
  if (input.contactName.trim() === '') {
    throw new Error('Record who you spoke to — a chase step with no name on it cannot be followed up.');
  }

  const id = newId(stepPath(invoiceId));
  const batch = writeBatch(db);
  batch.set(doc(db, stepPath(invoiceId), id), { ...stripReserved(input), ...stampCreate(uid) });
  await batch.commit();
  return id;
}

/** Convert a stored step into the shape the chase logic works on. */
export function toChaseStep(step: WithId<CollectionStep>): ChaseStep {
  return {
    id: step.id,
    action: step.action,
    at: step.at.at.toDate(),
    byName: step.byName,
    contactName: step.contactName,
    note: step.note,
    ...(step.promisedAmountSantim === undefined ? {} : { promisedAmountSantim: step.promisedAmountSantim }),
    ...(step.promisedDate === undefined ? {} : { promisedDate: step.promisedDate.at.toDate() }),
    ...(step.deliveryRef === undefined ? {} : { deliveryRef: step.deliveryRef }),
  };
}

export interface InvoiceChaseData {
  invoiceId: string;
  steps: ChaseStep[];
  receipts: { at: Date; amountSantim: number }[];
}

/**
 * Load the chase log and the receipts for a set of invoices.
 *
 * Both are subcollections, and both are needed together: whether a promise was
 * kept depends on money arriving AFTER the promise was made, which no query over
 * the invoice alone can answer.
 */
export async function loadChaseData(
  invoices: readonly WithId<Invoice>[],
  limit = 10,
): Promise<Map<string, InvoiceChaseData>> {
  const chaseable = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');
  const out = new Map<string, InvoiceChaseData>();
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const invoice = chaseable[index];
      if (invoice === undefined) return;

      const [steps, receipts] = await Promise.all([
        getCollectionSteps(invoice.id),
        getReceipts(invoice.id),
      ]);

      out.set(invoice.id, {
        invoiceId: invoice.id,
        steps: steps.map(toChaseStep),
        receipts: receipts.map((r) => ({ at: r.receivedDate.at.toDate(), amountSantim: r.amountGrossSantim })),
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, chaseable.length) }, worker));
  return out;
}
