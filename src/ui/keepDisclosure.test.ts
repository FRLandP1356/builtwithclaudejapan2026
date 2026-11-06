// @vitest-environment jsdom
// The disclosure 「この目安に届くには」 under each facility that is below the guide: where it shows, what it says, how it
// behaves when opened (one at a time), when the year or the town changes, and what its button does to the map.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { facilityById } from '../../test/helpers/loadFacilities';
import { realAppData } from '../../test/helpers/realPanelContext';
import { createRunner } from '../data/runner';
import { facilityStatus } from '../engine/facilities';
import type { Facility } from '../engine/types';
import { populationAt, type PopulationAt } from './allocationCore';
import { createKeepRow, type KeepContext } from './keepDisclosure';
import {
  computeKeep,
  KEEP_APPLIED,
  KEEP_BUTTON,
  KEEP_FAILED,
  KEEP_LIMITS,
  KEEP_NO_EFFECT,
  KEEP_SUMMARY,
  KEEP_TOO_LARGE,
  KEEP_TOP_LEAD,
  keepNeedLines,
  keepOverlay,
} from './keepGuide';
import { createAppStore, type Store } from './state';
import { mountTownPanel } from './townPanel';

const data = realAppData();
const runner = createRunner(data);
const facilities = data.facilities;
const flush = () => new Promise((r) => setTimeout(r, 0));
/** jsdom fires a details' toggle event as a task after `open` changes. */
const settle = async () => {
  await flush();
  await flush();
};

let mounted: { teardown: () => void } | undefined;
afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

function setup(initial: Parameters<typeof createAppStore>[2] = {}, wrap?: (s: Store) => Store) {
  const base = createAppStore(runner, data, initial);
  const store = wrap ? wrap(base) : base;
  const section = document.createElement('section');
  section.className = 'panel';
  section.id = 'panel-town';
  section.innerHTML = '<h2 class="panel-title">町の詳細</h2>';
  document.body.append(section);
  const teardown = mountTownPanel(section, { store, data, runner });
  mounted = { teardown };
  const keepRow = (id: string) => section.querySelector<HTMLTableRowElement>(`tr.facility-keep-row[data-keep-for="${id}"]`)!;
  const details = (id: string) => keepRow(id).querySelector<HTMLDetailsElement>('details.facility-keep')!;
  const open = async (id: string) => {
    details(id).open = true;
    await settle();
    return details(id);
  };
  const visibleIds = () => [...section.querySelectorAll<HTMLTableRowElement>('tr.facility-keep-row')].filter((r) => !r.hidden).map((r) => r.dataset.keepFor!);
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return { store: base, section, teardown, keepRow, details, open, visibleIds, text };
}

const belowIds = (code: string, year: number, scenario = runner.run({ cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 })) => {
  const pop = populationAt(data, scenario, year).popByArea.get(code)!;
  return facilities.filter((f) => facilityStatus(pop, f) === 'below').map((f) => f.id);
};

