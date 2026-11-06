import { readFileSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFinance } from '../../test/helpers/loadFinance';
import { repoPath } from '../../test/helpers/paths';
import type { Groups } from '../engine/types';
import { bandIndexFor, ownPerCapita, parseFinance, reiwaLabel, type Finance } from './finance';

const finance = loadFinance();
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(repoPath('public/data/finance.json'), 'utf8')) as Record<string, unknown>;

describe('public/data/finance.json (令和6年度 市町村別決算状況調, per-resident expenditure)', () => {
  test('is the fiscal 2024 data, with 1,741 municipalities, and stays well under 150 KB', () => {
    expect(finance.fiscalYear).toBe(2024);
    expect(finance.populationDate).toBe('2025-01-01');
    expect(Object.keys(finance.municipalities)).toHaveLength(1741);
    expect(finance.national.n).toBe(1741);
    expect(statSync(repoPath('public/data/finance.json')).size).toBeLessThan(150 * 1024);
  });

  test('the national figure is about 556 thousand yen per resident (all expenditure divided by all residents)', () => {
    expect(finance.national.perCapita).toBe(556);
    expect(finance.national.expenditure / finance.national.population).toBeCloseTo(555.85, 2);
    expect(finance.national.population).toBe(114_139_458 + 10_191_232);
    expect(finance.national.expenditure).toBe(61_157_309_360 + 7_951_913_768);
  });

  test('the seven bands are the research table (count, median, quartiles; thousand yen per resident)', () => {
    expect(finance.bands.map((b) => [b.min, b.max, b.n, b.median, b.p25, b.p75])).toEqual([
      [0, 5000, 302, 1733, 1390, 2353],
      [5000, 10000, 241, 1001, 783, 1332],
      [10000, 30000, 447, 724, 561, 883],
      [30000, 50000, 237, 584, 473, 690],
      [50000, 100000, 237, 502, 436, 599],
      [100000, 200000, 145, 473, 428, 556],
      [200000, null, 132, 477, 428, 530],
    ]);
    expect(finance.bands.reduce((s, b) => s + b.n, 0)).toBe(1741);
  });

  test('the published table is 地方財政白書 第39表 (令和5年度): four 団体区分 values', () => {
    expect(finance.published.fiscalYear).toBe(2023);
    expect(finance.published.rows).toEqual([
      { label: '中都市', perCapita: 454 },
      { label: '小都市', perCapita: 567 },
      { label: '町村（人口1万人以上）', perCapita: 581 },
      { label: '町村（人口1万人未満）', perCapita: 1237 },
    ]);
  });

  test('田辺市 spent 680 thousand yen per resident (45,807,592 thousand yen / 67,316 residents)', () => {
    expect(finance.municipalities['30206']).toEqual([680, 67_316]);
    expect(ownPerCapita(finance, '30206')).toBe(680);
    expect(Math.round(45_807_592 / 67_316)).toBe(680);
  });

  test('the bands agree with the municipalities: every count exactly, medians and quartiles within the rounding of the entries', () => {
    const entries = Object.values(finance.municipalities);
    finance.bands.forEach((band, i) => {
      const inBand = entries.filter(([, pop]) => bandIndexFor(finance.bands, pop) === i).map(([pc]) => pc);
      expect(inBand.length).toBe(band.n);
      const sorted = [...inBand].sort((a, b) => a - b);
      const at = (p: number) => {
        const h = (sorted.length + 1) * p;
        const lo = Math.floor(h);
        return sorted[lo - 1] + (sorted[lo] - sorted[lo - 1]) * (h - lo);
      };
      expect(Math.abs(at(0.5) - band.median)).toBeLessThanOrEqual(1);
      expect(Math.abs(at(0.25) - band.p25)).toBeLessThanOrEqual(1);
      expect(Math.abs(at(0.75) - band.p75)).toBeLessThanOrEqual(1);
    });
  });

  test('every area has an entry, except the wards of the 20 designated cities and the 浜通り area (no settlement of their own)', () => {
    const areas = loadAllAreas();
    const groups = JSON.parse(readFileSync(repoPath('public/data/groups.json'), 'utf8')) as Groups;
    const wardsOfDesignatedCities = new Set(Object.values(groups.cities).flat());
    expect(wardsOfDesignatedCities.size).toBe(175);
    const without = areas.filter((a) => ownPerCapita(finance, a.code) === undefined).map((a) => a.code);
    expect(new Set(without)).toEqual(new Set([...wardsOfDesignatedCities, '07999']));
    // the 23 special wards of Tokyo have their own settlement
    const special = areas.filter((a) => a.kind === 'ward' && !wardsOfDesignatedCities.has(a.code));
    expect(special).toHaveLength(23);
    for (const a of special) expect(ownPerCapita(finance, a.code), a.name).toBeGreaterThan(0);
    // and the designated cities themselves are in the file although the app has no area for them
    expect(ownPerCapita(finance, '01100')).toBe(629);
  });
});

