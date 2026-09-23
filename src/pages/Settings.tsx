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
  DEFAULT_TAX_CONFIG,
  getKpiTargets,
  getPriorityConfig,
  getTaxConfig,
  saveKpiTargets,
  savePriorityConfig,
  saveTaxConfig,
} from '../data/config.js';
import { useAsyncAction } from '../data/useCollection.js';
import { DEFAULT_KPI_TARGETS } from '../lib/kpi.js';
import { DEFAULT_PRIORITY_CONFIG } from '../lib/priority.js';
import { formatETB, santimToBirr, birrToSantim } from '../lib/money.js';
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

function MoneyField({
  label,
  santim,
  onChange,
  hint,
}: {
  label: string;
  santim: number;
  onChange: (santim: number) => void;
  hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="money-input">
        <span className="prefix">ETB</span>
        <input
          type="number"
          value={santimToBirr(santim)}
          onChange={(e) => onChange(birrToSantim(Number(e.target.value) || 0))}
        />
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Settings() {
  const { user } = useAuth();
  const [tax, setTax] = useState(DEFAULT_TAX_CONFIG);
  const [targets, setTargets] = useState<KpiTargets>({ ...DEFAULT_KPI_TARGETS });
  const [priority, setPriority] = useState<PriorityConfig>({ ...DEFAULT_PRIORITY_CONFIG });
  const [loaded, setLoaded] = useState(false);

  const taxAction = useAsyncAction('save the tax settings');
  const kpiAction = useAsyncAction('save the KPI targets');
  const priorityAction = useAsyncAction('save the prioritisation settings');

  useEffect(() => {
    let cancelled = false;
    void Promise.all([getTaxConfig(), getKpiTargets(), getPriorityConfig()])
      .then(([t, k, p]) => {
        if (cancelled) return;
        setTax(t);
        setTargets(k);
        setPriority(p);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, []);

  if (!loaded) return <p className="muted">Loading settings…</p>;

  return (
    <>
      <h1>Settings</h1>
      <p className="muted">
        Rates and targets that must be changeable without a developer. Changes apply
        to documents created from now on — figures already issued keep the rate they
        were issued under.
      </p>

      {/* --- tax --- */}
      <section className="card">
        <h2>Tax</h2>
        <p className="hint">
          ⚠️ Confirm these against current Ethiopian law with your tax advisor before
          relying on them. The shipped values reflect the Income Tax Proclamation
          979/2016 regime and a 15% VAT rate.
        </p>

        <div className="form-grid">
          <PercentField
            label="VAT rate"
            bps={tax.vatRateBps}
            onChange={(v) => setTax({ ...tax, vatRateBps: v })}
            hint="Applied to client contracts and invoices."
          />
          <PercentField
            label="Withholding — goods"
            bps={tax.whtGoodsBps}
            onChange={(v) => setTax({ ...tax, whtGoodsBps: v })}
          />
          <PercentField
            label="Withholding — services"
            bps={tax.whtServicesBps}
            onChange={(v) => setTax({ ...tax, whtServicesBps: v })}
          />
          <PercentField
            label="Withholding — supplier has no TIN"
            bps={tax.whtNoTinBps}
            onChange={(v) => setTax({ ...tax, whtNoTinBps: v })}
            hint="The penalty rate applied when a supplier cannot produce a TIN."
          />
          <MoneyField
            label="Goods threshold"
            santim={tax.whtGoodsThresholdSantim}
            onChange={(v) => setTax({ ...tax, whtGoodsThresholdSantim: v })}
            hint="Below this per-transaction value, no withholding on goods."
          />
          <MoneyField
            label="Services threshold"
            santim={tax.whtServicesThresholdSantim}
            onChange={(v) => setTax({ ...tax, whtServicesThresholdSantim: v })}
          />
          <div className="field">
            <label htmlFor="s-tin">Company TIN</label>
            <input id="s-tin" value={tax.companyTin}
              onChange={(e) => setTax({ ...tax, companyTin: e.target.value })} />
            <p className="hint">Printed on every invoice you issue.</p>
          </div>
          <div className="field">
            <label htmlFor="s-vatreg">VAT registration number</label>
            <input id="s-vatreg" value={tax.companyVatRegNo}
              onChange={(e) => setTax({ ...tax, companyVatRegNo: e.target.value })} />
          </div>
        </div>

        <div className="vat-summary">
          <div>
            <span className="muted">Example: ETB 1,000,000 contract</span>
            <strong>
              {formatETB(birrToSantim(1_000_000) + Math.round(birrToSantim(1_000_000) * tax.vatRateBps / 10_000))}
            </strong>
          </div>
          <div>
            <span className="muted">Services voucher of ETB 100,000 — we pay</span>
            <strong>
              {formatETB(
                birrToSantim(100_000) +
                  Math.round((birrToSantim(100_000) * tax.vatRateBps) / 10_000) -
                  Math.round((birrToSantim(100_000) * tax.whtServicesBps) / 10_000),
              )}
            </strong>
          </div>
        </div>

        {taxAction.error && <p className="error" role="alert">{taxAction.error}</p>}
        <div className="form-actions">
          <button type="button" className="primary" disabled={taxAction.busy || user === null}
            onClick={() => { if (user) void taxAction.run(() => saveTaxConfig(tax, user.uid)); }}>
            {taxAction.busy ? 'Saving…' : 'Save tax settings'}
          </button>
        </div>
      </section>

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
