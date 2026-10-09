/**
 * The lifts themselves — every machine we service or installed, and what has
 * happened to each one.
 *
 * A lift outlives the project that installed it and the contract that services
 * it, so its history is the thing that decides whether to renew, what to quote,
 * and which machine is quietly eating the service margin.
 *
 * The list opens worst-first. A service manager comes here to find the problem,
 * not to browse.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createUnit,
  getSiteCallouts,
  getSiteVisits,
  setUnitRemarks,
  subscribeUnits,
  updateUnit,
} from '../data/units.js';
import { subscribeClients } from '../data/clients.js';
import { clientChoices, clientOptionLabel, resolveClient } from '../lib/client-choice.js';
import { LinkPicker } from '../components/LinkPicker.js';
import { subscribeContracts } from '../data/contracts.js';
import { subscribeProjects } from '../data/projects.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  assessUnitHealth,
  buildTimeline,
  matchesUnit,
  sortByHealth,
  type HistoryCallout,
  type HistoryVisit,
  type UnitHealth,
} from '../lib/service-history.js';
import { formatBps } from '../lib/kpi.js';
import { formatETB } from '../lib/money.js';
import { formatDual } from '../lib/ethiopic.js';
import { DualDateText } from '../components/DualDateInput.js';
import type { Callout, Client, Contract, ElevatorUnit, MaintenanceVisit, Project } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import { FormPanel } from '../components/FormPanel.js';
import { DeleteButton } from '../components/DeleteButton.js';
import { DataTable } from '../components/DataTable.js';

const VERDICT_LABEL: Record<UnitHealth['verdict'], string> = {
  problem: 'Needs attention',
  watch: 'Watch',
  healthy: 'Healthy',
  unknown: 'Nothing recorded',
};

const STATUS_LABEL: Record<ElevatorUnit['status'], string> = {
  under_installation: 'Under installation',
  in_service: 'In service',
  out_of_service: 'Out of service',
  decommissioned: 'Decommissioned',
};

// ---------------------------------------------------------------------------
// Loading a site's service records
// ---------------------------------------------------------------------------

/**
 * Callouts and visits are fetched per SITE, not per lift.
 *
 * One round trip brings back every machine in the building and the per-unit
 * split happens in memory. Querying per tag would be one read per lift on a page
 * whose whole purpose is to show them together.
 */
