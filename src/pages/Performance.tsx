/**
 * Workforce performance — every technician and subcontractor, in one place.
 *
 * Installation crews, service technicians and subcontractors are measured on
 * different evidence and shown side by side without pretending otherwise. The
 * columns change with the discipline; a blank is a blank, never a zero.
 */

import { useState } from 'react';
import { subscribeTechnicians } from '../data/technicians.js';
import { subscribeSubcontractors } from '../data/subcontractors.js';
import { useCollection } from '../data/useCollection.js';
import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { headlineMetrics, type WorkforceRow } from '../lib/performance.js';
import { KpiTile } from '../components/KpiTile.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import type { Subcontractor, Technician } from '../lib/schema.js';

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

  // Built from identity now; the KPI blocks fill in once callouts, visits and
  // stage outcomes exist to compute them from. A row with no evidence shows
  // dashes rather than a fabricated score.
  const rows: WorkforceRow[] = [
    ...technicians.rows.map<WorkforceRow>((t) => ({
      id: t.id,
      name: t.name,
      kind: 'technician',
      discipline: t.discipline ?? 'service',
      installation: null,
      service: null,
      subcontractor: null,
      certificationsExpired: 0,
      certificationsExpiringSoon: 0,
      scoreBps: null,
      coverageBps: 0,
    })),
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
