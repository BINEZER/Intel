import { describe, expect, it } from 'vitest';
import {
  cashForecast,
  describeReady,
  rankMaintenance,
  readyToInvoice,
  termsByProject,
  type PipelineContract,
  type PipelineInvoice,
  type PipelineStage,
  type PipelineTerm,
} from '../cash-pipeline.js';
import { milestoneExpectedValue } from '../priority.js';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = d('2026-10-12');

const install: PipelineContract = { id: 'k1', contractNo: 'C-1', title: 'Two lifts', clientName: 'Sheger Mall', type: 'supply_install', status: 'active' };
const service: PipelineContract = { id: 'k2', contractNo: 'C-1-SVC', title: 'Service', clientName: 'Sheger Mall', type: 'maintenance', status: 'active' };

const term = (over: Partial<PipelineTerm> = {}): PipelineTerm => ({
  id: 't1', contractId: 'k1', name: 'Handover', seq: 1, grossSantim: 1_000_000, receivedGrossSantim: 0,
  status: 'pending', dueDate: null, phaseId: null, ...over,
});
const stage = (over: Partial<PipelineStage> = {}): PipelineStage => ({ phaseId: 'ph1', projectId: 'p1', progressBps: 0, status: 'in_progress', ...over });
const invoice = (over: Partial<PipelineInvoice> = {}): PipelineInvoice => ({
  id: 'i1', invoiceNo: 'INV-1', clientName: 'Sheger Mall', contractId: 'k1', milestoneId: null, status: 'issued',
  balanceGrossSantim: 500_000, grossSantim: 500_000, paidGrossSantim: 0, dueDate: d('2026-10-20'), ...over,
});

describe('readyToInvoice', () => {
  it('flags a term whose stage is complete', () => {
    const [item] = readyToInvoice([install], [term({ phaseId: 'ph1' })], [stage({ progressBps: 10_000 })], [], TODAY);
    expect(item?.reason).toBe('stage_complete');
    expect(item?.amountSantim).toBe(1_000_000);
    expect(describeReady(item!)).toBe('its stage is complete');
  });

  it('flags a term whose own date has come, and says how long ago', () => {
    const [item] = readyToInvoice([service], [term({ contractId: 'k2', dueDate: d('2026-10-09') })], [], [], TODAY);
    expect(item?.reason).toBe('due_date');
    expect(item?.daysPastDue).toBe(3);
    expect(item?.maintenance).toBe(true);
    expect(describeReady(item!)).toBe('it fell due 3 days ago');
  });

  it('says "today" when it falls due today', () => {
    const [item] = readyToInvoice([service], [term({ contractId: 'k2', dueDate: TODAY })], [], [], TODAY);
    expect(describeReady(item!)).toBe('it falls due today');
  });

  it('honours a term somebody marked ready', () => {
    expect(readyToInvoice([install], [term({ status: 'ready_to_invoice' })], [], [], TODAY)[0]?.reason).toBe('marked_ready');
  });

  it('is conservative: a term with no stage and no date is never called ready', () => {
    expect(readyToInvoice([install], [term()], [], [], TODAY)).toEqual([]);
  });

  it('does not flag a term whose stage is unfinished, or whose date is still ahead', () => {
    expect(readyToInvoice([install], [term({ phaseId: 'ph1' })], [stage({ progressBps: 9_000 })], [], TODAY)).toEqual([]);
    expect(readyToInvoice([service], [term({ contractId: 'k2', dueDate: d('2026-10-13') })], [], [], TODAY)).toEqual([]);
  });

  it('does not flag a term already invoiced, paid, or waived', () => {
    for (const status of ['invoiced', 'part_paid', 'paid', 'waived'] as const) {
      expect(readyToInvoice([service], [term({ contractId: 'k2', dueDate: d('2026-10-01'), status })], [], [], TODAY)).toEqual([]);
    }
  });

  it('does not nag about a term an invoice already points at, even if its status lagged', () => {
    const t = term({ contractId: 'k2', dueDate: d('2026-10-01') });
    expect(readyToInvoice([service], [t], [], [{ milestoneId: 't1', status: 'issued' }], TODAY)).toEqual([]);
    // a VOID invoice does not count as billing it
    expect(readyToInvoice([service], [t], [], [{ milestoneId: 't1', status: 'void' }], TODAY)).toHaveLength(1);
  });

  it('ignores contracts that cannot be billed', () => {
    for (const status of ['draft', 'terminated', 'suspended']) {
      expect(readyToInvoice([{ ...service, status }], [term({ contractId: 'k2', dueDate: d('2026-10-01') })], [], [], TODAY)).toEqual([]);
    }
  });

  it('lists the biggest first', () => {
    const items = readyToInvoice(
      [service],
      [
        term({ id: 'a', contractId: 'k2', name: 'Month 1', grossSantim: 100, dueDate: d('2026-09-01') }),
        term({ id: 'b', contractId: 'k2', name: 'Month 2', grossSantim: 900, dueDate: d('2026-09-01') }),
      ],
      [], [], TODAY,
    );
    expect(items.map((i) => i.termId)).toEqual(['b', 'a']);
  });
});

