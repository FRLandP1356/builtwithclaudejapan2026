// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { repoPath } from '../../test/helpers/paths';
import type { AppData } from '../data/loader';
import { createRunner, type Runner } from '../data/runner';
import { total } from '../engine/aggregate';
import { DEFAULT_SCENARIO, type Area, type Groups, type Scenario } from '../engine/types';
import { deriveTotals } from './derive';
import { evaluateFacilities, PERMANENT_NOTE, summaryLine } from './facilityPanel';
import { formatPct, formatPop } from './format';
import { PYRAMID_HALF_WIDTH, pyramidScale } from './pyramid';
import { formatAxisCount, SERIES_VIEW, TABLE_NOTE } from './seriesChart';
import { createAppStore, type AllocationOverlay, type Store } from './state';
import { ageShares, mountTownPanel } from './townPanel';

const areas = loadAllAreas();
const groups = JSON.parse(readFileSync(repoPath('public/data/groups.json'), 'utf8')) as Groups;
const data: AppData = {
  areas,
  groups,
  facilities: loadFacilities(),
  japanTopo: {} as never,
  prefNames: new Map(areas.map((a) => [a.prefCode, a.prefName])),
};
const runner = createRunner(data); // shared: each scenario is computed once for the whole file
const tanabe = byCode(areas, '30206');

let mounted: { section: HTMLElement; teardown: () => void } | undefined;

interface World {
  data: AppData;
  runner: Runner;
}

function setup(initial: Parameters<typeof createAppStore>[2] = {}, wrap?: (s: Store) => Store, world: World = { data, runner }) {
  const baseStore = createAppStore(world.runner, world.data, initial);
  const store = wrap ? wrap(baseStore) : baseStore;
  const section = document.createElement('section');
  section.className = 'panel';
  section.id = 'panel-town';
  section.innerHTML = '<h2 class="panel-title" id="panel-town-title">町の詳細</h2>';
  document.body.append(section);
  const teardown = mountTownPanel(section, { store, data: world.data, runner: world.runner });
  mounted = { section, teardown };
  const q = <T extends Element>(sel: string) => section.querySelector<T>(sel);
  const kpis = () => [...section.querySelectorAll('.kpi')].map((k) => k.textContent!.replace(/\s+/g, ' ').trim());
  return { store: baseStore, section, teardown, q, kpis };
}

afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

describe('ageShares', () => {
  test('splits a population into children (0-14), working ages and 65+ shares of the total', () => {
    const s = ageShares(tanabe.base);
    expect(s.total).toBeCloseTo(total(tanabe.base), 6);
    expect(s.child + s.working + s.elderly).toBeCloseTo(1, 9);
    expect(s.child).toBeGreaterThan(0.05);
    expect(s.elderly).toBeGreaterThan(0.2);
  });

  test('an empty population has NaN shares instead of dividing by zero', () => {
    const z = { M: new Array(20).fill(0), F: new Array(20).fill(0) };
    expect(Number.isNaN(ageShares(z).elderly)).toBe(true);
  });
});

describe('mountTownPanel: what is shown at each level (Ruling 27)', () => {
  test('nothing selected: the Japan summary with tiles, pyramid and series, and no facility panel', () => {
    const { section, q, kpis } = setup();
    expect(section.textContent).toContain('日本全体');
    expect(kpis()).toHaveLength(4);
    expect(q('.pyramid-svg')).not.toBeNull();
    expect(q('.series-svg')).not.toBeNull();
    expect(q('.town-facilities')).toBeNull();
    expect(q('.panel-empty')?.textContent).toContain('町を選ぶと');
    // the population tile equals the sum of every area in the default year (2050)
    const t = deriveTotals(runner.run(DEFAULT_SCENARIO), groups);
    expect(kpis()[0]).toContain(formatPop(t.japan[6]));
  });

  test('only a prefecture selected: the prefecture summary, without the facility panel', () => {
    const { section, q, kpis, store } = setup();
    store.set({ selectedPref: '30' });
    expect(section.textContent).toContain('和歌山県');
    expect(section.textContent).not.toContain('日本全体');
    expect(q('.town-facilities')).toBeNull();
    expect(q('.pyramid-svg')).not.toBeNull();
    expect(q('.series-svg')).not.toBeNull();
    const t = deriveTotals(runner.run(DEFAULT_SCENARIO), groups);
    expect(kpis()[0]).toContain(formatPop(t.pref.get('30')![6]));
  });

  test('an area selected: key tiles, pyramid, series and the facility panel', () => {
    const { section, q, kpis, store } = setup();
    store.set({ selectedArea: '30206' });
    expect(q('.town-name')?.textContent).toBe('田辺市');
    expect(section.textContent).toContain('和歌山県');
    expect(q('.town-facilities')).not.toBeNull();
    expect(q('.town-facilities')?.querySelectorAll('tr[data-facility-id]')).toHaveLength(48);
    expect(kpis()[0]).toContain('4.2万人'); // 42,311 in 2050
    expect(kpis()[1]).toContain(formatPct(42311 / total(tanabe.base)));
  });

  test('going back up removes the facility panel again and a new area re-uses the same nodes', () => {
    const { q, store } = setup({ selectedArea: '30206' });
    const kpiBefore = q('.kpi-value');
    expect(q('.town-facilities')).not.toBeNull();
    store.set({ selectedPref: '30', selectedArea: undefined }); // what goUp / the back button sends
    expect(q('.town-facilities')).toBeNull();
    store.set({ selectedArea: '30201' });
    expect(q('.town-name')?.textContent).toBe('和歌山市');
    expect(q('.town-facilities')).not.toBeNull();
    expect(q('.kpi-value')).toBe(kpiBefore);
  });

  test('the four tiles show population, change since 2020, 65+ share and 0-14 share with the basis badge', () => {
    const { kpis, q, store } = setup({ selectedArea: '30206', year: 2020 });
    const labels = [...document.querySelectorAll('.kpi-label')].map((e) => e.textContent);
    expect(labels).toEqual(['2020年の人口', '2020年との比較', '65歳以上の割合', '0〜14歳の割合']);
    expect(q('.kpi .badge-official')?.textContent).toBe('実績（国勢調査）');
    store.set({ year: 2035 });
    expect(q('.kpi .badge-official')?.textContent).toBe('公式推計');
    store.set({ year: 2100 });
    expect(q('.kpi .badge-estimate')?.textContent).toBe('試算');
    expect(kpis()).toHaveLength(4);
  });
});

