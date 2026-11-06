import { describe, expect, test } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { createRunner } from '../data/runner';
import { ages15to64, ages65, total } from '../engine/aggregate';
import { DEFAULT_SCENARIO, type Groups, type Pop, type Series } from '../engine/types';
import { allocatedTotals, deriveSupport, deriveTotals, ratioAt, type Totals } from './derive';

const areas = loadSampleAreas();
const runner = createRunner({ areas, facilities: loadFacilities() });
const series = runner.run(DEFAULT_SCENARIO);
const groups: Groups = { cities: {}, prefs: {} };
for (const a of areas) (groups.prefs[a.prefCode] ??= []).push(a.code);

describe('deriveTotals', () => {
  test('lists the years in order and one total per area and year', () => {
    const t = deriveTotals(series, groups);
    expect(t.years[0]).toBe(2020);
    expect(t.years[t.years.length - 1]).toBe(2100);
    expect(t.years).toHaveLength(17);
    for (const a of areas) {
      const row = t.area.get(a.code)!;
      expect(row).toHaveLength(17);
      expect(row[0]).toBeCloseTo(total(a.base), 6);
      expect(row[6]).toBeCloseTo(total(series.get(a.code)![2050]), 6);
    }
  });

  test('prefecture totals are the sum of their areas and Japan is the sum of everything', () => {
    const t = deriveTotals(series, groups);
    for (const [pp, codes] of Object.entries(groups.prefs)) {
      const row = t.pref.get(pp)!;
      const sum = codes.reduce((s, c) => s + t.area.get(c)![6], 0);
      expect(row[6]).toBeCloseTo(sum, 6);
    }
    const all = areas.reduce((s, a) => s + t.area.get(a.code)![16], 0);
    expect(t.japan[16]).toBeCloseTo(all, 6);
  });

  test('is memoised by the series object', () => {
    expect(deriveTotals(series, groups)).toBe(deriveTotals(series, groups));
    const other = runner.run({ ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    expect(deriveTotals(other, groups)).not.toBe(deriveTotals(series, groups));
  });

  test('ratioAt divides by the 2020 value and guards against zero', () => {
    const t = deriveTotals(series, groups);
    const row = t.area.get(areas[0].code)!;
    expect(ratioAt(row, 0)).toBe(1);
    expect(ratioAt(row, 6)).toBeCloseTo(row[6] / row[0], 9);
    expect(ratioAt(new Float64Array([0, 5]), 1)).toBeNaN();
  });
});

describe('allocatedTotals', () => {
  // Year index 1: A 100 and B 300 in prefecture 01, C 600 and D (no number) in 02, nothing in 03.
  const row = (v: number) => new Float64Array([1, v]);
  const t: Totals = {
    years: [2020, 2025],
    area: new Map([
      ['A', row(100)],
      ['B', row(300)],
      ['C', row(600)],
      ['D', row(Number.NaN)],
    ]),
    pref: new Map(),
    japan: new Float64Array(2),
  };
  const g: Groups = { cities: {}, prefs: { '01': ['A', 'B'], '02': ['C', 'D'], '03': [] } };

  test('applies each area change and sums per prefecture: (110 + 300) / 400 = +2.5%, 570 / 600 = -5%', () => {
    const out = allocatedTotals(t, g, 1, { A: 10, C: -5 });
    expect(out.prefAfter.get('01')).toBeCloseTo(410, 9);
    expect(out.prefChange.get('01')).toBeCloseTo(2.5, 9);
    expect(out.prefAfter.get('02')).toBeCloseTo(570, 9);
    expect(out.prefChange.get('02')).toBeCloseTo(-5, 9);
    expect(out.prefChange.get('03')).toBe(0);
    expect(out.japanAfter).toBeCloseTo(980, 9);
  });
});

describe('deriveSupport', () => {
  const sumOf = (codes: string[], i: number, f: (p: Pop) => number) => codes.reduce((s, c) => s + f(series.get(c)![2020 + 5 * i]), 0);

  test('one ratio per area and year: 15-64 / 65+ of that year', () => {
    const r = deriveSupport(series, groups);
    expect(r.years).toEqual(Array.from({ length: 17 }, (_, i) => 2020 + 5 * i));
    for (const a of areas) {
      const row = r.area.get(a.code)!;
      expect(row).toHaveLength(17);
      for (const i of [0, 6, 16]) {
        const p = series.get(a.code)![r.years[i]];
        expect(row[i]).toBeCloseTo(ages15to64(p) / ages65(p), 9);
      }
    }
  });

  test('a prefecture and the country divide their sums, not average their areas', () => {
    const r = deriveSupport(series, groups);
    for (const [pp, codes] of Object.entries(groups.prefs)) {
      for (const i of [0, 16]) expect(r.pref.get(pp)![i]).toBeCloseTo(sumOf(codes, i, ages15to64) / sumOf(codes, i, ages65), 9);
    }
    const all = areas.map((a) => a.code);
    expect(r.japan[16]).toBeCloseTo(sumOf(all, 16, ages15to64) / sumOf(all, 16, ages65), 9);
    const wakayama = groups.prefs['30'];
    const mean = wakayama.reduce((s, c) => s + r.area.get(c)![16], 0) / wakayama.length;
    expect(Math.abs(r.pref.get('30')![16] - mean)).toBeGreaterThan(1e-3); // the two differ on this data
  });

  test('is memoised by the series object, and a code without data is skipped', () => {
    expect(deriveSupport(series, groups)).toBe(deriveSupport(series, groups));
    const withGhost: Groups = { cities: {}, prefs: { ...groups.prefs, '30': [...groups.prefs['30'], '99999'] } };
    const copy = new Map(series);
    const r = deriveSupport(copy, withGhost);
    expect(r).not.toBe(deriveSupport(series, groups));
    expect(r.pref.get('30')![6]).toBeCloseTo(deriveSupport(series, groups).pref.get('30')![6], 12);
  });

  test('nobody aged 65+ gives NaN for that place and year, never Infinity', () => {
    const zeros = () => new Array<number>(20).fill(0);
    const young = (): Pop => {
      const M = zeros();
      M[8] = 100;
      return { M, F: zeros() };
    };
    const s: Series = { 2020: young(), 2025: young() };
    const r = deriveSupport(new Map([['99001', s]]), { cities: {}, prefs: { '99': ['99001'] } });
    expect(Number.isNaN(r.area.get('99001')![0])).toBe(true);
    expect(Number.isNaN(r.pref.get('99')![1])).toBe(true);
    expect(Number.isNaN(r.japan[0])).toBe(true);
  });
});
