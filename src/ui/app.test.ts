// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { makeTopology } from '../../test/helpers/makeTopology';
import { mountApp, type AppHandle } from './app';

const sample = loadSampleAreas(); // 30 和歌山県 (3 areas), 13 東京都 (2), 01 北海道 (1)
const prefs = [...new Map(sample.map((a) => [a.prefCode, a.prefName]))].map(([code, name]) => ({ code, name }));
const japanTopo = makeTopology('prefectures', prefs);
const prefTopo = (pp: string) =>
  makeTopology('areas', sample.filter((a) => a.prefCode === pp).map((a) => ({ code: a.code, name: a.name })));

interface Control {
  slow?: string;
  fail?: string;
  brokenNational?: boolean;
  failAll?: boolean;
}

function makeFetch(control: Control) {
  const pending = new Map<string, () => void>();
  const json = (data: unknown, status = 200) => ({ ok: status < 300, status, json: async () => data }) as unknown as Response;
  const fetchStub = vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (control.failAll) return Promise.resolve(json('', 500));
    const m = url.match(/pref\/(\d\d)\.topo\.json$/);
    if (m) {
      const pp = m[1];
      if (pp === control.fail) return Promise.resolve(json({}, 404));
      if (pp === control.slow) return new Promise<Response>((resolve) => pending.set(pp, () => resolve(json(prefTopo(pp)))));
      return Promise.resolve(json(prefTopo(pp)));
    }
    const a = url.match(/areas\/(\d\d)\.json$/);
    if (a) return Promise.resolve(json(sample.filter((x) => x.prefCode === a[1])));
    if (url.endsWith('groups.json')) {
      const groups: Record<string, string[]> = {};
      for (const x of sample) (groups[x.prefCode] ??= []).push(x.code);
      return Promise.resolve(json({ cities: {}, prefs: groups }));
    }
    if (url.endsWith('facilities.json')) return Promise.resolve(json(loadFacilities()));
    if (url.endsWith('japan.topo.json')) return Promise.resolve(json(control.brokenNational ? { objects: {} } : japanTopo));
    return Promise.resolve(json('not found', 404));
  });
  return { fetchStub: fetchStub as unknown as typeof fetch, pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await flush();
}

let handle: AppHandle | undefined;

async function mount(control: Control = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const { fetchStub, pending } = makeFetch(control);
  handle = await mountApp(root, { fetch: fetchStub, base: '/', prefGeoCache: new Map(), timeoutMs: 5000 });
  await settle();
  const overlay = root.querySelector<HTMLDivElement>('.map-overlay')!;
  const visibleHost = () => root.querySelector<HTMLDivElement>('.map-host:not([hidden])');
  const crumbs = () => root.querySelector('.crumbs')!.textContent!.replace(/\s+/g, '');
  return { root, pending, overlay, visibleHost, crumbs, store: handle!.store };
}

afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountApp shell', () => {
  test('renders the landmark, the four panel slots in order and the national map', async () => {
    const { root, visibleHost, crumbs } = await mount();
    expect(root.querySelector('main')).not.toBeNull();
    expect([...root.querySelectorAll('.panel')].map((p) => p.id)).toEqual(['panel-town', 'panel-controls', 'panel-allocation', 'panel-ai']);
    expect(root.querySelectorAll('.panel .panel-empty')).toHaveLength(4);
    expect(visibleHost()?.classList.contains('map-host-national')).toBe(true);
    expect(visibleHost()?.querySelectorAll('path.area')).toHaveLength(3);
    expect(crumbs()).toBe('日本');
  });

  test('the headline badge follows the year: census at 2020, official to 2050, estimate after', async () => {
    const { root, store } = await mount();
    const badge = () => root.querySelector('.map-headline-num span')!.textContent;
    store.set({ year: 2020 });
    expect(badge()).toBe('実績（国勢調査）');
    store.set({ year: 2050 });
    expect(badge()).toBe('公式推計');
    store.set({ year: 2055 });
    expect(badge()).toBe('試算');
    expect(root.querySelector('.map-headline-num span')!.className).toBe('badge-estimate');
  });
});