describe('mountTownPanel: updates only what changed', () => {
  test('a new year keeps the root, the tiles and the facility rows and only changes their text', () => {
    const { section, q, kpis, store } = setup({ selectedArea: '30206', year: 2050 });
    const root = q('.town')!;
    const tile = q('.kpi-value')!;
    const row = q('tr[data-facility-id="general_hospital"]')!;
    const summary = q('.facility-summary')!.textContent;
    const before = kpis()[0];
    store.set({ year: 2100 });
    expect(q('.town')).toBe(root);
    expect(section.firstElementChild?.tagName).toBe('H2');
    expect(q('.kpi-value')).toBe(tile);
    expect(q('tr[data-facility-id="general_hospital"]')).toBe(row);
    expect(kpis()[0]).not.toBe(before);
    expect(q('.facility-summary')!.textContent).not.toBe(summary);
    expect(q('.facility-summary')!.textContent).toBe('全48種類のうち29種類が目安を下回ります');
  });

  test('the series lines are not redrawn on a year change; the marker moves', () => {
    const { q, store } = setup({ selectedArea: '30206', year: 2020 });
    const official = q('path.line-official')!;
    const x0 = q('.chart-marker')!.getAttribute('x1');
    store.set({ year: 2075 });
    expect(q('path.line-official')).toBe(official);
    expect(q('.chart-marker')!.getAttribute('x1')).not.toBe(x0);
    expect(q('.chart-marker-label')!.textContent).toBe('2075年');
  });

  test('the data table carries a quiet note that the app recomputes the official method, under the table, without changing a number', () => {
    const { q, section } = setup({ selectedArea: '30206', year: 2050 });
    const note = q('.series-figure .chart-table .chart-table-note')!;
    expect(note.textContent).toBe(TABLE_NOTE);
    expect(note.classList.contains('note')).toBe(true);
    expect(note.textContent).toContain('社人研が発表した値');
    expect(note.textContent).toContain('公表された仮定から公式の方法で計算し直しています');
    expect(note.textContent).toContain('数人違うことがあります');
    expect(note.textContent).not.toContain('予測');
    expect(section.querySelectorAll('.chart-table-note')).toHaveLength(1); // only the series table has it
    expect(q('.series-figure .chart-table')!.lastElementChild).toBe(note); // after the table wrapper
    expect(note.previousElementSibling?.classList.contains('table-wrap')).toBe(true);
    const rows = chartRows(section);
    expect([rows.get(2050)![0], rows.get(2050)![1]]).toEqual(['42,309', '42,311']); // numbers untouched
  });

  test('the 試算 badge sits on the panel heading only after 2050', () => {
    const { section, store } = setup({ year: 2050 });
    const badge = () => section.querySelector('.panel-title .badge-estimate');
    expect(badge()).toBeNull();
    store.set({ year: 2055 });
    expect(badge()?.textContent).toBe('試算');
    store.set({ year: 2045 });
    expect(badge()).toBeNull();
  });

  test('the baseline line appears when the scenario differs from the default and goes away when it is restored', () => {
    const { q, store, section } = setup({ selectedArea: '30206', year: 2050 });
    expect(q('path.line-baseline')).toBeNull();
    expect(section.querySelectorAll('.series-figure .chart-legend li')).toHaveLength(2);
    store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.2 } });
    expect(q('path.line-baseline')).not.toBeNull();
    expect(section.querySelectorAll('.series-figure .chart-legend li')).toHaveLength(3);
    store.set({ scenario: DEFAULT_SCENARIO });
    expect(q('path.line-baseline')).toBeNull();
  });

  test('the infrastructure note follows the scenario', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2100 });
    expect(section.textContent).not.toContain('インフラ連動の過疎の加速（仮定）');
    store.set({ scenario: { ...DEFAULT_SCENARIO, infraStrength: 0.005 } });
    expect(section.textContent).toContain('インフラ連動の過疎の加速（仮定）が有効です');
  });
});

