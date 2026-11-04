import { describe, expect, it } from 'vitest';
import { loadAllAreas, loadSampleAreas, byCode } from '../../test/helpers/loadAreas';
import { step } from './step';
import { total } from './aggregate';
import type { Assumption, Pop } from './types';

const AGES = 20;

function flatAssumption(surv: number, mig: number, cwr: number, sexRatio: number): Assumption {
  return {
    surv: { M: new Array(19).fill(surv), F: new Array(19).fill(surv) },
    mig: { M: new Array(19).fill(mig), F: new Array(19).fill(mig) },
    cwr,
    sexRatio,
  };
}

function ramp(offset: number): Pop {
  return {
    M: Array.from({ length: AGES }, (_, j) => 100 + j + offset),
    F: Array.from({ length: AGES }, (_, j) => 200 + j + offset),
  };
}

describe('step: one 5-year cohort-component period', () => {
  it('ages every class one step with survival plus net migration (additive), per sex', () => {
    const pop = ramp(0);
    const a = flatAssumption(0.9, 0.05, 0.2, 105);
    const next = step(pop, a);
    for (let j = 0; j <= 17; j++) {
      expect(next.M[j + 1]).toBeCloseTo(pop.M[j] * 0.95, 9);
      expect(next.F[j + 1]).toBeCloseTo(pop.F[j] * 0.95, 9);
    }
  });

  it('folds 90-94 and 95+ together into 95+', () => {
    const pop = ramp(0);
    const next = step(pop, flatAssumption(0.9, 0.05, 0.2, 105));
    expect(next.M[19]).toBeCloseTo((pop.M[18] + pop.M[19]) * 0.95, 9);
    expect(next.F[19]).toBeCloseTo((pop.F[18] + pop.F[19]) * 0.95, 9);
  });

  it('uses each sex and each age its own rate', () => {
    const pop = ramp(0);
    const a = flatAssumption(1, 0, 0, 100);
    a.surv.M[3] = 0.5;
    a.mig.F[7] = -0.25;
    const next = step(pop, a);
    expect(next.M[4]).toBeCloseTo(pop.M[3] * 0.5, 9);
    expect(next.F[4]).toBeCloseTo(pop.F[3], 9);
    expect(next.F[8]).toBeCloseTo(pop.F[7] * 0.75, 9);
    expect(next.M[8]).toBeCloseTo(pop.M[7], 9);
  });

  it('computes births from women aged 20-44 (classes 4..8 after ageing), not 15-49', () => {
    const pop = ramp(0);
    const a = flatAssumption(1, 0, 0.3, 100);
    const next = step(pop, a);
    const women2044 = next.F[4] + next.F[5] + next.F[6] + next.F[7] + next.F[8];
    // class 3 (15-19) and class 9 (45-49) must not be part of the denominator
    expect(women2044).toBeCloseTo(pop.F[3] + pop.F[4] + pop.F[5] + pop.F[6] + pop.F[7], 9);
    const kids = 0.3 * women2044;
    expect(next.M[0] + next.F[0]).toBeCloseTo(kids, 9);
  });

  it('splits births by the sex ratio (males per 100 females)', () => {
    const pop = ramp(0);
    const next = step(pop, flatAssumption(1, 0, 0.3, 105));
    expect(next.M[0] / next.F[0]).toBeCloseTo(105 / 100, 9);
  });

  it('cwrMult scales only the births (default 1)', () => {
    const pop = ramp(0);
    const a = flatAssumption(0.95, 0.01, 0.25, 105);
    const base = step(pop, a);
    const same = step(pop, a, 1);
    const more = step(pop, a, 1.2);
    expect(same).toEqual(base);
    expect(more.M[0] + more.F[0]).toBeCloseTo(1.2 * (base.M[0] + base.F[0]), 9);
    for (let j = 1; j < AGES; j++) {
      expect(more.M[j]).toBe(base.M[j]);
      expect(more.F[j]).toBe(base.F[j]);
    }
  });

  it('clamps every class at 0 when net out-migration exceeds survival', () => {
    const pop = ramp(0);
    const next = step(pop, flatAssumption(0.9, -0.95, 0.2, 105));
    for (let j = 1; j < AGES; j++) {
      expect(next.M[j]).toBe(0);
      expect(next.F[j]).toBe(0);
    }
    expect(next.M[0]).toBe(0); // no women left, so no births
    expect(next.F[0]).toBe(0);
  });

  it('never returns NaN or Infinity, even for an empty population or a bad rate', () => {
    const empty: Pop = { M: new Array(AGES).fill(0), F: new Array(AGES).fill(0) };
    const e = step(empty, flatAssumption(0.9, 0.05, 0.2, 105));
    expect([...e.M, ...e.F].every((x) => Number.isFinite(x) && x === 0)).toBe(true);

    const a = flatAssumption(0.9, 0.05, 0.2, 105);
    a.surv.F[5] = NaN;
    const n = step(ramp(0), a);
    expect([...n.M, ...n.F].every((x) => Number.isFinite(x) && x >= 0)).toBe(true);
  });

  it('does not mutate its input', () => {
    const pop = ramp(0);
    const copy = structuredClone(pop);
    step(pop, flatAssumption(0.9, 0.05, 0.2, 105));
    expect(pop).toEqual(copy);
  });

  it('returns 20 classes per sex', () => {
    const next = step(ramp(0), flatAssumption(0.9, 0.05, 0.2, 105));
    expect(next.M).toHaveLength(AGES);
    expect(next.F).toHaveLength(AGES);
  });
});

describe('step: against the official 2025 results', () => {
  const sample = loadSampleAreas();

  it('moves 田辺市 from the 2020 census to about the official 2025 total', () => {
    const tanabe = byCode(sample, '30206');
    const next = step(tanabe.base, tanabe.assumptions![0]);
    expect(Math.abs(total(next) / tanabe.official[2025] - 1)).toBeLessThan(0.001);
  });

  it('reproduces_first_period_totals: all 1,871 areas within 1% of the official 2025 total', () => {
    const withAssumptions = loadAllAreas().filter((a) => a.assumptions !== null);
    expect(withAssumptions).toHaveLength(1871);
    let worst = 0;
    let nat = 0;
    let natOfficial = 0;
    let kids = 0;
    for (const a of withAssumptions) {
      const next = step(a.base, a.assumptions![0]);
      const t = total(next);
      worst = Math.max(worst, Math.abs(t / a.official[2025] - 1));
      nat += t;
      natOfficial += a.official[2025];
      kids += next.M[0] + next.F[0];
    }
    expect(worst).toBeLessThanOrEqual(0.01);
    expect(Math.abs(nat / natOfficial - 1)).toBeLessThanOrEqual(0.001);

    // Official 2025 population aged 0-4, summed over the same 1,871 areas (IPSS 令和5年推計, suikei_kekka.xlsx,
    // male + female, 0-4 class). Using women 15-49 as the denominator would give about 1.4 times this.
    const OFFICIAL_AGE_0_4_2025 = 3_952_307;
    expect(Math.abs(kids / OFFICIAL_AGE_0_4_2025 - 1)).toBeLessThanOrEqual(0.01);
  });
});
