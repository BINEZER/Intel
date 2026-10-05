/**
 * Contract editor.
 *
 * The VAT breakdown updates live as the user types, and switches between
 * exclusive and inclusive pricing without them re-deriving anything by hand —
 * "4,830,000 all in" and "4,200,000 plus VAT" are the same contract, and getting
 * that wrong is a 630,000 birr mistake.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { addVat, extractVat, formatETB, VAT_RATE_BPS } from '../lib/money.js';

/** The VAT and gross for a net figure — the two fields a VatBreakdown needs beyond net. */
function deriveVatOf(netSantim: number, vatRateBps: number) {
  const { vatSantim, grossSantim } = addVat(netSantim, vatRateBps);
  return { vatSantim, grossSantim };
}
import {
  DEFAULT_SUPPLY_INSTALL_SHARES,
  equalShares,
  validateShares,
  type MilestoneShare,
} from '../lib/milestones.js';
import {
  DEFAULT_SERVICE_TERM_MONTHS,
  feePerLift,
  monthlyTerms,
  serviceFeeFigures,
  wholeMonthsBetween,
} from '../lib/service-agreement.js';
import { renewalAlertAt } from '../lib/renewal.js';
import { formatDual } from '../lib/ethiopic.js';
import { DualDateInput } from '../components/DualDateInput.js';
import { MoneyInput } from '../components/MoneyInput.js';
import { MilestoneEditor } from '../components/MilestoneEditor.js';
import { useAsyncAction } from '../data/useCollection.js';
import {
  createContract,
  deriveContractFields,
  replaceMilestones,
  updateContract,
} from '../data/contracts.js';
import { FormPanel } from '../components/FormPanel.js';
import { ReminderEditor } from '../components/ReminderEditor.js';
import type { Client, Contract, ContractType, DualDate, Reminder } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';
import { DEFAULT_WARRANTY_ALERT_DAYS, DEFAULT_WARRANTY_MONTHS, addMonthsUtc } from '../lib/lifecycle.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import { usdCentsFrom, usdCentsToInput } from '../lib/direct-supply.js';

/**
 * How long a contract runs unless somebody says otherwise.
 *
 * It is a PROPOSAL, not a rule: the field stays editable, and the moment it is
 * edited by hand the form stops proposing. A default that quietly overwrites
 * what you typed is worse than no default.
 */
const DEFAULT_TERM_MONTHS = 6;

/** A service agreement is usually for a year; an installation, for the job. */
const defaultTermMonths = (type: ContractType) =>
  type === 'maintenance' ? DEFAULT_SERVICE_TERM_MONTHS : DEFAULT_TERM_MONTHS;

