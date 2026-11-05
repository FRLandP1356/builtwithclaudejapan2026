// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { makeTopology } from '../../test/helpers/makeTopology';
import { allocationColor, changeColor, RATIO_MAX } from '../map/colors';
import { ALLOC_BADGE, ALLOC_CLEAR, mountApp, SKIP_TO_YEAR, sourceHtml, type AppHandle } from './app';
import { SOURCES } from './sources';
import { total } from '../engine/aggregate';
import { formatPct, formatPop } from './format';
import type { AllocationOverlay } from './state';

const sample = loadSampleAreas(); // 30 和歌山県 (3 areas), 13 東京都 (2), 01 北海道 (1)
const prefs = [...new Map(sample.map((a) => [a.prefCode, a.prefName]))].map(([code, name]) => ({ code, name }));
const japanTopo = makeTopology('prefectures', prefs);
const prefTopo = (pp: string) =>
  makeTopology('areas', sample.filter((a) => a.prefCode === pp).map((a) => ({ code: a.code, name: a.name })));

interface Control {
  slow?: string;
  fail?: string;
  /** A prefecture whose topology file is well-formed JSON but has no `areas` object. */
  broken?: string;
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
      if (pp === control.broken) return Promise.resolve(json({ type: 'Topology', objects: {}, arcs: [] }));
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
    expect(root.querySelectorAll('.panel .panel-empty')).toHaveLength(1); // all four panels are mounted; only the town panel's Japan-summary hint line remains
    expect(root.querySelectorAll('#panel-ai .ai-samples button')).toHaveLength(5);
    expect(visibleHost()?.classList.contains('map-host-national')).toBe(true);
    expect(visibleHost()?.querySelectorAll('path.area')).toHaveLength(3);
    expect(crumbs()).toBe('日本');
  });

  test('the headline badge follows the year: census at 2020, official to 2050, estimate after', async () => {
    const { root, store } = await mount();
    const badge = () => root.querySelector('.map-headline-num [class^="badge-"]')!.textContent;
    store.set({ year: 2020 });
    expect(badge()).toBe('実績（国勢調査）');
    store.set({ year: 2050 });
    expect(badge()).toBe('公式推計');
    store.set({ year: 2055 });
    expect(badge()).toBe('試算');
    expect(root.querySelector('.map-headline-num [class^="badge-"]')!.className).toBe('badge-estimate');
  });
});

