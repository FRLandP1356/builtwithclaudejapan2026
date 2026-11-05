import { describe, expect, it } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { referenceProject } from '../../test/helpers/referenceProjection';
import { total } from './aggregate';
import { lostEssentialCount } from './facilities';
import { migAdjust } from './infra';
import { projectAll, projectArea } from './project';
import { DEFAULT_SCENARIO } from './types';
import type { Pop, Scenario, Series } from './types';

const areas = loadAllAreas();
const withAssumptions = areas.filter((a) => a.assumptions !== null);
const facilities = loadFacilities();
const baseline = projectAll(areas, DEFAULT_SCENARIO);
const weak: Scenario = { ...DEFAULT_SCENARIO, infraStrength: 0.002 };
const strong: Scenario = { ...DEFAULT_SCENARIO, infraStrength: 0.005 };
const withWeak = projectAll(areas, weak, 2100, facilities);
const withStrong = projectAll(areas, strong, 2100, facilities);

function seriesOf(map: Map<string, Series>, code: string): Series {
  const s = map.get(code);
  if (!s) throw new Error(`no series for ${code}`);
  return s;
}

function nationalTotal(map: Map<string, Series>, year: number): number {
  let sum = 0;
  for (const s of map.values()) sum += total(s[year]);
  return sum;
}

/** Number of essential facilities below at the start of any period 2050..2095 of the DEFAULT projection. */
function maxLostInBaseline(code: string): number {
  const s = seriesOf(baseline, code);
  let max = 0;
  for (let y = 2050; y < 2100; y += 5) max = Math.max(max, lostEssentialCount(total(s[y]), facilities));
  return max;
}

function expectPopsClose(actual: Pop, expected: Pop): void {
  for (const sex of ['M', 'F'] as const) {
    actual[sex].forEach((v, j) => expect(v).toBeCloseTo(expected[sex][j], 6));
  }
}

describe('migAdjust', () => {
  it('subtracts strength * lost from the base rate', () => {
    expect(migAdjust(0.01, 2, 0.005)).toBeCloseTo(0, 12);
    expect(migAdjust(-0.02, 4, 0.002)).toBeCloseTo(-0.028, 12);
    expect(migAdjust(0.03, 3, 0.001)).toBeCloseTo(0.027, 12);
  });

  it('returns the base rate unchanged when nothing is lost or the strength is 0', () => {
    expect(migAdjust(0.0123, 0, 0.005)).toBe(0.0123);
    expect(migAdjust(0.0123, 8, 0)).toBe(0.0123);
    expect(migAdjust(-0.5, 0, 0)).toBe(-0.5);
  });
});

describe('strength_zero_equals_baseline', () => {
  it('infraStrength 0 gives exactly the default result for all 1,884 areas, with or without facilities', () => {
    const zero: Scenario = { ...DEFAULT_SCENARIO, infraStrength: 0 };
    expect(projectAll(areas, zero, 2100, facilities)).toEqual(baseline);
    expect(projectAll(areas, zero)).toEqual(baseline);
  }, 30_000); // two more all-area runs plus two deep comparisons: about 1 s alone, but it hit the 5 s default once under load

  it('needs the facility list as soon as the strength is above 0', () => {
    const tanabe = byCode(areas, '30206');
    expect(() => projectArea(tanabe, strong)).toThrow(/facilities/);
    expect(() => projectAll(areas, strong)).toThrow(/facilities/);
    expect(() => projectAll([], strong)).toThrow(/facilities/);
    expect(() => projectArea(tanabe, strong, 2100, facilities)).not.toThrow();
    expect(() => projectArea(tanabe, strong, 2100, [])).not.toThrow();
  });

  it('rejects a negative or non-numeric strength', () => {
    const tanabe = byCode(areas, '30206');
    expect(() => projectArea(tanabe, { ...DEFAULT_SCENARIO, infraStrength: -0.001 }, 2100, facilities)).toThrow(RangeError);
    expect(() => projectAll(areas, { ...DEFAULT_SCENARIO, infraStrength: Number.NaN }, 2100, facilities)).toThrow(RangeError);
  });
});

