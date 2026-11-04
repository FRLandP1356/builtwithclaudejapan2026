import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeEngineContext } from '../../test/helpers/engineContext';
import { total } from '../engine/aggregate';
import { allocate } from '../engine/allocation';
import { facilityStatus } from '../engine/facilities';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Area, Facility, Scenario, Series } from '../engine/types';
import { MAX_YEARS, TOOL_DEFS, TOOL_NAMES } from './toolDefs';
import { TOOL_NAMES as SHARED_NAMES } from './toolNames';
import { checkNumbers } from './numberCheck';
import { runTool } from './tools';
import type { EngineContext } from './tools';

const ctx = makeEngineContext();

interface ToolError {
  error: string;
  message: string;
}
interface Who {
  code: string;
  name: string;
  prefName?: string;
}
interface Scn {
  cwrMult: number;
  migMode: 'hold' | 'fade';
  migScale: number;
  infraStrength: number;
}
interface FindAreaOut {
  matches: Array<Who & { kind: string }>;
}
interface SeriesRow {
  year: number;
  requestedYear?: number;
  population: number;
  ages65: number;
  ages65Share: number;
  changeFrom2020Percent: number;
  basis: string;
}
interface SeriesOut {
  area: Who;
  scenario: Scn;
  rows: SeriesRow[];
}
interface CompareOut {
  area: Who;
  scenario: Scn;
  official: Array<{ year: number; official: number; app: number; difference: number; relativeDifference: number }>;
  maxRelativeDifference: number;
  maxRelativeDifferencePercent: number;
  maxAbsoluteDifference: number;
  appEstimate: Array<{ year: number; population: number; basis: string }>;
  note: string;
}
interface ProjectionOut {
  area: Who;
  scenario: Scn;
  rows: Array<{
    year: number;
    basis: string;
    scenarioPopulation: number;
    defaultPopulation: number;
    difference: number;
    differencePercent: number;
  }>;
}
interface FacilityRow {
  id: string;
  name: string;
  status: 'ok' | 'edge' | 'below';
  essential: boolean;
  p50: number;
  p80: number;
}
interface FacilityOut {
  area: Who;
  year: number;
  requestedYear?: number;
  scenario: Scn;
  population: number;
  outsideMlitScope: boolean;
  note?: string;
  counts: { ok: number; edge: number; below: number };
  facilityCount: number;
  facilityTotal: number;
  thresholds: { edgePercent: number; okPercent: number };
  facilities: FacilityRow[];
}
interface Flip {
  facilityId: string;
  name: string;
  essential: boolean;
  before: number;
  after: number;
  lostCount: number;
  gainedCount: number;
  lostExamples: string[];
  gainedExamples: string[];
}
interface AllocOut {
  year: number;
  requestedYear?: number;
  scenario: Scn;
  target: { kind: string; code: string; name: string };
  deltaPercent?: number;
  deltaPeople: number;
  source: { mode: string; prefCodes?: string[] };
  targetBefore: number;
  targetAfter: number;
  top: Array<Who & { before: number; after: number }>;
  flippedFacilityCount: number;
  essentialFlippedCount: number;
  omittedFlipCount: number;
  essentialFlips: Flip[];
  facilityFlips: Flip[];
}
interface SimilarOut {
  area: Who;
  year: number;
  requestedYear?: number;
  scenario: Scn;
  population: number;
  similar: Array<Who & { pop2020: number }>;
}
interface CountOut {
  year: number;
  requestedYear?: number;
  scenario: Scn;
  below?: number;
  above?: number;
  prefCode?: string;
  count: number;
  total: number;
  examples: Array<Who & { population: number }>;
}
interface ResultMap {
  find_area: FindAreaOut;
  get_series: SeriesOut;
  compare_sources: CompareOut;
  run_projection: ProjectionOut;
  facility_check: FacilityOut;
  run_allocation: AllocOut;
  find_similar_now: SimilarOut;
  count_areas: CountOut;
}
type Failed = Partial<ToolError>;

/** Run a tool. Known names give the typed result (an error object has the same fields unset); other names give the error fields. */
function call<N extends keyof ResultMap>(name: N, input: unknown, c?: EngineContext): ResultMap[N] & Failed;
function call(name: string, input: unknown, c?: EngineContext): Failed & Record<string, unknown>;
function call(name: string, input: unknown, c: EngineContext = ctx): unknown {
  return runTool(name, input, c);
}
const jsonSize = (x: unknown): number => JSON.stringify(x).length;

const TANABE = '30206';
const KOYA = '30344';
const KITAYAMA_VILLAGE = '30427'; // one of the 13 villages without assumptions
const MINATO_WARD = '13103';

