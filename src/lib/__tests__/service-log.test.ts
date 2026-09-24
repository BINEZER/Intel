/**
 * Recording service work.
 *
 * What these tests mostly pin is refusal. The timestamps a callout carries are
 * write-once and every KPI is derived from them by subtraction, so a value
 * accepted in the wrong order does not fail loudly — it quietly produces a
 * negative response time and averages it into the team's figures.
 */

import { describe, expect, it } from 'vitest';
import {
  calloutCanMove,
  calloutNextStages,
  describeMinutes,
  nextActionFor,
  stampedByMove,
  visitCanMove,
  whyCalloutCannotBeLogged,
  whyTimeCannotBeRecorded,
  type CalloutDraft,
} from '../service-log.js';

const draft = (over: Partial<CalloutDraft> = {}): CalloutDraft => ({
  unitTag: 'LIFT-01',
  siteName: 'Bole Tower',
  clientId: 'im-c-addis-towers',
  description: 'Stuck between 3 and 4',
  reportedAt: new Date(Date.now() - 60_000),
  ...over,
});

describe('logging a callout', () => {
  it('accepts a complete one', () => {
    expect(whyCalloutCannotBeLogged(draft())).toBeNull();
  });

  it('insists on the lift', () => {
    // Not politeness: repeat-callout detection groups by unit tag, so a callout
    // with no lift is invisible to the measure that says whether repairs hold.
    expect(whyCalloutCannotBeLogged(draft({ unitTag: '  ' }))).toContain('which lift');
  });

  it.each([
    ['clientId', { clientId: '' }, 'client'],
    ['description', { description: '   ' }, 'what was reported'],
    ['reportedAt', { reportedAt: null }, 'when the call came in'],
  ])('insists on the %s', (_label, over, expected) => {
    expect(whyCalloutCannotBeLogged(draft(over))).toContain(expected);
  });

  it('refuses a call reported in the future', () => {
    // It would give the callout a negative response time.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(whyCalloutCannotBeLogged(draft({ reportedAt: tomorrow }))).toContain('later than now');
  });

  it('tolerates a clock an hour fast', () => {
    const soon = new Date(Date.now() + 10 * 60 * 1000);
    expect(whyCalloutCannotBeLogged(draft({ reportedAt: soon }))).toBeNull();
  });
});

const reported = new Date(Date.UTC(2026, 2, 10, 8, 0));
const arrived = new Date(Date.UTC(2026, 2, 10, 9, 30));

describe('recording the times', () => {
  it('accepts an arrival after the call', () => {
    expect(whyTimeCannotBeRecorded('arrivedAt', arrived, { reportedAt: reported, arrivedAt: null })).toBeNull();
  });

  it('refuses an arrival before the call came in', () => {
    const early = new Date(Date.UTC(2026, 2, 10, 7, 0));
    expect(
      whyTimeCannotBeRecorded('arrivedAt', early, { reportedAt: reported, arrivedAt: null }),
    ).toContain('before the call came in');
  });

  it('refuses a resolution before anybody arrived', () => {
    expect(
      whyTimeCannotBeRecorded('resolvedAt', arrived, { reportedAt: reported, arrivedAt: null }),
    ).toContain('arrival on site first');
  });

  it('refuses a resolution before the arrival', () => {
    const before = new Date(Date.UTC(2026, 2, 10, 9, 0));
    expect(
      whyTimeCannotBeRecorded('resolvedAt', before, { reportedAt: reported, arrivedAt: arrived }),
    ).toContain('back in service before the technician arrived');
  });

  it('refuses a time in the future', () => {
    const later = new Date(Date.now() + 48 * 60 * 60 * 1000);
    expect(
      whyTimeCannotBeRecorded('arrivedAt', later, { reportedAt: reported, arrivedAt: null }),
    ).toContain('in the future');
  });
});

describe('how a callout may move', () => {
  it('lets a technician who is already on site skip being assigned', () => {
    // Forcing an "assigned" step would mean the arrival time recorded is the
    // time somebody got back to a computer.
    expect(calloutCanMove('open', 'on_site')).toBe(true);
  });

  it('never leaves resolved or cancelled', () => {
    // A repair that did not hold is a NEW callout — which is what the
    // repeat-callout rate exists to catch. Reopening the old one hides it.
    expect(calloutNextStages('resolved')).toEqual([]);
    expect(calloutNextStages('cancelled')).toEqual([]);
    expect(calloutCanMove('resolved', 'on_site')).toBe(false);
  });

  it('refuses to resolve a callout nobody has attended', () => {
    expect(calloutCanMove('open', 'resolved')).toBe(false);
    expect(calloutCanMove('assigned', 'resolved')).toBe(false);
  });

  it('stamps exactly one time per move', () => {
    expect(stampedByMove('assigned')).toBe('assignedAt');
    expect(stampedByMove('on_site')).toBe('arrivedAt');
    expect(stampedByMove('resolved')).toBe('resolvedAt');
    expect(stampedByMove('cancelled')).toBeNull();
  });

  it('says what to do next in a dispatcher’s words', () => {
    expect(nextActionFor('open', false)).toContain('Nobody assigned');
    expect(nextActionFor('open', true)).toContain('Waiting for the technician');
    expect(nextActionFor('on_site', true)).toContain('back in service');
  });
});

describe('how a visit may move', () => {
  it('does not let a missed visit be rescheduled into compliance', () => {
    // PM compliance is the share of promised visits actually carried out.
    expect(visitCanMove('missed', 'rescheduled')).toBe(false);
    expect(visitCanMove('missed', 'completed')).toBe(false);
  });

  it('allows the honest outcomes from scheduled', () => {
    for (const to of ['completed', 'missed', 'rescheduled', 'cancelled'] as const) {
      expect(visitCanMove('scheduled', to)).toBe(true);
    }
  });
});

describe('reading a duration', () => {
  it.each([
    [null, 'not recorded'],
    [45, '45 min'],
    [60, '1 h'],
    [95, '1 h 35 min'],
    [1440, '1 d'],
    [1500, '1 d 1 h'],
  ])('%s reads as %s', (minutes, expected) => {
    expect(describeMinutes(minutes as number | null)).toBe(expected);
  });
});
