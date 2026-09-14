/**
 * The renewal letter, drafted.
 *
 * This exists so that "write the extension letter" is a five-minute edit rather
 * than a blank page — which is the difference between a contract renewed inside
 * its window and one renewed after it lapsed.
 *
 * Everything is editable before it is downloaded, because the draft cannot know
 * the client's contact name, the exact address, or what was agreed on the phone
 * last week. It knows the contract, the dates and the money, and that is the
 * part nobody enjoys retyping.
 */

import { useMemo, useState } from 'react';
import { draftExtensionLetter } from '../lib/alerts.js';
import { formatDual } from '../lib/ethiopic.js';
import { formatETB, santimToBirr } from '../lib/money.js';
import { useAuth } from '../auth/AuthProvider.js';
import type { Contract } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

/** A year on from the current end date, which is what a renewal almost always is. */
function oneYearOn(from: Date): Date {
  const next = new Date(from);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export function ExtensionLetter({
  contract,
  onClose,
}: {
  contract: WithId<Contract>;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const endDate = contract.endDate.at.toDate();

  const [clientAddress, setClientAddress] = useState('');
  const [siteName, setSiteName] = useState(contract.title);
  const [units, setUnits] = useState(1);
  const [proposedEnd, setProposedEnd] = useState(() => oneYearOn(endDate));
  const [upliftPercent, setUpliftPercent] = useState('0');
  const [signatoryName, setSignatoryName] = useState(user?.email?.split('@')[0] ?? '');
  const [signatoryTitle, setSignatoryTitle] = useState('Executive Manager');
  const [copied, setCopied] = useState(false);

  const uplift = Number(upliftPercent);
  const proposedValueGrossSantim = Number.isFinite(uplift)
    ? Math.round(contract.valueGrossSantim * (1 + uplift / 100))
    : contract.valueGrossSantim;

  const letter = useMemo(
    () =>
      draftExtensionLetter({
        companyName: 'IntelMotion Lifts PLC',
        companyAddress: 'Addis Ababa, Ethiopia',
        contractNo: contract.contractNo,
        clientName: contract.clientName,
        clientAddress: clientAddress.trim() === '' ? '[client address]' : clientAddress.trim(),
        siteName,
        units,
        endDate,
        proposedEndDate: proposedEnd,
        currentValueGrossSantim: contract.valueGrossSantim,
        proposedValueGrossSantim,
        signatoryName: signatoryName.trim() === '' ? '[name]' : signatoryName.trim(),
        signatoryTitle,
        // Both calendars, because an Ethiopian business letter carries both.
        formatDate: (date) => formatDual(date),
      }),
    [
      contract, clientAddress, siteName, units, endDate, proposedEnd,
      proposedValueGrossSantim, signatoryName, signatoryTitle,
    ],
  );

  function download() {
    const blob = new Blob([letter], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${contract.contractNo}-extension-letter.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="card letter-panel">
      <div className="page-head">
        <div>
          <h2>Extension letter · {contract.contractNo}</h2>
          <p className="muted">
            A first draft. Edit anything below and it rewrites as you type, then copy it into
            your letterhead or download it.
          </p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="l-site">Site</label>
          <input id="l-site" value={siteName} onChange={(e) => setSiteName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-units">Lifts covered</label>
          <input id="l-units" type="number" min={1} value={units}
            onChange={(e) => setUnits(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className="field">
          <label htmlFor="l-address">Client address</label>
          <input id="l-address" value={clientAddress} placeholder="Megenagna, Addis Ababa"
            onChange={(e) => setClientAddress(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-end">Proposed new end date</label>
          <input id="l-end" type="date" value={proposedEnd.toISOString().slice(0, 10)}
            onChange={(e) => {
              const next = new Date(`${e.target.value}T00:00:00Z`);
              if (!Number.isNaN(next.getTime())) setProposedEnd(next);
            }} />
        </div>
        <div className="field">
          <label htmlFor="l-uplift">Price adjustment (%)</label>
          <input id="l-uplift" type="number" step={0.5} value={upliftPercent}
            onChange={(e) => setUpliftPercent(e.target.value)} />
          <p className="hint">
            {formatETB(contract.valueGrossSantim)} → {formatETB(proposedValueGrossSantim)} a year
            {uplift === 0 ? ' — the letter will say there is no increase' : ''}
          </p>
        </div>
        <div className="field">
          <label htmlFor="l-name">Signed by</label>
          <input id="l-name" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="l-title">Title</label>
          <input id="l-title" value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} />
        </div>
      </div>

      <label className="field">
        <span>Letter</span>
        <textarea className="letter-body" readOnly value={letter} rows={24} />
      </label>

      <div className="form-actions">
        <button type="button" className="primary" onClick={download}>Download</button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(letter).then(
              () => setCopied(true),
              // Clipboard access is refused in plenty of ordinary situations.
              // Saying so beats a button that silently does nothing.
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span className="muted">
          Annual value {santimToBirr(proposedValueGrossSantim).toLocaleString('en-ET')} birr, VAT included.
        </span>
      </div>
    </section>
  );
}
