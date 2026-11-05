// @vitest-environment jsdom
// The whole app on the real data files (public/data, served from disk): the allocation panel's 「地図に反映する」 with
// 和歌山県 +10% in 2100 must show on the real maps what the brief asks for.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import { buildOverlay } from './allocationOverlay';
import { computeAllocation, populationAt } from './allocationPanel';
import { total } from '../engine/aggregate';
import { mountApp, type AppHandle } from './app';
import { formatPop } from './format';

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
    // the country's total does not change: no second number in the headline, no note in the town panel
    expect(root.querySelector('.map-headline')!.textContent).not.toContain('割り振り前');
    expect(root.querySelector<HTMLElement>('#panel-town .town-alloc-note')!.hidden).toBe(true);
  });

  test('pressing 飲食料品小売業 marks 和歌山県 with +1 on the national map and rings 高野町 (30344) in the prefecture view', async () => {
    const name = [...root.querySelectorAll<HTMLButtonElement>('#panel-allocation .alloc-focus')].find((b) => b.textContent === '飲食料品小売業')!;
    name.click();
    expect(handle.store.get().allocation?.focusFacilityId).toBe('grocery');
    const svg = root.querySelector('.map-host-national svg')!;
    const marker = svg.querySelector('.marker[data-for="30"]')!;
    expect(marker.textContent).toBe('+1');
    expect(label(svg, '30')).toMatch(/飲食料品小売業：目安以上になる町 \+1(、|$)/);
    expect(label(svg, '30')).not.toContain('−0');

    handle.store.set({ selectedPref: '30' });
    await settle();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('.ring-gain')!.getAttribute('d')).toBe(pref.querySelector('path.area[data-code="30344"]')!.getAttribute('d'));
    expect(label(pref, '30344')).toContain('高野町');
    expect(label(pref, '30344')).toContain('飲食料品小売業が目安以上になる（増えた）');
    expect(label(pref, '30344')).toContain('割り振りによる変化 +10.0%');
    // headline and town panel agree: both numbers in the headline, the after-number in the panel's note
    const series = handle.store.get().series;
    const before = handle.ctx.data.areas.filter((a) => a.prefCode === '30').reduce((t, a) => t + total(series.get(a.code)![2100]), 0);
    expect(root.querySelector('.map-headline-num')!.textContent).toContain(`${formatPop(before * 1.1)}（割り振り前 ${formatPop(before)}）`);
    const note = root.querySelector<HTMLElement>('#panel-town .town-alloc-note')!;
    expect(note.hidden).toBe(false);
    expect(note.textContent).toBe(`地図は割り振り後（${formatPop(before * 1.1)}）です。この欄の数字は割り振り前です。`);
    expect(root.querySelector('#panel-town .kpi-value')!.textContent).toBe(formatPop(before)); // the tiles stay before the allocation
  }, 30_000);

  test('following the −1 marker of 喫茶店 to 長野県 keeps the allocation and shows the loss ring on 坂城町 (20521)', async () => {
    const cafe = [...root.querySelectorAll<HTMLButtonElement>('#panel-allocation .alloc-focus')].find((b) => b.dataset.facility === 'cafe')!;
    cafe.click();
    const shown = handle.store.get().allocation!;
    expect(shown.focusFacilityId).toBe('cafe');
    handle.store.set({ selectedPref: undefined });
    await settle();
    const national = root.querySelector('.map-host-national svg')!;
    expect(national.querySelector('.marker[data-for="20"]')!.textContent).toBe('−1');
    national.querySelector<SVGPathElement>('path.area[data-code="20"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(handle.store.get().selectedPref).toBe('20');
    expect(handle.store.get().allocation).toBe(shown); // not retargeted to 長野県
    expect(root.querySelector('.alloc-bar-name')!.textContent).toBe('和歌山県 +10%');
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('path.area[data-code="20521"]')).not.toBeNull();
    expect(pref.querySelector('.ring-loss')!.getAttribute('d')).toBe(pref.querySelector('path.area[data-code="20521"]')!.getAttribute('d'));
    expect(label(pref, '20521')).toContain('喫茶店が目安を下回る（減った）');
    handle.store.set({ selectedPref: '30' });
    await settle();
  }, 30_000);

  test('the clear button takes it all away', () => {
    expect(handle.store.get().allocation).toBeDefined();
    root.querySelector<HTMLButtonElement>('.alloc-clear')!.click();
    expect(handle.store.get().allocation).toBeUndefined();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('.ring-gain')!.getAttribute('d')).toBe('');
    expect(label(pref, '30344')).not.toContain('割り振り');
    expect(root.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.getAttribute('aria-pressed')).toBe('false');
  });

  test('every lost town is counted and ringed, not only a few: 北海道 −30% in 2100', async () => {
    const { data, store } = handle.ctx;
    const at = populationAt(data, store.get().series, 2100);
    const c = computeAllocation(data, store.get().series, 2100, { target: { kind: 'pref', code: '01' }, percent: -30, sourceMode: 'proportional', regionIds: [] }, at);
    const built = buildOverlay({ result: c.result, before: at.popByArea, facilities: data.facilities, year: 2100, label: '北海道 −30%' });
    const most = [...built.flips].sort((x, y) => y.lost.length - x.lost.length)[0]!;
    const lostHere = most.lost.filter((code) => code.startsWith('01'));
    expect(lostHere.length).toBeGreaterThan(9);
    handle.store.set({ selectedPref: undefined, allocation: { ...built, focusFacilityId: most.facilityId } });
    await settle();
    const gainedHere = most.gained.filter((code) => code.startsWith('01')).length;
    const national = root.querySelector('.map-host-national svg')!;
    expect(national.querySelector('.marker[data-for="01"]')!.textContent).toBe(gainedHere ? `+${gainedHere} −${lostHere.length}` : `−${lostHere.length}`);
    handle.store.set({ selectedPref: '01' });
    await settle();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    const joined = lostHere.map((code) => pref.querySelector(`path.area[data-code="${code}"]`)!.getAttribute('d')).join('');
    expect(pref.querySelector('.ring-loss')!.getAttribute('d')).toBe(joined);
    handle.store.set({ allocation: undefined, selectedPref: '30' });
    await settle();
  }, 30_000);
});

