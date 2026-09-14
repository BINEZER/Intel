/**
 * Moving a payment voucher along.
 *
 * Blocked actions are SHOWN, disabled, with their reason attached. A missing
 * button looks like a bug and gets worked around by asking someone else to log
 * in; a greyed-out "Approve" that says "you verified this work, so someone else
 * must approve the payment" teaches the rule in the moment it matters.
 */

import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.js';
import { advanceDisbursement, payDisbursement } from '../data/disbursements.js';
import { useAsyncAction } from '../data/useCollection.js';
import { availableTransitions, type PayoutStatus } from '../lib/payout-workflow.js';
import { dualDateFromGregorian } from '../lib/dual-date.js';
import { toTimestamp } from '../firebase.js';
import type { Disbursement } from '../lib/schema.js';
import type { WithId } from '../data/repository.js';

/** Transitions that cannot be made without an explanation. */
const NEEDS_REASON: readonly PayoutStatus[] = ['rejected', 'on_hold'];

export function PayoutActions({
  voucher,
  onDone,
}: {
  voucher: WithId<Disbursement>;
  onDone?: () => void;
}) {
  const { user, role } = useAuth();
  const { busy, error, run } = useAsyncAction('move this voucher');
  const [asking, setAsking] = useState<PayoutStatus | null>(null);
  const [reason, setReason] = useState('');

  const uid = user?.uid ?? '';
  const workflow = voucher.workflow;

  const transitions = availableTransitions(voucher.status, {
    uid,
    role,
    actors: {
      ...(workflow?.requestedBy == null ? {} : { requested: workflow.requestedBy }),
      ...(workflow?.checkedBy == null ? {} : { checked: workflow.checkedBy }),
      ...(workflow?.approvedBy == null ? {} : { approved: workflow.approvedBy }),
    },
  });

  if (transitions.length === 0) return null;

  const move = (to: PayoutStatus, why?: string) =>
    void run(async () => {
      // Payment is not just a status change: it issues the withholding
      // certificate the subcontractor needs to claim the credit.
      if (to === 'paid') {
        await payDisbursement(
          voucher.id,
          {
            paymentDate: dualDateFromGregorian(new Date(), toTimestamp, 'GC'),
            paymentMethod: 'bank_transfer',
            whtSantim: voucher.whtSantim,
          },
          uid,
        );
      } else {
        await advanceDisbursement(voucher.id, to, { uid, role }, why === undefined ? {} : { reason: why });
      }
      setAsking(null);
      setReason('');
      onDone?.();
      return true;
    });

  return (
    <div className="payout-actions">
      {error !== null && <p className="error" role="alert">{error}</p>}

      {asking !== null ? (
        <form
          className="reason-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim() !== '') move(asking, reason);
          }}
        >
          <label>
            Why?
            <input
              autoFocus
              value={reason}
              disabled={busy}
              placeholder={asking === 'rejected' ? 'Quantities do not match the site record' : 'Waiting on the delivery note'}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button type="submit" className="primary" disabled={busy || reason.trim() === ''}>Confirm</button>
          <button type="button" disabled={busy} onClick={() => { setAsking(null); setReason(''); }}>Cancel</button>
        </form>
      ) : (
        transitions.map((transition) => (
          <button
            key={transition.to}
            type="button"
            className={transition.to === 'paid' || transition.to === 'approved' ? 'primary' : ''}
            disabled={busy || transition.blockedBy !== null}
            title={transition.blockedBy ?? undefined}
            onClick={() =>
              NEEDS_REASON.includes(transition.to) ? setAsking(transition.to) : move(transition.to)
            }
          >
            {transition.label}
          </button>
        ))
      )}

      {/* The reason a button is disabled has to be readable, not only hoverable. */}
      {transitions.some((t) => t.blockedBy !== null) && asking === null && (
        <p className="muted payout-blocked">
          {transitions.filter((t) => t.blockedBy !== null).map((t) => `${t.label}: ${t.blockedBy}`).join(' ')}
        </p>
      )}
    </div>
  );
}
