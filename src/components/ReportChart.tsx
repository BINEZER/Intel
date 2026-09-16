/**
 * Charts for the CEO report.
 *
 * FORM
 *   Every chart here compares magnitudes across a handful of named categories,
 *   which is a bar chart's job and nothing else's. Revenue against cost is two
 *   series of the SAME unit, so they share one axis as grouped bars. Margin is a
 *   percentage — a different scale — and is reported as a figure in the metric
 *   tiles rather than as a second y-axis: a dual-axis chart lets the author
 *   choose where the lines cross, which is to say it can be made to show anything.
 *
 * COLOR
 *   Three different jobs, three rules.
 *     categorical — revenue and cost are identities, not magnitudes. Slots 1 and
 *                   2 of the validated palette (blue, orange). ΔE 29.0 protan,
 *                   28.7 tritan, 33.8 normal vision, both above 3:1 on surface.
 *     ordinal     — receivables buckets are ORDERED by age, so one hue stepped
 *                   light to dark carries the order. Validated as an ordinal
 *                   ramp in both modes: monotone lightness, ΔL ≥ 0.06 between
 *                   steps, light end clearing 2:1 against its surface.
 *     single      — one series needs no hue assignment at all; the title names it.
 *
 * IDENTITY IS NEVER COLOR ALONE
 *   Two series get a legend AND a direct label on the final group. Every chart
 *   has a table view behind a toggle, and hovering or tab-focusing a bar writes
 *   its exact figure into a readout UNDER the plot rather than a floating panel
 *   that covers the bars it is describing.
 */

import { useId, useLayoutEffect, useState } from 'react';
import { formatETB } from '../lib/money.js';
import { compactBirr, type ChartSpec } from '../lib/ceo-report.js';

/**
 * GEOMETRY AND WHY THERE ARE TWO
 *
 * An SVG with a fixed viewBox scales its text along with its marks. The report
 * geometry (720 wide) rendered into a half-width dashboard card put the axis
 * labels at SIX AND A HALF PIXELS — measured, not guessed. A chart whose axis
 * cannot be read is a decoration.
 *
 * So the narrow slot gets its own viewBox rather than a shrunken copy of the
 * wide one: fewer pixels of padding, a shorter plot, and a viewBox close enough
 * to the rendered width that text lands near its declared size.
 */
type ChartSize = 'full' | 'compact';

interface Geometry {
  W: number;
  H: number;
  PAD: { top: number; right: number; bottom: number; left: number };
  PLOT_H: number;
  PLOT_W: number;
  Y0: number;
  Y1: number;
  maxBarW: number;
}

function geometry(size: ChartSize): Geometry {
  const W = size === 'compact' ? 430 : 720;
  const PAD =
    size === 'compact'
      ? { top: 32, right: 10, bottom: 42, left: 52 }
      : { top: 28, right: 18, bottom: 54, left: 74 };
  const PLOT_H = size === 'compact' ? 150 : 210;
  return {
    W, PAD, PLOT_H,
    H: PAD.top + PLOT_H + PAD.bottom,
    PLOT_W: W - PAD.left - PAD.right,
    Y0: PAD.top,
    Y1: PAD.top + PLOT_H,
    maxBarW: size === 'compact' ? 34 : 46,
  };
}

/** Rounded only at the data end; the baseline end stays square and anchored. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return '';
  return [
    `M${x} ${y + h}`,
    `V${y + radius}`,
    `a${radius} ${radius} 0 0 1 ${radius} ${-radius}`,
    `h${w - radius * 2}`,
    `a${radius} ${radius} 0 0 1 ${radius} ${radius}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

/** A tick scale that lands on round numbers rather than on the data's maximum. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
  return ticks;
}

/**
 * Below this many pixels of rendered width the wide geometry's text falls under
 * about 9px, so the chart switches to the compact one. Measured against the
 * 720-wide viewBox: 560px is where 11px declared text stops rendering at 9px.
 */
const COMPACT_BELOW_PX = 560;

