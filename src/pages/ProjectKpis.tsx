/**
 * Project KPI panel. Takes a computed result so it can render a live preview
 * or a stored snapshot without caring which.
 */

import { DEFAULT_KPI_TARGETS, formatBps, formatVarianceDays, type ProjectKpiResult } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { KpiTile, ProgressBar, RateTile } from '../components/KpiTile.js';

export function ProjectKpiPanel({ kpi, targets = DEFAULT_KPI_TARGETS }: {
  kpi: ProjectKpiResult;
  targets?: typeof DEFAULT_KPI_TARGETS;
}) {
  const scheduleStatus =
    kpi.scheduleVarianceBps >= 0
      ? 'good'
      : kpi.scheduleVarianceBps >= targets.scheduleVarianceBps
        ? 'warn'
        : 'bad';

  return (
    <>
      <section className="card">
        <h2>Schedule</h2>
        <ProgressBar progressBps={kpi.progressBps} expectedBps={kpi.expectedProgressBps} />
        <p className="muted">
          {formatBps(kpi.progressBps, 0)} built · plan says {formatBps(kpi.expectedProgressBps, 0)} by now
        </p>

        <div className="kpis">
          <KpiTile
            label="Schedule variance"
            value={formatBps(kpi.scheduleVarianceBps, 1)}
            status={scheduleStatus}
            detail={<span className="muted">progress less plan</span>}
            title="Physical progress minus the share of the planned duration elapsed. Negative means behind."
          />
          <KpiTile
            label={kpi.overdue ? 'Overdue by' : 'Days to planned end'}
            value={kpi.daysToPlannedEnd === null ? '—' : Math.abs(kpi.daysToPlannedEnd)}
            status={kpi.overdue ? 'bad' : 'unknown'}
          />
          <KpiTile
            label="Delivered"
            value={formatVarianceDays(kpi.scheduleVarianceDays)}
            status={
              kpi.scheduleVarianceDays === null ? 'unknown' : kpi.scheduleVarianceDays <= 0 ? 'good' : 'bad'
            }
            detail={<span className="muted">against planned handover</span>}
          />
          <KpiTile
            label="Phases complete"
            value={`${kpi.phasesCompleted} / ${kpi.phasesTotal}`}
          />
        </div>
      </section>

      <section className="card">
        <h2>Commercial</h2>
        <div className="kpis">
          <RateTile
            label="Gross margin"
            value={kpi.grossMarginBps}
            target={targets.grossMarginBps}
            detail={<span className="muted">{formatETB(kpi.grossMarginSantim)} · VAT excluded</span>}
            title="Contract value less subcontractor cost, both VAT-exclusive. VAT is pass-through and never counts as margin."
          />
          <KpiTile
            label="Billed"
            value={formatBps(kpi.invoicedBps)}
            detail={<span className="muted">of contract value</span>}
          />
          <KpiTile
            label="Unbilled work"
            value={kpi.underBillingBps === null ? '—' : formatBps(kpi.underBillingBps)}
            status={
              kpi.underBillingBps === null ? 'unknown' : kpi.underBillingBps > 1000 ? 'warn' : 'good'
            }
            detail={<span className="muted">built but not yet invoiced</span>}
            title="Physical progress minus the share invoiced. Positive means work in progress that is not yet earning cash."
          />
          <KpiTile
            label="Collected"
            value={formatBps(kpi.collectionRateBps)}
            detail={<span className="muted">of what was invoiced</span>}
          />
          <KpiTile
            label="Collection time"
            value={kpi.avgCollectionDays === null ? '—' : `${kpi.avgCollectionDays} days`}
            detail={<span className="muted">issue to settlement, value-weighted</span>}
          />
        </div>
      </section>

      <section className="card">
        <h2>Quality</h2>
        <div className="kpis">
          <KpiTile
            label="Authority inspection"
            value={
              kpi.inspectionFirstPass === null
                ? 'Not yet inspected'
                : kpi.inspectionFirstPass
                  ? 'Passed first time'
                  : 'Required rework'
            }
            status={
              kpi.inspectionFirstPass === null ? 'unknown' : kpi.inspectionFirstPass ? 'good' : 'bad'
            }
            detail={
              kpi.inspectionAttempts > 0
                ? <span className="muted">{kpi.inspectionAttempts} attempt{kpi.inspectionAttempts === 1 ? '' : 's'}</span>
                : undefined
            }
          />
          {Object.entries(kpi.phaseDurationDays).map(([key, days]) => (
            <KpiTile
              key={key}
              label={key.replace(/_/g, ' ')}
              value={`${days} days`}
              detail={<span className="muted">actual duration</span>}
            />
          ))}
        </div>
      </section>
    </>
  );
}