describe('cashForecast', () => {
  const forecast = (over: { terms?: PipelineTerm[]; invoices?: PipelineInvoice[]; stages?: PipelineStage[]; receipts?: { receivedDate: Date; amountGrossSantim: number }[] } = {}) =>
    cashForecast([install, service], over.terms ?? [], over.stages ?? [], over.invoices ?? [], over.receipts ?? [], TODAY);
  const bucket = (f: ReturnType<typeof forecast>, key: string) => f.buckets.find((b) => b.key === key)!;

  it('puts an invoice in the month its due date falls in, as money to collect', () => {
    const f = forecast({ invoices: [invoice({ dueDate: d('2026-10-20') }), invoice({ id: 'i2', dueDate: d('2026-11-05'), balanceGrossSantim: 300_000 })] });
    expect(bucket(f, 'this').collectSantim).toBe(500_000);
    expect(bucket(f, 'next').collectSantim).toBe(300_000);
    expect(bucket(f, 'this').billSantim).toBe(0);
  });

  it('puts a past-due invoice under "Already due"', () => {
    expect(bucket(forecast({ invoices: [invoice({ dueDate: d('2026-09-01') })] }), 'overdue').collectSantim).toBe(500_000);
  });

  it('ignores drafts, voids and paid invoices', () => {
    const f = forecast({ invoices: [invoice({ status: 'draft' }), invoice({ id: 'b', status: 'void' }), invoice({ id: 'c', status: 'paid', balanceGrossSantim: 0 })] });
    expect(f.buckets.every((b) => b.collectSantim === 0)).toBe(true);
  });

  it('counts only the balance of a part-paid invoice', () => {
    expect(bucket(forecast({ invoices: [invoice({ status: 'partially_paid', balanceGrossSantim: 200_000 })] }), 'this').collectSantim).toBe(200_000);
  });

  it('puts an unbilled dated term under the month of its date, as money to bill', () => {
    const f = forecast({ terms: [term({ contractId: 'k2', dueDate: d('2026-11-12') })] });
    expect(bucket(f, 'next').billSantim).toBe(1_000_000);
  });

  it('puts an unbilled term whose date has passed under "Already due"', () => {
    expect(bucket(forecast({ terms: [term({ contractId: 'k2', dueDate: d('2026-10-01') })] }), 'overdue').billSantim).toBe(1_000_000);
  });

  it('puts a term whose stage is complete in this month, with no date needed', () => {
    const f = forecast({ terms: [term({ phaseId: 'ph1' })], stages: [stage({ progressBps: 10_000 })] });
    expect(bucket(f, 'this').billSantim).toBe(1_000_000);
    expect(f.readyNowSantim).toBe(1_000_000);
  });

  it('says plainly when money has no date, rather than guessing a month', () => {
    const f = forecast({ terms: [term({ phaseId: 'ph1' }), term({ id: 't2', phaseId: null })], stages: [stage({ progressBps: 4_000 })] });
    expect(bucket(f, 'undated').billSantim).toBe(2_000_000);
    expect(bucket(f, 'this').billSantim).toBe(0);
  });

  it('does not count a term twice when an invoice already points at it', () => {
    const f = forecast({ terms: [term({ dueDate: d('2026-10-20') })], invoices: [invoice({ milestoneId: 't1', dueDate: d('2026-10-20') })] });
    expect(bucket(f, 'this').billSantim).toBe(0);
    expect(bucket(f, 'this').collectSantim).toBe(500_000);
  });

  it('counts an invoiced term with no invoice document as money to collect', () => {
    const f = forecast({ terms: [term({ status: 'part_paid', receivedGrossSantim: 400_000, dueDate: d('2026-10-25') })] });
    expect(bucket(f, 'this').collectSantim).toBe(600_000);
  });

  it('ignores settled terms and terms on contracts that cannot be billed', () => {
    const f = cashForecast(
      [{ ...install, status: 'draft' }], [term(), term({ id: 't2', status: 'paid' })], [], [], [], TODAY,
    );
    expect(f.buckets.every((b) => b.billSantim + b.collectSantim === 0)).toBe(true);
  });

  it('reports how much of it is monthly maintenance', () => {
    const f = forecast({ terms: [term({ contractId: 'k2', dueDate: d('2026-10-30'), grossSantim: 977_500 })], invoices: [invoice({ dueDate: d('2026-10-30') })] });
    expect(f.maintenanceSantim).toBe(977_500);
  });

  it('adds up what has already arrived this month', () => {
    const f = forecast({ receipts: [
      { receivedDate: d('2026-10-03'), amountGrossSantim: 700 }, { receivedDate: d('2026-10-09'), amountGrossSantim: 300 },
      { receivedDate: d('2026-09-30'), amountGrossSantim: 9_999 },
    ] });
    expect(f.receivedThisMonthSantim).toBe(1_000);
  });

  it('can be read on the Ethiopian calendar', () => {
    const f = cashForecast([install], [], [], [], [], TODAY, 'ethiopian');
    expect(f.thisMonth.basis).toBe('ethiopian');
  });
});

