/**
 * Numbered lists: one preference, every list in the app.
 *
 * WHY IT IS GLOBAL AND NOT PER TABLE
 *   "Number all lists" is one decision, not twenty. A per-table checkbox means
 *   flipping the same switch on Clients, Contracts, Lifts, Invoices, Payouts,
 *   People, Projects and Programs, and then finding one you missed when you
 *   read a figure off the wrong row. Turning it on anywhere turns it on
 *   everywhere, and it survives a reload.
 *
 * WHAT THE NUMBER COUNTS
 *   Position in the list AS SHOWN — after the search box and the dropdowns and
 *   whatever the list is sorted by. Filter 163 contracts down to five and they
 *   are 1 to 5, not 7, 23, 88, 104, 161.
 *
 *   That is the only reading that survives being read aloud. "The third one"
 *   means the third one you can see; a number that refers to a position in a
 *   list nobody is looking at is worse than no number, because it looks
 *   authoritative.
 *
 * WHY A STORE AND NOT REACT CONTEXT
 *   Every list would have to sit under a provider, and lists are rendered in a
 *   dozen places including a print view. A module-level value with subscribers
 *   is smaller, and `useSyncExternalStore` makes every mounted list re-render
 *   together the moment one of them flips it.
 */

const KEY = 'intelmotion.lists.numbered';

/**
 * Also mirrored onto the document element, so card lists can be numbered by a
 * CSS counter instead of every page threading the flag into its own markup.
 */
const ROOT_ATTRIBUTE = 'data-numbered-lists';

let numbered = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'true';
  } catch {
    // Private browsing and blocked site data both throw. A preference that
    // cannot be stored is not a reason to fail to render a list.
    return false;
  }
}

function reflectOnRoot(value: boolean): void {
  if (typeof document === 'undefined') return;
  if (value) document.documentElement.setAttribute(ROOT_ATTRIBUTE, 'on');
  else document.documentElement.removeAttribute(ROOT_ATTRIBUTE);
}

reflectOnRoot(numbered);

export function listsAreNumbered(): boolean {
  return numbered;
}

export function setListsNumbered(value: boolean): void {
  if (value === numbered) return;
  numbered = value;
  try {
    window.localStorage.setItem(KEY, String(value));
  } catch { /* see read() */ }
  reflectOnRoot(value);
  for (const listener of listeners) listener();
}

export function toggleListsNumbered(): void {
  setListsNumbered(!numbered);
}

export function subscribeListNumbering(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Server-render and test fallback: off until the browser says otherwise. */
export function listsNumberedServerSnapshot(): boolean {
  return false;
}

/** Reset, for tests. Not used by the app. */
export function resetListNumbering(): void {
  numbered = false;
  listeners.clear();
  reflectOnRoot(false);
}

/**
 * The label a row wears.
 *
 * Right-aligned by the widest number the list can reach, so a column of 1 to
 * 163 does not jitter as you scroll: the ones line up under the hundreds.
 */
export function rowNumberWidth(total: number): number {
  return String(Math.max(total, 1)).length;
}