describe('map overlay lifecycle', () => {
  test('a prefecture that is still loading is dropped when a cached one is shown; its late arrival changes nothing', async () => {
    const { store, overlay, visibleHost, pending } = await mount({ slow: '01' });
    expect(store.set({ selectedPref: '30' })).toBe(true);
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();

    store.set({ selectedPref: '01' });
    await settle();
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('地図を読み込んでいます');

    store.set({ selectedPref: '30' }); // cached: must clear the overlay at once
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();

    pending.get('01')!(); // the slow load finishes after the user moved on
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();
    expect(visibleHost()?.querySelector('path.area[data-code="01101"]')).toBeNull();

    store.set({ selectedPref: '01' }); // now it is cached and shows without an overlay
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="01101"]')).not.toBeNull();
  });

  test('a failed load shows an error with retry; moving to a cached prefecture or to Japan clears it', async () => {
    const { store, overlay, visibleHost } = await mount({ fail: '13' });
    store.set({ selectedPref: '30' });
    await settle();
    store.set({ selectedPref: '13' });
    await settle();
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).toContain('読み込めませんでした');
    expect(overlay.querySelector('button')?.textContent).toBe('もう一度読み込む');

    store.set({ selectedPref: '30' });
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();

    store.set({ selectedPref: '13' });
    await settle();
    expect(overlay.hidden).toBe(false);
    store.set({ selectedPref: undefined });
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.classList.contains('map-host-national')).toBe(true);
  });

  test('a failed load, then a slow one, then a cached one leaves nothing on top of the map', async () => {
    const { store, overlay, visibleHost, pending } = await mount({ fail: '13', slow: '01' });
    store.set({ selectedPref: '30' });
    await settle();
    store.set({ selectedPref: '13' });
    await settle();
    expect(overlay.hidden).toBe(false);
    store.set({ selectedPref: '01' });
    await settle();
    expect(overlay.textContent).toContain('地図を読み込んでいます');
    store.set({ selectedPref: '30' });
    await settle();
    expect(overlay.hidden).toBe(true);
    pending.get('01')!();
    await settle();
    expect(overlay.hidden).toBe(true);
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();
  });
});

describe('selection through the shell', () => {
  test('selecting an area of another prefecture from a prefecture view moves the whole view', async () => {
    const { store, crumbs, root, visibleHost } = await mount();
    store.set({ selectedPref: '13' });
    await settle();
    expect(crumbs()).toBe('日本›東京都');
    expect(store.set({ selectedArea: '30206' })).toBe(true); // the way a panel would do it
    await settle();
    expect(store.get()).toMatchObject({ selectedPref: '30', selectedArea: '30206' });
    expect(crumbs()).toBe('日本›和歌山県›田辺市');
    expect(root.querySelector('.map-headline-name')!.textContent).toBe('田辺市');
    expect(root.querySelector<HTMLButtonElement>('.back')!.textContent).toBe('県全体へ戻る');
    expect(visibleHost()?.querySelector('path.area[data-code="30206"]')).not.toBeNull();
    expect(visibleHost()?.querySelector('.ring-selected')?.getAttribute('d')).not.toBe('');

    root.querySelector<HTMLButtonElement>('.back')!.click();
    await settle();
    expect(crumbs()).toBe('日本›和歌山県');
    root.querySelector<HTMLButtonElement>('.back')!.click();
    await settle();
    expect(crumbs()).toBe('日本');
    expect(visibleHost()?.classList.contains('map-host-national')).toBe(true);
  });

  test('an unknown code is rejected and the shell does not move', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { store, crumbs } = await mount();
    expect(store.set({ selectedArea: '99999' })).toBe(false);
    await settle();
    expect(crumbs()).toBe('日本');
    expect(warn).toHaveBeenCalled();
  });

  test('focus moves to the headline when the map is replaced', async () => {
    const { store, root } = await mount();
    store.set({ selectedPref: '30' });
    await settle();
    expect(document.activeElement).toBe(root.querySelector('.map-headline-name'));
  });
});

describe('startup failures', () => {
  test('a data load failure shows the Japanese error state with a retry button', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = document.createElement('div');
    document.body.append(root);
    const { fetchStub } = makeFetch({ failAll: true });
    const h = await mountApp(root, { fetch: fetchStub, base: '/', prefGeoCache: new Map() });
    expect(h).toBeUndefined();
    expect(root.textContent).toContain('データを読み込めませんでした');
    expect(root.querySelector('#retry')?.textContent).toBe('もう一度読み込む');
    expect(root.querySelector('.skeleton')).toBeNull();
    expect(errSpy).toHaveBeenCalled();
  });

  test('an exception while building the shell shows the same error state, not an eternal skeleton', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = document.createElement('div');
    document.body.append(root);
    const { fetchStub } = makeFetch({ brokenNational: true });
    const h = await mountApp(root, { fetch: fetchStub, base: '/', prefGeoCache: new Map() });
    expect(h).toBeUndefined();
    expect(root.textContent).toContain('データを読み込めませんでした');
    expect(root.querySelector('.skeleton')).toBeNull();
  });
});
