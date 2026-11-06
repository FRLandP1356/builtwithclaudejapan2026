import { describe, expect, it } from 'vitest';
import { ageGroups, ages65, FIRST_65_PLUS, FIRST_WORKING_AGE, sumSeries, total } from './aggregate';
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

  it('ageGroups: 0-14 is classes 0-2, 15-64 is classes 3-12, 65+ is class 13 to 95+; both sexes, every class counted once', () => {
    // M = 1..20 and F = 100..2000 by class: every class has its own count, so a boundary one class off changes a group
    const p: Pop = { M: Array.from({ length: 20 }, (_, j) => j + 1), F: Array.from({ length: 20 }, (_, j) => 100 * (j + 1)) };
    expect(ageGroups(p)).toEqual({ age0to14: 6 + 600, age15to64: 85 + 8_500, age65plus: 119 + 11_900 });
    expect(FIRST_WORKING_AGE).toBe(3);
    expect(FIRST_65_PLUS).toBe(13);
    const g = ageGroups(p);
    expect(g.age0to14 + g.age15to64 + g.age65plus).toBe(total(p));
    expect(g.age65plus).toBe(ages65(p));
  });

  it('ageGroups: a single person at each side of the two boundaries lands in the right group', () => {
    const at = (cls: number, sex: 'M' | 'F'): Pop => {
      const p = pop(0, 0);
      p[sex][cls] = 1;
      return p;
    };
    for (const sex of ['M', 'F'] as const) {
      expect(ageGroups(at(2, sex))).toEqual({ age0to14: 1, age15to64: 0, age65plus: 0 }); // 10-14
      expect(ageGroups(at(3, sex))).toEqual({ age0to14: 0, age15to64: 1, age65plus: 0 }); // 15-19
      expect(ageGroups(at(12, sex))).toEqual({ age0to14: 0, age15to64: 1, age65plus: 0 }); // 60-64
      expect(ageGroups(at(13, sex))).toEqual({ age0to14: 0, age15to64: 0, age65plus: 1 }); // 65-69
      expect(ageGroups(at(19, sex))).toEqual({ age0to14: 0, age15to64: 0, age65plus: 1 }); // 95+
      expect(ageGroups(at(0, sex))).toEqual({ age0to14: 1, age15to64: 0, age65plus: 0 }); // 0-4
    }
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
