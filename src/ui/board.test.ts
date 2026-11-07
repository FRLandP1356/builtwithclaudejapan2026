// The pure part of the 「分かれ目」 panel, on the real data (1,884 areas, 48 facilities) and on small worlds.
import { describe, expect, test } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import type { Facility } from '../engine/types';
import {
  alreadyBelowAreas,
  alreadyBelowText,
  BOARD_ESSENTIAL_NOTE,
  BOARD_GUIDE_NOTE,
  BOARD_NONE,
  BOARD_NONE_ESSENTIAL,
  BOARD_ROWS,
  barsSummary,
  boardBars,
  boardBarsLead,
  boardCrossings,
  boardHeading,
  essentialFacilities,
  moreText,
  repeatedYears,
  scopeGroups,
  scopeRows,
  townRows,
  townsText,
} from './board';
import { deriveTotals } from './derive';

const ctx = makeRealContext();
const { data, store } = ctx;
const totals = deriveTotals(store.get().series, data.groups);
const areaByCode = new Map(data.areas.map((a) => [a.code, a]));
const names = { area: (c: string) => areaByCode.get(c)?.name, prefOfArea: (c: string) => areaByCode.get(c)?.prefName };
const essential = essentialFacilities(data.facilities);

describe('wording', () => {
  test('the heading names the place and says 人口の目安を下回る, never 残せない', () => {
    expect(boardHeading('japan', '日本全体')).toBe('日本全体で、人口の目安を下回っていく順番');
    expect(boardHeading('pref', '和歌山県')).toBe('和歌山県で、人口の目安を下回っていく順番');
    expect(boardHeading('area', '田辺市')).toBe('田辺市で、人口の目安を下回る施設と、その年');
  });

  test('the towns of a row: the lead town alone, or with 「ほかN町」', () => {
    expect(townsText('田辺市', 0)).toBe('田辺市');
    expect(townsText('田辺市', 3)).toBe('田辺市 ほか3町');
    expect(townsText('歌志内市（北海道）', 12)).toBe('歌志内市（北海道） ほか12町');
  });

  test('what is already below in 2020: facilities for a town, towns for a scope', () => {
    expect(alreadyBelowText('area', 11)).toBe('2020年の時点で、すでに目安を下回る：11種類');
    expect(alreadyBelowText('pref', 12)).toBe('2020年の時点で、すでに主な8施設のいずれかの目安を下回る：12町');
    expect(alreadyBelowText('japan', 470)).toBe('2020年の時点で、すでに主な8施設のいずれかの目安を下回る：470町');
  });

  test('the strip\'s lead and summary', () => {
    expect(boardBarsLead('pref')).toBe('5年ごとに、新しく人口の目安を下回る町の数（主な8施設のいずれか）');
    expect(boardBarsLead('area')).toBe('5年ごとに、新しく人口の目安を下回る施設の数');
    const bars = { bars: [{ year: 2025, value: 2, estimate: false }, { year: 2030, value: 6, estimate: false }, { year: 2055, value: 6, estimate: true }], max: 6 };
    expect(barsSummary(bars, '町')).toBe('いちばん多いのは2030年と2055年（6町）。');
    expect(barsSummary({ bars: [bars.bars[1]], max: 6 }, '種類')).toBe('いちばん多いのは2030年（6種類）。');
    expect(barsSummary({ bars: [], max: 0 }, '町')).toBe('どの年にも、新しく下回るものはありません。');
    expect(moreText(12)).toBe('続きを見る（残り12件）');
  });

  test('three rows show before the fold (2026-11-07), and a row repeats the year of the one before it only inside its list', () => {
    expect(BOARD_ROWS).toBe(3);
    const y = (...years: number[]) => years.map((year) => ({ year }));
    expect(repeatedYears(y(2025, 2025, 2025, 2030, 2030, 2035))).toEqual([false, true, true, false, true, false]);
    expect(repeatedYears(y(2025))).toEqual([false]);
    expect(repeatedYears([])).toEqual([]);
  });

  test('nothing here says 残せない, 閉鎖, 撤退, 廃止, 予測 or 私, and nothing advises', () => {
    const all = [
      boardHeading('japan', '日本全体'),
      boardHeading('pref', '和歌山県'),
      boardHeading('area', '田辺市'),
      boardBarsLead('pref'),
      boardBarsLead('area'),
      BOARD_GUIDE_NOTE,
      BOARD_ESSENTIAL_NOTE,
      BOARD_NONE,
      BOARD_NONE_ESSENTIAL,
      alreadyBelowText('area', 3),
      alreadyBelowText('pref', 3),
      moreText(3),
      barsSummary({ bars: [{ year: 2030, value: 1, estimate: false }], max: 1 }, '町'),
    ].join('\n');
    for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', 'おすすめ', '守る', '→', '①']) expect(all, w).not.toContain(w);
    // the guide note says what the statistic is and that falling below decides nothing
    expect(BOARD_GUIDE_NOTE).toContain('国土交通省の統計（2009〜2012年）');
    expect(BOARD_GUIDE_NOTE).toContain('その施設がなくなると決まるわけではありません');
  });
});

