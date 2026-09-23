import { describe, expect, it } from 'vitest';
import {
  describeFleet,
  describeMake,
  describeSpec,
  hasSpec,
  missingSpecFields,
  type LiftSpec,
} from '../lift-spec.js';

const spec = (over: Partial<LiftSpec> = {}): LiftSpec => ({
  capacityKg: 630,
  personCapacity: 8,
  speedMps: 1,
  stops: 8,
  ...over,
});

describe('is there anything recorded', () => {
  it('says no for an empty spec, a null and an undefined', () => {
    expect(hasSpec({})).toBe(false);
    expect(hasSpec(null)).toBe(false);
    expect(hasSpec(undefined)).toBe(false);
  });

  it('says yes on a single field', () => {
    expect(hasSpec({ stops: 4 })).toBe(true);
    expect(hasSpec({ brand: 'Sicher' })).toBe(true);
  });

  it('does not count an empty string as recorded', () => {
    expect(hasSpec({ brand: '', model: '', type: '' })).toBe(false);
  });

  it('counts a zero, which is a real answer for a number', () => {
    // 0 stops is nonsense in practice, but if somebody recorded it they
    // recorded something, and hiding it would hide the mistake.
    expect(hasSpec({ stops: 0 })).toBe(true);
  });
});

describe('the specification line', () => {
  it('reads the way lifts are talked about on site', () => {
    expect(describeSpec(spec())).toBe('630 kg · 8 persons · 1 m/s · 8 stops');
  });

  it('leaves out what is not recorded rather than printing a dash', () => {
    expect(describeSpec({ capacityKg: 1000, stops: 12 })).toBe('1,000 kg · 12 stops');
  });

  it('separates the thousands, because 10000 kg is misread', () => {
    expect(describeSpec({ capacityKg: 10_000 })).toBe('10,000 kg');
  });

  it('gets the singular right', () => {
    expect(describeSpec({ stops: 1 })).toBe('1 stop');
    expect(describeSpec({ stops: 2 })).toBe('2 stops');
  });

  it('says nothing at all when nothing is recorded', () => {
    expect(describeSpec({})).toBeNull();
    expect(describeSpec(null)).toBeNull();
  });
});

describe('the make', () => {
  it('joins brand and model', () => {
    expect(describeMake({ brand: 'Sicher', model: 'SC-1000' })).toBe('Sicher · SC-1000');
  });

  it('takes whichever one is there', () => {
    expect(describeMake({ brand: 'Sicher' })).toBe('Sicher');
    expect(describeMake({ model: 'SC-1000' })).toBe('SC-1000');
  });

  it('ignores blanks rather than printing a stray separator', () => {
    expect(describeMake({ brand: '  ', model: 'SC-1000' })).toBe('SC-1000');
    expect(describeMake({})).toBeNull();
  });
});

describe('what is still missing', () => {
  it('names the four a crew actually needs', () => {
    expect(missingSpecFields({})).toEqual(['capacity', 'stops', 'speed', 'person capacity']);
  });

  it('shrinks as fields are filled in', () => {
    expect(missingSpecFields({ capacityKg: 630, stops: 8 })).toEqual(['speed', 'person capacity']);
    expect(missingSpecFields(spec())).toEqual([]);
  });

  it('never asks for brand or model, which never block a crew', () => {
    expect(missingSpecFields({})).not.toContain('brand');
    expect(missingSpecFields({})).not.toContain('model');
  });
});

describe('a set of lifts', () => {
  it('groups identical machines rather than repeating the line', () => {
    // Four identical lifts in one shaft bank is the common case, and the same
    // sentence four times is noise where a count is information.
    const said = describeFleet([
      { tag: 'LIFT-01', spec: spec() },
      { tag: 'LIFT-02', spec: spec() },
      { tag: 'LIFT-03', spec: spec() },
      { tag: 'LIFT-04', spec: spec() },
    ]);
    expect(said).toBe('4 × 630 kg · 8 persons · 1 m/s · 8 stops');
  });

  it('lists a one-off without a count in front of it', () => {
    expect(describeFleet([{ tag: 'LIFT-01', spec: { stops: 6 } }])).toBe('6 stops');
  });

  it('puts the commonest specification first', () => {
    const said = describeFleet([
      { tag: 'a', spec: { capacityKg: 1000 } },
      { tag: 'b', spec: { capacityKg: 630 } },
      { tag: 'c', spec: { capacityKg: 630 } },
    ]);
    expect(said?.startsWith('2 × 630 kg')).toBe(true);
  });

  it('counts the ones with nothing recorded instead of hiding them', () => {
    const said = describeFleet([
      { tag: 'a', spec: { stops: 8 } },
      { tag: 'b', spec: {} },
      { tag: 'c', spec: {} },
    ]);
    expect(said).toContain('8 stops');
    expect(said).toContain('2 with no specification recorded');
  });

  it('says nothing for no lifts', () => {
    expect(describeFleet([])).toBeNull();
  });
});
