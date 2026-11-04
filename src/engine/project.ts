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
  let pop = area.base;
  for (let year = BASE_YEAR; year + PERIOD <= endYear; year += PERIOD) {
    const idx = Math.min((year - BASE_YEAR) / PERIOD, periods.length - 1);
    const official: Assumption = periods[idx];
    const lost = infraFacilities && year >= OFFICIAL_END_YEAR ? lostEssentialCount(total(pop), infraFacilities) : 0;
    const a = adjustAssumption(official, migMultiplier(s, year), lost, s.infraStrength);
    pop = step(pop, a, cwrMultiplier(s, year));
    out[year + PERIOD] = pop;
  }
  return out;
}

/** Official ages to 2050, then the prefecture's period-by-period change applied to both sexes uniformly. */
function projectVillage(area: Area, refTotals: Map<number, number> | undefined, endYear: number): Series {
  const ages = area.officialAges;
  if (!ages) throw new Error(`projectAll: area ${area.code} has neither assumptions nor officialAges`);
  const out: Series = { [BASE_YEAR]: clonePop(area.base) };
  let lastYear = BASE_YEAR;
  for (let year = BASE_YEAR + PERIOD; year <= endYear; year += PERIOD) {
    const official = ages[year];
    if (!official) break;
    out[year] = clonePop(official);
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
 * `facilities` is required when `s.infraStrength > 0` (see projectArea). The villages do not lose facilities
 * of their own; they follow their prefecture, which already includes the infra effect on the other areas.
 */
export function projectAll(
  areas: Area[],
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
): Map<string, Series> {
  checkEndYear(endYear);
  checkScenario('projectAll', s, facilities);
  const projected = new Map<string, Series>();
  const prefTotals = new Map<string, Map<number, number>>(); // prefCode -> year -> total of areas with assumptions

  for (const area of areas) {
    if (area.assumptions === null) continue;
    const series = projectArea(area, s, endYear, facilities);
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
      projected.get(area.code) ?? projectVillage(area, prefTotals.get(area.prefCode), endYear),
    );
  }
  return out;
}
