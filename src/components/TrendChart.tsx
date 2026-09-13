/**
 * Monthly revenue, cost and margin trend.
 *
 * FORM
 *   Revenue and cost are the same unit, so they share one axis as grouped bars.
 *   Margin is a percentage — a different scale — so it gets its OWN panel below,
 *   sharing the x-axis. It is never a second y-axis on the same plot: a
 *   dual-axis chart lets the author choose where the lines cross, which is to
 *   say it can be made to show anything.
 *
 * COLOR
 *   Categorical slots 1 and 2 from the validated palette (blue, orange), chosen
 *   for identity rather than magnitude. Both modes pass the lightness band,
 *   chroma floor, CVD separation, normal-vision floor and 3:1 contrast checks.
 *
 * IDENTITY IS NEVER COLOR ALONE
 *   A legend is always present, the final group is directly labelled, and a
 *   table view of the same numbers sits behind a toggle.
 */

import { useId, useMemo, useState } from 'react';
import { formatETB, santimToBirr } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import { ETHIOPIAN_MONTHS } from '../lib/ethiopic.js';
import type { PeriodRow } from '../lib/reporting.js';

const W = 760;
// `top` leaves room for the axis unit label above the first gridline; without
// it the unit collides with the topmost tick.
const PAD = { top: 30, right: 16, bottom: 26, left: 66 };
const BARS_H = 190;
const GAP = 34;
const MARGIN_H = 78;
const H = PAD.top + BARS_H + GAP + MARGIN_H + PAD.bottom;

const PLOT_W = W - PAD.left - PAD.right;
const BARS_Y0 = PAD.top;
const BARS_Y1 = PAD.top + BARS_H;
const MARGIN_Y0 = BARS_Y1 + GAP;
const MARGIN_Y1 = MARGIN_Y0 + MARGIN_H;

/** Compact ETB for an axis tick: 4.2M, 850k, 0. */
function compactBirr(santim: number): string {
  const birr = santimToBirr(santim);
  if (birr === 0) return '0';
  const abs = Math.abs(birr);
  if (abs >= 1_000_000) return `${(birr / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(birr / 1_000)}k`;
  return String(Math.round(birr));
}

