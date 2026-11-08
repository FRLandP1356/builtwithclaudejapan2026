import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { attachActual, parseActual } from '../data/actual';
import { total } from './aggregate';
import { observedBirthsFactor } from './births';
import { ACTUAL_YEAR, projectAll, projectArea, projectAreaFromActual } from './project';
import { DEFAULT_SCENARIO, type Area } from './types';

const actual = parseActual(JSON.parse(readFileSync('public/data/actual2025.json', 'utf8')));
const load = (pp: string): Area[] => {
  const areas = JSON.parse(readFileSync(`public/data/areas/${pp}.json`, 'utf8')) as Area[];
  attachActual(areas, actual);
  return areas;
};
const tanabe = (): Area => {
  const a = load('30').find((x) => x.code === '30206');
  if (!a) throw new Error('Tanabe missing');
  return a;
};

describe('projectAreaFromActual (start again from the 2025 census count)', () => {
  it('keeps 2020 as the 2020 census and makes 2025 the 2025 census count', () => {
    const a = tanabe();
    const s = projectAreaFromActual(a, DEFAULT_SCENARIO, 2100);
    expect(total(s[2020])).toBe(69870);
    expect(total(s[ACTUAL_YEAR])).toBe(64288);
    expect(Object.keys(s).map(Number)).toEqual([2020, 2025, 2030, 2035, 2040, 2045, 2050, 2055, 2060, 2065, 2070, 2075, 2080, 2085, 2090, 2095, 2100]);
  });

  it('is close to the official projection and differs from it by the drift in 2025', () => {
    const a = tanabe();
    const from = projectAreaFromActual(a, DEFAULT_SCENARIO, 2100);
    const official = projectArea(a, DEFAULT_SCENARIO, 2100);
    // 64,288 counted vs 64,651 projected for 2025: the later years stay within 2% of the official run.
    for (const y of [2030, 2040, 2050]) {
      const ratio = total(from[y]) / total(official[y]);
      expect(ratio).toBeGreaterThan(0.98);
      expect(ratio).toBeLessThan(1.02);
    }
    expect(total(from[2050])).not.toBeCloseTo(total(official[2050]), 0);
  });

  it('throws for an area without a 2025 count', () => {
    const a = { ...tanabe() };
    delete a.actual;
    expect(() => projectAreaFromActual(a, DEFAULT_SCENARIO, 2100)).toThrow(/no 2025 census count/);
  });

  it('stops at 2020 when the end year is before 2025', () => {
    expect(Object.keys(projectAreaFromActual(tanabe(), DEFAULT_SCENARIO, 2020)).map(Number)).toEqual([2020]);
  });
});

describe('projectAll with fromActual', () => {
  const areas: Area[] = readdirSync('public/data/areas')
    .sort()
    .flatMap((f) => load(f.replace('.json', '')));

  it('every area except the seven Hamamatsu wards has a 2025 count that adds up', () => {
    const without = areas.filter((a) => !a.actual).map((a) => a.code);
    expect(without).toEqual(['22131', '22132', '22133', '22134', '22135', '22136', '22137']);
    for (const a of areas) {
      if (!a.actual) continue;
      expect(a.actual.M).toHaveLength(20);
      expect(a.actual.F).toHaveLength(20);
      expect(total(a.actual)).toBeGreaterThan(0);
    }
  });

  it('the national 2025 total of the counted areas matches the census, and 2100 stays about half of today', () => {
    const base = projectAll(areas, DEFAULT_SCENARIO, 2100);
    const from = projectAll(areas, DEFAULT_SCENARIO, 2100, undefined, true);
    const sum = (m: Map<string, Record<number, { M: number[]; F: number[] }>>, y: number) =>
      [...m.values()].reduce((acc, ser) => acc + total(ser[y]), 0);
    // 122,972,528 (census) = counted areas + the seven Hamamatsu wards, which keep the official projection (230,110 + ...).
    const counted = areas.filter((a) => a.actual).reduce((acc, a) => acc + total(a.actual as { M: number[]; F: number[] }), 0);
    expect(counted).toBe(122207274);
    expect(sum(from, 2020)).toBe(sum(base, 2020));
    const ratio2100 = sum(from, 2100) / sum(base, 2100);
    expect(ratio2100).toBeGreaterThan(0.99);
    expect(ratio2100).toBeLessThan(1.02);
    expect(sum(from, 2100) / sum(from, 2020)).toBeGreaterThan(0.45);
    expect(sum(from, 2100) / sum(from, 2020)).toBeLessThan(0.55);
  });

  it('a village without assumptions starts from its count and follows its official ages', () => {
    const v = areas.find((a) => a.assumptions === null && a.actual);
    if (!v) throw new Error('no village with a count found');
    const from = projectAll([...areas.filter((a) => a.prefCode === v.prefCode)], DEFAULT_SCENARIO, 2100, undefined, true).get(v.code);
    expect(from).toBeDefined();
    expect(total(from![ACTUAL_YEAR])).toBe(total(v.actual as { M: number[]; F: number[] }));
    const officialTotal30 = total((v.officialAges as Record<number, { M: number[]; F: number[] }>)[2030]);
    const officialTotal25 = total((v.officialAges as Record<number, { M: number[]; F: number[] }>)[2025]);
    expect(total(from![2030])).toBeCloseTo((officialTotal30 * total(v.actual as { M: number[]; F: number[] })) / officialTotal25, 3);
  });
});

describe('births factor (the shortfall of small children seen in 2025)', () => {
  const areas: Area[] = readdirSync('public/data/areas')
    .sort()
    .flatMap((f) => load(f.replace('.json', '')));
  const off = projectAll(areas, DEFAULT_SCENARIO, 2100);
  const reb = projectAll(areas, DEFAULT_SCENARIO, 2100, undefined, true);
  const f = observedBirthsFactor(areas, off, reb);
  const sum = (m: Map<string, Record<number, { M: number[]; F: number[] }>>, y: number) =>
    [...m.values()].reduce((acc, ser) => acc + total(ser[y]), 0);

  it('the 2025 count has fewer small children per woman than the official assumptions: about 0.92', () => {
    expect(f).toBeGreaterThan(0.9);
    expect(f).toBeLessThan(0.94);
  });

  it('with the factor, the later years are lower than the official assumptions give, by more in the far years', () => {
    const cal = projectAll(areas, DEFAULT_SCENARIO, 2100, undefined, true, f);
    expect(sum(cal, 2025)).toBe(sum(reb, 2025)); // 2025 is the count either way
    expect(sum(cal, 2050)).toBeLessThan(sum(reb, 2050));
    expect(sum(cal, 2100)).toBeLessThan(sum(reb, 2100));
    expect(sum(cal, 2100) / sum(off, 2100)).toBeGreaterThan(0.88);
    expect(sum(cal, 2100) / sum(off, 2100)).toBeLessThan(0.93);
    // a factor of 1 changes nothing
    const same = projectAll(areas, DEFAULT_SCENARIO, 2100, undefined, true, 1);
    expect(sum(same, 2100)).toBeCloseTo(sum(reb, 2100), 3);
  });
});
