// @vitest-environment jsdom
/**
 * The picker is rendered *inside* the paragraph that carries the link it
 * changes — that is the whole point of it, since the control has to sit beside
 * the thing it corrects. A paragraph may only contain phrasing content, so a
 * <div> or a <p> in here is invalid HTML: React says so on the console and the
 * browser silently closes the paragraph early, which breaks the layout.
 *
 * This test renders the open picker in that position and fails on any console
 * error, so the next person to reach for a <div> here finds out at once.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The picker writes through the data layer, which would initialise the real
// Firebase SDK on import. Nothing here saves, so the module is stubbed away.
vi.mock('../../data/relink.js', () => ({ relink: vi.fn() }));
vi.mock('../../data/repository.js', () => ({
  describeFirestoreError: (_cause: unknown, doing: string) => `Could not ${doing}.`,
}));

const { LinkPicker } = await import('../LinkPicker.js');

let errors: unknown[][] = [];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderInParagraph() {
  return render(
    <p className="muted">
      Addis Towers PLC{' '}
      <LinkPicker
        kind="project.client"
        recordId="im-p-bole-01"
        currentId="im-c-addis-towers"
        currentLabel="Addis Towers PLC"
        options={[
          { id: 'im-c-addis-towers', label: 'Addis Towers PLC' },
          { id: 'im-c-ayat', label: 'Ayat Real Estate', hint: 'AYT' },
        ]}
        uid="u1"
        editable
      />
    </p>,
  );
}

describe('LinkPicker inside a paragraph', () => {
  it('renders the collapsed control without a nesting complaint', () => {
    renderInParagraph();
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it('renders the open control without a nesting complaint', async () => {
    const user = userEvent.setup();
    renderInParagraph();
    await user.click(screen.getByRole('button', { name: 'Change' }));

    // The open form really is there — otherwise a component that rendered
    // nothing at all would also pass the console check.
    expect(screen.getByRole('combobox')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(errors).toEqual([]);
  });

  it('keeps every part of the open form inside the paragraph', async () => {
    const user = userEvent.setup();
    const { container } = renderInParagraph();
    await user.click(screen.getByRole('button', { name: 'Change' }));

    const paragraph = container.querySelector('p');
    expect(paragraph).not.toBeNull();
    // A <div> in here would have been hoisted out of the paragraph by the
    // parser in a real browser; jsdom keeps it, so assert the tree directly.
    expect(paragraph?.querySelector('select')).not.toBeNull();
    expect(paragraph?.querySelectorAll('div').length).toBe(0);
    expect(paragraph?.querySelectorAll('p').length).toBe(0);
  });

  it('names the change in words once another client is picked', async () => {
    const user = userEvent.setup();
    const { container } = renderInParagraph();
    await user.click(screen.getByRole('button', { name: 'Change' }));
    await user.selectOptions(screen.getByRole('combobox'), 'im-c-ayat');

    // The sentence, not the heading above it: "Addis Towers PLC" appears twice
    // on screen, so match the one the picker itself wrote.
    const said = container.querySelector('.link-says')?.textContent ?? '';
    expect(said).toContain('Addis Towers PLC');
    expect(said).toContain('Ayat Real Estate');
    expect(screen.getByRole('button', { name: 'Save the change' })).toBeTruthy();
    expect(errors).toEqual([]);
  });
});