describe('tool definitions (data module and shared names)', () => {
  it('schemas: there are 8 uniquely named tools, each description < 400 chars and each schema JSON < 2000 chars', () => {
    expect(TOOL_DEFS).toHaveLength(8);
    expect(new Set(TOOL_DEFS.map((t) => t.name)).size).toBe(8);
    for (const t of TOOL_DEFS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.description.length).toBeLessThan(400);
      expect(JSON.stringify(t.input_schema).length).toBeLessThan(2000);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.additionalProperties).toBe(false);
      for (const key of t.input_schema.required ?? []) expect(Object.keys(t.input_schema.properties)).toContain(key);
    }
  });

  it('names: TOOL_NAMES lists exactly the defined tools and toolNames.ts re-exports the same list', () => {
    expect([...TOOL_NAMES]).toEqual(TOOL_DEFS.map((t) => t.name));
    expect([...SHARED_NAMES]).toEqual([...TOOL_NAMES]);
    expect([...TOOL_NAMES].sort()).toEqual(
      ['compare_sources', 'count_areas', 'facility_check', 'find_area', 'find_similar_now', 'get_series', 'run_allocation', 'run_projection'],
    );
  });

  it('every defined tool has an implementation branch, and an unlisted name does not', () => {
    for (const name of TOOL_NAMES) {
      const r = call(name, {});
      expect(r.error, `${name} must not be reported unknown`).not.toBe('unknown_tool');
    }
    expect(call('no_such_tool', {}).error).toBe('unknown_tool');
    // Names that exist on every object must not dispatch through the prototype chain.
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      expect(call(name, {}).error).toBe('unknown_tool');
    }
    expect(call(undefined as unknown as string, {}).error).toBe('unknown_tool');
  });

  it('data_only: toolDefs.ts imports nothing (the worker imports it)', () => {
    const src = readFileSync(fileURLToPath(new URL('./toolDefs.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/from\s+['"]/);
  });
});

describe('find_area', () => {
  it('find_area_tanabe: "田辺" finds 田辺市 (30206), first, ahead of the substring match 京田辺市', () => {
    const r = call('find_area', { query: '田辺' });
    const codes = r.matches.map((m) => m.code);
    expect(codes).toContain(TANABE);
    expect(codes[0]).toBe(TANABE);
    expect(r.matches[0]).toEqual({ code: TANABE, name: '田辺市', prefName: '和歌山県', kind: 'city' });
    const kyotanabe = r.matches.find((m) => m.name === '京田辺市');
    expect(kyotanabe).toBeDefined();
    expect(codes.indexOf(kyotanabe!.code)).toBeGreaterThan(0);
  });

  it('exact names come first and duplicated names are told apart by prefecture', () => {
    const r = call('find_area', { query: '池田町' });
    expect(r.matches.length).toBeGreaterThanOrEqual(4);
    expect(r.matches.every((m) => m.name === '池田町')).toBe(true);
    expect(new Set(r.matches.map((m) => m.prefName)).size).toBe(r.matches.length);
    const mix = call('find_area', { query: '府中' });
    expect(mix.matches.map((m) => m.name)).toEqual(expect.arrayContaining(['府中市']));
  });

  it('spaces (ASCII and full-width) in the query are ignored', () => {
    expect(call('find_area', { query: '田辺 市' }).matches[0].code).toBe(TANABE);
    expect(call('find_area', { query: '　田辺　市　' }).matches[0].code).toBe(TANABE);
  });

  it('returns at most 8 matches', () => {
    expect(call('find_area', { query: '町' }).matches).toHaveLength(8);
  });

  it('prefectures: the prefecture name, and its name without 都道府県, return the prefecture first', () => {
    expect(call('find_area', { query: '東京都' }).matches[0]).toEqual({ code: '13', name: '東京都', kind: 'prefecture' });
    expect(call('find_area', { query: '和歌山' }).matches[0]).toEqual({ code: '30', name: '和歌山県', kind: 'prefecture' });
    expect(call('find_area', { query: '京都' }).matches[0]).toEqual({ code: '26', name: '京都府', kind: 'prefecture' });
    expect(call('find_area', { query: '北海道' }).matches[0]).toEqual({ code: '01', name: '北海道', kind: 'prefecture' });
  });

  it('Japan: "日本" and "全国" give code "00"', () => {
    for (const q of ['日本', '全国', '日本全国']) {
      expect(call('find_area', { query: q }).matches[0]).toEqual({ code: '00', name: '日本', kind: 'japan' });
    }
  });

  it('designated cities (groups.cities) are findable as one place, ahead of their wards', () => {
    const r = call('find_area', { query: '札幌市' });
    expect(r.matches[0]).toEqual({ code: '01100', name: '札幌市', prefName: '北海道', kind: 'designated_city' });
    expect(r.matches[1].name).toMatch(/^札幌市/);
  });

  it('no match is an empty list, not an error; a blank or non-string query is invalid_input', () => {
    expect(call('find_area', { query: 'ありえない名前ぞ' })).toEqual({ matches: [] });
    for (const bad of ['', '   ', 5, null, undefined, {}, ['田辺']]) {
      expect(call('find_area', { query: bad }).error).toBe('invalid_input');
    }
  });
});

describe('years', () => {
  it('year_out_of_range: 2150 and 2019 are rejected by every tool that takes a year', () => {
    for (const y of [2150, 2019, 1900, 2101, -5]) {
      expect(call('get_series', { areaCode: TANABE, years: [y] }).error, `get_series ${y}`).toBe('year_out_of_range');
      expect(call('get_series', { areaCode: TANABE, years: [2040, y] }).error).toBe('year_out_of_range');
      expect(call('facility_check', { areaCode: TANABE, year: y }).error).toBe('year_out_of_range');
      expect(call('find_similar_now', { areaCode: TANABE, year: y }).error).toBe('year_out_of_range');
      expect(call('count_areas', { year: y, below: 3000 }).error).toBe('year_out_of_range');
      expect(
        call('run_allocation', { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: y }).error,
      ).toBe('year_out_of_range');
    }
  });

  it('a year in range but not a multiple of 5 is snapped down and the result says which year was used', () => {
    const r = call('get_series', { areaCode: TANABE, years: [2043, 2040, 2100] });
    expect(r.rows.map((x) => x.year)).toEqual([2040, 2100]); // 2043 and 2040 both mean 2040
    expect(r.rows[0].requestedYear).toBe(2043);
    const f = call('facility_check', { areaCode: TANABE, year: 2099 });
    expect(f.year).toBe(2095);
    expect(f.requestedYear).toBe(2099);
    expect(call('facility_check', { areaCode: TANABE, year: 2095 }).requestedYear).toBeUndefined();
  });

  it('years may come in any order: rows are sorted by year', () => {
    const r = call('get_series', { areaCode: TANABE, years: [2100, 2020, 2075, 2050] });
    expect(r.rows.map((x) => x.year)).toEqual([2020, 2050, 2075, 2100]);
    const reversed = call('get_series', { areaCode: TANABE, years: [2100, 2090, 2080, 2070] });
    expect(reversed.rows.map((x) => x.year)).toEqual([2070, 2080, 2090, 2100]);
  });

  it('MAX_YEARS: the schema maxItems is the constant the code enforces, and one more year is rejected', () => {
    const years = TOOL_DEFS.find((t) => t.name === 'get_series')!.input_schema.properties.years as { maxItems: number };
    expect(years.maxItems).toBe(MAX_YEARS);
    expect(MAX_YEARS).toBe(17); // every 5-year step from 2020 to 2100
    const all = Array.from({ length: MAX_YEARS }, (_, i) => 2020 + 5 * i);
    const full = call('get_series', { areaCode: TANABE, years: all });
    expect(full.error).toBeUndefined();
    expect(full.rows).toHaveLength(MAX_YEARS);
    expect(call('get_series', { areaCode: TANABE, years: [...all, 2100] }).error).toBe('invalid_input');
  });

  it('non-numeric years are invalid_input', () => {
    expect(call('facility_check', { areaCode: TANABE, year: '2050' }).error).toBe('invalid_input');
    expect(call('facility_check', { areaCode: TANABE, year: NaN }).error).toBe('invalid_input');
    expect(call('get_series', { areaCode: TANABE, years: '2050' }).error).toBe('invalid_input');
    expect(call('get_series', { areaCode: TANABE, years: [null] }).error).toBe('invalid_input');
  });
});

describe('get_series', () => {
  it('tokyo_2040: the default row for Tokyo ("13") in 2040 is about 14.5 million (official 14,507,419, within 1%)', () => {
    const r = call('get_series', { areaCode: '13' });
    expect(r.area).toEqual({ code: '13', name: '東京都' });
    expect(r.rows.map((x) => x.year)).toEqual([2020, 2030, 2040, 2050, 2060, 2075, 2100]);
    const row2040 = r.rows.find((x) => x.year === 2040)!;
    expect(Math.abs(row2040.population - 14_507_419) / 14_507_419).toBeLessThan(0.01);
    expect(Number.isInteger(row2040.population)).toBe(true);
    expect(row2040.ages65Share).toBe(27.3);
    expect(r.scenario).toEqual(DEFAULT_SCENARIO);
  });

  it('basis: official up to 2050, app_estimate after (any scenario)', () => {
    for (const scenario of [undefined, { migMode: 'fade', cwrMult: 1.2 }]) {
      const r = call('get_series', { areaCode: TANABE, scenario });
      for (const row of r.rows) expect(row.basis).toBe(row.year <= 2050 ? 'official' : 'app_estimate');
    }
  });

  it('every scenario shares the official numbers to 2050 and differs after', () => {
    const base = call('get_series', { areaCode: '13' });
    const fade = call('get_series', { areaCode: '13', scenario: { migMode: 'fade' } });
    for (const y of [2020, 2030, 2040, 2050]) {
      expect(fade.rows.find((x) => x.year === y)!.population).toBe(base.rows.find((x) => x.year === y)!.population);
    }
    expect(fade.rows.find((x) => x.year === 2100)!.population).toBeLessThan(base.rows.find((x) => x.year === 2100)!.population);
    expect(fade.scenario).toEqual({ ...DEFAULT_SCENARIO, migMode: 'fade' });
  });

  it('Japan ("00") reproduces the engine results: 2100 hold 6,328万 and fade 5,851万 (Ruling 19)', () => {
    const hold = call('get_series', { areaCode: '00', years: [2020, 2100] });
    expect(hold.area).toEqual({ code: '00', name: '日本' });
    expect(Math.abs(hold.rows[1].population - 63_280_000) / 63_280_000).toBeLessThan(0.005);
    const fade = call('get_series', { areaCode: '00', years: [2100], scenario: { migMode: 'fade' } });
    expect(Math.abs(fade.rows[0].population - 58_510_000) / 58_510_000).toBeLessThan(0.005);
    const cwr = call('get_series', { areaCode: '00', years: [2100], scenario: { cwrMult: 1.2 } });
    expect(Math.abs(cwr.rows[0].population - 70_930_000) / 70_930_000).toBeLessThan(0.005);
    expect(hold.rows[0].population).toBe(Math.round(ctx.areas.reduce((s, a) => s + total(a.base), 0)));
  });

  it('an area, a village without assumptions and a designated city all work; area names carry the prefecture', () => {
    const t = call('get_series', { areaCode: TANABE, years: [2050] });
    expect(t.area).toEqual({ code: TANABE, name: '田辺市', prefName: '和歌山県' });
    expect(Math.abs(t.rows[0].population - 42_311)).toBeLessThanOrEqual(5);
    const v = call('get_series', { areaCode: KITAYAMA_VILLAGE, years: [2020, 2050, 2100] });
    expect(v.rows.map((x) => x.population)).toEqual([404, 181, 75]);
    const sapporo = call('get_series', { areaCode: '01100', years: [2020] });
    expect(sapporo.area).toEqual({ code: '01100', name: '札幌市', prefName: '北海道' });
    expect(sapporo.rows[0].population).toBeGreaterThan(1_900_000);
  });

  it('percentages have one decimal, people are integers', () => {
    const r = call('get_series', { areaCode: TANABE });
    for (const row of r.rows) {
      expect(Number.isInteger(row.population)).toBe(true);
      expect(Number.isInteger(row.ages65)).toBe(true);
      expect(Math.round(row.ages65Share * 10)).toBeCloseTo(row.ages65Share * 10, 9);
      expect(row.ages65Share).toBeGreaterThan(0);
      expect(row.ages65Share).toBeLessThan(100);
      expect(Math.round(row.changeFrom2020Percent * 10)).toBeCloseTo(row.changeFrom2020Percent * 10, 9);
    }
    // 69,870 in 2020 and 11,880 in 2100: down 83.0%
    expect(r.rows[0].changeFrom2020Percent).toBe(0);
    expect(r.rows[r.rows.length - 1].changeFrom2020Percent).toBe(-83);
  });

  it('an unknown or malformed area code is unknown_area / invalid_input', () => {
    expect(call('get_series', { areaCode: '99999' }).error).toBe('unknown_area');
    expect(call('get_series', { areaCode: '48' }).error).toBe('unknown_area');
    expect(call('get_series', { areaCode: '田辺市' }).error).toBe('unknown_area');
    expect(call('get_series', { areaCode: 30206 }).error).toBe('invalid_input');
    expect(call('get_series', {}).error).toBe('invalid_input');
  });
});

describe('compare_sources', () => {
  it('tanabe: the official 2025..2050 totals sit next to this app, maxRelativeDifference < 0.0005', () => {
    const r = call('compare_sources', { areaCode: TANABE });
    expect(r.area).toEqual({ code: TANABE, name: '田辺市', prefName: '和歌山県' });
    expect(r.official.map((x) => x.year)).toEqual([2025, 2030, 2035, 2040, 2045, 2050]);
    const y2050 = r.official.find((x) => x.year === 2050)!;
    expect(y2050.official).toBe(42_309);
    expect(Math.abs(y2050.app - 42_311)).toBeLessThanOrEqual(5);
    expect(r.maxRelativeDifference).toBeLessThan(0.0005);
    expect(r.maxRelativeDifference).toBeGreaterThanOrEqual(0);
    expect(r.maxRelativeDifferencePercent).toBeCloseTo(r.maxRelativeDifference * 100, 2);
    expect(r.appEstimate.map((x) => x.year)).toEqual([2060, 2065, 2070, 2075, 2080, 2085, 2090, 2095, 2100]);
    expect(r.appEstimate.every((x) => x.basis === 'app_estimate' && Number.isInteger(x.population))).toBe(true);
    expect(r.note).toMatch(/2050/);
    expect(r.scenario).toEqual(DEFAULT_SCENARIO);
  });

  it('prefectures and Japan sum the official totals; a village (official ages only) is close too', () => {
    const tokyo = call('compare_sources', { areaCode: '13' });
    const official2040 = ctx.groups.prefs['13'].reduce((s, c) => s + ctx.areas.find((a) => a.code === c)!.official[2040], 0);
    expect(tokyo.official.find((x) => x.year === 2040)!.official).toBe(official2040);
    expect(tokyo.maxRelativeDifference).toBeLessThan(0.001);
    const japan = call('compare_sources', { areaCode: '00' });
    expect(japan.official.find((x) => x.year === 2050)!.official).toBe(
      ctx.areas.reduce((s, a) => s + a.official[2050], 0),
    );
    expect(japan.maxRelativeDifference).toBeLessThan(0.0005);
    const village = call('compare_sources', { areaCode: KITAYAMA_VILLAGE });
    expect(village.maxRelativeDifference).toBeLessThan(0.0005);
  });

  it('the differences do not collapse to 0: Japan differs by a few people, and the figures show it', () => {
    const run = ctx.run(DEFAULT_SCENARIO);
    const japan = call('compare_sources', { areaCode: '00' });
    let relative = 0;
    let absolute = 0;
    for (const row of japan.official) {
      const official = ctx.areas.reduce((t, a) => t + a.official[row.year], 0);
      const app = ctx.areas.reduce((t, a) => t + total(run.get(a.code)![row.year]), 0);
      relative = Math.max(relative, Math.abs(app - official) / official);
      absolute = Math.max(absolute, Math.abs(Math.round(app) - official));
      expect(row.difference).toBe(Math.round(app) - official);
    }
    expect(relative).toBeGreaterThan(0);
    expect(japan.maxRelativeDifference).toBeGreaterThan(0);
    expect(Math.abs(japan.maxRelativeDifference - relative) / relative).toBeLessThan(0.05); // two significant digits
    expect(japan.maxRelativeDifferencePercent).toBeGreaterThan(0);
    expect(Math.abs(japan.maxRelativeDifferencePercent - 100 * relative) / (100 * relative)).toBeLessThan(0.05);
    expect(japan.maxAbsoluteDifference).toBe(absolute);
    expect(absolute).toBeGreaterThan(0);
    // 田辺市: 59,954 against the official 59,951 in 2030 and 46,550 against 46,553 in 2045: at most 3 people
    expect(call('compare_sources', { areaCode: TANABE }).maxAbsoluteDifference).toBe(3);
  });

  it('the note says the 2025-2050 reproduction differs from the published values by a few people, and that official figures end in 2050', () => {
    const { note } = call('compare_sources', { areaCode: TANABE });
    expect(note).toMatch(/2050/);
    expect(note).toMatch(/数人/);
    expect(note).toMatch(/社人研/);
  });

  it('an optional scenario changes only the app-estimate years', () => {
    const base = call('compare_sources', { areaCode: TANABE });
    const fade = call('compare_sources', { areaCode: TANABE, scenario: { migMode: 'fade' } });
    expect(fade.official).toEqual(base.official);
    // Out-migration fades away, so a shrinking rural city keeps more people than under the default.
    expect(fade.appEstimate[fade.appEstimate.length - 1].population).toBeGreaterThan(
      base.appEstimate[base.appEstimate.length - 1].population,
    );
    expect(fade.scenario.migMode).toBe('fade');
  });
});

describe('run_projection', () => {
  it('fade vs default: 2050 is the same; a rural city keeps more people under fade (less out-migration)', () => {
    const r = call('run_projection', { areaCode: TANABE, scenario: { migMode: 'fade' } });
    expect(r.rows.map((x) => x.year)).toEqual([2050, 2075, 2100]);
    expect(r.rows[0].difference).toBe(0);
    for (const row of r.rows) {
      expect(row.difference).toBe(row.scenarioPopulation - row.defaultPopulation);
      expect(row.basis).toBe(row.year <= 2050 ? 'official' : 'app_estimate');
    }
    expect(r.rows[1].difference).toBeGreaterThan(0);
    expect(r.rows[2].difference).toBeGreaterThan(r.rows[1].difference);
    expect(r.rows[2].differencePercent).toBeGreaterThan(0);
    expect(r.rows[2].differencePercent).toBe(Math.round((1000 * r.rows[2].difference) / r.rows[2].defaultPopulation) / 10);
    expect(r.scenario).toEqual({ ...DEFAULT_SCENARIO, migMode: 'fade' });
    const def = call('get_series', { areaCode: TANABE, years: [2075, 2100] });
    expect(r.rows[1].defaultPopulation).toBe(def.rows[0].population);
    expect(r.rows[2].defaultPopulation).toBe(def.rows[1].population);
  });

  it('a lower child-woman ratio lowers the 2100 population (negative differences)', () => {
    const r = call('run_projection', { areaCode: TANABE, scenario: { cwrMult: 0.8 } });
    expect(r.rows[0].difference).toBe(0);
    expect(r.rows[1].difference).toBeLessThan(0);
    expect(r.rows[2].difference).toBeLessThan(r.rows[1].difference);
    expect(r.rows[2].differencePercent).toBeLessThan(0);
  });

  it('Japan under fade is about 5,851万 in 2100 and a raised child-woman ratio is higher than the default', () => {
    const fade = call('run_projection', { areaCode: '00', scenario: { migMode: 'fade' } });
    expect(Math.abs(fade.rows[2].scenarioPopulation - 58_510_000) / 58_510_000).toBeLessThan(0.005);
    const cwr = call('run_projection', { areaCode: '00', scenario: { cwrMult: 1.2 } });
    expect(cwr.rows[2].difference).toBeGreaterThan(0);
  });

  it('an empty scenario object is the default scenario (all differences 0); a missing scenario is invalid_input', () => {
    const same = call('run_projection', { areaCode: TANABE, scenario: {} });
    expect(same.rows.every((x) => x.difference === 0)).toBe(true);
    expect(call('run_projection', { areaCode: TANABE }).error).toBe('invalid_input');
  });

  it('the infrastructure feedback needs facilities from ctx.run: with infraStrength > 0 a small town shrinks faster', () => {
    const r = call('run_projection', { areaCode: KOYA, scenario: { infraStrength: 0.005 } });
    expect(r.error).toBeUndefined();
    expect(r.rows[0].difference).toBe(0);
    expect(r.rows[2].difference).toBeLessThan(0);
  });
});

describe('scenario validation (Ruling 21)', () => {
  const bad: Array<[string, unknown]> = [
    ['cwrMult too high', { cwrMult: 1.5 }],
    ['cwrMult too low', { cwrMult: 0.5 }],
    ['cwrMult NaN', { cwrMult: NaN }],
    ['cwrMult Infinity', { cwrMult: Infinity }],
    ['cwrMult a string', { cwrMult: '1.2' }],
    ['migScale negative', { migScale: -0.1 }],
    ['migScale too high', { migScale: 1.6 }],
    ['migScale NaN', { migScale: NaN }],
    ['infraStrength too high', { infraStrength: 0.011 }],
    ['infraStrength negative', { infraStrength: -0.001 }],
    ['infraStrength NaN', { infraStrength: NaN }],
    ['migMode unknown', { migMode: 'rise' }],
    ['migMode a number', { migMode: 1 }],
  ];

  it('out-of-range values are rejected, never clamped, and the engine is not called', () => {
    for (const [label, scenario] of bad) {
      for (const [tool, input] of [
        ['get_series', { areaCode: TANABE, scenario }],
        ['run_projection', { areaCode: TANABE, scenario }],
        ['compare_sources', { areaCode: TANABE, scenario }],
        ['facility_check', { areaCode: TANABE, year: 2100, scenario }],
        ['find_similar_now', { areaCode: TANABE, year: 2100, scenario }],
        ['count_areas', { year: 2100, below: 3000, scenario }],
        ['run_allocation', { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario }],
      ] as Array<[string, unknown]>) {
        const r = call(tool, input);
        expect(r.error, `${tool}: ${label}`).toBe('scenario_out_of_range');
        expect(typeof r.message).toBe('string');
      }
    }
  });

  it('the limits themselves are accepted', () => {
    for (const scenario of [
      { cwrMult: 0.6 }, { cwrMult: 1.4 }, { migScale: 0 }, { migScale: 1.5 }, { infraStrength: 0 }, { infraStrength: 0.01 },
      { migMode: 'hold' }, { migMode: 'fade' },
    ]) {
      expect(call('get_series', { areaCode: TANABE, years: [2100], scenario }).error).toBeUndefined();
    }
  });

  it('a scenario that is not an object, or has unknown keys, is invalid_input', () => {
    for (const scenario of ['fade', 5, [], true]) {
      expect(call('get_series', { areaCode: TANABE, scenario }).error).toBe('invalid_input');
    }
    expect(call('get_series', { areaCode: TANABE, scenario: { migrationMode: 'fade' } }).error).toBe('invalid_input');
    // null / undefined mean "no scenario given"
    expect(call('get_series', { areaCode: TANABE, scenario: null }).error).toBeUndefined();
  });

  it('ctx.run only ever receives clean, complete scenarios', () => {
    const seen: Scenario[] = [];
    const spy: EngineContext = {
      ...ctx,
      run: (s) => {
        seen.push(s);
        return ctx.run(s);
      },
    };
    call('get_series', { areaCode: TANABE, scenario: { migMode: 'fade', cwrMult: 1.1 } }, spy);
    call('run_projection', { areaCode: TANABE, scenario: { migScale: 0.5 } }, spy);
    call('get_series', { areaCode: TANABE, scenario: { cwrMult: 9 } }, spy);
    call('count_areas', { year: 2100, below: 100, scenario: { migScale: 'x' } }, spy);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(Object.keys(s).sort()).toEqual(['cwrMult', 'infraStrength', 'migMode', 'migScale']);
      expect(s.cwrMult).toBeGreaterThanOrEqual(0.6);
      expect(s.cwrMult).toBeLessThanOrEqual(1.4);
      expect(Number.isFinite(s.migScale) && Number.isFinite(s.infraStrength)).toBe(true);
    }
  });
});

