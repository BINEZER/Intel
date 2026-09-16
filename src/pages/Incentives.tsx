/**
 * Incentives: turning the scorecard into money, and into promotions.
 *
 * THE NUMBERS HERE BELONG TO THE BUSINESS, NOT TO THE CODE.
 *
 * Every weight, band, gate and cap on this page is editable and starts from a
 * placeholder. What the application guarantees is not the policy but its
 * application: that whatever scheme is set is applied consistently, explains
 * itself in birr, and cannot pay out on evidence that is not there.
 */

import { useEffect, useMemo, useState } from 'react';
import { getIncentiveScheme, saveIncentiveScheme } from '../data/config.js';
import { subscribeTechnicians } from '../data/technicians.js';
import { useAsyncAction, useCollection } from '../data/useCollection.js';
import { useAuth } from '../auth/AuthProvider.js';
import { can } from '../auth/roles.js';
import {
  bandFor,
  CLEAN_GATE_FACTS,
  computeIncentive,
  type GateFacts,
  type IncentiveBand,
  type IncentiveScheme,
} from '../lib/incentive.js';
import { composeScore, type ScoreComponent } from '../lib/scorecard.js';
import { formatETB, santimToBirr } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';
import type { Technician } from '../lib/schema.js';

export function Incentives() {
  const { user, role } = useAuth();
  const editable = can(role, 'manageConfig') && user !== null;

  const [scheme, setScheme] = useState<IncentiveScheme | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error: saveError, run } = useAsyncAction('save the scheme');
  const [saved, setSaved] = useState(false);

  const technicians = useCollection<Technician>(
    (d, e) => subscribeTechnicians(d, e, { activeOnly: true }),
    [],
    'load technicians',
  );

  useEffect(() => {
    let cancelled = false;
    getIncentiveScheme()
      .then((loaded) => { if (!cancelled) setScheme(loaded); })
      .catch(() => { if (!cancelled) setLoadError('Could not load the incentive scheme.'); });
    return () => { cancelled = true; };
  }, []);

  if (loadError !== null) return <p className="error" role="alert">{loadError}</p>;
  if (scheme === null) return <p className="muted">Loading the scheme…</p>;

  const weightTotal = Object.values(scheme.weights).reduce((a, b) => a + b, 0);

  return (
    <>
      <h1>Incentives</h1>
      <p className="muted">
        How the scorecard becomes money and promotions. The scheme below is a starting point —
        these are not IntelMotion's numbers until you set them.
      </p>

      {saveError !== null && <p className="error" role="alert">{saveError}</p>}
      {saved && <p className="note" role="status">Scheme saved. It applies from the next calculation.</p>}

      <section className="card">
        <h2>What the scorecard weighs</h2>
        <p className="muted">
          Weights must total 100%, or the composite silently means something other than it claims.
          Currently {formatBps(weightTotal, 0)}
          {weightTotal !== 10_000 && ' — this will be refused on save.'}
        </p>

        <div className="table-scroll">
          <table className="stage-table">
            <caption className="sr-only">KPI weights</caption>
            <thead>
              <tr><th scope="col">Measure</th><th scope="col">Weight</th></tr>
            </thead>
            <tbody>
              {Object.entries(scheme.weights).map(([key, value]) => (
                <tr key={key}>
                  <td>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}</td>
                  <td>
                    <span className="weight-field">
                      <input
                        type="number" className="inline-edit num" min={0} max={100} step={0.5}
                        value={value / 100}
                        disabled={!editable || busy}
                        aria-label={`Weight for ${key}, in percent`}
                        onChange={(e) =>
                          setScheme({
                            ...scheme,
                            weights: { ...scheme.weights, [key]: Math.round(Number(e.target.value) * 100) },
                          })
                        }
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Bands</h2>
        <p className="muted">
          Four bands rather than a continuous curve, because people plan against a band and argue
          about a curve. Payout is a share of base pay.
        </p>

        <div className="table-scroll">
          <table className="stage-table">
            <caption className="sr-only">Incentive bands</caption>
            <thead>
              <tr>
                <th scope="col">Band</th>
                <th scope="col">From score</th>
                <th scope="col">Pays</th>
                <th scope="col">What it says</th>
              </tr>
            </thead>
            <tbody>
              {[...scheme.bands].sort((a, b) => a.fromBps - b.fromBps).map((band) => (
                <tr key={band.key}>
                  <td><strong>{band.label}</strong></td>
                  <td>
                    <span className="weight-field">
                      <input
                        type="number" className="inline-edit num" min={0} max={100} step={1}
                        value={band.fromBps / 100}
                        disabled={!editable || busy}
                        aria-label={`Score threshold for ${band.label}`}
                        onChange={(e) => setScheme(patchBand(scheme, band.key, { fromBps: Math.round(Number(e.target.value) * 100) }))}
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  </td>
                  <td>
                    <span className="weight-field">
                      <input
                        type="number" className="inline-edit num" min={0} max={100} step={0.5}
                        value={band.payoutBps / 100}
                        disabled={!editable || busy}
                        aria-label={`Payout for ${band.label}, as a percent of base pay`}
                        onChange={(e) => setScheme(patchBand(scheme, band.key, { payoutBps: Math.round(Number(e.target.value) * 100) }))}
                      />
                      <span aria-hidden="true">% of base</span>
                    </span>
                  </td>
                  <td className="muted">{band.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="cap">Cap on one period</label>
            <span className="weight-field">
              <input id="cap" type="number" className="num" min={0} max={100} step={0.5}
                value={scheme.capBps / 100} disabled={!editable || busy}
                onChange={(e) => setScheme({ ...scheme, capBps: Math.round(Number(e.target.value) * 100) })} />
              <span aria-hidden="true">% of base</span>
            </span>
          </div>
          <div className="field">
            <label htmlFor="coverage">Evidence floor</label>
            <span className="weight-field">
              <input id="coverage" type="number" className="num" min={0} max={100} step={5}
                value={scheme.minCoverageBps / 100} disabled={!editable || busy}
                onChange={(e) => setScheme({ ...scheme, minCoverageBps: Math.round(Number(e.target.value) * 100) })} />
              <span aria-hidden="true">%</span>
            </span>
            <p className="hint">
              Below this much of the scorecard having real data behind it, nothing is paid. A score
              built from a handful of jobs is not a measurement, and paying on one makes the whole
              scheme look arbitrary.
            </p>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Gates</h2>
        <p className="muted">
          A gate is a condition, not a weighted component. It voids the payout entirely, however
          good the rest of the scorecard looks — a scheme where safety is 15% of a score is a scheme
          that pays for unsafe work at a discount.
        </p>
        <ul className="gate-list">
          {scheme.gates.map((gate) => (
            <li key={gate.key}>
              <label>
                <input
                  type="checkbox"
                  checked={gate.enabled}
                  disabled={!editable || busy}
                  onChange={(e) =>
                    setScheme({
                      ...scheme,
                      gates: scheme.gates.map((g) => (g.key === gate.key ? { ...g, enabled: e.target.checked } : g)),
                    })
                  }
                />
                <strong>{gate.label}</strong>
              </label>
              <p className="muted">{gate.rationale}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Promotion</h2>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="promo-periods">Consecutive periods required</label>
            <input id="promo-periods" type="number" className="num" min={1} max={12}
              value={scheme.promotionPeriods} disabled={!editable || busy}
              onChange={(e) => setScheme({ ...scheme, promotionPeriods: Math.max(1, Number(e.target.value) || 1) })} />
          </div>
          <div className="field">
            <label htmlFor="promo-band">At this band or better</label>
            <select id="promo-band" value={scheme.promotionBandKey} disabled={!editable || busy}
              onChange={(e) => setScheme({ ...scheme, promotionBandKey: e.target.value })}>
              {scheme.bands.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <p className="hint">
              The run is counted back from the most recent period and stops at the first miss. Three
              good years followed by a bad quarter is not "consistently".
            </p>
          </div>
        </div>
      </section>

      {editable && (
        <div className="form-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await saveIncentiveScheme(scheme, user?.uid ?? '');
                setSaved(true);
                return true;
              })
            }
          >
            {busy ? 'Saving…' : 'Save scheme'}
          </button>
        </div>
      )}

      <SchemePreview scheme={scheme} people={technicians.rows.length} />
    </>
  );
}

function patchBand(scheme: IncentiveScheme, key: string, patch: Partial<IncentiveBand>): IncentiveScheme {
  return { ...scheme, bands: scheme.bands.map((b) => (b.key === key ? { ...b, ...patch } : b)) };
}

/**
 * What the scheme actually pays, at a score you choose.
 *
 * Without this the bands are abstract percentages. An incentive nobody can
 * reconstruct is heard as a number management chose, and motivates nothing —
 * so the arithmetic is on the page before anyone is paid by it.
 */
function SchemePreview({ scheme, people }: { scheme: IncentiveScheme; people: number }) {
  const [scorePercent, setScorePercent] = useState(88);
  const [basePercent, setBasePercent] = useState(12_000);
  const [facts, setFacts] = useState<GateFacts>(CLEAN_GATE_FACTS);

  const scoreBps = Math.round(scorePercent * 100);
  const baseSantim = Math.round(basePercent * 100);

  const scorecard = useMemo(() => {
    const components: ScoreComponent[] = Object.entries(scheme.weights).map(([key, weightBps]) => ({
      key,
      label: key.replace(/([A-Z])/g, ' $1').toLowerCase(),
      achievementBps: scoreBps,
      weightBps,
      rawValue: null,
      target: 10_000,
      direction: 'higher',
    }));
    return composeScore(components);
  }, [scheme.weights, scoreBps]);

  const result = computeIncentive(scorecard, scheme, { baseSantim, facts });
  const band = bandFor(scheme, scoreBps);

  return (
    <section className="card">
      <h2>What this pays</h2>
      <p className="muted">
        Move the score and the base to see what the scheme does before anyone is paid by it.
      </p>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="pv-score">Score</label>
          <input id="pv-score" type="range" min={0} max={100} value={scorePercent}
            onChange={(e) => setScorePercent(Number(e.target.value))} />
          <p className="hint">{scorePercent}% · {band.label}</p>
        </div>
        <div className="field">
          <label htmlFor="pv-base">Monthly base pay (birr)</label>
          <input id="pv-base" type="number" className="num" min={0} step={500} value={basePercent}
            onChange={(e) => setBasePercent(Number(e.target.value) || 0)} />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={facts.openSafetyFindings > 0}
              onChange={(e) => setFacts({ ...facts, openSafetyFindings: e.target.checked ? 1 : 0 })}
            />
            With an open safety finding
          </label>
          <p className="hint">A gate voids the payout rather than reducing it. Tick it and watch.</p>
        </div>
      </div>

      <div className="metric-grid">
        <div className={`metric-tile ${result.eligible ? 'tone-good' : 'tone-bad'}`}>
          <p className="metric-label">Payout</p>
          <p className="metric-value">{formatETB(result.payoutSantim)}</p>
          <p className="metric-note muted">
            {result.eligible ? `${formatBps(result.payoutBps, 1)} of base` : 'Blocked'}
          </p>
        </div>
        <div className="metric-tile">
          <p className="metric-label">Across {people} active {people === 1 ? 'person' : 'people'}</p>
          <p className="metric-value">{formatETB(result.payoutSantim * people)}</p>
          <p className="metric-note muted">if everyone scored the same</p>
        </div>
      </div>

      <p>{result.explanation}</p>

      {result.eligible && (
        <div className="table-scroll">
          <table className="stage-table">
            <caption>Where the payout comes from</caption>
            <thead>
              <tr>
                <th scope="col">Measure</th>
                <th scope="col" className="num">Weight</th>
                <th scope="col" className="num">Achieved</th>
                <th scope="col" className="num">Earns</th>
              </tr>
            </thead>
            <tbody>
              {result.contributions.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="num">{formatBps(c.weightBps, 0)}</td>
                  <td className="num">{c.achievementBps === null ? '—' : formatBps(c.achievementBps, 0)}</td>
                  <td className="num">{formatETB(c.santim)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" colSpan={3}>Total</th>
                <td className="num strong">
                  {santimToBirr(result.contributions.reduce((a, c) => a + c.santim, 0)).toLocaleString('en-ET', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {!result.eligible && result.blockedBy.length > 0 && (
        <ul className="reason-list">
          {result.blockedBy.map((block) => (
            <li key={block.key}><strong>{block.label}</strong> — {block.detail}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
