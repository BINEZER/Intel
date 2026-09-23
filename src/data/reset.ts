/**
 * Clear the app back to empty.
 *
 * Deletes every record somebody entered or imported, children before parents,
 * and reports what the security rules would not let go rather than failing on
 * it. See `lib/reset-plan.ts` for what is covered and what is deliberately not.
 *
 * NOT TRANSACTIONAL, AND CANNOT BE
 *   Firestore has no "delete this collection" operation; a client deletes
 *   documents, in batches, one collection at a time. A reset interrupted
 *   halfway leaves the app part-empty, which is recoverable — run it again —
 *   but is worth saying out loud rather than discovering.
 *
 * REFUSALS ARE COUNTED, NOT THROWN
 *   Deleting a non-draft invoice fails at the rules with permission-denied.
 *   That is the expected answer, not an error: the pass records it as kept,
 *   names the reason, and carries on. Anything else — a network failure, a
 *   signed-out session — is a real error and is allowed to stop the run.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { RESET_TARGETS, summariseReset, type ResetOutcome, type ResetReport } from '../lib/reset-plan.js';

/** Firestore caps a batch at 500 writes; the same headroom used elsewhere. */
const BATCH_LIMIT = 400;

export interface ResetProgress {
  /** The collection being cleared, as a person would name it. */
  label: string;
  /** Collections finished so far. */
  done: number;
  total: number;
  deleted: number;
}

/**
 * Structurally, not by class: the SDK throws `FirestoreError` from some paths
 * and a plain error carrying the same `code` from others, and an instanceof
 * check that misses one turns an expected refusal into a failed reset.
 */
function isPermissionDenied(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    (cause as { code?: unknown }).code === 'permission-denied'
  );
}

/**
 * Delete these documents, counting what the rules refuse.
 *
 * Batched while the batches succeed. A batch is all-or-nothing, so one refused
 * document would lose the other 399 — on the first refusal the batch is retried
 * one document at a time, which is slow and only happens where something is
 * actually protected.
 */
async function deleteAll(
  docs: readonly QueryDocumentSnapshot[],
): Promise<{ deleted: number; kept: number }> {
  let deleted = 0;
  let kept = 0;

  for (let i = 0; i < docs.length; i += BATCH_LIMIT) {
    const slice = docs.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const document of slice) batch.delete(document.ref);
    try {
      await batch.commit();
      deleted += slice.length;
    } catch (cause) {
      if (!isPermissionDenied(cause)) throw cause;
      // Something in this batch is protected. Find out which, so the rest still go.
      for (const document of slice) {
        try {
          await deleteDoc(document.ref);
          deleted += 1;
        } catch (inner) {
          if (!isPermissionDenied(inner)) throw inner;
          kept += 1;
        }
      }
    }
  }

  return { deleted, kept };
}

/**
 * Empty the app.
 *
 * `onProgress` is called per collection rather than per document: a reset of a
 * few thousand records is over in seconds, and a counter that flickers through
 * every id tells nobody anything.
 */
export async function resetApp(onProgress: (progress: ResetProgress) => void): Promise<ResetReport> {
  const outcomes: ResetOutcome[] = [];
  let done = 0;
  let deletedSoFar = 0;

  for (const target of RESET_TARGETS) {
    onProgress({ label: target.label, done, total: RESET_TARGETS.length, deleted: deletedSoFar });

    const parents = await getDocs(collection(db, target.path));

    // Subcollections first: deleting the parent leaves them behind otherwise,
    // still stored and still reachable by a collection-group query.
    for (const sub of target.subcollections ?? []) {
      for (const parent of parents.docs) {
        const children = await getDocs(collection(doc(db, target.path, parent.id), sub));
        if (children.empty) continue;
        const result = await deleteAll(children.docs);
        deletedSoFar += result.deleted;
        outcomes.push({
          path: `${target.path}/${sub}`,
          label: `${target.label} — ${sub}`,
          found: children.docs.length,
          deleted: result.deleted,
          kept: result.kept,
          reason: result.kept > 0 ? (target.guard ?? 'The security rules do not allow these to be deleted.') : null,
        });
      }
    }

    const result = await deleteAll(parents.docs);
    deletedSoFar += result.deleted;
    outcomes.push({
      path: target.path,
      label: target.label,
      found: parents.docs.length,
      deleted: result.deleted,
      kept: result.kept,
      reason: result.kept > 0 ? (target.guard ?? 'The security rules do not allow these to be deleted.') : null,
    });

    done += 1;
    onProgress({ label: target.label, done, total: RESET_TARGETS.length, deleted: deletedSoFar });
  }

  // Several subcollection passes produce a row each; fold them into one per
  // collection so the report reads as a list of things rather than of loops.
  const merged = new Map<string, ResetOutcome>();
  for (const outcome of outcomes) {
    const existing = merged.get(outcome.path);
    if (existing === undefined) {
      merged.set(outcome.path, { ...outcome });
      continue;
    }
    existing.found += outcome.found;
    existing.deleted += outcome.deleted;
    existing.kept += outcome.kept;
    existing.reason = existing.reason ?? outcome.reason;
  }

  return summariseReset([...merged.values()].filter((o) => o.found > 0));
}
