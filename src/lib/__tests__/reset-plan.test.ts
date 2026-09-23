import { describe, expect, it } from 'vitest';
import {
  RESET_TARGETS,
  describeReset,
  keptOutcomes,
  summariseReset,
  type ResetOutcome,
} from '../reset-plan.js';

const outcome = (over: Partial<ResetOutcome> = {}): ResetOutcome => ({
  path: 'clients',
  label: 'Clients',
  found: 10,
  deleted: 10,
  kept: 0,
  reason: null,
  ...over,
});

describe('what a reset covers', () => {
  it('never touches the settings', () => {
    // The VAT rate and the withholding rates are configuration, not input.
    // Starting from scratch should not mean setting the tax up again.
    expect(RESET_TARGETS.map((t) => t.path)).not.toContain('config');
  });

  it('never touches the user accounts', () => {
    // Deleting them would lock everybody out of the app they just reset.
    expect(RESET_TARGETS.map((t) => t.path)).not.toContain('users');
  });

  it('never touches the audit log', () => {
    // A wipe is exactly the event you would later want it to have recorded.
    expect(RESET_TARGETS.map((t) => t.path)).not.toContain('auditLogs');
  });

  it('clears children before their parents', () => {
    // A contract deleted first strands its milestones in a subcollection
    // nothing points at, still stored and still in a collection-group query.
    const order = RESET_TARGETS.map((t) => t.path);
    expect(order.indexOf('units')).toBeLessThan(order.indexOf('projects'));
    expect(order.indexOf('projects')).toBeLessThan(order.indexOf('contracts'));
    expect(order.indexOf('contracts')).toBeLessThan(order.indexOf('clients'));
    expect(order.indexOf('invoices')).toBeLessThan(order.indexOf('clients'));
    expect(order.indexOf('tasks')).toBeLessThan(order.indexOf('boards'));
  });

  it('names a reason for every collection the rules will fight it on', () => {
    for (const target of RESET_TARGETS.filter((t) => t.guard !== undefined)) {
      expect(target.guard?.length ?? 0).toBeGreaterThan(20);
    }
    // The ones that are actually guarded are named, so the report can explain.
    const guarded = RESET_TARGETS.filter((t) => t.guard !== undefined).map((t) => t.path);
    expect(guarded).toContain('technicians');
    expect(guarded).toContain('invoices');
    expect(guarded).toContain('disbursements');
  });

  it('clears the subcollections that hang off a parent', () => {
    const byPath = new Map(RESET_TARGETS.map((t) => [t.path, t]));
    expect(byPath.get('contracts')?.subcollections).toContain('milestones');
    expect(byPath.get('projects')?.subcollections).toContain('phases');
    expect(byPath.get('invoices')?.subcollections).toContain('receipts');
  });
});

describe('summarising what happened', () => {
  it('adds up what went and what stayed', () => {
    const report = summariseReset([outcome({ deleted: 10 }), outcome({ path: 'x', deleted: 3, kept: 2 })]);
    expect(report.deleted).toBe(13);
    expect(report.kept).toBe(2);
  });

  it('says nothing is left when nothing is', () => {
    expect(describeReset(summariseReset([outcome()]))).toContain('Nothing is left');
  });

  it('says what stayed rather than claiming a clean sweep', () => {
    // "Reset complete" over a database still holding nine technicians is the
    // kind of half-truth that costs an afternoon later.
    const report = summariseReset([outcome({ deleted: 5, kept: 9, reason: 'Technicians are never deleted.' })]);
    const said = describeReset(report);
    expect(said).toContain('9 could not be removed');
    expect(said).not.toContain('Nothing is left');
  });

  it('says so plainly when there was nothing to delete', () => {
    expect(describeReset(summariseReset([]))).toBe('There was nothing to delete.');
  });

  it('lists only the collections that kept something', () => {
    const report = summariseReset([
      outcome({ path: 'clients', kept: 0 }),
      outcome({ path: 'technicians', label: 'Technicians', kept: 9, reason: 'never deleted' }),
    ]);
    expect(keptOutcomes(report).map((o) => o.path)).toEqual(['technicians']);
  });
});
