/**
 * Settings: tax rates, KPI targets and prioritisation tunables.
 *
 * Everything here is a figure someone has to be able to change without a
 * developer. Tax rates move by proclamation; KPI targets are a negotiation with
 * the people being measured, not a constant.
 *
 * Admin-only, enforced by the security rules rather than by hiding the page.
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { Maintenance } from '../components/Maintenance.js';
import {
  getKpiTargets,
  getKpiDefinitions,
  getKpiWeights,
  getPriorityConfig,
  saveKpiTargets,
  saveKpiDefinitions,
  saveKpiWeights,
  savePriorityConfig,
} from '../data/config.js';
import { useAsyncAction } from '../data/useCollection.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DEFAULT_PRIORITY_CONFIG } from '../lib/priority.js';
import type { KpiTargets, PriorityConfig, ProjectKpiWeights, TechnicianKpiWeights } from '../lib/schema.js';
import { DEFAULT_PROJECT_WEIGHTS, DEFAULT_TECHNICIAN_WEIGHTS } from '../lib/scorecard.js';
import { DEFAULT_KPI_DEFINITIONS, type KpiDefinition, type KpiScope } from '../lib/kpi-definitions.js';

/** A percentage stored as basis points, edited as a percentage. */
function PercentField({
  label,
  bps,
  onChange,
  hint,
}: {
  label: string;
  bps: number;
  onChange: (bps: number) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="suffix-input">
        <input
          type="number"
          step={0.01}
          value={bps / 100}
          onChange={(e) => onChange(Math.round((Number(e.target.value) || 0) * 100))}
        />
        <span className="suffix">%</span>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}


export function Settings() {
  const { user } = useAuth();
  const [targets, setTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS });
  const [definitions, setDefinitions] = useState<KpiDefinition[]>(DEFAULT_KPI_DEFINITIONS.map((item) => ({ ...item })));
  const [priority, setPriority] = useState<PriorityConfig>({ ...DEFAULT_PRIORITY_CONFIG });
  const [weights, setWeights] = useState<{ project: ProjectKpiWeights; technician: TechnicianKpiWeights }>({
    project: { ...DEFAULT_PROJECT_WEIGHTS }, technician: { ...DEFAULT_TECHNICIAN_WEIGHTS },
  });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const kpiAction = useAsyncAction('save the KPI targets');
  const priorityAction = useAsyncAction('save the prioritisation settings');
  const weightsAction = useAsyncAction('save the KPI weights');
  const definitionsAction = useAsyncAction('save KPI definitions');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    void Promise.all([getKpiTargets(), getPriorityConfig(), getKpiWeights(), getKpiDefinitions()])
      .then(([k, p, w, d]) => {
        if (cancelled) return;
        setTargets(k);
        setPriority(p);
        setWeights(w);
        setDefinitions(d);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load settings from the database.');
        setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (!loaded) return <p className="muted">Loading settings…</p>;
  if (loadError !== null) {
    return (
      <section className="card">
        <h1>Settings could not be loaded</h1>
        <p className="error" role="alert">{loadError}</p>
        <p className="muted">Your changes have not been saved. Retry after checking your connection and admin access.</p>
        <button type="button" className="primary" onClick={() => setReloadKey((key) => key + 1)}>
          Retry loading settings
        </button>
      </section>
    );
  }

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">
        Operational KPI targets and the weights used to prioritise receivables. Historical invoices and contract values are not rewritten by these settings.
      </p>

      <p className="hint">VAT is applied automatically to sales. Tax rates used for calculations are maintained in the application logic; this page is for operational KPI and receivables-priority settings.</p>

      <section className="card">
        <h2>KPI definitions</h2>
        <p className="hint">Choose which built-in measurements to show, rename them for your teams, and remove metrics you do not use. Target numbers are edited below; weights are edited in the scorecard section. Removing a KPI from this list hides it from the KPI panels but does not delete historical records.</p>
        <div className="stack-list">
          {definitions.map((item) => (
            <div className="card" key={item.key}>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`kpi-name-${item.key}`}>KPI name</label>
                  <input id={`kpi-name-${item.key}`} value={item.label}
                    onChange={(e) => setDefinitions(definitions.map((row) => row.key === item.key ? { ...row, label: e.target.value } : row))} />
                </div>
                <div className="field">
                  <label htmlFor={`kpi-scope-${item.key}`}>Applies to</label>
                  <select id={`kpi-scope-${item.key}`} value={item.scope}
                    onChange={(e) => setDefinitions(definitions.map((row) => row.key === item.key ? { ...row, scope: e.target.value as KpiScope } : row))}>
                    <option value="project">Project delivery</option>
                    <option value="service">Service &amp; maintenance</option>
                    <option value="installation">Installation</option>
                    <option value="workforce">Workforce</option>
                  </select>
                </div>
                <div className="field checkbox">
                  <label><input type="checkbox" checked={item.enabled}
                    onChange={(e) => setDefinitions(definitions.map((row) => row.key === item.key ? { ...row, enabled: e.target.checked } : row))} />
                    Show this KPI</label>
                </div>
                <div className="field">
                  <button type="button" onClick={() => setDefinitions(definitions.filter((row) => row.key !== item.key))}>Remove KPI</button>
                </div>
              </div>
              <p className="hint">Measurement: {item.key}. This metric is calculated from existing project/service records.</p>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <label className="field" htmlFor="kpi-restore">Restore removed KPI</label>
          <select id="kpi-restore" value="" onChange={(e) => {
            const item = DEFAULT_KPI_DEFINITIONS.find((row) => row.key === e.target.value);
            if (item && !definitions.some((row) => row.key === item.key)) setDefinitions([...definitions, { ...item }]);
          }}>
            <option value="">Choose a built-in KPI…</option>
            {DEFAULT_KPI_DEFINITIONS.filter((item) => !definitions.some((row) => row.key === item.key)).map((item) => (
              <option key={item.key} value={item.key}>{item.label}</option>
            ))}
          </select>
          {definitionsAction.error && <p className="error" role="alert">{definitionsAction.error}</p>}
          <button type="button" className="primary" disabled={definitionsAction.busy || user === null}
            onClick={() => { if (user) void definitionsAction.run(() => saveKpiDefinitions(definitions, user.uid)); }}>
            {definitionsAction.busy ? 'Saving…' : 'Save KPI definitions'}
          </button>
        </div>
      </section>

      {/* --- KPI targets --- */}
      <section className="card">
        <h2>Service &amp; maintenance KPI targets</h2>
        <p className="hint">
          These targets apply to service and maintenance measures such as callouts, response times and preventive visits. They are not installation-team targets.
        </p>

        <div className="form-grid">
          <PercentField label="First-time fix" bps={targets.firstTimeFixBps}
            onChange={(v) => setTargets({ ...targets, firstTimeFixBps: v })} />
          <PercentField label="Repeat callouts (lower is better)" bps={targets.repeatCalloutBps}
            onChange={(v) => setTargets({ ...targets, repeatCalloutBps: v })} />
          <PercentField label="Response SLA compliance" bps={targets.slaResponseComplianceBps}
            onChange={(v) => setTargets({ ...targets, slaResponseComplianceBps: v })} />
          <PercentField label="Resolution SLA compliance" bps={targets.slaResolutionComplianceBps}
            onChange={(v) => setTargets({ ...targets, slaResolutionComplianceBps: v })} />
          <PercentField label="Preventive maintenance compliance" bps={targets.pmComplianceBps}
            onChange={(v) => setTargets({ ...targets, pmComplianceBps: v })} />
          <PercentField label="Preventive maintenance on time" bps={targets.pmOnTimeBps}
            onChange={(v) => setTargets({ ...targets, pmOnTimeBps: v })} />
          <PercentField label="Utilisation" bps={targets.utilisationBps}
            onChange={(v) => setTargets({ ...targets, utilisationBps: v })} />
          <PercentField label="Gross margin" bps={targets.grossMarginBps}
            onChange={(v) => setTargets({ ...targets, grossMarginBps: v })} />

          <div className="field">
            <label>Repeat callout window (days)</label>
            <input type="number" min={1} value={targets.repeatCalloutWindowDays}
              onChange={(e) => setTargets({ ...targets, repeatCalloutWindowDays: Number(e.target.value) || 30 })} />
            <p className="hint">A callout on the same lift within this window counts as a repeat.</p>
          </div>
          <div className="field">
            <label>Certification warning (days)</label>
            <input type="number" min={1} value={targets.certificationWarningDays}
              onChange={(e) => setTargets({ ...targets, certificationWarningDays: Number(e.target.value) || 60 })} />
          </div>
        </div>

        {kpiAction.error && <p className="error" role="alert">{kpiAction.error}</p>}
        <div className="form-actions">
          <button type="button" className="primary" disabled={kpiAction.busy || user === null}
            onClick={() => { if (user) void kpiAction.run(() => saveKpiTargets(targets, user.uid)); }}>
            {kpiAction.busy ? 'Saving…' : 'Save KPI targets'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Project and team KPI weights</h2>
        <p className="hint">Choose what matters most when combining evidence into a score. Project delivery weights are separate from technician/service weights. Each group must total 100%.</p>
        <h3>Project delivery</h3>
        <div className="form-grid">
          <PercentField label="Schedule" bps={weights.project.schedule} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, schedule: v } })} />
          <PercentField label="Margin" bps={weights.project.margin} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, margin: v } })} />
          <PercentField label="Billing" bps={weights.project.billing} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, billing: v } })} />
          <PercentField label="Collection" bps={weights.project.collection} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, collection: v } })} />
          <PercentField label="Quality" bps={weights.project.quality} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, quality: v } })} />
          <PercentField label="Team" bps={weights.project.team} onChange={(v) => setWeights({ ...weights, project: { ...weights.project, team: v } })} />
        </div>
        <h3>Technicians — service measures</h3>
        <div className="form-grid">
          <PercentField label="First-time fix" bps={weights.technician.firstTimeFix} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, firstTimeFix: v } })} />
          <PercentField label="Repeat callouts" bps={weights.technician.repeatCallouts} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, repeatCallouts: v } })} />
          <PercentField label="Response SLA" bps={weights.technician.responseSla} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, responseSla: v } })} />
          <PercentField label="Resolution SLA" bps={weights.technician.resolutionSla} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, resolutionSla: v } })} />
          <PercentField label="Preventive maintenance" bps={weights.technician.pmCompliance} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, pmCompliance: v } })} />
          <PercentField label="PM on time" bps={weights.technician.pmOnTime} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, pmOnTime: v } })} />
          <PercentField label="Utilisation" bps={weights.technician.utilisation} onChange={(v) => setWeights({ ...weights, technician: { ...weights.technician, utilisation: v } })} />
        </div>
        {weightsAction.error && <p className="error" role="alert">{weightsAction.error}</p>}
        <div className="form-actions">
          <button type="button" className="primary" disabled={weightsAction.busy || user === null}
            onClick={() => { if (user) void weightsAction.run(() => saveKpiWeights(weights, user.uid)); }}>
            {weightsAction.busy ? 'Saving…' : 'Save KPI weights'}
          </button>
        </div>
      </section>

      {/* --- prioritisation --- */}
      <section className="card">
        <h2>Prioritisation</h2>
        <p className="hint">
          How the priority board weighs money. Overdue receivables are weighted
          highest because they are already earned — recovering them needs a phone
          call, not a crew.
        </p>

        <div className="form-grid">
          <div className="field">
            <label>Horizon (days)</label>
            <input type="number" min={7} value={priority.horizonDays}
              onChange={(e) => setPriority({ ...priority, horizonDays: Number(e.target.value) || 90 })} />
            <p className="hint">How far ahead upcoming milestones are counted.</p>
          </div>
          <PercentField label="Weight — overdue receivables" bps={priority.overdueWeightBps}
            onChange={(v) => setPriority({ ...priority, overdueWeightBps: v })} />
          <PercentField label="Weight — invoiced, not yet due" bps={priority.currentWeightBps}
            onChange={(v) => setPriority({ ...priority, currentWeightBps: v })} />
          <PercentField label="Weight — upcoming milestones" bps={priority.upcomingWeightBps}
            onChange={(v) => setPriority({ ...priority, upcomingWeightBps: v })} />
          <div className="field">
            <label>Critical overdue (days)</label>
            <input type="number" min={1} value={priority.criticalOverdueDays}
              onChange={(e) => setPriority({ ...priority, criticalOverdueDays: Number(e.target.value) || 90 })} />
          </div>
        </div>

        {priorityAction.error && <p className="error" role="alert">{priorityAction.error}</p>}
        <div className="form-actions">
          <button type="button" className="primary" disabled={priorityAction.busy || user === null}
            onClick={() => { if (user) void priorityAction.run(() => savePriorityConfig(priority, user.uid)); }}>
            {priorityAction.busy ? 'Saving…' : 'Save prioritisation'}
          </button>
        </div>
      </section>

      {/* Last on the page on purpose: everything above is a number somebody
          adjusts, and these two delete records. */}
      <Maintenance />
    </>
  );
}
