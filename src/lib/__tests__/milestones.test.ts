import { describe, expect, it } from 'vitest';
import {
  allocateByShares,
  allocateFromNet,
  allocateMilestones,
  assertSharesValid,
  DEFAULT_SUPPLY_INSTALL_SHARES,
  equalShares,
  milestoneTotals,
  validateShares,
  type MilestoneShare,
} from '../milestones.js';
import { addVat, birrToSantim, extractVat } from '../money.js';

const ETB = birrToSantim;

describe('allocateByShares never loses a santim', () => {
  it('splits an awkward three-way share exactly', () => {
    // The case that motivates the whole file: 33.33/33.33/33.34 of 1,000,000.
    const parts = allocateByShares(ETB(1_000_000), [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(ETB(1_000_000));
    expect(parts.every((p) => Number.isInteger(p))).toBe(true);
  });

  it('sums exactly across a spread of hostile totals and shares', () => {
    const totals = [1, 7, 99, ETB(0.01), ETB(1), ETB(999_999.99), ETB(4_830_000), ETB(7_777_777.77)];
    const shareSets = [
      [3333, 3333, 3334],
      [1, 1, 1],
      [5000, 2500, 1250, 1250],
      [9999, 1],
      Array.from({ length: 7 }, () => 1),
    ];
    for (const total of totals) {
      for (const shares of shareSets) {
        const parts = allocateByShares(total, shares);
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('gives the leftover santim to the largest fractions, not the last item', () => {
    // 10 santim over three equal shares: 3.33 each. Two get the extra santim,
    // and ties resolve to the earlier milestone for determinism.
    expect(allocateByShares(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });

  it('is deterministic across repeated calls', () => {
    const once = allocateByShares(ETB(1_234_567.89), [1234, 4321, 2222, 2223]);
    const twice = allocateByShares(ETB(1_234_567.89), [1234, 4321, 2222, 2223]);
    expect(once).toEqual(twice);
  });

  it('allocates a credit note the same way', () => {
    const parts = allocateByShares(-ETB(1_000_000), [3333, 3333, 3334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-ETB(1_000_000));
  });

  it('handles a single share and an empty set', () => {
    expect(allocateByShares(ETB(500), [10_000])).toEqual([ETB(500)]);
    expect(allocateByShares(ETB(500), [])).toEqual([]);
  });

  it('rejects float money', () => {
    expect(() => allocateByShares(1234.56, [10_000])).toThrow(/integer count of santim/);
  });
});

describe('share validation', () => {
  it('accepts the default supply-and-install schedule', () => {
    expect(() => assertSharesValid(DEFAULT_SUPPLY_INSTALL_SHARES)).not.toThrow();
    expect(DEFAULT_SUPPLY_INSTALL_SHARES.map((milestone) => milestone.shareBps)).toEqual([5000, 3000, 1000, 1000]);
  });

  it('rejects a schedule that does not cover the contract', () => {
    const short: MilestoneShare[] = [
      { name: 'Advance', shareBps: 3000 },
      { name: 'Balance', shareBps: 6500 },
    ];
    const result = validateShares(short);
    expect(result.ok).toBe(false);
    // 5% nobody would ever invoice.
    expect(result.ok === false && result.error).toContain('95.00%');
    expect(result.ok === false && result.totalBps).toBe(9500);
  });

  it('rejects an over-allocated schedule', () => {
    expect(validateShares([{ name: 'A', shareBps: 6000 }, { name: 'B', shareBps: 6000 }]).ok).toBe(false);
  });

  it('rejects a zero or negative share', () => {
    expect(validateShares([{ name: 'A', shareBps: 10_000 }, { name: 'B', shareBps: 0 }]).ok).toBe(false);
    expect(validateShares([{ name: 'A', shareBps: 11_000 }, { name: 'B', shareBps: -1000 }]).ok).toBe(false);
  });

  it('rejects an empty schedule', () => {
    const r = validateShares([]);
    expect(r.ok === false && r.error).toMatch(/at least one payment milestone/);
  });
});

describe('allocateMilestones reconciles to the contract', () => {
  it('keeps net, VAT and gross all summing exactly', () => {
    const contract = addVat(ETB(1_000_000));
    const milestones = allocateMilestones(contract, [
      { name: 'A', shareBps: 3333 },
      { name: 'B', shareBps: 3333 },
      { name: 'C', shareBps: 3334 },
    ]);

    const totals = milestoneTotals(milestones);
    expect(totals.netSantim).toBe(contract.netSantim);
    expect(totals.vatSantim).toBe(contract.vatSantim);
    expect(totals.grossSantim).toBe(contract.grossSantim);
    expect(totals.shareBps).toBe(10_000);
  });

  it('keeps each milestone internally consistent', () => {
    const milestones = allocateFromNet(ETB(4_200_000), DEFAULT_SUPPLY_INSTALL_SHARES);
    for (const m of milestones) {
      expect(m.grossSantim).toBe(m.netSantim + m.vatSantim);
    }
  });

  it('numbers milestones in order', () => {
    const milestones = allocateFromNet(ETB(1_000_000), DEFAULT_SUPPLY_INSTALL_SHARES);
    expect(milestones.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(milestones[0]!.name).toBe('Advance on signing');
  });

  it('reconciles for a VAT-inclusive contract value', () => {
    // Client negotiated "4,830,000 all in".
    const contract = extractVat(ETB(4_830_000));
    const milestones = allocateMilestones(contract, DEFAULT_SUPPLY_INSTALL_SHARES);
    const totals = milestoneTotals(milestones);
    expect(totals.netSantim).toBe(contract.netSantim);
    expect(totals.vatSantim).toBe(contract.vatSantim);
    expect(totals.grossSantim).toBe(ETB(4_830_000));
  });

  it('refuses to allocate against invalid shares', () => {
    expect(() => allocateFromNet(ETB(1_000_000), [{ name: 'A', shareBps: 5000 }])).toThrow(
      /must sum to 100%/,
    );
  });

  it('carries the gating phase through', () => {
    const milestones = allocateFromNet(ETB(1_000_000), [
      { name: 'On rails', shareBps: 5000, phaseId: 'phase-rails' },
      { name: 'On handover', shareBps: 5000, phaseId: 'phase-handover' },
    ]);
    expect(milestones[0]!.phaseId).toBe('phase-rails');
  });
});

describe('equalShares', () => {
  it('produces shares that sum to exactly 100%', () => {
    for (const count of [1, 2, 3, 4, 6, 7, 12]) {
      const shares = equalShares(count);
      expect(shares).toHaveLength(count);
      expect(shares.reduce((a, s) => a + s.shareBps, 0)).toBe(10_000);
    }
  });

  it('names periods by default and accepts overrides', () => {
    expect(equalShares(2)[0]!.name).toBe('Payment 1');
    expect(equalShares(2, ['Q1', 'Q2'])[1]!.name).toBe('Q2');
  });

  it('rejects a nonsensical count', () => {
    expect(() => equalShares(0)).toThrow(/positive integer/);
  });
});

import { termScheduleRights } from '../milestones.js';

describe('termScheduleRights', () => {
  it('lets an unbilled term take both a date and a stage', () => {
    for (const status of ['pending', 'ready_to_invoice']) {
      expect(termScheduleRights(status)).toEqual({ date: true, stage: true, reason: null });
    }
  });
  it('lets a billed term be re-dated but not re-tied to a stage', () => {
    for (const status of ['invoiced', 'part_paid']) {
      expect(termScheduleRights(status)).toMatchObject({ date: true, stage: false });
    }
  });
  it('leaves a settled term alone, and says why', () => {
    expect(termScheduleRights('paid')).toEqual({ date: false, stage: false, reason: 'This term has been paid.' });
    expect(termScheduleRights('waived').reason).toBe('This term was waived.');
  });
});
