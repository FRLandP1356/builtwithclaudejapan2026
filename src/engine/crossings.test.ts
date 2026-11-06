import { describe, expect, test } from 'vitest';
import { areaCrossings, crossingsPerYear, groupCrossings, scopeCrossings } from './crossings';
import type { Facility } from './types';

const fac = (id: string, p50: number, essential = false): Facility => ({ id, name: id, p50, p80: p50, essential, excludesMetro: true, source: 'test' });
const A = fac('a', 500, true);
const B = fac('b', 2000);
const C = fac('c', 10000);
const YEARS = [2020, 2025, 2030, 2035, 2040];

describe('areaCrossings', () => {
  test('finds the first grid year below each guide, after a year at or above it', () => {
    const r = areaCrossings('X', YEARS, [12000, 9000, 1900, 600, 450], [A, B, C]);
    expect(r.alreadyBelow).toEqual([]);
    expect(r.crossings.map((c) => [c.facilityId, c.year, c.popBefore, c.pop])).toEqual([
      ['c', 2025, 12000, 9000],
      ['b', 2030, 9000, 1900],
      ['a', 2040, 600, 450],
    ]);
  });

  test('a population exactly at the guide is not below it; one person under is', () => {
    expect(areaCrossings('X', [2020, 2025], [600, 500], [A]).crossings).toEqual([]);
    expect(areaCrossings('X', [2020, 2025], [600, 499.9], [A]).crossings).toHaveLength(1);
  });

  test('an area already below a guide in the first year is listed apart and has no crossing for it', () => {
    const r = areaCrossings('X', YEARS, [1500, 1400, 1000, 600, 450], [A, B]);
    expect(r.alreadyBelow).toEqual([{ areaCode: 'X', facilityId: 'b', pop: 1500 }]);
    expect(r.crossings.map((c) => [c.facilityId, c.year])).toEqual([['a', 2040]]);
  });

  test('a population that climbs back above a guide keeps only its first crossing', () => {
    const r = areaCrossings('X', YEARS, [700, 480, 900, 450, 800], [A]);
    expect(r.crossings.map((c) => [c.year, c.pop])).toEqual([[2025, 480]]);
  });

  test('a year without a number is skipped, not read as zero', () => {
    const r = areaCrossings('X', YEARS, [700, NaN, 650, 480, 470], [A]);
    expect(r.crossings.map((c) => [c.year, c.popBefore])).toEqual([[2035, 650]]);
    expect(areaCrossings('X', YEARS, [NaN, NaN, NaN, NaN, NaN], [A])).toEqual({ crossings: [], alreadyBelow: [] });
    // the first usable year is the baseline: below there means already below
    expect(areaCrossings('X', YEARS, [NaN, 400, 300, 200, 100], [A]).alreadyBelow).toHaveLength(1);
  });

  test('no facilities, or a population that never falls, gives nothing', () => {
    expect(areaCrossings('X', YEARS, [9, 8, 7, 6, 5], [])).toEqual({ crossings: [], alreadyBelow: [] });
    expect(areaCrossings('X', YEARS, [900, 910, 920, 930, 940], [A]).crossings).toEqual([]);
  });

  test('the order is by year, then by the order of the facility list', () => {
    const r = areaCrossings('X', [2020, 2025], [20000, 100], [C, B, A]);
    expect(r.crossings.map((c) => c.facilityId)).toEqual(['c', 'b', 'a']);
  });
});

describe('scopeCrossings, crossingsPerYear and groupCrossings', () => {
  const series = new Map<string, number[]>([
    ['P1', [12000, 9000, 1900, 600, 450]],
    ['P2', [3000, 2500, 1900, 1800, 1700]],
    ['P3', [900, 800, 700, 600, 500]],
  ]);
  const popsOf = (c: string) => series.get(c);

  test('it joins the areas, skips a code with no series, and lists the areas already below', () => {
    const r = scopeCrossings(['P1', 'P2', 'P3', 'NOPE'], YEARS, popsOf, [A, B]);
    expect(r.crossings.map((c) => `${c.areaCode}:${c.facilityId}:${c.year}`)).toEqual(['P1:b:2030', 'P1:a:2040', 'P2:b:2030']);
    expect(r.alreadyBelow.map((c) => `${c.areaCode}:${c.facilityId}`)).toEqual(['P3:b']);
  });

  test('per year: areas count once, crossings count each; every later year is listed', () => {
    const { crossings } = scopeCrossings(['P1', 'P2'], YEARS, popsOf, [A, B, C]);
    expect(crossingsPerYear(crossings, YEARS)).toEqual([
      { year: 2025, areas: 1, crossings: 1 },
      { year: 2030, areas: 2, crossings: 2 },
      { year: 2035, areas: 0, crossings: 0 },
      { year: 2040, areas: 1, crossings: 1 },
    ]);
  });

  test('grouped by year, essential facilities first, the biggest town first inside a group', () => {
    const more = new Map(series);
    more.set('P4', [8000, 7000, 1500, 600, 600]);
    const { crossings } = scopeCrossings(['P1', 'P2', 'P4'], YEARS, (c) => more.get(c), [C, B, A]);
    const groups = groupCrossings(crossings, [C, B, A]);
    // 2030: b (not essential) for P1 (9,000 before), P2 (2,500), P4 (7,000); no essential in 2030; 2040: a for P1
    expect(groups.map((g) => `${g.year}:${g.facilityId}:${g.items.map((i) => i.areaCode).join(',')}`)).toEqual([
      '2025:c:P1',
      '2030:b:P1,P4,P2',
      '2040:a:P1',
    ]);
    // an essential facility goes before a non-essential one in the same year
    const same = scopeCrossings(['Q'], [2020, 2025], () => [20000, 100], [C, B, A]);
    expect(groupCrossings(same.crossings, [C, B, A]).map((g) => g.facilityId)).toEqual(['a', 'c', 'b']);
  });
});
