// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { repoPath } from '../../test/helpers/paths';
import type { AppData } from '../data/loader';
import { createRunner } from '../data/runner';
import { total } from '../engine/aggregate';
import { DEFAULT_SCENARIO, type Groups } from '../engine/types';
import { deriveTotals } from './derive';
import { formatPct, formatPop } from './format';
import { PERMANENT_NOTE } from './facilityPanel';
import { createAppStore, type Store } from './state';
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

function setup(initial: Parameters<typeof createAppStore>[2] = {}, wrap?: (s: Store) => Store) {
  const baseStore = createAppStore(runner, data, initial);
  const store = wrap ? wrap(baseStore) : baseStore;
  const section = document.createElement('section');
  section.className = 'panel';
  section.id = 'panel-town';
  section.innerHTML = '<h2 class="panel-title" id="panel-town-title">町の詳細</h2>';
  document.body.append(section);
  const teardown = mountTownPanel(section, { store, data, runner });
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
