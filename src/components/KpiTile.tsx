/**
 * KPI presentation.
 *
 * The design rule here is honesty: a metric with no data shows "—" in a neutral
 * tile, never a red 0%. Grading a technician's first month as a total failure
 * because they had no callouts is worse than showing nothing.
 */

import type { ReactNode } from 'react';
import { formatBps, formatMinutes, grade, type Grade } from '../lib/kpi.js';
import type { RateBps } from '../lib/schema.js';

// `undefined` is spelled out on every optional prop because the project runs
// with exactOptionalPropertyTypes: passing an absent value through a wrapper
// is otherwise a type error.
export interface KpiTileProps {
  label: string;
  value: ReactNode;
  /** Small print under the value: the raw counts behind the rate. */
  detail?: ReactNode | undefined;
  status?: Grade | undefined;
  /** Shown as a tooltip and to screen readers — what the number means. */
  title?: string | undefined;
}

export function KpiTile({ label, value, detail, status = 'unknown', title }: KpiTileProps) {
  return (
    <article className={`kpi kpi-${status}`} title={title}>
      <h3>{label}</h3>
      <p className="kpi-value">{value}</p>
      {detail && <p className="kpi-detail">{detail}</p>}
    </article>
  );
}

/** A rate tile graded against a target. */
export function RateTile({
  label,
  value,
  target,
  direction = 'higher',
  detail,
  title,
}: {
  label: string;
  value: RateBps;
  target: number;
  direction?: 'higher' | 'lower' | undefined;
  detail?: ReactNode | undefined;
  title?: string | undefined;
}) {
  return (
    <KpiTile
      label={label}
      value={formatBps(value)}
      status={grade(value, target, direction)}
      detail={
        detail ?? (
          <span className="muted">
            target {formatBps(target, 0)} {direction === 'higher' ? 'or better' : 'or lower'}
          </span>
        )
      }
      title={title}
    />
  );
}

/** A duration tile, e.g. mean response time. */
export function DurationTile({
  label,
  minutes,
  targetMinutes,
  detail,
  title,
}: {
  label: string;
  minutes: number | null;
  targetMinutes?: number | undefined;
  detail?: ReactNode | undefined;
  title?: string | undefined;
}) {
  return (
    <KpiTile
      label={label}
      value={formatMinutes(minutes)}
      status={targetMinutes === undefined ? 'unknown' : grade(minutes, targetMinutes, 'lower')}
      detail={
        detail ?? (targetMinutes !== undefined
          ? <span className="muted">target {formatMinutes(targetMinutes)} or less</span>
          : undefined)
      }
      title={title}
    />
  );
}

/**
 * Schedule health: physical progress against the share of the plan elapsed.
 * A bar rather than a number, because "40% built, 50% elapsed" is a
 * relationship, and the gap is the message.
 */
export function ProgressBar({
  progressBps,
  expectedBps,
}: {
  progressBps: number;
  expectedBps: number;
}) {
  const behind = progressBps < expectedBps;
  return (
    <div
      className="progress"
      role="meter"
      aria-valuenow={Math.round(progressBps / 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Physical progress against plan"
    >
      <div
        className={`progress-fill ${behind ? 'behind' : 'ahead'}`}
        style={{ width: `${progressBps / 100}%` }}
      />
      <div
        className="progress-marker"
        style={{ left: `${expectedBps / 100}%` }}
        title={`Plan says ${(expectedBps / 100).toFixed(0)}% by now`}
      />
    </div>
  );
}