describe('on the real data', () => {
  test('the eight essential facilities are the ones the facility panel calls 日々の暮らしに関わる主な施設', () => {
    expect(essential.map((f) => f.id)).toEqual(['grocery', 'post_office', 'bank', 'clinic', 'nursing_home', 'general_hospital', 'day_care', 'home_help']);
  });

  test('田辺市: no essential facility is newly below by 2100; 結婚式場業, 博物館、美術館 and 法律事務所 are the first of the others, in 2035', () => {
    const r = boardCrossings(totals, ['30206'], data.facilities);
    const rows = townRows(r.crossings, data.facilities, '田辺市');
    expect(rows.essential).toEqual([]);
    expect(rows.others.slice(0, 3).map((x) => `${x.year} ${x.facilityName}`)).toEqual(['2035 結婚式場業', '2035 博物館、美術館', '2035 法律事務所']);
    expect(rows.others.every((x) => x.leadCode === '30206' && x.leadName === '田辺市' && x.townsText === '' && !x.essential)).toBe(true);
    expect(rows.others.filter((x) => x.estimate).every((x) => x.year > 2050)).toBe(true);
    expect(r.alreadyBelow).toHaveLength(11);
    const bars = boardBars(r.crossings, totals.years, 'area');
    expect(bars.bars).toHaveLength(16);
    expect(bars.bars[0]).toEqual({ year: 2025, value: 0, estimate: false });
    expect(bars.bars.find((b) => b.year === 2035)).toEqual({ year: 2035, value: 3, estimate: false });
    expect(bars.bars.find((b) => b.year === 2065)).toEqual({ year: 2065, value: 4, estimate: true });
    expect(bars.max).toBe(4);
  });

  test('和歌山県: the earliest rows are 2025, 銀行 and 通所介護 for 美浜町 and one more town, then 訪問介護 for 日高川町', () => {
    const r = boardCrossings(totals, data.groups.prefs['30'], essential);
    const rows = scopeRows(scopeGroups(r.crossings, data.facilities), data.facilities, names, 'pref');
    expect(rows.slice(0, 3).map((x) => `${x.year} ${x.facilityName} ${x.townsText}`)).toEqual([
      '2025 銀行（中央銀行を除く） 美浜町 ほか1町',
      '2025 通所・短期入所介護事業 美浜町 ほか1町',
      '2025 訪問介護事業 日高川町',
    ]);
    expect(rows[0].leadCode).toBe('30381'); // 美浜町
    expect(rows[0].others).toBe(1);
    expect(rows.length).toBeGreaterThan(BOARD_ROWS);
    expect(alreadyBelowAreas(r, data.facilities)).toBe(12);
    const bars = boardBars(r.crossings, totals.years, 'pref');
    expect(bars.bars.map((b) => b.value)).toEqual([3, 1, 4, 1, 6, 2, 4, 3, 2, 3, 3, 5, 3, 4, 4, 3]);
    expect(bars.bars.filter((b) => b.estimate).map((b) => b.year)).toEqual([2055, 2060, 2065, 2070, 2075, 2080, 2085, 2090, 2095, 2100]);
  });

  test('the whole country: a town carries its prefecture, every row is an essential facility, the rows are sorted by year', () => {
    const codes = data.areas.map((a) => a.code);
    const r = boardCrossings(totals, codes, essential);
    const groups = scopeGroups(r.crossings, data.facilities);
    const rows = scopeRows(groups, data.facilities, names, 'japan');
    expect(rows).toHaveLength(128); // 16 years, 8 facilities, every pair has at least one town
    expect(rows[0]).toMatchObject({ year: 2025, facilityName: '飲食料品小売業', leadName: '売木村（長野県）', others: 2, townsText: '売木村（長野県） ほか2町' });
    expect(rows.every((x) => x.essential)).toBe(true);
    for (let i = 1; i < rows.length; i++) expect(rows[i].year).toBeGreaterThanOrEqual(rows[i - 1].year);
    expect(alreadyBelowAreas(r, data.facilities)).toBe(470);
    const bars = boardBars(r.crossings, totals.years, 'japan');
    expect(bars.bars.find((b) => b.year === 2025)?.value).toBe(98);
    expect(bars.max).toBe(156);
  });

  test('scopeGroups keeps the essential facilities only, even when the crossings hold every facility', () => {
    const r = boardCrossings(totals, data.groups.prefs['30'], data.facilities);
    const groups = scopeGroups(r.crossings, data.facilities);
    const ids = new Set(essential.map((f) => f.id));
    expect(groups.every((g) => ids.has(g.facilityId))).toBe(true);
    expect(groups).toHaveLength(62);
  });

  test('the four prefectures of 四国 each have rows, and the lead town of a row is the most populous one before the crossing', () => {
    for (const pp of ['36', '37', '38', '39']) {
      const r = boardCrossings(totals, data.groups.prefs[pp], essential);
      const groups = scopeGroups(r.crossings, data.facilities);
      const rows = scopeRows(groups, data.facilities, names, 'pref');
      expect(rows.length, pp).toBeGreaterThan(0);
      for (const [i, g] of groups.entries()) {
        const pops = g.items.map((c) => c.popBefore);
        expect(pops, `${pp} ${rows[i].year} ${rows[i].facilityName}`).toEqual([...pops].sort((a, b) => b - a));
      }
    }
  });
});

