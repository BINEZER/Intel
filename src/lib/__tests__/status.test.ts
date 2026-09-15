import { describe, expect, it } from 'vitest';
import {
  CLIENT_STATUSES,
  CONTRACT_STATUSES,
  PROJECT_STATUSES,
  isClosedContract,
  isClosedProject,
  statusChipClass,
  statusHint,
  statusLabel,
  statusOptions,
} from '../status.js';

describe('the status vocabulary', () => {
  it('gives every option a label and a distinguishing hint', () => {
    // A dropdown of bare words invites the wrong pick — "cancelled" and
    // "terminated" are not the same thing and the difference costs money.
    for (const list of [CLIENT_STATUSES, CONTRACT_STATUSES, PROJECT_STATUSES]) {
      for (const option of list) {
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.hint.length).toBeGreaterThan(10);
      }
    }
  });

  it('has no duplicate values within a kind', () => {
    for (const kind of ['client', 'contract', 'project'] as const) {
      const values = statusOptions(kind).map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it('offers the statuses the business actually uses', () => {
    expect(PROJECT_STATUSES.map((o) => o.value)).toContain('terminated');
    expect(PROJECT_STATUSES.map((o) => o.value)).toContain('on_hold');
    expect(CLIENT_STATUSES.map((o) => o.value)).toContain('prospect');
    expect(CLIENT_STATUSES.map((o) => o.value)).toContain('on_hold');
    expect(CONTRACT_STATUSES.map((o) => o.value)).toContain('terminated');
  });

  it('labels a paused project as paused, since that is what people call it', () => {
    expect(statusLabel('project', 'on_hold')).toBe('Paused');
  });
});

describe('reading a stored value', () => {
  it('never renders blank for a value it does not know', () => {
    // Older records and imports carry statuses nobody has mapped. A blank cell
    // reads as missing data; the raw value at least says what to go and fix.
    expect(statusLabel('project', 'mothballed')).toBe('mothballed');
    expect(statusLabel('project', 'some_old_value')).toBe('some old value');
    expect(statusHint('project', 'mothballed')).toBeNull();
    expect(statusChipClass('project', 'mothballed')).toBe('chip chip-status-idle');
  });

  it('gives each tone its own chip class', () => {
    expect(statusChipClass('project', 'in_progress')).toBe('chip chip-status-good');
    expect(statusChipClass('project', 'on_hold')).toBe('chip chip-status-warn');
    expect(statusChipClass('project', 'terminated')).toBe('chip chip-status-bad');
  });
});

describe('which statuses mean the job is over', () => {
  it('counts terminated alongside completed and cancelled', () => {
    // Added as a list rather than asked as a question, `terminated` would go on
    // raising overdue alerts on a job that stopped a year ago.
    expect(isClosedProject('terminated')).toBe(true);
    expect(isClosedProject('completed')).toBe(true);
    expect(isClosedProject('cancelled')).toBe(true);
  });

  it('leaves a paused project open, because it is expected to resume', () => {
    expect(isClosedProject('on_hold')).toBe(false);
    expect(isClosedProject('in_progress')).toBe(false);
    expect(isClosedProject('planned')).toBe(false);
  });

  it('treats an expired contract as closed but a suspended one as live', () => {
    expect(isClosedContract('expired')).toBe(true);
    expect(isClosedContract('terminated')).toBe(true);
    expect(isClosedContract('suspended')).toBe(false);
    expect(isClosedContract('active')).toBe(false);
  });
});