describe('mountTownPanel: facility panel details', () => {
  test('essential facilities are the primary list and the other 40 sit in a collapsed group', () => {
    const { q } = setup({ selectedArea: '30206', year: 2100 });
    const primary = q('.town-facilities > .table-wrap')!;
    expect(primary.querySelectorAll('tr[data-facility-id]')).toHaveLength(8);
    const others = q<HTMLDetailsElement>('details.facility-others')!;
    expect(others.open).toBe(false);
    expect(others.querySelector('summary')?.textContent).toBe('その他の施設（40）');
    expect(others.querySelectorAll('tr[data-facility-id]')).toHaveLength(40);
  });

  test('田辺市 in 2100: 29 of 48 are below the guide, the thresholds are printed, the permanent note is there', () => {
    const { q, section } = setup({ selectedArea: '30206', year: 2100 });
    expect(q('.facility-summary')!.textContent).toBe('全48種類のうち29種類が目安を下回ります');
    expect(q('tr[data-facility-id="stationery_books"] .facility-guide')!.textContent).toBe('目安：1,500人（50%）〜 2,500人（80%）');
    expect(q('tr[data-facility-id="grocery"] .facility-guide')!.textContent).toBe('目安：500人');
    expect(q('tr[data-facility-id="stationery_books"] .tag')!.textContent).toBe('人口の目安を上回る');
    expect(q('tr[data-facility-id="general_hospital"] .tag')!.textContent).toBe('境目');
    expect(q('tr[data-facility-id="grocery"] .tag')!.textContent).toBe('人口の目安を上回る');
    expect(q('tr[data-facility-id="university"] .tag')!.textContent).toBe('人口の目安を下回る');
    expect(section.textContent).toContain(PERMANENT_NOTE);
    expect(q('.town-facilities .badge-estimate')?.textContent).toBe('試算');
    expect(section.textContent).not.toContain('三大都市圏にあるため');
  });

  test('千代田区 gets the metropolitan-area note, 札幌市中央区 does not', () => {
    const { section, store } = setup({ selectedArea: '13101' });
    expect(section.textContent).toContain('この町は三大都市圏にあるため、表の対象外です。参考として表示します。');
    store.set({ selectedArea: '01101' });
    expect(section.textContent).not.toContain('三大都市圏にあるため');
  });

  test('a village without age assumptions (青ヶ島村) still renders every part', () => {
    const { q, kpis } = setup({ selectedArea: '13402', year: 2100 });
    expect(q('.town-name')?.textContent).toBe('青ヶ島村');
    expect(kpis()).toHaveLength(4);
    expect(q('.town-facilities')).not.toBeNull();
  });
});

describe('mountTownPanel: wording', () => {
  test('never says 残せない, never calls a figure 予測, and uses 閉鎖 only in the fixed note that denies it', () => {
    const { section, store } = setup({ selectedArea: '30206' });
    for (const year of [2020, 2050, 2100]) {
      for (const sel of [{ selectedArea: '30206' }, { selectedArea: '13101' }, { selectedPref: '30' }, { selectedPref: undefined }]) {
        store.set({ year, ...sel });
        const text = section.textContent!.replace(PERMANENT_NOTE, '').replace(/予測ではありません/g, '');
        expect(text).not.toContain('残せない');
        expect(text).not.toContain('閉鎖');
        expect(text).not.toContain('予測');
        expect(text).not.toMatch(/残す|残さ|守る|維持すべき|おすすめ/);
        expect(text).not.toMatch(/[\u2190-\u21FF\u25B2\u25B6\u25BC\u2460-\u2473]/); // arrows and circled numbers
      }
    }
  });

  test('uses the wave dash in age labels, never the fullwidth tilde', () => {
    const { section } = setup({ selectedArea: '30206' });
    expect(section.textContent).toContain('0〜14歳の割合');
    expect(section.textContent).not.toContain('～');
  });
});

