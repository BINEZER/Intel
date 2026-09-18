// @vitest-environment jsdom
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
/*
 * The component imports `firebase.ts` for its Timestamp factory, and that
 * module refuses to load without the app's environment variables. A unit test
 * should not need a Firebase project to check that a text box shows a date.
 */
vi.mock('../../firebase.js', () => ({
  toTimestamp: (date: Date) => ({
    toDate: () => new Date(date.getTime()),
    toMillis: () => date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
  }),
}));

import { DualDateInput } from '../DualDateInput.js';
import { dualDateFromGregorian } from '../../lib/dual-date.js';
import type { DualDate, Timestamp } from '../../lib/schema.js';

/**
 * A stand-in for the Firestore Timestamp.
 *
 * Importing the real one drags in `firebase.ts`, which refuses to load without
 * the app's environment variables — a unit test should not need a Firebase
 * project to check that a text box shows a date.
 */
const fakeTimestamp = (date: Date): Timestamp => ({
  toDate: () => new Date(date.getTime()),
  toMillis: () => date.getTime(),
  seconds: Math.floor(date.getTime() / 1000),
  nanoseconds: 0,
});

const on = (iso: string): DualDate =>
  dualDateFromGregorian(new Date(`${iso}T00:00:00.000Z`), fakeTimestamp, 'GC');

/** A parent that can set the date itself, the way the contract form does. */
function Host({ initial = null }: { initial?: DualDate | null }) {
  const [value, setValue] = useState<DualDate | null>(initial);
  return (
    <>
      <button type="button" onClick={() => setValue(on('2026-09-15'))}>
        propose
      </button>
      <button type="button" onClick={() => setValue(null)}>clear</button>
      <DualDateInput label="End" value={value} onChange={setValue} />
    </>
  );
}

const field = () => screen.getByLabelText(/Gregorian date/i) as HTMLInputElement;

describe('a date the parent sets', () => {
  it('appears in the box', async () => {
    // It did not. The component seeded its own state once on mount, so the
    // contract form proposing an end date six months after signing changed the
    // value and the box on screen stayed empty.
    const user = userEvent.setup();
    render(<Host />);
    expect(field().value).toBe('');

    await user.click(screen.getByText('propose'));
    expect(field().value).toBe('2026-09-15');
  });

  it('is cleared when the parent clears it', async () => {
    const user = userEvent.setup();
    render(<Host initial={on('2026-03-15')} />);
    expect(field().value).toBe('2026-03-15');

    await user.click(screen.getByText('clear'));
    expect(field().value).toBe('');
  });

  it('does not fight what is being typed', async () => {
    // Every keystroke round-trips through the parent and comes back. Adopting
    // it blindly would overwrite a half-typed date mid-entry.
    const user = userEvent.setup();
    render(<Host />);
    await user.type(field(), '2027-01-20');
    expect(field().value).toBe('2027-01-20');
  });

  it('shows the date it was given on first render', () => {
    render(<Host initial={on('2025-12-31')} />);
    expect(field().value).toBe('2025-12-31');
  });
});
