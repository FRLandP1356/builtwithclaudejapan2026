// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SearchEntry } from './nav';
import { mountSearch } from './search';

const index: SearchEntry[] = [
  { kind: 'pref', code: '30', name: '和歌山県', prefCode: '30' },
  { kind: 'area', code: '30206', name: '田辺市', prefCode: '30', prefName: '和歌山県' },
  { kind: 'area', code: '26211', name: '京田辺市', prefCode: '26', prefName: '京都府' },
];

function setup() {
  const el = document.createElement('div');
  document.body.append(el);
  const onPick = vi.fn();
  const search = mountSearch(el, { index, onPick });
  const input = el.querySelector<HTMLInputElement>('input')!;
  const list = el.querySelector<HTMLUListElement>('ul')!;
  return { el, input, list, onPick, search };
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Dispatch a keydown; jsdom accepts isComposing and keyCode in the init, but pin them in case it does not. */
function keydown(input: HTMLInputElement, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (init.isComposing && !e.isComposing) Object.defineProperty(e, 'isComposing', { value: true });
  if (init.keyCode !== undefined && e.keyCode !== init.keyCode) Object.defineProperty(e, 'keyCode', { value: init.keyCode });
  input.dispatchEvent(e);
  return e;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('mountSearch', () => {
  test('lists matches as options and Enter picks the first one', () => {
    const { input, list, onPick } = setup();
    type(input, '田辺');
    expect(list.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect([...list.querySelectorAll('[role="option"]')].map((li) => li.textContent)).toEqual(['田辺市和歌山県', '京田辺市京都府']);
    keydown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].code).toBe('30206');
    expect(input.value).toBe('');
    expect(list.hidden).toBe(true);
  });

  test('ArrowDown moves the active option and Enter picks it', () => {
    const { input, list, onPick } = setup();
    type(input, '田辺');
    keydown(input, { key: 'ArrowDown' });
    keydown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(list.children[1].id);
    expect(list.children[1].getAttribute('aria-selected')).toBe('true');
    keydown(input, { key: 'Enter' });
    expect(onPick.mock.calls[0][0].code).toBe('26211');
  });

  test('Enter during IME composition (isComposing) is ignored', () => {
    const { input, onPick } = setup();
    type(input, '田辺');
    keydown(input, { key: 'Enter', isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
    expect(input.value).toBe('田辺');
  });

  test('Enter with keyCode 229 (Safari after compositionend) is ignored', () => {
    const { input, onPick } = setup();
    type(input, '田辺');
    keydown(input, { key: 'Enter', keyCode: 229 });
    expect(onPick).not.toHaveBeenCalled();
  });

  test('arrow keys during composition do not move the selection', () => {
    const { input } = setup();
    type(input, '田辺');
    keydown(input, { key: 'ArrowDown', isComposing: true });
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  test('no match shows a status line outside the listbox, and the listbox stays empty and closed', () => {
    const { el, input, list, onPick } = setup();
    type(input, 'zzz');
    expect(list.hidden).toBe(true);
    expect(list.children).toHaveLength(0);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    const empty = el.querySelector<HTMLElement>('.search-empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.getAttribute('role')).toBe('status');
    expect(empty.textContent).toBe('見つかりませんでした');
    expect(empty.closest('[role="listbox"]')).toBeNull();
    keydown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  test('Escape closes the list and a second Escape clears the input', () => {
    const { input, list } = setup();
    type(input, '田辺');
    keydown(input, { key: 'Escape' });
    expect(list.hidden).toBe(true);
    expect(input.value).toBe('田辺');
    keydown(input, { key: 'Escape' });
    expect(input.value).toBe('');
  });
});
