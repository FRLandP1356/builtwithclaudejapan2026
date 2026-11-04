import { describe, expect, it } from 'vitest';
import { byCode, loadAllAreas, loadSampleAreas } from '../../test/helpers/loadAreas';
import { ages65, total } from './aggregate';
import { projectAll, projectArea } from './project';
import { DEFAULT_SCENARIO } from './types';
import type { Area, Facility, Pop, Scenario, Series } from './types';

const YEARS = Array.from({ length: 17 }, (_, i) => 2020 + 5 * i); // 2020..2100

const areas = loadAllAreas();
const withAssumptions = areas.filter((a) => a.assumptions !== null);
const villages = areas.filter((a) => a.assumptions === null);
const all = projectAll(areas, DEFAULT_SCENARIO);

function series(code: string, map: Map<string, Series> = all): Series {
  const s = map.get(code);
  if (!s) throw new Error(`no series for ${code}`);
  return s;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

describe('data sanity', () => {
  it('has 1,884 areas, 13 of them without assumptions', () => {
    expect(areas).toHaveLength(1884);
    expect(withAssumptions).toHaveLength(1871);
    expect(villages).toHaveLength(13);
  });
});

describe('projectAll: official results 2020-2050', () => {
  it('backtest_median_error: 2050 totals of the 1,871 areas match the official ones', () => {
    const errs = withAssumptions
      .map((a) => Math.abs(total(series(a.code)[2050]) / a.official[2050] - 1))
      .sort((x, y) => x - y);
    const median = percentile(errs, 0.5);
    const within = errs.filter((e) => e <= 0.005).length / errs.length;
    const max = errs[errs.length - 1];
    // Measured values are printed so that a regression shows how far off it is.
    console.log(`backtest 2050: median ${median.toExponential(3)}, within 0.5% ${(within * 100).toFixed(2)}%, max ${max.toFixed(5)}`);
    expect(median).toBeLessThanOrEqual(0.0001);
    expect(within).toBeGreaterThanOrEqual(0.98);
    expect(max).toBeLessThanOrEqual(0.02);
  });

  it('national_total_2050: all 1,884 areas add up to the official 104,686,386', () => {
    let sum = 0;
    for (const a of areas) sum += total(series(a.code)[2050]);
    expect(Math.abs(sum - 104_686_386)).toBeLessThanOrEqual(1000);
  });

  it('tanabe_2050: 田辺市 reaches 42,311 in 2050 (the workbook says 42,309)', () => {
    const tanabe = byCode(areas, '30206');
    expect(Math.abs(total(projectArea(tanabe, DEFAULT_SCENARIO)[2050]) - 42_311)).toBeLessThanOrEqual(5);
    expect(Math.abs(total(series('30206')[2050]) - 42_311)).toBeLessThanOrEqual(5);
  });
});

describe('projectArea / projectAll: series shape', () => {
  it('covers 2020..2100 in steps of 5 with 20 classes per sex, starting from the census', () => {
    const tanabe = byCode(areas, '30206');
    const s = projectArea(tanabe, DEFAULT_SCENARIO);
    expect(Object.keys(s).map(Number)).toEqual(YEARS);
    expect(s[2020]).toEqual(tanabe.base);
    expect(s[2020]).not.toBe(tanabe.base);
    for (const y of YEARS) {
      expect(s[y].M).toHaveLength(20);
      expect(s[y].F).toHaveLength(20);
    }
  });

  it('does not mutate the area it projects', () => {
    const tanabe = structuredClone(byCode(areas, '30206'));
    const copy = structuredClone(tanabe);
    projectArea(tanabe, DEFAULT_SCENARIO);
    expect(tanabe).toEqual(copy);
  });

  it('returns a series for every one of the 1,884 areas, in input order', () => {
    expect(all.size).toBe(1884);
    expect([...all.keys()]).toEqual(areas.map((a) => a.code));
    for (const a of areas) expect(Object.keys(series(a.code)).map(Number)).toEqual(YEARS);
  });

  it('stops at endYear', () => {
    const tanabe = byCode(areas, '30206');
    const s = projectArea(tanabe, DEFAULT_SCENARIO, 2050);
    expect(Object.keys(s).map(Number)).toEqual([2020, 2025, 2030, 2035, 2040, 2045, 2050]);
    expect(s[2050]).toEqual(series('30206')[2050]);

    const m = projectAll(areas, DEFAULT_SCENARIO, 2030);
    expect(m.size).toBe(1884);
    expect(Object.keys(series('30427', m)).map(Number)).toEqual([2020, 2025, 2030]);
    expect(Object.keys(series('30206', m)).map(Number)).toEqual([2020, 2025, 2030]);
  });

  it('refuses an area without assumptions (use projectAll for the 13 villages)', () => {
    expect(() => projectArea(villages[0], DEFAULT_SCENARIO)).toThrow(/projectAll/);
  });

  it('accepts facilities but ignores them while infraStrength is 0 (reserved for the infra feature)', () => {
    const tanabe = byCode(areas, '30206');
    const facilities: Facility[] = [
      { id: 'x', name: 'x', p50: 5000, p80: 10000, essential: true, excludesMetro: true, source: 'test' },
    ];
    expect(projectArea(tanabe, DEFAULT_SCENARIO, 2100, facilities)).toEqual(projectArea(tanabe, DEFAULT_SCENARIO));
    const sub = [tanabe, byCode(areas, '30427')];
    expect(projectAll(sub, DEFAULT_SCENARIO, 2100, facilities)).toEqual(projectAll(sub, DEFAULT_SCENARIO));
  });
});

describe('extension past 2050 (default scenario: hold the 2045->2050 rates)', () => {
  // Reference values come from the verified Python prototype (same formula, same held rates), run on the
  // same inputs as the app: the stored sex ratio is rounded to 3 decimals, which moves 2100 totals by ~0.002.
  it('田辺市 and the national total follow the prototype to 2100', () => {
    expect(total(series('30206')[2060])).toBeCloseTo(33887.65659273659, 3);
    expect(total(series('30206')[2100])).toBeCloseTo(11879.875999322947, 3);
    expect(total(series('30201')[2100])).toBeCloseTo(153006.02551361267, 3);
    expect(total(series('13101')[2100])).toBeCloseTo(73648.37444330302, 3);
    expect(total(series('01101')[2100])).toBeCloseTo(173895.4959949624, 3);

    let nat = 0;
    for (const a of withAssumptions) nat += total(series(a.code)[2100]);
    expect(Math.abs(nat - 63_277_549.66)).toBeLessThan(1);
  });

  it('shrinks and ages 田辺市 (sanity of direction)', () => {
    const s = series('30206');
    expect(total(s[2100])).toBeLessThan(total(s[2050]));
    expect(ages65(s[2050]) / total(s[2050])).toBeGreaterThan(ages65(s[2020]) / total(s[2020]));
  });

  it('cwrMult leaves everything up to 2050 untouched and changes births from 2050->2055 on', () => {
    const tanabe = byCode(areas, '30206');
    const base = projectArea(tanabe, DEFAULT_SCENARIO);
    const more = projectArea(tanabe, { ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    for (const y of YEARS.filter((x) => x <= 2050)) expect(more[y]).toEqual(base[y]);
    expect(total(more[2055])).toBeGreaterThan(total(base[2055]));
    // prototype with cwr x1.2 applied to the periods ending 2055 and later
    expect(total(more[2055])).toBeCloseTo(38254.78277039385, 3);
    expect(total(more[2100])).toBeCloseTo(12852.637595532098, 3);
    // 0-4 in 2055 is exactly 1.2 times the default
    expect((more[2055].M[0] + more[2055].F[0]) / (base[2055].M[0] + base[2055].F[0])).toBeCloseTo(1.2, 9);
  });

  it('cwrMult 0 stops births after 2050 without producing NaN or negatives', () => {
    const tanabe = byCode(areas, '30206');
    const s = projectArea(tanabe, { ...DEFAULT_SCENARIO, cwrMult: 0 });
    expect(s[2055].M[0] + s[2055].F[0]).toBe(0);
    expect(s[2100].M[0] + s[2100].F[0]).toBe(0);
    expect([...s[2100].M, ...s[2100].F].every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
  });
});

describe('no_negative_no_nan', () => {
  function assertClean(map: Map<string, Series>, label: string): void {
    for (const [code, s] of map) {
      for (const y of YEARS) {
        const p = s[y];
        for (const v of [...p.M, ...p.F]) {
          if (!Number.isFinite(v) || v < 0) throw new Error(`${label}: ${code} ${y} has value ${v}`);
        }
      }
    }
  }

  it('every class of every area is finite and >= 0 to 2100 (including 青ヶ島村, 利島村, 御蔵島村)', () => {
    for (const code of ['13402', '13362', '13382']) expect(all.has(code)).toBe(true);
    assertClean(all, 'default');
  });

  it('stays clean under extreme birth-rate multipliers', () => {
    assertClean(projectAll(areas, { ...DEFAULT_SCENARIO, cwrMult: 0 }), 'cwrMult 0');
    assertClean(projectAll(areas, { ...DEFAULT_SCENARIO, cwrMult: 3 }), 'cwrMult 3');
  });
});

describe('villages_without_assumptions', () => {
  function prefTotals(map: Map<string, Series>, prefCode: string, year: number): number {
    let sum = 0;
    for (const a of withAssumptions) if (a.prefCode === prefCode) sum += total(series(a.code, map)[year]);
    return sum;
  }

  it('equals the official ages up to 2050 and has values to 2100', () => {
    for (const v of villages) {
      const s = series(v.code);
      expect(s[2020]).toEqual(v.base);
      for (const y of [2025, 2030, 2035, 2040, 2045, 2050]) {
        expect(s[y]).toEqual(v.officialAges![y]);
        expect(total(s[y])).toBe(v.official[y]);
      }
      expect(Object.keys(s).map(Number)).toEqual(YEARS);
    }
  });

  it('extends past 2050 by the period change of the same prefecture (areas with assumptions only)', () => {
    for (const v of villages) {
      const s = series(v.code);
      for (let y = 2050; y < 2100; y += 5) {
        const factor = prefTotals(all, v.prefCode, y + 5) / prefTotals(all, v.prefCode, y);
        const expectedM = s[y].M.map((x) => x * factor);
        const expectedF = s[y].F.map((x) => x * factor);
        s[y + 5].M.forEach((x, j) => expect(x).toBeCloseTo(expectedM[j], 9));
        s[y + 5].F.forEach((x, j) => expect(x).toBeCloseTo(expectedF[j], 9));
      }
    }
  });

  it('follows the scenario through the prefecture (more births -> a larger village after 2050)', () => {
    const more = projectAll(areas, { ...DEFAULT_SCENARIO, cwrMult: 1.5 });
    for (const v of villages) {
      expect(total(series(v.code, more)[2050])).toBe(v.official[2050]);
      expect(total(series(v.code, more)[2100])).toBeGreaterThan(total(series(v.code)[2100]));
    }
  });

  it('holds the 2050 population flat when no area of its prefecture is in the list', () => {
    const aoga = byCode(loadSampleAreas(), '13402');
    const m = projectAll([aoga], DEFAULT_SCENARIO);
    const s = series('13402', m);
    expect(s[2100]).toEqual(aoga.officialAges![2050]);
    expect(s[2055]).toEqual(aoga.officialAges![2050]);
  });

  it('works on the 6-area fixture (fast path used by other tasks)', () => {
    const sample = loadSampleAreas();
    const m = projectAll(sample, DEFAULT_SCENARIO);
    expect(m.size).toBe(6);
    const chiyoda = series('13101', m);
    const aoga = series('13402', m);
    const factor = total(chiyoda[2055]) / total(chiyoda[2050]);
    expect(total(aoga[2055])).toBeCloseTo(total(aoga[2050]) * factor, 6);
  });
});

describe('Scenario/Pop typing', () => {
  it('keeps the scenario object untouched', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, cwrMult: 1.1 };
    const copy = { ...s };
    projectAll(loadSampleAreas(), s);
    expect(s).toEqual(copy);
  });

  it('exposes Pop values as plain number arrays', () => {
    const p: Pop = series('30206')[2020];
    expect(Array.isArray(p.M) && Array.isArray(p.F)).toBe(true);
    const a: Area = byCode(areas, '30206');
    expect(a.assumptions).toHaveLength(6);
  });
});
