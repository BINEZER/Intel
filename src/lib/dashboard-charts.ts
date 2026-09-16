/**
 * The three charts on the dashboard.
 *
 * WHY A LIBRARY AND NOT JSX
 *   Deciding which six months to draw, which invoices count as billed, and how
 *   to collapse a hundred debtors into six bars is arithmetic, and arithmetic
 *   belongs where a test can reach it. The page then only renders.
 *
 * WHY THESE THREE
 *   Each answers a different question a person actually has, and no two answer
 *   the same one:
 *     1. Is the business making money?      — invoiced against cost, by month
 *     2. Is the money coming in?            — receivables by age
 *     3. Who do I call?                     — the largest debtors, named
 *   A fourth chart of the same shape would be decoration.
 *
 * COLOUR
 *   Chart 1 is two IDENTITIES of the same unit, so one axis and the fixed
 *   categorical slots 1 and 2. Chart 2's categories are ORDERED by age, so one
 *   hue stepped light to dark. Chart 3 is a single series — the title names it,
 *   and no legend is drawn. None of them cycles a hue.
 */

import type { ChartSpec, SeriesPoint } from './ceo-report.js';
import { GREGORIAN_MONTHS_SHORT } from './ethiopic.js';
import { formatETB } from './money.js';

/** How many months of history the trend draws. */
export const TREND_MONTHS = 6;

/**
 * How many debtors get their own bar before the rest are folded together.
 *
 * Four, plus the fold — five columns. The dashboard draws this chart in a
 * half-width card, which leaves about 73px per column, and a client name needs
 * most of that. Measured, not guessed: at six bars "Bole Heights" ran into
 * "Kality Logistics", and an axis you cannot read is worse than a shorter list.
 * Everyone owing anything is still on the Collections page.
 */
export const DEBTOR_BARS = 4;

export interface ChartInvoice {
  issuedAt: Date;
  netSantim: number;
  status: string;
}

export interface ChartVoucher {
  /** The supplier's invoice date — when the cost was incurred, not when paid. */
  incurredAt: Date;
  netSantim: number;
  status: string;
}

export interface ChartDebt {
  clientName: string;
  balanceSantim: number;
}

/** Draft and void invoices are not revenue; they are paperwork. */
function isBilled(status: string): boolean {
  return status !== 'draft' && status !== 'void';
}

/** A cost only exists once somebody has agreed to pay it. */
function isCommitted(status: string): boolean {
  return status === 'approved' || status === 'paid';
}

/** The first of the month containing `at`, in UTC, so months never straddle. */
function monthStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

function monthKey(at: Date): string {
  return `${at.getUTCFullYear()}-${at.getUTCMonth()}`;
}

/**
 * The trailing `count` months ending with the one containing `asOf`, oldest
 * first.
 *
 * Every month is emitted, including the quiet ones. A trend that skips an empty
 * month draws a smooth line over a gap, which is the one distortion a trend
 * must never have: in this business a month with nothing invoiced is a month
 * nothing shipped, and that is the fact worth seeing.
 */
export function trailingMonths(asOf: Date, count = TREND_MONTHS): Date[] {
  const last = monthStart(asOf);
  const months: Date[] = [];
  for (let back = count - 1; back >= 0; back--) {
    months.push(new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - back, 1)));
  }
  return months;
}

export function cashflowPoints(
  invoices: readonly ChartInvoice[],
  vouchers: readonly ChartVoucher[],
  asOf: Date,
  count = TREND_MONTHS,
): SeriesPoint[] {
  const months = trailingMonths(asOf, count);
  const invoiced = new Map<string, number>();
  const cost = new Map<string, number>();

  for (const invoice of invoices) {
    if (!isBilled(invoice.status)) continue;
    const key = monthKey(monthStart(invoice.issuedAt));
    invoiced.set(key, (invoiced.get(key) ?? 0) + invoice.netSantim);
  }
  for (const voucher of vouchers) {
    if (!isCommitted(voucher.status)) continue;
    const key = monthKey(monthStart(voucher.incurredAt));
    cost.set(key, (cost.get(key) ?? 0) + voucher.netSantim);
  }

  return months.map((month) => {
    const key = monthKey(month);
    const short = GREGORIAN_MONTHS_SHORT[month.getUTCMonth()] as string;
    return {
      label: `${short} ${month.getUTCFullYear()}`,
      // January carries its year so the axis says where the year turned over;
      // repeating it on all six would just be noise.
      shortLabel: month.getUTCMonth() === 0 ? `${short} ${String(month.getUTCFullYear()).slice(2)}` : short,
      values: { invoiced: invoiced.get(key) ?? 0, cost: cost.get(key) ?? 0 },
    };
  });
}

