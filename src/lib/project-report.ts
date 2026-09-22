/**
 * One project's own account: what it is worth, what has been billed, what has
 * come in, what went out, and what is left.
 *
 * WHY THIS IS NOT THE KPI PANEL
 *   The KPI panel answers "is this job healthy" in percentages — progress
 *   against invoiced against collected. That is the right shape for a screen
 *   somebody glances at. It is the wrong shape for a document: a client asking
 *   where their money went, or a manager deciding whether to release the next
 *   payment, needs birr, and needs the invoices those birr came from.
 *
 * WHY IT IS A LIBRARY
 *   Every figure here is a subtraction somebody will be held to. Cash in, cash
 *   out and what is still owed belong where a test can pin them down, not
 *   inside a component that also does layout.
 *
 * WHAT COUNTS
 *   A VOID invoice is not money. It is excluded from billed, from collected and
 *   from outstanding alike — leaving it in any one of the three makes the three
 *   stop reconciling. A DRAFT invoice is not money either: nobody has been
 *   asked to pay it. Both are counted separately so the page can say they exist
 *   rather than silently dropping them.
 */

/** The fields of an invoice this module needs. */
export interface ReportedInvoice {
  id: string;
  invoiceNo: string;
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  netSantim: number;
  vatSantim: number;
  grossSantim: number;
  paidGrossSantim: number;
  balanceGrossSantim: number;
  /** Milliseconds, so the caller decides how to render a date. */
  issuedAtMillis: number;
  dueAtMillis: number;
}

/** The fields of a supplier payment this module needs. */
export interface ReportedDisbursement {
  id: string;
  voucherNo: string;
  supplierName: string;
  status: string;
  netSantim: number;
  grossSantim: number;
  whtSantim: number;
  netPayableSantim: number;
  paidAtMillis: number | null;
}

export interface ProjectAccount {
  /** The job's share of the contract, net of VAT. */
  contractNetSantim: number;

  /** Raised and sent, gross. Drafts and voids excluded. */
  billedGrossSantim: number;
  billedNetSantim: number;
  billedVatSantim: number;
  /** Received against those invoices. */
  collectedGrossSantim: number;
  /** Billed but not yet received. */
  outstandingGrossSantim: number;
  /** Of the contract, not yet billed at all. Negative means over-billed. */
  unbilledNetSantim: number;

  /** Supplier cost actually paid out, net of VAT. */
  costNetSantim: number;
  /** Withholding deducted from suppliers and owed to the authority. */
  whtHeldSantim: number;
  /** Cost committed but not yet paid. */
  committedCostNetSantim: number;

  /** Contract net less cost paid. Not profit until the job is finished. */
  marginToDateSantim: number;
  /** Margin as basis points of contract value, or null with nothing to divide by. */
  marginBps: number | null;

  /** Invoices that exist but are not money yet. */
  draftInvoices: number;
  voidInvoices: number;
  /** Invoices past their due date with a balance. */
  overdueInvoices: number;
  overdueGrossSantim: number;
}

/** A paid-out supplier payment. Anything else is committed, not spent. */
function isPaid(status: string): boolean {
  return status === 'paid';
}

/** A payment that will be made unless somebody stops it. */
function isCommitted(status: string): boolean {
  return status === 'requested' || status === 'checked' || status === 'approved';
}

/** An invoice that represents money somebody has been asked for. */
function isLive(invoice: ReportedInvoice): boolean {
  return invoice.status !== 'draft' && invoice.status !== 'void';
}

/**
 * One project's account.
 *
 * `asOfMillis` decides what counts as overdue, and is passed in rather than
 * read from the clock so the same inputs always give the same answer.
 */
export function projectAccount(
  contractNetSantim: number,
  invoices: readonly ReportedInvoice[],
  disbursements: readonly ReportedDisbursement[],
  asOfMillis: number,
): ProjectAccount {
  const live = invoices.filter(isLive);

  const billedGrossSantim = live.reduce((sum, i) => sum + i.grossSantim, 0);
  const billedNetSantim = live.reduce((sum, i) => sum + i.netSantim, 0);
  const billedVatSantim = live.reduce((sum, i) => sum + i.vatSantim, 0);
  const collectedGrossSantim = live.reduce((sum, i) => sum + i.paidGrossSantim, 0);
  const outstandingGrossSantim = live.reduce((sum, i) => sum + i.balanceGrossSantim, 0);

  const overdue = live.filter((i) => i.balanceGrossSantim > 0 && i.dueAtMillis < asOfMillis);

  const paid = disbursements.filter((d) => isPaid(d.status));
  const costNetSantim = paid.reduce((sum, d) => sum + d.netSantim, 0);
  const whtHeldSantim = paid.reduce((sum, d) => sum + d.whtSantim, 0);
  const committedCostNetSantim = disbursements
    .filter((d) => isCommitted(d.status))
    .reduce((sum, d) => sum + d.netSantim, 0);

  const marginToDateSantim = contractNetSantim - costNetSantim;

  return {
    contractNetSantim,
    billedGrossSantim,
    billedNetSantim,
    billedVatSantim,
    collectedGrossSantim,
    outstandingGrossSantim,
    unbilledNetSantim: contractNetSantim - billedNetSantim,
    costNetSantim,
    whtHeldSantim,
    committedCostNetSantim,
    marginToDateSantim,
    marginBps:
      contractNetSantim > 0
        ? Math.round((marginToDateSantim * 10_000) / contractNetSantim)
        : null,
    draftInvoices: invoices.filter((i) => i.status === 'draft').length,
    voidInvoices: invoices.filter((i) => i.status === 'void').length,
    overdueInvoices: overdue.length,
    overdueGrossSantim: overdue.reduce((sum, i) => sum + i.balanceGrossSantim, 0),
  };
}

/**
 * The one sentence that says where the money stands.
 *
 * Written so it reads the same whether the job is ahead or behind: the numbers
 * change, the sentence does not become an excuse.
 */
export function describeAccount(account: ProjectAccount): string {
  if (account.contractNetSantim === 0 && account.billedGrossSantim === 0) {
    return 'No contract value and no invoice is recorded against this project yet.';
  }

  const parts: string[] = [];
  if (account.unbilledNetSantim > 0) {
    parts.push('part of the contract has not been billed yet');
  } else if (account.unbilledNetSantim < 0) {
    parts.push('more has been billed than the contract value recorded here');
  }
  if (account.overdueInvoices > 0) {
    parts.push(
      `${account.overdueInvoices} invoice${account.overdueInvoices === 1 ? ' is' : 's are'} past due`,
    );
  } else if (account.outstandingGrossSantim > 0) {
    parts.push('what is outstanding is still inside its terms');
  }
  if (account.draftInvoices > 0) {
    parts.push(
      `${account.draftInvoices} draft invoice${account.draftInvoices === 1 ? '' : 's'} has not been sent`,
    );
  }

  if (parts.length === 0) return 'Everything billed on this project has been collected.';
  return `${parts[0]!.charAt(0).toUpperCase()}${parts[0]!.slice(1)}${
    parts.length > 1 ? `; ${parts.slice(1).join('; ')}` : ''
  }.`;
}
