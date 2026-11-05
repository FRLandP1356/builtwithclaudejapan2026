// @vitest-environment jsdom
// The real geometry (the national map and all 47 prefecture maps, as the app mounts them): with one Tab stop for the
// map, every area must still be reachable from the keyboard. The arrows alone are not enough (札幌市南区 on the 北海道
// map has no area for which it is the nearest in any direction), so PageUp/PageDown walk the Tab order.
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
const WITH_PAGES = [...ARROWS, 'PageUp', 'PageDown'] as const;

describe('real maps: every area can be reached from the keyboard', () => {
  test('the data is there: the national map and 47 prefecture maps', () => {
    expect(prefFiles).toHaveLength(47);
  });

  test('national map: all 47 prefectures from the first by arrows, PageUp and PageDown', () => {
    const { paths } = mountReal('national', 'public/data/geo/japan.topo.json');
    expect(paths).toHaveLength(47);
    expect(reach(paths, WITH_PAGES).size).toBe(47);
  });

  test('every prefecture map: all areas from the first by arrows, PageUp and PageDown; PageDown alone walks the Tab order', () => {
    let total = 0;
    for (const file of prefFiles) {
      const { paths } = mountReal('pref', `${PREF_DIR}/${file}`);
      const codes = paths.map((p) => p.getAttribute('data-code')!);
      expect(new Set(codes).size, file).toBe(codes.length);
      total += codes.length;
      const reached = reach(paths, WITH_PAGES);
      expect([...new Set(codes)].filter((c) => !reached.has(c)), `${file}: not reachable`).toEqual([]);
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

  test('the 札幌市南区 case: the arrows alone do not reach it on the 北海道 map, the page keys do', () => {
    const { paths } = mountReal('pref', `${PREF_DIR}/01.topo.json`);
    const minami = '01106';
    expect(paths.some((p) => p.getAttribute('data-code') === minami)).toBe(true);
    expect(reach(paths, ARROWS).has(minami)).toBe(false);
    expect(reach(paths, WITH_PAGES).has(minami)).toBe(true);
  });
});
