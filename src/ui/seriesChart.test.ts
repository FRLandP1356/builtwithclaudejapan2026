import { describe, expect, test } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { total } from '../engine/aggregate';
import { projectArea } from '../engine/project';
import { DEFAULT_SCENARIO, type Area, type Series } from '../engine/types';
import { formatAxisCount, niceScale, phrases, seriesPoints, seriesSummary, type SeriesPointsInput } from './seriesChart';

const areas = loadAllAreas();
const tanabe = byCode(areas, '30206');
const YEARS = Array.from({ length: 17 }, (_, i) => 2020 + 5 * i);

const row = (s: Series) => Float64Array.from(YEARS.map((y) => total(s[y])));
const officialOf = (a: Area): Record<number, number> => ({ 2020: total(a.base), ...a.official });

function input(over: Partial<SeriesPointsInput> = {}): SeriesPointsInput {
  const s = projectArea(tanabe, DEFAULT_SCENARIO);
  return { years: YEARS, official: officialOf(tanabe), estimate: row(s), baseline: row(s), year: 2050, ...over };
}

describe('seriesPoints', () => {
  test('the official line runs 2020..2050 from the census base and the official totals', () => {
    const p = seriesPoints(input());
    expect(p.official.map((q) => q.year)).toEqual([2020, 2025, 2030, 2035, 2040, 2045, 2050]);
    expect(p.official[0].value).toBe(total(tanabe.base));
    expect(p.official[6].value).toBe(42309); // the official workbook value for 田辺市 in 2050
  });

  test('the estimate line starts at 2050 and runs to 2100 so the dashed part joins the solid part', () => {
    const p = seriesPoints(input());
    expect(p.estimate.map((q) => q.year)).toEqual([2050, 2055, 2060, 2065, 2070, 2075, 2080, 2085, 2090, 2095, 2100]);
    expect(p.estimate[0].value).toBeCloseTo(42311, -1); // engine output, Ruling 15
    expect(Math.abs(p.estimate[0].value - p.official[6].value)).toBeLessThan(5);
    expect(p.estimate[10].value).toBeLessThan(p.estimate[0].value);
  });

  test('the baseline is dropped while the scenario equals the default', () => {
    expect(seriesPoints(input()).baseline).toBeNull();
    expect(seriesPoints(input({ baseline: null })).baseline).toBeNull();
    expect(seriesPoints(input({ baseline: undefined })).baseline).toBeNull();
  });

  test('the baseline appears (2050..2100) when the scenario changes the estimate', () => {
    const base = projectArea(tanabe, DEFAULT_SCENARIO);
    const alt = projectArea(tanabe, { ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    const p = seriesPoints(input({ estimate: row(alt), baseline: row(base) }));
    expect(p.baseline).not.toBeNull();
    expect(p.baseline!.map((q) => q.year)[0]).toBe(2050);
    expect(p.baseline![10].value).toBeCloseTo(total(base[2100]), 6);
    expect(p.estimate[10].value).toBeCloseTo(total(alt[2100]), 6);
    expect(p.estimate[10].value).toBeGreaterThan(p.baseline![10].value);
    // 2020..2050 are shared by every scenario, so the estimate and the baseline start at the same point
    expect(p.baseline![0].value).toBeCloseTo(p.estimate[0].value, 6);
  });

  test('the marker follows the selected year and sits on the official line up to 2050, on the estimate after', () => {
    const at = (year: number) => seriesPoints(input({ year })).marker;
    expect(at(2020)).toMatchObject({ year: 2020, line: 'official' });
    expect(at(2020).value).toBe(total(tanabe.base));
    expect(at(2050)).toMatchObject({ year: 2050, line: 'official', value: 42309 });
    expect(at(2075)).toMatchObject({ year: 2075, line: 'estimate' });
    expect(at(2100).value).toBeCloseTo(total(projectArea(tanabe, DEFAULT_SCENARIO)[2100]), 6);
  });

  test('the y axis starts at 0 and covers every plotted value', () => {
    const base = projectArea(tanabe, DEFAULT_SCENARIO);
    const alt = projectArea(tanabe, { ...DEFAULT_SCENARIO, cwrMult: 1.4, migScale: 1.5 });
    const p = seriesPoints(input({ estimate: row(alt), baseline: row(base) }));
    expect(p.ticks[0]).toBe(0);
    const maxValue = Math.max(...p.official.map((q) => q.value), ...p.estimate.map((q) => q.value), ...p.baseline!.map((q) => q.value));
    expect(p.yMax).toBeGreaterThanOrEqual(maxValue);
    expect(p.ticks[p.ticks.length - 1]).toBe(p.yMax);
  });

  test('rejects an estimate row of the wrong length', () => {
    expect(() => seriesPoints(input({ estimate: new Float64Array(3) }))).toThrow(RangeError);
  });
});

describe('seriesSummary', () => {
  test('names 2020, 2050 (official) and 2100 (this app\'s estimate) without arrows or the word 予測', () => {
    const text = seriesSummary(seriesPoints(input()));
    expect(text).toMatch(/^2020年 \d/);
    expect(text).toContain('2050年 4.2万人（公式推計）');
    expect(text).toMatch(/2100年 [\d.,億万]+人（このアプリの試算）$/);
    expect(text).not.toMatch(/予測|→|＞|▶/);
  });
});

describe('niceScale and formatAxisCount', () => {
  test('niceScale picks 1, 2, 2.5 or 5 times a power of ten and covers the maximum', () => {
    for (const [m, k] of [[3420, 3], [69000, 4], [126150000, 4], [1, 4], [999, 3]] as const) {
      const s = niceScale(m, k);
      expect(s.max).toBeGreaterThanOrEqual(m);
      expect(s.ticks.length - 1).toBeLessThanOrEqual(k);
      expect(s.ticks[0]).toBe(0);
      const mantissa = s.step / 10 ** Math.floor(Math.log10(s.step));
      expect([1, 2, 2.5, 5]).toContain(Number(mantissa.toFixed(6)));
    }
  });

  test('niceScale never returns an empty axis', () => {
    expect(niceScale(0, 4).max).toBeGreaterThan(0);
    expect(niceScale(Number.NaN, 4).max).toBeGreaterThan(0);
  });

  test('formatAxisCount spells numbers in full below 10,000 and compacts above', () => {
    expect(formatAxisCount(0)).toBe('0');
    expect(formatAxisCount(500)).toBe('500');
    expect(formatAxisCount(1500)).toBe('1,500');
    expect(formatAxisCount(10000)).toBe('1万');
    expect(formatAxisCount(25000)).toBe('2.5万');
    expect(formatAxisCount(1200000)).toBe('120万');
    expect(formatAxisCount(50000000)).toBe('5,000万');
    expect(formatAxisCount(120000000)).toBe('1.2億');
  });
});

describe('phrases', () => {
  test('cut after 。 and 、 and before （, and join back to the same text', () => {
    const text = '国土交通省の表（2009〜2012年の統計、三大都市圏を除く）にもとづく人口の目安です。施設の閉鎖を予測するものではありません。';
    const parts = phrases(text);
    expect(parts).toEqual(['国土交通省の表', '（2009〜2012年の統計、', '三大都市圏を除く）にもとづく人口の目安です。', '施設の閉鎖を予測するものではありません。']);
    expect(parts.join('')).toBe(text);
  });

  test('a text without cut points stays whole and an empty text gives no phrase', () => {
    expect(phrases('境目')).toEqual(['境目']);
    expect(phrases('')).toEqual([]);
  });
});