describe('on a small world', () => {
  const fac = (id: string, p50: number, essential: boolean): Facility => ({ id, name: `施設${id}`, p50, p80: p50, essential, excludesMetro: true, source: 't' });
  const F = [fac('a', 500, true), fac('b', 2000, false)];

  test('a town\'s rows split by essential; an unknown facility id is skipped', () => {
    const crossings = [
      { areaCode: 'X', facilityId: 'b', year: 2030, popBefore: 2100, pop: 1900 },
      { areaCode: 'X', facilityId: 'zzz', year: 2035, popBefore: 1000, pop: 900 },
      { areaCode: 'X', facilityId: 'a', year: 2060, popBefore: 600, pop: 450 },
    ];
    const rows = townRows(crossings, F, '町X');
    expect(rows.essential.map((r) => [r.year, r.facilityName, r.estimate])).toEqual([[2060, '施設a', true]]);
    expect(rows.others.map((r) => [r.year, r.facilityName, r.estimate])).toEqual([[2030, '施設b', false]]);
  });

  test('bars count towns for a scope and facilities for a town; years without a crossing are zero', () => {
    const crossings = [
      { areaCode: 'X', facilityId: 'a', year: 2030, popBefore: 600, pop: 450 },
      { areaCode: 'X', facilityId: 'b', year: 2030, popBefore: 2100, pop: 1900 },
      { areaCode: 'Y', facilityId: 'a', year: 2030, popBefore: 600, pop: 450 },
    ];
    const years = [2020, 2025, 2030, 2035];
    expect(boardBars(crossings, years, 'pref').bars.map((b) => b.value)).toEqual([0, 2, 0]);
    expect(boardBars(crossings, years, 'area').bars.map((b) => b.value)).toEqual([0, 3, 0]);
    expect(boardBars([], years, 'pref')).toEqual({ bars: [{ year: 2025, value: 0, estimate: false }, { year: 2030, value: 0, estimate: false }, { year: 2035, value: 0, estimate: false }], max: 0 });
  });
});
