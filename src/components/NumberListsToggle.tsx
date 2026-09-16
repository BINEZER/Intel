/**
 * The "1, 2, 3…" switch that sits in every list's control row.
 *
 * It is the same preference wherever you press it — see `lib/list-numbering.ts`
 * for why that is one decision rather than twenty.
 */

import { useSyncExternalStore } from 'react';
import {
  listsAreNumbered,
  listsNumberedServerSnapshot,
  subscribeListNumbering,
  toggleListsNumbered,
} from '../lib/list-numbering.js';

/** Every mounted list re-renders together the moment one of them flips it. */
export function useListsNumbered(): boolean {
  return useSyncExternalStore(
    subscribeListNumbering,
    listsAreNumbered,
    listsNumberedServerSnapshot,
  );
}

export function NumberListsToggle() {
  const on = useListsNumbered();

  return (
    <button
      type="button"
      className={`number-toggle ${on ? 'is-on' : ''}`}
      aria-pressed={on}
      onClick={() => toggleListsNumbered()}
      title={
        on
          ? 'Numbering off. Applies to every list in the app.'
          : 'Number the rows. Applies to every list in the app, and is remembered.'
      }
    >
      <span aria-hidden="true" className="number-toggle-mark">1.</span>
      Number{on ? 'ed' : ''}
    </button>
  );
}
