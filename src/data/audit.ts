/**
 * Audit stamping.
 *
 * The security rules require `createdAt`/`updatedAt` to equal `request.time`
 * exactly, which means they MUST be written with `serverTimestamp()` — a
 * client-generated `Timestamp.now()` is rejected, and rightly so: a clock the
 * client controls is not an audit trail.
 *
 * The rules also require an update to leave `createdAt`/`createdBy` untouched,
 * so `stampUpdate` deliberately omits them rather than re-sending what it read.
 */

import { serverTimestamp, type FieldValue } from 'firebase/firestore';

export interface CreateStamp {
  createdAt: FieldValue;
  updatedAt: FieldValue;
  createdBy: string;
  updatedBy: string;
}

export interface UpdateStamp {
  updatedAt: FieldValue;
  updatedBy: string;
}

export function stampCreate(uid: string): CreateStamp {
  return {
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
  };
}

export function stampUpdate(uid: string): UpdateStamp {
  return { updatedAt: serverTimestamp(), updatedBy: uid };
}

/** Fields a caller must never set directly; stripped before every write. */
const RESERVED = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'id'] as const;

export function stripReserved<T extends Record<string, unknown>>(data: T): Omit<T, (typeof RESERVED)[number]> {
  const copy = { ...data } as Record<string, unknown>;
  for (const key of RESERVED) delete copy[key];
  return copy as Omit<T, (typeof RESERVED)[number]>;
}