describe('mountTownPanel: teardown', () => {
  test('subscribes once and leaves no subscriber behind', () => {
    let live = 0;
    const wrap = (s: Store): Store => ({
      get: s.get,
      set: s.set,
      subscribe(fn) {
        live++;
        const off = s.subscribe(fn);
        return () => {
          live--;
          off();
        };
      },
    });
    const { store, section, teardown } = setup({}, wrap);
    expect(live).toBe(1);
    store.set({ selectedArea: '30206' });
    teardown();
    expect(live).toBe(0);
    expect(section.querySelector('.town')).toBeNull();
    expect(section.querySelector('.panel-title')).not.toBeNull();
    expect(() => store.set({ year: 2100, selectedArea: '30201' })).not.toThrow();
    expect(section.querySelector('.town')).toBeNull();
    mounted = undefined;
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1: behaviours that no test used to pin down
// ---------------------------------------------------------------------------------------------------------------

const people = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const fmt = (n: number) => people.format(Math.round(n));

/** Rows of the chart's data table: year -> [official, estimate, baseline?] cell texts. */
function chartRows(section: HTMLElement): Map<number, string[]> {
  const rows = new Map<number, string[]>();
  for (const tr of section.querySelectorAll('.series-figure tbody tr')) {
    const year = Number(tr.querySelector('th')!.textContent!.replace('年', ''));
    rows.set(year, [...tr.querySelectorAll('td')].map((td) => td.textContent!));
  }
  return rows;
}

/** Cells of the pyramid's footer: [合計, 男, 女, 計]. */
const pyramidFoot = (section: HTMLElement) => [...section.querySelectorAll('.pyramid-figure tfoot td')].map((td) => td.textContent!);
const barWidths = (section: HTMLElement, sex: 'm' | 'f') => [...section.querySelectorAll(`path.pyr-bar.pyr-${sex}`)].map((p) => Number(p.getAttribute('data-w')));
const tile = (section: HTMLElement, i: number) => section.querySelectorAll('.kpi')[i].querySelector('.kpi-value')!.textContent!;

const sumOver = (list: Area[], f: (a: Area) => number) => list.reduce((s, a) => s + f(a), 0);

describe('the official line, through the panel', () => {
  test('a town: the 2020 census total and the official 2050 total, next to this app\'s estimate', () => {
    const { section } = setup({ selectedArea: '30206' });
    const rows = chartRows(section);
    expect(rows.get(2020)![0]).toBe(fmt(total(tanabe.base)));
    expect(rows.get(2020)![0]).toBe('69,870');
    expect(rows.get(2050)![0]).toBe('42,309'); // official workbook value
    expect(rows.get(2050)![1]).toBe('42,311'); // engine output (Ruling 15)
    expect(rows.get(2025)![0]).toBe(fmt(tanabe.official[2025]));
    expect(rows.get(2025)![1]).toBe('－'); // the estimate line starts at 2050
    expect(rows.get(2100)![0]).toBe('－');
  });

  test('a prefecture sums every area of it, villages (no age assumptions) included', () => {
    const tokyo = areas.filter((a) => a.prefCode === '13');
    expect(tokyo.some((a) => a.assumptions === null)).toBe(true); // the villages are in the sum
    const { section, store } = setup();
    store.set({ selectedPref: '13' });
    const rows = chartRows(section);
    expect(rows.get(2050)![0]).toBe(fmt(sumOver(tokyo, (a) => a.official[2050])));
    expect(rows.get(2050)![0]).toBe('14,399,144');
    expect(rows.get(2020)![0]).toBe(fmt(sumOver(tokyo, (a) => total(a.base))));
    expect(rows.get(2030)![0]).toBe(fmt(sumOver(tokyo, (a) => a.official[2030])));
  });

  test('Japan sums all 1,884 areas', () => {
    const { section } = setup();
    const rows = chartRows(section);
    expect(areas).toHaveLength(1884);
    expect(rows.get(2020)![0]).toBe(fmt(sumOver(areas, (a) => total(a.base))));
    expect(rows.get(2020)![0]).toBe('126,146,099');
    expect(rows.get(2050)![0]).toBe(fmt(sumOver(areas, (a) => a.official[2050])));
    expect(rows.get(2050)![0]).toBe('104,686,386');
  });

  test('a group that lists a code the data does not have skips it instead of stopping or failing', () => {
    const w = syntheticWorld();
    const { section, store } = setup({ year: 2020 }, undefined, w);
    store.set({ selectedPref: '99' }); // groups.prefs['99'] = ['99999' (unknown), '99001', '99002']
    const rows = chartRows(section);
    expect(rows.get(2020)![0]).toBe(fmt(499.6 + 2499.6));
    expect(rows.get(2050)![0]).toBe(fmt(499.6 + 2499.6));
    expect(tile(section, 0)).toBe('2,999人'); // formatPop(2999.2), the 2020 census total of the two towns
    expect(pyramidFoot(section)[3]).toBe('2,999');
  });
});

describe('key tiles carry the right shares', () => {
  test('田辺市: 65+ and 0-14 shares in 2050 and 2100', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2050 });
    expect(tile(section, 2)).toBe('48.8%');
    expect(tile(section, 3)).toBe('8.0%');
    store.set({ year: 2100 });
    expect(tile(section, 2)).toBe('51.6%');
    expect(tile(section, 3)).toBe('7.2%');
    const labels = [...section.querySelectorAll('.kpi-label')].map((e) => e.textContent);
    expect(labels[2]).toBe('65歳以上の割合');
    expect(labels[3]).toBe('0〜14歳の割合');
  });

  test('0-14 means the first three classes (0-4, 5-9, 10-14), 65+ means class 13 and above', () => {
    const { section } = setup({ selectedArea: '30206', year: 2020 });
    const p = tanabe.base;
    const all = total(p);
    const child = [0, 1, 2].reduce((s, i) => s + p.M[i] + p.F[i], 0);
    const elderly = Array.from({ length: 7 }, (_, k) => k + 13).reduce((s, i) => s + p.M[i] + p.F[i], 0);
    expect(tile(section, 3)).toBe(`${((child / all) * 100).toFixed(1)}%`);
    expect(tile(section, 2)).toBe(`${((elderly / all) * 100).toFixed(1)}%`);
    expect(tile(section, 3)).not.toBe(`${(([0, 1].reduce((s, i) => s + p.M[i] + p.F[i], 0) / all) * 100).toFixed(1)}%`);
  });
});

describe('the facility panel is judged on the unrounded population', () => {
  test('499.6 people are below a guide of 500 and 2,499.6 are at the edge of 2,500, not above it', () => {
    const w = syntheticWorld();
    const a = setup({ selectedArea: '99001', year: 2020 }, undefined, w);
    expect(a.q('tr[data-facility-id="grocery"] .tag')!.textContent).toBe('人口の目安を下回る'); // 500 if rounded: ok
    expect(a.q('.facility-summary')!.textContent).toBe(summaryLine(evaluateFacilities(499.6, w.data.facilities).belowCount, 48));
    expect(evaluateFacilities(500, w.data.facilities).belowCount).not.toBe(evaluateFacilities(499.6, w.data.facilities).belowCount);
    a.teardown();
    mounted = undefined;
    document.body.replaceChildren();

    const b = setup({ selectedArea: '99002', year: 2020 }, undefined, w);
    expect(b.q('tr[data-facility-id="stationery_books"] .tag')!.textContent).toBe('境目'); // 2,500 if rounded: ok
  });
});

describe('DOM order of the facility panel', () => {
  test('the essential table comes before the collapsed group, which comes before the permanent note', () => {
    const { q } = setup({ selectedArea: '30206' });
    const essential = q('.town-facilities > .table-wrap')!;
    const others = q('.town-facilities > details.facility-others')!;
    const note = q('.town-facilities > .facility-note')!;
    expect(essential.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(others.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(essential.querySelectorAll('tr[data-facility-id]')).toHaveLength(8);
    expect(others.contains(essential)).toBe(false);
  });
});

describe('numbers follow a scenario change and come back', () => {
  const alt: Scenario = { ...DEFAULT_SCENARIO, cwrMult: 1.2 };
  const japan2100 = (s: Scenario) => {
    const series = runner.run(s);
    return [...series.values()].reduce((sum, ser) => sum + total(ser[2100]), 0);
  };

  test('Japan 2100: tile, pyramid and chart show the new total, then the old one again', () => {
    const { section, store } = setup({ year: 2100 });
    expect(pyramidFoot(section)[3]).toBe('63,279,524');
    expect(tile(section, 0)).toBe('6,328万人');
    expect(chartRows(section).get(2100)![1]).toBe('63,279,524');

    store.set({ scenario: alt });
    expect(fmt(japan2100(alt))).toBe('70,933,736');
    expect(pyramidFoot(section)[3]).toBe('70,933,736');
    expect(tile(section, 0)).toBe('7,093万人');
    expect(chartRows(section).get(2100)![1]).toBe('70,933,736');
    expect(chartRows(section).get(2100)![2]).toBe('63,279,524'); // the default-scenario column

    store.set({ scenario: DEFAULT_SCENARIO });
    expect(pyramidFoot(section)[3]).toBe(fmt(japan2100(DEFAULT_SCENARIO)));
    expect(pyramidFoot(section)[3]).toBe('63,279,524');
    expect(tile(section, 0)).toBe('6,328万人');
  });

  test('a town changes too, and its pyramid bars with it', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2100 });
    const before = barWidths(section, 'f');
    store.set({ scenario: alt });
    const after = barWidths(section, 'f');
    expect(after).not.toEqual(before);
    const p = runner.run(alt).get('30206')![2100];
    expect(pyramidFoot(section)[3]).toBe(fmt(total(p)));
  });
});

