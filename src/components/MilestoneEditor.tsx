/**
 * Payment milestone editor.
 *
 * Shares are edited as percentages and must total exactly 100%. The running
 * total is shown live because a schedule that covers 95% of a contract leaves 5%
 * nobody will ever invoice — and that is far cheaper to catch here than in a
 * year-end reconciliation.
 *
 * Amounts are previewed using the same largest-remainder allocation the write
 * path uses, so what the user approves is exactly what gets stored.
 */

import { allocateMilestones, validateShares, type MilestoneShare } from '../lib/milestones.js';
import { formatETB, type VatBreakdown } from '../lib/money.js';
import { formatBps } from '../lib/kpi.js';

export function MilestoneEditor({
  shares,
  onChange,
  contract,
  disabled = false,
}: {
  shares: MilestoneShare[];
  onChange: (next: MilestoneShare[]) => void;
  contract: VatBreakdown;
  disabled?: boolean;
}) {
  const validation = validateShares(shares);
  const totalBps = shares.reduce((a, s) => a + s.shareBps, 0);

  // Only allocate once the shares are legal; allocateMilestones throws otherwise.
  const allocated = validation.ok ? allocateMilestones(contract, shares) : null;

  function update(index: number, patch: Partial<MilestoneShare>) {
    onChange(shares.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function add() {
    onChange([...shares, { name: `Payment ${shares.length + 1}`, shareBps: 0 }]);
  }

  function remove(index: number) {
    onChange(shares.filter((_, i) => i !== index));
  }

  /** Spread whatever is missing or over-allocated across the rows evenly. */
  function balance() {
    if (shares.length === 0) return;
    const even = Math.floor(10_000 / shares.length);
    const remainder = 10_000 - even * shares.length;
    onChange(shares.map((s, i) => ({ ...s, shareBps: even + (i < remainder ? 1 : 0) })));
  }

  return (
    <fieldset className="milestones" disabled={disabled}>
      <legend>Payment schedule</legend>

      <div className="table-scroll">
        <table className="milestone-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Milestone</th>
              <th scope="col" className="num">Share %</th>
              <th scope="col" className="num">Net</th>
              <th scope="col" className="num">VAT</th>
              <th scope="col" className="num">Gross</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {shares.map((share, index) => {
              const row = allocated?.[index];
              return (
                <tr key={index}>
                  <td className="num muted row-number-col" data-label="#">{index + 1}</td>
                  <td data-label="Milestone">
                    <label className="visually-hidden" htmlFor={`ms-name-${index}`}>
                      Milestone {index + 1} name
                    </label>
                    <input
                      id={`ms-name-${index}`}
                      type="text"
                      value={share.name}
                      onChange={(e) => update(index, { name: e.target.value })}
                    />
                  </td>
                  <td className="num" data-label="Share %">
                    <label className="visually-hidden" htmlFor={`ms-share-${index}`}>
                      Milestone {index + 1} share percent
                    </label>
                    <input
                      id={`ms-share-${index}`}
                      className="share-input"
                      type="text"
                      inputMode="decimal"
                      value={share.shareBps === 0 ? '' : String(share.shareBps / 100)}
                      onChange={(e) => {
                        const percent = Number(e.target.value.replace(/,/g, ''));
                        update(index, {
                          shareBps: Number.isFinite(percent) ? Math.round(percent * 100) : 0,
                        });
                      }}
                    />
                  </td>
                  <td className="num" data-label="Net">{row ? formatETB(row.netSantim, { withSymbol: false }) : '—'}</td>
                  <td className="num muted" data-label="VAT">{row ? formatETB(row.vatSantim, { withSymbol: false }) : '—'}</td>
                  <td className="num strong" data-label="Gross">{row ? formatETB(row.grossSantim, { withSymbol: false }) : '—'}</td>
                  <td data-label="">
                    <button type="button" onClick={() => remove(index)} aria-label={`Remove milestone ${index + 1}`}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className={validation.ok ? 'total-ok' : 'total-bad'}>
              <td />
              <td data-label="Total"><strong>Total</strong></td>
              <td className="num strong" data-label="Share %">{formatBps(totalBps, 2)}</td>
              <td className="num strong" data-label="Net">{formatETB(contract.netSantim, { withSymbol: false })}</td>
              <td className="num strong" data-label="VAT">{formatETB(contract.vatSantim, { withSymbol: false })}</td>
              <td className="num strong" data-label="Gross">{formatETB(contract.grossSantim, { withSymbol: false })}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="milestone-actions">
        <button type="button" onClick={add}>Add milestone</button>
        <button type="button" onClick={balance}>Split evenly</button>
      </div>

      {!validation.ok && (
        <p className="error" role="alert">{validation.error}</p>
      )}
      {validation.ok && (
        <p className="hint">
          Shares total 100%. Rounding is allocated so the milestones sum to the
          contract value exactly.
        </p>
      )}
    </fieldset>
  );
}
