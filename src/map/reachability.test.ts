// @vitest-environment jsdom
// The real geometry (the national map and all 47 prefecture maps, as the app mounts them): with one Tab stop for the
// map, every area must still be reachable from the keyboard. The arrows alone may leave some areas out (on the real 北海道
// map there was one that is nobody's nearest neighbour in any direction), so PageUp/PageDown walk the Tab order. The
// tests say what must hold, not which areas the arrows happen to miss: if the arrow rule improves they stay green.
import { readdirSync, readFileSync } from 'node:fs';
import type { Topology } from 'topojson-specification';
import { afterEach, describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import type { Choropleth } from './choropleth';
import { mountNationalMap } from './nationalMap';
import { mountPrefectureMap } from './prefectureMap';

const topo = (path: string) => JSON.parse(readFileSync(repoPath(path), 'utf8')) as Topology;
const PREF_DIR = 'public/data/geo/pref';
const prefFiles = readdirSync(repoPath(PREF_DIR)).filter((f) => f.endsWith('.topo.json')).sort();

let mounted: Choropleth | undefined;
afterEach(() => {
  mounted?.destroy();
  mounted = undefined;
  document.body.replaceChildren();
});

function mountReal(kind: 'national' | 'pref', path: string): { map: Choropleth; paths: SVGPathElement[] } {
  const host = document.createElement('div');
  document.body.append(host);
  const opts = { topology: topo(path), label: path, ariaLabel: (_c: string, n: string) => n, tooltip: () => null, onPick: () => {} };
  mounted = kind === 'national' ? mountNationalMap(host, opts) : mountPrefectureMap(host, opts);
  return { map: mounted, paths: [...host.querySelectorAll<SVGPathElement>('path.area')] };
}

const press = (el: Element, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

/** Codes reachable from the first area by pressing `keys` on every area reached. */
function reach(paths: SVGPathElement[], keys: readonly string[]): Set<string> {
  const byCode = new Map(paths.map((p) => [p.getAttribute('data-code')!, p]));
  const seen = new Set<string>([paths[0].getAttribute('data-code')!]);
  const queue = [paths[0]];
  while (queue.length) {
    const from = queue.shift()!;
    for (const k of keys) {
      from.focus();
      press(from, k);
      const code = document.activeElement?.getAttribute('data-code');
      if (code && byCode.has(code) && !seen.has(code)) {
        seen.add(code);
        queue.push(byCode.get(code)!);
      }
    }
  }
  return seen;
}

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;
const PAGES = ['PageUp', 'PageDown'] as const;
const WITH_PAGES = [...ARROWS, ...PAGES] as const;
const codeOf = (p: SVGPathElement) => p.getAttribute('data-code')!;

/** What the keys must achieve on one map. `paths` are the map's areas in Tab (DOM) order. */
function checkReachable(paths: SVGPathElement[], where: string): void {
  const codes = paths.map(codeOf);
  expect(new Set(codes).size, `${where}: codes are unique`).toBe(codes.length);
  const byArrows = reach(paths, ARROWS);
  const missedByArrows = codes.filter((c) => !byArrows.has(c)); // whatever the arrow rule leaves out today
  const byPages = reach(paths, PAGES);
  // the page keys alone reach every area, so in particular every area the arrows miss
  expect(codes.filter((c) => !byPages.has(c)), `${where}: not reached by PageUp/PageDown`).toEqual([]);
  expect(missedByArrows.filter((c) => !byPages.has(c)), `${where}: missed by the arrows and by the page keys`).toEqual([]);
  // and with everything together, from the first area
  const byAll = reach(paths, WITH_PAGES);
  expect(codes.filter((c) => !byAll.has(c)), `${where}: not reached by arrows + page keys`).toEqual([]);
}

describe('real maps: every area can be reached from the keyboard', () => {
  test('the data is there: the national map and 47 prefecture maps', () => {
    expect(prefFiles).toHaveLength(47);
  });

  test('national map: all 47 prefectures are reachable from the first (arrows + page keys, and page keys alone)', () => {
    const { paths } = mountReal('national', 'public/data/geo/japan.topo.json');
    expect(paths).toHaveLength(47);
    checkReachable(paths, 'national map');
  });

  test('every prefecture map: every area is reachable from the first; PageDown alone walks the Tab order', () => {
    let total = 0;
    for (const file of prefFiles) {
      const { paths } = mountReal('pref', `${PREF_DIR}/${file}`);
      const codes = paths.map(codeOf);
      total += codes.length;
      checkReachable(paths, file);
      // PageDown alone: first to last in DOM order, each area exactly once
      paths[0].focus();
      const walked = [document.activeElement!.getAttribute('data-code')];
      for (let i = 1; i < paths.length; i++) {
        press(document.activeElement!, 'PageDown');
        walked.push(document.activeElement!.getAttribute('data-code'));
      }
      expect(walked, `${file}: PageDown order`).toEqual(codes);
      mounted!.destroy();
      mounted = undefined;
      document.body.replaceChildren();
    }
    expect(total).toBeGreaterThan(1800);
  }, 60_000);

  test('Okinawa is not an arrow target from the main map (ArrowUp from 北海道), yet End and PageUp reach it', () => {
    const { paths } = mountReal('national', 'public/data/geo/japan.topo.json');
    const get = (code: string) => paths.find((p) => p.getAttribute('data-code') === code)!;
    for (const code of paths.map((p) => p.getAttribute('data-code')!).filter((c) => c !== '47')) {
      for (const k of ARROWS) {
        const from = get(code);
        from.focus();
        press(from, k);
        expect(document.activeElement?.getAttribute('data-code'), `${k} from ${code}`).not.toBe('47');
      }
    }
    get('01').focus();
    press(document.activeElement!, 'End');
    expect(document.activeElement?.getAttribute('data-code')).toBe('47');
    press(document.activeElement!, 'PageUp');
    expect(document.activeElement?.getAttribute('data-code')).toBe('46');
  });
});