describe('pyramid, through the panel', () => {
  test('rows and footer are the projected population of the selected year (田辺市 2050 = 42,311)', () => {
    const { section } = setup({ selectedArea: '30206', year: 2050 });
    const p = runner.run(DEFAULT_SCENARIO).get('30206')![2050];
    const rows = [...section.querySelectorAll('.pyramid-figure tbody tr')].map((tr) => [...tr.querySelectorAll('th, td')].map((c) => c.textContent));
    expect(rows).toHaveLength(20);
    rows.forEach((r, i) => {
      expect(r.slice(1)).toEqual([fmt(p.M[i]), fmt(p.F[i]), fmt(p.M[i] + p.F[i])]);
    });
    const male = p.M.reduce((s, v) => s + v, 0);
    const female = p.F.reduce((s, v) => s + v, 0);
    expect(pyramidFoot(section)).toEqual(['合計', fmt(male), fmt(female), fmt(male + female)]);
    expect(pyramidFoot(section)[3]).toBe('42,311');
    expect(male + female).toBeCloseTo(total(p), 6);
  });
});

describe('the pyramid axis is fixed over all years (Ruling 29)', () => {
  const series = runner.run(DEFAULT_SCENARIO);
  const tanabeSeries = series.get('30206')!;
  const YEARS = Array.from({ length: 17 }, (_, i) => 2020 + 5 * i);
  const peakOf = (y: number) => Math.max(...tanabeSeries[y].M, ...tanabeSeries[y].F);
  const axisMax = pyramidScale(Math.max(...YEARS.map(peakOf))).max;

  test('every bar in every year is value / axis maximum of the half width, for both sexes', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2020 });
    for (const y of [2020, 2050, 2100]) {
      store.set({ year: y });
      const wm = barWidths(section, 'm');
      const wf = barWidths(section, 'f');
      for (let i = 0; i < 20; i++) {
        expect(wm[i]).toBeCloseTo((tanabeSeries[y].M[i] / axisMax) * PYRAMID_HALF_WIDTH, 2);
        expect(wf[i]).toBeCloseTo((tanabeSeries[y].F[i] / axisMax) * PYRAMID_HALF_WIDTH, 2);
      }
    }
  });

  test('stepping from 2020 to 2100 shrinks a bar exactly like its value (田辺市 2100 uses about a quarter of the width)', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2020 });
    const w2020 = barWidths(section, 'f');
    const ticks2020 = [...section.querySelectorAll('.pyramid-svg .pyr-axis text')].map((t) => t.textContent);
    store.set({ year: 2100 });
    const w2100 = barWidths(section, 'f');
    const ticks2100 = [...section.querySelectorAll('.pyramid-svg .pyr-axis text')].map((t) => t.textContent);
    expect(ticks2100).toEqual(ticks2020);
    for (const i of [4, 9, 14, 16]) {
      expect(w2100[i] / w2020[i]).toBeCloseTo(tanabeSeries[2100].F[i] / tanabeSeries[2020].F[i], 3);
    }
    const widest2100 = Math.max(...w2100, ...barWidths(section, 'm'));
    expect(widest2100 / PYRAMID_HALF_WIDTH).toBeGreaterThan(0.15);
    expect(widest2100 / PYRAMID_HALF_WIDTH).toBeLessThan(0.35);
  });

  test('the axis comes from both sexes: the widest bar (a female one) fits inside the half', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2020 });
    const peakM = Math.max(...YEARS.flatMap((y) => tanabeSeries[y].M));
    const peakF = Math.max(...YEARS.flatMap((y) => tanabeSeries[y].F));
    expect(peakF).toBeGreaterThan(peakM); // the case where a male-only axis would overflow
    for (const y of YEARS) {
      store.set({ year: y });
      for (const w of [...barWidths(section, 'm'), ...barWidths(section, 'f')]) expect(w).toBeLessThanOrEqual(PYRAMID_HALF_WIDTH + 1e-6);
    }
  });

  test('a new scenario recomputes the axis of the same place (千代田区 grows, so its axis widens)', () => {
    const alt: Scenario = { ...DEFAULT_SCENARIO, cwrMult: 1.4, migScale: 1.5 };
    const peakOver = (s: Scenario) => Math.max(...YEARS.flatMap((y) => [...runner.run(s).get('13101')![y].M, ...runner.run(s).get('13101')![y].F]));
    const axisDefault = pyramidScale(peakOver(DEFAULT_SCENARIO)).max;
    const axisAlt = pyramidScale(peakOver(alt)).max;
    expect(axisAlt).toBeGreaterThan(axisDefault); // 4,000 -> 7,500 people per age class
    const { section, store } = setup({ selectedArea: '13101', year: 2100 });
    const p = (s: Scenario) => runner.run(s).get('13101')![2100];
    expect(barWidths(section, 'f')[14]).toBeCloseTo((p(DEFAULT_SCENARIO).F[14] / axisDefault) * PYRAMID_HALF_WIDTH, 2);
    store.set({ scenario: alt });
    expect(barWidths(section, 'f')[14]).toBeCloseTo((p(alt).F[14] / axisAlt) * PYRAMID_HALF_WIDTH, 2);
    for (const w of [...barWidths(section, 'm'), ...barWidths(section, 'f')]) expect(w).toBeLessThanOrEqual(PYRAMID_HALF_WIDTH + 1e-6);
    store.set({ scenario: DEFAULT_SCENARIO });
    expect(barWidths(section, 'f')[14]).toBeCloseTo((p(DEFAULT_SCENARIO).F[14] / axisDefault) * PYRAMID_HALF_WIDTH, 2);
  });

  test('the axis is per place: a new selection gets its own', () => {
    const { section, store } = setup({ selectedArea: '30206', year: 2020 });
    const widest = () => Math.max(...barWidths(section, 'm'), ...barWidths(section, 'f'));
    const w0 = widest();
    store.set({ selectedArea: '30201' }); // 和歌山市
    const axisWakayama = pyramidScale(Math.max(...YEARS.flatMap((y) => [...series.get('30201')![y].M, ...series.get('30201')![y].F]))).max;
    const peak2020 = Math.max(...series.get('30201')![2020].M, ...series.get('30201')![2020].F);
    expect(widest()).toBeCloseTo((peak2020 / axisWakayama) * PYRAMID_HALF_WIDTH, 2);
    expect(widest()).not.toBeCloseTo(w0, 2);
  });
});

