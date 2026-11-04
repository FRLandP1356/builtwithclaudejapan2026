// Zero-sum population allocation: move people to (or from) a target group and take them from (or give them to)
// the rest of the country, and report which service facilities appear or disappear as a result.
import { facilityStatus } from './facilities';
import type { Facility } from './types';

export interface AllocationInput {
  target: { kind: 'pref' | 'area'; code: string }; // pref: 2 digits, area: 5 digits
  deltaPeople: number; // positive: the target gains people. negative: the target loses people
  source: { mode: 'proportional' } | { mode: 'regions'; prefCodes: string[] };
}

/** Per facility: how many areas have it (status ok or edge) before and after, and which areas changed. */
export interface FacilityFlip {
  facilityId: string;
  before: number;
  after: number;
  lost: string[]; // codes that went from ok/edge to below
  gained: string[]; // codes that went from below to ok/edge
}

export interface AllocationResult {
  total: number; // sum of `pop`; equal to the input total within floating-point noise
  pop: Map<string, number>; // same keys and order as the input
  flips: FacilityFlip[]; // one entry per facility, in the order given
}

/** Neumaier-compensated sum: stays accurate to far below 1e-6 on a national total of ~1e8 over ~1.9k terms. */
function exactSum(values: Iterable<number>): number {
  let sum = 0;
  let compensation = 0;
  for (const v of values) {
    const t = sum + v;
    compensation += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  return sum + compensation;
}

/**
 * Move `input.deltaPeople` people into the target group and take the same number out of the source group, so the
 * national total does not change. A negative delta does the opposite. Inside each group the change is spread in
 * proportion to current population (every area in the group is multiplied by the same factor), so the function
 * works on totals only and knows nothing about age structure.
 *
 * - target group: the one area (`kind: 'area'`) or every area of the prefecture (`kind: 'pref'`).
 * - source group: every area outside the target (`proportional`), or every area outside the target whose
 *   prefecture is in `prefCodes` (`regions`). The target's own areas are never part of the source.
 * - `popByArea` is the population of each area at ONE year; `areaPref` maps each of those areas to its 2-digit
 *   prefecture code. Populations are floats and are not rounded here. Inputs are never mutated.
 *
 * Flip lists use the facility status of each area's total population (see facilities.ts): an area "has" a facility
 * when its status is `ok` or `edge`, so edge <-> ok is not a flip.
 *
 * Throws RangeError when `deltaPeople` is not finite, when an area has a population that is not a finite number
 * >= 0 or no entry in `areaPref`, when the target or source group is empty, when a positive delta exceeds the
 * source group's population, when a negative delta exceeds the target group's population, or when a non-zero
 * delta must be spread over a group with no people.
 */
export function allocate(
  popByArea: Map<string, number>,
  areaPref: Map<string, string>,
  input: AllocationInput,
  facilities: Facility[],
): AllocationResult {
  const { target, deltaPeople, source } = input;
  if (!Number.isFinite(deltaPeople)) {
    throw new RangeError(`allocate: deltaPeople must be a finite number, got ${deltaPeople}`);
  }
  if (target.kind !== 'area' && target.kind !== 'pref') {
    throw new RangeError(`allocate: unknown target kind ${String((target as { kind: unknown }).kind)}`);
  }
  if (source.mode !== 'proportional' && source.mode !== 'regions') {
    throw new RangeError(`allocate: unknown source mode ${String((source as { mode: unknown }).mode)}`);
  }

  const sourcePrefs = source.mode === 'regions' ? new Set(source.prefCodes) : null;
  const targetCodes = new Set<string>();
  const sourceCodes = new Set<string>();
  for (const [code, p] of popByArea) {
    if (!Number.isFinite(p) || p < 0) {
      throw new RangeError(`allocate: population of ${code} must be a finite number >= 0, got ${p}`);
    }
    const pref = areaPref.get(code);
    if (pref === undefined) throw new RangeError(`allocate: area ${code} has no prefecture in areaPref`);
    const inTarget = target.kind === 'area' ? code === target.code : pref === target.code;
    if (inTarget) targetCodes.add(code);
    else if (sourcePrefs === null || sourcePrefs.has(pref)) sourceCodes.add(code);
  }
  if (targetCodes.size === 0) {
    throw new RangeError(`allocate: no area matches target ${target.kind} ${target.code}`);
  }
  if (sourceCodes.size === 0) {
    throw new RangeError('allocate: no area is left to give or take people (source group is empty)');
  }

  const targetTotal = exactSum([...targetCodes].map((c) => popByArea.get(c)!));
  const sourceTotal = exactSum([...sourceCodes].map((c) => popByArea.get(c)!));
  if (deltaPeople > sourceTotal) {
    throw new RangeError(`allocate: delta ${deltaPeople} is larger than the source group's population ${sourceTotal}`);
  }
  if (-deltaPeople > targetTotal) {
    throw new RangeError(`allocate: delta ${deltaPeople} takes more than the target group's population ${targetTotal}`);
  }
  if (deltaPeople !== 0 && (targetTotal === 0 || sourceTotal === 0)) {
    throw new RangeError('allocate: a group with no people cannot be scaled proportionally');
  }
  const targetFactor = deltaPeople === 0 ? 1 : (targetTotal + deltaPeople) / targetTotal;
  const sourceFactor = deltaPeople === 0 ? 1 : (sourceTotal - deltaPeople) / sourceTotal;

  const pop = new Map<string, number>();
  for (const [code, p] of popByArea) {
    if (targetCodes.has(code)) pop.set(code, p * targetFactor);
    else if (sourceCodes.has(code)) pop.set(code, p * sourceFactor);
    else pop.set(code, p);
  }

  const flips: FacilityFlip[] = facilities.map((f) => {
    let before = 0;
    let after = 0;
    const lost: string[] = [];
    const gained: string[] = [];
    for (const [code, p] of popByArea) {
      const had = facilityStatus(p, f) !== 'below';
      const has = facilityStatus(pop.get(code)!, f) !== 'below';
      if (had) before++;
      if (has) after++;
      if (had && !has) lost.push(code);
      else if (!had && has) gained.push(code);
    }
    return { facilityId: f.id, before, after, lost, gained };
  });

  return { total: exactSum(pop.values()), pop, flips };
}
