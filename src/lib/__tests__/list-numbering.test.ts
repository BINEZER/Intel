// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'intelmotion.lists.numbered';

async function load() {
  vi.resetModules();
  return import('../list-numbering.js');
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-numbered-lists');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the preference', () => {
  it('starts off', async () => {
    const m = await load();
    expect(m.listsAreNumbered()).toBe(false);
  });

  it('remembers being turned on', async () => {
    const m = await load();
    m.setListsNumbered(true);
    expect(window.localStorage.getItem(KEY)).toBe('true');

    // A reload is a fresh module reading the same storage.
    const again = await load();
    expect(again.listsAreNumbered()).toBe(true);
  });

  it('toggles back off', async () => {
    const m = await load();
    m.toggleListsNumbered();
    expect(m.listsAreNumbered()).toBe(true);
    m.toggleListsNumbered();
    expect(m.listsAreNumbered()).toBe(false);
  });

  it('still renders when storage is blocked', async () => {
    // Private browsing throws on both read and write. A preference that cannot
    // be stored is not a reason to fail to draw a list.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const m = await load();
    expect(m.listsAreNumbered()).toBe(false);
    expect(() => m.setListsNumbered(true)).not.toThrow();
    expect(m.listsAreNumbered()).toBe(true);
  });
});

describe('telling every list at once', () => {
  it('notifies subscribers', async () => {
    const m = await load();
    const seen: boolean[] = [];
    m.subscribeListNumbering(() => seen.push(m.listsAreNumbered()));

    m.setListsNumbered(true);
    m.setListsNumbered(false);
    expect(seen).toEqual([true, false]);
  });

  it('says nothing when the value has not actually changed', async () => {
    // Every mounted list re-renders on each notification; firing for a no-op
    // would re-render all of them for nothing.
    const m = await load();
    let calls = 0;
    m.subscribeListNumbering(() => { calls += 1; });
    m.setListsNumbered(false);
    expect(calls).toBe(0);
  });

  it('stops notifying once unsubscribed', async () => {
    const m = await load();
    let calls = 0;
    const off = m.subscribeListNumbering(() => { calls += 1; });
    off();
    m.setListsNumbered(true);
    expect(calls).toBe(0);
  });
});

describe('the root attribute that drives the card counters', () => {
  it('is set and cleared with the preference', async () => {
    const m = await load();
    m.setListsNumbered(true);
    expect(document.documentElement.getAttribute('data-numbered-lists')).toBe('on');
    m.setListsNumbered(false);
    expect(document.documentElement.hasAttribute('data-numbered-lists')).toBe(false);
  });

  it('is applied on load, not only on change', async () => {
    window.localStorage.setItem(KEY, 'true');
    await load();
    expect(document.documentElement.getAttribute('data-numbered-lists')).toBe('on');
  });
});

describe('how wide the number column has to be', () => {
  it('grows with the longest number the list reaches', async () => {
    const m = await load();
    expect(m.rowNumberWidth(9)).toBe(1);
    expect(m.rowNumberWidth(10)).toBe(2);
    expect(m.rowNumberWidth(163)).toBe(3);
  });

  it('never collapses to nothing on an empty list', async () => {
    const m = await load();
    expect(m.rowNumberWidth(0)).toBe(1);
  });
});