describe('where the disclosure shows', () => {
  test('田辺市 in 2100: one row under each of the 29 facilities below the guide, hidden for the other 19', () => {
    const { section, keepRow, visibleIds } = setup({ selectedArea: '30206', year: 2100 });
    expect(section.querySelectorAll('tr.facility-keep-row')).toHaveLength(48);
    expect(visibleIds().sort()).toEqual(belowIds('30206', 2100).sort());
    expect(visibleIds()).toHaveLength(29);
    // directly under its facility's row, in the same table body, with no id that would be read as a facility row
    for (const id of visibleIds()) {
      const tr = section.querySelector(`tr[data-facility-id="${id}"]`)!;
      expect(tr.nextElementSibling).toBe(keepRow(id));
      expect(tr.classList.contains('has-keep')).toBe(true);
      expect(keepRow(id).hasAttribute('data-facility-id')).toBe(false);
    }
    expect(section.querySelectorAll('tr[data-facility-id]')).toHaveLength(48);
    for (const id of ['stationery_books', 'general_hospital', 'grocery']) {
      expect(keepRow(id).hidden).toBe(true);
      expect(section.querySelector(`tr[data-facility-id="${id}"]`)!.classList.contains('has-keep')).toBe(false);
    }
  });

  test('a facility that is on the edge or above has none (田辺市 2100: 一般病院 is 境目)', () => {
    const { section, keepRow } = setup({ selectedArea: '30206', year: 2100 });
    expect(section.querySelector('tr[data-facility-id="general_hospital"] .tag')!.textContent).toBe('境目');
    expect(keepRow('general_hospital').hidden).toBe(true);
    expect(keepRow('stationery_books').hidden).toBe(true);
  });

  test('the disclosure follows the year: 田辺市 has 18 in 2050 and 11 in 2020', () => {
    const { store, visibleIds } = setup({ selectedArea: '30206', year: 2100 });
    store.set({ year: 2050 });
    expect(visibleIds().sort()).toEqual(belowIds('30206', 2050).sort());
    expect(visibleIds()).toHaveLength(18);
    store.set({ year: 2020 });
    expect(visibleIds()).toHaveLength(11);
    store.set({ year: 2100 });
    expect(visibleIds()).toHaveLength(29);
  });

  test('a large city in 2020 (鹿児島市) is below nothing: no disclosure at all', () => {
    const { visibleIds, section } = setup({ selectedArea: '46201', year: 2020 });
    expect(section.querySelector('.facility-summary')!.textContent).toBe('全48種類のうち、目安を下回るものはありません');
    expect(visibleIds()).toEqual([]);
  });

  test('千代田区 (a metropolitan area) is below 11 facilities but gets no disclosure: its table is a reference', () => {
    const { section, visibleIds, store } = setup({ selectedArea: '13101', year: 2020 });
    expect(section.textContent).toContain('この町は三大都市圏にあるため、表の対象外です。参考として表示します。');
    expect(section.querySelectorAll('.tag-below')).toHaveLength(11);
    expect(visibleIds()).toEqual([]);
    expect(section.querySelectorAll('tr.has-keep')).toHaveLength(0);
    store.set({ year: 2100 });
    expect(visibleIds()).toEqual([]);
    // and leaving the metropolitan area brings the disclosure back
    store.set({ selectedArea: '30206' });
    expect(visibleIds()).toHaveLength(29);
  });

  test('a prefecture or the whole country has no facility panel, so no disclosure', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2100 });
    store.set({ selectedPref: '01' }); // another prefecture: the town is no longer selected
    expect(section.querySelector('.town-facilities')).toBeNull();
    expect(section.querySelectorAll('tr.facility-keep-row')).toHaveLength(0);
    store.set({ selectedPref: undefined });
    expect(section.querySelectorAll('tr.facility-keep-row')).toHaveLength(0);
  });

  test('closed, nothing is built: no body, no sentence, no button', () => {
    const { section } = setup({ selectedArea: '30206', year: 2100 });
    expect(section.querySelectorAll('.facility-keep-body')).toHaveLength(0);
    expect(section.textContent).not.toContain(KEEP_LIMITS);
    expect(section.textContent).not.toContain(KEEP_BUTTON);
  });

  test('the disclosure takes the full width of the table: one cell over both columns', () => {
    const { keepRow } = setup({ selectedArea: '30206', year: 2100 });
    const cells = keepRow('pet_supplies').querySelectorAll('td');
    expect(cells).toHaveLength(1);
    expect(cells[0].colSpan).toBe(2);
    expect(cells[0].classList.contains('facility-keep-cell')).toBe(true);
  });

  test('the summary says 「この目安に届くには」 and names the facility for a screen reader only', () => {
    const { details } = setup({ selectedArea: '30206', year: 2100 });
    const summary = details('pet_supplies').querySelector('summary')!;
    expect(summary.firstChild!.textContent).toBe(KEEP_SUMMARY);
    expect(summary.firstChild!.textContent).toBe('この目安に届くには');
    const hidden = summary.querySelector('.sr-only')!;
    expect(hidden.textContent).toBe('（ペット・ペット用品小売業）');
    expect(summary.children).toHaveLength(1);
    expect(details('pet_supplies').open).toBe(false);
  });
});

