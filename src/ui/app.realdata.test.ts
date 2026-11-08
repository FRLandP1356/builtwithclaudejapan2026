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
import { approxPopulation } from './screens';
import { SUPPORT_COLORS } from '../map/colors';

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
    // the country's total does not change: no second number in the heading, no note in the town panel
    expect(root.querySelector('#screen-entry-title')!.textContent).not.toContain('割り振り前');
    expect(root.querySelector<HTMLElement>('#panel-town .town-alloc-note')!.hidden).toBe(true);
  });

  test('pressing 飲食料品小売業 marks 和歌山県 with +1 on the national map and rings 高野町 (30344) in the prefecture view', async () => {
    const name = [...root.querySelectorAll<HTMLButtonElement>('#panel-allocation .alloc-focus')].find((b) => b.textContent === '飲食料品小売業')!;
    name.click();
    expect(handle.store.get().allocation?.focusFacilityId).toBe('grocery');
    const svg = root.querySelector('.map-host-national svg')!;
    const marker = svg.querySelector('.marker[data-for="30"]')!;
    expect(marker.textContent).toBe('+1');
    expect(label(svg, '30')).toMatch(/飲食料品小売業：人口の目安を下回らなくなる町 \+1(、|$)/);
    expect(label(svg, '30')).not.toContain('−0');

    handle.store.set({ selectedPref: '30' });
    await settle();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    expect(pref.querySelector('.ring-gain')!.getAttribute('d')).toBe(pref.querySelector('path.area[data-code="30344"]')!.getAttribute('d'));
    expect(label(pref, '30344')).toContain('高野町');
    expect(label(pref, '30344')).toContain('飲食料品小売業が人口の目安を下回らなくなる');
    expect(label(pref, '30344')).toContain('割り振りによる変化 +10.0%');
    // heading and town panel agree: the after-number in the heading with the number before it beside it, the after-number in the panel's note
    const series = handle.store.get().series;
    const before = handle.ctx.data.areas.filter((a) => a.prefCode === '30').reduce((t, a) => t + total(series.get(a.code)![2100]), 0);
    const heading = root.querySelector('#screen-entry-title')!.textContent!;
    expect(heading).toContain(`2100年、和歌山県の人口は${approxPopulation(before * 1.1)}`);
    expect(heading).toContain(`（割り振り前 ${formatPop(before)}）`);
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
    expect(label(pref, '20521')).toContain('喫茶店が人口の目安を下回る');
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

describe('the support ratio on the real maps (people aged 15-64 per person aged 65+)', () => {
  test('Japan 2.1 / 1.4 / 1.4, 和歌山県 1.7 / 1.1 / 1.1 and 田辺市 1.6 / 0.9 / 0.8 in 2020 / 2050 / 2100', async () => {
    const { store } = handle.ctx;
    store.set({ allocation: undefined, selectedPref: undefined, mapMode: 'support' });
    await settle();
    // the heading says the ratio in a sentence: 「2050年、日本で、高齢者1人を支える現役世代は1.4人。2020年は2.1人です。」
    const head = () => /現役世代は([\d.]+人)/.exec(root.querySelector('#screen-entry-title')!.textContent!)![1];
    const national = root.querySelector('.map-host-national svg')!;
    const want = { 2020: ['2.1', '1.7', '1.6'], 2050: ['1.4', '1.1', '0.9'], 2100: ['1.4', '1.1', '0.8'] } as const;
    for (const year of [2020, 2050, 2100] as const) {
      store.set({ year });
      expect(head(), `Japan ${year}`).toBe(`${want[year][0]}人`);
      expect(label(national, '30')).toContain(`${year}年 高齢者1人を支える現役世代 ${want[year][1]}人`);
      expect(root.querySelector('#panel-town .town-support-kpi .kpi-value')!.textContent).toBe(`${want[year][0]}人`); // the panel says the same
    }
    store.set({ selectedPref: '30' });
    await settle();
    const pref = root.querySelector('.map-host:not([hidden]):not(.map-host-national) svg')!;
    for (const year of [2020, 2050, 2100] as const) {
      store.set({ year });
      expect(head(), `和歌山県 ${year}`).toBe(`${want[year][1]}人`);
      expect(label(pref, '30206')).toContain(`${year}年 高齢者1人を支える現役世代 ${want[year][2]}人`);
    }
    store.set({ selectedArea: '30206' });
    expect(head()).toBe('0.8人');
    expect(root.querySelector('#panel-town .town-support-kpi .kpi-value')!.textContent).toBe('0.8人');
    // every area has a colour from the ramp (no area without anyone aged 65+ in the real data)
    const fills = new Set([...pref.querySelectorAll('path.area')].map((p) => p.getAttribute('fill')));
    for (const f of fills) expect(SUPPORT_COLORS).toContain(f);
    store.set({ mapMode: 'change', selectedArea: undefined });
    await settle();
  }, 30_000);
});

describe('the choice screen on the real maps (the third screen)', () => {
  const side = (i: number) => root.querySelectorAll('#screen-choose .choose-side')[i];
  const amount = (i: number) => side(i).querySelector('.choose-amount')!.textContent!;

  test('the country: the earliest row of the whole country is the example, said in small type; the two boxes carry the same number of people', async () => {
    const { store } = handle.ctx;
    store.set({ allocation: undefined, selectedPref: undefined, selectedArea: undefined, year: 2100 });
    await settle();
    const card = root.querySelector('#screen-choose .choose')!;
    expect(card.querySelector<HTMLElement>('.choose-example')!.hidden).toBe(false);
    expect(card.querySelector('.choose-example')!.textContent).toBe('日本全体の例');
    expect(side(0).querySelector('.choose-side-title')!.textContent).toBe('ここを残すには');
    expect(side(1).querySelector('.choose-side-title')!.textContent).toBe('代わりに、ほかの町から');
    expect(amount(0)).toMatch(/^\+約[\d,.万]+人$/);
    expect(amount(1)).toBe(amount(0).replace('+', '−')); // the country's population does not change: one number, two signs
    expect(card.querySelector('.choose-same')!.textContent).toBe('同じ人数が入れ替わるだけです。日本全体の人口は変わりません。');
    expect(card.querySelector('.choose-lead')!.textContent).toMatch(/に届くには/);
    expect(card.querySelector('.choose-effect')!.textContent).toMatch(/^このとき、/);
    // the same row as the first row of the board
    const first = root.querySelector<HTMLElement>('#panel-board .board-row')!;
    expect(card.querySelector('.choose-lead')!.textContent).toContain(`${first.dataset.year}年に`);
  }, 30_000);

  test('a prefecture with rows of its own uses its first row (no example label); the button hands the what-if to the map in the row\'s year', async () => {
    const { store } = handle.ctx;
    store.set({ selectedPref: '30', year: 2050 });
    await settle();
    const card = root.querySelector('#screen-choose .choose')!;
    expect(card.querySelector<HTMLElement>('.choose-example')!.hidden).toBe(true);
    const first = root.querySelector<HTMLElement>('#panel-board .board-row')!;
    expect(card.querySelector('.choose-lead')!.textContent).toContain(`${first.dataset.year}年に`);
    Element.prototype.scrollIntoView = () => undefined;
    root.querySelector<HTMLButtonElement>('#screen-choose .choose-reflect')!.click();
    const a = store.get().allocation!;
    expect(a).toBeDefined();
    expect(store.get().year).toBe(Number(first.dataset.year));
    expect(a.year).toBe(Number(first.dataset.year));
    expect(root.querySelector('#screen-choose .choose-status')!.textContent).toContain('地図に反映しました');
    store.set({ allocation: undefined, selectedPref: undefined, year: 2100 });
    await settle();
  }, 30_000);
});