describe('use of ctx.run', () => {
  it('each tool call projects once (run_projection twice: the scenario and the default); find_area never', () => {
    const counts: Record<string, number> = {};
    let current = '';
    const spy: EngineContext = {
      ...ctx,
      run: (s) => {
        counts[current] = (counts[current] ?? 0) + 1;
        return ctx.run(s);
      },
    };
    const sc = { migMode: 'fade' };
    const calls: Array<[string, unknown]> = [
      ['find_area', { query: '田辺' }],
      ['get_series', { areaCode: '00', scenario: sc }],
      ['compare_sources', { areaCode: '13', scenario: sc }],
      ['run_projection', { areaCode: TANABE, scenario: sc }],
      ['facility_check', { areaCode: TANABE, year: 2050, scenario: sc }],
      ['run_allocation', { target: { kind: 'pref', code: '30' }, deltaPercent: 5, year: 2100, scenario: sc }],
      ['find_similar_now', { areaCode: TANABE, year: 2100, scenario: sc }],
      ['count_areas', { year: 2100, below: 3000, scenario: sc }],
    ];
    for (const [name, input] of calls) {
      current = name;
      expect(call(name, input, spy).error, name).toBeUndefined();
    }
    expect(counts).toEqual({
      get_series: 1, compare_sources: 1, run_projection: 2, facility_check: 1, run_allocation: 1, find_similar_now: 1, count_areas: 1,
    });
  });
});

