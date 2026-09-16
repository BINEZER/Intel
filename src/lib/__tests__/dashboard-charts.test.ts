import { describe, expect, it } from 'vitest';
import {
  ageingChart,
  cashflowChart,
  cashflowPoints,
  debtorPoints,
  debtorsChart,
  trailingMonths,
} from '../dashboard-charts.js';

const ASOF = new Date(Date.UTC(2026, 8, 16)); // 16 Sep 2026
const at = (y: number, m: number, d = 10) => new Date(Date.UTC(y, m, d));

describe('which months get drawn', () => {
  it('ends with the month we are in and runs six back', () => {
    const months = trailingMonths(ASOF);
    expect(months).toHaveLength(6);
    expect(months[0]).toEqual(at(2026, 3, 1));
    expect(months[5]).toEqual(at(2026, 8, 1));
  });

  it('crosses a year boundary without skipping a month', () => {
    const months = trailingMonths(at(2026, 1, 5));
    expect(months.map((m) => m.getUTCMonth())).toEqual([8, 9, 10, 11, 0, 1]);
    expect(months[0]!.getUTCFullYear()).toBe(2025);
  });
});

describe('invoiced against cost', () => {
  const invoices = [
    { issuedAt: at(2026, 8), netSantim: 500_000_00, status: 'issued' },
    { issuedAt: at(2026, 7), netSantim: 200_000_00, status: 'paid' },
  ];
  const vouchers = [{ incurredAt: at(2026, 8), netSantim: 300_000_00, status: 'paid' }];

  it('puts each figure in the month it belongs to', () => {
    const points = cashflowPoints(invoices, vouchers, ASOF);
    expect(points[5]!.values).toEqual({ invoiced: 500_000_00, cost: 300_000_00 });
    expect(points[4]!.values).toEqual({ invoiced: 200_000_00, cost: 0 });
  });

  it('draws a quiet month as quiet rather than skipping it', () => {
    // A trend that omits an empty month draws a smooth line over a gap — and a
    // month with nothing invoiced is a month nothing shipped.
    const points = cashflowPoints(invoices, vouchers, ASOF);
    expect(points).toHaveLength(6);
    expect(points[0]!.values).toEqual({ invoiced: 0, cost: 0 });
  });

  it('leaves drafts and voids out of revenue', () => {
    const points = cashflowPoints(
      [
        { issuedAt: at(2026, 8), netSantim: 900_000_00, status: 'draft' },
        { issuedAt: at(2026, 8), netSantim: 900_000_00, status: 'void' },
      ],
      [],
      ASOF,
    );
    expect(points[5]!.values.invoiced).toBe(0);
  });

  it('counts a cost only once somebody has agreed to pay it', () => {
    for (const status of ['draft', 'requested', 'rejected']) {
      const points = cashflowPoints([], [{ incurredAt: at(2026, 8), netSantim: 1_00, status }], ASOF);
      expect(points[5]!.values.cost).toBe(0);
    }
  });

  it('ignores anything older than the window', () => {
    const points = cashflowPoints([{ issuedAt: at(2024, 1), netSantim: 1_000_00, status: 'issued' }], [], ASOF);
    expect(points.every((p) => p.values.invoiced === 0)).toBe(true);
  });

  it('carries the year on January only, so the axis says where it turned over', () => {
    const points = cashflowPoints([], [], at(2026, 1, 5));
    expect(points.map((p) => p.shortLabel)).toEqual(['Sep', 'Oct', 'Nov', 'Dec', 'Jan 26', 'Feb']);
  });

  it('says plainly when cost is running ahead of billing', () => {
    const spec = cashflowChart(
      [{ issuedAt: at(2026, 8), netSantim: 100_00, status: 'issued' }],
      [{ incurredAt: at(2026, 8), netSantim: 900_00, status: 'paid' }],
      ASOF,
    );
    expect(spec.subtitle).toContain('ahead of billing');
  });

  it('uses two fixed categorical slots and one axis', () => {
    const spec = cashflowChart([], [], ASOF);
    expect(spec.palette).toBe('categorical');
    expect(spec.series).toHaveLength(2);
    expect(spec.unit).toBe('santim');
  });
});

describe('receivables by age', () => {
  it('keeps the buckets in age order, oldest last', () => {
    const spec = ageingChart({ current: 5, '1_30': 4, '31_60': 3, '61_90': 2, over_90: 1 });
    expect(spec.points.map((p) => p.shortLabel)).toEqual(['Current', '1–30', '31–60', '61–90', '90+']);
    expect(spec.palette).toBe('ordinal');
  });

  it('leads with the aged debt when there is any', () => {
    expect(ageingChart({ over_90: 250_000_00 }).subtitle).toContain('250,000');
    expect(ageingChart({}).subtitle).toContain('Nothing has aged');
  });
});

describe('who owes the most', () => {
  const debts = [
    { clientName: 'Adera', balanceSantim: 100_00 },
    { clientName: 'Adera', balanceSantim: 50_00 },
    { clientName: 'Bole', balanceSantim: 400_00 },
    { clientName: 'Nothing owed', balanceSantim: 0 },
  ];

  it('adds up every unpaid invoice a client has', () => {
    const points = debtorPoints(debts);
    expect(points[0]).toMatchObject({ label: 'Bole', values: { balance: 400_00 } });
    expect(points[1]!.values.balance).toBe(150_00);
  });

  it('leaves out anybody who owes nothing', () => {
    expect(debtorPoints(debts).some((p) => p.label === 'Nothing owed')).toBe(false);
  });

  it('folds the tail rather than dropping it, so the chart still adds up', () => {
    // Truncating would make the chart disagree with the "owed to us" tile above
    // it, and a reader would have no way to tell which of the two was lying.
    const many = Array.from({ length: 10 }, (_, i) => ({
      clientName: `Client ${i}`,
      balanceSantim: (10 - i) * 1_000_00,
    }));
    const points = debtorPoints(many, 4);
    expect(points).toHaveLength(5);
    expect(points[4]!.label).toBe('Everyone else (6)');
    expect(points.reduce((a, p) => a + (p.values.balance ?? 0), 0)).toBe(
      many.reduce((a, d) => a + d.balanceSantim, 0),
    );
  });

  it('does not add a fold bar when everybody fits', () => {
    expect(debtorPoints(debts, 4)).toHaveLength(2);
  });

  it('cuts a long axis label at a word, and keeps the name whole on the bar', () => {
    const [point] = debtorPoints([{ clientName: 'Sheger Mall S.C.', balanceSantim: 1 }]);
    expect(point!.label).toBe('Sheger Mall S.C.');
    expect(point!.shortLabel).toBe('Sheger Mall');
  });

  it('refuses a word boundary that throws away most of the label', () => {
    // "Bole Heights Real Estate" cut at its first space is "Bole", which is the
    // label another Bole client would get too.
    const [point] = debtorPoints([{ clientName: 'Bole Heights Real Estate', balanceSantim: 1 }]);
    expect(point!.shortLabel).toBe('Bole Heigh…');
  });

  it('falls back to an ellipsis where there is no word boundary at all', () => {
    const [point] = debtorPoints([{ clientName: 'Bahirdarconstruction', balanceSantim: 1 }]);
    expect(point!.shortLabel).toBe('Bahirdarco…');
  });

  it('names where to start, and says so plainly when there is nowhere', () => {
    expect(debtorsChart(debts).subtitle).toContain('Start with Bole');
    expect(debtorsChart([]).subtitle).toBe('Nobody owes anything');
    expect(debtorsChart([]).palette).toBe('single');
  });
});