describe('the line chart maps values from zero', () => {
  test('the zero gridline is the bottom; points sit at value / maximum of the way up; the marker dot lies on the line', () => {
    const { section, q, store } = setup({ selectedArea: '30206', year: 2050 });
    const svg = q('.series-svg')!;
    const grid = [...svg.querySelectorAll('line.chart-grid')].map((l) => Number(l.getAttribute('y1')));
    const y0 = grid[0];
    const yTop = grid[grid.length - 1];
    expect([...svg.querySelectorAll('.chart-tick')][0].textContent).toBe('0');
    // absolute frame: the 0 gridline is the bottom of the plot and the top gridline is its top
    expect(y0).toBe(SERIES_VIEW.height - SERIES_VIEW.bottom);
    expect(yTop).toBe(SERIES_VIEW.top);
    expect(grid).toEqual([...grid].sort((a, b) => b - a)); // 0 at the bottom, ticks rise
    const pts = (cls: string) => (svg.querySelector(`path.${cls}`)!.getAttribute('d')!.match(/-?\d+(\.\d+)?,-?\d+(\.\d+)?/g) ?? []).map((s) => s.split(',').map(Number));
    const official = pts('line-official'); // 2020, 2025 ... 2050
    const values = [total(tanabe.base), ...[2025, 2030, 2035, 2040, 2045, 2050].map((y) => tanabe.official[y as 2025])];
    expect(official).toHaveLength(7);
    const up = (y: number) => y0 - y;
    values.forEach((v, i) => expect(up(official[i][1]) / up(official[0][1])).toBeCloseTo(v / values[0], 3));
    expect(yTop).toBeLessThan(Math.min(...official.map((p) => p[1])));
    // the top gridline is a clean number at or above the highest plotted value, and its label says so
    const implied = (values[0] * (y0 - yTop)) / up(official[0][1]);
    expect(implied).toBeGreaterThanOrEqual(Math.max(...values) - 1);
    expect(implied).toBeLessThan(Math.max(...values) * 1.6);
    const yLabels = [...svg.querySelectorAll('.chart-tick')].slice(0, grid.length).map((t) => t.textContent);
    expect(yLabels[yLabels.length - 1]).toBe(formatAxisCount(Math.round(implied)));
    // the marker dot is on the line at the selected year
    const dot = svg.querySelector('circle.dot-marker')!;
    expect(Number(dot.getAttribute('cy'))).toBeCloseTo(official[6][1], 1); // the path is printed to 0.1
    store.set({ year: 2020 });
    expect(Number(svg.querySelector('circle.dot-marker')!.getAttribute('cy'))).toBeCloseTo(official[0][1], 1);
    void section;
  });
});

