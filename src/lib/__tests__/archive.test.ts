import { describe, expect, it } from 'vitest';
import { archiveCandidate, assessArchive, type ArchiveJob } from '../archive.js';
import {
  backupContent,
  backupFileStem,
  backupFileText,
  contentText,
  sha256Hex,
  toPlain,
  workbookSheets,
} from '../archive-backup.js';

const NOW = new Date('2026-10-06T00:00:00Z');
const ts = (iso: string) => ({ toMillis: () => Date.parse(iso), toDate: () => new Date(iso), seconds: Math.floor(Date.parse(iso) / 1000), nanoseconds: 0 });
const dd = (iso: string) => ({ at: ts(iso), ec: { year: 2018, month: 1, day: 1 }, ecPeriod: 'EC-2018-01', ecFiscalYear: 2018, enteredIn: 'GC' });

function job(over: Partial<ArchiveJob> = {}): ArchiveJob {
  return {
    contract: {
      id: 'k1',
      data: {
        contractNo: 'C-2025-001', title: 'Two lifts', type: 'supply_install', status: 'completed',
        clientId: 'c1', clientName: 'Sheger Mall', valueNetSantim: 1_000_000, valueGrossSantim: 1_150_000,
        succeededByContractId: 'k2', serviceDeclined: false, warranty: null,
        ...{ signedDate: dd('2025-01-10T00:00:00Z'), startDate: dd('2025-01-15T00:00:00Z'), endDate: dd('2025-09-15T00:00:00Z'), vatSantim: 150_000 },
      },
    },
    terms: [
      { id: 't1', data: { status: 'paid', grossSantim: 575_000, ...{ seq: 1, name: 'Advance', shareBps: 5000, netSantim: 500_000, vatSantim: 75_000 } } },
      { id: 't2', data: { status: 'waived', grossSantim: 575_000, ...{ seq: 2, name: 'Handover', shareBps: 5000, netSantim: 500_000, vatSantim: 75_000 } } },
    ],
    projects: [{ id: 'p1', data: { projectNo: 'PRJ-001', title: 'Lifts', status: 'completed' } }],
    stages: [{ id: 's1', projectId: 'p1', data: { seq: 1, name: 'Shaft', status: 'completed', checkpoints: [{ label: 'Pit', doneAt: ts('2025-03-01T00:00:00Z') }] } }],
    invoices: [
      { id: 'i1', data: { invoiceNo: 'INV-0010', status: 'paid', netSantim: 500_000, vatSantim: 75_000, grossSantim: 575_000, paidGrossSantim: 575_000, balanceGrossSantim: 0 } },
      { id: 'i2', data: { invoiceNo: 'INV-0009', status: 'paid', netSantim: 500_000, vatSantim: 75_000, grossSantim: 575_000, paidGrossSantim: 575_000, balanceGrossSantim: 0 } },
    ],
    receipts: [{ id: 'r1', invoiceId: 'i1', data: { amountGrossSantim: 575_000, method: 'bank_transfer', clientWhtSantim: 0, receivedDate: dd('2025-04-01T00:00:00Z') } }],
    chaseSteps: [{ id: 'n1', invoiceId: 'i1', data: { action: 'payment_request', note: '=cmd|evil', byName: 'Sara', contactName: 'Abel', at: dd('2025-03-20T00:00:00Z') } }],
    vouchers: [{ id: 'v1', data: { voucherNo: 'PV-1', status: 'paid' } }],
    assignments: [],
    tasks: [],
    units: [{ id: 'u1', data: { tag: 'LIFT-01' } }],
    successor: { id: 'k2', contractNo: 'C-2025-001-SVC', status: 'active' },
    staying: { callouts: 0, visits: 0 },
    ...over,
  };
}