describe('facility_check', () => {
  it('a small town: statuses follow the MLIT thresholds (高野町 2020: 2,970 people)', () => {
    const r = call('facility_check', { areaCode: KOYA, year: 2020 });
    expect(r.area).toEqual({ code: KOYA, name: '高野町', prefName: '和歌山県' });
    expect(r.year).toBe(2020);
    expect(r.population).toBe(2970);
    expect(r.outsideMlitScope).toBe(false);
    expect(r.facilities).toHaveLength(48);
    const by = Object.fromEntries(r.facilities.map((f) => [f.id, f]));
    expect(by.grocery).toMatchObject({ status: 'ok', essential: true, name: '飲食料品小売業', p50: 500, p80: 500 });
    expect(by.cafe.status).toBe('edge'); // 2,500 <= 2,970 < 7,500
    expect(by.bank.status).toBe('below'); // 6,500
    expect(by.university.status).toBe('below');
    expect(r.counts).toEqual({ ok: 7, edge: 3, below: 38 });
  });

  it('2100: 高野町 (about 471 people) is below every threshold, including the eight 500-person ones', () => {
    const r = call('facility_check', { areaCode: KOYA, year: 2100 });
    expect(r.population).toBe(471);
    expect(r.counts).toEqual({ ok: 0, edge: 0, below: 48 });
    expect(r.facilities.find((f) => f.id === 'grocery')!.status).toBe('below');
  });

  it('matches the engine status for every facility of a mid-sized city', () => {
    const r = call('facility_check', { areaCode: TANABE, year: 2050, scenario: { migMode: 'fade' } });
    const pop = total(ctx.run({ ...DEFAULT_SCENARIO, migMode: 'fade' }).get(TANABE)![2050]);
    for (const row of r.facilities) {
      const f = ctx.facilities.find((x) => x.id === row.id)!;
      expect(row.status).toBe(facilityStatus(pop, f));
    }
  });

  it('onlyEssential lists only the essential facilities; counts describe the listed rows', () => {
    const r = call('facility_check', { areaCode: TANABE, year: 2100, onlyEssential: true });
    const essential = ctx.facilities.filter((f) => f.essential);
    expect(r.facilities).toHaveLength(essential.length);
    expect(r.facilities.every((f) => f.essential === true)).toBe(true);
    expect(r.counts.ok + r.counts.edge + r.counts.below).toBe(essential.length);
    expect(call('facility_check', { areaCode: TANABE, year: 2100, onlyEssential: 'yes' }).error).toBe('invalid_input');
  });

  it('the result carries the facility total and what 50 and 80 percent mean, so the natural sentences check out', () => {
    const r = call('facility_check', { areaCode: TANABE, year: 2100 });
    expect(r.counts).toEqual({ ok: 13, edge: 6, below: 29 });
    expect(r.facilityTotal).toBe(48);
    expect(r.facilityCount).toBe(48);
    expect(r.thresholds).toEqual({ edgePercent: 50, okPercent: 80 });
    for (const sentence of [
      '48種類の施設のうち29種類が目安を下回ります。',
      '50%の目安以上80%未満は「境界」、80%の目安以上は「目安以上」です。',
      '13種類は80%の目安以上、6種類は境界です。',
    ]) {
      expect(checkNumbers(sentence, [r]).unverified, sentence).toEqual([]);
    }
    // a wrong count is still caught
    expect(checkNumbers('48種類の施設のうち31種類が目安を下回ります。', [r]).unverified).toEqual(['31']);
    // JSON text of the result works the same
    expect(checkNumbers('48種類のうち29種類', [JSON.stringify(r)]).unverified).toEqual([]);
  });

  it('with onlyEssential the count is the listed rows and the total stays the full 48', () => {
    const r = call('facility_check', { areaCode: TANABE, year: 2100, onlyEssential: true });
    expect(r.facilityCount).toBe(ctx.facilities.filter((f) => f.essential).length);
    expect(r.facilityTotal).toBe(48);
    expect(r.facilityCount).toBe(r.counts.ok + r.counts.edge + r.counts.below);
    expect(checkNumbers('48種類の施設のうち、生活に必須の8種類を見ると', [r]).unverified).toEqual([]);
  });

  it('50 and 80 appear in the result only in the explicit thresholds field (no other number is diluted)', () => {
    const paths: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (typeof node === 'number') {
        if (node === 50 || node === 80) paths.push(path);
      } else if (Array.isArray(node)) {
        node.forEach((x, i) => walk(x, `${path}[${i}]`));
      } else if (typeof node === 'object' && node !== null) {
        for (const [k, v] of Object.entries(node)) walk(v, path === '' ? k : `${path}.${k}`);
      }
    };
    for (const input of [{ areaCode: TANABE, year: 2100 }, { areaCode: KOYA, year: 2020, onlyEssential: true }]) {
      paths.length = 0;
      walk(call('facility_check', input), '');
      expect(paths.sort()).toEqual(['thresholds.edgePercent', 'thresholds.okPercent']);
    }
  });

  it('outsideMlitScope for every prefecture: exactly Saitama, Chiba, Tokyo, Kanagawa, Gifu, Aichi, Mie, Kyoto, Osaka, Hyogo and Nara', () => {
    const metro = new Set(['11', '12', '13', '14', '21', '23', '24', '26', '27', '28', '29']);
    const prefs = [...new Set(ctx.areas.map((a) => a.prefCode))];
    expect(prefs).toHaveLength(47);
    for (const pref of prefs) {
      const first = ctx.areas.find((a) => a.prefCode === pref)!;
      expect(call('facility_check', { areaCode: first.code, year: 2050 }).outsideMlitScope, `${pref} ${first.name}`).toBe(metro.has(pref));
    }
    expect(call('facility_check', { areaCode: '29201', year: 2050 }).outsideMlitScope).toBe(true); // 奈良市
    expect(call('facility_check', { areaCode: '29201', year: 2050 }).note).toMatch(/三大都市圏/);
  });

  it('outsideMlitScope: Tokyo wards and other three-metropolitan prefectures are flagged, others are not', () => {
    const minato = call('facility_check', { areaCode: MINATO_WARD, year: 2050 });
    expect(minato.outsideMlitScope).toBe(true);
    expect(typeof minato.note).toBe('string');
    expect(call('facility_check', { areaCode: '27127', year: 2050 }).outsideMlitScope).toBe(true); // 大阪市淀川区
    expect(call('facility_check', { areaCode: '11201', year: 2050 }).outsideMlitScope).toBe(true); // 川越市, Saitama (11)
    for (const code of ['01202', '30201', '40101']) {
      expect(call('facility_check', { areaCode: code, year: 2050 }).outsideMlitScope, code).toBe(false);
    }
  });

  it('only a single 5-digit area is accepted: prefectures, Japan and designated cities are invalid_input', () => {
    for (const code of ['30', '00', '01100']) {
      expect(call('facility_check', { areaCode: code, year: 2050 }).error, code).toBe('invalid_input');
    }
    expect(call('facility_check', { areaCode: '99999', year: 2050 }).error).toBe('unknown_area');
    expect(call('facility_check', { areaCode: TANABE }).error).toBe('invalid_input');
  });

  it('the full 48-facility result stays compact (< 6 KB of JSON)', () => {
    expect(jsonSize(call('facility_check', { areaCode: TANABE, year: 2050 }))).toBeLessThan(6000);
  });
});

