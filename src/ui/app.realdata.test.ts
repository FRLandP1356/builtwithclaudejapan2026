// @vitest-environment jsdom
// The whole app on the real data files (public/data, served from disk): the allocation panel's 「地図に反映する」 with
// 和歌山県 +10% in 2100 must show on the real maps what the brief asks for.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import { mountApp, type AppHandle } from './app';

const diskFetch = (async (input: string | URL | Request) => {
  const path = String(input).replace(/^\//, '');
  try {
    const body = readFileSync(repoPath(`public/${path}`), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) } as unknown as Response;
  } catch {
    return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
  }
}) as typeof fetch;

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await flush();
}

let handle: AppHandle;
let root: HTMLElement;

beforeAll(async () => {
  root = document.createElement('div');
  document.body.append(root);
  handle = (await mountApp(root, { fetch: diskFetch, base: '/', prefGeoCache: new Map(), timeoutMs: 20_000 }))!;
  await settle();
}, 60_000);

afterAll(() => {
  handle?.destroy();
  document.body.replaceChildren();
});

const label = (scope: Element, code: string) => scope.querySelector(`path.area[data-code="${code}"]`)!.getAttribute('aria-label')!;

describe('和歌山県 +10% in 2100 on the real maps', () => {
  test('the national view: 和歌山県 +10.0%, every other prefecture −0.04%, with the allocation legend', () => {
    handle.store.set({ year: 2100 });
    expect(root.querySelector<HTMLSelectElement>('#alloc-target')!.value).toBe('pref:30');
    root.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.click();
    expect(handle.store.get().allocation?.label).toBe('和歌山県 +10%');
    const svg = root.querySelector('.map-host-national svg')!;
    expect(svg.querySelectorAll('path.area')).toHaveLength(47);
    expect(label(svg, '30')).toContain('割り振りによる変化 +10.0%');
    for (const pp of ['01', '13', '27', '47']) expect(label(svg, pp)).toContain('割り振りによる変化 −0.04%');
    expect(root.querySelector('.legend')!.textContent).toContain('割り振りによる人口の変化（%）');
  });

  test('pressing 飲食料品小売業 marks 和歌山県 with +1 on the national map and rings 高野町 (30344) in the prefecture view', async () => {
    const name = [...root.querySelectorAll<HTMLButtonElement>('#panel-allocation .alloc-focus')].find((b) => b.textContent === '飲食料品小売業')!;
    name.click();
    expect(handle.store.get().allocation?.focusFacilityId).toBe('grocery');
    const svg = root.querySelector('.map-host-national svg')!;
    const marker = svg.querySelector('.marker[data-for="30"]')!;
    expect(marker.textContent).toBe('+1');
    expect(label(svg, '30')).toContain('飲食料品小売業：目安を上回る町 +1、下回る町 −0');

    handle.store.set({ selectedPref: '30' });
    await settle();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('.ring-gain')!.getAttribute('d')).toBe(pref.querySelector('path.area[data-code="30344"]')!.getAttribute('d'));
    expect(label(pref, '30344')).toContain('高野町');
    expect(label(pref, '30344')).toContain('飲食料品小売業が目安を上回る（増えた）');
    expect(label(pref, '30344')).toContain('割り振りによる変化 +10.0%');
  }, 30_000);

  test('the clear button takes it all away', () => {
    root.querySelector<HTMLButtonElement>('.alloc-clear')!.click();
    expect(handle.store.get().allocation).toBeUndefined();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('.ring-gain')!.getAttribute('d')).toBe('');
    expect(label(pref, '30344')).not.toContain('割り振り');
    expect(root.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.getAttribute('aria-pressed')).toBe('false');
  });
});
