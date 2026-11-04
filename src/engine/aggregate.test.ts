import { describe, expect, it } from 'vitest';
import { ages65, sumSeries, total } from './aggregate';
import type { Pop, Series } from './types';

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
