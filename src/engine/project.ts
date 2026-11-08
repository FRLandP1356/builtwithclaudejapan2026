// Multi-period projection: official assumptions to 2050, held (and scenario-adjusted) rates to 2100.
import { total } from './aggregate';
import { lostEssentialCount } from './facilities';
import { adjustAssumption } from './infra';
import { cwrMultiplier, migMultiplier, OFFICIAL_END_YEAR } from './scenarios';
import { step } from './step';
import type { Area, Assumption, Facility, Pop, Scenario, Series } from './types';

const BASE_YEAR = 2020;
const PERIOD = 5;
const DEFAULT_END_YEAR = 2100;

function clonePop(p: Pop): Pop {
  return { M: p.M.slice(), F: p.F.slice() };
}

function checkEndYear(endYear: number): void {
  if (!Number.isFinite(endYear) || endYear < BASE_YEAR) {
    throw new RangeError(`endYear must be a year >= ${BASE_YEAR}, got ${endYear}`);
  }
}

/** Reject scenarios the engine cannot run: a bad infraStrength, or infra feedback without a facility list. */
function checkScenario(caller: string, s: Scenario, facilities: Facility[] | undefined): void {
  if (!(s.infraStrength >= 0)) {
    throw new RangeError(`${caller}: infraStrength must be a number >= 0, got ${s.infraStrength}`);
  }
  if (s.infraStrength > 0 && facilities === undefined) {
    throw new Error(`${caller}: infraStrength > 0 needs the facility list; pass \`facilities\` (the contents of facilities.json)`);
  }
}

/**
 * Project an area that has official assumptions.
 *
 * Periods 2020->25 ... 2045->50 use the official rates, whatever the scenario. Later periods hold the
 * 2045->2050 survival and migration rates and the 2050 child-woman ratio and sex ratio, adjusted by the
 * scenario for every period that starts in 2050 or later:
 * - `cwrMult` multiplies the child-woman ratio (so the 2050 result stays the official one);
 * - net migration of every age class becomes `mig * migScale * fadeFactor(y) - infraStrength * lost`, where
 *   fadeFactor is 1 for 'hold' and falls to 0 by 2100 for 'fade' (see scenarios.ts), and `lost` is the number of
 *   essential facilities below their 50% threshold for the area's own total population at the START of the
 *   period (see facilities.ts), taken from this scenario's running projection so the loss feeds back.
 *
 * `facilities` is read only when `s.infraStrength > 0`, and is then required (an Error is thrown without it).
 * With infraStrength 0 the result does not depend on `facilities`.
 */
export function projectArea(
  area: Area,
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
): Series {
  checkEndYear(endYear);
  checkScenario('projectArea', s, facilities);
  const periods = area.assumptions;
  if (periods === null || periods.length === 0) {
    throw new Error(`projectArea: area ${area.code} has no assumptions; use projectAll for villages`);
  }
  const infraFacilities = s.infraStrength > 0 ? facilities : undefined; // checked above: defined when needed

  const out: Series = { [BASE_YEAR]: clonePop(area.base) };
  advance(out, area.base, BASE_YEAR, endYear, periods, s, infraFacilities);
  return out;
}

/** Run the 5-year steps from `startYear` (population `start`) to `endYear`, writing each result into `out`. */
function advance(
  out: Series,
  start: Pop,
  startYear: number,
  endYear: number,
  periods: Assumption[],
  s: Scenario,
  infraFacilities: Facility[] | undefined,
  cwrFactor = 1,
): void {
  let pop = start;
  for (let year = startYear; year + PERIOD <= endYear; year += PERIOD) {
    const idx = Math.min((year - BASE_YEAR) / PERIOD, periods.length - 1);
    const official: Assumption = periods[idx];
    const lost = infraFacilities && year >= OFFICIAL_END_YEAR ? lostEssentialCount(total(pop), infraFacilities) : 0;
    const a = adjustAssumption(official, migMultiplier(s, year), lost, s.infraStrength);
    pop = step(pop, a, cwrMultiplier(s, year) * cwrFactor);
    out[year + PERIOD] = pop;
  }
}

/** The year of the census count that `Area.actual` holds. */
export const ACTUAL_YEAR = 2025;

/**
 * Project an area that has official assumptions, starting again from the 2025 census count.
 *
 * 2020 is the 2020 census, 2025 is the 2025 census (an actual count, not a projection), and every later period uses
 * the same official rates as `projectArea` (periods 2025->30 ... 2045->50, then the held and scenario-adjusted rates),
 * applied to the real 2025 population by sex and age. The official projection started from 2020; this one replaces its
 * 2025 value with the count, so the five years of drift between the two are not carried forward.
 *
 * `cwrFactor` (default 1) multiplies the child-woman ratio of every period from 2025 on. With 1 the official births
 * assumption is kept; with the factor from `observedBirthsFactor` the births shortfall seen in 2020-2025 is assumed to
 * continue (a scenario, not a forecast).
 *
 * Throws when the area has no `actual` (the seven Hamamatsu wards); callers fall back to `projectArea`.
 */
