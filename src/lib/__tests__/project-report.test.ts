import { describe, expect, it } from 'vitest';
import {
  describeAccount,
  projectAccount,
  type ReportedDisbursement,
  type ReportedInvoice,
} from '../project-report.js';

const NOW = Date.UTC(2026, 8, 22);
const days = (n: number) => NOW + n * 86_400_000;

const invoice = (over: Partial<ReportedInvoice> = {}): ReportedInvoice => ({
  id: 'i1',
  invoiceNo: 'INV-0001',
  status: 'issued',
  netSantim: 1_000_000_00,
  vatSantim: 150_000_00,
  grossSantim: 1_150_000_00,
  paidGrossSantim: 0,
  balanceGrossSantim: 1_150_000_00,
  issuedAtMillis: days(-30),
  dueAtMillis: days(30),
  ...over,
});

const payment = (over: Partial<ReportedDisbursement> = {}): ReportedDisbursement => ({
  id: 'd1',
  voucherNo: 'PV-0001',
  supplierName: 'Merkebu Alemayehu',
  status: 'paid',
  netSantim: 400_000_00,
  grossSantim: 460_000_00,
  whtSantim: 8_000_00,
  netPayableSantim: 452_000_00,
  paidAtMillis: days(-10),
  ...over,
});

describe('what has been billed', () => {
  it('adds up the invoices that have been sent', () => {
    const account = projectAccount(5_000_000_00, [invoice(), invoice({ id: 'i2' })], [], NOW);
    expect(account.billedNetSantim).toBe(2_000_000_00);
    expect(account.billedGrossSantim).toBe(2_300_000_00);
    expect(account.billedVatSantim).toBe(300_000_00);
  });

  it('leaves a draft out — nobody has been asked to pay it', () => {
    const account = projectAccount(5_000_000_00, [invoice({ status: 'draft' })], [], NOW);
    expect(account.billedGrossSantim).toBe(0);
    expect(account.draftInvoices).toBe(1);
  });

  it('leaves a void invoice out of billed, collected and outstanding alike', () => {
    // Dropping it from one and not the others is what makes the three stop
    // reconciling, which is worse than not showing it at all.
    const account = projectAccount(
      5_000_000_00,
      [invoice({ status: 'void', paidGrossSantim: 50_000_00, balanceGrossSantim: 1_100_000_00 })],
      [],
      NOW,
    );
    expect(account.billedGrossSantim).toBe(0);
    expect(account.collectedGrossSantim).toBe(0);
    expect(account.outstandingGrossSantim).toBe(0);
    expect(account.voidInvoices).toBe(1);
  });

  it('reports what is left of the contract to bill', () => {
    const account = projectAccount(5_000_000_00, [invoice()], [], NOW);
    expect(account.unbilledNetSantim).toBe(4_000_000_00);
  });

  it('says plainly when more has been billed than the contract carries', () => {
    const account = projectAccount(500_000_00, [invoice()], [], NOW);
    expect(account.unbilledNetSantim).toBe(-500_000_00);
    expect(describeAccount(account)).toContain('More has been billed');
  });
});

describe('what has come in', () => {
  it('separates collected from outstanding', () => {
    const account = projectAccount(
      5_000_000_00,
      [invoice({ status: 'partially_paid', paidGrossSantim: 400_000_00, balanceGrossSantim: 750_000_00 })],
      [],
      NOW,
    );
    expect(account.collectedGrossSantim).toBe(400_000_00);
    expect(account.outstandingGrossSantim).toBe(750_000_00);
  });

  it('counts an invoice past its date with a balance as overdue', () => {
    const account = projectAccount(5_000_000_00, [invoice({ dueAtMillis: days(-1) })], [], NOW);
    expect(account.overdueInvoices).toBe(1);
    expect(account.overdueGrossSantim).toBe(1_150_000_00);
  });

  it('does not call a fully paid invoice overdue however old it is', () => {
    const account = projectAccount(
      5_000_000_00,
      [invoice({ status: 'paid', paidGrossSantim: 1_150_000_00, balanceGrossSantim: 0, dueAtMillis: days(-400) })],
      [],
      NOW,
    );
    expect(account.overdueInvoices).toBe(0);
  });
});

describe('what went out', () => {
  it('counts only payments actually made as cost', () => {
    const account = projectAccount(
      5_000_000_00,
      [],
      [payment(), payment({ id: 'd2', status: 'approved', netSantim: 300_000_00 })],
      NOW,
    );
    expect(account.costNetSantim).toBe(400_000_00);
    expect(account.committedCostNetSantim).toBe(300_000_00);
  });

  it('keeps the withholding held back, which is owed to the authority', () => {
    const account = projectAccount(5_000_000_00, [], [payment()], NOW);
    expect(account.whtHeldSantim).toBe(8_000_00);
  });

  it('leaves a rejected payment out of both cost and commitment', () => {
    const account = projectAccount(5_000_000_00, [], [payment({ status: 'rejected' })], NOW);
    expect(account.costNetSantim).toBe(0);
    expect(account.committedCostNetSantim).toBe(0);
  });
});

describe('margin', () => {
  it('is the contract less what has been paid out', () => {
    const account = projectAccount(1_000_000_00, [], [payment({ netSantim: 400_000_00 })], NOW);
    expect(account.marginToDateSantim).toBe(600_000_00);
    expect(account.marginBps).toBe(6000);
  });

  it('is negative when the job has cost more than it is worth', () => {
    const account = projectAccount(100_000_00, [], [payment({ netSantim: 400_000_00 })], NOW);
    expect(account.marginToDateSantim).toBe(-300_000_00);
    expect(account.marginBps).toBe(-30_000);
  });

  it('reports no percentage when there is no contract value to divide by', () => {
    // 0/0 is not 0%. A job with no figure recorded has an unknown margin,
    // not a zero one.
    expect(projectAccount(0, [], [payment()], NOW).marginBps).toBeNull();
  });
});

describe('the sentence that sums it up', () => {
  it('says so when nothing is recorded at all', () => {
    expect(describeAccount(projectAccount(0, [], [], NOW))).toContain('No contract value');
  });

  it('says so when everything billed has been collected', () => {
    const account = projectAccount(
      1_000_000_00,
      [invoice({ status: 'paid', netSantim: 1_000_000_00, paidGrossSantim: 1_150_000_00, balanceGrossSantim: 0 })],
      [],
      NOW,
    );
    expect(describeAccount(account)).toBe('Everything billed on this project has been collected.');
  });

  it('names overdue invoices ahead of what is merely outstanding', () => {
    const account = projectAccount(1_000_000_00, [invoice({ netSantim: 1_000_000_00, dueAtMillis: days(-5) })], [], NOW);
    const said = describeAccount(account);
    expect(said).toContain('past due');
    expect(said).not.toContain('inside its terms');
  });

  it('mentions drafts that have not been sent', () => {
    const account = projectAccount(1_000_000_00, [invoice({ status: 'draft' })], [], NOW);
    expect(describeAccount(account)).toContain('draft invoice');
  });

  it('starts with a capital and ends with a full stop', () => {
    const account = projectAccount(5_000_000_00, [invoice()], [], NOW);
    const said = describeAccount(account);
    expect(said[0]).toBe(said[0]?.toUpperCase());
    expect(said.endsWith('.')).toBe(true);
  });
});