describe('footer attribution', () => {
  test('each source is a label and a text that says it was processed, then its page as a link showing the URL, then the day it was read', async () => {
    const { root } = await mount();
    const entries = [...root.querySelectorAll('.app-foot dl dd')];
    expect([...root.querySelectorAll('.app-foot dl dt')].map((d) => d.textContent)).toEqual(['人口', '境界', '施設の目安']);
    expect(entries).toHaveLength(SOURCES.length);
    entries.forEach((dd, i) => {
      const src = SOURCES[i];
      expect(dd.querySelector('.src-text')!.textContent).toBe(src.text);
      const links = dd.querySelectorAll('a');
      expect(links).toHaveLength(1);
      expect(links[0].getAttribute('href')).toBe(src.url);
      expect(links[0].textContent).toBe(src.url); // the URL itself is the visible text
      expect(links[0].getAttribute('rel')).toBe('noopener');
      expect(links[0].getAttribute('target')).toBe('_blank');
      expect(dd.querySelector('.src-where')!.textContent).toBe(`${src.url} （2026年11月5日取得）`);
      expect(dd.querySelector('.src-where .keep:last-child')!.textContent).toBe('（2026年11月5日取得）'); // the date never breaks inside
    });
  });

  test('the 人口 line says the institute does not vouch for the app, as docs/sources.md and the README do', async () => {
    const { root } = await mount();
    const [population] = [...root.querySelectorAll('.app-foot dl dd')];
    expect(population.querySelector('.src-text')!.textContent).toBe(SOURCES[0].text);
    expect(population.querySelector('.src-text')!.textContent).toContain('を加工して作成（公共データ利用規約 第1.0版（PDL1.0））。社人研がこのアプリの内容を保証するものではありません');
    expect([...population.querySelectorAll('.src-text .keep')].at(-1)!.textContent).toBe('社人研がこのアプリの内容を保証するものではありません'); // its own phrase after the 。
  });

  test('the facility line says 加工して作成 and the boundary line keeps the approval number, last', async () => {
    const { root } = await mount();
    const [, boundary, facility] = [...root.querySelectorAll('.app-foot dl dd')];
    expect(facility.textContent).toContain('国土交通省国土政策局「サービス施設の立地する確率が50%・80%となる自治体の人口規模（三大都市圏を除く）」（2009〜2012年の統計）を加工して作成');
    expect(facility.querySelector('.src-approval')).toBeNull();
    expect(boundary.querySelector('.src-approval')!.textContent).toBe('測量法に基づく国土地理院長承認（複製）R2JHf 450');
    expect([...boundary.querySelectorAll('.src-approval .keep')].map((k) => k.textContent)).toEqual(['測量法に基づく国土地理院長承認', '（複製）R2JHf 450']); // 「R2JHf 450」 stays together
    expect(boundary.lastElementChild).toBe(boundary.querySelector('.src-approval'));
    expect(root.querySelectorAll('.app-foot .src-approval')).toHaveLength(1);
    expect(root.querySelector('.app-foot')!.textContent).not.toContain('予測');
  });

  test('sourceHtml escapes what it prints, so a stray character cannot add markup', () => {
    const html = sourceHtml({ label: 'a<b', text: 'x & "y"', url: 'https://e.test/?a=1&b="2"', retrieved: '2026年1月1日', approval: '<i>' });
    const box = document.createElement('dl');
    box.innerHTML = html;
    expect(box.querySelectorAll('i, b')).toHaveLength(0);
    expect(box.querySelector('a')!.getAttribute('href')).toBe('https://e.test/?a=1&b="2"');
    expect(box.querySelector('a')!.textContent).toBe('https://e.test/?a=1&b="2"'); // the visible URL is escaped too
    const hostile = document.createElement('dl');
    hostile.innerHTML = sourceHtml({ label: 'l', text: 't', url: 'https://e.test/<i>x</i>', retrieved: '2026年1月1日' });
    expect(hostile.querySelectorAll('i')).toHaveLength(0);
    expect(hostile.querySelector('a')!.textContent).toBe('https://e.test/<i>x</i>');
    expect(box.querySelector('.src-text')!.textContent).toBe('x & "y"');
    expect(box.querySelector('.src-approval')!.textContent).toBe('<i>');
  });
});

