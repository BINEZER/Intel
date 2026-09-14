/**
 * A lift's service history.
 *
 * The distinctions under test are the ones a service manager would argue about:
 * a unit with nothing recorded is not a healthy unit, a cancelled visit was
 * never owed, and a safety finding is never buried inside the visit that raised it.
 */

import { describe, expect, it } from 'vitest';
import {
  assessUnitHealth,
  buildTimeline,
  matchesUnit,
  sortByHealth,
  type HistoryCallout,
  type HistoryVisit,
} from '../service-history.js';

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const NOW = utc(2026, 9, 14);

function callout(over: Partial<HistoryCallout> = {}): HistoryCallout {
  return {
    id: 'c1',
    calloutNo: 'CO-00001',
    unitTag: 'LIFT-01',
    contractId: 'mc1',
    siteName: 'Sheger Mall',
    category: 'breakdown',
    entrapment: false,
    description: 'Door not closing on ground floor.',
    technicianName: 'Dawit',
    reportedAt: utc(2026, 8, 10),
    resolvedAt: utc(2026, 8, 10),
    responseMinutes: 55,
    repairMinutes: 90,
    breachedResponse: false,
    resolution: 'fixed',
    firstTimeFix: true,
    repeatOfCalloutId: null,
    status: 'resolved',
    partsUsed: [],
    ...over,
  };
}

function visit(over: Partial<HistoryVisit> = {}): HistoryVisit {
  return {
    id: 'v1',
    unitTag: 'LIFT-01',
    contractId: 'mc1',
    siteName: 'Sheger Mall',
    technicianName: 'Meron',
    scheduledDate: utc(2026, 8, 1),
    completedDate: utc(2026, 8, 1),
    status: 'completed',
    checklistCompleteBps: 10_000,
    findings: [],
    ...over,
  };
}

describe('matchesUnit', () => {
  const key = { unitTag: 'LIFT-01', contractId: 'mc1', siteName: 'Sheger Mall' };

  it('matches on contract and tag', () => {
    expect(matchesUnit(key, { unitTag: 'LIFT-01', contractId: 'mc1', siteName: 'Somewhere else' })).toBe(true);
  });

  it('falls back to site and tag, so history from before the current contract still counts', () => {
    expect(matchesUnit(key, { unitTag: 'LIFT-01', contractId: 'old-contract', siteName: 'Sheger Mall' })).toBe(true);
  });

  it('never matches the same tag at a different site under a different contract', () => {
    // "LIFT-01" exists in every building; it is not an identity on its own.
    expect(matchesUnit(key, { unitTag: 'LIFT-01', contractId: 'mc9', siteName: 'Bole Tower' })).toBe(false);
  });

  it('never matches a different tag', () => {
    expect(matchesUnit(key, { unitTag: 'LIFT-02', contractId: 'mc1', siteName: 'Sheger Mall' })).toBe(false);
  });
});

describe('buildTimeline', () => {
  it('promotes each finding to an entry of its own', () => {
    const entries = buildTimeline(
      [],
      [visit({ findings: [
        { note: 'Governor rope showing wear.', severity: 'safety' },
        { note: 'Cab light flickering.', severity: 'info' },
      ] })],
    );

    // The visit plus both findings, not one lumped entry.
    expect(entries).toHaveLength(3);
    expect(entries.filter((e) => e.kind === 'finding')).toHaveLength(2);
    expect(entries.find((e) => e.severity === 'safety')?.detail).toBe('Governor rope showing wear.');
  });

  it('leaves a safety finding open, because nothing in the record closes one', () => {
    const entries = buildTimeline([], [visit({ findings: [{ note: 'Brake pad worn.', severity: 'safety' }] })]);
    const finding = entries.find((e) => e.kind === 'finding');
    expect(finding?.open).toBe(true);
  });

  it('orders newest first across both kinds of record', () => {
    const entries = buildTimeline(
      [callout({ id: 'old', reportedAt: utc(2026, 1, 5) }), callout({ id: 'new', reportedAt: utc(2026, 9, 1) })],
      [visit({ id: 'mid', completedDate: utc(2026, 5, 5), scheduledDate: utc(2026, 5, 5) })],
    );
    expect(entries.map((e) => e.id)).toEqual(['new', 'mid', 'old']);
  });

  it('dates an uncompleted visit by when it was due', () => {
    const entries = buildTimeline([], [visit({ status: 'missed', completedDate: null, scheduledDate: utc(2026, 7, 7) })]);
    expect(entries[0]?.at.toISOString().slice(0, 10)).toBe('2026-07-07');
  });

  it('marks an unresolved callout open', () => {
    const entries = buildTimeline([callout({ status: 'on_site', resolvedAt: null })], []);
    expect(entries[0]?.open).toBe(true);
  });
});