describe('while the map shows a reallocation, one quiet note says the tiles are before it', () => {
  // 和歌山県 +10% in 2100: every Wakayama area at +10% (enough for the note; the change of the rest does not matter).
  const wakayama = areas.filter((a) => a.prefCode === '30').map((a) => a.code);
  const overlay = (year = 2100): AllocationOverlay => ({
    year,
    label: '和歌山県 +10%',
    changePercent: Object.fromEntries(wakayama.map((c) => [c, 10])),
    flips: [],
  });
  const note = (section: HTMLElement) => section.querySelector<HTMLElement>('.town-alloc-note')!;
  const NOTE = (pop: string) => `地図は割り振り後（${pop}）です。この欄の数字は割り振り前です。`;

  test('a prefecture and a town: the after-population from the series times 1.1, the tiles unchanged', () => {
    const { store, section, kpis } = setup({ year: 2100, selectedPref: '30' });
    const series = runner.run(DEFAULT_SCENARIO);
    const before = wakayama.reduce((t, c) => t + total(series.get(c)![2100]), 0);
    expect(note(section).hidden).toBe(true);
    const tiles = kpis();
    store.set({ allocation: overlay() });
    expect(note(section).hidden).toBe(false);
    expect(note(section).textContent).toBe(NOTE(formatPop(before * 1.1)));
    expect(kpis()).toEqual(tiles); // the tiles stay before the allocation
    expect(kpis()[0]).toContain(formatPop(before).replace(/(万人|人)$/, ''));
    expect(note(section).getAttribute('role')).toBeNull(); // quiet: not a live region
    store.set({ selectedArea: '30344' });
    expect(note(section).textContent).toBe(NOTE(formatPop(total(series.get('30344')![2100]) * 1.1)));
  });

  test('gone for another year, for a place outside the overlay, and when the overlay is cleared', () => {
    const { store, section } = setup({ year: 2100, selectedArea: '30344' });
    store.set({ allocation: overlay() });
    expect(note(section).hidden).toBe(false);
    store.set({ year: 2080 }); // the map's allocation is for 2100
    expect(note(section).hidden).toBe(true);
    store.set({ year: 2100 });
    expect(note(section).hidden).toBe(false);
    store.set({ selectedArea: '13101' }); // not in this overlay
    expect(note(section).hidden).toBe(true);
    store.set({ selectedArea: '30344' });
    store.set({ allocation: undefined });
    expect(note(section).hidden).toBe(true);
    expect(note(section).textContent).toBe('');
  });
});