describe('keyboard order through the map', () => {
  const tabStops = (host: Element | null) =>
    [...(host?.querySelectorAll('[tabindex]') ?? [])].filter((e) => Number(e.getAttribute('tabindex')) >= 0);

  test('the visible map is a single Tab stop, on the national map and on a prefecture', async () => {
    const { root, visibleHost, store } = await mount();
    expect(visibleHost()?.querySelectorAll('path.area')).toHaveLength(3);
    expect(tabStops(visibleHost())).toHaveLength(1);
    expect(tabStops(visibleHost())[0].getAttribute('data-code')).toBe(visibleHost()!.querySelector('path.area')!.getAttribute('data-code'));
    store.set({ selectedPref: '30' });
    await settle();
    expect(visibleHost()?.querySelectorAll('path.area')).toHaveLength(3);
    expect(tabStops(visibleHost())).toHaveLength(1);
    // From the search box on, the only stops before the year slider are the skip link and that one area.
    const between = [...root.querySelectorAll('.map-stage a[href], .map-stage [tabindex]')].filter(
      (e) => !e.closest('[hidden]') && Number(e.getAttribute('tabindex') ?? 0) >= 0,
    );
    expect(between.map((e) => e.getAttribute('data-code') ?? e.className)).toEqual(['skip-link', visibleHost()!.querySelector('path.area')!.getAttribute('data-code')]);
  });

  test('the selected town is the map\'s Tab stop; selecting by keyboard (Enter) still selects', async () => {
    const { visibleHost, store } = await mount();
    store.set({ selectedPref: '30' });
    await settle();
    store.set({ selectedArea: '30206' });
    expect(tabStops(visibleHost()).map((e) => e.getAttribute('data-code'))).toEqual(['30206']);
    const other = visibleHost()!.querySelector<SVGPathElement>('path.area:not([data-code="30206"])')!;
    other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(store.get().selectedArea).toBe(other.getAttribute('data-code'));
    expect(tabStops(visibleHost()).map((e) => e.getAttribute('data-code'))).toEqual([other.getAttribute('data-code')]);
  });

  test('a skip link at the start of the map moves focus to the year slider', async () => {
    const { root } = await mount();
    const stage = root.querySelector('.map-stage')!;
    const link = stage.querySelector<HTMLAnchorElement>('.skip-link')!;
    expect(link.textContent).toBe(SKIP_TO_YEAR);
    expect(SKIP_TO_YEAR).toBe('地図をとばして、年の選択へ');
    expect(stage.firstElementChild).toBe(link); // before every map area in Tab order
    const range = root.querySelector<HTMLInputElement>('#year-range')!;
    expect(link.getAttribute('href')).toBe(`#${range.id}`);
    expect(link.compareDocumentPosition(range) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(link.compareDocumentPosition(stage.querySelector('path.area')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    link.focus();
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true); // the address bar does not change
    expect(document.activeElement).toBe(range);
  });

  test('the skip link is still there on a prefecture map', async () => {
    const { root, store } = await mount();
    store.set({ selectedPref: '30' });
    await settle();
    const link = root.querySelector<HTMLAnchorElement>('.map-stage .skip-link')!;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(root.querySelector('#year-range'));
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

  test('loading and error states keep <main> a plain landmark with the live region inside it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const root = document.createElement('div');
    document.body.append(root);
    const { fetchStub } = makeFetch({ failAll: true });
    const pending = mountApp(root, { fetch: fetchStub, base: '/', prefGeoCache: new Map() });
    const mainWhileLoading = root.querySelector('main')!;
    expect(mainWhileLoading.getAttribute('role')).toBeNull();
    expect(mainWhileLoading.querySelector('[role="status"]')).not.toBeNull();
    await pending;
    const mainAfter = root.querySelector('main')!;
    expect(mainAfter.getAttribute('role')).toBeNull();
    expect(mainAfter.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('Task 8 leftovers', () => {
  test('a malformed prefecture topology shows the error overlay with retry, not the loading text forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, overlay, visibleHost } = await mount({ broken: '13' });
    store.set({ selectedPref: '13' });
    await settle();
    expect(overlay.hidden).toBe(false);
    expect(overlay.textContent).not.toContain('地図を読み込んでいます');
    expect(overlay.querySelector('button')?.textContent).toBe('もう一度読み込む');
    expect(visibleHost()?.classList.contains('map-host-national')).toBe(true);
    expect(store.get().selectedPref).toBe('13');
    expect([...overlay.parentElement!.querySelectorAll('.map-host')]).toHaveLength(1); // the half-built host was removed
    store.set({ selectedPref: '30' });
    await settle();
    expect(overlay.hidden).toBe(true);
  });

  test('the headline is not a live region; the place status is announced once per selection change', async () => {
    const { root, store } = await mount();
    expect(root.querySelector('.map-headline')!.getAttribute('aria-live')).toBeNull();
    const status = root.querySelector('.place-status')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.textContent).toBe('');
    store.set({ selectedPref: '30' });
    await settle();
    const first = status.textContent;
    expect(first).toContain('和歌山県');
    store.set({ year: 2055 });
    store.set({ year: 2060 });
    expect(status.textContent).toBe(first); // year changes do not re-announce
    store.set({ selectedArea: '30206' });
    expect(status.textContent).toContain('田辺市');
  });

  test('switching maps drops the hover state of the map that goes away', async () => {
    const { root, store } = await mount();
    const nationalSvg = root.querySelector('.map-host-national svg')!;
    const path = nationalSvg.querySelector('path.area[data-code="30"]')!;
    path.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const tip = root.querySelector('.map-host-national .map-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    expect(nationalSvg.querySelector('.ring-hover')!.getAttribute('d')).not.toBe('');
    store.set({ selectedPref: '30' });
    await settle();
    expect(tip.hidden).toBe(true);
    expect(nationalSvg.querySelector('.ring-hover')!.getAttribute('d')).toBe('');
  });

  test('destroy() tears the hover state down: the tooltip goes, and a late pointer event does nothing', async () => {
    const { root, store } = await mount();
    const nationalSvg = root.querySelector('.map-host-national svg')!;
    const path = nationalSvg.querySelector('path.area[data-code="30"]')!;
    path.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const tip = root.querySelector('.map-host-national .map-tip') as HTMLElement;
    expect(tip.hidden).toBe(false);
    const get = vi.spyOn(store, 'get');
    handle!.destroy();
    handle = undefined;
    expect(tip.isConnected).toBe(false);
    path.dispatchEvent(new Event('pointerover', { bubbles: true })); // e.g. a pointer still over the old SVG
    nationalSvg.querySelector('path.area[data-code="13"]')!.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(get).not.toHaveBeenCalled(); // no tooltip was computed for the torn-down map
  });

  test('focus moves to the headline without scrolling', async () => {
    const { store, root } = await mount();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    store.set({ selectedPref: '30' });
    await settle();
    const head = root.querySelector('.map-headline-name');
    expect(document.activeElement).toBe(head);
    const onHead = focus.mock.contexts.map((c, i) => [c, focus.mock.calls[i]![0]] as const).filter(([c]) => c === head);
    expect(onHead.length).toBeGreaterThan(0);
    for (const [, arg] of onHead) expect(arg).toEqual({ preventScroll: true });
    focus.mockRestore();
  });
});

describe('allocation overlay on the map', () => {
  const overlay = (patch: Partial<AllocationOverlay> = {}): AllocationOverlay => ({
    year: 2100,
    label: '和歌山県 +10%',
    changePercent: { '30206': 10, '30201': 10, '30427': 10, '13101': -0.04, '13402': -0.04, '01101': -0.04 },
    flips: [{ facilityId: 'grocery', name: '飲食料品小売業', gained: ['30206'], lost: ['13402'] }],
    ...patch,
  });

  test('recolours the national map in place (same elements), switches the legend and the headline badge', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100 });
    const svg = root.querySelector('.map-host-national svg')!;
    const before = [...svg.querySelectorAll('path.area')];
    const wakayama = svg.querySelector('path.area[data-code="30"]')!;
    const ratioFill = wakayama.getAttribute('fill');
    expect(store.set({ allocation: overlay() })).toBe(true);
    const after = [...svg.querySelectorAll('path.area')];
    expect(after).toEqual(before); // no DOM rebuild
    expect(wakayama.getAttribute('fill')).toBe(allocationColor(10, 10));
    expect(wakayama.getAttribute('fill')).toBe(changeColor(RATIO_MAX));
    expect(wakayama.getAttribute('fill')).not.toBe(ratioFill);
    const legend = root.querySelector('.legend')!;
    expect(legend.textContent).toContain('割り振りによる人口の変化（%）');
    expect([...legend.querySelectorAll('.legend-tick')].map((t) => t.textContent)).toEqual(['−10%', '−5%', '0', '+5%', '+10%']);
    // 2100 keeps its 試算 mark; the allocation adds its own mark next to it.
    expect(root.querySelector('.map-headline-num .badge-estimate')!.textContent).toBe('試算');
    expect(root.querySelector('.map-headline-num .badge-alloc')!.textContent).toBe(ALLOC_BADGE);
    const bar = root.querySelector<HTMLElement>('.alloc-bar')!;
    expect(bar.hidden).toBe(false);
    expect(bar.textContent).toContain('和歌山県 +10%');
    expect(root.querySelector<HTMLElement>('.alloc-bar-stale')!.hidden).toBe(true);
    expect(wakayama.getAttribute('aria-label')).toContain('割り振りによる変化 +10.0%');
  });

  test('the headline, the tooltip and the label show the population after the allocation, with both marks', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100, selectedPref: '30' });
    await settle();
    const series = store.get().series;
    const codes = sample.filter((a) => a.prefCode === '30').map((a) => a.code);
    const before2100 = codes.reduce((t, c) => t + total(series.get(c)![2100]), 0);
    const base2020 = codes.reduce((t, c) => t + total(series.get(c)![2020]), 0);
    const after = before2100 * 1.1; // every Wakayama area is at +10% in this overlay
    expect(root.querySelector('.map-headline-num b')!.textContent).toBe(formatPop(before2100));
    store.set({ allocation: overlay() });
    const num = root.querySelector('.map-headline-num')!;
    expect(num.querySelector('b')!.textContent).toBe(formatPop(after));
    expect(num.textContent).toContain(`${formatPop(after)}（割り振り前 ${formatPop(before2100)}）`); // both numbers in sight
    expect(num.textContent).toContain(`2020年比 ${formatPct(after / base2020)}`);
    expect(num.querySelector('.badge-estimate')!.textContent).toBe('試算');
    expect(num.querySelector('.badge-alloc')!.textContent).toBe(ALLOC_BADGE);

    // An area: its own population times 1.1, in the label and in the tooltip, with the change line.
    const prefSvg = root.querySelector('.map-host:not([hidden]) svg')!;
    const tanabe = prefSvg.querySelector('path.area[data-code="30206"]')!;
    const tanabeBefore = formatPop(total(series.get('30206')![2100]));
    const tanabeAfter = formatPop(total(series.get('30206')![2100]) * 1.1);
    expect(tanabe.getAttribute('aria-label')).toContain(`2100年 ${tanabeAfter}（割り振り前 ${tanabeBefore}）`);
    expect(tanabe.getAttribute('aria-label')).toContain('（このアプリの試算）（割り振り後）');
    tanabe.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const tip = root.querySelector<HTMLElement>('.map-host:not([hidden]) .map-tip')!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toContain(`2100年 ${tanabeAfter}（割り振り前 ${tanabeBefore}）`);
    expect(tip.textContent).toContain('割り振りによる変化 +10.0%');
    expect(tip.querySelector('.badge-estimate')!.textContent).toBe('試算');
    expect(tip.querySelector('.badge-alloc')!.textContent).toBe(ALLOC_BADGE);
  });

  test('up to 2050 an allocation is no longer the official figure: 割り振り後 with its basis replaces 公式推計 where the figure changes', async () => {
    const { root, store } = await mount();
    const num = () => root.querySelector('.map-headline-num')!;
    store.set({ year: 2050, selectedPref: '30' });
    await settle();
    expect(num().querySelector('.badge-official')!.textContent).toBe('公式推計');
    expect(num().querySelector('.badge-alloc')).toBeNull();
    expect(num().querySelector('.head-basis')).toBeNull();

    store.set({ allocation: overlay({ year: 2050 }) }); // 和歌山県: three towns +10%
    expect(num().querySelector('.badge-official')).toBeNull();
    expect(num().querySelector('.badge-estimate')).toBeNull();
    expect(num().querySelector('.badge-alloc')!.textContent).toBe(ALLOC_BADGE);
    expect(num().querySelector('.head-basis')!.textContent).toBe('公式推計をもとにこのアプリが計算');
    expect(num().textContent).not.toContain('公式推計 割り振り後');

    store.set({ year: 2055 }); // the overlay is for 2050: at 2055 the numbers are not allocated, and 2055 is an estimate
    expect(num().querySelector('.badge-estimate')!.textContent).toBe('試算');
    expect(num().querySelector('.badge-alloc')).toBeNull();

    store.set({ year: 2050 });
    expect(num().querySelector('.badge-official')).toBeNull();
    store.set({ allocation: undefined });
    expect(num().querySelector('.badge-official')!.textContent).toBe('公式推計');
    expect(num().querySelector('.head-basis')).toBeNull();
  });

  test('where the allocation cannot change the figure (the whole country, or a place at 0 %) the original mark stays', async () => {
    const { root, store } = await mount();
    const num = () => root.querySelector('.map-headline-num')!;
    store.set({ year: 2050 });
    // A zero-sum allocation (as the allocation panel makes it): 和歌山県の田辺市 +10 %, the other towns give the same people up.
    const at2050 = (code: string) => total(store.get().series.get(code)![2050]);
    const taken = (at2050('30206') * 10) / 100;
    const others = ['13101', '13402', '01101'];
    const give = -(taken / others.reduce((t, c) => t + at2050(c), 0)) * 100;
    const zeroSum = (patch: Partial<AllocationOverlay> = {}) =>
      overlay({ year: 2050, changePercent: { '30206': 10, '30201': 0, '30427': 0, ...Object.fromEntries(others.map((c) => [c, give])) }, ...patch });
    store.set({ allocation: zeroSum() }); // Japan: the total of a zero-sum allocation
    expect(num().querySelector('.badge-official')!.textContent).toBe('公式推計');
    expect(num().querySelector('.head-basis')).toBeNull();
    expect(num().textContent).not.toContain('このアプリが計算');
    expect(num().textContent).not.toContain('割り振り前'); // the same total: no second number either

    // 東京都 changes by a real amount: the official mark gives way
    store.set({ selectedPref: '13' });
    await settle();
    expect(num().querySelector('.badge-official')).toBeNull();
    expect(num().querySelector('.head-basis')!.textContent).toBe('公式推計をもとにこのアプリが計算');

    // 北海道 has a change of 0: its figure is the unallocated one
    store.set({ allocation: zeroSum({ changePercent: { '30206': 10, '01101': 0 } }), selectedPref: '01' });
    await settle();
    expect(num().querySelector('.badge-official')!.textContent).toBe('公式推計');
    expect(num().querySelector('.head-basis')).toBeNull();
  });

  test('after 2050 the headline keeps 試算 and adds 割り振り後, with no basis note', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100, allocation: overlay() });
    const num = root.querySelector('.map-headline-num')!;
    expect(num.querySelector('.badge-estimate')!.textContent).toBe('試算');
    expect(num.querySelector('.badge-alloc')!.textContent).toBe(ALLOC_BADGE);
    expect(num.querySelector('.head-basis')).toBeNull();
    expect(num.querySelector('.badge-official')).toBeNull();
  });

  test('an allocation shown for another year up to 2050 leaves the official mark alone', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100, allocation: overlay() });
    store.set({ year: 2040 });
    const num = root.querySelector('.map-headline-num')!;
    expect(num.querySelector('.badge-official')!.textContent).toBe('公式推計');
    expect(num.querySelector('.badge-alloc')).toBeNull();
    expect(num.querySelector('.head-basis')).toBeNull();
  });

  test('the 2020 census year with an allocation says it is based on the census', async () => {
    const { root, store } = await mount();
    store.set({ year: 2020, selectedPref: '30', allocation: overlay({ year: 2020 }) });
    await settle();
    const num = root.querySelector('.map-headline-num')!;
    expect(num.querySelector('.badge-official')).toBeNull();
    expect(num.querySelector('.head-basis')!.textContent).toBe('国勢調査をもとにこのアプリが計算');
    expect(num.textContent).not.toContain('実績（国勢調査）');
  });

  test('an allocation for another year leaves the numbers as they are and drops the 割り振り後 mark', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100, selectedPref: '30' });
    await settle();
    store.set({ allocation: overlay() });
    store.set({ year: 2080 });
    const series = store.get().series;
    const codes = sample.filter((a) => a.prefCode === '30').map((a) => a.code);
    expect(root.querySelector('.map-headline-num b')!.textContent).toBe(formatPop(codes.reduce((t, c) => t + total(series.get(c)![2080]), 0)));
    expect(root.querySelector('.map-headline-num .badge-alloc')).toBeNull();
    expect(root.querySelector('.map-headline-num')!.textContent).not.toContain('割り振り前');
    const tanabe = root.querySelector('.map-host:not([hidden]) svg path.area[data-code="30206"]')!;
    expect(tanabe.getAttribute('aria-label')).toContain('割り振りによる変化 +10.0%（2100年の計算）');
    expect(tanabe.getAttribute('aria-label')).not.toContain('（割り振り後）');
  });

  test('a year change keeps the overlay and shows a quiet stale note', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100 });
    store.set({ allocation: overlay() });
    store.set({ year: 2080 });
    expect(store.get().allocation).toBeDefined();
    const stale = root.querySelector<HTMLElement>('.alloc-bar-stale')!;
    expect(stale.hidden).toBe(false);
    expect(stale.textContent).toBe('この割り振りは2100年の計算です');
    store.set({ year: 2100 });
    expect(stale.hidden).toBe(true);
  });

  test('the clear button and Escape remove the overlay and restore the ratio colouring', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100 });
    const svg = root.querySelector('.map-host-national svg')!;
    const wakayama = svg.querySelector('path.area[data-code="30"]')!;
    const ratioFill = wakayama.getAttribute('fill');
    store.set({ allocation: overlay() });
    const clear = root.querySelector<HTMLButtonElement>('.alloc-clear')!;
    expect(clear.textContent).toBe(ALLOC_CLEAR);
    clear.focus(); // as a keyboard user who tabbed to it
    clear.click();
    expect(store.get().allocation).toBeUndefined();
    expect(wakayama.getAttribute('fill')).toBe(ratioFill);
    expect(root.querySelector('.legend')!.textContent).toContain('2020年の人口との比');
    expect(root.querySelector<HTMLElement>('.alloc-bar')!.hidden).toBe(true);
    expect(root.querySelector('.map-headline-num [class^="badge-"]')!.textContent).toBe('試算');
    expect(root.querySelector('.map-headline-num .badge-alloc')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('.map-headline-name')); // focus does not stay on a hidden button

    store.set({ allocation: overlay() });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(store.get().allocation).toBeUndefined();

    // Escape inside a text field is left to the field
    store.set({ allocation: overlay() });
    const input = root.querySelector<HTMLInputElement>('.search-input')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(store.get().allocation).toBeDefined();
  });

  describe('Escape', () => {
    const esc = (el: Element, init: KeyboardEventInit = {}) => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(ev);
      return ev;
    };

    test('clears the overlay from a focused range slider and from a focused checkbox', async () => {
      const { root, store } = await mount();
      const range = root.querySelector<HTMLInputElement>('#year-range')!;
      expect(range.type).toBe('range');
      range.focus();
      store.set({ year: 2100, allocation: overlay() });
      esc(range);
      expect(store.get().allocation).toBeUndefined();

      const box = root.querySelector<HTMLInputElement>('#panel-allocation input[type="checkbox"]')!;
      expect(box).not.toBeNull();
      box.focus();
      store.set({ allocation: overlay() });
      esc(box);
      expect(store.get().allocation).toBeUndefined();

      const ctlRange = root.querySelector<HTMLInputElement>('#panel-controls input[type="range"]')!;
      store.set({ allocation: overlay() });
      esc(ctlRange);
      expect(store.get().allocation).toBeUndefined();
    });

    test('also from a radio button, a plain button and the page itself', async () => {
      const { root, store } = await mount();
      store.set({ year: 2100 });
      for (const type of ['radio', 'button', 'submit', 'reset', 'image', 'file', 'color']) {
        const input = document.createElement('input');
        input.type = type;
        root.append(input);
        store.set({ allocation: overlay() });
        esc(input);
        expect(store.get().allocation, `input type=${type}`).toBeUndefined();
      }
      store.set({ allocation: overlay() });
      esc(root.querySelector('.back, .btn')!);
      expect(store.get().allocation).toBeUndefined();
      store.set({ allocation: overlay() });
      esc(document.body);
      expect(store.get().allocation).toBeUndefined();
    });

    test('is left to a text field, a search box, a textarea, a select and an editable region', async () => {
      const { root, store } = await mount();
      store.set({ year: 2100, allocation: overlay() });
      const owners: HTMLElement[] = [root.querySelector<HTMLElement>('.search-input')!, root.querySelector<HTMLElement>('#panel-ai textarea')!];
      for (const type of ['text', 'search', 'number', 'email', 'url', 'tel', 'password']) {
        const input = document.createElement('input');
        input.type = type;
        owners.push(input);
      }
      owners.push(document.createElement('select'));
      const editable = document.createElement('div');
      Object.defineProperty(editable, 'isContentEditable', { value: true }); // jsdom does not compute it from the attribute
      owners.push(editable);
      for (const el of owners) {
        root.append(el);
        esc(el);
        expect(store.get().allocation, el.outerHTML.slice(0, 40)).toBeDefined();
      }
    });

    test('is left to an open dialog, and to anything that already handled the key', async () => {
      const { root, store } = await mount();
      store.set({ year: 2100, allocation: overlay() });
      const range = root.querySelector<HTMLInputElement>('#year-range')!;
      const handled = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      range.addEventListener('keydown', (e) => e.preventDefault(), { once: true });
      range.dispatchEvent(handled);
      expect(store.get().allocation).toBeDefined();

      const dialog = document.createElement('dialog');
      dialog.setAttribute('open', '');
      document.body.append(dialog);
      esc(range);
      expect(store.get().allocation).toBeDefined();
      dialog.remove();
      esc(range);
      expect(store.get().allocation).toBeUndefined();
    });

    test('other keys do nothing, and Escape with no overlay is harmless', async () => {
      const { root, store } = await mount();
      const range = root.querySelector<HTMLInputElement>('#year-range')!;
      store.set({ year: 2100, allocation: overlay() });
      range.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      range.dispatchEvent(new KeyboardEvent('keydown', { key: 'Esc', bubbles: true }));
      expect(store.get().allocation).toBeDefined();
      store.set({ allocation: undefined });
      expect(() => esc(range)).not.toThrow();
    });
  });

  test('a focused facility draws count markers on the national view and rings in the prefecture view', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100 });
    store.set({ allocation: overlay({ focusFacilityId: 'grocery' }) });
    const svg = root.querySelector('.map-host-national svg')!;
    const markers = [...svg.querySelectorAll('.marker')];
    expect(markers.map((m) => m.textContent)).toEqual(['+1', '−1']);
    expect(markers[0].classList.contains('marker-gain')).toBe(true);
    expect(markers[1].classList.contains('marker-loss')).toBe(true);
    const wakayama = svg.querySelector('path.area[data-code="30"]')!;
    expect(wakayama.getAttribute('aria-label')).toMatch(/飲食料品小売業：目安以上になる町 \+1(、|$)/);
    expect(wakayama.getAttribute('aria-label')).not.toContain('下回る町'); // no towns fell: nothing is said about them
    const tokyo = svg.querySelector('path.area[data-code="13"]')!;
    expect(tokyo.getAttribute('aria-label')).toContain('飲食料品小売業：目安を下回る町 −1');
    expect(tokyo.getAttribute('aria-label')).not.toContain('以上になる町');
    for (const a of [wakayama, tokyo]) expect(a.getAttribute('aria-label')).not.toMatch(/[+−]0(?![.\d])/);
    wakayama.dispatchEvent(new Event('pointerover', { bubbles: true }));
    const tipText = svg.parentElement!.querySelector('.map-tip')!.textContent!;
    expect(tipText).toContain('目安以上になる町 +1');
    expect(tipText).not.toMatch(/[+−]0(?![.\d])/);
    expect(markers.map((m) => m.getAttribute('data-for'))).toEqual(['30', '13']);
    expect(svg.querySelector('.markers')!.getAttribute('aria-hidden')).toBe('true'); // the numbers are in the labels

    store.set({ selectedPref: '30' });
    await settle();
    const prefSvg = root.querySelector('.map-host:not([hidden]) svg')!;
    const gain = prefSvg.querySelector('.ring-gain')!.getAttribute('d')!;
    expect(gain).toBe(prefSvg.querySelector('path.area[data-code="30206"]')!.getAttribute('d'));
    expect(prefSvg.querySelector('.ring-loss')!.getAttribute('d')).toBe('');
    expect(prefSvg.querySelectorAll('.marker')).toHaveLength(0);
    expect(prefSvg.querySelector('path.area[data-code="30206"]')!.getAttribute('aria-label')).toContain('飲食料品小売業が目安以上になる（増えた）');

    store.set({ selectedPref: '13' });
    await settle();
    const tokyoSvg = root.querySelector('.map-host:not([hidden]) svg')!;
    expect(tokyoSvg.querySelector('.ring-loss')!.getAttribute('d')).toBe(tokyoSvg.querySelector('path.area[data-code="13402"]')!.getAttribute('d'));
    expect(tokyoSvg.querySelector('path.area[data-code="13402"]')!.getAttribute('aria-label')).toContain('下回る（減った）');

    store.set({ allocation: undefined });
    expect(tokyoSvg.querySelector('.ring-loss')!.getAttribute('d')).toBe('');
    expect(svg.querySelectorAll('.marker')).toHaveLength(0);
  });

  test('while the allocation panel draws on the map, a year or scenario change ends with its new overlay everywhere', async () => {
    const { root, store } = await mount();
    root.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.click();
    expect(store.get().allocation?.year).toBe(store.get().year);
    const stale = root.querySelector<HTMLElement>('.alloc-bar-stale')!;
    const legend = root.querySelector<HTMLElement>('.legend')!;

    store.set({ year: 2100 }); // the panel recomputes inside its subscriber; the shell must not end on the old overlay
    expect(store.get().allocation?.year).toBe(2100);
    expect(stale.hidden).toBe(true);
    expect(legend.dataset.mode).toBe('allocation');

    store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    expect(store.get().allocation).toBeDefined(); // cleared by the store, drawn again by the panel
    expect(root.querySelector<HTMLElement>('.alloc-bar')!.hidden).toBe(false);
    expect(legend.dataset.mode).toBe('allocation');
    expect(root.querySelector('.map-headline-num .badge-alloc')).not.toBeNull();
  });

  test('count markers keep their screen size: on a map drawn at half its viewBox width they are scaled by 2', async () => {
    const { root, store } = await mount();
    const svg = root.querySelector<SVGSVGElement>('.map-host-national svg')!;
    const vbWidth = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ width: vbWidth / 2, height: 10_000 } as DOMRect);
    store.set({ year: 2100, allocation: overlay({ focusFacilityId: 'grocery' }) });
    const marker = svg.querySelector('.marker')!;
    expect(marker.getAttribute('transform')).toMatch(/^translate\(-?[\d.]+,-?[\d.]+\) scale\(2\.000\)$/);
    const rect = marker.querySelector('rect')!;
    expect(Number(rect.getAttribute('height'))).toBe(18); // screen pixels once scaled
  });

  test('a scenario change clears the overlay from the map', async () => {
    const { root, store } = await mount();
    store.set({ year: 2100, allocation: overlay() });
    store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    expect(store.get().allocation).toBeUndefined();
    expect(root.querySelector<HTMLElement>('.alloc-bar')!.hidden).toBe(true);
    expect(root.querySelector('.legend')!.textContent).toContain('2020年の人口との比');
  });
});
