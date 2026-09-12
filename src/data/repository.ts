/**
 * Thin Firestore helpers shared by every repository.
 *
 * Deliberately not an ORM. Each repository states its own queries so the
 * composite indexes they need stay visible in the code rather than emerging
 * from a query builder at runtime.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase.js';

/** Every document read through this layer carries its own id. */
export type WithId<T> = T & { id: string };

export function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>): WithId<T> {
  return { id: snapshot.id, ...(snapshot.data() as T) };
}

export async function getOne<T>(path: string, id: string): Promise<WithId<T> | null> {
  const snapshot = await getDoc(doc(db, path, id));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...(snapshot.data() as T) };
}

export async function getMany<T>(query: Query<DocumentData>): Promise<WithId<T>[]> {
  const snapshot = await getDocs(query);
  return snapshot.docs.map((d) => withId<T>(d));
}

/**
 * Live subscription. Returns the unsubscribe function; callers in React must
 * return it from an effect or the listener leaks across re-renders.
 */
export function subscribe<T>(
  query: Query<DocumentData>,
  onData: (rows: WithId<T>[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query,
    (snapshot) => onData(snapshot.docs.map((d) => withId<T>(d))),
    onError,
  );
}

export function collectionRef(path: string) {
  return collection(db, path);
}

export function newId(path: string): string {
  return doc(collection(db, path)).id;
}

/**
 * Turn a Firestore permission error into something a user can act on.
 * "Missing or insufficient permissions" tells a manager nothing about which
 * rule refused them or why.
 */
export function describeFirestoreError(error: unknown, action: string): string {
  const code = (error as { code?: string } | null)?.code ?? '';
  switch (code) {
    case 'permission-denied':
      return `Your role does not allow you to ${action}. If this is wrong, ask an administrator to check your access.`;
    case 'failed-precondition':
      return `${action} needs a database index that has not finished building yet. Try again shortly.`;
    case 'unavailable':
      return `Cannot reach the database. Check your connection and try again.`;
    case 'not-found':
      return `That record no longer exists — someone may have removed it.`;
    default:
      return `Could not ${action}. ${(error as Error | null)?.message ?? 'Unknown error.'}`;
  }
}
