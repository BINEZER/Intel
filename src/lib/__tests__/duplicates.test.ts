import { describe, expect, it } from 'vitest';
import {
  extraCount,
  findDuplicates,
  normaliseCode,
  normaliseName,
  type DuplicateCandidate,
} from '../duplicates.js';

const rec = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: 'a',
  code: null,
  name: 'Addis Towers PLC',
  createdAtMillis: 1_000,
  references: 0,
  ...over,
});

describe('normalising a name', () => {
  it('sees through case, punctuation and the company form', () => {
    // The part people type inconsistently is never the part that tells two
    // clients apart.
    const same = ['Addis Towers PLC', 'addis towers plc', 'Addis  Towers  P.L.C.', 'ADDIS TOWERS Plc'];
    const keys = new Set(same.map(normaliseName));
    expect(keys.size).toBe(1);
  });

  it('still tells genuinely different names apart', () => {
    expect(normaliseName('Addis Towers PLC')).not.toBe(normaliseName('Addis Homes PLC'));
  });

  it('does not collapse a name that is only a company form', () => {
    // "PLC" alone normalises to nothing, and an empty key would group every
    // such record together.
    expect(normaliseName('PLC')).toBe('');
  });
});

describe('normalising a code', () => {
  it('ignores case and spacing, which are never meaningful in a reference', () => {
    expect(normaliseCode('AGR-2021-001')).toBe(normaliseCode('agr 2021 001'));
  });
});

describe('finding duplicates', () => {
  it('groups two records sharing a code', () => {
    const groups = findDuplicates([
      rec({ id: 'a', code: 'AGR-2021-001' }),
      rec({ id: 'b', code: 'AGR-2021-001', name: 'Something else entirely' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('same code');
  });

  it('groups two records sharing a name once normalised', () => {
    const groups = findDuplicates([
      rec({ id: 'a', name: 'Addis Towers PLC' }),
      rec({ id: 'b', name: 'addis towers plc.' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('same name');
  });

  it('reports a pair once, under the code, never twice', () => {
    // The same pair under two headings makes a list nobody can act on.
    const groups = findDuplicates([
      rec({ id: 'a', code: 'AGR-1', name: 'Addis Towers PLC' }),
      rec({ id: 'b', code: 'AGR-1', name: 'Addis Towers PLC' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.reason).toBe('same code');
  });

  it('leaves a record that matches nothing alone', () => {
    expect(findDuplicates([rec({ id: 'a' }), rec({ id: 'b', name: 'Quite different' })])).toEqual([]);
  });

  it('ignores a blank code rather than grouping everything without one', () => {
    const groups = findDuplicates([
      rec({ id: 'a', code: '', name: 'One' }),
      rec({ id: 'b', code: '   ', name: 'Two' }),
    ]);
    expect(groups).toEqual([]);
  });

  it('puts the worst offender first', () => {
    const groups = findDuplicates([
      rec({ id: 'a', name: 'Pair' }), rec({ id: 'b', name: 'Pair' }),
      rec({ id: 'c', name: 'Triple' }), rec({ id: 'd', name: 'Triple' }), rec({ id: 'e', name: 'Triple' }),
    ]);
    expect(groups[0]?.extras).toHaveLength(2);
  });
});

describe('choosing which one to keep', () => {
  it('keeps the one other records already point at', () => {
    // Keeping it means no reference has to move.
    const groups = findDuplicates([
      rec({ id: 'lonely', references: 0, createdAtMillis: 1 }),
      rec({ id: 'used', references: 4, createdAtMillis: 99 }),
    ]);
    expect(groups[0]?.keep.id).toBe('used');
    expect(groups[0]?.why).toContain('4 other records');
  });

  it('keeps the oldest when nothing points at any of them', () => {
    const groups = findDuplicates([
      rec({ id: 'new', createdAtMillis: 900 }),
      rec({ id: 'old', createdAtMillis: 5 }),
    ]);
    expect(groups[0]?.keep.id).toBe('old');
    expect(groups[0]?.why).toContain('oldest');
  });

  it('keeps the oldest when two are referenced equally', () => {
    const groups = findDuplicates([
      rec({ id: 'newer', references: 2, createdAtMillis: 900 }),
      rec({ id: 'older', references: 2, createdAtMillis: 5 }),
    ]);
    expect(groups[0]?.keep.id).toBe('older');
  });

  it('never lists the keeper among the records to remove', () => {
    const groups = findDuplicates([rec({ id: 'a' }), rec({ id: 'b' }), rec({ id: 'c' })]);
    expect(groups[0]?.extras.map((e) => e.id)).not.toContain(groups[0]?.keep.id);
    expect(groups[0]?.extras).toHaveLength(2);
  });
});

describe('counting the work', () => {
  it('counts records that could go, not groups', () => {
    const groups = findDuplicates([
      rec({ id: 'a', name: 'X' }), rec({ id: 'b', name: 'X' }), rec({ id: 'c', name: 'X' }),
      rec({ id: 'd', name: 'Y' }), rec({ id: 'e', name: 'Y' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(extraCount(groups)).toBe(3);
  });

  it('is zero when there is nothing to do', () => {
    expect(extraCount(findDuplicates([rec()]))).toBe(0);
  });
});
