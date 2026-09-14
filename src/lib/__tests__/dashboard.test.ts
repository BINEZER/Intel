/**
 * The dashboard.
 *
 * The case that matters most is the EMPTY one. A dashboard of zeros on a new
 * system is indistinguishable from a broken one, and the reader cannot tell
 * whether the business had a quiet month or whether nothing is wired up.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDashboard,
  setupProgress,
  type DashboardInputs,
  type DashboardInvoice,
  type DashboardProject,
  type SetupCounts,
} from '../dashboard.js';
import { chaseState, type ChaseInvoice } from '../collection-chase.js';
import type { PayoutVoucher } from '../payout-workflow.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

const EMPTY_COUNTS: SetupCounts = {
  clients: 0, contracts: 0, projects: 0, invoices: 0, units: 0, subcontractors: 0, technicians: 0,
};

const FULL_COUNTS: SetupCounts = {
  clients: 3, contracts: 2, projects: 4, invoices: 9, units: 12, subcontractors: 3, technicians: 6,
};

function invoice(over: Partial<DashboardInvoice> = {}): DashboardInvoice {
  return {
    id: 'i1',
    invoiceNo: 'INV-00001',
    clientName: 'Sheger Mall',
    issuedAt: utc(2026, 9, 3),
    dueDate: utc(2026, 10, 3),
    netSantim: 1_000_000_00,
    vatSantim: 150_000_00,
    grossSantim: 1_150_000_00,
    status: 'issued',
    receipts: [],
    ...over,
  };
}

function project(over: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: 'p1',
    projectNo: 'PRJ-001',
    title: 'Bole Tower lifts',
    clientName: 'Addis Towers',
    status: 'in_progress',
    progressBps: 5000,
    plannedEnd: utc(2026, 12, 1),
    inDanger: false,
    severity: 'none',
    ...over,
  };
}

function inputs(over: Partial<DashboardInputs> = {}): DashboardInputs {
  return {
    asOf: NOW,
    counts: FULL_COUNTS,
    invoices: [invoice()],
    projects: [project()],
    vouchers: [],
    chase: [],
    alerts: [],
    unitsNeedingAttention: 0,
    ...over,
  };
}

describe('setupProgress', () => {
  it('knows a brand-new system from a quiet one', () => {
    const state = setupProgress(EMPTY_COUNTS);
    expect(state.empty).toBe(true);
    expect(state.ready).toBe(false);
    expect(state.completed).toBe(0);
  });

  it('puts clients first, because everything else hangs off one', () => {
    expect(setupProgress(EMPTY_COUNTS).nextStep?.key).toBe('clients');
    expect(setupProgress({ ...EMPTY_COUNTS, clients: 2 }).nextStep?.key).toBe('contracts');
  });

  it('is ready once the four records the money figures need exist', () => {
    const state = setupProgress({ ...EMPTY_COUNTS, clients: 1, contracts: 1, projects: 1, invoices: 1 });
    expect(state.ready).toBe(true);
    // Lifts and people are still outstanding, but no headline figure needs them.
    expect(state.nextStep?.key).toBe('units');
  });

  it('counts technicians and subcontractors as one step', () => {
    expect(setupProgress({ ...EMPTY_COUNTS, subcontractors: 1 }).steps.find((s) => s.key === 'people')?.done).toBe(true);
    expect(setupProgress({ ...EMPTY_COUNTS, technicians: 1 }).steps.find((s) => s.key === 'people')?.done).toBe(true);
  });

  it('gives every step a reason it comes where it does', () => {
    for (const step of setupProgress(EMPTY_COUNTS).steps) {
      expect(step.detail.length).toBeGreaterThan(30);
      expect(step.href).toMatch(/^\//);
    }
  });
});

describe('the empty dashboard says so rather than showing zeros', () => {
  it('leads with the checklist, not a total', () => {
    const model = buildDashboard(inputs({ counts: EMPTY_COUNTS, invoices: [], projects: [] }));

    expect(model.setup.empty).toBe(true);
    expect(model.headline[0]).toContain('Nothing has been entered yet');
    expect(model.headline[0]).toContain('the order to work through');
  });

  it('marks each figure as empty rather than zero', () => {
    const model = buildDashboard(inputs({ counts: EMPTY_COUNTS, invoices: [], projects: [] }));
    expect(model.money.every((f) => f.empty)).toBe(true);
  });

  it('says the figures are honest, not broken, while setup is half done', () => {
    const model = buildDashboard(
      inputs({ counts: { ...EMPTY_COUNTS, clients: 2, contracts: 1 }, invoices: [], projects: [] }),
    );
    expect(model.headline[0]).toContain('that is the system being honest, not broken');
  });
});

describe('the money figures', () => {
  it('counts only invoices issued in the current month', () => {
    const model = buildDashboard(
      inputs({ invoices: [invoice(), invoice({ id: 'i2', issuedAt: utc(2026, 7, 3) })] }),
    );
    expect(model.money.find((f) => f.key === 'invoiced')?.santim).toBe(1_000_000_00);
  });

  it('counts cash in the month it arrived, not the month it was invoiced', () => {
    const model = buildDashboard(
      inputs({
        invoices: [
          invoice({
            issuedAt: utc(2026, 6, 1),
            receipts: [{ receivedAt: utc(2026, 9, 10), amountGrossSantim: 1_150_000_00, clientWhtSantim: 0 }],
          }),
        ],
      }),
    );

    expect(model.money.find((f) => f.key === 'invoiced')?.santim).toBe(0);
    expect(model.money.find((f) => f.key === 'collected')?.santim).toBe(1_150_000_00);
  });

  it('excludes drafts and voids from everything', () => {
    const model = buildDashboard(
      inputs({ invoices: [invoice({ status: 'draft' }), invoice({ id: 'i2', status: 'void' })] }),
    );
    expect(model.money.find((f) => f.key === 'invoiced')?.santim).toBe(0);
    expect(model.ageing.totalSantim).toBe(0);
    expect(model.money.find((f) => f.key === 'outstanding')?.note).toBe('no issued invoices yet');
  });

  it('says what share of the debt is past due', () => {
    const model = buildDashboard(
      inputs({ invoices: [invoice({ dueDate: utc(2026, 7, 1), status: 'overdue' })] }),
    );
    expect(model.money.find((f) => f.key === 'outstanding')?.note).toContain('100% of it past due');
  });
});

describe('the headline', () => {
  const chased = (id: string, balance: number, steps: Parameters<typeof chaseState>[1]) => {
    const inv: ChaseInvoice = {
      id, invoiceNo: id, clientName: 'Client', issuedAt: utc(2026, 6, 1), dueDate: utc(2026, 7, 1),
      grossSantim: balance, balanceSantim: balance, status: 'overdue', receipts: [],
    };
    return { invoice: inv, state: chaseState(inv, steps, NOW) };
  };

  it('leads with money nobody has asked for', () => {
    const model = buildDashboard(inputs({ chase: [chased('a', 4_600_000_00, [])] }));
    expect(model.headline[0]).toContain('Nobody has asked for ETB 4.6m');
    expect(model.headline[0]).toContain('Asking is free');
  });

  it('names broken promises as a different problem from silence', () => {
    const model = buildDashboard(
      inputs({
        chase: [
          chased('a', 1_000_000_00, [
            { id: 's1', action: 'payment_request', at: utc(2026, 7, 2), byName: 'F', contactName: 'Bekele', note: '' },
            { id: 's2', action: 'promise_to_pay', at: utc(2026, 8, 1), byName: 'F', contactName: 'Bekele', note: '', promisedDate: utc(2026, 8, 20), promisedAmountSantim: 1_000_000_00 },
          ]),
        ],
      }),
    );
    expect(model.headline.join(' ')).toContain('named a payment date and missed it');
  });

  it('flags vouchers stuck past their step target', () => {
    const voucher: PayoutVoucher = {
      id: 'v1', voucherNo: 'PV-001', subcontractorName: 'Selam', projectId: 'p1', phaseName: 'Rails',
      status: 'requested', netSantim: 100, netPayableSantim: 100, supplierInvoiceDate: utc(2026, 8, 1),
      trail: { requestedAt: utc(2026, 8, 20), checkedAt: null, approvedAt: null, paidAt: null, rejectedAt: null, heldAt: null },
    };
    const model = buildDashboard(inputs({ vouchers: [voucher] }));
    expect(model.headline.join(' ')).toContain('Subcontractors notice before we do');
  });

  it('does not claim all is well when the records may simply be stale', () => {
    const model = buildDashboard(inputs());
    expect(model.headline[0]).toContain('rather than assuming a quiet week');
  });

  it('stays short enough to read', () => {
    const model = buildDashboard(
      inputs({
        chase: [chased('a', 4_600_000_00, [])],
        projects: [project({ inDanger: true, severity: 'high' }), project({ id: 'p2' })],
        invoices: [invoice({ dueDate: utc(2026, 1, 1), status: 'overdue' })],
      }),
    );
    expect(model.headline.length).toBeLessThanOrEqual(3);
  });
});

describe('delivery', () => {
  it('counts live, in danger and overdue separately', () => {
    const model = buildDashboard(
      inputs({
        projects: [
          project({ id: 'a', plannedEnd: utc(2026, 1, 1) }),
          project({ id: 'b', inDanger: true, severity: 'high' }),
          project({ id: 'c', status: 'on_hold' }),
        ],
        asOf: NOW,
      }),
    );

    expect(model.delivery.live).toBe(2);
    expect(model.delivery.overdue).toBe(1);
    expect(model.delivery.inDanger).toBe(1);
  });

  it('reports no average progress at all when nothing is live', () => {
    const model = buildDashboard(inputs({ projects: [project({ status: 'completed' })] }));
    expect(model.delivery.averageProgressBps).toBeNull();
  });
});

describe('alerts', () => {
  it('counts the severities that get someone out of their chair', () => {
    const model = buildDashboard(
      inputs({ alerts: [{ severity: 'critical' }, { severity: 'high' }, { severity: 'high' }, { severity: 'low' }] }),
    );
    expect(model.alerts).toEqual({ critical: 1, high: 2, total: 4 });
  });
});
