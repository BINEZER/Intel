/**
 * Writing a changed relationship.
 *
 * One function, because every relink is the same shape: work out the fields
 * from `lib/relink.ts`, write them to the collection that owns the link, stamp
 * it. The rules about WHICH fields — including the names cached beside the ids
 * — live in the library, where a test can pin them down.
 *
 * WHY THIS IS NOT SEVEN FUNCTIONS
 *   It was going to be `setProjectContract`, `setUnitClient` and five more,
 *   each remembering its own denormalised name. Seven places to forget the
 *   name is seven ways to file a lift under one client and label it with
 *   another.
 */

import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase.js';
import { stampUpdate } from './audit.js';
import { LINK_COLLECTION, canClear, linkPatch, type LinkKind, type LinkTarget } from '../lib/relink.js';

/**
 * Point `recordId` at `target`, or at nothing.
 *
 * Throws rather than silently keeping the old value where a link is required:
 * a project with no client is not a state the app should be able to reach, and
 * failing loudly here beats discovering it in a report.
 */
export async function relink(
  kind: LinkKind,
  recordId: string,
  target: LinkTarget | null,
  uid: string,
): Promise<void> {
  if (target === null && !canClear(kind)) {
    throw new Error('That link cannot be left empty.');
  }
  await updateDoc(doc(db, LINK_COLLECTION[kind], recordId), {
    ...linkPatch(kind, target),
    ...stampUpdate(uid),
  });
}
