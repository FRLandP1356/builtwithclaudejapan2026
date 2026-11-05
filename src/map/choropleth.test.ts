// @vitest-environment jsdom
import type { Topology } from 'topojson-specification';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { mountChoropleth, type Choropleth } from './choropleth';

/** A cols x rows grid of 1-degree squares, 1.5 degrees apart; codes g00 (top-left), g01 ... in reading order. */
function gridTopology(cols: number, rows: number): Topology {
  const arcs: number[][][] = [];
  const geometries: unknown[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = 135 + c * 1.5;
      const y = 36 - r * 1.5; // latitude falls as the row index grows, so row 0 is at the top of the screen
      arcs.push([[x, y], [x, y + 1], [x + 1, y + 1], [x + 1, y], [x, y]]); // clockwise on a map: d3-geo reads the other winding as "everything outside"
      geometries.push({ type: 'Polygon', arcs: [[i]], properties: { code: `g${r}${c}`, name: `地域${r}${c}` } });
    }
  }
  return { type: 'Topology', objects: { areas: { type: 'GeometryCollection', geometries } }, arcs } as unknown as Topology;
}

let map: Choropleth | undefined;
let picked: string[] = [];

function mount(cols = 3, rows = 3): { host: HTMLElement; map: Choropleth } {
  const host = document.createElement('div');
  document.body.append(host);
  picked = [];
  map = mountChoropleth(host, {
    topology: gridTopology(cols, rows),
    objectName: 'areas',
    label: 'テスト地図',
    ariaLabel: (_c, name) => name,
    tooltip: (_c, name) => ({ title: name, lines: [] }),
    onPick: (code) => picked.push(code),
  });
  return { host, map };
}