export function projectAreaFromActual(
  area: Area,
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
  cwrFactor = 1,
): Series {
  checkEndYear(endYear);
  checkScenario('projectAreaFromActual', s, facilities);
  const periods = area.assumptions;
  if (periods === null || periods.length === 0) {
    throw new Error(`projectAreaFromActual: area ${area.code} has no assumptions; use projectAll for villages`);
  }
  if (!area.actual) throw new Error(`projectAreaFromActual: area ${area.code} has no 2025 census count`);
  const infraFacilities = s.infraStrength > 0 ? facilities : undefined;
  const out: Series = { [BASE_YEAR]: clonePop(area.base) };
  if (endYear < ACTUAL_YEAR) return out;
  out[ACTUAL_YEAR] = clonePop(area.actual);
  advance(out, area.actual, ACTUAL_YEAR, endYear, periods, s, infraFacilities, cwrFactor);
  return out;
}

/**
 * An area without a 2025 count (the seven Hamamatsu wards) in a run "from the actual": the official projection up to
 * 2025, then the same `cwrFactor` as every other area from 2025 on, so one national births assumption holds everywhere.
 */
function projectAreaFactorFrom2025(
  area: Area,
  s: Scenario,
  endYear: number,
  facilities: Facility[] | undefined,
  cwrFactor: number,
): Series {
  const periods = area.assumptions;
  if (periods === null || periods.length === 0 || endYear < ACTUAL_YEAR) return projectArea(area, s, endYear, facilities);
  const infraFacilities = s.infraStrength > 0 ? facilities : undefined;
  const out = projectArea(area, s, ACTUAL_YEAR, facilities);
  advance(out, out[ACTUAL_YEAR], ACTUAL_YEAR, endYear, periods, s, infraFacilities, cwrFactor);
  return out;
}

/** Official ages to 2050, then the prefecture's period-by-period change applied to both sexes uniformly. */
function projectVillage(
  area: Area,
  refTotals: Map<number, number> | undefined,
  endYear: number,
  fromActual = false,
): Series {
  const ages = area.officialAges;
  if (!ages) throw new Error(`projectAll: area ${area.code} has neither assumptions nor officialAges`);
  const out: Series = { [BASE_YEAR]: clonePop(area.base) };
  // From the 2025 count: 2025 is the count, and the official ages after it are scaled by actual / official (2025).
  const official25 = ages[ACTUAL_YEAR];
  const factor25 = fromActual && area.actual && official25 ? total(area.actual) / total(official25) : undefined;
  let lastYear = BASE_YEAR;
  for (let year = BASE_YEAR + PERIOD; year <= endYear; year += PERIOD) {
    const official = ages[year];
    if (!official) break;
    if (factor25 === undefined) {
      out[year] = clonePop(official);
    } else if (year === ACTUAL_YEAR) {
      out[year] = clonePop(area.actual as Pop);
    } else {
      out[year] = { M: official.M.map((x) => x * factor25), F: official.F.map((x) => x * factor25) };
    }
    lastYear = year;
  }

  let pop = out[lastYear];
  for (let year = lastYear; year + PERIOD <= endYear; year += PERIOD) {
    const now = refTotals?.get(year);
    const next = refTotals?.get(year + PERIOD);
    // No reference area in this prefecture (or an empty one): hold the population.
    const factor = now !== undefined && next !== undefined && now > 0 ? next / now : 1;
    pop = { M: pop.M.map((x) => x * factor), F: pop.F.map((x) => x * factor) };
    out[year + PERIOD] = pop;
  }
  return out;
}

/**
 * Project every area. Areas with assumptions go through the cohort-component engine; the villages without
 * assumptions follow the official ages to 2050, then the same prefecture's change (summed over the areas
 * that do have assumptions, under the same scenario). The map keeps the order of `areas`.
 *
 * With `fromActual`, every area that has a 2025 census count (`Area.actual`) is projected from that count instead of from 2020
 * (see projectAreaFromActual, including `cwrFactor`); the others run as before.
 *
 * `facilities` is required when `s.infraStrength > 0` (see projectArea). The villages do not lose facilities
 * of their own; they follow their prefecture, which already includes the infra effect on the other areas.
 */
export function projectAll(
  areas: Area[],
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
  fromActual = false,
  cwrFactor = 1,
): Map<string, Series> {
  checkEndYear(endYear);
  checkScenario('projectAll', s, facilities);
  const projected = new Map<string, Series>();
  const prefTotals = new Map<string, Map<number, number>>(); // prefCode -> year -> total of areas with assumptions

  for (const area of areas) {
    if (area.assumptions === null) continue;
    const series =
      fromActual && area.actual
        ? projectAreaFromActual(area, s, endYear, facilities, cwrFactor)
        : fromActual && cwrFactor !== 1
          ? projectAreaFactorFrom2025(area, s, endYear, facilities, cwrFactor)
          : projectArea(area, s, endYear, facilities);
    projected.set(area.code, series);
    let byYear = prefTotals.get(area.prefCode);
    if (!byYear) prefTotals.set(area.prefCode, (byYear = new Map()));
    for (const key of Object.keys(series)) {
      const year = Number(key);
      byYear.set(year, (byYear.get(year) ?? 0) + total(series[year]));
    }
  }

  const out = new Map<string, Series>();
  for (const area of areas) {
    out.set(
      area.code,
      projected.get(area.code) ?? projectVillage(area, prefTotals.get(area.prefCode), endYear, fromActual),
    );
  }
  return out;
}