describe('opened: 田辺市 in 2100', () => {
  test('the numbers for ペット・ペット用品小売業 (pinned from public/data)', async () => {
    const { open, text } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('pet_supplies');
    const body = d.querySelector('.facility-keep-body')!;
    expect(text(body.querySelector('.facility-keep-year'))).toBe('2100年の人口で計算 試算');
    expect(body.querySelector('.facility-keep-year .badge-estimate')!.textContent).toBe('試算');
    const needs = [...body.querySelectorAll('.facility-keep-need')].map((n) => [n.querySelector('dt')!.textContent, n.querySelector('dd')!.textContent]);
    expect(needs).toEqual([
      ['50%の目安（32,500人）まで', 'あと約2.1万人'], // 20,621
      ['80%の目安（47,500人）まで', 'あと約3.6万人'], // 35,621
    ]);
    expect(text(body.querySelector('.facility-keep-premise'))).toBe(
      '50%の目安に届くところまで、ほかの町から約2.1万人が移ってきたと考えます。ほかの町の人口に比例して減らし、全国の合計は変わりません。',
    );
    expect(text(body.querySelector('.facility-keep-effect'))).toBe('このとき、ほかの1町が、いずれかの施設の人口の目安を下回ります。');
    expect(body.querySelector('.facility-keep-top-lead')!.textContent).toBe(KEEP_TOP_LEAD);
    expect([...body.querySelectorAll('.facility-keep-top li')].map((li) => li.textContent)).toEqual(['喫茶店（1町）']);
    expect(body.querySelector('.facility-keep-top')!.getAttribute('aria-labelledby')).toBe(body.querySelector('.facility-keep-top-lead')!.id);
    expect(text(body.querySelector('.facility-keep-limits'))).toBe(KEEP_LIMITS);
    const button = body.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!;
    expect(button.firstChild!.textContent).toBe(KEEP_BUTTON);
    expect(button.querySelector('.sr-only')!.textContent).toBe('（ペット・ペット用品小売業の目安に届いた場合の計算）');
    expect((body.querySelector('.facility-keep-error') as HTMLElement).hidden).toBe(true);
    expect((body.querySelector('.facility-keep-what') as HTMLElement).hidden).toBe(false);
  });

  test('外車ディーラー: three facilities named with their number of towns, the most first', async () => {
    const { open } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('import_car_dealer');
    expect(d.querySelector('.facility-keep-effect')!.textContent).toBe('このとき、ほかの19町が、いずれかの施設の人口の目安を下回ります。');
    expect([...d.querySelectorAll('.facility-keep-top li')].map((li) => li.textContent)).toEqual(['書籍・文房具小売業（3町）', '喫茶店（2町）', '遊戯場（2町）']);
  });

  test('百貨店 has one guide: one line of people, no 50%', async () => {
    const { open } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('department_store');
    expect([...d.querySelectorAll('.facility-keep-need')].map((n) => `${n.querySelector('dt')!.textContent}|${n.querySelector('dd')!.textContent}`)).toEqual(['目安（275,000人）まで|あと約26.3万人']);
    expect(d.querySelector('.facility-keep-premise')!.textContent).toMatch(/^目安に届くところまで、/);
  });

  test('nothing falls below elsewhere: one plain sentence, and no list of facilities', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2050 });
    const d = await open('fitness_club');
    expect(d.querySelector('.facility-keep-effect')!.textContent).toBe(KEEP_NO_EFFECT);
    expect((d.querySelector('.facility-keep-top') as HTMLElement).hidden).toBe(true);
    expect((d.querySelector('.facility-keep-top-lead') as HTMLElement).hidden).toBe(true);
    expect(d.querySelectorAll('.facility-keep-top li')).toHaveLength(0);
    // the 2050 year line is the official one, with no 試算 mark
    expect(d.querySelector('.facility-keep-year')!.textContent).toBe('2050年の人口で計算　公式推計');
    expect(d.querySelector('.facility-keep-year .badge-estimate')).toBeNull();
    expect(d.querySelector('.facility-keep-year .badge-official')!.textContent).toBe('公式推計');
    store.set({ year: 2100 });
    expect(d.open).toBe(true);
    expect(d.querySelector('.facility-keep-year')!.textContent).toBe('2100年の人口で計算　試算');
  });

  test('2020 is the census: the year line says 実績（国勢調査）, with no 試算', async () => {
    const { open } = setup({ selectedArea: '30206', year: 2020 });
    const d = await open('department_store'); // 275,000: below 田辺市's 69,870
    expect(d.querySelector('.facility-keep-year')!.textContent).toBe('2020年の人口で計算　実績（国勢調査）');
    expect(d.querySelector('.facility-keep-year .badge-estimate')).toBeNull();
    expect(d.querySelector('.facility-keep-need dd')!.textContent).toBe('あと約20.5万人'); // 205,130
  });

  test('高野町 in 2100: 飲食料品小売業 is one guide (500) and 30 more people', async () => {
    const { open } = setup({ selectedArea: '30344', year: 2100 });
    const d = await open('grocery');
    expect([...d.querySelectorAll('.facility-keep-need')].map((n) => `${n.querySelector('dt')!.textContent}|${n.querySelector('dd')!.textContent}`)).toEqual(['目安（500人）まで|あと約30人']);
    expect(d.querySelector('.facility-keep-effect')!.textContent).toBe(KEEP_NO_EFFECT);
  });
});

