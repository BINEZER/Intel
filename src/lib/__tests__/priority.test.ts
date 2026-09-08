import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRIORITY_CONFIG,
  milestoneExpectedValue,
  portfolioTotals,
  rankProjects,
  scoreProject,
  splitReceivables,
  type InvoiceReceivable,
  type PriorityInput,
  type UpcomingMilestone,
} from '../priority.js';
import { summarise } from '../risk.js';
import { birrToSantim } from '../money.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const ETB = birrToSantim;
const NOW = utc(2025, 9, 11);
const noRisk = summarise([]);

const invoice = (over: Partial<InvoiceReceivable> = {}): InvoiceReceivable => ({
  grossSantim: ETB(100_000),
  paidGrossSantim: 0,
  dueDate: utc(2025, 8, 1),
  status: 'issued',
  ...over,
});

describe('splitReceivables', () => {
  it('separates overdue from current and finds the oldest', () => {
    const r = splitReceivables(
      [
        invoice({ dueDate: utc(2025, 6, 1), grossSantim: ETB(200_000) }), // 102 days overdue
        invoice({ dueDate: utc(2025, 8, 20), grossSantim: ETB(100_000) }), // 22 days overdue
        invoice({ dueDate: utc(2025, 10, 5), grossSantim: ETB(50_000) }),  // not yet due
      ],
      NOW,
    );
    expect(r.overdueSantim).toBe(ETB(300_000));
    expect(r.currentSantim).toBe(ETB(50_000));
    expect(r.oldestOverdueDays).toBe(102);
  });

  it('counts only the unpaid balance of a part-paid invoice', () => {
    const r = splitReceivables(
      [invoice({ grossSantim: ETB(100_000), paidGrossSantim: ETB(60_000), status: 'partially_paid' })],
      NOW,
    );
    expect(r.overdueSantim).toBe(ETB(40_000));
  });

  it('ignores drafts, voids and settled invoices', () => {
    const r = splitReceivables(
      [
        invoice({ status: 'draft' }),
        invoice({ status: 'void' }),
        invoice({ status: 'paid', paidGrossSantim: ETB(100_000) }),
      ],
      NOW,
    );
    expect(r.overdueSantim).toBe(0);
    expect(r.currentSantim).toBe(0);
    expect(r.oldestOverdueDays).toBeNull();
  });
});

describe('milestoneExpectedValue', () => {
  const milestone = (over: Partial<UpcomingMilestone> = {}): UpcomingMilestone => ({
    name: 'On handover',
    grossSantim: ETB(1_000_000),
    status: 'pending',
    dueDate: utc(2025, 10, 11), // 30 days out
    gatingPhaseProgressBps: 10_000,
    ...over,
  });

  it('counts a ready-to-invoice milestone at full value', () => {
    // Nothing stands between it and a bill, so it is not discounted.
    expect(milestoneExpectedValue(milestone({ status: 'ready_to_invoice', gatingPhaseProgressBps: 0 }), NOW, 90))
      .toBe(ETB(1_000_000));
  });

  it('counts nothing for a milestone already invoiced or paid', () => {
    expect(milestoneExpectedValue(milestone({ status: 'invoiced' }), NOW, 90)).toBe(0);
    expect(milestoneExpectedValue(milestone({ status: 'paid' }), NOW, 90)).toBe(0);
    expect(milestoneExpectedValue(milestone({ status: 'waived' }), NOW, 90)).toBe(0);
  });

  it('discounts by how far the gating phase has to go', () => {
    // A milestone behind a phase at 10% is a hope, not cash.
    const nearlyDone = milestoneExpectedValue(milestone({ gatingPhaseProgressBps: 9000 }), NOW, 90);
    const barelyStarted = milestoneExpectedValue(milestone({ gatingPhaseProgressBps: 1000 }), NOW, 90);
    expect(nearlyDone).toBeGreaterThan(barelyStarted * 8);
  });

  it('discounts by distance to the due date', () => {
    const soon = milestoneExpectedValue(milestone({ dueDate: utc(2025, 9, 20) }), NOW, 90);
    const later = milestoneExpectedValue(milestone({ dueDate: utc(2025, 11, 20) }), NOW, 90);
    expect(soon).toBeGreaterThan(later);
  });

  it('counts an already-due milestone at full imminence', () => {
    expect(milestoneExpectedValue(milestone({ dueDate: utc(2025, 8, 1) }), NOW, 90)).toBe(ETB(1_000_000));
  });

  it('excludes a milestone beyond the horizon', () => {
    expect(milestoneExpectedValue(milestone({ dueDate: utc(2026, 6, 1) }), NOW, 90)).toBe(0);
  });

  it('treats an ungated milestone as fully attainable', () => {
    const gated = milestoneExpectedValue(milestone({ gatingPhaseProgressBps: 5000 }), NOW, 90);
    const ungated = milestoneExpectedValue(milestone({ gatingPhaseProgressBps: null }), NOW, 90);
    expect(ungated).toBeGreaterThan(gated);
  });
});