describe('assessArchive', () => {
  it('allows a finished, paid, handed-over job', () => {
    const v = assessArchive(job(), NOW);
    expect(v.blockers).toEqual([]);
    expect(v.eligible).toBe(true);
  });

  it('lists invoice numbers in natural order, and totals them', () => {
    const v = assessArchive(job(), NOW);
    expect(v.invoiceNumbers).toEqual(['INV-0009', 'INV-0010']);
    expect(v.totals.invoicedGrossSantim).toBe(1_150_000);
    expect(v.totals.receivedGrossSantim).toBe(1_150_000);
  });

  it('refuses a maintenance agreement', () => {
    const j = job();
    j.contract.data.type = 'maintenance';
    expect(assessArchive(j, NOW).blockers.join(' ')).toMatch(/renewed, not archived/);
  });

  it('refuses a contract that is not completed', () => {
    const j = job();
    j.contract.data.status = 'active';
    const v = assessArchive(j, NOW);
    expect(v.eligible).toBe(false);
    expect(v.blockers.join(' ')).toMatch(/not completed/);
  });

  it('refuses while a project is still running, naming it', () => {
    const j = job({ projects: [{ id: 'p1', data: { projectNo: 'PRJ-007', title: 'x', status: 'in_progress' } }] });
    expect(assessArchive(j, NOW).blockers.join(' ')).toMatch(/PRJ-007 is in progress/);
  });

  it('refuses a job nothing followed, unless the client declined', () => {
    const j = job({ successor: null });
    j.contract.data.succeededByContractId = null;
    expect(assessArchive(j, NOW).blockers.join(' ')).toMatch(/No maintenance agreement follows/);
    j.contract.data.serviceDeclined = true;
    expect(assessArchive(j, NOW).eligible).toBe(true);
  });

  it('refuses when the successor it points at is missing', () => {
    const j = job({ successor: null });
    expect(assessArchive(j, NOW).blockers.join(' ')).toMatch(/cannot be found/);
  });

  it('refuses while any payment term is unsettled, and says how much is owed', () => {
    const j = job();
    j.terms.push({ id: 't3', data: { status: 'part_paid', grossSantim: 1_000_000, receivedGrossSantim: 400_000 } });
    const text = assessArchive(j, NOW).blockers.join(' ');
    expect(text).toMatch(/1 payment term is not settled/);
    expect(text).toMatch(/ETB 6,000\.00/);
  });

  it('refuses a draft invoice and an unpaid one, but not a void one', () => {
    const j = job();
    j.invoices.push({ id: 'i3', data: { invoiceNo: '', status: 'draft', netSantim: 0, vatSantim: 0, grossSantim: 0, paidGrossSantim: 0, balanceGrossSantim: 0 } });
    j.invoices.push({ id: 'i4', data: { invoiceNo: 'INV-0011', status: 'issued', netSantim: 100, vatSantim: 15, grossSantim: 115, paidGrossSantim: 0, balanceGrossSantim: 115 } });
    j.invoices.push({ id: 'i5', data: { invoiceNo: 'INV-0012', status: 'void', netSantim: 100, vatSantim: 15, grossSantim: 115, paidGrossSantim: 0, balanceGrossSantim: 115 } });
    const text = assessArchive(j, NOW).blockers.join(' ');
    expect(text).toMatch(/still a draft/);
    expect(text).toMatch(/INV-0011 still has ETB 1\.15 unpaid/);
    expect(text).not.toMatch(/INV-0012/);
  });

  it('keeps void invoices out of the totals but in the number list', () => {
    const j = job();
    j.invoices.push({ id: 'i5', data: { invoiceNo: 'INV-0012', status: 'void', netSantim: 100, vatSantim: 15, grossSantim: 115, paidGrossSantim: 0, balanceGrossSantim: 0 } });
    const v = assessArchive(j, NOW);
    expect(v.totals.invoicedGrossSantim).toBe(1_150_000);
    expect(v.invoiceNumbers).toContain('INV-0012');
  });

  it('refuses an unfinished payment voucher, accepts paid and rejected ones', () => {
    const j = job();
    j.vouchers.push({ id: 'v2', data: { voucherNo: 'PV-2', status: 'approved' } }, { id: 'v3', data: { voucherNo: 'PV-3', status: 'rejected' } });
    const text = assessArchive(j, NOW).blockers.join(' ');
    expect(text).toMatch(/PV-2/);
    expect(text).not.toMatch(/PV-3/);
  });

  it('refuses while a task is open against the job, but not once it is done', () => {
    const j = job({ tasks: [{ id: 'k', data: { title: 'Collect certificate', completedAt: null, archived: false } }] });
    expect(assessArchive(j, NOW).blockers.join(' ')).toMatch(/Collect certificate/);
    j.tasks[0]!.data.completedAt = ts('2025-05-01T00:00:00Z');
    expect(assessArchive(j, NOW).eligible).toBe(true);
  });

  it('warns, without blocking, while the warranty is still running', () => {
    const j = job();
    j.contract.data.warranty = { endsOn: dd('2027-01-01T00:00:00Z') };
    const v = assessArchive(j, NOW);
    expect(v.eligible).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/warranty .* until 2027-01-01/);
  });

  it('says plainly that the client, lifts and maintenance agreement stay', () => {
    const v = assessArchive(job({ staying: { callouts: 3, visits: 1 } }), NOW);
    const text = v.stays.join(' ');
    expect(text).toMatch(/Sheger Mall/);
    expect(text).toMatch(/1 lift —/);
    expect(text).toMatch(/C-2025-001-SVC/);
    expect(text).toMatch(/3 callouts and 1 maintenance visit/);
  });

  it('counts what goes, leaving out what is empty', () => {
    const v = assessArchive(job(), NOW);
    const labels = v.removes.map((r) => r.label);
    expect(labels).toContain('invoices');
    expect(labels).not.toContain('crew assignments');
  });
});

describe('archiveCandidate', () => {
  it('is ready only when completed, followed and every project is completed', () => {
    expect(archiveCandidate({ type: 'supply_install', status: 'completed', succeededByContractId: 'k2' }, ['completed']).ready).toBe(true);
    expect(archiveCandidate({ type: 'supply_install', status: 'completed', serviceDeclined: true }, []).ready).toBe(true);
  });
  it('gives the reason it is not', () => {
    expect(archiveCandidate({ type: 'maintenance', status: 'completed' }, []).reason).toMatch(/renewed/);
    expect(archiveCandidate({ type: 'supply_install', status: 'active' }, []).reason).toMatch(/not completed/);
    expect(archiveCandidate({ type: 'supply_install', status: 'completed', succeededByContractId: 'k2' }, ['completed', 'in_progress']).reason).toMatch(/1 project is not completed/);
    expect(archiveCandidate({ type: 'supply_install', status: 'completed' }, ['completed']).reason).toMatch(/No maintenance agreement/);
  });
});