describe('run_allocation', () => {
  const wakayama10 = { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 };

  it('wakayama +10% in 2100 reproduces the engine example: 高野町 gains the eight 500-person facilities', () => {
    const r = call('run_allocation', wakayama10);
    expect(r.error).toBeUndefined();
    expect(r.year).toBe(2100);
    expect(r.target).toEqual({ kind: 'pref', code: '30', name: '和歌山県' });
    expect(r.targetAfter - r.targetBefore).toBe(r.deltaPeople);
    expect(Math.abs(r.deltaPeople / r.targetBefore - 0.1)).toBeLessThan(1e-4);
    expect(Math.abs(r.targetBefore - 261_987)).toBeLessThan(100);

    const allFlips = [...r.essentialFlips, ...r.facilityFlips];
    const koyaGains = allFlips.filter((f) => f.gainedExamples.includes('高野町')).map((f) => f.facilityId).sort();
    const p500 = ctx.facilities.filter((f) => f.p50 === 500).map((f) => f.id).sort();
    expect(p500).toHaveLength(8);
    expect(koyaGains).toEqual(p500);
    expect(p500).toEqual(
      ['bar', 'clinic', 'dental_clinic', 'grocery', 'hotel', 'nursing_home', 'post_office', 'restaurant'],
    );
    const grocery = r.essentialFlips.find((f) => f.facilityId === 'grocery')!;
    expect(grocery).toMatchObject({ name: '飲食料品小売業', essential: true, gainedCount: 1, lostCount: 0, lostExamples: [] });
    expect(grocery.after).toBe(grocery.before + 1);
    expect(r.facilityFlips.find((f) => f.facilityId === 'grocery')).toBeUndefined(); // listed once, not twice
  });

  it('the flip lists hold only facilities where some area changed, with consistent counts and short example lists', () => {
    const r = call('run_allocation', wakayama10);
    expect(r.facilityFlips.length).toBeGreaterThan(0);
    expect(r.facilityFlips.length).toBeLessThanOrEqual(10);
    expect(r.flippedFacilityCount).toBe(12);
    expect(r.essentialFlippedCount).toBe(r.essentialFlips.length);
    expect(r.omittedFlipCount).toBe(0);
    for (const f of [...r.essentialFlips, ...r.facilityFlips]) {
      expect(f.lostCount + f.gainedCount).toBeGreaterThan(0);
      expect(f.after - f.before).toBe(f.gainedCount - f.lostCount);
      expect(f.lostExamples.length).toBeLessThanOrEqual(3);
      expect(f.gainedExamples.length).toBeLessThanOrEqual(3);
      expect(f.lostExamples.length).toBe(Math.min(3, f.lostCount));
      expect(f.gainedExamples.length).toBe(Math.min(3, f.gainedCount));
    }
    // The cafe threshold (2,500) is crossed downwards by two areas of the rest of the country.
    expect(r.facilityFlips.find((f) => f.facilityId === 'cafe')).toMatchObject({ lostCount: 2, gainedCount: 0 });
  });

  it('top has exactly 10 entries when more areas change (a prefecture target, and a single area that moves every other area)', () => {
    expect(call('run_allocation', wakayama10).top).toHaveLength(10);
    expect(call('run_allocation', { target: { kind: 'area', code: TANABE }, deltaPercent: 20, year: 2100 }).top).toHaveLength(10);
  });

  it('essentialFlips lists ALL flipped essential facilities, even when the other flips are cut off (Osaka +100%, Tokyo -30%)', () => {
    const run = ctx.run(DEFAULT_SCENARIO);
    const prefOf = new Map(ctx.areas.map((a) => [a.code, a.prefCode]));
    for (const input of [
      { target: { kind: 'pref', code: '27' }, deltaPercent: 100, year: 2100 },
      { target: { kind: 'pref', code: '13' }, deltaPercent: -30, year: 2100 },
    ]) {
      const r = call('run_allocation', input);
      expect(r.error, JSON.stringify(input)).toBeUndefined();
      // independent oracle: the engine's own flips for the same move
      const pop = new Map(ctx.areas.map((a) => [a.code, total(run.get(a.code)![2100])]));
      const targetTotal = ctx.groups.prefs[input.target.code].reduce((t, c) => t + pop.get(c)!, 0);
      const flips = allocate(
        pop,
        prefOf,
        { target: { kind: 'pref', code: input.target.code }, deltaPeople: Math.round((targetTotal * input.deltaPercent) / 100), source: { mode: 'proportional' } },
        ctx.facilities,
      ).flips.filter((f) => f.lost.length + f.gained.length > 0);
      const essentialIds = new Set(ctx.facilities.filter((f) => f.essential).map((f) => f.id));
      const expectedEssential = flips.filter((f) => essentialIds.has(f.facilityId)).map((f) => f.facilityId).sort();
      expect(expectedEssential.length).toBeGreaterThan(0); // the situation the reviewer found
      expect(r.flippedFacilityCount).toBe(flips.length);
      expect(r.flippedFacilityCount).toBeGreaterThan(10); // more flips than the other list can show
      expect(r.essentialFlips.map((f) => f.facilityId).sort()).toEqual(expectedEssential);
      expect(r.essentialFlippedCount).toBe(expectedEssential.length);
      expect(r.essentialFlips.length).toBeLessThanOrEqual(8);
      expect(r.essentialFlips.every((f) => f.essential && f.lostCount + f.gainedCount > 0)).toBe(true);
      // facilityFlips holds the rest only, capped, and the count of what is left out is exact
      expect(r.facilityFlips.every((f) => !f.essential)).toBe(true);
      expect(r.facilityFlips.length).toBeLessThanOrEqual(10);
      expect(r.essentialFlips.length + r.facilityFlips.length + r.omittedFlipCount).toBe(r.flippedFacilityCount);
      expect(r.omittedFlipCount).toBeGreaterThan(0);
      const counts = r.facilityFlips.map((f) => f.lostCount + f.gainedCount);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      expect(jsonSize(r), JSON.stringify(input)).toBeLessThan(6000);
    }
  });

  it('with nothing essential flipping, essentialFlips is empty and the counts say so', () => {
    const r = call('run_allocation', { target: { kind: 'area', code: TANABE }, deltaPercent: 20, year: 2100 });
    expect(r.essentialFlips).toEqual([]);
    expect(r.essentialFlippedCount).toBe(0);
    expect(r.flippedFacilityCount).toBe(0);
    expect(r.omittedFlipCount).toBe(0);
  });

  it('top: up to 10 most-changed areas, biggest absolute change first; targets rise, the rest barely move', () => {
    const r = call('run_allocation', wakayama10);
    expect(r.top.length).toBeLessThanOrEqual(10);
    expect(r.top.length).toBeGreaterThan(0);
    const changes = r.top.map((a) => Math.abs(a.after - a.before));
    expect([...changes].sort((a, b) => b - a)).toEqual(changes);
    for (const a of r.top) {
      expect(Object.keys(a).sort()).toEqual(['after', 'before', 'code', 'name', 'prefName']);
      expect(Number.isInteger(a.before) && Number.isInteger(a.after)).toBe(true);
    }
    expect(r.top[0].after).toBeGreaterThan(r.top[0].before);
  });

  it('deltaPeople: the same people give the same result as the percentage', () => {
    const pct = call('run_allocation', wakayama10);
    const ppl = call('run_allocation', { target: wakayama10.target, deltaPeople: pct.deltaPeople, year: 2100 });
    expect(ppl.targetAfter).toBe(pct.targetAfter);
    expect(ppl.facilityFlips).toEqual(pct.facilityFlips);
    expect(ppl.essentialFlips).toEqual(pct.essentialFlips);
    const area = call('run_allocation', { target: { kind: 'area', code: KOYA }, deltaPercent: 20, year: 2100 });
    expect(area.target).toEqual({ kind: 'area', code: KOYA, name: '高野町' });
    expect(area.targetBefore).toBe(471);
    expect(area.targetAfter).toBe(565);
    expect(area.deltaPeople).toBe(94);
    expect(area.essentialFlips.find((f) => f.facilityId === 'grocery')!.gainedExamples).toEqual(['高野町']);
  });

  it('exactly one of deltaPercent / deltaPeople, both finite', () => {
    const t = { kind: 'pref', code: '30' };
    expect(call('run_allocation', { target: t, year: 2100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: t, year: 2100, deltaPercent: 5, deltaPeople: 100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: t, year: 2100, deltaPercent: NaN }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: t, year: 2100, deltaPeople: '100' }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: t, year: 2100, deltaPeople: Infinity }).error).toBe('invalid_input');
  });

  it('source modes: regions takes people only from the listed prefectures; bad combinations are rejected', () => {
    const r = call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: ['27'], deltaPercent: 5 });
    expect(r.error).toBeUndefined();
    // Osaka (27) pays: its areas appear with falling populations and nobody outside 30/27 appears in the top list.
    const osaka = ctx.areas.filter((a) => a.prefCode === '27').map((a) => a.code);
    const wak = ctx.groups.prefs['30'];
    for (const a of r.top) expect([...osaka, ...wak]).toContain(a.code);
    // prefCodes alone implies regions mode.
    const implied = call('run_allocation', { ...wakayama10, prefCodes: ['27'], deltaPercent: 5 });
    expect(implied.top).toEqual(r.top);
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'regions' }).error).toBe('invalid_input');
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: [] }).error).toBe('invalid_input');
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'proportional', prefCodes: ['27'] }).error).toBe('invalid_input');
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'random' }).error).toBe('invalid_input');
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: ['99'] }).error).toBe('unknown_area');
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: [27] }).error).toBe('invalid_input');
  });

  it('allocation_not_possible: nothing left to take from, or more than exists', () => {
    expect(call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: ['30'] }).error).toBe('allocation_not_possible');
    expect(call('run_allocation', { ...wakayama10, deltaPercent: -150 }).error).toBe('allocation_not_possible');
    expect(call('run_allocation', { ...wakayama10, deltaPercent: 1e9 }).error).toBe('allocation_not_possible');
  });

  it('allocation_not_possible messages are fixed Japanese sentences with whole-number figures, never the engine text', () => {
    const cases = [
      call('run_allocation', { ...wakayama10, deltaPercent: -150 }),
      call('run_allocation', { ...wakayama10, deltaPercent: 1e9 }),
      call('run_allocation', { target: wakayama10.target, year: 2100, deltaPeople: 1e15 }),
      call('run_allocation', { target: wakayama10.target, year: 2100, deltaPeople: 1e300 }),
      call('run_allocation', { ...wakayama10, sourceMode: 'regions', prefCodes: ['30'] }),
    ];
    for (const r of cases) {
      expect(r.error).toBe('allocation_not_possible');
      expect(r.message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
      expect(r.message!.replace(/prefCodes|sourceMode|deltaPercent|deltaPeople/g, '')).not.toMatch(/[A-Za-z]{2,}/); // no engine English
      expect(r.message).not.toMatch(/\d\.\d/); // no fractional figures
      expect(r.message).not.toMatch(/e\+\d/); // no exponent notation
      expect(r.message!.length).toBeLessThan(200);
    }
    // the figures are the real ones, written as whole numbers with thousands commas
    const withCommas = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const run = ctx.run(DEFAULT_SCENARIO);
    const wakayama = new Set(ctx.groups.prefs['30']);
    const sumOf = (inWakayama: boolean): number =>
      Math.round(ctx.areas.filter((a) => wakayama.has(a.code) === inWakayama).reduce((t, a) => t + total(run.get(a.code)![2100]), 0));
    expect(cases[0].message).toContain(`${withCommas(sumOf(true))}人`); // the target's own population
    expect(cases[1].message).toContain(`${withCommas(sumOf(false))}人`); // what the rest of the country has
    expect(cases[2].message).toContain('1,000,000,000,000,000人');
    expect(cases[3].message).toContain('桁外れ');
    expect(cases[4].message).toContain('引く側');
  });

  it('bad targets: unknown code, wrong kind, a prefecture code for an area target', () => {
    expect(call('run_allocation', { target: { kind: 'pref', code: '99' }, deltaPercent: 5, year: 2100 }).error).toBe('unknown_area');
    expect(call('run_allocation', { target: { kind: 'area', code: '30' }, deltaPercent: 5, year: 2100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: { kind: 'pref', code: KOYA }, deltaPercent: 5, year: 2100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: { kind: 'city', code: KOYA }, deltaPercent: 5, year: 2100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { target: KOYA, deltaPercent: 5, year: 2100 }).error).toBe('invalid_input');
    expect(call('run_allocation', { deltaPercent: 5, year: 2100 }).error).toBe('invalid_input');
  });

  it('results stay compact (< 6 KB) for a prefecture, an area, a negative move and a many-prefecture source', () => {
    for (const input of [
      wakayama10,
      { target: { kind: 'pref', code: '13' }, deltaPercent: -20, year: 2050 },
      { target: { kind: 'area', code: TANABE }, deltaPercent: 50, year: 2075, scenario: { migMode: 'fade' } },
      { target: { kind: 'pref', code: '01' }, deltaPeople: 500_000, year: 2100, prefCodes: ['11', '12', '13', '14'] },
    ]) {
      const r = call('run_allocation', input);
      expect(r.error, JSON.stringify(input)).toBeUndefined();
      expect(jsonSize(r)).toBeLessThan(6000);
    }
  });
});