describe('scoreProject', () => {
  const project = (over: Partial<PriorityInput> = {}): PriorityInput => ({
    projectId: 'p1',
    title: 'Bole Tower',
    clientName: 'Acme',
    contractNetSantim: ETB(4_000_000),
    contractGrossSantim: ETB(4_600_000),
    invoicedGrossSantim: ETB(2_300_000),
    invoices: [],
    milestones: [],
    risk: noRisk,
    ...over,
  });

  it('reports the three cash pools separately', () => {
    const p = scoreProject(
      project({
        invoices: [
          invoice({ dueDate: utc(2025, 6, 1), grossSantim: ETB(500_000) }),
          invoice({ dueDate: utc(2025, 12, 1), grossSantim: ETB(300_000) }),
        ],
        milestones: [
          { name: 'Handover', grossSantim: ETB(1_000_000), status: 'ready_to_invoice', dueDate: null, gatingPhaseProgressBps: null },
        ],
      }),
      NOW,
    );
    expect(p.overdueReceivableSantim).toBe(ETB(500_000));
    expect(p.currentReceivableSantim).toBe(ETB(300_000));
    expect(p.nearTermBillableSantim).toBe(ETB(1_000_000));
    expect(p.expectedReceivableSantim).toBe(ETB(1_800_000));
    expect(p.unbilledContractSantim).toBe(ETB(2_300_000));
  });

  it('ranks overdue money above upcoming money of the same size', () => {
    const overdue = scoreProject(
      project({ invoices: [invoice({ dueDate: utc(2025, 6, 1), grossSantim: ETB(1_000_000) })] }),
      NOW,
    );
    const upcoming = scoreProject(
      project({
        milestones: [{ name: 'M', grossSantim: ETB(1_000_000), status: 'ready_to_invoice', dueDate: null, gatingPhaseProgressBps: null }],
      }),
      NOW,
    );
    // Same ETB, but overdue is already earned — cheapest cash to recover.
    expect(overdue.impactScoreBps).toBeGreaterThan(upcoming.impactScoreBps);
  });

  it('lifts a project up the ranking for risk', () => {
    const invoices = [invoice({ dueDate: utc(2025, 8, 1), grossSantim: ETB(500_000) })];
    const calm = scoreProject(project({ invoices }), NOW);
    const risky = scoreProject(
      project({
        invoices,
        risk: summarise([
          { code: 'margin_negative', severity: 'critical', message: 'x' },
          { code: 'stalled_progress', severity: 'high', message: 'y' },
        ]),
      }),
      NOW,
    );
    expect(risky.impactScoreBps).toBeGreaterThan(calm.impactScoreBps);
  });

  it('explains itself through drivers', () => {
    const p = scoreProject(
      project({ invoices: [invoice({ dueDate: utc(2025, 5, 1), grossSantim: ETB(500_000) })] }),
      NOW,
    );
    const overdueDriver = p.drivers.find((d) => d.label === 'Overdue');
    expect(overdueDriver).toBeDefined();
    expect(overdueDriver!.amountSantim).toBe(ETB(500_000));
    expect(overdueDriver!.note).toMatch(/days past due/);
  });

  it('does not divide by zero on a valueless contract', () => {
    const p = scoreProject(project({ contractGrossSantim: 0, invoicedGrossSantim: 0 }), NOW);
    expect(p.impactScoreBps).toBe(0);
    expect(p.unbilledContractSantim).toBe(0);
  });
});

