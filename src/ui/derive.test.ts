import { describe, expect, test } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { createRunner } from '../data/runner';
import { total } from '../engine/aggregate';
import { DEFAULT_SCENARIO, type Groups } from '../engine/types';
import { deriveTotals, ratioAt } from './derive';

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
