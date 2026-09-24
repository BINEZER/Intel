/**
 * Preventive maintenance that is slipping.
 *
 * The case worth testing hardest is the lift nobody scheduled a visit for. PM
 * compliance is the share of PROMISED visits carried out, so that lift scores
 * nothing at all — it is not behind, it is invisible. This alert is the only
 * thing that can see it.
 */

import { describe, expect, it } from 'vitest';
import { visitAlerts, type AlertServicedUnit } from '../alerts.js';

const asOf = new Date(Date.UTC(2026, 8, 24));
const daysFromNow = (n: number) => new Date(asOf.getTime() + n * 86_400_000);

const unit = (over: Partial<AlertServicedUnit> = {}): AlertServicedUnit => ({
  id: 'u1',
  tag: 'LIFT-01',
  siteName: 'Bole Tower',
  nextScheduled: null,
  lastCompleted: null,
  ...over,
});

describe('a visit in the diary', () => {
  it('is overdue once the promised day has passed', () => {
    const [alert] = visitAlerts([unit({ nextScheduled: daysFromNow(-3) })], asOf);
    expect(alert?.kind).toBe('visit_overdue');
    expect(alert?.severity).toBe('high');
    expect(alert?.message).toContain('3 days ago');
    expect(alert?.href).toBe('/service');
  });

  it('is a quiet reminder inside the warning window', () => {
    const [alert] = visitAlerts([unit({ nextScheduled: daysFromNow(3) })], asOf);
    expect(alert?.kind).toBe('visit_due');
    expect(alert?.severity).toBe('low');
    expect(alert?.action).toContain('assigned');
  });

  it('says "today" rather than "in 0 days"', () => {
    const [alert] = visitAlerts([unit({ nextScheduled: asOf })], asOf);
    expect(alert?.message).toContain('promised today');
  });

  it('is silent when the visit is comfortably ahead', () => {
    expect(visitAlerts([unit({ nextScheduled: daysFromNow(30) })], asOf)).toEqual([]);
  });

  it('never ranks a missed service above an unlawful lift', () => {
    // A missed service is a promise broken. An expired certificate is illegal.
    // Flattening the two would make the top of the alert list meaningless.
    const [alert] = visitAlerts([unit({ nextScheduled: daysFromNow(-90) })], asOf);
    expect(alert?.severity).not.toBe('critical');
  });
});

describe('a lift with nothing in the diary', () => {
  it('is flagged when it has never had a visit scheduled', () => {
    const [alert] = visitAlerts([unit()], asOf);
    expect(alert?.kind).toBe('no_visit_scheduled');
    expect(alert?.message).toContain('counts towards nothing');
    expect(alert?.daysRemaining).toBeNull();
  });

  it('is left alone when it was serviced recently', () => {
    // Nagging the day after a visit is how somebody learns to ignore the list.
    expect(visitAlerts([unit({ lastCompleted: daysFromNow(-10) })], asOf)).toEqual([]);
  });

  it('is flagged once the gap since the last visit is long enough', () => {
    const [alert] = visitAlerts([unit({ lastCompleted: daysFromNow(-50) })], asOf);
    expect(alert?.kind).toBe('no_visit_scheduled');
    expect(alert?.message).toContain('50 days ago');
  });

  it('respects a threshold the caller sets', () => {
    const tight = { certificateWarningDays: 60, visitWarningDays: 7, noVisitAfterDays: 20 };
    expect(visitAlerts([unit({ lastCompleted: daysFromNow(-25) })], asOf, tight)).toHaveLength(1);
    expect(visitAlerts([unit({ lastCompleted: daysFromNow(-25) })], asOf)).toHaveLength(0);
  });

  it('does not also complain about a gap when a visit IS booked', () => {
    // One lift, one thing to do about it. Two alerts for the same lift is how a
    // list of forty becomes a list nobody reads.
    const alerts = visitAlerts(
      [unit({ nextScheduled: daysFromNow(2), lastCompleted: daysFromNow(-200) })],
      asOf,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('visit_due');
  });
});

describe('across the fleet', () => {
  it('gives every lift its own alert, identified by lift', () => {
    const alerts = visitAlerts(
      [
        unit({ id: 'u1', tag: 'LIFT-01' }),
        unit({ id: 'u2', tag: 'LIFT-02', nextScheduled: daysFromNow(-1) }),
      ],
      asOf,
    );
    expect(alerts.map((a) => a.id)).toEqual(['no-visit-u1', 'visit-overdue-u2']);
    expect(alerts.every((a) => a.subject.includes('Bole Tower'))).toBe(true);
  });

  it('says nothing about an empty fleet', () => {
    expect(visitAlerts([], asOf)).toEqual([]);
  });
});
