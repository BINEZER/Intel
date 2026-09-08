// @vitest-environment jsdom
/**
 * Behavioural tests for the dual-calendar input.
 *
 * The contract under test: whichever calendar the user types in, the value
 * handed upward always carries a Gregorian UTC timestamp as its source of truth.
 */

import { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DualDate } from '../../lib/schema.js';

// Stub the Firebase module: this component imports `toTimestamp` from it, and
// initialising the real SDK would demand env vars and a network.
vi.mock('../../firebase.js', () => ({
  toTimestamp: (date: Date) => ({
    toDate: () => date,
    toMillis: () => date.getTime(),
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
  }),
}));

const { DualDateInput } = await import('../DualDateInput.js');

/**
 * Stateful harness. DualDateInput is a controlled component, so a test that
 * never feeds the new value back would leave the live preview permanently empty
 * and would not exercise the component the way a real form does.
 */
function setup(initial: DualDate | null = null) {
  const onChange = vi.fn<(v: DualDate | null) => void>();

  function Harness() {
    const [value, setValue] = useState<DualDate | null>(initial);
    return (
      <DualDateInput
        label="Planned handover"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }

  const utils = render(<Harness />);
  const last = () => onChange.mock.calls.at(-1)?.[0] ?? null;
  return { onChange, last, ...utils };
}

const gcInput = () =>
  screen.getByLabelText<HTMLInputElement>(/Gregorian date/i);

beforeEach(() => vi.clearAllMocks());

describe('Gregorian entry', () => {
  it('emits a UTC timestamp and the derived Ethiopian reading', async () => {
    const { last } = setup();
    await userEvent.type(gcInput(), '2025-09-11');

    const value = last();
    expect(value).not.toBeNull();
    expect(value!.at.toDate().toISOString()).toBe('2025-09-11T00:00:00.000Z');
    expect(value!.ec).toEqual({ year: 2018, month: 1, day: 1 });
    expect(value!.ecPeriod).toBe('EC-2018-01');
    expect(value!.enteredIn).toBe('GC');
  });
});

describe('Ethiopian entry', () => {
  it('converts to Gregorian BEFORE emitting, which is what reaches Firestore', async () => {
    const { last } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));

    await userEvent.selectOptions(screen.getByLabelText('Day'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Month'), '1');
    await userEvent.type(screen.getByLabelText('Year'), '2018');

    const value = last();
    expect(value).not.toBeNull();
    // The whole point: an EC input lands in Firestore as a Gregorian instant.
    expect(value!.at.toDate().toISOString()).toBe('2025-09-11T00:00:00.000Z');
    expect(value!.enteredIn).toBe('EC');
    expect(value!.ecFiscalYear).toBe(2018);
  });

  it('shows the Gregorian equivalent live while typing', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));
    await userEvent.selectOptions(screen.getByLabelText('Day'), '1');
    await userEvent.selectOptions(screen.getByLabelText('Month'), '1');
    await userEvent.type(screen.getByLabelText('Year'), '2018');

    expect(screen.getByText(/11 Sep 2025/)).toBeDefined();
  });

  it('offers only 5 days for Pagume in a non-leap year, and 6 in a leap year', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));
    await userEvent.type(screen.getByLabelText('Year'), '2012');
    await userEvent.selectOptions(screen.getByLabelText('Month'), '13');

    const days = screen.getByLabelText<HTMLSelectElement>('Day');
    expect(days.options.length - 1).toBe(5); // less the placeholder option
    expect(screen.getByText(/2012 is not a leap year/)).toBeDefined();

    await userEvent.clear(screen.getByLabelText('Year'));
    await userEvent.type(screen.getByLabelText('Year'), '2011');
    expect(days.options.length - 1).toBe(6);
    expect(screen.getByText(/2011 is a leap year/)).toBeDefined();
  });

  it('emits null while the date is incomplete, so a half-typed date cannot be saved', async () => {
    const { last } = setup();
    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));
    await userEvent.selectOptions(screen.getByLabelText('Day'), '1');
    expect(last()).toBeNull();
  });
});

describe('switching calendars', () => {
  it('preserves the chosen date and updates enteredIn', async () => {
    const { last } = setup();
    await userEvent.type(gcInput(), '2025-09-11');
    const beforeSwitch = last()!.at.toMillis();

    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));

    const after = last()!;
    expect(after.at.toMillis()).toBe(beforeSwitch); // same instant
    expect(after.enteredIn).toBe('EC');             // now attributed to the EC picker
    expect(screen.getByLabelText<HTMLSelectElement>('Day').value).toBe('1');
    expect(screen.getByLabelText<HTMLInputElement>('Year').value).toBe('2018');
  });

  it('round-trips back to Gregorian without drift', async () => {
    const { last } = setup();
    await userEvent.type(gcInput(), '2024-02-29'); // leap day, worth pinning
    const original = last()!.at.toMillis();

    await userEvent.click(screen.getByRole('button', { name: /Ethiopian/ }));
    await userEvent.click(screen.getByRole('button', { name: /Gregorian/ }));

    expect(last()!.at.toMillis()).toBe(original);
    expect(last()!.enteredIn).toBe('GC');
  });
});
