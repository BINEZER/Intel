/**
 * Project financial roll-up — the Firestore side.
 *
 * Fetches a project's invoices (with their receipts) and disbursements, runs the
 * pure computation from `src/lib/rollup.ts`, and stamps the result onto
 * `project.financials` so the dashboard reads ONE document instead of
 * aggregating hundreds on every render.
 */

import { getDocs, doc, query, Timestamp, where, writeBatch } from 'firebase/firestore';
import type { Contract, Disbursement, Invoice, Project } from '../lib/schema.js';
import { computeRollup, type ProjectRollup } from '../lib/rollup.js';
import { stampUpdate } from './audit.js';
import { collectionRef } from './repository.js';
import { db } from '../firebase.js';

export { computeRollup, type ProjectRollup };

/**
 * Fetch a project's invoices (with their receipts) and disbursements, compute
 * the roll-up, and stamp it onto the project document.
 *
 * Intended for a Cloud Function on invoice and disbursement writes; runs from
 * the client meanwhile so the figures are never more than a refresh stale.
 */
export async function refreshProjectFinancials(
  projectId: string,
  contract: Pick<Contract, 'valueNetSantim' | 'vatSantim' | 'valueGrossSantim'> | null,
  uid: string,
): Promise<ProjectRollup> {
  const [invoiceDocs, disbursementDocs] = await Promise.all([
    getDocs(query(collectionRef('invoices'), where('projectId', '==', projectId))),
    getDocs(query(collectionRef('disbursements'), where('projectId', '==', projectId))),
  ]);

  const invoices = await Promise.all(
    invoiceDocs.docs.map(async (invoiceDoc) => {
      const receiptDocs = await getDocs(collectionRef(`invoices/${invoiceDoc.id}/receipts`));
      const data = invoiceDoc.data() as Invoice;
      return {
        netSantim: data.netSantim,
        grossSantim: data.grossSantim,
        status: data.status,
        receipts: receiptDocs.docs.map((r) => {
          const receipt = r.data() as { amountGrossSantim: number; clientWhtSantim?: number };
          return {
            amountGrossSantim: receipt.amountGrossSantim,
            clientWhtSantim: receipt.clientWhtSantim ?? 0,
          };
        }),
      };
    }),
  );

  const disbursements = disbursementDocs.docs.map((d) => d.data() as Disbursement);
  const rollup = computeRollup(contract, invoices, disbursements);

  const batch = writeBatch(db);
  batch.update(doc(db, 'projects', projectId), {
    financials: {
      contractNetSantim: rollup.contractNetSantim,
      contractVatSantim: rollup.contractVatSantim,
      contractGrossSantim: rollup.contractGrossSantim,
      invoicedNetSantim: rollup.invoicedNetSantim,
      collectedGrossSantim: rollup.collectedGrossSantim,
      subcontractCostNetSantim: rollup.subcontractCostNetSantim,
      subcontractInputVatSantim: rollup.subcontractInputVatSantim,
      whtWithheldSantim: rollup.whtWithheldSantim,
      cashDisbursedSantim: rollup.cashDisbursedSantim,
      grossMarginSantim: rollup.grossMarginSantim,
      grossMarginBps: rollup.grossMarginBps,
      lastComputedAt: Timestamp.now(),
    } satisfies Project['financials'],
    ...stampUpdate(uid),
  });
  await batch.commit();

  return rollup;
}
