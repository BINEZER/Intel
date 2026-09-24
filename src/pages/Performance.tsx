/**
 * Workforce performance — every technician and subcontractor, in one place.
 *
 * Installation crews, service technicians and subcontractors are measured on
 * different evidence and shown side by side without pretending otherwise. The
 * columns change with the discipline; a blank is a blank, never a zero.
 */

import { useMemo, useState } from 'react';
import { subscribeTechnicians } from '../data/technicians.js';
import { subscribeSubcontractors } from '../data/subcontractors.js';
import { useCollection } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { headlineMetrics, type WorkforceRow } from '../lib/performance.js';
import { KpiTile } from '../components/KpiTile.js';
import { DEFAULT_KPI_TARGETS, computeTechnicianKpis, type CalloutKpiInput, type VisitKpiInput } from '../lib/kpi.js';
import { subscribeCalloutsInPeriod, subscribeVisitsInPeriod } from '../data/service.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { TechnicianKpiPanel } from './TechnicianKpis.js';
import { Link } from 'react-router-dom';
import type { Callout, MaintenanceVisit, Subcontractor, Technician } from '../lib/schema.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';

type Filter = 'all' | 'installation' | 'service' | 'subcontractors';

export function Performance() {
  const [filter, setFilter] = useState<Filter>('all');

  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e),
    [],
    'load technicians',
  );
  const subcontractors = useCollection<Subcontractor>(
    (d, e) => subscribeSubcontractors(d, e),
    [],
    'load subcontractors',
  );

  /*
   * Service KPIs, computed from the callouts and visits recorded this month.
   *
   * THIS MONTH, NOT ALL TIME
   *   A first-time-fix rate averaged over three years tells you nothing about
   *   whether the team is improving, and the period key is what the KPI
   *   snapshots are meant to be stored under anyway.
   *
   * A TECHNICIAN WITH NO WORK IS NOT A TECHNICIAN SCORING ZERO
   *   `computeTechnicianKpis` returns null rates where there is no evidence, and
   *   the table below prints a dash for null. That distinction is the reason
   *   every rate on this page is `RateBps` — nullable — rather than a number.
   */
  const period = useMemo(
    () => dualDateFromGregorian(new Date(), (d) => ({ toDate: () => d }) as never).ecPeriod,
    [],
  );
  const callouts = useCollection<Callout>(
    (d, e) => subscribeCalloutsInPeriod(period, d, e),
    [period],
    'load callouts',
  );
  const visits = useCollection<MaintenanceVisit>(
    (d, e) => subscribeVisitsInPeriod(period, d, e),
    [period],
    'load maintenance visits',
  );

  const serviceKpis = useMemo(() => {
    const byTechnician = new Map<string, { callouts: CalloutKpiInput[]; visits: VisitKpiInput[] }>();
    const bucket = (id: string) => {
      const found = byTechnician.get(id);
      if (found !== undefined) return found;
      const made = { callouts: [] as CalloutKpiInput[], visits: [] as VisitKpiInput[] };
      byTechnician.set(id, made);
      return made;
    };

    for (const callout of callouts.rows) {
      if (callout.technicianId === null) continue;
      bucket(callout.technicianId).callouts.push({
        id: callout.id,
        technicianId: callout.technicianId,
        unitTag: callout.unitTag,
        entrapment: callout.entrapment,
        reportedAt: callout.reportedAt.toDate(),
        arrivedAt: callout.arrivedAt?.toDate() ?? null,
        resolvedAt: callout.resolvedAt?.toDate() ?? null,
        slaResponseMinutes: callout.slaResponseMinutes,
        slaResolutionMinutes: callout.slaResolutionMinutes,
        firstTimeFix: callout.firstTimeFix,
        status: callout.status,
        repeatOfCalloutId: callout.repeatOfCalloutId,
      });
    }
    for (const visit of visits.rows) {
      if (visit.technicianId === null) continue;
      bucket(visit.technicianId).visits.push({
        technicianId: visit.technicianId,
        scheduledDate: visit.scheduledDate.at.toDate(),
        completedDate: visit.completedDate?.at.toDate() ?? null,
        status: visit.status,
        durationMinutes: visit.durationMinutes,
      });
    }

    const asOf = new Date();
    const out = new Map<string, ReturnType<typeof computeTechnicianKpis>>();
    for (const [id, work] of byTechnician) {
      out.set(
        id,
        computeTechnicianKpis(work.callouts, work.visits, [], asOf, {
          // Utilisation is switched off rather than guessed: it needs the
          // working minutes actually available in the period, and a roster is
          // not something this app keeps. A fabricated denominator would make
          // every technician look either idle or heroic.
          availableMinutes: 0,
          certificationWarningDays: DEFAULT_KPI_TARGETS.certificationWarningDays,
        }),
      );
    }
    return out;
  }, [callouts.rows, visits.rows]);

  const rows: WorkforceRow[] = [
    ...technicians.rows.map<WorkforceRow>((t) => {
      const kpi = serviceKpis.get(t.id);
      return {
      id: t.id,
      name: t.name,
      kind: 'technician',
      discipline: t.discipline ?? 'service',
      installation: null,
      service:
        kpi === undefined
          ? null
          : {
              calloutsHandled: kpi.calloutsHandled,
              firstTimeFixBps: kpi.firstTimeFixBps,
              repeatCalloutBps: kpi.repeatCalloutBps,
              slaResponseComplianceBps: kpi.slaResponseComplianceBps,
              pmComplianceBps: kpi.pmComplianceBps,
            },
      subcontractor: null,
      certificationsExpired: 0,
      certificationsExpiringSoon: 0,
      scoreBps: null,
      coverageBps: 0,
      };
    }),
    ...subcontractors.rows.map<WorkforceRow>((s) => ({
      id: s.id,
      name: s.name,
      kind: 'subcontractor',
      discipline: null,
      installation: null,
      service: null,
      subcontractor: null,
      certificationsExpired: 0,
      certificationsExpiringSoon: 0,
      scoreBps: null,
      coverageBps: 0,
    })),
  ];

  const visible = rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'subcontractors') return row.kind === 'subcontractor';
    if (row.kind !== 'technician') return false;
    return row.discipline === filter || row.discipline === 'both';
  });

  const loading = technicians.loading || subcontractors.loading;
  const error = technicians.error ?? subcontractors.error;

  const installers = rows.filter(
    (r) => r.kind === 'technician' && (r.discipline === 'installation' || r.discipline === 'both'),
  ).length;
  const servicers = rows.filter(
    (r) => r.kind === 'technician' && (r.discipline === 'service' || r.discipline === 'both'),
  ).length;

  return (
    <>
      <h1>Performance</h1>
      {/* print-only */}
      <PrintHeader title="Performance" />
      <div className="page-actions no-print"><PrintButton label="Print this page" /></div>
      <p className="muted">
        Installation crews, service technicians and subcontractors. Each is scored on
        the evidence its own work produces — an installer is judged on stages
        delivered, not on callout response times.
      </p>

      {error !== null && <p className="error" role="alert">{error}</p>}

      <section className="kpis">
        <KpiTile label="Technicians" value={technicians.rows.length} />
        <KpiTile label="Installation" value={installers} detail={<span className="muted">crew members</span>} />
        <KpiTile label="Service" value={servicers} detail={<span className="muted">crew members</span>} />
        <KpiTile label="Subcontractors" value={subcontractors.rows.length} />
      </section>

      {/*
        The detailed panel, which until now existed and was rendered nowhere.
        Shown only for technicians with work recorded this month: a bank of
        "no data" tiles for everyone on the roster is noise, and the table above
        already says who has nothing against them.
      */}
      {filter === 'service' && serviceKpis.size > 0 && (
        <>
          <h2>This month, technician by technician</h2>
          <p className="muted">
            {period} · computed from the callouts and visits recorded on the{' '}
            <Link to="/service">Service</Link> page. A dash is no data, never a zero.
          </p>
          {technicians.rows
            .filter((t) => serviceKpis.has(t.id))
            .map((t) => (
              <TechnicianKpiPanel
                key={t.id}
                name={t.name}
                kpi={serviceKpis.get(t.id) as NonNullable<ReturnType<typeof serviceKpis.get>>}
              />
            ))}
        </>
      )}

      <nav className="subnav">
        {(['all', 'installation', 'service', 'subcontractors'] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={filter === key ? 'tab active' : 'tab'}
            onClick={() => setFilter(key)}
          >
            {key === 'all' ? 'Everyone' : key.charAt(0).toUpperCase() + key.slice(1)}
          </button>
        ))}
      </nav>

      {loading && <p className="muted">Loading…</p>}

      {!loading && visible.length === 0 && (
        <p className="muted">
          {rows.length === 0
            ? 'No technicians or subcontractors on file yet. Add them to start tracking performance.'
            : 'Nobody matches this filter.'}
        </p>
      )}

      {visible.length > 0 && (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Measured on</th>
                <th scope="col" className="num">Score</th>
                <th scope="col">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const metrics = headlineMetrics(row);
                return (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td><strong>{row.name}</strong></td>
                    <td>
                      <span className="chip">
                        {row.kind === 'subcontractor' ? 'subcontractor' : row.discipline}
                      </span>
                    </td>
                    <td>
                      {metrics.length === 0 ? (
                        <span className="muted">no work recorded yet</span>
                      ) : (
                        <span className="metric-list">
                          {metrics.map((m) => (
                            <span key={m.label}>
                              {m.label} <strong>{formatBps(m.value)}</strong>
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {row.scoreBps === null
                        ? <span className="muted">—</span>
                        : <strong>{formatBps(row.scoreBps)}</strong>}
                    </td>
                    <td>
                      {row.coverageBps === 0
                        ? <span className="muted">nothing measured</span>
                        : formatBps(row.coverageBps, 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section className="card">
        <h2>How these scores work</h2>
        <dl className="kv">
          <dt>Installation</dt>
          <dd>Stages completed, on-time delivery, first-pass authority inspection. Stages owned by the client, a supplier or the authority are excluded — a crew is not marked down for a shipment stuck in customs.</dd>
          <dt>Service</dt>
          <dd>First-time fix, repeat callouts, response and resolution SLA, preventive maintenance compliance.</dd>
          <dt>Subcontractors</dt>
          <dd>On-time stage delivery, rejected vouchers, committed against paid, and how long <em>we</em> take to pay them — a subcontractor paid ninety days late who still turns up is performing well.</dd>
          <dt>A blank</dt>
          <dd>Means no data, never zero. Targets are {formatBps(DEFAULT_KPI_TARGETS.firstTimeFixBps, 0)} first-time fix and {formatBps(DEFAULT_KPI_TARGETS.pmComplianceBps, 0)} PM compliance, editable in Settings.</dd>
        </dl>
      </section>
    </>
  );
}
