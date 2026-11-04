// Multi-period projection: official assumptions to 2050, held (and scenario-adjusted) rates to 2100.
import { total } from './aggregate';
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

/**
 * Project an area that has official assumptions.
 *
 * Periods 2020->25 ... 2045->50 use the official rates. Later periods hold the 2045->2050 survival and
 * migration rates and the 2050 child-woman ratio and sex ratio; `s.cwrMult` multiplies the child-woman
 * ratio for periods that END after 2050 (2050->55 onward), so the 2050 result stays the official one.
 *
 * Reserved: `s.migMode`, `s.migScale`, `s.infraStrength` and `facilities` are accepted but not used yet;
 * the migration and infrastructure features (Task 6) implement them here.
 */
export function projectArea(
  area: Area,
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
): Series {
  void facilities; // reserved for the infra feedback feature (Task 6)
  checkEndYear(endYear);
  const periods = area.assumptions;
  if (periods === null || periods.length === 0) {
    throw new Error(`projectArea: area ${area.code} has no assumptions; use projectAll for villages`);
  }
  const lastOfficialYear = BASE_YEAR + PERIOD * periods.length; // 2050

  const out: Series = { [BASE_YEAR]: clonePop(area.base) };
  let pop = area.base;
  for (let year = BASE_YEAR; year + PERIOD <= endYear; year += PERIOD) {
    const idx = Math.min((year - BASE_YEAR) / PERIOD, periods.length - 1);
    const a: Assumption = periods[idx];
    const mult = year >= lastOfficialYear ? s.cwrMult : 1;
    pop = step(pop, a, mult);
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
 * `facilities` is reserved for the infra feedback feature (Task 6) and passed through unused.
 */
export function projectAll(
  areas: Area[],
  s: Scenario,
  endYear: number = DEFAULT_END_YEAR,
  facilities?: Facility[],
): Map<string, Series> {
  checkEndYear(endYear);
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
