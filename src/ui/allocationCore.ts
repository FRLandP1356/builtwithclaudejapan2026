// Pure helpers shared by the allocation panel (allocationPanel.ts) and the overlay builder (allocationOverlay.ts):
// the population table at one year, the target group's people, and user-facing error messages. No DOM, no CSS, so
// both modules import it without importing each other.
import type { AppData } from '../data/loader';
import type { Area, Series } from '../engine/types';
import { deriveTotals, yearIndex } from './derive';

/** The place an allocation adds people to (or takes them from). */
export interface AllocationTarget {
  kind: 'pref' | 'area';
  code: string;
}

/** A form that cannot be turned into an allocation. The message is for the user (Japanese). */
export class AllocationFormError extends RangeError {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(`allocation form: ${userMessage}`);
    this.name = 'AllocationFormError';
    this.userMessage = userMessage;
  }
}

/** A message the user can read for anything the allocation can throw. Never shows an English engine message. */
export function allocationErrorMessage(e: unknown): string {
  if (e instanceof AllocationFormError) return e.userMessage;
  if (e instanceof RangeError) {
    const m = e.message;
    if (m.includes('takes more than the target')) return 'そこまで減らせる人口がありません。';
    if (m.includes("larger than the source")) return '人口を動かす元の地域に、それだけの人口がありません。';
    if (m.includes('source group is empty')) return '人口を動かす元になる地域がありません。';
    if (m.includes('no area matches target')) return '選んだ地域が見つかりません。';
  }
  return 'この条件では計算できませんでした。';
}

export interface PopulationAt {
  /** Population of each of the full area list at one year, in the order of `areas`. */
  popByArea: Map<string, number>;
  areaPref: Map<string, string>;
}

const prefMapCache = new WeakMap<readonly Area[], Map<string, string>>();

/** Every area's population in `year` under the series (Ruling 20: always the full list). */
export function populationAt(data: Pick<AppData, 'areas' | 'groups'>, series: Map<string, Series>, year: number): PopulationAt {
  const totals = deriveTotals(series, data.groups);
  const i = yearIndex(totals.years, year);
  if (i < 0) throw new RangeError(`populationAt: year ${year} is not in the series`);
  let areaPref = prefMapCache.get(data.areas);
  if (!areaPref) {
    areaPref = new Map(data.areas.map((a) => [a.code, a.prefCode]));
    prefMapCache.set(data.areas, areaPref);
  }
  const popByArea = new Map<string, number>();
  for (const a of data.areas) popByArea.set(a.code, totals.area.get(a.code)?.[i] ?? Number.NaN);
  return { popByArea, areaPref };
}

/** People in the target group (the prefecture, or the one town). */
export function targetPeople(target: AllocationTarget, at: PopulationAt): number {
  let sum = 0;
  for (const [code, p] of at.popByArea) {
    if (target.kind === 'area' ? code === target.code : at.areaPref.get(code) === target.code) sum += p;
  }
  return sum;
}