describe('run_allocation on a synthetic world (flips whose counts do not change)', () => {
  const pop = (n: number): { M: number[]; F: number[] } => ({ M: [n, ...new Array(19).fill(0)], F: new Array(20).fill(0) });
  const area = (code: string, name: string, prefCode: string, n: number): Area => ({
    code,
    name,
    prefCode,
    prefName: `pref${prefCode}`,
    kind: 'city',
    base: pop(n),
    official: { 2025: n, 2030: n, 2035: n, 2040: n, 2045: n, 2050: n },
    assumptions: null,
  });
  const hall: Facility = { id: 'hall', name: 'ホール', p50: 5000, p80: 10000, essential: true, excludesMetro: true, source: 'test' };
  const shop: Facility = { id: 'shop', name: '店', p50: 5000, p80: 10000, essential: false, excludesMetro: true, source: 'test' };
  const areas = [area('01001', 'S', '01', 5100), area('02001', 'T', '02', 4900)];
  const flat = (): Map<string, Series> => {
    const out = new Map<string, Series>();
    for (const a of areas) {
      const series: Series = {};
      for (let y = 2020; y <= 2100; y += 5) series[y] = a.base;
      out.set(a.code, series);
    }
    return out;
  };
  const tiny: EngineContext = { areas, facilities: [hall, shop], groups: { cities: {}, prefs: { '01': ['01001'], '02': ['02001'] } }, run: flat };

  it('a swap (S falls below, T rises above) is listed even though before == after', () => {
    const r = call('run_allocation', { target: { kind: 'pref', code: '02' }, deltaPercent: 5, year: 2050 }, tiny);
    expect(r.error).toBeUndefined();
    expect(r.targetBefore).toBe(4900);
    expect(r.targetAfter).toBe(5145);
    const swap = { before: 1, after: 1, lostCount: 1, gainedCount: 1, lostExamples: ['S'], gainedExamples: ['T'] };
    expect(r.essentialFlips).toEqual([{ facilityId: 'hall', name: 'ホール', essential: true, ...swap }]);
    expect(r.facilityFlips).toEqual([{ facilityId: 'shop', name: '店', essential: false, ...swap }]);
    expect(r.flippedFacilityCount).toBe(2);
    expect(r.essentialFlippedCount).toBe(1);
    expect(r.omittedFlipCount).toBe(0);
  });

  it('no flips gives an empty list; the world has the pieces the tools need', () => {
    const r = call('run_allocation', { target: { kind: 'pref', code: '02' }, deltaPercent: 1, year: 2050 }, tiny);
    expect(r.facilityFlips).toEqual([]);
    expect(r.essentialFlips).toEqual([]);
    expect(r.flippedFacilityCount).toBe(0);
    expect(call('find_area', { query: 'S' }, tiny).matches.map((m) => m.code)).toEqual(['01001']);
    expect(call('get_series', { areaCode: '01', years: [2100] }, tiny).rows[0].population).toBe(5100);
  });
});

