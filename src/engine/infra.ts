// Infrastructure-linked out-migration (an assumption of this app, not an official one): when an area's
// population falls below the size at which an essential facility is usually present, people leave faster.
import type { Assumption } from './types';

/** Net-migration rate lowered by `strength` for each essential facility lost: base - strength * lost. */
export function migAdjust(base: number, lost: number, strength: number): number {
  return base - strength * lost;
}

/**
 * The assumption of one period with its migration rates scaled by `migMult`, then lowered by
 * `strength * lost` for every age class of both sexes (rate' = rate * migMult - strength * lost).
 * The input is never modified. When there is nothing to change (migMult 1, no loss) the same object is
 * returned, so the unchanged scenario reproduces the baseline bit for bit and allocates nothing.
 */
export function adjustAssumption(a: Assumption, migMult: number, lost: number, strength: number): Assumption {
  if (migMult === 1 && lost * strength === 0) return a;
  const adjust = (rates: number[]): number[] => rates.map((r) => migAdjust(r * migMult, lost, strength));
  return { ...a, mig: { M: adjust(a.mig.M), F: adjust(a.mig.F) } };
}