export function cashflowChart(
  invoices: readonly ChartInvoice[],
  vouchers: readonly ChartVoucher[],
  asOf: Date,
): ChartSpec {
  const points = cashflowPoints(invoices, vouchers, asOf);
  const latest = points[points.length - 1];
  const invoicedNow = latest?.values.invoiced ?? 0;
  const costNow = latest?.values.cost ?? 0;

  return {
    id: 'dash-cashflow',
    kind: 'grouped_bars',
    title: 'Invoiced and spent, last six months',
    // The subtitle says what to take from the chart. Restating the axes would
    // tell a reader who can already see them nothing.
    subtitle:
      invoicedNow === 0 && costNow === 0
        ? 'Nothing invoiced or committed this month'
        : costNow > invoicedNow
          ? 'Subcontractor cost is ahead of billing this month'
          : 'The gap between the bars is what the month left behind',
    series: [
      { key: 'invoiced', label: 'Invoiced (net of VAT)' },
      { key: 'cost', label: 'Subcontractor cost' },
    ],
    palette: 'categorical',
    unit: 'santim',
    points,
  };
}

const BUCKET_ORDER = ['current', '1_30', '31_60', '61_90', 'over_90'] as const;
const BUCKET_LABEL: Record<(typeof BUCKET_ORDER)[number], string> = {
  current: 'Not yet due',
  '1_30': '1–30 days late',
  '31_60': '31–60 days late',
  '61_90': '61–90 days late',
  over_90: 'Over 90 days late',
};
const BUCKET_SHORT: Record<(typeof BUCKET_ORDER)[number], string> = {
  current: 'Current',
  '1_30': '1–30',
  '31_60': '31–60',
  '61_90': '61–90',
  over_90: '90+',
};

export function ageingChart(byBucket: Record<string, number>): ChartSpec {
  const over90 = byBucket.over_90 ?? 0;
  return {
    id: 'dash-ageing',
    kind: 'bars',
    title: 'Owed to us, by how late it is',
    subtitle:
      over90 > 0
        ? `${formatETB(over90)} has aged past ninety days`
        : 'Nothing has aged past ninety days',
    series: [{ key: 'balance', label: 'Outstanding' }],
    palette: 'ordinal',
    unit: 'santim',
    points: BUCKET_ORDER.map((bucket) => ({
      label: BUCKET_LABEL[bucket],
      shortLabel: BUCKET_SHORT[bucket],
      values: { balance: byBucket[bucket] ?? 0 },
    })),
  };
}

/**
 * The largest debtors, by name.
 *
 * Folded rather than truncated: the tail becomes one "Everyone else" bar so the
 * chart still adds up to the total owed. Dropping the tail would make the chart
 * disagree with the tile above it, and the reader would have no way to tell
 * which of the two was lying.
 */
/**
 * The axis form of a client's name.
 *
 * Cut at a word boundary where there is one in range: "Adera Hospital" tells a
 * reader who it is, "Adera Hospi…" makes them work it out. The full name stays
 * on the bar's label and in the table view.
 */
function axisName(name: string, max = 11): string {
  if (name.length <= max) return name;
  const space = name.slice(0, max + 1).lastIndexOf(' ');
  // A word boundary is only worth taking if it leaves most of the room used;
  // cutting "Bole Heights Real Estate" at its first space gives "Bole", which
  // is the same label another Bole client would get.
  return space >= Math.ceil(max * 0.6) ? name.slice(0, space) : `${name.slice(0, max - 1)}…`;
}

export function debtorPoints(debts: readonly ChartDebt[], bars = DEBTOR_BARS): SeriesPoint[] {
  const byClient = new Map<string, number>();
  for (const debt of debts) {
    if (debt.balanceSantim <= 0) continue;
    byClient.set(debt.clientName, (byClient.get(debt.clientName) ?? 0) + debt.balanceSantim);
  }

  const sorted = [...byClient.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, bars);
  const tail = sorted.slice(bars);

  const points: SeriesPoint[] = head.map(([name, santim]) => ({
    label: name,
    shortLabel: axisName(name),
    values: { balance: santim },
  }));

  if (tail.length > 0) {
    points.push({
      label: `Everyone else (${tail.length})`,
      shortLabel: `+${tail.length} more`,
      values: { balance: tail.reduce((a, [, santim]) => a + santim, 0) },
    });
  }
  return points;
}

export function debtorsChart(debts: readonly ChartDebt[]): ChartSpec {
  const points = debtorPoints(debts);
  const biggest = points[0];
  return {
    id: 'dash-debtors',
    kind: 'bars',
    title: 'Who owes the most',
    subtitle:
      biggest === undefined
        ? 'Nobody owes anything'
        : `Start with ${biggest.label} — ${formatETB(biggest.values.balance ?? 0)}`,
    series: [{ key: 'balance', label: 'Outstanding' }],
    // One series needs no hue assignment; the title names what the bars are.
    palette: 'single',
    unit: 'santim',
    points,
  };
}