describe('find_similar_now', () => {
  it('returns 5 areas whose 2020 population is closest to the projected one, nearest first, excluding itself', () => {
    const r = call('find_similar_now', { areaCode: TANABE, year: 2100 });
    expect(r.area).toEqual({ code: TANABE, name: '田辺市', prefName: '和歌山県' });
    expect(r.year).toBe(2100);
    const projected = Math.round(total(ctx.run(DEFAULT_SCENARIO).get(TANABE)![2100]));
    expect(r.population).toBe(projected);
    expect(r.similar).toHaveLength(5);
    const base = new Map(ctx.areas.map((a) => [a.code, Math.round(total(a.base))]));
    const expected = ctx.areas
      .filter((a) => a.code !== TANABE)
      .map((a) => ({ code: a.code, d: Math.abs(base.get(a.code)! - projected) }))
      .sort((a, b) => a.d - b.d || (a.code < b.code ? -1 : 1))
      .slice(0, 5)
      .map((x) => x.code);
    expect(r.similar.map((s) => s.code)).toEqual(expected);
    expect(r.similar.map((s) => s.code)).not.toContain(TANABE);
    for (const s of r.similar) {
      expect(s.pop2020).toBe(base.get(s.code));
      expect(s.code).toMatch(/^\d{5}$/);
      expect(typeof s.name).toBe('string');
      expect(typeof s.prefName).toBe('string');
    }
    const dist = r.similar.map((s) => Math.abs(s.pop2020 - projected));
    expect([...dist].sort((a, b) => a - b)).toEqual(dist);
  });

  it('in 2020 the area itself would be the nearest match, but it is excluded', () => {
    const r = call('find_similar_now', { areaCode: TANABE, year: 2020 });
    expect(r.population).toBe(Math.round(total(ctx.areas.find((a) => a.code === TANABE)!.base)));
    expect(r.similar).toHaveLength(5);
    expect(r.similar.map((x) => x.code)).not.toContain(TANABE);
    expect(Math.abs(r.similar[0].pop2020 - r.population)).toBeGreaterThan(0); // nobody else has exactly this population
    for (const code of [KOYA, MINATO_WARD, KITAYAMA_VILLAGE]) {
      expect(call('find_similar_now', { areaCode: code, year: 2020 }).similar.map((x) => x.code)).not.toContain(code);
    }
  });

  it('works for a prefecture or Japan (only 5-digit areas are returned) and honours the scenario', () => {
    const p = call('find_similar_now', { areaCode: '30', year: 2100 });
    expect(p.similar).toHaveLength(5);
    expect(p.similar.every((s) => /^\d{5}$/.test(s.code))).toBe(true);
    const base = call('find_similar_now', { areaCode: KOYA, year: 2100 });
    const fade = call('find_similar_now', { areaCode: KOYA, year: 2100, scenario: { migMode: 'fade' } });
    expect(fade.population).toBeGreaterThan(base.population); // less out-migration from a shrinking town
    expect(call('find_similar_now', { areaCode: '99999', year: 2100 }).error).toBe('unknown_area');
  });
});

