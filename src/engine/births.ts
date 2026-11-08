// How far the 2025 census count of small children fell short of the official projection, as one national factor.
import type { Area, Pop, Series } from './types';
import { ACTUAL_YEAR } from './project';

const kids = (p: Pop): number => p.M[0] + p.F[0]; // ages 0-4
const women = (p: Pop): number => p.F.slice(4, 9).reduce((a, b) => a + b, 0); // women aged 20-44

/**
 * The child-woman ratio (children 0-4 per woman 20-44) of the 2025 count divided by the same ratio in the official
 * projection for 2025, summed over every area that has a count and assumptions. 1 = as projected; 0.92 = 8% fewer small
 * children per woman than the official assumptions gave. `official` is `projectAll(areas, s, 2100)`, `fromActual` is the
 * same call with `fromActual = true`.
 */
export function observedBirthsFactor(areas: Area[], official: Map<string, Series>, fromActual: Map<string, Series>): number {
  let ka = 0;
  let wa = 0;
  let ko = 0;
  let wo = 0;
  for (const a of areas) {
    if (!a.actual || a.assumptions === null) continue;
    const o = official.get(a.code)?.[ACTUAL_YEAR];
    const r = fromActual.get(a.code)?.[ACTUAL_YEAR];
    if (!o || !r) continue;
    ka += kids(r);
    wa += women(r);
    ko += kids(o);
    wo += women(o);
  }
  if (wa === 0 || wo === 0 || ko === 0) return 1;
  return ka / wa / (ko / wo);
}
