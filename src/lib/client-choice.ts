/**
 * Choosing a client on a form that is editing a record which already has one.
 *
 * THE FAILURE THIS EXISTS FOR
 *   The contract and project pages offer only ACTIVE clients, which is right for
 *   a new contract. But an existing contract can belong to a client who has since
 *   been put on hold, gone inactive, or been deleted — and a form that is handed
 *   a list without that client has a dropdown with nothing selected. The browser
 *   then refuses to submit it (a required field with no value), usually with a
 *   pop-up that is easy to miss, and the person is left pressing "Save" on
 *   something that does nothing at all.
 *
 *   A record's own client is always a valid choice for that record. It is kept in
 *   the list, labelled so nobody mistakes it for an active one, and used as the
 *   answer if the person does not change it.
 */

export interface ClientRef {
  id: string;
  name: string;
}

export interface ClientChoice extends ClientRef {
  /** Why this entry is not an ordinary active client, if it is not. */
  note: string | null;
}

/**
 * The options for a client dropdown: the list given, plus the record's own
 * client where the list does not contain it.
 */
export function clientChoices(
  clients: readonly ClientRef[],
  current: ClientRef | null,
): ClientChoice[] {
  const options: ClientChoice[] = clients.map((c) => ({ id: c.id, name: c.name, note: null }));
  if (current !== null && current.id !== '' && !clients.some((c) => c.id === current.id)) {
    options.unshift({ id: current.id, name: current.name, note: 'not an active client' });
  }
  return options;
}

/** The text of one option. */
export function clientOptionLabel(choice: ClientChoice): string {
  return choice.note === null ? choice.name : `${choice.name} (${choice.note})`;
}

/**
 * The client to write onto the record, or null when none has been chosen.
 *
 * Looks in the list first, so a rename is picked up; falls back to the record's
 * own client when that is what is selected. Null means the person has not chosen
 * one, which the form must say aloud rather than ignore.
 */
export function resolveClient(
  clients: readonly ClientRef[],
  clientId: string,
  current: ClientRef | null,
): ClientRef | null {
  if (clientId === '') return null;
  const listed = clients.find((c) => c.id === clientId);
  if (listed !== undefined) return { id: listed.id, name: listed.name };
  if (current !== null && current.id === clientId) return { id: current.id, name: current.name };
  return null;
}