describe('the backup', () => {
  it('turns timestamps into marked ISO strings and sorts keys', () => {
    expect(toPlain({ b: 1, a: { at: ts('2025-01-01T00:00:00Z') }, gone: undefined })).toEqual({
      a: { at: { __timestamp: '2025-01-01T00:00:00.000Z' } },
      b: 1,
    });
  });

  it('is deterministic: the same job always has the same fingerprint', async () => {
    const a = await sha256Hex(contentText(job()));
    const b = await sha256Hex(contentText(job()));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not depend on the order documents were read in', async () => {
    const forward = job();
    const reversed = job();
    reversed.invoices.reverse();
    reversed.terms.reverse();
    expect(await sha256Hex(contentText(reversed))).toBe(await sha256Hex(contentText(forward)));
  });

  it('changes the fingerprint when anything about the job changes', async () => {
    const before = await sha256Hex(contentText(job()));
    const edited = job();
    edited.invoices[0]!.data.paidGrossSantim = 1;
    expect(await sha256Hex(contentText(edited))).not.toBe(before);
    const extra = job();
    extra.receipts.push({ id: 'r2', invoiceId: 'i1', data: { amountGrossSantim: 1 } });
    expect(await sha256Hex(contentText(extra))).not.toBe(before);
  });

  it('puts the fingerprint inside the file, leaving the content intact', () => {
    const file = JSON.parse(backupFileText(job(), { exportedAt: '2026-10-06T00:00:00Z', exportedBy: 'uid', contentSha256: 'abc' }));
    expect(file.meta.contentSha256).toBe('abc');
    expect(file.format).toBe('intelmotion-job-archive');
    const { meta: _meta, ...rest } = file;
    expect(rest).toEqual(JSON.parse(contentText(job())));
  });

  it('names the file after the contract and client', () => {
    expect(backupFileStem(job())).toBe('IntelMotion-archive-C-2025-001-Sheger-Mall');
  });

  it('contains every kind of record', () => {
    const c = backupContent(job());
    for (const key of ['contract', 'paymentTerms', 'projects', 'stages', 'invoices', 'receipts', 'collectionNotes', 'paymentVouchers', 'crewAssignments', 'liftsLinked', 'maintenanceAgreement']) {
      expect(c).toHaveProperty(key);
    }
  });
});

describe('the workbook', () => {
  const j = job();
  const v = assessArchive(j, NOW);
  const sheets = workbookSheets(j, v, { exportedAt: '2026-10-06', contentSha256: 'abc' });
  const sheet = (name: string) => sheets.find((s) => s.name === name)!;

  it('has one sheet per kind of record', () => {
    expect(sheets.map((s) => s.name)).toEqual([
      'Summary', 'Payment terms', 'Projects', 'Stages', 'Invoices', 'Receipts', 'Collection notes', 'Payment vouchers', 'Crew',
    ]);
  });

  it('shows money in birr, not santim', () => {
    const row = sheet('Invoices').rows.find((r) => r[0] === 'INV-0010')!;
    expect(row[4]).toBe(5000);
    expect(row[6]).toBe(5750);
  });

  it('lists invoices in number order', () => {
    expect(sheet('Invoices').rows.slice(1).map((r) => r[0])).toEqual(['INV-0009', 'INV-0010']);
  });

  it('shows dates in both calendars', () => {
    const row = sheet('Receipts').rows[1]!;
    expect(String(row[1])).toMatch(/1 Apr 2025 \(.* EC\)/);
  });

  it('keeps invoice numbers on receipts and notes, not internal ids', () => {
    expect(sheet('Receipts').rows[1]![0]).toBe('INV-0010');
    expect(sheet('Collection notes').rows[1]![0]).toBe('INV-0010');
  });

  it('carries the fingerprint and the invoice numbers on the summary', () => {
    const rows = sheet('Summary').rows;
    expect(rows.find((r) => r[0] === 'Backup fingerprint (SHA-256)')![1]).toBe('abc');
    expect(rows.find((r) => r[0] === 'Invoice numbers in this archive')![1]).toBe('INV-0009, INV-0010');
  });

  it('records checkpoints with the day they were signed off', () => {
    expect(String(sheet('Stages').rows[1]![10])).toMatch(/Pit ✓ 1 Mar 2025/);
  });
});

describe('a backup is never refused over an odd figure', () => {
  it('writes the workbook even when a stored amount has a fraction of a santim', () => {
    const j = job();
    j.invoices[0]!.data.netSantim = 500_000.00000001;
    const v = assessArchive(j, NOW);
    expect(() => workbookSheets(j, v, { exportedAt: 'x', contentSha256: 'y' })).not.toThrow();
  });
});
