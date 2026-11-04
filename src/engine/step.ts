// One 5-year period of the cohort-component method (the IPSS 2023 projection reproduced for 2020-2050).
import type { AgeVec, Assumption, Pop } from './types';

export { total, ages65 } from './aggregate';

const AGE_CLASSES = 20;
const OPEN_CLASS = AGE_CLASSES - 1; // 95+
// Mothers are the women of 20-24 ... 40-44 at the END of the period (classes 4..8 after ageing).
// This is the base of the IPSS child-woman ratio; using 15-49 would overstate 0-4 by about 40%.
const MOTHERS_FIRST = 4;
const MOTHERS_LAST = 8;

/** Population cannot be negative; anything that is not a finite positive number becomes 0. */
function clamp(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Age one sex by one period: class j -> j+1 at survival + net migration; 90-94 and 95+ both land in 95+. */
function advance(v: AgeVec, surv: number[], mig: number[]): AgeVec {
  const next = new Array<number>(AGE_CLASSES).fill(0);
  for (let j = 0; j < OPEN_CLASS - 1; j++) {
    next[j + 1] = clamp(v[j] * (surv[j] + mig[j]));
  }
  const last = OPEN_CLASS - 1; // rate index 18 is "90+ -> 95+"
  next[OPEN_CLASS] = clamp((v[last] + v[OPEN_CLASS]) * (surv[last] + mig[last]));
  return next;
}

/**
 * Advance a population by one 5-year period.
 * @param pop population at the start of the period (not modified)
 * @param a   survival, net migration, child-woman ratio and sex ratio of that period
 * @param cwrMult multiplier on the child-woman ratio (scenario knob, default 1)
 */
export function step(pop: Pop, a: Assumption, cwrMult = 1): Pop {
  const M = advance(pop.M, a.surv.M, a.mig.M);
  const F = advance(pop.F, a.surv.F, a.mig.F);

  let mothers = 0;
  for (let j = MOTHERS_FIRST; j <= MOTHERS_LAST; j++) mothers += F[j];
  const kids = clamp(a.cwr * cwrMult * mothers);
  const boys = clamp((kids * a.sexRatio) / (100 + a.sexRatio));
  M[0] = boys;
  F[0] = clamp(kids - boys);
  return { M, F };
}
