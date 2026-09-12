/**
 * User profile repository.
 *
 * The profile document is a DIRECTORY ENTRY, not an access grant. Authority
 * lives in the custom auth claim; `role` and `active` here mirror it so managers
 * can see a staff list without reading every ID token.
 *
 * On first sign-in a user creates their own profile with role `viewer` and
 * `active: false`. That grants nothing — they still hold no claim — and it means
 * an administrator has a record to act on instead of a uid they must be told
 * over the phone.
 */

import { doc, getDoc, orderBy, query, setDoc, updateDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Role, UserProfile } from '../lib/schema.js';
import { stampCreate, stampUpdate } from './audit.js';
import { collectionRef, subscribe, type WithId } from './repository.js';
import { db } from '../firebase.js';

const PATH = 'users';

/**
 * Create the profile if it does not exist. Safe to call on every sign-in.
 * Failure is deliberately swallowed by the caller: a user who cannot write
 * their directory entry should still be able to use the app if they hold a
 * valid claim.
 */
export async function ensureProfile(user: User): Promise<void> {
  const ref = doc(db, PATH, user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return;

  await setDoc(ref, {
    email: user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'New user',
    // Must match the rule exactly: no privileges may be self-assigned.
    role: 'viewer' satisfies Role,
    active: false,
    ...stampCreate(user.uid),
  });
}

export function subscribeUsers(
  onData: (rows: WithId<UserProfile>[]) => void,
  onError: (error: Error) => void,
) {
  return subscribe<UserProfile>(query(collectionRef(PATH), orderBy('displayName')), onData, onError);
}

/**
 * Mirror a role change into the profile.
 *
 * This does NOT grant access — the custom claim does, and only the Admin SDK can
 * set that (scripts/set-user-role.mjs, or the admin Cloud Function in a later
 * module). Writing here without setting the claim leaves a profile that says
 * "finance" and an account that can do nothing, so the two must be done together.
 */
export async function mirrorRole(uid: string, role: Role, active: boolean, actingUid: string): Promise<void> {
  await updateDoc(doc(db, PATH, uid), { role, active, ...stampUpdate(actingUid) });
}

export async function updateOwnProfile(
  uid: string,
  input: { displayName?: string; phone?: string },
): Promise<void> {
  await updateDoc(doc(db, PATH, uid), { ...input, ...stampUpdate(uid) });
}
