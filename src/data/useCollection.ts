/**
 * React bindings for the repository layer.
 *
 * Every subscription is torn down on unmount or when its inputs change.
 * A Firestore listener that outlives its component keeps billing reads and
 * writing into unmounted state, which React reports as an update-on-unmounted
 * warning long after the real leak started.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Unsubscribe } from 'firebase/firestore';
import { describeFirestoreError, type WithId } from './repository.js';

export interface CollectionState<T> {
  rows: WithId<T>[];
  loading: boolean;
  error: string | null;
}

/**
 * Subscribe to a live query.
 *
 * `subscribeFn` is held in a ref so an inline arrow does not resubscribe on
 * every render; `deps` is what actually decides when to resubscribe.
 */
export function useCollection<T>(
  subscribeFn: (onData: (rows: WithId<T>[]) => void, onError: (e: Error) => void) => Unsubscribe,
  deps: readonly unknown[],
  action = 'load these records',
): CollectionState<T> {
  const [rows, setRows] = useState<WithId<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fnRef = useRef(subscribeFn);
  fnRef.current = subscribeFn;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const unsubscribe = fnRef.current(
      (next) => {
        setRows(next);
        setLoading(false);
      },
      (err) => {
        setError(describeFirestoreError(err, action));
        setLoading(false);
      },
    );
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return useMemo(() => ({ rows, loading, error }), [rows, loading, error]);
}

/** Wrap a write so the UI always has a message and a busy flag. */
export function useAsyncAction(action: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      // A thrown validation Error carries a message worth showing verbatim;
      // a Firestore error code does not.
      setError(
        err instanceof Error && !('code' in err)
          ? err.message
          : describeFirestoreError(err, action),
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { busy, error, run, clearError: () => setError(null) };
}
