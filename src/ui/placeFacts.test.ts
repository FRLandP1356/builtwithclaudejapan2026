// @vitest-environment jsdom
// The four numbers of a town above the board: the same values the town panel's tiles print, from the same functions.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import { mountPlaceFacts, placeFacts, shareText } from './placeFacts';
import type { AppStoreInitial, PanelContext } from './state';
import { mountTownPanel } from './townPanel';

let cleanup: Array<() => void> = [];

function section(id: string, title: string): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = id;
  const h2 = document.createElement('h2');
  h2.className = 'panel-title';
  h2.id = `${id}-title`;
  h2.textContent = title;
  el.append(h2);
  document.body.append(el);
  return el;
}

function setup(initial: AppStoreInitial = {}) {
  const ctx: PanelContext = makeRealContext(initial);
  const el = section('panel-facts', '');
  cleanup.push(mountPlaceFacts(el, ctx));
  const values = () => [...el.querySelectorAll('.place-fact dd')].map((d) => d.textContent);
  const labels = () => [...el.querySelectorAll('.place-fact dt')].map((d) => d.textContent);
  return { ctx, store: ctx.store, el, values, labels };
}

afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
  document.body.replaceChildren();
});

describe('placeFacts (pure)', () => {
  test('a share prints with one decimal, and 「－」 without a number', () => {
    expect(shareText(0.4412)).toBe('44.1%');
    expect(shareText(NaN)).toBe('－');
  });

  test('田辺市 in 2050 and 2100: the population, the change, the 65+ share and the support ratio, with the year\'s mark', () => {
    const { ctx, store } = setup();
    const f50 = placeFacts(store.get().series, ctx.data.groups, '30206', '田辺市', 2050)!;
    expect(f50.name).toBe('田辺市');
    expect(f50.estimate).toBe(false);
    expect(f50.badge).toBe('公式推計');
    expect(f50.facts.map((x) => x.label)).toEqual(['2050年の人口', '2020年比', '65歳以上の割合', '高齢者1人を支える現役世代']);
    expect(f50.facts[0].value).toBe('4.2万人'); // the town panel's tile (田辺市 2050 = 42,311)
    expect(f50.facts[3].value).toBe('0.9人'); // app.realdata.test: 田辺市 0.9 in 2050
    const f100 = placeFacts(store.get().series, ctx.data.groups, '30206', '田辺市', 2100)!;
    expect(f100.estimate).toBe(true);
    expect(f100.badge).toBe('試算');
    expect(f100.facts[3].value).toBe('0.8人');
    expect(placeFacts(store.get().series, ctx.data.groups, 'nope', 'x', 2050)).toBeUndefined();
  });

  test('every value equals the town panel\'s first four tiles, for three towns and three years', () => {
    for (const code of ['30206', '01101', '47382']) {
      for (const year of [2020, 2050, 2100]) {
        const ctx: PanelContext = makeRealContext({ selectedArea: code, year });
        const town = section('panel-town', '町の詳細');
        cleanup.push(mountTownPanel(town, ctx));
        const tiles = [...town.querySelectorAll('.kpi')].map((k) => k.querySelector('.kpi-value')!.textContent);
        const area = ctx.data.areas.find((a) => a.code === code)!;
        const f = placeFacts(ctx.store.get().series, ctx.data.groups, code, area.name, year)!;
        // tiles: population, change, 65+, 0-14, support; facts: population, change, 65+, support
        expect(f.facts.map((x) => x.value), `${code} ${year}`).toEqual([tiles[0], tiles[1], tiles[2], tiles[4]]);
        town.remove();
      }
    }
  });
});

