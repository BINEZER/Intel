/**
 * Project financial roll-up — the pure computation.
 *
 * This is what turns the priority board from a demo into a report: the derived
 * figures for a project, computed from the invoices and disbursements actually
 * written against it. Derived, never typed.
 *
 * Kept free of Firestore so it is testable in plain Node and can run against
 * either live data or a snapshot; `src/data/rollup.ts` does the fetching and
 * stamps the result onto the project document.
 */

import type { Contract, Disbursement, Invoice } from './schema.js';
import { rollUpProject, type DisbursementBreakdown, type VatBreakdown } from './money.js';
import { settle, type ReceiptInput } from './invoicing.js';

export interface ProjectRollup {
  contractNetSantim: number;
  contractVatSantim: number;
  contractGrossSantim: number;
  invoicedNetSantim: number;
  invoicedGrossSantim: number;
  collectedGrossSantim: number;
  outstandingGrossSantim: number;
  subcontractCostNetSantim: number;
  subcontractInputVatSantim: number;
  whtWithheldSantim: number;
  cashDisbursedSantim: number;
  grossMarginSantim: number;
  grossMarginBps: number;
  netVatPayableSantim: number;
}

/**
 * Compute the roll-up from already-fetched documents. Pure, so it is testable
 * and can run against either live data or a snapshot.
 */
export function computeRollup(
  contract: Pick<Contract, 'valueNetSantim' | 'vatSantim' | 'valueGrossSantim'> | null,
  invoices: readonly (Pick<Invoice, 'netSantim' | 'grossSantim' | 'status'> & {
    receipts: readonly ReceiptInput[];
  })[],
  disbursements: readonly Pick<
    Disbursement,
    'netSantim' | 'supplierVatSantim' | 'grossSantim' | 'whtBaseSantim' | 'whtSantim' | 'netPayableSantim' | 'whtCategory' | 'whtRateBps' | 'vatRateBps' | 'status'
  >[],
): ProjectRollup {
  const contractBreakdown: VatBreakdown = {
    netSantim: contract?.valueNetSantim ?? 0,
    vatRateBps: 1500,
    vatSantim: contract?.vatSantim ?? 0,
    grossSantim: contract?.valueGrossSantim ?? 0,
  };

  // Drafts and voids are not revenue and must not inflate what has been billed.
  const billed = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');

  let collectedGrossSantim = 0;
  let outstandingGrossSantim = 0;
  for (const invoice of billed) {
    const settlement = settle(invoice.grossSantim, invoice.receipts);
    // Client withholding settles the invoice but never arrives as cash, so it
    // counts toward settlement and not toward collections.
    collectedGrossSantim += settlement.paidGrossSantim;
    outstandingGrossSantim += settlement.balanceSantim;
  }

  // Only approved or paid vouchers are a committed cost.
  const committed = disbursements.filter((d) => d.status === 'approved' || d.status === 'paid');
  const breakdowns: DisbursementBreakdown[] = committed.map((d) => ({
    netSantim: d.netSantim,
    vatRateBps: d.vatRateBps,
    supplierVatSantim: d.supplierVatSantim,
    grossSantim: d.grossSantim,
    whtCategory: d.whtCategory,
    whtRateBps: d.whtRateBps,
    whtBaseSantim: d.whtBaseSantim,
    whtSantim: d.whtSantim,
    netPayableSantim: d.netPayableSantim,
  }));

  const project = rollUpProject(contractBreakdown, breakdowns);

  return {
    contractNetSantim: project.contractNetSantim,
    contractVatSantim: project.contractVatSantim,
    contractGrossSantim: project.contractGrossSantim,
    invoicedNetSantim: billed.reduce((a, i) => a + i.netSantim, 0),
    invoicedGrossSantim: billed.reduce((a, i) => a + i.grossSantim, 0),
    collectedGrossSantim,
    outstandingGrossSantim,
    subcontractCostNetSantim: project.subcontractCostNetSantim,
    subcontractInputVatSantim: project.subcontractInputVatSantim,
    whtWithheldSantim: project.whtWithheldSantim,
    cashDisbursedSantim: project.cashDisbursedSantim,
    grossMarginSantim: project.grossMarginSantim,
    grossMarginBps: project.grossMarginBps,
    netVatPayableSantim: project.netVatPayableSantim,
  };
}
