import { describe, expect, it } from 'vitest';
import {
  deriveRenewalStatus,
  renewalAlertAt,
  renewalView,
  snapshotSla,
  sortByUrgency,
  visitsDueInPeriod,
  type RenewalInput,
} from '../renewal.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const contract = (over: Partial<RenewalInput> = {}): RenewalInput => ({
  endDate: utc(2026, 3, 31),
  renewalWindowDays: 60,
  storedStatus: 'not_due',
  contractStatus: 'active',
  ...over,
});

describe('renewalAlertAt', () => {
  it('works back from the end date by the window', () => {
    expect(renewalAlertAt(utc(2026, 3, 31), 60)).toEqual(utc(2026, 1, 30));
  });

  it('is null without an end date', () => {
    expect(renewalAlertAt(null, 60)).toBeNull();
  });

  it('rejects a nonsensical window', () => {
    expect(() => renewalAlertAt(utc(2026, 3, 31), -5)).toThrow(/non-negative/);
    expect(() => renewalAlertAt(utc(2026, 3, 31), 30.5)).toThrow(/whole number/);
  });
});

describe('deriveRenewalStatus', () => {
  it('is not due outside the window', () => {
    expect(deriveRenewalStatus(contract(), utc(2025, 12, 1))).toBe('not_due');
  });

  it('becomes due once inside the window', () => {
    expect(deriveRenewalStatus(contract(), utc(2026, 2, 15))).toBe('due');
  });

  it('becomes due exactly on the alert date', () => {
    expect(deriveRenewalStatus(contract(), utc(2026, 1, 30))).toBe('due');
  });

  it('lapses once past the end date', () => {
    expect(deriveRenewalStatus(contract(), utc(2026, 4, 5))).toBe('lapsed');
  });

  it('never overwrites a status a person set', () => {
    // Sales knows something the calendar does not. A nightly job resetting
    // their work would make the field useless.
    expect(deriveRenewalStatus(contract({ storedStatus: 'in_negotiation' }), utc(2026, 4, 5)))
      .toBe('in_negotiation');
    expect(deriveRenewalStatus(contract({ storedStatus: 'renewed' }), utc(2026, 4, 5)))
      .toBe('renewed');
  });

  it('leaves a terminated or completed contract alone', () => {
    expect(deriveRenewalStatus(contract({ contractStatus: 'terminated' }), utc(2026, 4, 5)))
      .toBe('not_due');
    expect(deriveRenewalStatus(contract({ contractStatus: 'completed', storedStatus: 'not_due' }), utc(2026, 4, 5)))
      .toBe('not_due');
  });
});

describe('renewalView', () => {
  it('buckets by how close expiry is', () => {
    expect(renewalView(contract(), utc(2026, 3, 20)).bucket).toBe('within_30');
    expect(renewalView(contract(), utc(2026, 2, 20)).bucket).toBe('within_60');
    expect(renewalView(contract(), utc(2026, 1, 20)).bucket).toBe('within_90');
    expect(renewalView(contract(), utc(2025, 6, 1)).bucket).toBe('later');
    expect(renewalView(contract(), utc(2026, 5, 1)).bucket).toBe('lapsed');
  });

  it('counts days to expiry, negative once past', () => {
    expect(renewalView(contract(), utc(2026, 3, 1)).daysUntilExpiry).toBe(30);
    expect(renewalView(contract(), utc(2026, 4, 10)).daysUntilExpiry).toBe(-10);
  });

  it('escalates urgency as expiry approaches', () => {
    expect(renewalView(contract(), utc(2026, 3, 20)).urgency).toBe('high');
    expect(renewalView(contract(), utc(2026, 2, 20)).urgency).toBe('medium');
    expect(renewalView(contract(), utc(2026, 5, 1)).urgency).toBe('critical');
  });

  it('drops urgency once someone is on it', () => {
    // Already lapsed by the calendar, but under negotiation — not a fire drill.
    const handled = renewalView(contract({ storedStatus: 'in_negotiation' }), utc(2026, 5, 1));
    expect(handled.urgency).toBe('low');
    expect(handled.bucket).toBe('lapsed'); // the fact is still reported
  });

  it('reports whether the alert window is open', () => {
    expect(renewalView(contract(), utc(2025, 12, 1)).inWindow).toBe(false);
    expect(renewalView(contract(), utc(2026, 2, 1)).inWindow).toBe(true);
  });
});

describe('sortByUrgency', () => {
  it('leads with the most urgent, then soonest expiry', () => {
    const asOf = utc(2026, 1, 1);
    const rows = [
      { id: 'later', renewal: renewalView(contract({ endDate: utc(2027, 1, 1) }), asOf) },
      { id: 'lapsed', renewal: renewalView(contract({ endDate: utc(2025, 12, 1) }), asOf) },
      { id: 'soon', renewal: renewalView(contract({ endDate: utc(2026, 1, 20) }), asOf) },
      { id: 'handled', renewal: renewalView(contract({ endDate: utc(2025, 11, 1), storedStatus: 'renewed' }), asOf) },
    ];
    expect(sortByUrgency(rows).map((r) => r.id)).toEqual(['lapsed', 'soon', 'handled', 'later']);
  });
});

describe('snapshotSla', () => {
  it('converts contract hours to callout minutes', () => {
    expect(snapshotSla({ responseHours: 4, resolutionHours: 24, preventiveVisitsPerYear: 12 }))
      .toEqual({ slaResponseMinutes: 240, slaResolutionMinutes: 1440 });
  });

  it('handles a fractional SLA', () => {
    expect(snapshotSla({ responseHours: 1.5, resolutionHours: 8, preventiveVisitsPerYear: 4 }).slaResponseMinutes)
      .toBe(90);
  });

  it('returns nulls for a contract with no SLA, so nothing is judged against one', () => {
    expect(snapshotSla(null)).toEqual({ slaResponseMinutes: null, slaResolutionMinutes: null });
    expect(snapshotSla(undefined).slaResponseMinutes).toBeNull();
  });
});

describe('visitsDueInPeriod', () => {
  const contractStart = utc(2025, 7, 1);
  const contractEnd = utc(2026, 6, 30);

  it('gives the full year for a full-year period', () => {
    expect(visitsDueInPeriod(12, contractStart, contractEnd, contractStart, contractEnd)).toBe(12);
  });

  it('pro-rates a quarter', () => {
    expect(visitsDueInPeriod(12, utc(2025, 7, 1), utc(2025, 10, 1), contractStart, contractEnd)).toBe(3);
  });

  it('pro-rates a contract that started mid-period, so PM compliance stays fair', () => {
    // Contract starts halfway through the calendar year being measured.
    const dueForFullYear = visitsDueInPeriod(12, utc(2025, 1, 1), utc(2025, 12, 31), utc(2025, 1, 1), contractEnd);
    const dueForHalfYear = visitsDueInPeriod(12, utc(2025, 1, 1), utc(2025, 12, 31), utc(2025, 7, 1), contractEnd);
    expect(dueForFullYear).toBe(12);
    expect(dueForHalfYear).toBe(6);
  });

  it('is zero when the period falls outside the contract', () => {
    expect(visitsDueInPeriod(12, utc(2024, 1, 1), utc(2024, 6, 1), contractStart, contractEnd)).toBe(0);
    expect(visitsDueInPeriod(12, utc(2027, 1, 1), utc(2027, 6, 1), contractStart, contractEnd)).toBe(0);
  });
});