/** Nice round ceiling for an axis, so ticks land on readable numbers. */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (value <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

/** A bar with rounded data-end, anchored square to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return '';
  const radius = Math.min(r, w / 2, h);
  return (
    `M${x},${y + h}` +
    `V${y + radius}` +
    `A${radius},${radius} 0 0 1 ${x + radius},${y}` +
    `H${x + w - radius}` +
    `A${radius},${radius} 0 0 1 ${x + w},${y + radius}` +
    `V${y + h}Z`
  );
}

export function TrendChart({ rows, title }: { rows: readonly PeriodRow[]; title: string }) {
  const baseId = useId();
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const geometry = useMemo(() => {
    const maxValue = niceMax(
      Math.max(1, ...rows.map((r) => Math.max(r.revenueNetSantim, r.costNetSantim))),
    );
    const band = rows.length > 0 ? PLOT_W / rows.length : PLOT_W;
    const groupPad = Math.min(10, band * 0.18);
    const barW = Math.max(3, (band - groupPad * 2 - 2) / 2); // 2px surface gap between the pair

    const marginValues = rows.map((r) => r.marginBps);
    const known = marginValues.filter((m): m is number => m !== null);
    const marginMax = niceMax(Math.max(1000, ...known.map((m) => Math.abs(m))));

    const yBar = (santim: number) => BARS_Y1 - (santim / maxValue) * BARS_H;
    // 8px of headroom top and bottom so an extreme month does not collide with
    // the bars above or the month labels below.
    const inset = 8;
    const yMargin = (bps: number) =>
      MARGIN_Y1 - inset - ((bps + marginMax) / (marginMax * 2)) * (MARGIN_H - inset * 2);

    return { maxValue, band, groupPad, barW, marginMax, yBar, yMargin };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <section className="card">
        <h2>{title}</h2>
        <p className="muted">No activity yet in this period.</p>
      </section>
    );
  }

  const { maxValue, band, groupPad, barW, marginMax, yBar, yMargin } = geometry;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxValue);

  // Break the margin line wherever a month has no revenue: a month with nothing
  // billed has no margin, and joining across it would draw a trend that never
  // happened.
  const segments: { i: number; x: number; y: number }[][] = [];
  let current: { i: number; x: number; y: number }[] = [];
  rows.forEach((row, i) => {
    if (row.marginBps === null) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    current.push({
      i,
      x: PAD.left + band * i + band / 2,
      y: yMargin(Math.max(-marginMax, Math.min(marginMax, row.marginBps))),
    });
  });
  if (current.length > 0) segments.push(current);

  const active = hovered === null ? null : rows[hovered] ?? null;
  const lastIndex = rows.length - 1;

  return (
    <section className="card viz-root">
      <div className="viz-head">
        <div>
          <h2>{title}</h2>
          <p className="muted">Revenue and subcontract cost, VAT-exclusive, by Ethiopian month.</p>
        </div>
        <button type="button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {/* Legend: always present for two or more series. */}
      <ul className="viz-legend">
        <li><span className="swatch swatch-revenue" aria-hidden="true" /> Revenue</li>
        <li><span className="swatch swatch-cost" aria-hidden="true" /> Subcontract cost</li>
        <li><span className="swatch swatch-margin" aria-hidden="true" /> Margin %</li>
      </ul>

      {showTable ? (
        <TrendTable rows={rows} />
      ) : (
        <div className="viz-frame">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-labelledby={`${baseId}-title`}
            className="trend-svg"
            onMouseLeave={() => setHovered(null)}
          >
            <title id={`${baseId}-title`}>
              {title}: revenue, subcontract cost and margin percentage across {rows.length} Ethiopian months.
            </title>

            {/* Recessive grid */}
            {ticks.map((tick) => (
              <g key={tick}>
                <line className="viz-grid" x1={PAD.left} x2={W - PAD.right} y1={yBar(tick)} y2={yBar(tick)} />
                <text className="viz-tick" x={PAD.left - 8} y={yBar(tick)} textAnchor="end" dominantBaseline="middle">
                  {compactBirr(tick)}
                </text>
              </g>
            ))}
            <text className="viz-axis-label" x={PAD.left - 8} y={BARS_Y0 - 12} textAnchor="end">ETB</text>

            {/* Zero line for the margin panel */}
            <line className="viz-grid viz-grid-strong" x1={PAD.left} x2={W - PAD.right} y1={yMargin(0)} y2={yMargin(0)} />
            <text className="viz-tick" x={PAD.left - 8} y={yMargin(0)} textAnchor="end" dominantBaseline="middle">0%</text>
            <text className="viz-tick" x={PAD.left - 8} y={yMargin(marginMax)} textAnchor="end" dominantBaseline="middle">
              {formatBps(marginMax, 0)}
            </text>

            {/* Bars */}
            {rows.map((row, i) => {
              const groupX = PAD.left + band * i + groupPad;
              return (
                <g key={row.periodEc} className={hovered !== null && hovered !== i ? 'viz-dim' : undefined}>
                  <path className="bar-revenue" d={barPath(groupX, yBar(row.revenueNetSantim), barW, BARS_Y1 - yBar(row.revenueNetSantim))} />
                  <path className="bar-cost" d={barPath(groupX + barW + 2, yBar(row.costNetSantim), barW, BARS_Y1 - yBar(row.costNetSantim))} />
                </g>
              );
            })}

            {/* Margin line, broken across months with no revenue */}
            {segments.map((segment) => (
              <polyline
                key={segment[0]!.i}
                className="margin-line"
                points={segment.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
              />
            ))}
            {segments.flat().map((point) => (
              <circle
                key={point.i}
                className={`margin-dot ${hovered !== null && hovered !== point.i ? 'viz-dim' : ''}`}
                cx={point.x}
                cy={point.y}
                r={4}
              />
            ))}

            {/* X labels: every month when there is room, otherwise every other. */}
            {rows.map((row, i) => {
              // A full Ethiopian year is 13 months and they all fit at this
              // width. Only drop to alternating labels beyond that, because
              // making a reader count bars to identify a month is worse than
              // a slightly crowded axis.
              if (rows.length > 13 && i % 2 === 1 && i !== lastIndex) return null;
              return (
                <text
                  key={row.periodEc}
                  className="viz-tick"
                  x={PAD.left + band * i + band / 2}
                  y={H - PAD.bottom + 14}
                  textAnchor="middle"
                >
                  {ETHIOPIAN_MONTHS[row.ecMonth - 1]?.slice(0, 3) ?? row.ecMonth}
                </text>
              );
            })}

            {/* Direct label on the final group, so identity never rests on colour alone. */}
            {rows.length > 0 && (
              <text
                className="viz-direct-label"
                x={PAD.left + band * lastIndex + band / 2}
                y={Math.max(BARS_Y0 + 10, yBar((rows[lastIndex] as PeriodRow).revenueNetSantim) - 6)}
                textAnchor="middle"
              >
                {compactBirr((rows[lastIndex] as PeriodRow).revenueNetSantim)}
              </text>
            )}

            {/* Hit targets, wider than the marks. */}
            {rows.map((row, i) => (
              <rect
                key={row.periodEc}
                x={PAD.left + band * i}
                y={BARS_Y0}
                width={band}
                height={MARGIN_Y1 - BARS_Y0}
                fill="transparent"
                onMouseEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                tabIndex={0}
                role="button"
                aria-label={`${ETHIOPIAN_MONTHS[row.ecMonth - 1] ?? ''} ${row.ecYear}: revenue ${formatETB(row.revenueNetSantim)}, cost ${formatETB(row.costNetSantim)}, margin ${formatBps(row.marginBps)}`}
              />
            ))}

            {hovered !== null && (
              <line
                className="viz-crosshair"
                x1={PAD.left + band * hovered + band / 2}
                x2={PAD.left + band * hovered + band / 2}
                y1={BARS_Y0}
                y2={MARGIN_Y1}
              />
            )}
          </svg>

          {/* A persistent readout rather than a floating tooltip: an overlay
              covers the very bars it describes, whichever side it flips to, and
              on a financial page the exact figures are the point. */}
          <div className="viz-readout" role="status" aria-live="polite">
            {active === null ? (
              <p className="muted">Hover or focus a month for its figures.</p>
            ) : (
              <>
                <strong>{ETHIOPIAN_MONTHS[active.ecMonth - 1]} {active.ecYear} EC</strong>
                <dl>
                  <div>
                    <dt><span className="swatch swatch-revenue" aria-hidden="true" /> Revenue</dt>
                    <dd>{formatETB(active.revenueNetSantim)}</dd>
                  </div>
                  <div>
                    <dt><span className="swatch swatch-cost" aria-hidden="true" /> Cost</dt>
                    <dd>{formatETB(active.costNetSantim)}</dd>
                  </div>
                  <div>
                    <dt><span className="swatch swatch-margin" aria-hidden="true" /> Margin</dt>
                    <dd>{formatETB(active.marginSantim)} · {formatBps(active.marginBps)}</dd>
                  </div>
                </dl>
                <p className="muted">
                  {active.invoices} invoice{active.invoices === 1 ? '' : 's'} · {active.vouchers} voucher
                  {active.vouchers === 1 ? '' : 's'}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** The same numbers as a table — the accessible equivalent of the plot. */
function TrendTable({ rows }: { rows: readonly PeriodRow[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="num">Revenue</th>
            <th scope="col" className="num">Cost</th>
            <th scope="col" className="num">Margin</th>
            <th scope="col" className="num">Margin %</th>
            <th scope="col" className="num">Net VAT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.periodEc}>
              <td>{ETHIOPIAN_MONTHS[row.ecMonth - 1]} {row.ecYear}</td>
              <td className="num">{formatETB(row.revenueNetSantim, { withSymbol: false })}</td>
              <td className="num">{formatETB(row.costNetSantim, { withSymbol: false })}</td>
              <td className="num">{formatETB(row.marginSantim, { withSymbol: false })}</td>
              <td className="num">{formatBps(row.marginBps)}</td>
              <td className="num muted">{formatETB(row.netVatPayableSantim, { withSymbol: false })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
