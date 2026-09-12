/**
 * Authority inspection and certification.
 *
 * Handover is gated on this, so the panel states plainly whether it is blocking
 * and how many attempts it has taken — the first-pass rate across projects is
 * the input to estimating the next one honestly.
 */

import { useState } from 'react';
import { can } from '../auth/roles.js';
import { useAuth } from '../auth/AuthProvider.js';
import { recordInspectionResult } from '../data/projects.js';
import { useAsyncAction } from '../data/useCollection.js';
import { summariseCertification, type CertificationResult } from '../lib/phases.js';
import { DualDateInput, DualDateText } from './DualDateInput.js';
import type { DualDate, ProjectPhase } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

export function CertificationPanel({
  projectId,
  phase,
}: {
  projectId: string;
  phase: WithId<ProjectPhase>;
}) {
  const { user, role } = useAuth();
  const editable = can(role, 'manageProjects');
  const { busy, error, run } = useAsyncAction('record the inspection result');

  const cert = phase.certification;
  const [certificateNo, setCertificateNo] = useState(cert?.certificateNo ?? '');
  const [issued, setIssued] = useState<DualDate | null>(cert?.certificateIssuedDate ?? null);
  const [expiry, setExpiry] = useState<DualDate | null>(cert?.certificateExpiryDate ?? null);

  // Only the authority-inspection phase carries a certification block.
  if (cert === undefined) return null;
  const certification = cert;

  const summary = summariseCertification(
    {
      result: certification.result,
      attempts: certification.attempts ?? 0,
      certificateExpiryDate: certification.certificateExpiryDate?.at.toDate() ?? null,
    },
    new Date(),
  );

  async function record(result: Exclude<CertificationResult, 'pending'>) {
    if (user === null) return;
    await run(() =>
      recordInspectionResult(
        projectId,
        phase.id,
        { result: certification.result, attempts: certification.attempts ?? 0 },
        result,
        {
          certificateNo,
          certificateIssuedDate: issued,
          certificateExpiryDate: expiry,
        },
        user.uid,
      ),
    );
  }

  const verdictClass =
    summary.result === 'passed' ? 'risk-none' : summary.result === 'failed_rework' ? 'risk-high' : 'risk-medium';

  return (
    <section className="card">
      <h2>Authority inspection</h2>
      <p className="muted">{certification.authority}</p>

      <div className="cert-status">
        <span className={`risk-badge ${verdictClass}`}>{summary.result.replace(/_/g, ' ')}</span>
        {summary.attempts > 0 && (
          <span className="muted">
            {summary.attempts} attempt{summary.attempts === 1 ? '' : 's'}
            {summary.firstPass === true && ' — passed first time'}
            {summary.firstPass === false && ' — required rework'}
          </span>
        )}
        {summary.blocksHandover && (
          <span className="danger-text">Handover is blocked until this passes.</span>
        )}
      </div>

      {summary.expiryState !== 'not_applicable' && (
        <p className={summary.expiryState === 'valid' ? 'hint' : 'warn-text'}>
          Certificate {summary.expiryState === 'expired' ? 'expired' : 'expires'}{' '}
          <DualDateText value={certification.certificateExpiryDate} />
          {summary.daysUntilExpiry !== null && summary.expiryState !== 'valid' && (
            <> ({Math.abs(summary.daysUntilExpiry)} days {summary.daysUntilExpiry < 0 ? 'ago' : 'away'})</>
          )}
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}

      {editable && (
        <>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="cert-no">Certificate number</label>
              <input id="cert-no" value={certificateNo} onChange={(e) => setCertificateNo(e.target.value)} />
            </div>
            <DualDateInput label="Issued" value={issued} onChange={setIssued} />
            <DualDateInput label="Expires" value={expiry} onChange={setExpiry} />
          </div>

          <div className="form-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void record('passed')}>
              Record pass
            </button>
            <button type="button" disabled={busy} onClick={() => void record('failed_rework')}>
              Record failure &amp; rework
            </button>
            <button type="button" disabled={busy} onClick={() => void record('not_applicable')}>
              Not applicable
            </button>
          </div>
          <p className="hint">
            Recording a pass or failure counts as an inspection attempt. Marking it
            not applicable does not — that keeps the first-pass rate honest.
          </p>
        </>
      )}
    </section>
  );
}
