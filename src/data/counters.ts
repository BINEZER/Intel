/**
 * Sequential document numbering.
 *
 * Ethiopian VAT invoices must be sequential and gapless. Firestore has no
 * sequence type, and the obvious alternatives are all wrong:
 *
 *   - a timestamp is not sequential
 *   - counting existing documents races two users invoicing at once, and
 *     silently reuses a number after a deletion
 *   - a client-side counter is whatever the client says it is
 *
 * So the sequence lives in a counter document bumped inside a TRANSACTION. Two
 * users clicking "issue" simultaneously get consecutive numbers, not the same
 * one — and a duplicated invoice number is a finding in any audit.
 */

import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase.js';

const PATH = 'counters';

export type CounterKey = 'invoice' | 'disbursement' | 'whtCertificate' | 'project' | 'contract' | 'callout';

/**
 * Claim the next number in a sequence.
 *
 * The returned number is consumed whether or not the caller goes on to write
 * the document, which is deliberate: a gap from an abandoned draft is a
 * question an auditor can answer, while a reused number is one they cannot.
 */
export async function nextSequence(key: CounterKey): Promise<number> {
  const ref = doc(db, PATH, key);
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists() ? ((snapshot.data() as { value?: number }).value ?? 0) : 0;
    const next = current + 1;
    transaction.set(ref, { value: next, updatedAt: new Date() }, { merge: true });
    return next;
  });
}

/**
 * Read a sequence without consuming it, for showing "next number will be…".
 * Never use this to assign a number — only `nextSequence` is safe under
 * concurrency.
 */
export async function peekSequence(key: CounterKey): Promise<number> {
  const snapshot = await runTransaction(db, async (transaction) =>
    transaction.get(doc(db, PATH, key)),
  );
  return snapshot.exists() ? ((snapshot.data() as { value?: number }).value ?? 0) + 1 : 1;
}
