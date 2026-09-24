/**
 * Record the workbook's payments against contracts the app already holds.
 *
 * The rules, and why each exists, are in `lib/payment-backfill.ts`. This is the
 * Firestore half: read each contract's terms, ask what may be done, write only
 * that, and report the rest by name.
 */

import { Timestamp, doc, getDoc, getDocs, orderBy, query, writeBatch } from 'firebase/firestore';
import { db } from '../firebase.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { stampUpdate } from './audit.js';
import { collectionRef } from './repository.js';
import {
  describePaymentBackfill,
  scheduleMatches,
  verdictFor,
  type PaymentBackfillResult,
  type PlannedTerm,
  type StoredTerm,
} from '../lib/payment-backfill.js';
import type { ImportPlan } from '../lib/import-master.js';

export interface PaymentBackfillProgress {
  stage: string;
  examined: number;
  total: number;
}

/** Same id derivation as the importer: a re-run must land on the same contract. */
function contractIdFor(key: string): string {
  return `im-k-${key}`;
}

export async function backfillPayments(
  plan: ImportPlan,
  uid: string,
  onProgress: (progress: PaymentBackfillProgress) => void,
): Promise<PaymentBackfillResult & { said: string }> {
  // Only contracts the workbook actually has a receipt for. A contract with
  // nothing collected has nothing to apply and should not even be read.
  const withPayments = plan.contracts.filter((contract) =>
    contract.milestones.some((milestone) => milestone.paid),
  );

  const result: PaymentBackfillResult = {
    examined: 0,
    updated: 0,
    termsSettled: 0,
    santimSettled: 0,
    termsProtected: 0,
    notInApp: [],
    scheduleChanged: [],
    alreadyDone: 0,
  };

  let batch = writeBatch(db);
  let queued = 0;
  const flush = async (): Promise<void> => {
    if (queued === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    queued = 0;
  };

  for (const contract of withPayments) {
    result.examined += 1;
    onProgress({ stage: 'Contracts', examined: result.examined, total: withPayments.length });

    const id = contractIdFor(contract.key);
    const snapshot = await getDoc(doc(db, 'contracts', id));
    if (!snapshot.exists()) {
      // Not an error: the import creates it, and creating it writes the
      // schedule with the payments already on it.
      result.notInApp.push(contract.contractNo);
      continue;
    }

    const termDocs = await getDocs(
      query(collectionRef(`contracts/${id}/milestones`), orderBy('seq')),
    );
    const stored: Array<StoredTerm & { docId: string }> = termDocs.docs.map((termDoc) => {
      const data = termDoc.data() as Partial<StoredTerm>;
      return {
        docId: termDoc.id,
        seq: typeof data.seq === 'number' ? data.seq : 0,
        name: typeof data.name === 'string' ? data.name : '',
        grossSantim: typeof data.grossSantim === 'number' ? data.grossSantim : 0,
        status: data.status ?? 'pending',
        ...(data.invoiceId === undefined ? {} : { invoiceId: data.invoiceId }),
      };
    });

    const planned: PlannedTerm[] = contract.milestones.map((milestone, index) => ({
      seq: index + 1,
      name: milestone.name,
      paid: milestone.paid === true,
    }));
    const paidOnBySeq = new Map(
      contract.milestones.map((milestone, index) => [index + 1, milestone.paidOn]),
    );

    if (!scheduleMatches(stored, planned)) {
      result.scheduleChanged.push(contract.contractNo);
      continue;
    }

    const bySeq = new Map(stored.map((term) => [term.seq, term]));
    let settledHere = 0;
    for (const term of planned) {
      const found = bySeq.get(term.seq);
      if (found === undefined) continue;
      const verdict = verdictFor(found, term);
      if (verdict === 'protected') {
        result.termsProtected += 1;
        continue;
      }
      if (verdict !== 'settle') continue;

      // The date goes on with the settlement where the tracker recorded one.
      // Where it did not, the field is left alone rather than set to null: this
      // pass is additive, and a date somebody typed in the app is worth more
      // than the workbook's silence.
      const arrived = paidOnBySeq.get(term.seq) ?? null;
      batch.update(doc(db, `contracts/${id}/milestones`, found.docId), {
        status: 'paid',
        ...(arrived === null
          ? {}
          : { paidOn: dualDateFromGregorian(arrived, (d) => Timestamp.fromDate(d)) }),
        ...stampUpdate(uid),
      });
      queued += 1;
      settledHere += 1;
      result.termsSettled += 1;
      result.santimSettled += found.grossSantim;
      // Firestore takes 500 writes to a batch; stay well inside it.
      if (queued >= 400) await flush();
    }

    if (settledHere > 0) result.updated += 1;
    else result.alreadyDone += 1;
  }

  await flush();
  return { ...result, said: describePaymentBackfill(result) };
}
