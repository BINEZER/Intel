import { describe, expect, it } from 'vitest';
import { clientChoices, clientOptionLabel, resolveClient } from '../client-choice.js';

const ACTIVE = [
  { id: 'c1', name: 'Active Co' },
  { id: 'c2', name: 'Other Co' },
];

describe('clientChoices', () => {
  it('is just the list for a new record', () => {
    expect(clientChoices(ACTIVE, null).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
  it('keeps the record’s own client when it is not in the list, first and labelled', () => {
    const choices = clientChoices(ACTIVE, { id: 'gone', name: 'Held Ltd' });
    expect(choices.map((c) => c.id)).toEqual(['gone', 'c1', 'c2']);
    expect(clientOptionLabel(choices[0]!)).toBe('Held Ltd (not an active client)');
    expect(clientOptionLabel(choices[1]!)).toBe('Active Co');
  });
  it('does not repeat a client that is already listed', () => {
    expect(clientChoices(ACTIVE, { id: 'c1', name: 'Stale Name' })).toHaveLength(2);
  });
  it('ignores a record with no client at all', () => {
    expect(clientChoices(ACTIVE, { id: '', name: '' })).toHaveLength(2);
  });
});

describe('resolveClient', () => {
  it('reads the current name from the list, so a rename is picked up', () => {
    expect(resolveClient(ACTIVE, 'c1', { id: 'c1', name: 'Old Name' })).toEqual({ id: 'c1', name: 'Active Co' });
  });
  it('falls back to the record’s own client when the list lacks it', () => {
    expect(resolveClient(ACTIVE, 'gone', { id: 'gone', name: 'Held Ltd' })).toEqual({ id: 'gone', name: 'Held Ltd' });
  });
  it('is null when nothing has been chosen', () => {
    expect(resolveClient(ACTIVE, '', null)).toBeNull();
  });
  it('is null for a client that is neither listed nor the record’s own', () => {
    expect(resolveClient(ACTIVE, 'nobody', { id: 'gone', name: 'Held Ltd' })).toBeNull();
  });
});