export function ContractForm({
  initial,
  clients,
  uid,
  onDone,
}: {
  initial: WithId<Contract> | null;
  clients: readonly WithId<Client>[];
  uid: string;
  onDone: () => void;
}) {
  const [clientId, setClientId] = useState(initial?.clientId ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [contractNo, setContractNo] = useState(initial?.contractNo ?? '');
  const [type, setType] = useState<ContractType>(initial?.type ?? 'supply_install');
  // The value is shown as it was ENTERED, inclusive or not, so an edit that
  // touches nothing else cannot silently re-base it.
  const [valueSantim, setValueSantim] = useState(
    initial === null
      ? 0
      : initial.valueEnteredInclusive
        ? initial.valueGrossSantim
        : initial.valueNetSantim,
  );
  const [inclusive, setInclusive] = useState(initial?.valueEnteredInclusive ?? false);
  const [signedDate, setSignedDate] = useState<DualDate | null>(initial?.signedDate ?? null);
  const [startDate, setStartDate] = useState<DualDate | null>(initial?.startDate ?? null);
  const [endDate, setEndDate] = useState<DualDate | null>(initial?.endDate ?? null);
  /*
   * An end date that came from the six-month default rather than from a person.
   *
   * Editing an existing contract never counts as proposed — its end date was
   * agreed with a client, and re-deriving it from the signing date would
   * silently rewrite the term of a signed agreement.
   */
  const [endIsProposed, setEndIsProposed] = useState(initial === null);

  /** Signing moves the end date only while nobody has set one by hand. */
  function proposeEnd(signed: DualDate | null, forType: ContractType) {
    if (!endIsProposed || signed === null) return;
    setEndDate(dualDateFromGregorian(
      addMonthsUtc(signed.at.toDate(), defaultTermMonths(forType)),
      toTimestamp,
      signed.enteredIn,
    ));
  }
  function chooseSignedDate(next: DualDate | null) {
    setSignedDate(next);
    proposeEnd(next, type);
  }
  /** Choosing "maintenance" turns the proposed one-year term on, if nobody has set an end. */
  function chooseType(next: ContractType) {
    setType(next);
    proposeEnd(signedDate, next);
  }
  const [renewalWindowDays, setRenewalWindowDays] = useState(initial?.renewalWindowDays ?? 60);
  const [autoRenew, setAutoRenew] = useState(initial?.autoRenew ?? false);
  const [responseHours, setResponseHours] = useState(initial?.sla?.responseHours ?? 4);
  const [resolutionHours, setResolutionHours] = useState(initial?.sla?.resolutionHours ?? 24);
  const [visitsPerYear, setVisitsPerYear] = useState(initial?.sla?.preventiveVisitsPerYear ?? 12);
  const [shares, setShares] = useState<MilestoneShare[]>(DEFAULT_SUPPLY_INSTALL_SHARES);
  const [warrantyMonths, setWarrantyMonths] = useState(initial?.warranty?.months ?? DEFAULT_WARRANTY_MONTHS);
  const [warrantyAlertDays, setWarrantyAlertDays] = useState(
    initial?.warranty?.alertDays ?? DEFAULT_WARRANTY_ALERT_DAYS,
  );
  const [reminders, setReminders] = useState<Reminder[]>(initial?.reminders ?? []);

  /*
   * MAINTENANCE: THE MONTHLY FEE IS THE NUMBER
   *
   * A service agreement is agreed as "X a month for a year", not as a lump sum,
   * so that is what is asked. The whole-term value the rest of the app reads is
   * worked out from it. `feeEdited` exists so that opening an existing agreement
   * and changing only a date does not quietly re-derive its value from a
   * rounded monthly figure.
   */
  const initialMonths =
    initial === null ? null : wholeMonthsBetween(initial.startDate.at.toDate(), initial.endDate.at.toDate());
  const [feeSantim, setFeeSantim] = useState(
    initial?.serviceFee?.monthlyNetSantim ??
      (initial?.type === 'maintenance' && initialMonths !== null
        ? Math.round(initial.valueNetSantim / initialMonths)
        : 0),
  );
  const [feeInclusive, setFeeInclusive] = useState(false);
  const [feeEdited, setFeeEdited] = useState(false);
  const [unitCountText, setUnitCountText] = useState(String(initial?.serviceFee?.unitCount ?? 1));
  /**
   * The lift itself, where the client buys it straight from the factory.
   *
   * Held as the string that was typed rather than as cents, so a half-typed
   * "148" is not stored as USD 148.00 the moment somebody pauses.
   */
  const [directUsd, setDirectUsd] = useState(
    usdCentsToInput(initial?.equipmentPaidDirect?.amountUsdCents ?? null),
  );
  const [directPaidTo, setDirectPaidTo] = useState(initial?.equipmentPaidDirect?.paidTo ?? '');

  const { busy, error, run } = useAsyncAction('create this contract');

  // The same derivation the repository uses on write, shown live.
  const breakdown = useMemo(
    () => (inclusive ? extractVat(valueSantim, VAT_RATE_BPS) : addVat(valueSantim, VAT_RATE_BPS)),
    [valueSantim, inclusive],
  );

  const isMaintenance = type === 'maintenance';
  const unitCount = Math.max(0, Math.round(Number(unitCountText) || 0));
  const termMonths =
    startDate !== null && endDate !== null
      ? wholeMonthsBetween(startDate.at.toDate(), endDate.at.toDate())
      : DEFAULT_SERVICE_TERM_MONTHS;
  const fee = useMemo(
    () => serviceFeeFigures(feeSantim, termMonths, VAT_RATE_BPS, feeInclusive),
    [feeSantim, termMonths, feeInclusive],
  );
  /** The stored value stays put unless the fee or the term actually changed. */
  const keepStoredValue =
    initial !== null &&
    initial.type === 'maintenance' &&
    !feeEdited &&
    initialMonths === termMonths;
  const shareValidation = isMaintenance ? ({ ok: true } as const) : validateShares(shares);
  const client = clients.find((c) => c.id === clientId);

  const alertAt = useMemo(
    () => (endDate === null ? null : renewalAlertAt(endDate.at.toDate(), renewalWindowDays)),
    [endDate, renewalWindowDays],
  );

  const ready =
    clientId !== '' &&
    title.trim() !== '' &&
    (isMaintenance ? feeSantim > 0 : valueSantim > 0) &&
    signedDate !== null &&
    startDate !== null &&
    endDate !== null &&
    shareValidation.ok;

  /**
   * Has the money actually moved? An edit that only fixes a title must not
   * touch the payment schedule — and on a contract that has been invoiced,
   * touching it would fail outright.
   */
  const valueChanged =
    initial !== null &&
    (initial.type !== type ||
      (isMaintenance
        ? !keepStoredValue ||
          (startDate !== null && startDate.at.toMillis() !== initial.startDate.at.toMillis())
        : valueSantim !==
            (initial.valueEnteredInclusive ? initial.valueGrossSantim : initial.valueNetSantim) ||
          inclusive !== initial.valueEnteredInclusive));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || client === undefined) return;

    const input = {
      contractNo: contractNo.trim() || `C-${Date.now()}`,
      type,
      clientId,
      clientName: client.name,
      title: title.trim(),
      currency: 'ETB' as const,
      // A service agreement's value is the fee times the term, worked out here
      // so nobody has to multiply; an installation's is what was typed.
      valueNetSantim: isMaintenance
        ? keepStoredValue && initial !== null
          ? initial.valueNetSantim
          : fee.term.netSantim
        : valueSantim,
      vatRateBps: VAT_RATE_BPS,
      valueEnteredInclusive: isMaintenance ? false : inclusive,
      signedDate: signedDate as DualDate,
      startDate: startDate as DualDate,
      endDate: endDate as DualDate,
      autoRenew,
      renewalWindowDays,
      reminders,
      // Data only. It is never converted to birr and appears in no total —
      // see `lib/direct-supply.ts`. Absent rather than zero where there is
      // nothing to record.
      ...(isMaintenance || usdCentsFrom(directUsd) === null || usdCentsFrom(directUsd) === 0
        ? {}
        : {
            equipmentPaidDirect: {
              amountUsdCents: usdCentsFrom(directUsd) as number,
              ...(directPaidTo.trim() === '' ? {} : { paidTo: directPaidTo.trim() }),
            },
          }),
      // The warranty clock starts at HANDOVER. On an edit the dates already on
      // the contract are kept — re-deriving them from today would move an
      // expiry somebody is counting on.
      ...(warrantyMonths > 0 && !isMaintenance
        ? {
            warranty: {
              months: warrantyMonths,
              startsOn: initial?.warranty?.startsOn ?? null,
              endsOn: initial?.warranty?.endsOn ?? null,
              alertDays: warrantyAlertDays,
            },
          }
        : {}),
      renewalStatus: initial?.renewalStatus ?? ('not_due' as const),
      ...(isMaintenance
        ? {
            serviceFee: { monthlyNetSantim: fee.monthly.netSantim, unitCount },
            sla: {
              responseHours,
              resolutionHours,
              preventiveVisitsPerYear: visitsPerYear,
              metrics: initial?.sla?.metrics ?? {
                callouts: 0,
                breaches: 0,
                avgResponseHours: 0,
                visitsCompletedThisYear: 0,
                lastComputedAt: signedDate.at,
              },
            },
          }
        : {}),
      // An edit must not reset a contract somebody activated or terminated.
      status: initial?.status ?? ('draft' as const),
      attachments: initial?.attachments ?? [],
    };

    // The schedule a saved contract gets: one term a month for a service
    // agreement, the milestone editor's stages for anything else.
    const scheduleShares = isMaintenance
      ? equalShares(termMonths, Array.from({ length: termMonths }, (_, i) => `Month ${i + 1}`))
      : shares;
    const scheduleDates = isMaintenance
      ? monthlyTerms(startDate.at.toDate(), termMonths, {
          netSantim: input.valueNetSantim,
          vatRateBps: input.vatRateBps,
          ...deriveVatOf(input.valueNetSantim, input.vatRateBps),
        }).map((term) => dualDateFromGregorian(term.dueDate, toTimestamp, startDate.enteredIn))
      : [];

    const result = await run(async () => {
      if (initial === null) {
        await createContract(input, scheduleShares, uid, scheduleDates);
      } else {
        // Re-proportion the payment schedule FIRST. It refuses outright once
        // anything has been invoiced or paid, which is the right answer: a
        // schedule that has been billed against is not a draft any more. Doing
        // it before the save means a refusal changes nothing, rather than
        // leaving the new value saved against the old schedule.
        if (valueChanged) {
          const derived = deriveContractFields(input);
          await replaceMilestones(
            initial.id,
            { ...derived, vatRateBps: input.vatRateBps },
            scheduleShares,
            uid,
            scheduleDates,
          );
        }
        await updateContract(initial.id, input, uid);
      }
      return true;
    });
    if (result !== null) onDone();
  }

  return (
    <FormPanel
      title={initial === null ? 'New contract' : `Edit ${initial.contractNo}`}
      description={
        initial === null
          ? 'The contract carries the value, the VAT and the payment milestones. Those milestones are what the whole cash forecast is built from.'
          : 'Changing the value re-proportions the payment schedule — which is refused outright once any of it has been invoiced.'
      }
      onClose={onDone}
    >
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-client">Client <span className="req" aria-hidden="true">*</span></label>
            <select id="k-client" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {clients.length === 0 && <p className="hint">Add a client first.</p>}
          </div>

          <div className="field">
            <label htmlFor="k-no">Contract number</label>
            <input id="k-no" value={contractNo} onChange={(e) => setContractNo(e.target.value)} placeholder="Auto" />
          </div>

          <div className="field form-wide">
            <label htmlFor="k-title">Title <span className="req" aria-hidden="true">*</span></label>
            <input
              id="k-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Supply and installation of 3 passenger lifts"
            />
          </div>

          <div className="field">
            <label htmlFor="k-type">Type</label>
            <select id="k-type" value={type} onChange={(e) => chooseType(e.target.value as ContractType)}>
              <option value="supply_install">Supply &amp; install</option>
              <option value="maintenance">Maintenance</option>
              <option value="modernization">Modernisation</option>
              <option value="other">Other</option>
            </select>
          </div>

          {isMaintenance ? (
            <>
              <MoneyInput
                label={feeInclusive ? 'Monthly fee (VAT inclusive)' : 'Monthly fee (excluding VAT)'}
                value={feeSantim}
                onChange={(next) => {
                  setFeeSantim(next);
                  setFeeEdited(true);
                }}
                required
              />

              <div className="field checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={feeInclusive}
                    onChange={(e) => {
                      setFeeInclusive(e.target.checked);
                      setFeeEdited(true);
                    }}
                  />
                  Fee agreed VAT-inclusive
                </label>
                <p className="hint">Tick when the client agreed an all-in monthly figure.</p>
              </div>

              <div className="field">
                <label htmlFor="k-units">Lifts covered</label>
                <input
                  id="k-units"
                  type="number"
                  min={0}
                  value={unitCountText}
                  onChange={(e) => setUnitCountText(e.target.value)}
                />
                <p className="hint">
                  {feePerLift(fee.monthly.netSantim, unitCount) === null
                    ? 'Used to work out the rate per lift. Link the lifts themselves from the Lifts page.'
                    : `${formatETB(feePerLift(fee.monthly.netSantim, unitCount) ?? 0)} per lift per month, before VAT.`}
                </p>
              </div>
            </>
          ) : (
            <>
              <MoneyInput
                label={inclusive ? 'Contract value (VAT inclusive)' : 'Contract value (excluding VAT)'}
                value={valueSantim}
                onChange={setValueSantim}
                required
              />

              <div className="field checkbox">
                <label>
                  <input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} />
                  Value agreed VAT-inclusive
                </label>
                <p className="hint">Tick when the client negotiated an all-in figure.</p>
              </div>
            </>
          )}
        </div>

        {isMaintenance && feeSantim > 0 && (
          <>
            <div className="vat-summary">
              <div><span className="muted">Net a month</span><strong>{formatETB(fee.monthly.netSantim)}</strong></div>
              <div><span className="muted">VAT @ 15%</span><strong>{formatETB(fee.monthly.vatSantim)}</strong></div>
              <div className="total"><span className="muted">Client pays a month</span><strong>{formatETB(fee.monthly.grossSantim)}</strong></div>
            </div>
            <p className="hint">
              Over {termMonths} month{termMonths === 1 ? '' : 's'} (from the dates below):{' '}
              {formatETB(fee.term.netSantim)} before VAT, {formatETB(fee.term.grossSantim)} with it. This is
              the contract's value in every report.
            </p>
          </>
        )}

        {!isMaintenance && valueSantim > 0 && (
          <div className="vat-summary">
            <div><span className="muted">Net</span><strong>{formatETB(breakdown.netSantim)}</strong></div>
            <div><span className="muted">VAT @ 15%</span><strong>{formatETB(breakdown.vatSantim)}</strong></div>
            <div className="total"><span className="muted">Client pays</span><strong>{formatETB(breakdown.grossSantim)}</strong></div>
          </div>
        )}

        <div className="form-grid dates">
          <DualDateInput label="Signed" value={signedDate} onChange={chooseSignedDate} required />
          <DualDateInput label="Start" value={startDate} onChange={setStartDate} required />
          <DualDateInput
            label="End"
            value={endDate}
            onChange={(next) => {
              // Touched by hand: stop proposing, for good.
              setEndIsProposed(false);
              setEndDate(next);
            }}
            required
            {...(endIsProposed && endDate !== null
              ? {
                  hint: `${defaultTermMonths(type)} months after signing. Change it if the agreement says otherwise.`,
                }
              : {})}
          />
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="k-window">Renewal alert window (days)</label>
            <input
              id="k-window"
              type="number"
              min={0}
              value={renewalWindowDays}
              onChange={(e) => setRenewalWindowDays(Math.max(0, Number(e.target.value) || 0))}
            />
            {alertAt !== null && (
              <p className="hint">Alert starts {formatDual(alertAt)}</p>
            )}
          </div>

          <div className="field checkbox">
            <label>
              <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} />
              Auto-renews
            </label>
          </div>

          {!isMaintenance && (
            <>
          {/*
            * The lift itself, where the client buys it straight from the
            * factory and we only install it. Recorded because it says how big
            * the job really is; kept well away from every birr figure above,
            * and labelled so nobody reads it as money coming to us.
            */}
          <div className="field form-wide">
            <label htmlFor="k-direct-usd">Equipment paid directly by the client (USD)</label>
            <input
              id="k-direct-usd"
              inputMode="decimal"
              placeholder="e.g. 148200.00"
              value={directUsd}
              onChange={(e) => setDirectUsd(e.target.value)}
            />
            <p className="hint">
              For contracts where we take on the installation and the client pays the
              manufacturer for the lift. <strong>Stored as information only</strong> — it is never
              converted to birr and appears in no invoice, receivable, margin or report total.
              Leave blank where it does not apply.
            </p>
          </div>

          {directUsd.trim() !== '' && (
            <div className="field">
              <label htmlFor="k-direct-paid-to">Paid to</label>
              <input
                id="k-direct-paid-to"
                placeholder="the manufacturer"
                value={directPaidTo}
                onChange={(e) => setDirectPaidTo(e.target.value)}
              />
              <p className="hint">The factory or trader the client pays. Optional.</p>
            </div>
          )}

          <div className="field">
            <label htmlFor="k-warranty">Warranty / defects liability (months)</label>
            <input
              id="k-warranty"
              type="number"
              min={0}
              max={120}
              value={warrantyMonths}
              onChange={(e) => setWarrantyMonths(Math.max(0, Math.min(120, Number(e.target.value) || 0)))}
            />
            <p className="hint">
              Runs from handover, not from signing, so the clock starts when the project actually
              hands over. Zero if there is no warranty.
            </p>
          </div>

          <div className="field">
            <label htmlFor="k-warranty-alert">Warn before warranty ends (days)</label>
            <input
              id="k-warranty-alert"
              type="number"
              min={0}
              max={365}
              value={warrantyAlertDays}
              disabled={warrantyMonths === 0}
              onChange={(e) => setWarrantyAlertDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))}
            />
            <p className="hint">
              Long enough to inspect every unit and raise a claim while defects are still ours to fix
              for free.
            </p>
          </div>
            </>
          )}
        </div>

        {isMaintenance && (
          <fieldset className="sla-fields">
            <legend>Service level</legend>
            <p className="hint">
              Snapshotted onto every callout logged under this contract, so a later
              renegotiation cannot rewrite whether a past callout breached.
            </p>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="k-response">Response (hours)</label>
                <input id="k-response" type="number" min={0} step={0.5} value={responseHours}
                  onChange={(e) => setResponseHours(Number(e.target.value) || 0)} />
              </div>
              <div className="field">
                <label htmlFor="k-resolution">Resolution (hours)</label>
                <input id="k-resolution" type="number" min={0} step={0.5} value={resolutionHours}
                  onChange={(e) => setResolutionHours(Number(e.target.value) || 0)} />
              </div>
              <div className="field">
                <label htmlFor="k-visits">Preventive visits per year</label>
                <input id="k-visits" type="number" min={0} value={visitsPerYear}
                  onChange={(e) => setVisitsPerYear(Number(e.target.value) || 0)} />
              </div>
            </div>
          </fieldset>
        )}

        {isMaintenance ? (
          <fieldset className="payment-terms">
            <legend>Payment schedule</legend>
            {feeSantim > 0 && startDate !== null ? (
              <p>
                {termMonths} monthly payment{termMonths === 1 ? '' : 's'} of{' '}
                <strong>{formatETB(fee.monthly.grossSantim)}</strong> including VAT. The first falls due{' '}
                {formatDual(addMonthsUtc(startDate.at.toDate(), 1))}, the last{' '}
                {formatDual(addMonthsUtc(startDate.at.toDate(), termMonths))}.
              </p>
            ) : (
              <p className="muted">Enter the monthly fee and the start date to see the schedule.</p>
            )}
            <p className="hint">
              One payment term per month, created with the contract. Each is invoiced and marked paid on its
              own, so a month that is only part-paid stays open.
            </p>
          </fieldset>
        ) : (
          <MilestoneEditor shares={shares} onChange={setShares} contract={breakdown} />
        )}

        <ReminderEditor
          reminders={reminders}
          onChange={setReminders}
          sourceLabel={contractNo.trim() === '' ? 'This contract' : contractNo.trim()}
        />

        {error && <p className="error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : initial === null ? 'Create contract' : 'Save changes'}
          </button>
          <button type="button" onClick={onDone} disabled={busy}>Cancel</button>
        </div>
        {!ready && !busy && (
          <p className="hint">
            {shareValidation.ok
              ? `Complete the client, title, ${isMaintenance ? 'monthly fee' : 'value'} and all three dates.`
              : 'Payment schedule must total 100%.'}
          </p>
        )}
      </form>
    </FormPanel>
  );
}

export type { Contract };