describe('one open at a time, and what closes them', () => {
  test('opening a second one closes the first', async () => {
    const { open, details } = setup({ selectedArea: '30206', year: 2100 });
    await open('pet_supplies');
    expect(details('pet_supplies').open).toBe(true);
    await open('import_car_dealer');
    expect(details('import_car_dealer').open).toBe(true);
    expect(details('pet_supplies').open).toBe(false);
    expect(document.querySelectorAll('details.facility-keep[open]')).toHaveLength(1);
  });

  test('the summary opens and closes it (a click is what Enter and Space send)', async () => {
    const { details } = setup({ selectedArea: '30206', year: 2100 });
    const summary = details('pet_supplies').querySelector('summary')!;
    summary.click();
    await settle();
    expect(details('pet_supplies').open).toBe(true);
    expect(details('pet_supplies').querySelector('.facility-keep-body')).not.toBeNull();
    summary.click();
    await settle();
    expect(details('pet_supplies').open).toBe(false);
  });

  test('another town starts with all of them closed', async () => {
    const { open, details, store } = setup({ selectedArea: '30206', year: 2100 });
    await open('pet_supplies');
    store.set({ selectedArea: '30344' });
    expect(details('pet_supplies').open).toBe(false);
    expect(document.querySelectorAll('details.facility-keep[open]')).toHaveLength(0);
    store.set({ selectedArea: '30206' });
    expect(details('pet_supplies').open).toBe(false);
  });

  test('leaving the metropolitan-area town or the facility panel closes it', async () => {
    const { open, details, store } = setup({ selectedArea: '30206', year: 2100 });
    await open('pet_supplies');
    store.set({ selectedArea: '13101' });
    expect(details('pet_supplies').open).toBe(false);
  });

  test('when the year makes the facility no longer below, the row hides and closes', async () => {
    const { open, details, keepRow, store } = setup({ selectedArea: '30206', year: 2100 });
    await open('hamburger_shop'); // 32,500: below in 2100 (11,880), on the edge in 2050 (42,311)
    expect(keepRow('hamburger_shop').hidden).toBe(false);
    store.set({ year: 2050 });
    expect(keepRow('hamburger_shop').hidden).toBe(true);
    expect(details('hamburger_shop').open).toBe(false);
    store.set({ year: 2100 });
    expect(keepRow('hamburger_shop').hidden).toBe(false);
    expect(details('hamburger_shop').open).toBe(false); // it does not spring open again
  });

  test('an open one follows the year in place, keeping the focus on its button', async () => {
    const { open, store, section } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('fitness_club');
    const button = d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!;
    expect(d.querySelector('.facility-keep-need dd')!.textContent).toBe('あと約3.1万人'); // 30,621
    button.focus();
    const body = d.querySelector('.facility-keep-body');
    store.set({ year: 2050 });
    expect(d.querySelector('.facility-keep-body')).toBe(body);
    expect(d.querySelector('.facility-keep-reflect')).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(d.querySelector('.facility-keep-need dd')!.textContent).toBe('あと約190人');
    expect(d.querySelector('.facility-keep-year')!.textContent).toContain('2050年');
    expect(section.querySelectorAll('details.facility-keep[open]')).toHaveLength(1);
  });

  test('an open one follows a change of assumptions', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('pet_supplies');
    const before = d.querySelector('.facility-keep-need dd')!.textContent;
    store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    const series = store.get().series;
    const at = populationAt(data, series, 2100);
    const expected = keepNeedLines(facilityById(facilities, 'pet_supplies'), computeKeep(at, facilities, facilityById(facilities, 'pet_supplies'), '30206')!.needs);
    expect(d.querySelector('.facility-keep-need dd')!.textContent).toBe(expected[0].value);
    expect(expected[0].value).not.toBe(before);
  });
});

