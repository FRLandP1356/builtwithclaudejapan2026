// Small pure helpers for totals and for adding series together.
import type { AgeVec, Pop, Series } from './types';

/** First 5-year class of the working ages (class 3 = 15-19); classes 0, 1 and 2 are 0-14. */
export const FIRST_WORKING_AGE = 3;

/** First 5-year class that counts as 65+ (class 13 = 65-69). */
export const FIRST_65_PLUS = 13;

function sumRange(v: AgeVec, from: number, to: number): number {
  let s = 0;
  for (let j = from; j < to && j < v.length; j++) s += v[j];
  return s;
}

/** Sum of the classes from `from` up to (not including) `to`; `to` defaults to the end of the vector (95+). */
function sumFrom(v: AgeVec, from: number, to: number = v.length): number {
  return sumRange(v, from, to);
}

/** Total population, both sexes, all ages. */
export function total(p: Pop): number {
  return sumFrom(p.M, 0) + sumFrom(p.F, 0);
}

/** Population aged 65 and over (class index 13 and above), both sexes. */
export function ages65(p: Pop): number {
  return sumFrom(p.M, FIRST_65_PLUS) + sumFrom(p.F, FIRST_65_PLUS);
}

export interface AgeGroups {
  /** Classes 0-2: aged 0-14. */
  age0to14: number;
  /** Classes 3-12: aged 15-64. */
  age15to64: number;
  /** Class 13 and above: aged 65 and over. */
  age65plus: number;
}

/**
 * Both sexes split into the three age groups the town panel and the AI tool `get_age_groups` show. Each group is
 * summed from its own classes (the working ages are not "the rest"), so the three add up to `total(p)`.
 */
export function ageGroups(p: Pop): AgeGroups {
  const sum = (from: number, to?: number): number => sumFrom(p.M, from, to) + sumFrom(p.F, from, to);
  return {
    age0to14: sum(0, FIRST_WORKING_AGE),
    age15to64: sum(FIRST_WORKING_AGE, FIRST_65_PLUS),
    age65plus: sum(FIRST_65_PLUS),
  };
}

/** Population aged 15-64 (class index 3 to 12), both sexes. */
export function ages15to64(p: Pop): number {
  return sumFrom(p.M, FIRST_WORKING_AGE, FIRST_65_PLUS) + sumFrom(p.F, FIRST_WORKING_AGE, FIRST_65_PLUS);
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
 * The AI tool get_age_groups (src/ai/tools.ts) returns the age groups; it could expose this ratio next to them by
 * calling this on the same summed Pop it already builds.
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
