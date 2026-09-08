/**
 * Technician KPI panel.
 *
 * Ordered deliberately: service quality first, speed second. First-time fix and
 * repeat callouts say whether the lift stayed fixed; response time only says how
 * fast someone arrived. Ranking a team on speed alone rewards the wrong thing.
 */

import { DEFAULT_KPI_TARGETS, formatMinutes, type TechnicianKpiResult } from '../lib/kpi.js';
import { DurationTile, KpiTile, RateTile } from '../components/KpiTile.js';

export function TechnicianKpiPanel({
  name,
  kpi,
  targets = DEFAULT_KPI_TARGETS,
}: {
  name: string;
  kpi: TechnicianKpiResult;
  targets?: typeof DEFAULT_KPI_TARGETS;
}) {
  const noWork = kpi.calloutsHandled === 0 && kpi.pmVisitsScheduled === 0;

  return (
    <section className="card">
      <h2>{name}</h2>
      {noWork && (
        <p className="muted">No callouts or visits in this period — nothing to measure.</p>
      )}

      <div className="kpis">
        <RateTile
          label="First-time fix"
          value={kpi.firstTimeFixBps}
          target={targets.firstTimeFixBps}
          title="Callouts closed on the first visit with no follow-up. The clearest signal that a repair held."
        />
        <RateTile
          label="Repeat callouts"
          value={kpi.repeatCalloutBps}
          target={targets.repeatCalloutBps}
          direction="lower"
          detail={
            <span className="muted">
              same unit within {targets.repeatCalloutWindowDays} days
            </span>
          }
          title="A callout on a unit this technician had recently attended. High repeats mean first fixes are not holding."
        />
        <RateTile
          label="Response SLA"
          value={kpi.slaResponseComplianceBps}
          target={targets.slaResponseComplianceBps}
          title="Share of callouts attended inside the contract response window."
        />
        <RateTile
          label="Resolution SLA"
          value={kpi.slaResolutionComplianceBps}
          target={targets.slaResolutionComplianceBps}
          title="Measured from the report, not from arrival — that is what the client experiences."
        />

        <DurationTile
          label="Median response"
          minutes={kpi.medianResponseMinutes}
          detail={
            <span className="muted">mean {formatMinutes(kpi.avgResponseMinutes)}</span>
          }
          title="Median rather than mean: one bad night should not define a technician's record."
        />
        <DurationTile
          label="Mean repair"
          minutes={kpi.avgRepairMinutes}
          detail={<span className="muted">on site to back in service</span>}
        />

        <KpiTile
          label="Callouts"
          value={kpi.calloutsHandled}
          detail={
            kpi.entrapments > 0
              ? <span className="muted">{kpi.entrapments} entrapment{kpi.entrapments === 1 ? '' : 's'}</span>
              : <span className="muted">no entrapments</span>
          }
        />

        <RateTile
          label="PM compliance"
          value={kpi.pmComplianceBps}
          target={targets.pmComplianceBps}
          detail={
            <span className="muted">
              {kpi.pmVisitsCompleted} of {kpi.pmVisitsScheduled} visits
            </span>
          }
          title="Preventive maintenance visits completed against those the contract promised."
        />
        <RateTile
          label="PM on time"
          value={kpi.pmOnTimeBps}
          target={targets.pmOnTimeBps}
          direction="higher"
        />
        <RateTile
          label="Utilisation"
          value={kpi.utilisationBps}
          target={targets.utilisationBps}
          detail={<span className="muted">{formatMinutes(kpi.loggedMinutes)} logged</span>}
        />

        <KpiTile
          label="Certifications"
          value={
            kpi.certificationsExpired > 0
              ? `${kpi.certificationsExpired} expired`
              : kpi.certificationsExpiringSoon > 0
                ? `${kpi.certificationsExpiringSoon} expiring`
                : 'Current'
          }
          status={
            kpi.certificationsExpired > 0 ? 'bad' : kpi.certificationsExpiringSoon > 0 ? 'warn' : 'good'
          }
          detail={
            <span className="muted">within {targets.certificationWarningDays} days</span>
          }
          title="Elevator work is certified work — an expired card is a compliance problem, not a reminder."
        />
      </div>
    </section>
  );
}