describe('the button 「地図に反映する」', () => {
  test('hands the what-if to the map overlay the allocation panel draws, with this facility in focus', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('pet_supplies');
    expect(store.get().allocation).toBeUndefined();
    d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    const overlay = store.get().allocation!;
    expect(overlay.year).toBe(2100);
    expect(overlay.label).toBe('田辺市 +20,621人');
    expect(overlay.focusFacilityId).toBe('pet_supplies');
    expect(overlay.changePercent['30206']).toBeCloseTo((20_621 / 11_879.876) * 100, 4);
    expect(overlay.changePercent['30201']).toBeLessThan(0);
    expect(overlay.changePercent['30201']).toBeGreaterThan(-0.5);
    // the same overlay the helpers build: 田辺市 gains the facility, the one town in 喫茶店's list... is the cafe's
    const flip = overlay.flips.find((f) => f.facilityId === 'pet_supplies')!;
    expect(flip.gained).toEqual(['30206']);
    expect(flip.lost).toEqual([]);
    const at = populationAt(data, store.get().series, 2100);
    const c = computeKeep(at, facilities, facilityById(facilities, 'pet_supplies'), '30206')!;
    if (c.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(overlay).toEqual(keepOverlay(c.outcome, at, facilities, 2100, '田辺市', 'pet_supplies'));
    expect(d.querySelector('.facility-keep-status')!.textContent).toBe(KEEP_APPLIED);
    expect(d.querySelector('.facility-keep-status')!.getAttribute('role')).toBe('status');
  });

  test('the overlay is the one for the facility whose button was pressed, in the year on screen', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2050 });
    const d = await open('fitness_club');
    d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    const overlay = store.get().allocation!;
    expect(overlay.year).toBe(2050);
    expect(overlay.label).toBe('田辺市 +190人');
    expect(overlay.focusFacilityId).toBe('fitness_club');
    // 190 more people lift 田辺市 over the guide of フィットネスクラブ and of 有料老人ホーム (both 42,500); nobody else moves
    expect(overlay.flips.map((f) => f.facilityId)).toEqual(['fitness_club', 'paid_nursing_home']);
    expect(overlay.flips.every((f) => f.gained.length === 1 && f.gained[0] === '30206' && f.lost.length === 0)).toBe(true);
  });

  test('if the map does not take it, the status says so', async () => {
    const { open } = setup({ selectedArea: '30206', year: 2100 }, (s) => ({ ...s, get: () => s.get(), subscribe: (fn) => s.subscribe(fn), set: () => false }));
    const d = await open('pet_supplies');
    d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    expect(d.querySelector('.facility-keep-status')!.textContent).toBe(KEEP_FAILED);
  });

  describe('on a phone the map is above the panels', () => {
    function fakeMap(top: number) {
      const map = document.createElement('div');
      map.className = 'map-column';
      const scrollIntoView = vi.fn();
      map.scrollIntoView = scrollIntoView;
      map.getBoundingClientRect = () => ({ top }) as DOMRect;
      document.body.append(map);
      return scrollIntoView;
    }

    test('after the map took the what-if, a map that is scrolled out of view is brought back, to its top', async () => {
      const scroll = fakeMap(-120);
      const { open } = setup({ selectedArea: '30206', year: 2100 });
      const d = await open('pet_supplies');
      d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    });

    test('a map already in view does not move', async () => {
      const scroll = fakeMap(0);
      const { open } = setup({ selectedArea: '30206', year: 2100 });
      const d = await open('pet_supplies');
      d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
      expect(scroll).not.toHaveBeenCalled();
    });

    test('when the map did not take it, nothing scrolls', async () => {
      const scroll = fakeMap(-120);
      const { open } = setup({ selectedArea: '30206', year: 2100 }, (s) => ({ ...s, get: () => s.get(), subscribe: (fn) => s.subscribe(fn), set: () => false }));
      const d = await open('pet_supplies');
      d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
      expect(scroll).not.toHaveBeenCalled();
    });
  });

  test('a new calculation (another year) clears the old status', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('fitness_club');
    d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    expect(d.querySelector('.facility-keep-status')!.textContent).toBe(KEEP_APPLIED);
    store.set({ year: 2050 });
    expect(d.querySelector('.facility-keep-status')!.textContent).toBe('');
  });

  test('pressing it changes nothing else: the open state, the numbers and the selection stay', async () => {
    const { open, store } = setup({ selectedArea: '30206', year: 2100 });
    const d = await open('pet_supplies');
    const text = d.querySelector('.facility-keep-body')!.textContent!.replace(KEEP_APPLIED, '');
    d.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    expect(d.open).toBe(true);
    expect(d.querySelector('.facility-keep-body')!.textContent!.replace(KEEP_APPLIED, '')).toBe(text);
    expect(store.get().selectedArea).toBe('30206');
    expect(store.get().year).toBe(2100);
  });
});

