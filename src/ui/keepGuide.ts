// "What would it take to reach this facility's guide, and what falls below elsewhere?" (pure part, no DOM).
//
// For a town and one facility that is below the MLIT population guide (p50) in the selected year, this module answers
// two questions with the same populations the facility table uses:
//   1. how many more people the town would need to reach the 50% guide (and the 80% guide, when it is a different
//      number): `keepNeeds`;
//   2. one what-if for the 50% guide only: move exactly that many people into the town from every other area in
//      proportion to their population (`allocate`, the engine behind the allocation panel), and count the other
//      areas that go from "has the facility" to below some facility's guide because of it: `computeKeep`.
//
// Honest limits, kept in the wording: the people moved are a thought experiment, not a forecast of anyone's moves;
// the guide is a 2009-2012 statistic of how common a facility is among municipalities of a size, not a cause. Nothing
// here says a town or a facility should or should not be kept, and the verbs are always 「人口の目安を下回る」.
import { allocate, type AllocationResult, type FacilityFlip } from '../engine/allocation';
import { facilityStatus } from '../engine/facilities';
import type { Facility } from '../engine/types';
import type { PopulationAt } from './allocationCore';
import { buildOverlay, deltaLabel } from './allocationOverlay';
import { approxPeople, formatCount, formatPeople } from './format';
import type { AllocationOverlay } from './state';

/** How many facilities the result names (the ones with the most areas going below). */
export const KEEP_TOP = 3;

// ---------------------------------------------------------------------------------------------------------------
// People needed
// ---------------------------------------------------------------------------------------------------------------

export interface KeepNeeds {
  /** People the town would need to reach the 50% guide: ceil(p50 - pop). Always at least 1. */
  need50: number;
  /** People to reach the 80% guide: ceil(p80 - pop). Undefined when p80 is not above p50 (one guide only). */
  need80: number | undefined;
}

/**
 * What a town of `pop` people needs to reach the guide of `f`; undefined when it is not below the guide (a town at
 * exactly p50 is on the edge, not below) or when `pop` is not a number. `pop` is used unrounded, as the table does.
 */
export function keepNeeds(pop: number, f: Facility): KeepNeeds | undefined {
  if (Number.isNaN(pop) || facilityStatus(pop, f) !== 'below') return undefined;
  return { need50: Math.ceil(f.p50 - pop), need80: f.p80 > f.p50 ? Math.ceil(f.p80 - pop) : undefined };
}

// ---------------------------------------------------------------------------------------------------------------
// The what-if
// ---------------------------------------------------------------------------------------------------------------

export interface KeepLoss {
  facilityId: string;
  name: string;
  /** Other areas that went from at-or-above this facility's guide to below it. */
  count: number;
}

export interface KeepEffects {
  /** Other areas that fall below at least one facility's guide (each counted once). */
  areaCount: number;
  /** Up to KEEP_TOP facilities, the most areas first; equal counts keep the facility list order. */
  top: KeepLoss[];
}

/**
 * Read an allocation's flips for the other areas: the town itself is never counted (it only gains people). Facilities
 * are ordered by the number of areas going below, ties by their place in `facilities`; unknown ids come last.
 */
export function keepEffects(flips: readonly FacilityFlip[], facilities: readonly Facility[], townCode: string): KeepEffects {
  const order = new Map(facilities.map((f, i) => [f.id, i] as const));
  const names = new Map(facilities.map((f) => [f.id, f.name] as const));
  const everyone = new Set<string>();
  const losses: KeepLoss[] = [];
  for (const flip of flips) {
    const others = flip.lost.filter((code) => code !== townCode);
    if (others.length === 0) continue;
    for (const code of others) everyone.add(code);
    losses.push({ facilityId: flip.facilityId, name: names.get(flip.facilityId) ?? flip.facilityId, count: others.length });
  }
  losses.sort((a, b) => b.count - a.count || (order.get(a.facilityId) ?? Infinity) - (order.get(b.facilityId) ?? Infinity));
  return { areaCount: everyone.size, top: losses.slice(0, KEEP_TOP) };
}

export type KeepOutcome =
  /** `allocate` refused the number of people (RangeError): nothing else is shown. */
  | { kind: 'too-large' }
  | {
      kind: 'ok';
      /** People moved into the town: `need50`. */
      people: number;
      effects: KeepEffects;
      /** The engine's result, kept so the map overlay can be built from it. */
      result: AllocationResult;
    };

