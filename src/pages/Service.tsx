/**
 * Where service work gets recorded.
 *
 * WHY IT IS A PAGE AND NOT A FORM ON THE LIFT
 *   A callout arrives as a phone call, and whoever answers does not know which
 *   lift record it belongs to yet — they know a building and a complaint. So the
 *   page starts from the lift LIST, filtered as you type, rather than expecting
 *   somebody to have navigated to the right machine first.
 *
 *   Once logged, the same page is the day's work: what is open, who is on it,
 *   and which visits are due. Those are the two questions a service manager has
 *   all day, and they are answered without a click.
 *
 * WHY EACH TIME IS RECORDED SEPARATELY
 *   The times a callout carries are write-once — every KPI is derived from them
 *   by subtraction — so the page asks for each at the moment it happens rather
 *   than offering a form to fill in afterwards. That is why a closed callout has
 *   no edit button: there is nothing here that can rewrite a measurement.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { subscribeUnits } from '../data/units.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { getKpiTargets } from '../data/config.js';
import {
  assignCallout,
  cancelCallout,
  completeVisit,
  logCallout,
  markVisitMissed,
  recordArrival,
  resolveCallout,
  scheduleVisit,
  subscribeOpenCallouts,
  subscribeScheduledVisits,
} from '../data/service.js';
import {
  describeMinutes,
  nextActionFor,
  whyCalloutCannotBeLogged,
  whyTimeCannotBeRecorded,
} from '../lib/service-log.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DualDateText } from '../components/DualDateInput.js';
import { PrintButton, PrintHeader } from '../components/PrintButton.js';
import type {
  Callout,
  CalloutCategory,
  CalloutResolution,
  ElevatorUnit,
  KpiTargets,
  MaintenanceVisit,
  Technician as TechnicianRecord,
} from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

const CATEGORIES: ReadonlyArray<{ value: CalloutCategory; label: string }> = [
  { value: 'breakdown', label: 'Breakdown — the lift is not running' },
  { value: 'entrapment', label: 'Entrapment — passengers trapped' },
  { value: 'callback', label: 'Callback — it was just worked on' },
  { value: 'damage', label: 'Damage' },
  { value: 'other', label: 'Something else' },
];

const RESOLUTIONS: ReadonlyArray<{ value: CalloutResolution; label: string }> = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'temporary_fix', label: 'Running, but a temporary fix' },
  { value: 'parts_required', label: 'Parts needed — still out of service' },
  { value: 'referred', label: 'Referred on' },
  { value: 'no_fault_found', label: 'No fault found' },
];

/** `datetime-local` wants a local wall-clock string, not an ISO instant. */
function forInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function Service() {
  const { user, role } = useAuth();
  // Two different permissions, matching the two rules: an engineer on site may
  // record a callout, but only a manager may set the date a visit is promised
  // for — that date is what PM compliance is measured against.
  const mayRecord = can(role, 'recordService') && user !== null;
  const maySchedule = can(role, 'scheduleMaintenance') && user !== null;

  const units = useCollection<ElevatorUnit>(
    (d, e) => subscribeUnits(d, e, { servicedOnly: false }),
    [],
    'load lifts',
  );
  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d as never, e),
    [],
    'load technicians',
  );
  const open = useCollection<Callout>((d, e) => subscribeOpenCallouts(d, e), [], 'load open callouts');
  const visits = useCollection<MaintenanceVisit>(
    (d, e) => subscribeScheduledVisits(d, e),
    [],
    'load visits',
  );

  /*
   * The SLA promise, read once and snapshotted onto each callout as it is
   * logged. In an effect, not a memo: a memo runs during render, and firing an
   * async read from there updates state on a component that may not have
   * mounted — which React rightly complains about.
   */
  const [targets, setTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS });
  useEffect(() => {
    let live = true;
    void getKpiTargets()
      .then((read) => { if (live) setTargets(read); })
      // The defaults are the same numbers the settings page starts from, so a
      // failed read costs nothing but the customisation.
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  return (
    <div className="page">
      <PrintHeader title="Service" />
      <div className="page-head">
        <div>
          <h1>Service</h1>
          <p className="muted">
            Log a callout as the phone rings, record each step as it happens, and keep the
            preventive visits in the diary. Every technician KPI is computed from what is recorded
            here — nothing else feeds them.
          </p>
        </div>
        <PrintButton />
      </div>

      {mayRecord && (
        <LogCallout units={units.rows} technicians={technicians.rows} targets={targets} uid={user.uid} />
      )}

      <OpenCallouts
        rows={open.rows}
        technicians={technicians.rows}
        uid={mayRecord ? user.uid : null}
      />
      <ScheduledVisits rows={visits.rows} uid={mayRecord ? user.uid : null} />

      {maySchedule && (
        <ScheduleVisit units={units.rows} technicians={technicians.rows} uid={user.uid} />
      )}
    </div>
  );
}

type Technician = Pick<TechnicianRecord, 'name'>;

function LogCallout({
  units,
  technicians,
  targets,
  uid,
}: {
  units: readonly WithId<ElevatorUnit>[];
  technicians: readonly WithId<Technician>[];
  targets: KpiTargets;
  uid: string;
}) {
  const [unitId, setUnitId] = useState('');
  const [category, setCategory] = useState<CalloutCategory>('breakdown');
  const [description, setDescription] = useState('');
  const [when, setWhen] = useState(() => forInput(new Date()));
  const [technicianId, setTechnicianId] = useState('');
  const { run, busy, error } = useAsyncAction('log the callout');

  const unit = units.find((u) => u.id === unitId);
  const reportedAt = when === '' ? null : new Date(when);
  const draft = {
    unitTag: unit?.tag ?? '',
    siteName: unit?.siteName ?? '',
    clientId: unit?.clientId ?? '',
    description,
    reportedAt,
  };
  const blocked = whyCalloutCannotBeLogged(draft);
  // An entrapment is chosen from the category rather than a separate tick: it is
  // reported to the authority separately and must not be possible to forget.
  const entrapment = category === 'entrapment';

  async function submit() {
    if (blocked !== null || unit === undefined || reportedAt === null) return;
    const technician = technicians.find((t) => t.id === technicianId);
    await run(async () => {
      await logCallout(
        {
          unitTag: unit.tag,
          siteName: unit.siteName,
          clientId: unit.clientId,
          clientName: unit.clientName,
          contractId: unit.maintenanceContractId ?? '',
          projectId: unit.installedByProjectId,
          category,
          entrapment,
          description,
          reportedAt,
          technicianId: technician?.id ?? null,
          technicianName: technician?.name ?? null,
        },
        targets,
        uid,
      );
      setDescription('');
      setUnitId('');
    });
  }

  return (
    <section className="card">
      <h2>Log a callout</h2>
      <div className="form-grid">
        <label>
          Which lift
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">— choose —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.siteName} · {u.tag}
                {u.maintenanceContractNo === null ? ' (no service contract)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          What kind of call
          <select value={category} onChange={(e) => setCategory(e.target.value as CalloutCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          When the call came in
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
        <label>
          Technician
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">— assign later —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field-wide">
        What was reported
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Stuck between 3 and 4, doors will not close…"
        />
      </label>

      {entrapment && (
        <p className="muted">
          <strong>Recorded as an entrapment.</strong> Counted separately from breakdowns and
          reported on its own, because the response promise does not cover it — that is an
          emergency, not a service level.
        </p>
      )}
      {unit !== undefined && unit.maintenanceContractId === null && (
        <p className="muted">
          This lift is not under a maintenance contract. The call is still recorded; it just has no
          agreement behind it.
        </p>
      )}
      {error !== null && <p className="error" role="alert">{error}</p>}

      <button type="button" className="primary" disabled={busy || blocked !== null} onClick={() => void submit()}>
        {busy ? 'Logging…' : 'Log the callout'}
      </button>
      {blocked !== null && <p className="hint">{blocked}</p>}
    </section>
  );
}

function OpenCallouts({
  rows,
  technicians,
  uid,
}: {
  rows: readonly WithId<Callout>[];
  technicians: readonly WithId<Technician>[];
  uid: string | null;
}) {
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2>Open callouts</h2>
        <p className="muted">Nothing open. Every call logged has been closed out.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>Open callouts</h2>
      <ul className="setup-list">
        {rows.map((callout) => (
          <li key={callout.id}>
            <OpenCallout callout={callout} technicians={technicians} uid={uid} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenCallout({
  callout,
  technicians,
  uid,
}: {
  callout: WithId<Callout>;
  technicians: readonly WithId<Technician>[];
  uid: string | null;
}) {
  const [when, setWhen] = useState(() => forInput(new Date()));
  const [resolution, setResolution] = useState<CalloutResolution>('fixed');
  const [firstTimeFix, setFirstTimeFix] = useState(true);
  const [technicianId, setTechnicianId] = useState('');
  const { run, busy, error } = useAsyncAction('update the callout');

  const reportedAt = callout.reportedAt.toDate();
  const arrivedAt = callout.arrivedAt?.toDate() ?? null;
  const at = when === '' ? null : new Date(when);
  const stage = callout.status;
  const refuse =
    at === null
      ? 'Give a time.'
      : whyTimeCannotBeRecorded(stage === 'on_site' ? 'resolvedAt' : 'arrivedAt', at, {
          reportedAt,
          arrivedAt,
        });

  return (
    <>
      <div className="setup-head">
        <strong>
          {callout.siteName} · {callout.unitTag}
        </strong>
        <span className="muted mono">{callout.calloutNo}</span>
        {callout.entrapment && <span className="chip">entrapment</span>}
      </div>
      <p className="muted">{callout.description}</p>
      <p className="muted">
        Reported <DualDateText value={{ at: callout.reportedAt } as never} />{' '}
        {reportedAt.toISOString().slice(11, 16)} ·{' '}
        {callout.technicianName ?? 'nobody assigned'} · {nextActionFor(stage, callout.technicianId !== null)}
      </p>

      {uid !== null && (
        <div className="link-edit">
          {stage === 'open' && callout.technicianId === null && (
            <div className="link-actions">
              <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
                <option value="">— choose a technician —</option>
                {technicians.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || technicianId === ''}
                onClick={() => {
                  const t = technicians.find((x) => x.id === technicianId);
                  if (t === undefined) return;
                  void run(() => assignCallout(callout.id, { id: t.id, name: t.name }, uid));
                }}
              >
                Assign
              </button>
            </div>
          )}

          {(stage === 'open' || stage === 'assigned') && (
            <div className="link-actions">
              <label>
                On site at
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
              </label>
              <button
                type="button"
                className="primary"
                disabled={busy || refuse !== null}
                onClick={() => at !== null && void run(() => recordArrival(callout.id, at, uid))}
              >
                Record the arrival
              </button>
            </div>
          )}

          {stage === 'on_site' && (
            <>
              <div className="link-actions">
                <label>
                  Back in service at
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                </label>
                <select value={resolution} onChange={(e) => setResolution(e.target.value as CalloutResolution)}>
                  {RESOLUTIONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <label className="choice">
                <input
                  type="checkbox"
                  checked={firstTimeFix}
                  onChange={(e) => setFirstTimeFix(e.target.checked)}
                />
                <span>
                  <strong>Fixed on this visit, no follow-up needed</strong>
                  <span className="muted">
                    {' '}
                    — asked rather than worked out, because the repeat-callout rate already measures
                    whether the repair held and the two are meant to disagree sometimes.
                  </span>
                </span>
              </label>
              <div className="link-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busy || refuse !== null || arrivedAt === null}
                  onClick={() =>
                    at !== null &&
                    arrivedAt !== null &&
                    void run(() =>
                      resolveCallout(
                        callout.id,
                        {
                          when: at,
                          reportedAt,
                          arrivedAt,
                          slaResponseMinutes: callout.slaResponseMinutes,
                          slaResolutionMinutes: callout.slaResolutionMinutes,
                          resolution,
                          firstTimeFix,
                        },
                        uid,
                      ),
                    )
                  }
                >
                  Close the callout
                </button>
                <span className="muted">
                  response so far {describeMinutes(
                    arrivedAt === null ? null : Math.round((arrivedAt.getTime() - reportedAt.getTime()) / 60_000),
                  )}
                </span>
              </div>
            </>
          )}

          {stage !== 'on_site' && (
            <div className="link-actions">
              <button type="button" disabled={busy} onClick={() => void run(() => cancelCallout(callout.id, uid))}>
                Cancel this call
              </button>
            </div>
          )}

          {refuse !== null && <p className="hint">{refuse}</p>}
          {error !== null && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </>
  );
}

function ScheduledVisits({
  rows,
  uid,
}: {
  rows: readonly WithId<MaintenanceVisit>[];
  uid: string | null;
}) {
  return (
    <section className="card">
      <h2>Visits in the diary</h2>
      {rows.length === 0 ? (
        <p className="muted">
          Nothing scheduled. Preventive maintenance compliance is measured against visits that were
          promised, so a lift with none in the diary is not counted as behind — it is not counted at
          all.
        </p>
      ) : (
        <ul className="setup-list">
          {rows.map((visit) => (
            <li key={visit.id}>
              <ScheduledVisit visit={visit} uid={uid} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScheduledVisit({
  visit,
  uid,
}: {
  visit: WithId<MaintenanceVisit>;
  uid: string | null;
}) {
  const [when, setWhen] = useState(() => forInput(new Date()));
  const [checklist, setChecklist] = useState(100);
  const [minutes, setMinutes] = useState('');
  const { run, busy, error } = useAsyncAction('record the visit');

  return (
    <>
      <div className="setup-head">
        <strong>
          {visit.siteName} · {visit.unitTag}
        </strong>
        <span className="muted">
          due <DualDateText value={visit.scheduledDate} /> ·{' '}
          {visit.technicianName ?? 'nobody assigned'}
        </span>
      </div>
      {uid !== null && (
        <div className="link-edit">
          <div className="link-actions">
            <label>
              Carried out on
              <input type="date" value={when.slice(0, 10)} onChange={(e) => setWhen(`${e.target.value}T09:00`)} />
            </label>
            <label>
              Checklist done
              <select value={checklist} onChange={(e) => setChecklist(Number(e.target.value))}>
                {[100, 90, 75, 50, 25].map((pct) => (
                  <option key={pct} value={pct}>{pct}%</option>
                ))}
              </select>
            </label>
            <label>
              Minutes on site
              <input
                type="number"
                min={0}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="optional"
              />
            </label>
          </div>
          <div className="link-actions">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  completeVisit(
                    visit.id,
                    {
                      when: new Date(when),
                      checklistCompleteBps: checklist * 100,
                      durationMinutes: minutes === '' ? null : Number(minutes),
                    },
                    uid,
                  ),
                )
              }
            >
              Record it as done
            </button>
            <button type="button" disabled={busy} onClick={() => void run(() => markVisitMissed(visit.id, uid))}>
              It did not happen
            </button>
          </div>
          <p className="muted">
            A visit marked as not happening stays that way. Preventive compliance is the share of
            promised visits actually carried out, and letting a missed one be quietly rescheduled
            into compliance would make the figure worthless.
          </p>
          {error !== null && <p className="error" role="alert">{error}</p>}
        </div>
      )}
    </>
  );
}

function ScheduleVisit({
  units,
  technicians,
  uid,
}: {
  units: readonly WithId<ElevatorUnit>[];
  technicians: readonly WithId<Technician>[];
  uid: string;
}) {
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState('');
  const [technicianId, setTechnicianId] = useState('');
  const { run, busy, error } = useAsyncAction('schedule the visit');
  const unit = units.find((u) => u.id === unitId);

  return (
    <section className="card">
      <h2>Put a visit in the diary</h2>
      <div className="form-grid">
        <label>
          Which lift
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">— choose —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.siteName} · {u.tag}</option>
            ))}
          </select>
        </label>
        <label>
          Promised for
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Technician
          <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)}>
            <option value="">— assign later —</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>
      {error !== null && <p className="error" role="alert">{error}</p>}
      <button
        type="button"
        className="primary"
        disabled={busy || unit === undefined || date === ''}
        onClick={() => {
          if (unit === undefined || date === '') return;
          const technician = technicians.find((t) => t.id === technicianId);
          void run(async () => {
            await scheduleVisit(
              {
                unitTag: unit.tag,
                siteName: unit.siteName,
                clientId: unit.clientId,
                contractId: unit.maintenanceContractId ?? '',
                scheduledFor: new Date(`${date}T09:00:00Z`),
                technicianId: technician?.id ?? null,
                technicianName: technician?.name ?? null,
              },
              uid,
            );
            setUnitId('');
            setDate('');
          });
        }}
      >
        {busy ? 'Scheduling…' : 'Schedule the visit'}
      </button>
    </section>
  );
}