describe('bandIndexFor (a band holds min <= residents < max)', () => {
  test('boundaries: 4,999 / 5,000 / 10,000 / 200,000 and their neighbours', () => {
    const at = (p: number) => bandIndexFor(finance.bands, p);
    expect([0, 1, 4999].map(at)).toEqual([0, 0, 0]);
    expect([5000, 9999].map(at)).toEqual([1, 1]);
    expect([10000, 29999].map(at)).toEqual([2, 2]);
    expect([30000, 49999].map(at)).toEqual([3, 3]);
    expect([50000, 99999].map(at)).toEqual([4, 4]);
    expect([100000, 199999].map(at)).toEqual([5, 5]);
    expect([200000, 200001, 14_000_000].map(at)).toEqual([6, 6, 6]);
  });

  test('works on any ascending band list, not on a fixed set of edges', () => {
    const bands = [{ min: 0 }, { min: 100 }, { min: 1000 }] as never;
    expect([0, 99, 100, 999, 1000, 5000].map((p) => bandIndexFor(bands, p))).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('ownPerCapita', () => {
  test('answers only for codes the file holds, never from the prototype chain', () => {
    expect(ownPerCapita(finance, '01101')).toBeUndefined();
    expect(ownPerCapita(finance, '99999')).toBeUndefined();
    expect(ownPerCapita(finance, 'constructor')).toBeUndefined();
    expect(ownPerCapita(finance, 'toString')).toBeUndefined();
    expect(ownPerCapita(finance, '__proto__')).toBeUndefined();
  });
});

describe('reiwaLabel', () => {
  test('2024 is 令和6年度 and 2023 is 令和5年度', () => {
    expect(reiwaLabel(2024)).toBe('令和6年度');
    expect(reiwaLabel(2023)).toBe('令和5年度');
  });
});

describe('parseFinance rejects a file that is not in the shape the panel relies on', () => {
  const mutate = (fn: (doc: Record<string, any>) => void): unknown => {
    const doc = raw() as Record<string, any>;
    fn(doc);
    return doc;
  };

  test('accepts the committed file and returns it as it is', () => {
    expect(parseFinance(raw())).toEqual(raw());
  });

  const bad: Array<[string, (d: Record<string, any>) => void]> = [
    ['fiscalYear missing', (d) => delete d.fiscalYear],
    ['populationDate not a string', (d) => (d.populationDate = 20250101)],
    ['national missing', (d) => delete d.national],
    ['national.perCapita not a count', (d) => (d.national.perCapita = 'x')],
    ['bands missing', (d) => delete d.bands],
    ['a single band', (d) => (d.bands = d.bands.slice(0, 1))],
    ['the first band does not start at 0', (d) => (d.bands[0].min = 1)],
    ['a gap between two bands', (d) => (d.bands[2].max = 29000)],
    ['the last band is closed', (d) => (d.bands[6].max = 300000)],
    ['an open band in the middle', (d) => (d.bands[3].max = null)],
    ['a band with no municipality', (d) => (d.bands[1].n = 0)],
    ['median below the first quartile', (d) => (d.bands[1].median = d.bands[1].p25 - 1)],
    ['median above the third quartile', (d) => (d.bands[1].median = d.bands[1].p75 + 1)],
    ['published missing', (d) => delete d.published],
    ['published row without a label', (d) => delete d.published.rows[0].label],
    ['published row with a non-count value', (d) => (d.published.rows[0].perCapita = -1)],
    ['municipalities missing', (d) => delete d.municipalities],
    ['a code that is not five digits', (d) => (d.municipalities['1234'] = [1, 1])],
    ['an entry that is not a pair', (d) => (d.municipalities['30206'] = [680])],
    ['an entry with no residents', (d) => (d.municipalities['30206'] = [680, 0])],
    ['an entry with a fractional figure', (d) => (d.municipalities['30206'] = [680.5, 67316])],
  ];
  test.each(bad)('%s', (_name, fn) => {
    expect(() => parseFinance(mutate(fn))).toThrow(/finance\.json/);
  });

  test('not an object', () => {
    expect(() => parseFinance(null)).toThrow(/finance\.json/);
    expect(() => parseFinance('x')).toThrow(/finance\.json/);
  });

  test('the type of a parsed file is the Finance interface', () => {
    const f: Finance = parseFinance(raw());
    expect(f.bands).toHaveLength(7);
  });
});
