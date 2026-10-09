// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FormPanel } from '../FormPanel.js';

afterEach(cleanup);

// jsdom has no layout, so scrolling a panel into view is a no-op to stub.
Element.prototype.scrollIntoView = () => {};

function Example({ capacity }: { capacity: string }) {
  return (
    <FormPanel title="Edit lift" onClose={() => {}}>
      <form onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="cap">Capacity, kg</label>
        <input id="cap" type="number" min="0" defaultValue={capacity} />
        <button type="submit">Save changes</button>
      </form>
    </FormPanel>
  );
}

describe('a form the browser refuses to submit', () => {
  it('says why, in words, instead of doing nothing', () => {
    render(<Example capacity="-5" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const message = screen.getByRole('alert');
    expect(message.textContent).toMatch(/^Not saved — Capacity, kg: /);
  });

  it('stays quiet when nothing is wrong', () => {
    render(<Example capacity="630" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears once the person changes the field', () => {
    render(<Example capacity="-5" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.queryByRole('alert')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Capacity, kg'), { target: { value: '630' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
