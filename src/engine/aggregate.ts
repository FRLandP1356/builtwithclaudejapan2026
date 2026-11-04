// Small pure helpers for totals and for adding series together.
import type { AgeVec, Pop, Series } from './types';

/** First 5-year class that counts as 65+ (class 13 = 65-69). */
export const FIRST_65_PLUS = 13;

function sumFrom(v: AgeVec, from: number): number {
  let s = 0;
  for (let j = from; j < v.length; j++) s += v[j];
  return s;
}

/** Total population, both sexes, all ages. */
export function total(p: Pop): number {
  return sumFrom(p.M, 0) + sumFrom(p.F, 0);
}

/** Population aged 65 and over (class index 13 and above), both sexes. */
export function ages65(p: Pop): number {
  return sumFrom(p.M, FIRST_65_PLUS) + sumFrom(p.F, FIRST_65_PLUS);
}

/**
 * Add series year by year (and class by class). All series must cover the same years.
 * The result never shares arrays with the inputs; an empty list gives an empty series.
 */
export function sumSeries(list: Series[]): Series {
  const out: Series = {};
  if (list.length === 0) return out;
  const years = Object.keys(list[0]).map(Number);
  for (const s of list) {
    const ys = Object.keys(s);
    if (ys.length !== years.length || !years.every((y) => s[y] !== undefined)) {
      throw new Error('sumSeries: series cover different years');
    }
  }
  for (const y of years) {
    const first = list[0][y];
    const M = first.M.slice();
    const F = first.F.slice();
    for (let i = 1; i < list.length; i++) {
      const p = list[i][y];
      for (let j = 0; j < M.length; j++) {
        M[j] += p.M[j];
        F[j] += p.F[j];
      }
    }
    out[y] = { M, F };
  }
  return out;
}