describe('rankProjects', () => {
  const base = {
    contractNetSantim: ETB(4_000_000),
    contractGrossSantim: ETB(4_600_000),
    invoicedGrossSantim: ETB(2_300_000),
    milestones: [],
    risk: noRisk,
  };

  it('orders by impact and assigns ranks from 1', () => {
    const ranked = rankProjects(
      [
        { ...base, projectId: 'quiet', title: 'Quiet', clientName: 'A', invoices: [] },
        {
          ...base,
          projectId: 'chasing',
          title: 'Chasing',
          clientName: 'B',
          invoices: [invoice({ dueDate: utc(2025, 4, 1), grossSantim: ETB(2_000_000) })],
        },
      ],
      NOW,
    );
    expect(ranked[0]!.projectId).toBe('chasing');
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[1]!.rank).toBe(2);
  });

  it('normalises by contract size so a small project in trouble can outrank a large calm one', () => {
    const ranked = rankProjects(
      [
        {
          // Large project, small share at stake.
          projectId: 'large', title: 'Large', clientName: 'A',
          contractNetSantim: ETB(40_000_000), contractGrossSantim: ETB(46_000_000),
          invoicedGrossSantim: ETB(4_000_000), milestones: [], risk: noRisk,
          invoices: [invoice({ dueDate: utc(2025, 8, 1), grossSantim: ETB(1_000_000) })],
        },
        {
          // Small project, most of its value overdue.
          projectId: 'small', title: 'Small', clientName: 'B',
          contractNetSantim: ETB(2_000_000), contractGrossSantim: ETB(2_300_000),
          invoicedGrossSantim: ETB(2_300_000), milestones: [], risk: noRisk,
          invoices: [invoice({ dueDate: utc(2025, 5, 1), grossSantim: ETB(2_000_000) })],
        },
      ],
      NOW,
    );
    expect(ranked[0]!.projectId).toBe('small');
  });

  it('breaks a tie on the larger absolute cheque', () => {
    const shared = { ...base, milestones: [], risk: noRisk };
    const ranked = rankProjects(
      [
        { ...shared, projectId: 'smaller', title: 'S', clientName: 'A', invoices: [invoice({ dueDate: utc(2025, 5, 1), grossSantim: ETB(2_300_000) })] },
        { ...shared, projectId: 'bigger', title: 'B', clientName: 'B', contractGrossSantim: ETB(4_600_000), invoices: [invoice({ dueDate: utc(2025, 5, 1), grossSantim: ETB(4_600_000) })] },
      ],
      NOW,
    );
    expect(ranked[0]!.projectId).toBe('bigger');
  });

  it('handles an empty portfolio', () => {
    expect(rankProjects([], NOW)).toEqual([]);
  });
});

describe('portfolioTotals', () => {
  it('sums the pools and counts endangered projects', () => {
    const ranked = rankProjects(
      [
        {
          projectId: 'a', title: 'A', clientName: 'X',
          contractNetSantim: ETB(1_000_000), contractGrossSantim: ETB(1_150_000),
          invoicedGrossSantim: ETB(500_000), milestones: [],
          invoices: [invoice({ dueDate: utc(2025, 5, 1), grossSantim: ETB(400_000) })],
          risk: summarise([{ code: 'margin_negative', severity: 'critical', message: 'x' }]),
        },
        {
          projectId: 'b', title: 'B', clientName: 'Y',
          contractNetSantim: ETB(1_000_000), contractGrossSantim: ETB(1_150_000),
          invoicedGrossSantim: ETB(500_000), milestones: [], invoices: [], risk: noRisk,
        },
      ],
      NOW,
    );
    const totals = portfolioTotals(ranked);
    expect(totals.projects).toBe(2);
    expect(totals.inDanger).toBe(1);
    expect(totals.overdueReceivableSantim).toBe(ETB(400_000));
  });
});

describe('config is honoured', () => {
  it('shrinks the horizon when configured', () => {
    const milestone: UpcomingMilestone = {
      name: 'M', grossSantim: ETB(1_000_000), status: 'pending',
      dueDate: utc(2025, 11, 1), gatingPhaseProgressBps: 10_000,
    };
    const wide = milestoneExpectedValue(milestone, NOW, DEFAULT_PRIORITY_CONFIG.horizonDays);
    const narrow = milestoneExpectedValue(milestone, NOW, 30);
    expect(wide).toBeGreaterThan(0);
    expect(narrow).toBe(0); // beyond a 30-day horizon
  });
});