afterEach(() => {
  map?.destroy();
  map = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const areas = (host: HTMLElement) => [...host.querySelectorAll<SVGPathElement>('path.area')];
const stops = (host: HTMLElement) => areas(host).filter((a) => Number(a.getAttribute('tabindex')) >= 0).map((a) => a.getAttribute('data-code'));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(ev);
  return ev;
};
const focused = () => document.activeElement?.getAttribute('data-code');

describe('one Tab stop for the whole map', () => {
  test('exactly one area has tabindex 0 (the first), every other area -1', () => {
    const { host } = mount(4, 3);
    expect(areas(host)).toHaveLength(12);
    expect(stops(host)).toEqual(['g00']);
    expect(areas(host).filter((a) => a.getAttribute('tabindex') === '-1')).toHaveLength(11);
    expect(map!.tabStop()).toBe('g00');
  });

  test('the svg root and the islet hit rings are no Tab stops either', () => {
    const { host } = mount();
    const focusable = [...host.querySelectorAll('[tabindex]')].filter((e) => Number(e.getAttribute('tabindex')) >= 0);
    expect(focusable).toHaveLength(1);
    expect(host.querySelector('svg')!.getAttribute('tabindex')).toBe('-1');
  });

  test('setSelected moves the Tab stop to the selected area; clearing the selection goes back to the first', () => {
    const { host } = mount();
    map!.setSelected('g12');
    expect(stops(host)).toEqual(['g12']);
    map!.setSelected('g21');
    expect(stops(host)).toEqual(['g21']);
    map!.setSelected(undefined);
    expect(stops(host)).toEqual(['g00']);
    map!.setSelected('nope'); // not on this map: nothing breaks, the first stays
    expect(stops(host)).toEqual(['g00']);
  });

  test('a repeated setSelected (every recolour calls it) does not undo where the arrow keys have roved to', () => {
    const { host } = mount();
    map!.setSelected('g11');
    areas(host)[0].focus();
    key(document.activeElement!, 'ArrowRight');
    expect(stops(host)).toEqual(['g01']);
    map!.setSelected('g11'); // same value again
    expect(stops(host)).toEqual(['g01']);
    map!.setSelected(undefined);
    expect(stops(host)).toEqual(['g00']);
  });

  test('focusing an area with the pointer or a script makes it the Tab stop', () => {
    const { host } = mount();
    areas(host)[5].focus();
    expect(stops(host)).toEqual(['g12']);
  });

  test('the svg is described by a hidden sentence that names the arrow keys', () => {
    const { host } = mount();
    const svg = host.querySelector('svg')!;
    const hint = host.querySelector(`#${svg.getAttribute('aria-describedby')}`)!;
    expect(hint.classList.contains('sr-only')).toBe(true);
    expect(hint.textContent).toContain('矢印キー');
    expect(hint.textContent).toContain('Home');
  });
});

describe('arrow keys, Home and End', () => {
  test('arrows move the focus to the neighbour on screen and the Tab stop follows', () => {
    const { host } = mount();
    areas(host)[4].focus(); // g11, the middle
    expect(focused()).toBe('g11');
    const ev = key(document.activeElement!, 'ArrowRight');
    expect(ev.defaultPrevented).toBe(true);
    expect(focused()).toBe('g12');
    key(document.activeElement!, 'ArrowDown');
    expect(focused()).toBe('g22');
    key(document.activeElement!, 'ArrowLeft');
    expect(focused()).toBe('g21');
    key(document.activeElement!, 'ArrowUp');
    expect(focused()).toBe('g11');
    expect(stops(host)).toEqual(['g11']);
  });

  test('at an edge the focus stays, the Tab stop stays, and the key is still kept from scrolling the page', () => {
    const { host } = mount();
    areas(host)[0].focus();
    for (const k of ['ArrowLeft', 'ArrowUp']) {
      const ev = key(document.activeElement!, k);
      expect(ev.defaultPrevented).toBe(true);
      expect(focused()).toBe('g00');
    }
    expect(stops(host)).toEqual(['g00']);
  });

  test('Home goes to the first area and End to the last, from anywhere', () => {
    const { host } = mount();
    areas(host)[4].focus();
    key(document.activeElement!, 'End');
    expect(focused()).toBe('g22');
    expect(stops(host)).toEqual(['g22']);
    key(document.activeElement!, 'Home');
    expect(focused()).toBe('g00');
    expect(stops(host)).toEqual(['g00']);
  });

  test('PageDown and PageUp go to the next and previous area in Tab order, and stop at the ends', () => {
    const { host } = mount();
    areas(host)[0].focus();
    const order = areas(host).map((a) => a.getAttribute('data-code'));
    const walked: Array<string | null | undefined> = [focused()];
    for (let i = 0; i < 12; i++) {
      const ev = key(document.activeElement!, 'PageDown');
      expect(ev.defaultPrevented).toBe(true);
      walked.push(focused());
    }
    expect(walked.slice(0, 9)).toEqual(order); // every area once, in DOM order
    expect(walked.slice(8)).toEqual(Array(5).fill(order[8])); // the last area keeps focus
    expect(stops(host)).toEqual([order[8]]);
    for (let i = 0; i < 8; i++) key(document.activeElement!, 'PageUp');
    expect(focused()).toBe(order[0]);
    expect(key(document.activeElement!, 'PageUp').defaultPrevented).toBe(true);
    expect(focused()).toBe(order[0]);
    expect(stops(host)).toEqual([order[0]]);
  });

  test('a modified PageDown is left alone', () => {
    const { host } = mount();
    areas(host)[0].focus();
    expect(key(document.activeElement!, 'PageDown', { altKey: true }).defaultPrevented).toBe(false);
    expect(focused()).toBe('g00');
  });

  test('a modified arrow (Alt+Left is the browser back) is left alone', () => {
    const { host } = mount();
    areas(host)[4].focus();
    for (const init of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const ev = key(document.activeElement!, 'ArrowRight', init);
      expect(ev.defaultPrevented).toBe(false);
      expect(focused()).toBe('g11');
    }
  });

  test('other keys are not taken (Tab leaves the map, letters do nothing)', () => {
    const { host } = mount();
    areas(host)[4].focus();
    for (const k of ['Tab', 'a', 'F1', 'Escape', 'constructor', 'toString', '__proto__']) {
      expect(key(document.activeElement!, k).defaultPrevented).toBe(false);
    }
    expect(focused()).toBe('g11');
  });

  test('Enter and Space still select the focused area', () => {
    const { host } = mount();
    areas(host)[4].focus();
    expect(key(document.activeElement!, 'Enter').defaultPrevented).toBe(true);
    key(document.activeElement!, ' ');
    areas(host)[2].focus();
    key(document.activeElement!, 'Enter');
    expect(picked).toEqual(['g11', 'g11', 'g02']);
  });

  test('a click still selects (pointer users are unaffected)', () => {
    const { host } = mount();
    areas(host)[7].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toEqual(['g21']);
  });

  test('focusing by arrow shows the tooltip and the focus ring like Tab did', () => {
    const { host } = mount();
    areas(host)[4].focus();
    key(document.activeElement!, 'ArrowRight');
    const tip = host.querySelector<HTMLElement>('.map-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain('地域12');
    expect(host.querySelector('.ring-focus')!.getAttribute('d')).toBe(areas(host)[5].getAttribute('d'));
  });
});
