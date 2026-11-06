// "When, and where, does what fall below its population guide?" (pure part, no DOM).
//
// The MLIT guide (Facility.p50) is the population of a municipality at which a kind of facility is present in half of the
// municipalities of that size (a 2009-2012 statistic). A municipality "falls below" a facility's guide in the first year
// of the five-yearly grid in which its population is under p50, after having been at or above it. This module finds those
// years for one area, and for a whole scope (the country or a prefecture), and ranks them for a short list.
//
// It says when a number crosses a statistic's line. It does not say that a facility closes, is lost or cannot be kept:
// the guide is how common the facility is among towns of a size, not a cause, and nothing here knows about any one
// facility's revenue, staff or buildings.
import type { Facility } from './types';

export interface Crossing {
  areaCode: string;
  facilityId: string;
  /** The first grid year in which the population is below the guide, after a year at or above it. */
  year: number;
  /** The population in the grid year before `year` (at or above the guide). */
  popBefore: number;
  /** The population in `year` (below the guide). */
  pop: number;
}

export interface AlreadyBelow {
  areaCode: string;
  facilityId: string;
  /** The population in the first year of the series, which is already below the guide. */
  pop: number;
}

export interface AreaCrossings {
  crossings: Crossing[];
  alreadyBelow: AlreadyBelow[];
}

/**
 * The crossings of one area. `years` and `pops` run side by side (the same index is the same year). A year without a
 * number (NaN) is skipped, as if it were not on the grid. An area that is below a guide in its first year has no
 * crossing for that facility: it is listed in `alreadyBelow`. An area that rises above a guide again later keeps the
 * first crossing only. Output order: by year, then by the order of `facilities`.
 */
export function areaCrossings(areaCode: string, years: readonly number[], pops: ArrayLike<number>, facilities: readonly Facility[]): AreaCrossings {
  const crossings: Crossing[] = [];
  const alreadyBelow: AlreadyBelow[] = [];
  // the usable years, in order
  const idx: number[] = [];
  for (let i = 0; i < years.length; i++) if (!Number.isNaN(pops[i])) idx.push(i);
  if (idx.length === 0) return { crossings, alreadyBelow };
  const first = idx[0];
  for (const f of facilities) {
    if (pops[first] < f.p50) {
      alreadyBelow.push({ areaCode, facilityId: f.id, pop: pops[first] });
      continue;
    }
    for (let k = 1; k < idx.length; k++) {
      const i = idx[k];
      if (pops[i] < f.p50) {
        crossings.push({ areaCode, facilityId: f.id, year: years[i], popBefore: pops[idx[k - 1]], pop: pops[i] });
        break;
      }
    }
  }
  const order = new Map(facilities.map((f, i) => [f.id, i] as const));
  crossings.sort((a, b) => a.year - b.year || (order.get(a.facilityId) ?? 0) - (order.get(b.facilityId) ?? 0));
  return { crossings, alreadyBelow };
}

/** The crossings of every area of a scope (the codes may include areas with no series: they are skipped). */
export function scopeCrossings(
  codes: readonly string[],
  years: readonly number[],
  popsOf: (areaCode: string) => ArrayLike<number> | undefined,
  facilities: readonly Facility[],
): AreaCrossings {
  const crossings: Crossing[] = [];
  const alreadyBelow: AlreadyBelow[] = [];
  for (const code of codes) {
    const pops = popsOf(code);
    if (!pops) continue;
    const r = areaCrossings(code, years, pops, facilities);
    crossings.push(...r.crossings);
    alreadyBelow.push(...r.alreadyBelow);
  }
  return { crossings, alreadyBelow };
}

export interface YearCount {
  year: number;
  /** Areas that fall below the guide of at least one facility in this year (each area once). */
  areas: number;
  /** Crossings in this year (an area crossing two facilities in one year counts two). */
  crossings: number;
}

/** Per grid year in `years` (after the first): how many areas and crossings. Years with none are listed with zeros. */
export function crossingsPerYear(crossings: readonly Crossing[], years: readonly number[]): YearCount[] {
  const out = new Map<number, { areas: Set<string>; crossings: number }>();
  for (const y of years.slice(1)) out.set(y, { areas: new Set(), crossings: 0 });
  for (const c of crossings) {
    const slot = out.get(c.year);
    if (!slot) continue;
    slot.areas.add(c.areaCode);
    slot.crossings++;
  }
  return [...out].map(([year, v]) => ({ year, areas: v.areas.size, crossings: v.crossings }));
}

export interface FacilityYearGroup {
  facilityId: string;
  year: number;
  /** Every crossing of this facility in this year, the most populous (before the crossing) first. */
  items: Crossing[];
}

/**
 * The crossings of a scope grouped by facility and year, for a short list: by year first, then the essential facilities
 * before the others, then the facility list order. Inside a group the town that had the most people before comes first.
 */
export function groupCrossings(crossings: readonly Crossing[], facilities: readonly Facility[]): FacilityYearGroup[] {
  const byId = new Map(facilities.map((f, i) => [f.id, { f, i }] as const));
  const groups = new Map<string, FacilityYearGroup>();
  for (const c of crossings) {
    const key = `${c.year}|${c.facilityId}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { facilityId: c.facilityId, year: c.year, items: [] }));
    g.items.push(c);
  }
  for (const g of groups.values()) g.items.sort((a, b) => b.popBefore - a.popBefore || a.areaCode.localeCompare(b.areaCode));
  const rank = (g: FacilityYearGroup) => byId.get(g.facilityId);
  return [...groups.values()].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const ra = rank(a);
    const rb = rank(b);
    const ea = ra?.f.essential ? 0 : 1;
    const eb = rb?.f.essential ? 0 : 1;
    return ea - eb || (ra?.i ?? Infinity) - (rb?.i ?? Infinity);
  });
}