describe('wording of everything the disclosure can say', () => {
  const FORBIDDEN = /残せない|閉鎖|閉店|撤退|廃止|なくなる|無くなる|消える|潰れ|残す|残さ|守る|維持|おすすめ|べき|したほうが|した方が|ほうがよい|必要です|推奨/;

  test('every disclosure of 田辺市 and 高野町, in 2020 / 2050 / 2100, is a plain statement', async () => {
    const t = setup({ selectedArea: '30206', year: 2100 });
    for (const area of ['30206', '30344']) {
      for (const year of [2020, 2050, 2100]) {
        t.store.set({ selectedArea: area, year });
        for (const id of t.visibleIds()) {
          const d = await t.open(id);
          const body = d.textContent!;
          expect(body, `${area} ${year} ${id}`).not.toMatch(FORBIDDEN);
          expect(body.replace(/予測ではありません/g, ''), `${area} ${year} ${id}`).not.toContain('予測');
          expect(body).not.toMatch(/[←-⇿▲▶▼①-⑳]/);
          expect(body).toContain(KEEP_LIMITS);
          // the 試算 mark is on exactly the years after 2050
          expect(d.querySelectorAll('.facility-keep-year .badge-estimate')).toHaveLength(year > 2050 ? 1 : 0);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The row on its own, over a world made of plain numbers: the cases the real data cannot reach.
// ---------------------------------------------------------------------------------------------------------------
describe('createKeepRow over a small world', () => {
  const fac = (over: Partial<Facility>): Facility => ({ id: 'target', name: '対象施設', p50: 1500, p80: 2500, essential: false, excludesMetro: true, source: 's', ...over });
  const target = fac({});
  const other = fac({ id: 'other', name: '別の施設', p50: 3000, p80: 4000 });
  const list = [target, other];
  const world = (pops: Record<string, number>): PopulationAt => ({ popByArea: new Map(Object.entries(pops)), areaPref: new Map(Object.keys(pops).map((c) => [c, '01'])) });

  function mount(at: PopulationAt, reflect: KeepContext['reflect'] = () => true) {
    const k = createKeepRow(target, list);
    document.body.append(k.row);
    const ctx = (year = 2100): KeepContext => ({ areaCode: 'T', year, place: '試験町', populations: () => at, reflect });
    return { k, ctx };
  }

  test('starts hidden and closed; sync shows it, sync(undefined) hides and closes it', async () => {
    const { k, ctx } = mount(world({ T: 1400, A: 5000, B: 3000 }));
    expect(k.row.hidden).toBe(true);
    expect(k.details.open).toBe(false);
    k.sync(ctx());
    expect(k.row.hidden).toBe(false);
    k.details.open = true;
    await settle();
    k.sync(undefined);
    expect(k.row.hidden).toBe(true);
    expect(k.details.open).toBe(false);
  });

  test('too many people for the other areas: only the sentence, the numbers needed and the limits; no button', async () => {
    const { k, ctx } = mount(world({ T: 1400, A: 50 }));
    k.sync(ctx());
    k.details.open = true;
    await settle();
    const body = k.details.querySelector('.facility-keep-body')!;
    expect((body.querySelector('.facility-keep-error') as HTMLElement).hidden).toBe(false);
    expect(body.querySelector('.facility-keep-error')!.textContent).toBe(KEEP_TOO_LARGE);
    expect((body.querySelector('.facility-keep-what') as HTMLElement).hidden).toBe(true);
    expect(body.querySelector('.facility-keep-needs')!.textContent).toContain('あと約100人');
    expect(body.querySelector('.facility-keep-limits')!.textContent).toBe(KEEP_LIMITS);
    // the visible text carries no result and no button
    const visible = [...body.children].filter((c) => !(c as HTMLElement).hidden).map((c) => c.textContent).join('');
    expect(visible).not.toContain('このとき');
    expect(visible).not.toContain(KEEP_BUTTON);
  });

  test('a result after "too large" comes back to the full view (and the other way round)', async () => {
    let at = world({ T: 1400, A: 50 });
    const k = createKeepRow(target, list);
    document.body.append(k.row);
    const ctx: KeepContext = { areaCode: 'T', year: 2100, place: '試験町', populations: () => at, reflect: () => true };
    k.sync(ctx);
    k.details.open = true;
    await settle();
    const body = k.details.querySelector('.facility-keep-body')!;
    expect((body.querySelector('.facility-keep-what') as HTMLElement).hidden).toBe(true);
    at = world({ T: 1400, A: 5000, B: 3000 });
    k.sync({ ...ctx });
    expect((body.querySelector('.facility-keep-what') as HTMLElement).hidden).toBe(false);
    expect((body.querySelector('.facility-keep-error') as HTMLElement).hidden).toBe(true);
    at = world({ T: 1400, A: 50 });
    k.sync({ ...ctx });
    expect((body.querySelector('.facility-keep-what') as HTMLElement).hidden).toBe(true);
    expect((body.querySelector('.facility-keep-error') as HTMLElement).hidden).toBe(false);
  });

  test('focus on the button that goes away moves to the summary, not to the page', async () => {
    let at = world({ T: 1400, A: 5000, B: 3000 });
    const k = createKeepRow(target, list);
    document.body.append(k.row);
    const ctx: KeepContext = { areaCode: 'T', year: 2100, place: '試験町', populations: () => at, reflect: () => true };
    k.sync(ctx);
    k.details.open = true;
    await settle();
    k.details.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.focus();
    at = world({ T: 1400, A: 50 });
    k.sync({ ...ctx });
    expect(document.activeElement).toBe(k.details.querySelector('summary'));
  });

  test('the button does nothing when there is no result to hand over', async () => {
    let called = 0;
    const { k, ctx } = mount(world({ T: 1400, A: 50 }), () => {
      called++;
      return true;
    });
    k.sync(ctx());
    k.details.open = true;
    await settle();
    k.details.querySelector<HTMLButtonElement>('button.facility-keep-reflect')!.click();
    expect(called).toBe(0);
    expect(k.details.querySelector('.facility-keep-status')!.textContent).toBe('');
  });
});
