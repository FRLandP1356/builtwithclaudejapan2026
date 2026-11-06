import { describe, expect, it } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { ages15to64, ages65, FIRST_15_TO_64, sumSeries, supportRatio, supportRatioOf, total } from './aggregate';
import { projectAll } from './project';
import { DEFAULT_SCENARIO, type Pop, type Series } from './types';

function pop(m: number, f: number): Pop {
  return { M: new Array(20).fill(m), F: new Array(20).fill(f) };
}

describe('aggregate', () => {
  it('total adds all 20 classes of both sexes', () => {
    expect(total(pop(1, 2))).toBe(20 * 1 + 20 * 2);
  });

  it('ages65 counts class 13 (65-69) and above only', () => {
    const p = pop(0, 0);
    p.M[12] = 100; // 60-64: not counted
    p.M[13] = 1; // 65-69
    p.F[19] = 2; // 95+
    p.F[15] = 3;
    expect(ages65(p)).toBe(6);
  });

  it('ages15to64 counts classes 3 (15-19) to 12 (60-64) of both sexes, nothing below or above', () => {
    const p = pop(0, 0);
    p.M[2] = 1000; // 10-14: not counted
    p.F[2] = 1000;
    p.M[3] = 1; // 15-19
    p.F[3] = 2;
    p.M[7] = 4;
    p.F[12] = 8; // 60-64
    p.M[12] = 16;
    p.M[13] = 2000; // 65-69: not counted
    p.F[13] = 2000;
    expect(ages15to64(p)).toBe(1 + 2 + 4 + 8 + 16);
    expect(FIRST_15_TO_64).toBe(3);
  });

  it('the three age groups add up to the total', () => {
    const p: Pop = { M: Array.from({ length: 20 }, (_, i) => i + 1), F: Array.from({ length: 20 }, (_, i) => 2 * i + 3) };
    const children = [0, 1, 2].reduce((s, i) => s + p.M[i] + p.F[i], 0);
    expect(children + ages15to64(p) + ages65(p)).toBe(total(p));
  });

  it('supportRatio divides the 15-64 count by the 65+ count, both sexes', () => {
    const p = pop(0, 0);
    p.M[3] = 30; // 15-19, men
    p.F[12] = 10; // 60-64, women
    p.M[13] = 4; // 65-69, men
    p.F[19] = 16; // 95+, women
    p.M[2] = 500; // 10-14: in neither group
    expect(supportRatio(p)).toBe(40 / 20);
    p.F[19] = 0; // only the men aged 65+ are left
    expect(supportRatio(p)).toBe(40 / 4);
    p.F[3] = 10; // a woman's class counts in the numerator
    expect(supportRatio(p)).toBe(50 / 4);
  });

  it('supportRatio is NaN, never Infinity, without anyone aged 65+', () => {
    const p = pop(0, 0);
    p.M[5] = 100;
    expect(Number.isNaN(supportRatio(p))).toBe(true);
    expect(Number.isNaN(supportRatio(pop(0, 0)))).toBe(true);
    expect(Number.isNaN(supportRatioOf(10, 0))).toBe(true);
    expect(Number.isNaN(supportRatioOf(10, -1))).toBe(true);
    expect(Number.isNaN(supportRatioOf(10, NaN))).toBe(true);
    expect(Number.isNaN(supportRatioOf(NaN, 5))).toBe(true);
    expect(supportRatioOf(0, 5)).toBe(0);
    expect(supportRatioOf(3, 2)).toBe(1.5);
  });

  it('sumSeries adds series year by year, per class', () => {
    const a: Series = { 2020: pop(1, 2), 2025: pop(3, 4) };
    const b: Series = { 2020: pop(10, 20), 2025: pop(30, 40) };
    const s = sumSeries([a, b]);
    expect(Object.keys(s).map(Number)).toEqual([2020, 2025]);
    expect(s[2020].M[5]).toBe(11);
    expect(s[2020].F[19]).toBe(22);
    expect(s[2025].M[0]).toBe(33);
    expect(total(s[2025])).toBe(total(a[2025]) + total(b[2025]));
  });

  it('sumSeries returns an independent copy and does not mutate its inputs', () => {
    const a: Series = { 2020: pop(1, 2) };
    const s = sumSeries([a]);
    s[2020].M[0] = 999;
    expect(a[2020].M[0]).toBe(1);
  });

  it('sumSeries of nothing is an empty series', () => {
    expect(sumSeries([])).toEqual({});
  });

  it('sumSeries rejects series that cover different years', () => {
    const a: Series = { 2020: pop(1, 1), 2025: pop(1, 1) };
    const b: Series = { 2020: pop(1, 1) };
    expect(() => sumSeries([a, b])).toThrow();
  });
});

describe('support ratio on the real data (public/data, 1,884 areas)', () => {
  const areas = loadAllAreas();
  const series = projectAll(areas, DEFAULT_SCENARIO); // the full list (Ruling 20)

  it('Japan 2020 (census base): 7,509万 aged 15-64 for 3,603万 aged 65+, about 2.08', () => {
    const japan = sumSeries(areas.map((a) => ({ 2020: a.base })))[2020];
    expect(ages15to64(japan)).toBeCloseTo(75_087_865, 0);
    expect(ages65(japan)).toBeCloseTo(36_026_632, 0);
    expect(supportRatio(japan)).toBeCloseTo(2.084232, 6);
    // the projection starts from the same base
    const projected = sumSeries(areas.map((a) => ({ 2020: series.get(a.code)![2020] })))[2020];
    expect(supportRatio(projected)).toBeCloseTo(2.084232, 6);
  });

  it('田辺市 (30206): 1.61 in 2020, 0.89 in 2050, 0.80 in 2100 under the default scenario', () => {
    const tanabe = series.get('30206')!;
    expect(ages15to64(tanabe[2020])).toBeCloseTo(38_191, 0);
    expect(ages65(tanabe[2020])).toBeCloseTo(23_724, 0);
    expect(supportRatio(tanabe[2020])).toBeCloseTo(1.609804, 5);
    expect(supportRatio(tanabe[2050])).toBeCloseTo(0.886342, 5);
    expect(supportRatio(tanabe[2100])).toBeCloseTo(0.79935, 5);
  });

  it('no area has nobody aged 65+ in any year, so the real maps never need the 「—」', () => {
    for (const a of areas) {
      for (const y of [2020, 2050, 2100]) expect(Number.isFinite(supportRatio(series.get(a.code)![y])), `${a.code} ${y}`).toBe(true);
    }
  });
});