describe('a second mount into the same element replaces the first', () => {
  test('one subscription, one panel; the first teardown cannot harm the second mount', () => {
    let live = 0;
    const base = createAppStore(runner, data, { selectedArea: '30206' });
    const counting: Store = {
      get: base.get,
      set: base.set,
      subscribe(fn) {
        live++;
        const off = base.subscribe(fn);
        let on = true;
        return () => {
          if (on) live--; // like the real store, unsubscribing twice is harmless
          on = false;
          off();
        };
      },
    };
    const section = document.createElement('section');
    section.innerHTML = '<h2 class="panel-title">町の詳細</h2>';
    document.body.append(section);
    const first = mountTownPanel(section, { store: counting, data, runner });
    expect(live).toBe(1);
    const second = mountTownPanel(section, { store: counting, data, runner });
    expect(live).toBe(1);
    expect(section.querySelectorAll('.town')).toHaveLength(1);
    expect(section.querySelectorAll('.series-svg')).toHaveLength(1);
    base.set({ year: 2100 });
    expect(section.querySelector('.kpi-label')!.textContent).toBe('2100年の人口');
    first(); // a stale handle
    expect(section.querySelectorAll('.town')).toHaveLength(1);
    expect(live).toBe(1);
    second();
    expect(live).toBe(0);
    expect(section.querySelector('.town')).toBeNull();
  });
});

/**
 * The real data plus a prefecture 99 with two made-up towns of exactly 499.6 and 2,499.6 people in 2020 (all men aged
 * 40-44, so the 2020 population is the census base as is) and a group that also lists a code with no data. The
 * made-up prefecture has no villages, so no real result changes.
 */
function syntheticWorld(): World {
  const zeros = () => new Array<number>(20).fill(0);
  const make = (code: string, name: string, people: number): Area => {
    const M = zeros();
    M[8] = people;
    return {
      ...tanabe,
      code,
      name,
      prefCode: '99',
      prefName: 'テスト県',
      base: { M, F: zeros() },
      official: { 2025: people, 2030: people, 2035: people, 2040: people, 2045: people, 2050: people },
    };
  };
  const syn: AppData = {
    ...data,
    areas: [...areas, make('99001', 'テスト町', 499.6), make('99002', 'テスト村', 2499.6)],
    groups: { cities: groups.cities, prefs: { ...groups.prefs, '99': ['99999', '99001', '99002'] } },
    prefNames: new Map([...data.prefNames, ['99', 'テスト県']]),
  };
  return { data: syn, runner: createRunner(syn) };
}