describe('assessUnitHealth', () => {
  it('says unknown, not healthy, when nothing has ever been recorded', () => {
    const health = assessUnitHealth([], [], NOW);
    expect(health.verdict).toBe('unknown');
    expect(health.reasons[0]).toContain('not the same as no problems');
  });

  it('is healthy with one clean callout and a recent visit', () => {
    const health = assessUnitHealth([callout()], [visit()], NOW);
    expect(health.verdict).toBe('healthy');
  });

  it('calls a unit a problem once callouts pass the yearly threshold', () => {
    const many = Array.from({ length: 6 }, (_, i) => callout({ id: `c${i}`, reportedAt: utc(2026, 3 + (i % 6), 5) }));
    const health = assessUnitHealth(many, [visit()], NOW);
    expect(health.verdict).toBe('problem');
    expect(health.reasons.join(' ')).toContain('6 callouts');
  });

  it('ignores callouts older than twelve months in that count', () => {
    const old = Array.from({ length: 6 }, (_, i) => callout({ id: `c${i}`, reportedAt: utc(2023, 1 + i, 5) }));
    expect(assessUnitHealth(old, [visit()], NOW).calloutsLast12Months).toBe(0);
  });

  it('treats a high repeat rate as the fault not being fixed', () => {
    const repeats = [
      callout({ id: 'a' }),
      callout({ id: 'b', repeatOfCalloutId: 'a' }),
      callout({ id: 'c', repeatOfCalloutId: 'a' }),
    ];
    const health = assessUnitHealth(repeats, [visit()], NOW);
    expect(health.verdict).toBe('problem');
    expect(health.reasons.join(' ')).toContain('not being fixed');
  });

  it('makes an unsigned safety finding a problem on its own', () => {
    const health = assessUnitHealth([], [visit({ findings: [{ note: 'Overspeed governor seized.', severity: 'safety' }] })], NOW);
    expect(health.verdict).toBe('problem');
    expect(health.openSafetyFindings).toBe(1);
  });

  it('does not count a cancelled or rescheduled visit against PM compliance', () => {
    const health = assessUnitHealth([], [
      visit({ id: 'v1' }),
      visit({ id: 'v2', status: 'missed', completedDate: null }),
      visit({ id: 'v3', status: 'cancelled', completedDate: null }),
      visit({ id: 'v4', status: 'rescheduled', completedDate: null }),
    ], NOW);

    // One completed of two actually owed.
    expect(health.pmComplianceBps).toBe(5000);
  });

  it('reports no compliance figure at all when nothing was owed', () => {
    expect(assessUnitHealth([callout()], [], NOW).pmComplianceBps).toBeNull();
  });

  it('flags a unit nobody has visited in months', () => {
    const health = assessUnitHealth([callout({ reportedAt: utc(2026, 9, 1) })], [visit({ completedDate: utc(2026, 1, 5), scheduledDate: utc(2026, 1, 5) })], NOW);
    expect(health.verdict).toBe('watch');
    expect(health.reasons.join(' ')).toContain('No preventive visit for');
  });

  it('excludes cancelled callouts from every count', () => {
    const health = assessUnitHealth([callout({ status: 'cancelled' })], [visit()], NOW);
    expect(health.callouts).toBe(0);
  });

  it('totals the parts spent on the machine', () => {
    const health = assessUnitHealth(
      [callout({ partsUsed: [{ description: 'Door operator belt', qty: 1, costNetSantim: 240_000 }] })],
      [visit()],
      NOW,
    );
    expect(health.partsCostSantim).toBe(240_000);
  });

  it('averages response and repair only over calls that have the figure', () => {
    const health = assessUnitHealth(
      [callout({ id: 'a', responseMinutes: 30, repairMinutes: 60 }), callout({ id: 'b', responseMinutes: null, repairMinutes: null })],
      [visit()],
      NOW,
    );
    expect(health.avgResponseMinutes).toBe(30);
    expect(health.avgRepairMinutes).toBe(60);
  });
});

describe('sortByHealth', () => {
  it('puts problems first and unrecorded units above healthy ones', () => {
    const rows = [
      { tag: 'healthy', health: assessUnitHealth([callout()], [visit()], NOW) },
      { tag: 'unknown', health: assessUnitHealth([], [], NOW) },
      { tag: 'problem', health: assessUnitHealth([], [visit({ findings: [{ note: 'x', severity: 'safety' }] })], NOW) },
    ];
    expect(sortByHealth(rows).map((r) => r.tag)).toEqual(['problem', 'unknown', 'healthy']);
  });
});
