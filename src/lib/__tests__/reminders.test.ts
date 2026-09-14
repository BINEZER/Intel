/**
 * Reminders and warranty.
 *
 * The lead time is the feature, so most of this is about the difference between
 * a date that is known and a date that is due. A list that shows every future
 * date is a calendar, and nobody reads a calendar for alerts.
 */

import { describe, expect, it } from 'vitest';
import {
  activeReminders,
  sortReminders,
  validateReminder,
  viewReminder,
  viewWarranty,
  warrantyEnd,
  type ReminderInput,
} from '../reminders.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function reminder(over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    id: 'r1',
    label: 'Warranty ends',
    dueDate: utc(2026, 12, 1),
    leadDays: 60,
    doneAt: null,
    sourceKind: 'contract',
    sourceId: 'c1',
    sourceLabel: 'SC-2026-004 · Sheger Mall',
    ...over,
  };
}

describe('viewReminder', () => {
  it('sleeps while the date is further off than the lead time', () => {
    // 78 days out, warns at 60.
    const view = viewReminder(reminder(), NOW);
    expect(view.state).toBe('sleeping');
    expect(view.daysUntilAlert).toBe(18);
    expect(view.message).toContain('Warning starts in 18');
  });

  it('wakes up once inside the lead time', () => {
    const view = viewReminder(reminder({ dueDate: utc(2026, 10, 20) }), NOW);
    expect(view.state).toBe('due');
    expect(view.daysUntilAlert).toBeNull();
    expect(view.message).toBe('Warranty ends in 36 days.');
  });

  it('goes overdue once the date passes, and says it was never closed off', () => {
    const view = viewReminder(reminder({ dueDate: utc(2026, 8, 1) }), NOW);
    expect(view.state).toBe('overdue');
    expect(view.daysRemaining).toBe(-44);
    expect(view.message).toContain('never closed off');
  });

  it('stops entirely once somebody has dealt with it', () => {
    const view = viewReminder(reminder({ dueDate: utc(2026, 1, 1), doneAt: utc(2026, 1, 2) }), NOW);
    expect(view.state).toBe('done');
  });

  it('with no lead time, fires on the day and not before', () => {
    expect(viewReminder(reminder({ leadDays: 0, dueDate: utc(2026, 9, 15) }), NOW).state).toBe('sleeping');
    expect(viewReminder(reminder({ leadDays: 0, dueDate: utc(2026, 9, 14) }), NOW).state).toBe('due');
  });

  it('uses the singular for one day', () => {
    expect(viewReminder(reminder({ dueDate: utc(2026, 9, 15) }), NOW).message).toBe('Warranty ends in 1 day.');
  });
});

describe('activeReminders', () => {
  it('shows only what is worth interrupting somebody about', () => {
    const active = activeReminders(
      [
        reminder({ id: 'sleeping' }),
        reminder({ id: 'due', dueDate: utc(2026, 10, 1) }),
        reminder({ id: 'overdue', dueDate: utc(2026, 7, 1) }),
        reminder({ id: 'done', dueDate: utc(2026, 7, 1), doneAt: utc(2026, 7, 2) }),
      ],
      NOW,
    );

    expect(active.map((r) => r.id)).toEqual(['overdue', 'due']);
  });

  it('is empty rather than noisy when nothing is close', () => {
    expect(activeReminders([reminder()], NOW)).toEqual([]);
  });
});

describe('sortReminders', () => {
  it('puts overdue first, then due, then sleeping, then done', () => {
    const sorted = sortReminders(
      [
        reminder({ id: 'done', doneAt: utc(2026, 1, 1) }),
        reminder({ id: 'sleeping' }),
        reminder({ id: 'overdue', dueDate: utc(2026, 7, 1) }),
        reminder({ id: 'due', dueDate: utc(2026, 10, 1) }),
      ],
      NOW,
    );
    expect(sorted.map((r) => r.id)).toEqual(['overdue', 'due', 'sleeping', 'done']);
  });
});

describe('validateReminder', () => {
  it('refuses a reminder with nothing written on it', () => {
    const result = validateReminder({ label: '   ', leadDays: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('tells nobody anything');
  });

  it('refuses a lead time that is not a sane number of days', () => {
    expect(validateReminder({ label: 'x', leadDays: -1 }).ok).toBe(false);
    expect(validateReminder({ label: 'x', leadDays: 400 }).ok).toBe(false);
    expect(validateReminder({ label: 'x', leadDays: 2.5 }).ok).toBe(false);
    expect(validateReminder({ label: 'x', leadDays: 0 }).ok).toBe(true);
  });
});

describe('warrantyEnd', () => {
  it('adds calendar months, not 30-day blocks', () => {
    expect(warrantyEnd(utc(2026, 1, 15), 12).toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(warrantyEnd(utc(2026, 3, 10), 6).toISOString().slice(0, 10)).toBe('2026-09-10');
  });

  it('clamps to the end of a shorter month rather than rolling over', () => {
    // 31 August plus six months is 28 February, not 3 March.
    expect(warrantyEnd(utc(2026, 8, 31), 6).toISOString().slice(0, 10)).toBe('2027-02-28');
    // And 29 February in the leap year it lands in.
    expect(warrantyEnd(utc(2027, 8, 31), 6).toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});

describe('viewWarranty', () => {
  const base = { months: 12, startsOn: utc(2026, 1, 1), alertDays: 60 };

  it('says not started rather than expired when the clock never began', () => {
    const view = viewWarranty({ ...base, startsOn: null, endsOn: null }, NOW);
    expect(view.state).toBe('not_started');
    expect(view.message).toContain('runs from handover');
  });

  it('says so plainly when there is no warranty at all', () => {
    expect(viewWarranty(null, NOW).message).toContain('No warranty period recorded');
    expect(viewWarranty(undefined, NOW).state).toBe('not_started');
  });

  it('is active while there is plenty of time', () => {
    expect(viewWarranty({ ...base, endsOn: utc(2027, 6, 1) }, NOW).state).toBe('active');
  });

  it('warns inside the alert window, and says why it matters now', () => {
    const view = viewWarranty({ ...base, endsOn: utc(2026, 10, 20) }, NOW);
    expect(view.state).toBe('expiring');
    expect(view.message).toContain('while defects are still ours to fix for free');
  });

  it('is blunt once it has gone', () => {
    const view = viewWarranty({ ...base, endsOn: utc(2026, 6, 1) }, NOW);
    expect(view.state).toBe('expired');
    expect(view.message).toContain('chargeable repair, not a claim');
  });
});