describe('one name per facility (Ruling 16: looked up by id from facilities.json) on the real data', () => {
  test('the facility panel, the allocation table, the overlay, the tooltip and the map labels all use the data file\'s name for each id', async () => {
    const { data, store } = handle.ctx;
    const nameById = new Map(data.facilities.map((f) => [f.id, f.name]));
    // the eight essential facilities, as printed in the MLIT figure
    expect(data.facilities.filter((f) => f.essential).map((f) => [f.id, f.name])).toEqual([
      ['grocery', '飲食料品小売業'],
      ['post_office', '郵便局'],
      ['bank', '銀行（中央銀行を除く）'],
      ['clinic', '一般診療所'],
      ['nursing_home', '介護老人福祉施設'],
      ['general_hospital', '一般病院'],
      ['day_care', '通所・短期入所介護事業'],
      ['home_help', '訪問介護事業'],
    ]);

    store.set({ year: 2100, selectedPref: '30' });
    await settle();
    store.set({ selectedArea: '30206' });
    root.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.click();
    await settle();
    const alloc = store.get().allocation!;
    expect(alloc).toBeDefined();

    const panelRows = [...root.querySelectorAll<HTMLElement>('#panel-town tr[data-facility-id]')];
    expect(panelRows).toHaveLength(48);
    for (const tr of panelRows) expect(tr.querySelector('.facility-name')!.textContent, tr.dataset.facilityId).toBe(nameById.get(tr.dataset.facilityId!));

    const buttons = [...root.querySelectorAll<HTMLButtonElement>('#panel-allocation .alloc-focus')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.textContent, b.dataset.facility).toBe(nameById.get(b.dataset.facility!));
      expect(b.getAttribute('aria-label')).toBe(`${nameById.get(b.dataset.facility!)}。目安をまたいだ町を地図に示す`);
    }
    for (const flip of alloc.flips) expect(flip.name, flip.facilityId).toBe(nameById.get(flip.facilityId));

    // the tooltip and the label of 和歌山県 on the national map say the same name once a facility is focused
    for (const b of buttons) {
      b.click();
      const id = b.dataset.facility!;
      const name = nameById.get(id)!;
      const flip = store.get().allocation!.flips.find((f) => f.facilityId === id)!;
      const prefs = new Set([...flip.gained, ...flip.lost].map((c) => c.slice(0, 2)));
      store.set({ selectedPref: undefined });
      await settle();
      const svg = root.querySelector('.map-host-national svg')!;
      for (const pp of prefs) {
        const text = label(svg, pp);
        expect(text, `${id} in ${pp}`).toContain(`${name}：`);
        svg.querySelector(`path.area[data-code="${pp}"]`)!.dispatchEvent(new Event('pointerover', { bubbles: true }));
        expect(root.querySelector('.map-host-national .map-tip')!.textContent).toContain(`${name}：`);
      }
    }
    store.set({ allocation: undefined, selectedPref: '30' });
    await settle();
  }, 60_000);
});