describe('count_areas', () => {
  it('below 3000 people: the count grows from 2020 to 2100, both plausible, examples are real small areas', () => {
    const r2020 = call('count_areas', { year: 2020, below: 3000 });
    const r2100 = call('count_areas', { year: 2100, below: 3000 });
    expect(r2020.total).toBe(1884);
    expect(r2100.total).toBe(1884);
    expect(r2100.count).toBeGreaterThanOrEqual(r2020.count);
    expect(r2020.count).toBeGreaterThan(100);
    expect(r2020.count).toBeLessThan(250);
    expect(r2100.count).toBeGreaterThan(400);
    expect(r2100.count).toBeLessThan(1200);
    // independent count from the data
    const r = ctx.run(DEFAULT_SCENARIO);
    const direct = ctx.areas.filter((a) => Math.round(total(r.get(a.code)![2100])) < 3000).length;
    expect(r2100.count).toBe(direct);
    expect(r2100.examples.length).toBeLessThanOrEqual(5);
    expect(r2100.examples.length).toBe(5);
    for (const e of r2100.examples) {
      expect(e.population).toBeLessThan(3000);
      expect(Object.keys(e).sort()).toEqual(['code', 'name', 'population', 'prefName']);
    }
    expect(r2100.year).toBe(2100);
  });

  it('above (>=), a range, and one prefecture', () => {
    const r = ctx.run(DEFAULT_SCENARIO);
    const ge = call('count_areas', { year: 2050, above: 500_000 });
    expect(ge.count).toBe(ctx.areas.filter((a) => Math.round(total(r.get(a.code)![2050])) >= 500_000).length);
    expect(ge.examples[0].population).toBeGreaterThanOrEqual(500_000);
    const range = call('count_areas', { year: 2050, above: 10_000, below: 20_000 });
    expect(range.count).toBe(
      ctx.areas.filter((a) => {
        const p = Math.round(total(r.get(a.code)![2050]));
        return p >= 10_000 && p < 20_000;
      }).length,
    );
    const wak = call('count_areas', { year: 2100, below: 3000, prefCode: '30' });
    expect(wak.total).toBe(30);
    expect(wak.count).toBeLessThanOrEqual(30);
    expect(wak.count).toBeGreaterThan(0);
    expect(call('count_areas', { year: 2100, below: 3000, prefCode: '99' }).error).toBe('unknown_area');
    expect(call('count_areas', { year: 2100, below: 3000, prefCode: 30 }).error).toBe('invalid_input');
    expect(call('count_areas', { year: 2100, below: 3000, prefCode: KOYA }).error).toBe('invalid_input');
  });

  it('boundaries: below is strictly less, above is greater or equal, at exactly the population shown', () => {
    const year = 2050;
    const exact = call('get_series', { areaCode: TANABE, years: [year] }).rows[0].population;
    const run = ctx.run(DEFAULT_SCENARIO);
    const equal = ctx.areas.filter((a) => Math.round(total(run.get(a.code)![year])) === exact).length;
    expect(equal).toBeGreaterThanOrEqual(1); // 田辺市 itself
    const n = (bounds: { below?: number; above?: number }): number => call('count_areas', { year, ...bounds }).count;
    expect(n({ below: exact + 1 }) - n({ below: exact })).toBe(equal);
    expect(n({ above: exact }) - n({ above: exact + 1 })).toBe(equal);
    expect(n({ above: exact, below: exact + 1 })).toBe(equal);
    expect(n({ above: exact, below: exact })).toBe(0);
    const at = call('count_areas', { year, above: exact, below: exact + 1 });
    expect(at.examples.some((e) => e.code === TANABE)).toBe(equal <= 5);
  });

  it('at least one numeric bound is required; the scenario applies', () => {
    expect(call('count_areas', { year: 2100 }).error).toBe('invalid_input');
    expect(call('count_areas', { year: 2100, below: '3000' }).error).toBe('invalid_input');
    expect(call('count_areas', { year: 2100, below: NaN }).error).toBe('invalid_input');
    const base = call('count_areas', { year: 2100, below: 3000 });
    const fade = call('count_areas', { year: 2100, below: 3000, scenario: { migMode: 'fade' } });
    expect(fade.count).toBeLessThan(base.count); // fewer small towns once out-migration fades
    expect(call('count_areas', { year: 2043, below: 3000 }).year).toBe(2040);
  });
});

describe('robustness', () => {
  const garbage: unknown[] = [
    undefined, null, 0, 1, NaN, '', 'x', '田辺', true, [], [1, 2], {}, { areaCode: null }, { areaCode: {} }, { areaCode: [] },
    { areaCode: TANABE, year: {} }, { areaCode: TANABE, years: {} }, { areaCode: TANABE, years: [[]] }, { query: {} },
    { target: null }, { target: [] }, { year: 'x', below: {} }, { scenario: 'x' }, { areaCode: TANABE, scenario: [] },
    { areaCode: 'x'.repeat(100_000) }, { query: 'あ'.repeat(100_000) }, { areaCode: TANABE, years: new Array(1000).fill(2050) },
    JSON.parse('{"__proto__": {"areaCode": "30206"}}'), { areaCode: TANABE, year: 2050, scenario: { __proto__: null, cwrMult: 1 } },
    Object.create(null),
  ];

  it('never throws and always returns a JSON-serialisable value, for every tool and every kind of garbage', () => {
    for (const name of [...TOOL_NAMES, 'nope']) {
      for (const g of garbage) {
        let r: unknown;
        expect(() => {
          r = runTool(name, g, ctx);
        }, `${name}(${String(JSON.stringify(g))?.slice(0, 40)})`).not.toThrow();
        expect(() => JSON.stringify(r)).not.toThrow();
        expect(r).toBeTypeOf('object');
        expect(r).not.toBeNull();
        const out = r as Failed;
        if (out.error !== undefined) {
          expect(typeof out.error).toBe('string');
          expect(typeof out.message).toBe('string');
          expect(out.message!.length).toBeGreaterThan(0);
          expect(jsonSize(out)).toBeLessThan(1000);
        }
      }
    }
  });

  it('a broken context (run throws) becomes an error object, not an exception', () => {
    const broken: EngineContext = {
      ...ctx,
      run: () => {
        throw new Error('boom at /Users/someone/secret/path.ts');
      },
    };
    const r = call('get_series', { areaCode: TANABE }, broken);
    expect(r.error).toBe('internal_error');
    expect(JSON.stringify(r)).not.toContain('/Users');
    expect(JSON.stringify(r)).not.toContain('boom');
  });

  it('results are curated: no raw Area fields and no file paths in anything a tool returns', () => {
    const results = [
      call('find_area', { query: '田辺' }),
      call('get_series', { areaCode: TANABE }),
      call('compare_sources', { areaCode: TANABE }),
      call('run_projection', { areaCode: TANABE, scenario: { migMode: 'fade' } }),
      call('facility_check', { areaCode: TANABE, year: 2050 }),
      call('run_allocation', wakayamaTarget()),
      call('find_similar_now', { areaCode: TANABE, year: 2100 }),
      call('count_areas', { year: 2100, below: 3000 }),
    ];
    for (const r of results) {
      const s = JSON.stringify(r);
      for (const forbidden of ['assumptions', 'officialAges', '"base"', '"surv"', '/Users', '.json', 'node_modules', 'excludesMetro', 'https://']) {
        expect(s, forbidden).not.toContain(forbidden);
      }
      expect(s.length).toBeLessThan(6000);
    }
  });

  it('is deterministic and does not mutate the context', () => {
    const before = JSON.stringify(ctx.areas.slice(0, 50));
    const a = call('run_allocation', wakayamaTarget());
    const b = call('run_allocation', wakayamaTarget());
    expect(a).toEqual(b);
    expect(JSON.stringify(ctx.areas.slice(0, 50))).toBe(before);
  });
});

function wakayamaTarget(): unknown {
  return { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 };
}