describe('rankMaintenance', () => {
  const month = (n: number, due: string, over: Partial<PipelineTerm> = {}) =>
    term({ id: `m${n}`, contractId: 'k2', name: `Month ${n}`, grossSantim: 977_500, dueDate: d(due), ...over });

  it('ranks the agreement with more money waiting first', () => {
    const other: PipelineContract = { ...service, id: 'k3', contractNo: 'C-9-SVC', clientName: 'Other' };
    const rows = rankMaintenance(
      [service, other],
      [month(1, '2026-09-01'), month(2, '2026-10-01'), term({ id: 'x', contractId: 'k3', grossSantim: 977_500, dueDate: d('2026-10-05') })],
      [], TODAY,
    );
    expect(rows.map((r) => r.contractNo)).toEqual(['C-1-SVC', 'C-9-SVC']);
    expect(rows[0]?.readyNowSantim).toBe(1_955_000);
    expect(rows[0]?.readyCount).toBe(2);
  });

  it('counts overdue invoices at full weight and current ones at a discount', () => {
    const [row] = rankMaintenance([service], [], [
      invoice({ contractId: 'k2', dueDate: d('2026-09-20'), balanceGrossSantim: 1_000, grossSantim: 1_000 }),
      invoice({ id: 'b', contractId: 'k2', dueDate: d('2026-10-30'), balanceGrossSantim: 1_000, grossSantim: 1_000 }),
    ], TODAY);
    expect(row?.overdueSantim).toBe(1_000);
    expect(row?.currentSantim).toBe(1_000);
    expect(row?.weightedSantim).toBe(1_600);
    expect(row?.oldestOverdueDays).toBe(22);
  });

  it('discounts a month that is not yet due, and leaves out an agreement with nothing waiting', () => {
    const [row] = rankMaintenance([service], [month(1, '2026-11-05')], [], TODAY);
    expect(row?.readyNowSantim).toBe(0);
    expect(row?.upcomingSantim).toBeGreaterThan(0);
    expect(row?.upcomingSantim).toBeLessThan(977_500);
    expect(rankMaintenance([service], [month(1, '2027-12-01')], [], TODAY)).toEqual([]);
  });

  it('ignores installation contracts', () => {
    expect(rankMaintenance([install], [term({ dueDate: d('2026-09-01') })], [], TODAY)).toEqual([]);
  });

  it('keeps a renewed (completed) agreement that still has unbilled months', () => {
    const rows = rankMaintenance([{ ...service, status: 'completed' }], [month(12, '2026-10-01')], [], TODAY);
    expect(rows).toHaveLength(1);
  });
});

describe('termsByProject', () => {
  const projects = [{ id: 'p1', contractId: 'k1' }, { id: 'p2', contractId: 'k1' }, { id: 'p3', contractId: null }];

  it('credits a stage-tied term to the project that owns the stage', () => {
    const out = termsByProject(projects, [term({ phaseId: 'ph1' })], [stage({ projectId: 'p2', progressBps: 3_000 })], new Set());
    expect(out.get('p1')).toEqual([]);
    expect(out.get('p2')?.[0]).toMatchObject({ grossSantim: 1_000_000, gatingPhaseProgressBps: 3_000 });
  });

  it('shares an untied term equally, so the contract is counted once', () => {
    const out = termsByProject(projects, [term({ grossSantim: 1_000_001 })], [], new Set());
    const shares = [out.get('p1')![0]!.grossSantim, out.get('p2')![0]!.grossSantim];
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1_000_001);
    expect(shares[0]).toBe(500_001);
  });

  it('gives nothing to a project with no contract, or a term for a contract nobody delivers', () => {
    const out = termsByProject(projects, [term({ contractId: 'nobody' })], [], new Set());
    expect([...out.values()].every((v) => v.length === 0)).toBe(true);
  });

  it('reports a ready term as ready_to_invoice, so it is counted at full value', () => {
    const ready = termsByProject([{ id: 'p1', contractId: 'k1' }], [term({ phaseId: 'ph1' })], [stage({ progressBps: 10_000 })], new Set(['t1']));
    expect(ready.get('p1')?.[0]?.status).toBe('ready_to_invoice');
    const asOf = TODAY;
    const t = ready.get('p1')![0]!;
    expect(milestoneExpectedValue({ ...t }, asOf, 90)).toBe(1_000_000);
  });
});

describe('the project ranking no longer double-counts a part-paid term', () => {
  it('values a part_paid term at zero — its balance is already an invoice receivable', () => {
    expect(milestoneExpectedValue({ name: 'x', grossSantim: 1_000, status: 'part_paid', dueDate: null, gatingPhaseProgressBps: null }, TODAY, 90)).toBe(0);
  });
});
