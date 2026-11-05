// How the scenario knobs map onto the periods of a projection.
//
// A period is named by the year it STARTS in (2050 means the 2050->2055 period). Periods that start before
// 2050 use the official IPSS assumptions and are never touched by a scenario, so every scenario shares the
// same 2020-2050 results. Scenario knobs act on the periods starting in 2050 or later.
import type { Scenario } from './types';

/** Last year of the official assumptions; scenario knobs apply to periods starting at or after it. */
export const OFFICIAL_END_YEAR = 2050;
/** Year in which a 'fade' scenario has no net migration left. */
export const FADE_END_YEAR = 2100;

/**
 * Factor on the migration rates of the period starting in `periodStartYear`.
 * 'hold' keeps them (1). 'fade' falls linearly to 0 at 2100: max(0, 1 - (y + 5 - 2050) / 50), i.e. 0.9 for the
 * 2050->2055 period and 0 for 2095->2100. Periods starting before 2050 are official and keep a factor of 1.
 */
export function fadeFactor(periodStartYear: number, mode: Scenario['migMode']): number {
  if (mode !== 'fade' || periodStartYear < OFFICIAL_END_YEAR) return 1;
  return Math.max(0, 1 - (periodStartYear + 5 - OFFICIAL_END_YEAR) / (FADE_END_YEAR - OFFICIAL_END_YEAR));
}

/** Combined multiplier on the migration rates (migScale x fade) for the period starting in `periodStartYear`. */
export function migMultiplier(s: Scenario, periodStartYear: number): number {
  if (periodStartYear < OFFICIAL_END_YEAR) return 1;
  return s.migScale * fadeFactor(periodStartYear, s.migMode);
}

/** Multiplier on the child-woman ratio: cwrMult for periods that END after 2050 (start at 2050 or later), else 1. */
export function cwrMultiplier(s: Scenario, periodStartYear: number): number {
  return periodStartYear >= OFFICIAL_END_YEAR ? s.cwrMult : 1;
}