describe('mountPlaceFacts (DOM)', () => {
  test('hidden for the country and a prefecture; a town fills the band with its name and the four rows', () => {
    const { store, el, values, labels } = setup({ year: 2050 });
    expect(el.hidden).toBe(true);
    store.set({ selectedPref: '30' });
    expect(el.hidden).toBe(true);
    store.set({ selectedArea: '30206' });
    expect(el.hidden).toBe(false);
    expect(el.querySelector('.place-facts-name')!.textContent).toBe('田辺市');
    expect(el.querySelector('.panel-title .badge-official')!.textContent).toBe('公式推計');
    expect(labels()).toEqual(['2050年の人口', '2020年比', '65歳以上の割合', '高齢者1人を支える現役世代']);
    expect(values()[0]).toBe('4.2万人');
  });

  test('a new year rewrites the rows in place and switches the mark; the rows are not rebuilt', () => {
    const { store, el, values } = setup({ selectedArea: '30206', year: 2050 });
    const rows = [...el.querySelectorAll('.place-fact')];
    store.set({ year: 2100 });
    expect(el.querySelector('.panel-title .badge-estimate')!.textContent).toBe('試算');
    expect(values()[0]).not.toBe('4.2万人');
    expect([...el.querySelectorAll('.place-fact')]).toEqual(rows);
  });

  test('a change of assumptions changes the numbers; going back to the prefecture hides the card', () => {
    const { store, el, values } = setup({ selectedArea: '30206', year: 2100 });
    const before = values();
    store.set({ scenario: { ...store.get().scenario, cwrMult: 1.4 } });
    expect(values()).not.toEqual(before);
    store.set({ selectedPref: '30', selectedArea: undefined });
    expect(el.hidden).toBe(true);
  });

  test('teardown removes the rows and hides the card', () => {
    const { el } = setup({ selectedArea: '30206' });
    cleanup.pop()!();
    expect(el.querySelector('.place-facts-list')).toBeNull();
    expect(el.hidden).toBe(true);
  });

  test('a tile prints the number and its unit in two spans (the unit smaller), and their text is still the whole value', () => {
    const { el, values } = setup({ selectedArea: '30206', year: 2050 });
    const tiles = [...el.querySelectorAll('.place-fact')];
    expect(tiles).toHaveLength(4);
    const parts = tiles.map((t) => [t.querySelector('.place-fact-num')!.textContent, t.querySelector('.place-fact-unit')!.textContent]);
    expect(parts[0]).toEqual(['4.2', '万人']);
    expect(parts[1][1]).toBe('%');
    expect(parts[2][1]).toBe('%');
    expect(parts[3]).toEqual(['0.9', '人']);
    expect(parts.map((p) => p.join(''))).toEqual(values());
  });
});

// The card is a grid of two by two tiles since 2026-11-07 (the four rows were taller than the board's heading needed,
// and a margin of their own had cancelled the card's inset, so the rows touched the card's edges). jsdom does not lay
// out, so the test reads the stylesheet.
describe('placeFacts.css: two by two tiles inside the card', () => {
  const css = readFileSync(repoPath('src/ui/placeFacts.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  /** The declarations of every rule whose selector list contains `selector` (exact, whitespace-normalised), joined. */
  function declarations(selector: string): string {
    const want = selector.replace(/\s+/g, ' ');
    const found: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
      if (selectors.includes(want)) found.push(m[2]);
    }
    return found.join(';').replace(/\s+/g, ' ');
  }

  test('the list is a two-column grid and sets no margin of its own, so the card\'s inset keeps it off the edges', () => {
    const list = declarations('.place-facts-list');
    expect(list).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(list).not.toMatch(/margin/);
  });

  test('a tile is the label in the note type over a mincho number, the unit in the body face and smaller', () => {
    expect(declarations('.place-fact dt')).toMatch(/font-size:\s*var\(--fs-13\)/);
    const dd = declarations('.place-fact dd');
    expect(dd).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(dd).toMatch(/font-size:\s*var\(--fs-26\)/);
    expect(dd).toMatch(/margin:\s*auto 0 0/); // the number sits at the bottom of the tile: one line of numbers per row
    const unit = declarations('.place-fact-unit');
    expect(unit).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(unit).toMatch(/font-size:\s*var\(--fs-14\)/);
  });
});
