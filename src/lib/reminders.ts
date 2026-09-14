/**
 * Dates somebody wants warning about.
 *
 * The system already knows two dates by name: when a contract ends and when its
 * renewal window opens. Those are the two it happens to model. Real jobs carry
 * others — a warranty running out, a performance bond to release, a permit to
 * renew, an escalation clause that bites on a date — and none of them announce
 * themselves.
 *
 * THE LEAD TIME IS THE FEATURE. A warning on the day is not a warning: it is a
 * record of having been too late. Everything here is built around "how long
 * before" rather than "on".
 */

import { daysBetween } from './kpi.js';

export interface ReminderInput {
  id: string;
  label: string;
  dueDate: Date;
  leadDays: number;
  doneAt: Date | null;
  note?: string;
  /** Where it came from, so a list can group by contract or project. */
  sourceKind: 'contract' | 'project';
  sourceId: string;
  sourceLabel: string;
}

export type ReminderState = 'done' | 'sleeping' | 'due' | 'overdue';

export interface ReminderView extends ReminderInput {
  state: ReminderState;
  /** Negative once the date has passed. */
  daysRemaining: number;
  /** Days until it starts warning. Null once it has. */
  daysUntilAlert: number | null;
  /** One sentence a person can act on. */
  message: string;
}

export const MIN_LEAD_DAYS = 0;
export const MAX_LEAD_DAYS = 365;

/**
 * A lead time long enough to act on, per kind of date.
 *
 * A warranty needs an inspection booked and a crew freed, so it warns early. A
 * permit is usually a same-week errand. These are defaults the form offers, not
 * rules — every reminder carries its own.
 */
export const SUGGESTED_LEAD_DAYS: readonly { label: string; leadDays: number; why: string }[] = [
  { label: 'Warranty / defects liability ends', leadDays: 60, why: 'Long enough to inspect every unit and raise a claim before the cover goes.' },
  { label: 'Contract period ends', leadDays: 90, why: 'A renewal letter written three months out still reads as planning; one written three weeks out reads as panic.' },
  { label: 'Performance bond release', leadDays: 30, why: 'The bank needs notice and the client needs to sign.' },
  { label: 'Authority certificate expires', leadDays: 45, why: 'Inspection lead times are rarely shorter than the notice.' },
  { label: 'Permit / licence renewal', leadDays: 30, why: 'Enough for one round of queueing.' },
  { label: 'Price escalation date', leadDays: 45, why: 'Time to agree the new figure before it applies rather than after.' },
  { label: 'Retention release due', leadDays: 30, why: 'Retention nobody asks for is retention nobody returns.' },
];

export function validateReminder(input: {
  label: string;
  leadDays: number;
}): { ok: true } | { ok: false; error: string } {
  if (input.label.trim() === '') {
    return { ok: false, error: 'Say what the date is for. "Reminder" on a list of reminders tells nobody anything.' };
  }
  if (!Number.isInteger(input.leadDays) || input.leadDays < MIN_LEAD_DAYS || input.leadDays > MAX_LEAD_DAYS) {
    return { ok: false, error: `Warn between ${MIN_LEAD_DAYS} and ${MAX_LEAD_DAYS} days before the date.` };
  }
  return { ok: true };
}

/**
 * Where a reminder stands today.
 *
 * `sleeping` is a real state and not a synonym for "fine": the date is known,
 * it is simply too far off to act on. Showing sleeping reminders in an alert
 * list is how an alert list becomes a calendar nobody reads.
 */
export function viewReminder(reminder: ReminderInput, asOf: Date): ReminderView {
  const daysRemaining = daysBetween(asOf, reminder.dueDate);
  const daysUntilAlert = daysRemaining - reminder.leadDays;

  const state: ReminderState =
    reminder.doneAt !== null
      ? 'done'
      : daysRemaining < 0
        ? 'overdue'
        : daysUntilAlert > 0
          ? 'sleeping'
          : 'due';

  const message =
    state === 'done'
      ? `${reminder.label} — dealt with.`
      : state === 'overdue'
        ? `${reminder.label} passed ${Math.abs(daysRemaining)} days ago and was never closed off.`
        : state === 'due'
          ? `${reminder.label} in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}.`
          : `${reminder.label} in ${daysRemaining} days. Warning starts in ${daysUntilAlert}.`;

  return {
    ...reminder,
    state,
    daysRemaining,
    daysUntilAlert: state === 'sleeping' ? daysUntilAlert : null,
    message,
  };
}

/** Only the ones worth interrupting somebody about. */
export function activeReminders(reminders: readonly ReminderInput[], asOf: Date): ReminderView[] {
  return reminders
    .map((reminder) => viewReminder(reminder, asOf))
    .filter((view) => view.state === 'due' || view.state === 'overdue')
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/** Everything, newest deadline first, for the panel on a contract or project. */
export function sortReminders(reminders: readonly ReminderInput[], asOf: Date): ReminderView[] {
  const rank: Record<ReminderState, number> = { overdue: 0, due: 1, sleeping: 2, done: 3 };
  return reminders
    .map((reminder) => viewReminder(reminder, asOf))
    .sort((a, b) => rank[a.state] - rank[b.state] || a.daysRemaining - b.daysRemaining);
}

// ---------------------------------------------------------------------------
// Warranty
// ---------------------------------------------------------------------------

export interface WarrantyInput {
  months: number;
  startsOn: Date | null;
  endsOn: Date | null;
  alertDays: number;
}

export interface WarrantyView {
  /** Null when the project has not handed over, so the clock has not started. */
  endsOn: Date | null;
  daysRemaining: number | null;
  state: 'not_started' | 'active' | 'expiring' | 'expired';
  message: string;
}

/**
 * Where the warranty stands.
 *
 * `not_started` matters: a warranty whose start date is unset is not a warranty
 * that has expired, and reporting it as expired would send somebody to inspect
 * a lift that has not been handed over.
 */
export function viewWarranty(warranty: WarrantyInput | null | undefined, asOf: Date): WarrantyView {
  if (warranty == null || warranty.endsOn === null) {
    return {
      endsOn: null,
      daysRemaining: null,
      state: 'not_started',
      message:
        warranty == null
          ? 'No warranty period recorded on this contract.'
          : 'Warranty recorded but not started — it runs from handover, which has not happened.',
    };
  }

  const daysRemaining = daysBetween(asOf, warranty.endsOn);
  const state: WarrantyView['state'] =
    daysRemaining < 0 ? 'expired' : daysRemaining <= warranty.alertDays ? 'expiring' : 'active';

  return {
    endsOn: warranty.endsOn,
    daysRemaining,
    state,
    message:
      state === 'expired'
        ? `Warranty expired ${Math.abs(daysRemaining)} days ago. Anything found now is a chargeable repair, not a claim.`
        : state === 'expiring'
          ? `Warranty ends in ${daysRemaining} days. Inspect every unit while defects are still ours to fix for free.`
          : `Warranty runs another ${daysRemaining} days.`,
  };
}

/**
 * Work out when a warranty ends.
 *
 * Months are added on the calendar rather than as 30-day blocks, and a start
 * date later in the month than the target month has days is clamped to that
 * month's end — 31 August plus six months is 28 February, not 3 March.
 */
export function warrantyEnd(startsOn: Date, months: number): Date {
  const end = new Date(Date.UTC(startsOn.getUTCFullYear(), startsOn.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(startsOn.getUTCDate(), lastDay));
  return end;
}
