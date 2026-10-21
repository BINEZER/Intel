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
  getPriorityConfig,
  saveKpiTargets,
  savePriorityConfig,
} from '../data/config.js';
import { useAsyncAction } from '../data/useCollection.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DEFAULT_PRIORITY_CONFIG } from '../lib/priority.js';
import type { KpiTargets, PriorityConfig } from '../lib/schema.js';

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
  const [priority, setPriority] = useState<PriorityConfig>({ ...DEFAULT_PRIORITY_CONFIG });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const kpiAction = useAsyncAction('save the KPI targets');
  const priorityAction = useAsyncAction('save the prioritisation settings');

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setLoadError(null);
    void Promise.all([getKpiTargets(), getPriorityConfig()])
      .then(([k, p]) => {
        if (cancelled) return;
        setTargets(k);
        setPriority(p);
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

      {/* --- KPI targets --- */}
      <section className="card">
        <h2>KPI targets</h2>
        <p className="hint">
          Agree these with the people being measured before publishing a scorecard.
          The shipped values are industry-typical starting points, not commitments.
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
