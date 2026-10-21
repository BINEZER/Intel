/**
 * Project KPI panel. Takes a computed result so it can render a live preview
 * or a stored snapshot without caring which.
 */

import { DEFAULT_KPI_TARGETS, formatBps, formatVarianceDays, type ProjectKpiResult } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { KpiTile, ProgressBar, RateTile } from '../components/KpiTile.js';
import { DEFAULT_KPI_DEFINITIONS, type KpiDefinition } from '../lib/kpi-definitions.js';

export function ProjectKpiPanel({ kpi, targets = DEFAULT_KPI_TARGETS, definitions = DEFAULT_KPI_DEFINITIONS }: {
  kpi: ProjectKpiResult;
  targets?: typeof DEFAULT_KPI_TARGETS;
  definitions?: readonly KpiDefinition[];
}) {
  const visible = (key: string) => definitions.some((item) => item.key === key && item.enabled && (item.scope === 'project' || item.scope === 'installation'));
  const labelFor = (key: string, fallback: string) => definitions.find((item) => item.key === key)?.label ?? fallback;
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
          {visible('schedule') && (<KpiTile
            label={labelFor('schedule', 'Schedule variance')}
            value={formatBps(kpi.scheduleVarianceBps, 1)}
            status={scheduleStatus}
            detail={<span className="muted">progress less plan</span>}
            title="Physical progress minus the share of the planned duration elapsed. Negative means behind."
          />)}
          {visible('daysToEnd') && (<KpiTile
            label={labelFor('daysToEnd', kpi.overdue ? 'Overdue by' : 'Days to planned end')}
            value={kpi.daysToPlannedEnd === null ? '—' : Math.abs(kpi.daysToPlannedEnd)}
            status={kpi.overdue ? 'bad' : 'unknown'}
          />)}
          {visible('delivered') && (<KpiTile
            label={labelFor('delivered', 'Delivered')}
            value={formatVarianceDays(kpi.scheduleVarianceDays)}
            status={
              kpi.scheduleVarianceDays === null ? 'unknown' : kpi.scheduleVarianceDays <= 0 ? 'good' : 'bad'
            }
            detail={<span className="muted">against planned handover</span>}
          />)}
          {visible('phases') && (<KpiTile
            label={labelFor('phases', 'Phases complete')}
            value={`${kpi.phasesCompleted} / ${kpi.phasesTotal}`}
          />)}
        </div>
      </section>

      <section className="card">
        <h2>Commercial</h2>
        <div className="kpis">
          {visible('grossMargin') && (<RateTile
            label={labelFor('grossMargin', 'Gross margin')}
            value={kpi.grossMarginBps}
            target={targets.grossMarginBps}
            detail={<span className="muted">{formatETB(kpi.grossMarginSantim)} · VAT excluded</span>}
            title="Contract value less subcontractor cost, both VAT-exclusive. VAT is pass-through and never counts as margin."
          />)}
          {visible('billed') && (<KpiTile
            label={labelFor('billed', 'Billed')}
            value={formatBps(kpi.invoicedBps)}
            detail={<span className="muted">of contract value</span>}
          />)}
          {visible('unbilledWork') && (<KpiTile
            label={labelFor('unbilledWork', 'Unbilled work')}
            value={kpi.underBillingBps === null ? '—' : formatBps(kpi.underBillingBps)}
            status={
              kpi.underBillingBps === null ? 'unknown' : kpi.underBillingBps > 1000 ? 'warn' : 'good'
            }
            detail={<span className="muted">built but not yet invoiced</span>}
            title="Physical progress minus the share invoiced. Positive means work in progress that is not yet earning cash."
          />)}
          {visible('collected') && (<KpiTile
            label={labelFor('collected', 'Collected')}
            value={formatBps(kpi.collectionRateBps)}
            detail={<span className="muted">of what was invoiced</span>}
          />)}
          {visible('collectionTime') && (<KpiTile
            label={labelFor('collectionTime', 'Collection time')}
            value={kpi.avgCollectionDays === null ? '—' : `${kpi.avgCollectionDays} days`}
            detail={<span className="muted">issue to settlement, value-weighted</span>}
          />)}
        </div>
      </section>

      <section className="card">
        <h2>Quality</h2>
        <div className="kpis">
          {visible('inspection') && (<KpiTile
            label={labelFor('inspection', 'Authority inspection')}
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
          />)}
          {visible('phaseDuration') && Object.entries(kpi.phaseDurationDays).map(([key, days]) => (
            <KpiTile
              key={key}
              label={`${labelFor('phaseDuration', 'Phase duration')}: ${key.replace(/_/g, ' ')}`}
              value={`${days} days`}
              detail={<span className="muted">actual duration</span>}
            />
          ))}
        </div>
      </section>
    </>
  );
}