describe('strength above 0: towns that lose essential facilities', () => {
  // Chosen from the data (default projection): 留萌市 has all 8 essential facilities at the start of
  // 2050 and drops to 4 below by 2100; 夕張市 and 赤平市 are already at 4 lost in 2050 and reach 8.
  // 和歌山市 (153,006 in 2100), 田辺市 (11,880) and the Tokyo wards never fall under 8,500, so they lose none.
  it('lowers 留萌市, 夕張市 and 赤平市 in 2100, and the stronger the effect the lower', () => {
    for (const code of ['01212', '01209', '01218']) {
      const none = total(seriesOf(baseline, code)[2100]);
      const w = total(seriesOf(withWeak, code)[2100]);
      const st = total(seriesOf(withStrong, code)[2100]);
      expect(maxLostInBaseline(code), `${code} loses facilities in the default projection`).toBeGreaterThan(0);
      expect(w, `${code} weak`).toBeLessThan(none);
      expect(st, `${code} strong`).toBeLessThan(w);
    }
  });

  it('leaves 和歌山市, 田辺市 and 千代田区 exactly as in the default, even at the strongest setting', () => {
    for (const code of ['30201', '30206', '13101', '13104', '01101']) {
      expect(maxLostInBaseline(code), `${code} never loses an essential facility`).toBe(0);
      expect(seriesOf(withStrong, code)).toEqual(seriesOf(baseline, code));
      expect(seriesOf(withWeak, code)).toEqual(seriesOf(baseline, code));
    }
  });

  it('applies to every area by one rule: no loss in the default projection -> identical, loss -> lower', () => {
    let untouched = 0;
    let lowered = 0;
    for (const a of withAssumptions) {
      const base = seriesOf(baseline, a.code);
      const s = seriesOf(withStrong, a.code);
      if (maxLostInBaseline(a.code) === 0) {
        expect(s, a.code).toEqual(base);
        untouched++;
      } else {
        expect(total(s[2100]), a.code).toBeLessThan(total(base[2100]));
        lowered++;
      }
    }
    expect(untouched + lowered).toBe(1871);
    expect(untouched).toBeGreaterThan(800);
    expect(lowered).toBeGreaterThan(900);
  });

  it('feeds the loss back period by period: matches a straight reimplementation of the formula', () => {
    for (const code of ['01212', '01209', '01218', '30206', '30202']) {
      const area = byCode(areas, code);
      for (const s of [weak, strong, { ...strong, migMode: 'fade' as const }]) {
        const expected = referenceProject(area, s, facilities);
        const actual = projectArea(area, s, 2100, facilities);
        for (let y = 2020; y <= 2100; y += 5) expectPopsClose(actual[y], expected[y]);
      }
    }
  });

  it('keeps every class finite and >= 0 even at an extreme strength', () => {
    const extreme = projectAll(areas, { ...DEFAULT_SCENARIO, infraStrength: 0.5 }, 2100, facilities);
    for (const [code, s] of extreme) {
      for (let y = 2020; y <= 2100; y += 5) {
        for (const v of [...s[y].M, ...s[y].F]) {
          if (!Number.isFinite(v) || v < 0) throw new Error(`${code} ${y} has value ${v}`);
        }
      }
    }
  });

  it('moves the 13 villages with their prefecture, so they shrink too', () => {
    const villages = areas.filter((a) => a.assumptions === null);
    expect(villages).toHaveLength(13);
    for (const v of villages) {
      expect(total(seriesOf(withStrong, v.code)[2050])).toBe(v.official[2050]);
      expect(total(seriesOf(withStrong, v.code)[2100])).toBeLessThan(total(seriesOf(baseline, v.code)[2100]));
    }
  });

  it('lowers the national total step by step as the strength grows', () => {
    const n0 = nationalTotal(baseline, 2100);
    const n1 = nationalTotal(withWeak, 2100);
    const n2 = nationalTotal(withStrong, 2100);
    expect(n1).toBeLessThan(n0);
    expect(n2).toBeLessThan(n1);
    expect(nationalTotal(withStrong, 2050)).toBe(nationalTotal(baseline, 2050));
  });
});

describe('speed', () => {
  it('projects all 1,884 areas with the infra feedback on in well under two seconds', () => {
    const t0 = performance.now();
    projectAll(areas, strong, 2100, facilities);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
