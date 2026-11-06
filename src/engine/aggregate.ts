// Small pure helpers for totals and for adding series together.
import type { AgeVec, Pop, Series } from './types';

/** First 5-year class of the working ages (class 3 = 15-19); classes 0, 1 and 2 are 0-14. */
export const FIRST_WORKING_AGE = 3;

/** First 5-year class that counts as 65+ (class 13 = 65-69). */
export const FIRST_65_PLUS = 13;

/** Sum of the classes from `from` up to (not including) `to`; `to` defaults to the end of the vector (95+). */
function sumFrom(v: AgeVec, from: number, to: number = v.length): number {
  let s = 0;
  for (let j = from; j < to; j++) s += v[j];
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