/**
 * Pick the geometry from how much room the chart actually got.
 *
 * A media query would be guessing: the same breakpoint puts this chart in a
 * full-width card on one page and a half-width one on another, and it is the
 * CARD's width that decides whether the axis can be read.
 */
function useFittedSize(explicit: ChartSize | undefined): [ChartSize, (el: HTMLElement | null) => void] {
  const [element, attach] = useState<HTMLElement | null>(null);
  const [measured, setMeasured] = useState<ChartSize>('full');

  useLayoutEffect(() => {
    if (explicit !== undefined || element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      setMeasured(entry.contentRect.width < COMPACT_BELOW_PX ? 'compact' : 'full');
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [explicit, element]);

  return [explicit ?? measured, attach];
}

export function ReportChart({ spec, size: explicitSize }: { spec: ChartSpec; size?: ChartSize }) {
  const [size, attach] = useFittedSize(explicitSize);
  const { W, H, PAD, PLOT_H, PLOT_W, Y0, Y1, maxBarW } = geometry(size);
  const titleId = useId();
  const descId = useId();
  const [hovered, setHovered] = useState<{ point: number; series: string } | null>(null);
  const [showTable, setShowTable] = useState(false);

  const format = (value: number) => (spec.unit === 'santim' ? formatETB(value) : `${value}%`);
  const tickLabel = (value: number) => (spec.unit === 'santim' ? compactBirr(value) : `${value}%`);

  const max = Math.max(
    0,
    ...spec.points.flatMap((p) => spec.series.map((s) => p.values[s.key] ?? 0)),
  );
  const ticks = niceTicks(spec.unit === 'count' ? Math.max(max, 100) : max);
  const scaleMax = ticks[ticks.length - 1] ?? 1;
  const y = (value: number) => Y1 - (scaleMax === 0 ? 0 : (value / scaleMax) * PLOT_H);

  const pointPeak = (point: (typeof spec.points)[number]) =>
    Math.max(...spec.series.map((series) => point.values[series.key] ?? 0));
  const peakIndex = spec.points.reduce(
    (best, point, index) => (pointPeak(point) > pointPeak(spec.points[best] as typeof point) ? index : best),
    0,
  );

  const groupW = spec.points.length === 0 ? 0 : PLOT_W / spec.points.length;
  // A 2px gap of surface between adjacent bars, so two fills never touch.
  const GAP = 2;
  const barW =
    spec.points.length === 0
      ? 0
      : Math.max(6, Math.min(maxBarW, (groupW * 0.68 - GAP * (spec.series.length - 1)) / spec.series.length));

  const readout =
    hovered === null
      ? null
      : (() => {
          const point = spec.points[hovered.point];
          const series = spec.series.find((s) => s.key === hovered.series);
          if (point === undefined || series === undefined) return null;
          return `${point.label} · ${series.label}: ${format(point.values[series.key] ?? 0)}`;
        })();

  const empty = max === 0;

  return (
    <figure className="viz-root report-chart" ref={attach}>
      <div className="viz-head">
        <div>
          <h3 id={titleId}>{spec.title}</h3>
          <p className="muted" id={descId}>{spec.subtitle}</p>
        </div>
        <button type="button" className="viz-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {spec.series.length > 1 && (
        <ul className="viz-legend">
          {spec.series.map((series, index) => (
            <li key={series.key}>
              <span className="swatch" style={{ background: seriesColor(spec, index, 0) }} aria-hidden="true" />
              {series.label}
            </li>
          ))}
        </ul>
      )}

      {showTable ? (
        <table className="viz-table">
          <caption className="sr-only">{spec.title}</caption>
          <thead>
            <tr>
              <th scope="col">{spec.kind === 'grouped_bars' ? 'Period' : 'Category'}</th>
              {spec.series.map((s) => <th key={s.key} scope="col" className="num">{s.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {spec.points.map((point) => (
              <tr key={point.label}>
                <th scope="row">{point.label}</th>
                {spec.series.map((s) => (
                  <td key={s.key} className="num">{format(point.values[s.key] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : empty ? (
        <p className="muted viz-empty">Nothing to plot — every value in this period is zero.</p>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${titleId} ${descId}`}
          className={`viz-svg ${size === 'compact' ? 'is-compact' : ''}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Axis unit sits above the top gridline rather than on it. */}
          <text x={PAD.left} y={PAD.top - 12} className="viz-unit" textAnchor="end">
            {spec.unit === 'santim' ? 'ETB' : '%'}
          </text>

          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="viz-gridline" />
              <text x={PAD.left - 10} y={y(tick) + 4} className="viz-tick" textAnchor="end">
                {tickLabel(tick)}
              </text>
            </g>
          ))}

          {spec.points.map((point, pointIndex) => {
            const groupX = PAD.left + pointIndex * groupW;
            const groupCentre = groupX + groupW / 2;
            const clusterW = barW * spec.series.length + GAP * (spec.series.length - 1);
            // On a time series the point worth naming is the latest one; on
            // ordered or unordered categories it is the largest. A number on
            // every bar would make the chart a table with extra steps.
            const labelled = spec.kind === 'grouped_bars' ? pointIndex === spec.points.length - 1 : pointIndex === peakIndex;

            return (
              <g key={point.label}>
                {spec.series.map((series, seriesIndex) => {
                  const value = point.values[series.key] ?? 0;
                  const x = groupCentre - clusterW / 2 + seriesIndex * (barW + GAP);
                  const top = y(value);
                  const active = hovered?.point === pointIndex && hovered.series === series.key;

                  return (
                    <g key={series.key}>
                      <path
                        d={barPath(x, top, barW, Y1 - top)}
                        fill={seriesColor(spec, seriesIndex, pointIndex)}
                        opacity={hovered === null || active ? 1 : 0.45}
                      />
                      {/* A hit target taller than the bar, so a near-zero value is
                          still reachable by pointer and by keyboard. */}
                      <rect
                        x={x}
                        y={Y0}
                        width={barW}
                        height={PLOT_H}
                        fill="transparent"
                        tabIndex={0}
                        role="button"
                        aria-label={`${point.label}, ${series.label}: ${format(value)}`}
                        onMouseEnter={() => setHovered({ point: pointIndex, series: series.key })}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered({ point: pointIndex, series: series.key })}
                        onBlur={() => setHovered(null)}
                      />
                      {/* Direct label on the final group only — a number on every
                          bar is a table pretending to be a chart. */}
                      {labelled && value > 0 && (
                        <text x={x + barW / 2} y={top - 7} className="viz-value" textAnchor="middle">
                          {tickLabel(value)}
                        </text>
                      )}
                    </g>
                  );
                })}

                <text x={groupCentre} y={Y1 + 20} className="viz-axis" textAnchor="middle">
                  {point.shortLabel}
                </text>
              </g>
            );
          })}

          <line x1={PAD.left} x2={W - PAD.right} y1={Y1} y2={Y1} className="viz-axis-line" />
        </svg>
      )}

      <figcaption className="chart-readout" aria-live="polite">
        {readout ?? (empty ? '' : 'Hover or tab a bar for its exact figure.')}
      </figcaption>
    </figure>
  );
}

/**
 * Colour for a mark.
 *
 * `ordinal` steps by CATEGORY (the age bucket), every other mode by SERIES — so
 * a filter that changes how many bars are drawn never repaints the survivors
 * with someone else's colour.
 */
function seriesColor(spec: ChartSpec, seriesIndex: number, pointIndex: number): string {
  if (spec.palette === 'ordinal') return `var(--viz-ordinal-${Math.min(pointIndex, 4) + 1})`;
  if (spec.palette === 'single') return 'var(--viz-1)';
  // Fixed order, never cycled: slot 1 is always the first series, whatever else
  // is on the chart. Cycling back to slot 1 for a sixth series would give two
  // series the same colour, which is worse than the chart refusing to draw it —
  // so the caller folds a sixth into "Other" rather than this wrapping.
  return `var(--viz-${Math.min(seriesIndex, CATEGORICAL_SLOTS - 1) + 1})`;
}

/** How many distinct categorical hues the validated palette provides. */
const CATEGORICAL_SLOTS = 5;