function useSiteRecords(siteNames: readonly string[]) {
  const [callouts, setCallouts] = useState<WithId<Callout>[]>([]);
  const [visits, setVisits] = useState<WithId<MaintenanceVisit>[]>([]);
  const [loading, setLoading] = useState(false);
  const key = [...new Set(siteNames)].sort().join('|');

  useEffect(() => {
    const sites = key === '' ? [] : key.split('|');
    if (sites.length === 0) {
      setCallouts([]);
      setVisits([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([
      Promise.all(sites.map((site) => getSiteCallouts(site))),
      Promise.all(sites.map((site) => getSiteVisits(site))),
    ])
      .then(([calloutGroups, visitGroups]) => {
        if (cancelled) return;
        setCallouts(calloutGroups.flat());
        setVisits(visitGroups.flat());
      })
      .catch(() => {
        // The register is still worth showing without the history behind it.
        if (!cancelled) { setCallouts([]); setVisits([]); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { callouts, visits, loading };
}

function toHistoryCallout(callout: WithId<Callout>): HistoryCallout {
  return {
    id: callout.id,
    calloutNo: callout.calloutNo,
    unitTag: callout.unitTag,
    contractId: callout.contractId,
    siteName: callout.siteName,
    category: callout.category,
    entrapment: callout.entrapment,
    description: callout.description,
    technicianName: callout.technicianName,
    reportedAt: callout.reportedAt.toDate(),
    resolvedAt: callout.resolvedAt?.toDate() ?? null,
    responseMinutes: callout.responseMinutes,
    repairMinutes: callout.repairMinutes,
    breachedResponse: callout.breachedResponse,
    resolution: callout.resolution,
    firstTimeFix: callout.firstTimeFix,
    repeatOfCalloutId: callout.repeatOfCalloutId,
    status: callout.status,
    partsUsed: callout.partsUsed,
  };
}

function toHistoryVisit(visit: WithId<MaintenanceVisit>): HistoryVisit {
  return {
    id: visit.id,
    unitTag: visit.unitTag,
    contractId: visit.contractId,
    siteName: visit.siteName,
    technicianName: visit.technicianName,
    scheduledDate: visit.scheduledDate.at.toDate(),
    completedDate: visit.completedDate?.at.toDate() ?? null,
    status: visit.status,
    checklistCompleteBps: visit.checklistCompleteBps,
    findings: visit.findings,
  };
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export function Units() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects') && user !== null;
  /**
   * Start on the lifts under a maintenance contract — unless none is.
   *
   * The filter is the right default for the everyday question, which is which
   * of the machines we are paid to look after needs attention. But after a
   * fresh import there are no maintenance contracts yet, and a page that hides
   * all 153 machines somebody has just loaded reads as an import that failed.
   * So it starts off until at least one lift is actually under contract.
   *
   * `null` until the lifts arrive: choosing before then would pick a default
   * from an empty list and then be wrong once it filled.
   */
  const [servicedOnly, setServicedOnly] = useState<boolean | null>(null);
  const [editing, setEditing] = useState<WithId<ElevatorUnit> | 'new' | null>(null);

  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  const records = useSiteRecords(units.rows.map((u) => u.siteName));
  const asOf = useMemo(() => new Date(), []);

  const anyServiced = units.rows.some((u) => u.maintenanceContractId !== null);

  useEffect(() => {
    if (servicedOnly !== null || units.loading) return;
    setServicedOnly(anyServiced);
  }, [servicedOnly, units.loading, anyServiced]);

  const rows = useMemo(() => {
    const callouts = records.callouts.map(toHistoryCallout);
    const visits = records.visits.map(toHistoryVisit);

    const scored = units.rows.map((unit) => {
      const key = { unitTag: unit.tag, contractId: unit.maintenanceContractId, siteName: unit.siteName };
      const mine = callouts.filter((c) => matchesUnit(key, c));
      const myVisits = visits.filter((v) => matchesUnit(key, v));
      return { unit, health: assessUnitHealth(mine, myVisits, asOf) };
    });

    return sortByHealth(
      servicedOnly ? scored.filter((r) => r.unit.maintenanceContractId !== null) : scored,
    );
  }, [units.rows, records.callouts, records.visits, servicedOnly, asOf]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Lifts</h1>
      {/* print-only */}
      <PrintHeader title="Lifts" subtitle="lifts on the register" />
          <p className="muted">
            Every machine on the register, worst first. A lift with nothing recorded against it is
            listed as unknown rather than healthy — two years of silence is not the same as two
            years of no problems.
          </p>
        </div>
        <PrintButton label="Print list" />
        {editable && (
          <button type="button" className="primary" onClick={() => setEditing((v) => (v === null ? 'new' : null))}>
            {editing === null ? 'Add a lift' : 'Cancel'}
          </button>
        )}
      </div>

      {units.error !== null && <p className="error" role="alert">{units.error}</p>}
      {(units.loading || records.loading) && <p className="muted">Loading…</p>}

      {editing !== null && user !== null && (
        <UnitForm
          initial={editing === 'new' ? null : editing}
          uid={user.uid}
          onDone={() => setEditing(null)}
        />
      )}

      <label className="filter-row">
        <input
          type="checkbox"
          checked={servicedOnly === true}
          onChange={(e) => setServicedOnly(e.target.checked)}
        />
        Only lifts under a maintenance contract
      </label>

      {rows.length === 0 && !units.loading ? (
        <p className="muted">
          {servicedOnly === true
            ? 'No lift is currently under a maintenance contract. Untick the box above to see every machine on the register.'
            : 'No lifts on the register yet.'}
        </p>
      ) : (
        <DataTable
          rows={rows}
          rowKey={({ unit }) => unit.id}
          caption="Lifts on the register"
          noun="lifts"
          rowClass={({ health }) => (health.verdict === 'problem' ? 'row-danger' : undefined)}
          columns={[
            {
              key: 'tag',
              label: 'Lift',
              value: ({ unit }) => unit.tag,
              text: ({ unit }) => `${unit.tag} ${unit.unitCode}`,
              render: ({ unit }) => (
                <>
                  <Link to={`/units/${unit.id}`}>{unit.tag}</Link>
                  <span className="muted"> · {unit.unitCode}</span>
                </>
              ),
            },
            {
              key: 'site',
              label: 'Site',
              value: ({ unit }) => unit.siteName,
              text: ({ unit }) => `${unit.siteName} ${unit.clientName}`,
              render: ({ unit }) => (
                <>
                  {unit.siteName}
                  <span className="muted"> · {unit.clientName}</span>
                </>
              ),
            },
            {
              key: 'client',
              label: 'Client',
              value: ({ unit }) => unit.clientName,
              filterable: true,
            },
            {
              key: 'status',
              label: 'Status',
              value: ({ unit }) => STATUS_LABEL[unit.status],
              filterable: true,
              render: ({ unit }) => <span className="chip">{STATUS_LABEL[unit.status]}</span>,
            },
            {
              key: 'condition',
              label: 'Condition',
              value: ({ health }) => VERDICT_LABEL[health.verdict],
              filterable: true,
              render: ({ health }) => (
                <span className={`chip verdict-${health.verdict}`}>{VERDICT_LABEL[health.verdict]}</span>
              ),
            },
            {
              key: 'callouts',
              label: 'Callouts (12m)',
              numeric: true,
              value: ({ health }) => health.calloutsLast12Months,
            },
            {
              key: 'pm',
              label: 'PM done',
              numeric: true,
              value: ({ health }) => health.pmComplianceBps,
              render: ({ health }) =>
                health.pmComplianceBps === null ? (
                  <span className="muted">—</span>
                ) : (
                  formatBps(health.pmComplianceBps, 0)
                ),
            },
            {
              key: 'lastVisit',
              label: 'Last visit',
              value: ({ health }) => health.lastVisitAt,
              render: ({ health }) =>
                health.lastVisitAt === null ? (
                  <span className="muted">never</span>
                ) : (
                  formatDual(health.lastVisitAt)
                ),
            },
            ...(editable
              ? [
                  {
                    key: 'actions',
                    label: 'Actions',
                    unsortable: true,
                    value: () => '',
                    render: ({ unit }: (typeof rows)[number]) => (
                      <div className="row-actions">
                        <button type="button" onClick={() => setEditing(unit)}>Edit</button>
                        <DeleteButton
                          target={{
                            kind: 'unit',
                            id: unit.id,
                            name: `${unit.tag} at ${unit.siteName}`,
                            unit: { tag: unit.tag, clientId: unit.clientId },
                          }}
                        />
                      </div>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// One lift
// ---------------------------------------------------------------------------

export function UnitDetail() {
  const { unitId } = useParams<{ unitId: string }>();
  const { user, role } = useAuth();
  const editable = can(role, 'updatePhaseProgress') && user !== null;

  const units = useCollection<ElevatorUnit>((d, e) => subscribeUnits(d, e), [], 'load lifts');
  // The three records a lift points at, for the pickers below. Subscribed, so
  // a link changed here shows its new label without a reload.
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients');
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects');
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts');
  const unit = units.rows.find((u) => u.id === unitId);
  const records = useSiteRecords(unit === undefined ? [] : [unit.siteName]);
  const asOf = useMemo(() => new Date(), []);

  const { busy, error: saveError, run } = useAsyncAction('save this lift');
  const [remarks, setRemarks] = useState<string | null>(null);

  const history = useMemo(() => {
    if (unit === undefined) return null;
    const key = { unitTag: unit.tag, contractId: unit.maintenanceContractId, siteName: unit.siteName };
    const callouts = records.callouts.map(toHistoryCallout).filter((c) => matchesUnit(key, c));
    const visits = records.visits.map(toHistoryVisit).filter((v) => matchesUnit(key, v));
    return {
      callouts,
      visits,
      health: assessUnitHealth(callouts, visits, asOf),
      timeline: buildTimeline(callouts, visits),
    };
  }, [unit, records.callouts, records.visits, asOf]);

  if (units.error !== null) return <p className="error" role="alert">{units.error}</p>;
  if (unit === undefined || history === null) {
    return units.loading ? <p className="muted">Loading…</p> : (
      <>
        <p className="error" role="alert">That lift is not on the register.</p>
        <Link to="/units">Back to the register</Link>
      </>
    );
  }

  const { health, timeline } = history;
  const draft = remarks ?? unit.remarks;

  return (
    <>
      <div className="page-head">
        <div>
          <p className="muted"><Link to="/units">Lifts</Link></p>
          <h1>{unit.tag} · {unit.siteName}</h1>
          <p className="muted">
            {unit.unitCode}
            {unit.brand !== undefined && ` · ${unit.brand}`}
            {unit.model !== undefined && ` ${unit.model}`}
            {unit.manufacturerUnitId !== undefined && ` · nameplate ${unit.manufacturerUnitId}`}
            {' · '}{unit.clientName}
          </p>
        </div>
        <span className={`chip verdict-${health.verdict}`}>{VERDICT_LABEL[health.verdict]}</span>
      </div>

      {saveError !== null && <p className="error" role="alert">{saveError}</p>}

      {/*
        * Where this machine sits: whose building, which job installed it,
        * which agreement services it. Each one changeable here, because the
        * alternative is finding the lift in the register, opening its form and
        * re-saving twenty fields to correct one.
        */}
      <section className="card link-panel">
        <div className="link-half">
          <h2>Client</h2>
          <p className="link-title">
            <Link to={`/clients/${unit.clientId}`}>{unit.clientName}</Link>
            <LinkPicker
              kind="unit.client"
              recordId={unit.id}
              currentId={unit.clientId}
              currentLabel={unit.clientName}
              options={clients.rows.map((c) => ({ id: c.id, label: c.name }))}
              uid={user?.uid ?? null}
              editable={editable}
            />
          </p>
          <p className="muted">
            Moving a lift to another client moves its whole service history with it.
          </p>
        </div>

        <div className="link-half">
          <h2>Installed by</h2>
          <p className="link-title">
            {unit.installedByProjectId === null ? (
              unit.installedUnderContractNo != null ? (
                <span className="muted">
                  Installed by us under {unit.installedUnderContractNo}. That job has been archived — its
                  full record is in the backup file saved when it was removed.
                </span>
              ) : (
                <span className="muted">Not one of ours — we service it but did not install it.</span>
              )
            ) : (
              <Link to={`/projects/${unit.installedByProjectId}`}>
                {projects.rows.find((p) => p.id === unit.installedByProjectId)?.title ?? 'the project'}
              </Link>
            )}
            <LinkPicker
              kind="unit.project"
              recordId={unit.id}
              currentId={unit.installedByProjectId}
              currentLabel={
                projects.rows.find((p) => p.id === unit.installedByProjectId)?.title ?? null
              }
              options={projects.rows.map((p) => ({ id: p.id, label: p.title, hint: p.projectNo }))}
              uid={user?.uid ?? null}
              editable={editable}
            />
          </p>
        </div>

        <div className="link-half">
          <h2>Maintenance contract</h2>
          <p className="link-title">
            {unit.maintenanceContractId === null ? (
              <span className="muted">Under no service agreement.</span>
            ) : (
              <Link to={`/contracts/${unit.maintenanceContractId}`}>
                {unit.maintenanceContractNo ?? 'the contract'}
              </Link>
            )}
            <LinkPicker
              kind="unit.contract"
              recordId={unit.id}
              currentId={unit.maintenanceContractId}
              currentLabel={unit.maintenanceContractNo}
              options={contracts.rows.map((k) => ({ id: k.id, label: k.contractNo, hint: k.title }))}
              uid={user?.uid ?? null}
              editable={editable}
            />
          </p>
        </div>
      </section>

      <section className="card">
        <h2>Condition</h2>
        <ul className="reason-list">
          {health.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>

        <dl className="program-figures">
          <div><dt>Callouts, all time</dt><dd>{health.callouts}</dd></div>
          <div><dt>Last twelve months</dt><dd>{health.calloutsLast12Months}</dd></div>
          <div><dt>Entrapments</dt><dd>{health.entrapments}</dd></div>
          <div><dt>Repeat callouts</dt><dd>{health.repeatCallouts}{health.repeatRateBps !== null && ` (${formatBps(health.repeatRateBps, 0)})`}</dd></div>
          <div><dt>First-time fix</dt><dd>{health.firstTimeFixBps === null ? '—' : formatBps(health.firstTimeFixBps, 0)}</dd></div>
          <div><dt>Average response</dt><dd>{health.avgResponseMinutes === null ? '—' : `${health.avgResponseMinutes} min`}</dd></div>
          <div><dt>Average repair</dt><dd>{health.avgRepairMinutes === null ? '—' : `${health.avgRepairMinutes} min`}</dd></div>
          <div><dt>Preventive visits done</dt><dd>{health.pmComplianceBps === null ? '—' : `${formatBps(health.pmComplianceBps, 0)} (${health.visitsCompleted} of ${health.visitsCompleted + health.visitsMissed})`}</dd></div>
          <div><dt>Open safety findings</dt><dd>{health.openSafetyFindings}</dd></div>
          <div><dt>Parts spent</dt><dd>{formatETB(health.partsCostSantim)}</dd></div>
        </dl>
      </section>

      <section className="card">
        <h2>The machine</h2>
        <dl className="program-figures">
          <div><dt>Type</dt><dd>{unit.type ?? '—'}</dd></div>
          <div><dt>Capacity</dt><dd>{unit.capacityKg === undefined ? '—' : `${unit.capacityKg} kg`}{unit.personCapacity !== undefined && ` · ${unit.personCapacity} persons`}</dd></div>
          <div><dt>Speed</dt><dd>{unit.speedMps === undefined ? '—' : `${unit.speedMps} m/s`}</dd></div>
          <div><dt>Stops</dt><dd>{unit.stops ?? '—'}</dd></div>
          <div><dt>Serial</dt><dd>{unit.serialNo ?? '—'}</dd></div>
          <div><dt>Location</dt><dd>{unit.location ?? '—'}</dd></div>
          <div><dt>Commissioned</dt><dd>{unit.commissionedOn === null ? '—' : <DualDateText value={unit.commissionedOn} />}</dd></div>
          <div>
            <dt>Certificate</dt>
            <dd>
              {unit.certificate?.expiresOn == null
                ? '—'
                : <>expires <DualDateText value={unit.certificate.expiresOn} /></>}
            </dd>
          </div>
        </dl>

        {editable && (
          <div className="form-actions">
            <label className="field">
              <span>Status</span>
              <select
                value={unit.status}
                disabled={busy}
                onChange={(e) =>
                  void run(() => updateUnit(unit.id, { status: e.target.value as ElevatorUnit['status'] }, user?.uid ?? ''))
                }
              >
                {(Object.keys(STATUS_LABEL) as ElevatorUnit['status'][]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Remarks</h2>
        <p className="muted">
          What the business thinks about this machine — kept apart from the engineers' visit
          findings, which are the dated record and are never rewritten.
        </p>
        <textarea
          rows={4}
          value={draft}
          disabled={!editable || busy}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder="Client keeps declining the door operator quote; expect repeat callbacks until it is replaced."
        />
        {editable && draft !== unit.remarks && (
          <div className="form-actions">
            <button type="button" className="primary" disabled={busy}
              onClick={() => void run(async () => {
                await setUnitRemarks(unit.id, draft, user?.uid ?? '');
                setRemarks(null);
              })}>
              Save remarks
            </button>
            <button type="button" onClick={() => setRemarks(null)} disabled={busy}>Discard</button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>History</h2>
        {records.loading && <p className="muted">Loading the service record…</p>}
        {timeline.length === 0 && !records.loading ? (
          <p className="muted">
            Nothing has ever been recorded against this lift — no callout, no maintenance visit.
            That is worth confirming rather than assuming: a machine with no record is usually a
            machine nobody is logging, not a machine with no faults.
          </p>
        ) : (
          <ol className="timeline">
            {timeline.map((entry) => (
              <li key={entry.id} className={`timeline-entry sev-${entry.severity} ${entry.open ? 'is-open' : ''}`}>
                <div className="timeline-head">
                  <strong>{entry.title}</strong>
                  <span className="muted">{formatDual(entry.at)}</span>
                  {entry.technicianName !== null && <span className="muted">· {entry.technicianName}</span>}
                  {entry.open && <span className="chip chip-blocked">open</span>}
                </div>
                <p>{entry.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Adding a lift
// ---------------------------------------------------------------------------

export function UnitForm({
  initial,
  uid,
  onDone,
}: {
  initial: WithId<ElevatorUnit> | null;
  uid: string;
  onDone: () => void;
}) {
  const clients = useCollection<Client>((d, e) => subscribeClients(d, e), [], 'load clients').rows;
  const contracts = useCollection<Contract>((d, e) => subscribeContracts(d, e), [], 'load contracts').rows;
  const projects = useCollection<Project>((d, e) => subscribeProjects(d, e), [], 'load projects').rows;

  const [tag, setTag] = useState(initial?.tag ?? 'LIFT-01');
  const [siteName, setSiteName] = useState(initial?.siteName ?? '');
  const [city, setCity] = useState(initial?.city ?? 'Addis Ababa');
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const currentClient = initial === null ? null : { id: initial.clientId, name: initial.clientName };
  const [contractId, setContractId] = useState(initial?.maintenanceContractId ?? '');
  /*
   * Which project installed this lift.
   *
   * Only the workbook import used to set this, so a lift added by hand could
   * never be attached to the job that put it in — and the project page had no
   * way to list its own machines. It is the link from a contract down to the
   * hardware: contract → project → lift.
   */
  const [installedBy, setInstalledBy] = useState(initial?.installedByProjectId ?? '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [manufacturerUnitId, setManufacturerUnitId] = useState(initial?.manufacturerUnitId ?? '');
  // The plate data: what the lift actually is, which the register is for.
  const [capacityKg, setCapacityKg] = useState(String(initial?.capacityKg ?? ''));
  const [stops, setStops] = useState(String(initial?.stops ?? ''));
  const [speedMps, setSpeedMps] = useState(String(initial?.speedMps ?? ''));
  const { busy, error, run } = useAsyncAction(initial === null ? 'add this lift' : 'save this lift');

  const ready = tag.trim() !== '' && siteName.trim() !== '' && clientId !== '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const client = resolveClient(clients, clientId, currentClient);
    if (!ready || client === null) return;

    const contract = contracts.find((c) => c.id === contractId);

    const number = (text: string): number | undefined => {
      const parsed = Number(text.trim());
      return text.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed;
    };
    const capacity = number(capacityKg);
    const stopCount = number(stops);
    const speed = number(speedMps);

    const input = {
      unitCode: initial?.unitCode ?? `IM-U-${String(Date.now()).slice(-8)}`,
      tag: tag.trim(),
      ...(manufacturerUnitId.trim() === '' ? {} : { manufacturerUnitId: manufacturerUnitId.trim() }),
      ...(brand.trim() === '' ? {} : { brand: brand.trim() }),
      ...(model.trim() === '' ? {} : { model: model.trim() }),
      ...(capacity === undefined ? {} : { capacityKg: capacity }),
      ...(stopCount === undefined ? {} : { stops: stopCount }),
      ...(speed === undefined ? {} : { speedMps: speed }),
      siteName: siteName.trim(),
      city,
      clientId,
      clientName: client.name,
      installedByProjectId: installedBy === '' ? null : installedBy,
      maintenanceContractId: contractId === '' ? null : contractId,
      maintenanceContractNo: contract?.contractNo ?? null,
      commissionedOn: initial?.commissionedOn ?? null,
      status: initial?.status ?? ('in_service' as ElevatorUnit['status']),
      certificate: initial?.certificate ?? null,
      remarks: initial?.remarks ?? '',
    };

    const result = await run(async () => {
      if (initial === null) await createUnit(input, uid);
      else await updateUnit(initial.id, input, uid);
      return true;
    });
    if (result !== null) onDone();
  }

  return (
    <FormPanel
      title={initial === null ? 'Add a lift' : `Edit ${initial.tag} · ${initial.siteName}`}
      description="The tag is what is painted in the building; the code is ours and never changes. Every building has a LIFT-01, which is why the machine needs an identity of its own."
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="u-tag">Tag on site <span className="req" aria-hidden="true">*</span></label>
            <input id="u-tag" required value={tag} onChange={(e) => setTag(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-site">Site <span className="req" aria-hidden="true">*</span></label>
            <input id="u-site" required value={siteName} onChange={(e) => setSiteName(e.target.value)}
              placeholder="Sheger Mall" />
          </div>
          <div className="field">
            <label htmlFor="u-city">City</label>
            <input id="u-city" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-client">Client <span className="req" aria-hidden="true">*</span></label>
            <select id="u-client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clientChoices(clients, currentClient).map((c) => (
                <option key={c.id} value={c.id}>{clientOptionLabel(c)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-capacity">Capacity, kg</label>
            <input id="u-capacity" type="number" min="0" step="any" value={capacityKg}
              onChange={(e) => setCapacityKg(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-stops">Stops</label>
            <input id="u-stops" type="number" min="0" value={stops}
              onChange={(e) => setStops(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-speed">Speed, m/s</label>
            <input id="u-speed" type="number" min="0" step="any" value={speedMps}
              onChange={(e) => setSpeedMps(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-project">Installed by project</label>
            <select
              id="u-project"
              value={installedBy}
              onChange={(e) => setInstalledBy(e.target.value)}
            >
              <option value="">Not recorded</option>
              {/* This client's projects first — a picker of all 163 invites
                  attaching a lift to the wrong building. */}
              {projects
                .filter((p) => clientId === '' || p.clientId === clientId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.projectNo} · {p.title}
                  </option>
                ))}
            </select>
            <p className="field-hint">
              The job that put this lift in. It is how a contract reaches its machines.
            </p>
          </div>
          <div className="field">
            <label htmlFor="u-contract">Maintenance contract</label>
            <select id="u-contract" value={contractId} onChange={(e) => setContractId(e.target.value)}>
              <option value="">Not under maintenance</option>
              {contracts.filter((c) => c.type === 'maintenance').map((c) => (
                <option key={c.id} value={c.id}>{c.contractNo} · {c.clientName}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="u-brand">Brand</label>
            <input id="u-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-model">Model</label>
            <input id="u-model" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="u-nameplate">Nameplate / manufacturer id</label>
            <input id="u-nameplate" value={manufacturerUnitId}
              onChange={(e) => setManufacturerUnitId(e.target.value)} />
          </div>
        </div>

        {error && <p className="error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? (initial === null ? 'Adding…' : 'Saving…') : initial === null ? 'Add lift' : 'Save changes'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
      </form>
    </FormPanel>
  );
}
