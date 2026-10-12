/**
 * Turning the portfolio's records into the plain facts `lib/cash-pipeline.ts`
 * reasons over.
 *
 * Kept apart from the library so the library never sees a Firestore timestamp:
 * everything it is handed is a Date, a number or a string, which is what lets it
 * be tested without a database.
 */

import type { PortfolioDetail } from './portfolio.js';
import type { WithId } from './repository.js';
import type {
  PipelineContract,
  PipelineInvoice,
  PipelineReceipt,
  PipelineStage,
  PipelineTerm,
} from '../lib/cash-pipeline.js';
import type { Contract, Invoice } from '../lib/schema.js';

export interface PipelineInputs {
  contracts: PipelineContract[];
  terms: PipelineTerm[];
  stages: PipelineStage[];
  invoices: PipelineInvoice[];
  receipts: PipelineReceipt[];
}

export function pipelineInputs(
  contracts: readonly WithId<Contract>[],
  invoices: readonly WithId<Invoice>[],
  detail: PortfolioDetail,
): PipelineInputs {
  return {
    contracts: contracts.map((c) => ({
      id: c.id,
      contractNo: c.contractNo,
      title: c.title,
      clientName: c.clientName,
      type: c.type,
      status: c.status,
    })),
    terms: detail.milestones.map((m) => ({
      id: m.id,
      contractId: m.contractId,
      name: m.name,
      seq: m.seq,
      grossSantim: m.grossSantim,
      // A settled term has received its whole amount even where no figure was
      // recorded — an import marks it paid without writing one.
      receivedGrossSantim: m.status === 'paid' ? m.grossSantim : (m.receivedGrossSantim ?? 0),
      status: m.status,
      dueDate: m.dueDate?.at.toDate() ?? null,
      phaseId: m.phaseId ?? null,
    })),
    stages: detail.stages.map((s) => ({
      phaseId: s.id,
      projectId: s.projectId,
      progressBps: s.progressBps,
      status: s.status,
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      clientName: i.clientName,
      contractId: i.contractId,
      milestoneId: i.milestoneId,
      status: i.status,
      balanceGrossSantim: i.balanceGrossSantim,
      grossSantim: i.grossSantim,
      paidGrossSantim: i.paidGrossSantim,
      dueDate: i.dueDate.at.toDate(),
    })),
    receipts: [...detail.receipts.values()].flat().map((r) => ({
      receivedDate: r.receivedDate.at.toDate(),
      amountGrossSantim: r.amountGrossSantim,
    })),
  };
}
