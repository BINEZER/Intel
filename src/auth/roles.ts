/**
 * Role model, mirrored from firestore.rules.
 *
 * The role is read from a CUSTOM AUTH CLAIM, not from the users/{uid} document.
 * A claim travels with the ID token, so the security rules can check it without
 * a billed document read on every evaluation — and the client and the rules
 * agree on one source of truth.
 *
 * Claims are set by an admin-only Cloud Function (module 2). Until then, set one
 * by hand against the emulator or with the Admin SDK.
 */

import type { Role } from '../lib/schema.js';

export type { Role };

export const ROLES: readonly Role[] = ['admin', 'manager', 'finance', 'engineer', 'viewer'];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * What each role may do, kept deliberately parallel to firestore.rules.
 * The UI hides what a role cannot do; the rules are what actually enforce it.
 * These must be changed together.
 */
export const CAPABILITIES = {
  manageConfig: ['admin'],
  manageUsers: ['admin'],
  manageClients: ['admin', 'manager'],
  manageContracts: ['admin', 'manager'],
  manageProjects: ['admin', 'manager'],
  updatePhaseProgress: ['admin', 'manager', 'engineer'],
  manageInvoices: ['admin', 'finance'],
  manageDisbursements: ['admin', 'finance'],
  viewFinancials: ['admin', 'manager', 'finance'],
  useBoards: ['admin', 'manager', 'finance', 'engineer'],
  /**
   * Log a callout and record its progress. Matches the `callouts` rule: an
   * engineer is on site and is the person who knows when they arrived, so they
   * may record it — finance and viewers may not.
   */
  recordService: ['admin', 'manager', 'engineer'],
  /**
   * Put a preventive visit in the diary. Manager-only, matching the
   * `maintenanceVisits` create rule: the promised date is the yardstick PM
   * compliance is measured against, so it is not a technician's to set.
   */
  scheduleMaintenance: ['admin', 'manager'],
  read: ['admin', 'manager', 'finance', 'engineer', 'viewer'],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role | null, capability: Capability): boolean {
  if (role === null) return false;
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}
