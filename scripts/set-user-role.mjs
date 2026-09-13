#!/usr/bin/env node
/**
 * Grant a user their role and active flag.
 *
 * Roles live in custom auth claims, so a newly signed-up user has NO role and
 * no access until this is run. Use it to bootstrap the first admin; after
 * module 2 lands, admins manage roles from Settings.
 *
 * Against the emulator (no credentials needed):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   GCLOUD_PROJECT=intel-afc60 \
 *   node scripts/set-user-role.mjs someone@example.com admin
 *
 * Against a real project:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   GCLOUD_PROJECT=intel-afc60 \
 *   node scripts/set-user-role.mjs someone@example.com admin
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const ROLES = ['admin', 'manager', 'finance', 'engineer', 'viewer'];

const [identifier, role, activeArg = 'true'] = process.argv.slice(2);

if (!identifier || !role) {
  console.error('Usage: node scripts/set-user-role.mjs <email|uid> <role> [active]');
  console.error(`  role: ${ROLES.join(' | ')}`);
  process.exit(1);
}

// A Firebase uid is 28 characters with no "@". Accepting either means the
// console (which shows a uid) and a staff list (which shows emails) both work
// without the caller having to know which is which.
const looksLikeUid = !identifier.includes('@');
if (!ROLES.includes(role)) {
  console.error(`Unknown role '${role}'. Expected one of: ${ROLES.join(', ')}`);
  process.exit(1);
}

const usingEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT;
if (!projectId) {
  console.error('Set GCLOUD_PROJECT to the target Firebase project id.');
  process.exit(1);
}

initializeApp(usingEmulator ? { projectId } : { credential: applicationDefault(), projectId });

const auth = getAuth();
const user = await (looksLikeUid ? auth.getUser(identifier) : auth.getUserByEmail(identifier)).catch(
  () => null,
);
if (user === null) {
  console.error(
    `No user matching '${identifier}' in project ${projectId}. ` +
      `Create the account in Authentication > Users first.`,
  );
  process.exit(1);
}

const active = activeArg !== 'false';
await auth.setCustomUserClaims(user.uid, { role, active });

console.log(
  `${user.email ?? user.uid} -> role=${role} active=${active} in ${projectId}` +
    (usingEmulator ? ' (emulator)' : '') +
    '\nThey must sign out and back in, or the app must call refreshRole(), ' +
    'before the new claim takes effect.',
);
