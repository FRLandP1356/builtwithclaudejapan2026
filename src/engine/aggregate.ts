// Small pure helpers for totals and for adding series together.
import type { AgeVec, Pop, Series } from './types';

/** First 5-year class that counts as 65+ (class 13 = 65-69). */
export const FIRST_65_PLUS = 13;
/** First 5-year class of the working ages 15-64 (class 3 = 15-19); they run up to class 12 (60-64). */
export const FIRST_15_TO_64 = 3;

function sumRange(v: AgeVec, from: number, to: number): number {
  let s = 0;
  for (let j = from; j < to && j < v.length; j++) s += v[j];
  return s;
}

function sumFrom(v: AgeVec, from: number): number {
  return sumRange(v, from, v.length);
}

/** Total population, both sexes, all ages. */
export function total(p: Pop): number {
  return sumFrom(p.M, 0) + sumFrom(p.F, 0);
}

/** Population aged 65 and over (class index 13 and above), both sexes. */
export function ages65(p: Pop): number {
  return sumFrom(p.M, FIRST_65_PLUS) + sumFrom(p.F, FIRST_65_PLUS);
}

/** Population aged 15-64 (class index 3 to 12), both sexes. */
export function ages15to64(p: Pop): number {
  return sumRange(p.M, FIRST_15_TO_64, FIRST_65_PLUS) + sumRange(p.F, FIRST_15_TO_64, FIRST_65_PLUS);
}

/**
 * How many people aged 15-64 there are for each person aged 65 and over: working / elderly. NaN when there is nobody
 * aged 65 and over (the screen shows 「—」 then, never Infinity). Summed places (a prefecture, the country) divide
 * their sums: add the two counts first, then call this.
 */
export function supportRatioOf(working: number, elderly: number): number {
  if (!(elderly > 0) || !Number.isFinite(working)) return NaN;
  return working / elderly;
}

/**
 * The support ratio of one population (高齢者1人を支える現役世代の人数): ages15to64 / ages65, NaN without anyone 65+.
 * The AI tools (src/ai/tools.ts, owned by another stream) could expose it next to their age groups by calling this
 * on the same summed Pop they already build.
 */
export function supportRatio(p: Pop): number {
  return supportRatioOf(ages15to64(p), ages65(p));
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
