import { describe, expect, it } from 'vitest';
import {
  countWithDirectSupply,
  describeDirectSupply,
  directSupplyOf,
  formatUSD,
  totalDirectUsdCents,
  usdCentsFrom,
  usdCentsToInput,
  type DirectSupply,
} from '../direct-supply.js';

const supply = (over: Partial<DirectSupply> = {}): DirectSupply => ({
  amountUsdCents: 118_500_00,
  ...over,
});

describe('showing a dollar figure', () => {
  it('spells the currency out rather than using a bare symbol', () => {
    // "$118,500.00" in a screen full of birr is read as birr by somebody
    // scanning. "USD" cannot be.
    expect(formatUSD(118_500_00)).toBe('USD 118,500.00');
    expect(formatUSD(118_500_00)).not.toContain('$');
  });

  it('always shows the cents', () => {
    expect(formatUSD(100_00)).toBe('USD 100.00');
    expect(formatUSD(0)).toBe('USD 0.00');
  });
});

describe('reading a figure someone typed', () => {
  it('takes dollars and stores integer cents', () => {
    expect(usdCentsFrom('118500')).toBe(118_500_00);
    expect(usdCentsFrom('118500.50')).toBe(118_500_50);
  });

  it('accepts the thousands separators people actually type', () => {
    expect(usdCentsFrom('118,500.00')).toBe(118_500_00);
  });

  it('tells a blank box apart from a genuine zero', () => {
    // Storing one as the other puts "USD 0.00" on a contract nobody has
    // recorded a figure for.
    expect(usdCentsFrom('')).toBeNull();
    expect(usdCentsFrom('   ')).toBeNull();
    expect(usdCentsFrom('0')).toBe(0);
  });

  it('refuses nonsense and negatives rather than storing them', () => {
    expect(usdCentsFrom('abc')).toBeNull();
    expect(usdCentsFrom('-5')).toBeNull();
    expect(usdCentsFrom('1e999')).toBeNull();
  });

  it('round-trips through the form field', () => {
    expect(usdCentsToInput(usdCentsFrom('4,250.75'))).toBe('4250.75');
    expect(usdCentsToInput(null)).toBe('');
    expect(usdCentsToInput(undefined)).toBe('');
  });
});

describe('what a contract carries', () => {
  it('reads the figure where there is one', () => {
    expect(directSupplyOf({ equipmentPaidDirect: supply() })?.amountUsdCents).toBe(118_500_00);
  });

  it('treats zero as nothing recorded', () => {
    // A contract showing "USD 0.00 paid direct" invites the question of what
    // happened to the money.
    expect(directSupplyOf({ equipmentPaidDirect: supply({ amountUsdCents: 0 }) })).toBeNull();
  });

  it('is null where the contract has none, or is not there at all', () => {
    expect(directSupplyOf({})).toBeNull();
    expect(directSupplyOf({ equipmentPaidDirect: null })).toBeNull();
    expect(directSupplyOf(null)).toBeNull();
    expect(directSupplyOf(undefined)).toBeNull();
  });
});

describe('totalling across contracts', () => {
  it('adds the cents and counts the contracts', () => {
    const rows = [
      { equipmentPaidDirect: supply({ amountUsdCents: 100_00 }) },
      { equipmentPaidDirect: supply({ amountUsdCents: 250_50 }) },
      {},
    ];
    expect(totalDirectUsdCents(rows)).toBe(350_50);
    expect(countWithDirectSupply(rows)).toBe(2);
  });

  it('is zero when nothing carries one', () => {
    expect(totalDirectUsdCents([{}, {}])).toBe(0);
    expect(countWithDirectSupply([{}, {}])).toBe(0);
  });
});

describe('saying what it is', () => {
  it('says plainly that the money is not ours', () => {
    const said = describeDirectSupply(supply());
    expect(said).toContain('USD 118,500.00');
    expect(said).toContain('not ours');
    expect(said).toContain('not in any figure here');
  });

  it('names who it went to when that is known', () => {
    expect(describeDirectSupply(supply({ paidTo: 'Sicher Elevator' }))).toContain('Sicher Elevator');
  });

  it('falls back to "the manufacturer" rather than leaving a gap', () => {
    expect(describeDirectSupply(supply({ paidTo: '   ' }))).toContain('the manufacturer');
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeDirectSupply(null)).toBeNull();
  });
});

describe('the invariant that keeps it out of the accounts', () => {
  it('exposes no birr figure at all', () => {
    // The guarantee is structural, not a comment asking people to be careful:
    // there is no ETB number here to add to anything.
    const keys = Object.keys(supply({ paidTo: 'X', note: 'Y' }));
    expect(keys.some((k) => k.toLowerCase().includes('santim'))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes('etb'))).toBe(false);
    expect(keys.some((k) => k.toLowerCase().includes('rate'))).toBe(false);
  });

  it('names its amount so no santim sweep can reach it', () => {
    expect(Object.keys(supply())).toContain('amountUsdCents');
  });
});

describe('it cannot reach the accounts', () => {
  it('is absent from every shape the report is built from', async () => {
    // The strongest guarantee available: the reporting types do not carry the
    // field at all, so no section can sum it even by mistake. If somebody adds
    // it to `ReportContract` one day, this fails and asks them why.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../ceo-report.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('equipmentPaidDirect');
    expect(source).not.toContain('UsdCents');
  });

  it('is absent from the money library, which knows only birr', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../money.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('UsdCents');
  });

  it('is absent from the per-project account', async () => {
    // Contract value, invoiced, collected, cost and margin are all birr, and a
    // dollar figure nobody owes us belongs in none of them.
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../project-report.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toContain('equipmentPaidDirect');
    expect(source).not.toContain('UsdCents');
  });
});