export interface KeepComputation {
  needs: KeepNeeds;
  outcome: KeepOutcome;
}

/**
 * The needs and the what-if for one facility of one town, from the populations of every area in one year. Returns
 * undefined when the town is not below the facility's guide (or is unknown). The what-if moves `need50` people into
 * the town from every other area in proportion to their population (the national total does not change).
 */
export function computeKeep(at: PopulationAt, facilities: Facility[], facility: Facility, townCode: string): KeepComputation | undefined {
  const pop = at.popByArea.get(townCode);
  if (pop === undefined) return undefined;
  const needs = keepNeeds(pop, facility);
  if (!needs) return undefined;
  let result: AllocationResult;
  try {
    result = allocate(at.popByArea, at.areaPref, { target: { kind: 'area', code: townCode }, deltaPeople: needs.need50, source: { mode: 'proportional' } }, facilities);
  } catch (e) {
    if (e instanceof RangeError) return { needs, outcome: { kind: 'too-large' } };
    throw e;
  }
  return { needs, outcome: { kind: 'ok', people: needs.need50, effects: keepEffects(result.flips, facilities, townCode), result } };
}

/**
 * The map overlay for a what-if (the same object the allocation panel draws): every area's change, the facilities
 * whose count of towns changed, and this facility in focus so its rings show on the map.
 */
export function keepOverlay(c: Extract<KeepOutcome, { kind: 'ok' }>, at: PopulationAt, facilities: readonly Facility[], year: number, place: string, facilityId: string): AllocationOverlay {
  return buildOverlay({ result: c.result, before: at.popByArea, facilities, year, label: `${place} ${deltaLabel(undefined, c.people)}`, focusFacilityId: facilityId });
}

// ---------------------------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------------------------

export const KEEP_SUMMARY = 'この目安に届くには';
export const KEEP_BUTTON = '地図に反映する';
export const KEEP_APPLIED = '地図に反映しました。地図の色は、割り振りによる人口の変化を示します。';
export const KEEP_FAILED = '地図に反映できませんでした。';
export const KEEP_TOO_LARGE = '人数が大きすぎて、この計算はできません。';
export const KEEP_NO_EFFECT = 'このとき、ほかの町で新しく人口の目安を下回る施設はありません。';
export const KEEP_TOP_LEAD = '下回る町がいちばん多い施設';
/** The one sentence of limits: a thought experiment, a statistic, no cause. */
export const KEEP_LIMITS =
  'ここで動かす人数は、「もし移ったら」を見るための仮の数（実際の人の動きの予測ではありません）で、人口の目安も2009〜2012年の統計から出した目安なので、人口が増えれば施設ができるという関係を示すものではありません。';

export interface NeedLine {
  /** 「50%の目安（1,500人）まで」 */
  label: string;
  /** 「あと約360人」 */
  value: string;
}

/** The lines of people needed: the 50% guide, and the 80% guide when it is a different number. One guide: one line. */
export function keepNeedLines(f: Pick<Facility, 'p50' | 'p80'>, needs: KeepNeeds): NeedLine[] {
  if (needs.need80 === undefined) return [{ label: `目安（${formatPeople(f.p50)}）まで`, value: `あと${approxPeople(needs.need50)}` }];
  return [
    { label: `50%の目安（${formatPeople(f.p50)}）まで`, value: `あと${approxPeople(needs.need50)}` },
    { label: `80%の目安（${formatPeople(f.p80)}）まで`, value: `あと${approxPeople(needs.need80)}` },
  ];
}

/** The premise of the what-if, in words: which guide, how many people, from where. */
export function keepPremise(f: Pick<Facility, 'p50' | 'p80'>, people: number): string {
  const guide = f.p80 > f.p50 ? '50%の目安' : '目安';
  return `${guide}に届くところまで、ほかの町から${approxPeople(people)}が移ってきたと考えます。ほかの町の人口に比例して減らし、全国の合計は変わりません。`;
}

/** What happens elsewhere, in one sentence. */
export function keepEffectLine(effects: KeepEffects): string {
  if (effects.areaCount === 0) return KEEP_NO_EFFECT;
  return `このとき、ほかの${formatCount(effects.areaCount)}町が、いずれかの施設の人口の目安を下回ります。`;
}

/** 「診療所（3町）」 */
export function keepTopText(loss: KeepLoss): string {
  return `${loss.name}（${formatCount(loss.count)}町）`;
}
