// The AI guide's tools: pure functions over the engine. They only select, aggregate and curate; every population
// number comes from the engine (projectAll results handed in through `ctx.run`), never from a second calculation.
//
// runTool never throws for bad model input. It returns `{ error, message }` (Japanese message) with one of the codes
// unknown_tool, invalid_input, unknown_area, year_out_of_range, scenario_out_of_range, allocation_not_possible or
// internal_error. Results are curated plain JSON (no raw Area objects, no file paths); the largest, run_allocation, is
// about 6 KB, far below the 20,000 characters the client lets one tool result carry.
import { ageGroups, ages65, sumSeries, total } from '../engine/aggregate';
import { allocate } from '../engine/allocation';
import type { AllocationInput } from '../engine/allocation';
import { facilityStatus } from '../engine/facilities';
import type { Status } from '../engine/facilities';
import { OFFICIAL_END_YEAR } from '../engine/scenarios';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Area, Facility, Groups, Scenario, Series } from '../engine/types';
import { MAX_YEARS } from './toolDefs';

/**
 * What the tools need from the app.
 *
 * - `areas` must be the full 1,884-area list (Ruling 20: village results depend on the list passed to projectAll).
 * - `run` projects every area under a scenario. The tools call it only with sanitised scenarios (all four fields
 *   present, validated against Ruling 21). It is expected to be memoised by the caller, because a tool call may run
 *   two or three scenarios. When the scenario has infraStrength > 0, `run` must pass `facilities` on to projectAll
 *   (the engine needs the facility list for the infrastructure feedback); the tools only build the Scenario.
 */
export interface EngineContext {
  areas: Area[];
  facilities: Facility[];
  groups: Groups;
  run: (s: Scenario) => Map<string, Series>;
}

// ---------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const fail = (code: string, message: string): never => {
  throw new ToolFailure(code, message);
};

/** A short, safe rendering of model-supplied text for an error message. */
const shown = (x: unknown): string => JSON.stringify(typeof x === 'string' ? x.slice(0, 30) : String(typeof x));

// ---------------------------------------------------------------------------------------------------------------
// Places: areas, prefectures, designated cities and Japan
// ---------------------------------------------------------------------------------------------------------------

type PlaceKind = 'area' | 'prefecture' | 'designated_city' | 'japan';

interface Place {
  code: string;
  name: string;
  prefName?: string;
  kind: PlaceKind;
  areaKind?: string; // ward | city | town | hamadori, for kind 'area'
  prefCode?: string;
  areaCodes: string[];
  keys: string[]; // normalised names that find_area matches against
}

interface Index {
  groups: Groups;
  areaByCode: Map<string, Area>;
  places: Map<string, Place>;
  ordered: Place[]; // search order: Japan, prefectures, designated cities, areas
}

const indexCache = new WeakMap<Area[], Index>();

/** Normalise for matching: compatibility forms, no spaces, small ヶ as ケ. */
function norm(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, '').replace(/ヶ/g, 'ケ');
}

/** "札幌市中央区" -> "札幌市": the designated city's name is the part of its wards' names up to the first 市. */
function cityGroupName(wardNames: string[], code: string): string {
  const first = wardNames[0] ?? '';
  const i = first.indexOf('市');
  if (i > 0) {
    const name = first.slice(0, i + 1);
    if (wardNames.every((n) => n.startsWith(name))) return name;
  }
  return code;
}

function buildIndex(ctx: EngineContext): Index {
  const areaByCode = new Map<string, Area>();
  const prefNames = new Map<string, string>();
  for (const a of ctx.areas) {
    areaByCode.set(a.code, a);
    if (!prefNames.has(a.prefCode)) prefNames.set(a.prefCode, a.prefName);
  }
  const known = (codes: string[]): string[] => codes.filter((c) => areaByCode.has(c));

  const places = new Map<string, Place>();
  const ordered: Place[] = [];
  const add = (p: Place): void => {
    places.set(p.code, p);
    ordered.push(p);
  };

  add({ code: '00', name: '日本', kind: 'japan', areaCodes: ctx.areas.map((a) => a.code), keys: ['日本', '全国', '日本全国'].map(norm) });
  for (const code of Object.keys(ctx.groups.prefs).sort()) {
    const name = prefNames.get(code) ?? code;
    const keys = [norm(name)];
    if (/[都府県]$/.test(name) && name.length >= 3) keys.push(norm(name.slice(0, -1))); // 東京, 京都, 和歌山
    add({ code, name, kind: 'prefecture', prefCode: code, areaCodes: known(ctx.groups.prefs[code]), keys });
  }
  for (const [code, members] of Object.entries(ctx.groups.cities)) {
    const codes = known(members);
    if (codes.length === 0) continue;
    const name = cityGroupName(codes.map((c) => areaByCode.get(c)!.name), code);
    const first = areaByCode.get(codes[0])!;
    add({ code, name, prefName: first.prefName, kind: 'designated_city', prefCode: first.prefCode, areaCodes: codes, keys: [norm(name)] });
  }
  for (const a of ctx.areas) {
    add({ code: a.code, name: a.name, prefName: a.prefName, kind: 'area', areaKind: a.kind, prefCode: a.prefCode, areaCodes: [a.code], keys: [norm(a.name)] });
  }
  return { groups: ctx.groups, areaByCode, places, ordered };
}

function indexOf(ctx: EngineContext): Index {
  let index = indexCache.get(ctx.areas);
  if (!index || index.groups !== ctx.groups) {
    index = buildIndex(ctx);
    indexCache.set(ctx.areas, index);
  }
  return index;
}

/** The code format a place is looked up by: 2 digits (prefecture, Japan is "00") or 5 digits. */
function resolvePlace(raw: unknown, ctx: EngineContext, label = 'areaCode'): Place {
  if (typeof raw !== 'string') return fail('invalid_input', `${label} は文字列（例: "30206"）で指定してください。`);
  const code = raw.trim();
  const place = /^(?:\d{2}|\d{5})$/.test(code) ? indexOf(ctx).places.get(code) : undefined;
  if (!place) return fail('unknown_area', `コード ${shown(raw)} の地域は見つかりません。名前から探すには find_area を使ってください。`);
  return place;
}

/** Only a single municipality (5-digit area code), nothing aggregated. */
function resolveSingleArea(raw: unknown, ctx: EngineContext): Place {
  const place = resolvePlace(raw, ctx);
  if (place.kind !== 'area') {
    return fail('invalid_input', 'この道具が扱えるのは市区町村の5桁コードだけです（都道府県・政令市・日本全体は不可）。');
  }
  return place;
}

function resolvePref(raw: unknown, ctx: EngineContext, label: string): Place {
  if (typeof raw !== 'string' || !/^\d{2}$/.test(raw.trim())) return fail('invalid_input', `${label} は都道府県の2桁コード（例: "30"）で指定してください。`);
  const place = indexOf(ctx).places.get(raw.trim());
  if (!place || place.kind !== 'prefecture') return fail('unknown_area', `都道府県コード ${shown(raw)} は見つかりません。`);
  return place;
}

/** How a place is named in a result: name plus prefecture for anything below a prefecture. */
function whoIs(p: Place): { code: string; name: string; prefName?: string } {
  return p.prefName !== undefined ? { code: p.code, name: p.name, prefName: p.prefName } : { code: p.code, name: p.name };
}

const aggregateCache = new WeakMap<Map<string, Series>, Map<string, Series>>();

/** The place's series under one run: the area's own series, or the sum over its areas. */
function seriesOf(place: Place, run: Map<string, Series>): Series {
  const own = run.get(place.code);
  if (place.kind === 'area') return own ?? fail('internal_error', 'missing series');
  let cache = aggregateCache.get(run);
  if (!cache) aggregateCache.set(run, (cache = new Map()));
  let sum = cache.get(place.code);
  if (!sum) {
    sum = sumSeries(place.areaCodes.map((c) => run.get(c) ?? fail('internal_error', 'missing series')));
    cache.set(place.code, sum);
  }
  return sum;
}

function totalAt(series: Series, year: number): number {
  const pop = series[year];
  if (!pop) return fail('internal_error', 'missing year');
  return total(pop);
}

// ---------------------------------------------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------------------------------------------

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function asInput(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? raw : fail('invalid_input', '入力はオブジェクトで指定してください。');
}

/** An optional field: undefined and null both mean "not given". */
const given = (x: unknown): boolean => x !== undefined && x !== null;

const FIRST_YEAR = 2020;
const LAST_YEAR = 2100;
const STEP = 5;

interface YearInfo {
  year: number; // the year used: snapped down to a multiple of 5
  requested: number;
}

function parseYear(raw: unknown, label = 'year'): YearInfo {
  if (typeof raw !== 'number' || Number.isNaN(raw)) return fail('invalid_input', `${label} は数値（例: 2050）で指定してください。`);
  if (raw < FIRST_YEAR || raw > LAST_YEAR) {
    return fail('year_out_of_range', `年は ${FIRST_YEAR} から ${LAST_YEAR} の間で指定してください（指定: ${raw}）。範囲外の年は扱えません。`);
  }
  return { year: Math.floor(raw / STEP) * STEP, requested: raw };
}

/** `requestedYear` is added only when the year was snapped. */
const yearFields = (y: YearInfo): { year: number; requestedYear?: number } =>
  y.requested === y.year ? { year: y.year } : { year: y.year, requestedYear: y.requested };

const SCENARIO_KEYS = new Set(['cwrMult', 'migMode', 'migScale', 'infraStrength']);
const OUT_OF_RANGE = 'scenario_out_of_range';

function numberIn(name: string, raw: unknown, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
    return fail(OUT_OF_RANGE, `${name} は ${min} 以上 ${max} 以下の数値で指定してください。範囲外の値は使えません。`);
  }
  return raw;
}

/** Ruling 21: validate (never clamp) and return a clean, complete Scenario. */
function parseScenario(raw: unknown): Scenario {
  const s: Scenario = { ...DEFAULT_SCENARIO };
  if (!given(raw)) return s;
  if (!isRecord(raw)) return fail('invalid_input', 'scenario はオブジェクトで指定してください。');
  for (const key of Object.keys(raw)) {
    if (!SCENARIO_KEYS.has(key)) return fail('invalid_input', `scenario に未知の項目があります: ${shown(key)}。`);
  }
  if (given(raw.cwrMult)) s.cwrMult = numberIn('cwrMult', raw.cwrMult, 0.6, 1.4);
  if (given(raw.migScale)) s.migScale = numberIn('migScale', raw.migScale, 0, 1.5);
  if (given(raw.infraStrength)) s.infraStrength = numberIn('infraStrength', raw.infraStrength, 0, 0.01);
  if (given(raw.migMode)) {
    if (raw.migMode !== 'hold' && raw.migMode !== 'fade') return fail(OUT_OF_RANGE, 'migMode は "hold" か "fade" のどちらかです。');
    s.migMode = raw.migMode;
  }
  return s;
}

function parseFiniteNumber(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fail('invalid_input', `${label} は有限の数値で指定してください。`);
  return raw;
}

// ---------------------------------------------------------------------------------------------------------------
// Rounding and shared result pieces
// ---------------------------------------------------------------------------------------------------------------

const people = (x: number): number => Math.round(x);
const percent1 = (x: number): number => Math.round(x * 10) / 10;
/** Two decimals; a change that rounds to nothing is 0, never -0. */
const percent2 = (x: number): number => Math.round(x * 100) / 100 || 0;
const basisOf = (year: number): 'official' | 'app_estimate' => (year <= OFFICIAL_END_YEAR ? 'official' : 'app_estimate');

// ---------------------------------------------------------------------------------------------------------------
// 1. find_area
// ---------------------------------------------------------------------------------------------------------------

const MAX_MATCHES = 8;
const MAX_QUERY = 64;

function toMatch(p: Place): Record<string, string> {
  switch (p.kind) {
    case 'japan':
      return { code: p.code, name: p.name, kind: 'japan' };
    case 'prefecture':
      return { code: p.code, name: p.name, kind: 'prefecture' };
    case 'designated_city':
      return { code: p.code, name: p.name, prefName: p.prefName!, kind: 'designated_city' };
    default:
      return { code: p.code, name: p.name, prefName: p.prefName!, kind: p.areaKind! };
  }
}

function findArea(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  if (typeof input.query !== 'string') return fail('invalid_input', 'query は文字列で指定してください。');
  const q = norm(input.query);
  if (q.length === 0) return fail('invalid_input', 'query が空です。地域の名前を入れてください。');
  if (q.length > MAX_QUERY) return { matches: [] };

  const hits: Array<{ rank: number; order: number }> = [];
  indexOf(ctx).ordered.forEach((p, order) => {
    let rank = 3; // 0 exact, 1 prefix, 2 substring
    for (const key of p.keys) {
      if (key === q) rank = 0;
      else if (key.startsWith(q)) rank = Math.min(rank, 1);
      else if (key.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank < 3) hits.push({ rank, order });
  });
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const { ordered } = indexOf(ctx);
  return { matches: hits.slice(0, MAX_MATCHES).map((h) => toMatch(ordered[h.order])) };
}

// ---------------------------------------------------------------------------------------------------------------
// 2. get_series
// ---------------------------------------------------------------------------------------------------------------

const DEFAULT_YEARS = [2020, 2030, 2040, 2050, 2060, 2075, 2100];

/**
 * The `years` input of get_series and get_age_groups: each year checked and snapped down to a multiple of 5, the same
 * year asked for twice listed once (the first request wins), sorted. Omitted or empty means the seven default years.
 */
function parseYearList(raw: unknown): YearInfo[] {
  let wanted: YearInfo[];
  if (!given(raw) || (Array.isArray(raw) && raw.length === 0)) {
    wanted = DEFAULT_YEARS.map((y) => ({ year: y, requested: y }));
  } else if (Array.isArray(raw) && raw.length <= MAX_YEARS) {
    wanted = raw.map((y) => parseYear(y, 'years の各要素'));
  } else {
    return fail('invalid_input', `years は年の配列（最大 ${MAX_YEARS} 個）で指定してください。`);
  }
  const byYear = new Map<number, YearInfo>();
  for (const y of wanted) if (!byYear.has(y.year)) byYear.set(y.year, y); // the first request wins
  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

function getSeries(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolvePlace(input.areaCode, ctx);
  const scenario = parseScenario(input.scenario);
  const wanted = parseYearList(input.years);

  const series = seriesOf(place, ctx.run(scenario));
  const base = totalAt(series, FIRST_YEAR);
  const rows = wanted.map((y) => {
    const pop = series[y.year];
    if (!pop) return fail('internal_error', 'missing year');
    const all = total(pop);
    const old = ages65(pop);
    return {
      ...yearFields(y),
      population: people(all),
      ages65: people(old),
      ages65Share: all > 0 ? percent1((100 * old) / all) : 0,
      changeFrom2020Percent: base > 0 ? percent1((100 * (all - base)) / base) : 0,
      basis: basisOf(y.year),
    };
  });
  return { area: whoIs(place), scenario, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// 3. compare_sources
// ---------------------------------------------------------------------------------------------------------------

const OFFICIAL_YEARS = [2025, 2030, 2035, 2040, 2045, 2050];
const ESTIMATE_YEARS = [2055, 2060, 2065, 2070, 2075, 2080, 2085, 2090, 2095, 2100];

/** Two significant digits, so a tiny but real difference never rounds to exactly 0. */
const sig2 = (x: number): number => Number(x.toPrecision(2));

const COMPARE_NOTE =
  '社人研（国立社会保障・人口問題研究所）の市区町村別の公式推計は2050年までです。2025〜2050年は、このアプリの計算が公表されている公式の値を、市区町村ごとには数人から十人弱のずれで再現しています（都道府県や日本全体は、足し合わせた分だけずれが大きくなります）。2055年以降（2055〜2100年）はこのアプリの試算で、公式の数字ではありません。';

function compareSources(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolvePlace(input.areaCode, ctx);
  const scenario = parseScenario(input.scenario);
  const index = indexOf(ctx);
  const series = seriesOf(place, ctx.run(scenario));

  let maxRelative = 0;
  let maxAbsolute = 0;
  const official = OFFICIAL_YEARS.map((year) => {
    let officialTotal = 0;
    for (const code of place.areaCodes) {
      const value = index.areaByCode.get(code)?.official[year];
      if (typeof value !== 'number') return fail('internal_error', 'missing official value');
      officialTotal += value;
    }
    const app = totalAt(series, year);
    const relative = officialTotal > 0 ? Math.abs(app - officialTotal) / officialTotal : 0;
    const difference = people(app) - officialTotal;
    maxRelative = Math.max(maxRelative, relative);
    maxAbsolute = Math.max(maxAbsolute, Math.abs(difference));
    return { year, official: officialTotal, app: people(app), difference, relativeDifference: sig2(relative) };
  });
  return {
    area: whoIs(place),
    scenario,
    official,
    maxRelativeDifference: sig2(maxRelative),
    maxRelativeDifferencePercent: sig2(maxRelative * 100),
    maxAbsoluteDifference: maxAbsolute,
    appEstimate: ESTIMATE_YEARS.map((year) => ({ year, population: people(totalAt(series, year)), basis: 'app_estimate' })),
    note: COMPARE_NOTE,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 4. run_projection
// ---------------------------------------------------------------------------------------------------------------

const PROJECTION_YEARS = [2050, 2075, 2100];

function runProjection(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolvePlace(input.areaCode, ctx);
  if (!given(input.scenario)) return fail('invalid_input', 'scenario を指定してください（標準のままなら空のオブジェクト {}）。');
  const scenario = parseScenario(input.scenario);
  const chosen = seriesOf(place, ctx.run(scenario));
  const standard = seriesOf(place, ctx.run({ ...DEFAULT_SCENARIO }));
  const rows = PROJECTION_YEARS.map((year) => {
    const scenarioPopulation = people(totalAt(chosen, year));
    const defaultPopulation = people(totalAt(standard, year));
    const difference = scenarioPopulation - defaultPopulation;
    return {
      year,
      basis: basisOf(year),
      scenarioPopulation,
      defaultPopulation,
      difference,
      differencePercent: defaultPopulation > 0 ? percent1((100 * difference) / defaultPopulation) : 0,
    };
  });
  return { area: whoIs(place), scenario, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// 5. facility_check
// ---------------------------------------------------------------------------------------------------------------

/** Ruling 10: the three metropolitan areas, whole prefectures. The MLIT thresholds exclude them. */
const METRO_PREFS = new Set(['11', '12', '13', '14', '21', '23', '24', '26', '27', '28', '29']);

/** What the p50 / p80 columns mean in words the model will use: "edge" from the 50% level, "ok" from the 80% level. */
const THRESHOLDS = { edgePercent: 50, okPercent: 80 };

function facilityCheck(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolveSingleArea(input.areaCode, ctx);
  const year = parseYear(input.year);
  const scenario = parseScenario(input.scenario);
  if (given(input.onlyEssential) && typeof input.onlyEssential !== 'boolean') {
    return fail('invalid_input', 'onlyEssential は true か false で指定してください。');
  }
  const onlyEssential = input.onlyEssential === true;

  const pop = totalAt(seriesOf(place, ctx.run(scenario)), year.year);
  const counts: Record<Status, number> = { ok: 0, edge: 0, below: 0 };
  const facilities = ctx.facilities
    .filter((f) => !onlyEssential || f.essential)
    .map((f) => {
      const status = facilityStatus(pop, f);
      counts[status]++;
      return { id: f.id, name: f.name, status, essential: f.essential, p50: f.p50, p80: f.p80 };
    });
  const outsideMlitScope = METRO_PREFS.has(place.prefCode ?? '');
  return {
    area: whoIs(place),
    ...yearFields(year),
    scenario,
    population: people(pop),
    outsideMlitScope,
    ...(outsideMlitScope
      ? { note: '三大都市圏の県は、人口の目安の元になった国土交通省の統計（2009〜2012年）の対象外です。この目安は参考程度に扱ってください。' }
      : {}),
    counts,
    facilityCount: facilities.length,
    facilityTotal: ctx.facilities.length,
    thresholds: THRESHOLDS,
    facilities,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 6. run_allocation
// ---------------------------------------------------------------------------------------------------------------

const MAX_TOP = 10;
const MAX_FLIPS = 10; // non-essential flips listed; essential flips are always all listed
const MAX_EXAMPLES = 3;

function parseSource(input: Record<string, unknown>, ctx: EngineContext): AllocationInput['source'] {
  const hasCodes = given(input.prefCodes) && !(Array.isArray(input.prefCodes) && input.prefCodes.length === 0);
  const mode = given(input.sourceMode) ? input.sourceMode : hasCodes ? 'regions' : 'proportional';
  if (mode === 'proportional') {
    if (hasCodes) return fail('invalid_input', 'prefCodes を使うときは sourceMode を "regions" にしてください。');
    return { mode: 'proportional' };
  }
  if (mode !== 'regions') return fail('invalid_input', 'sourceMode は "proportional" か "regions" のどちらかです。');
  if (!Array.isArray(input.prefCodes) || input.prefCodes.length === 0 || input.prefCodes.length > 47) {
    return fail('invalid_input', 'sourceMode が "regions" のときは、prefCodes に都道府県の2桁コードの配列を指定してください。');
  }
  const prefCodes = input.prefCodes.map((c) => resolvePref(c, ctx, 'prefCodes の各要素').code);
  return { mode: 'regions', prefCodes: [...new Set(prefCodes)] };
}

interface FlipEntry {
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

/** A head count as a whole number with thousands commas, written out in full (never exponent notation). */
function wholePeople(x: number): string {
  const n = Math.round(Math.abs(x));
  return Number.isSafeInteger(n) ? `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}人` : '桁外れに大きな人数';
}

/**
 * A fixed Japanese sentence for an engine RangeError. Which rule was broken is read from the engine's message; the
 * figures come from the caller, rounded to whole people, so no English text or fraction reaches the model.
 */
function allocationFailureMessage(engineMessage: string, deltaPeople: number, targetTotal: number, sourceTotal: number): string {
  if (engineMessage.includes("source group's population")) {
    return `動かす人数（${wholePeople(deltaPeople)}）が、人口を引く側の全体の人口（${wholePeople(sourceTotal)}）より多いため、この動かし方はできません。`;
  }
  if (engineMessage.includes("target group's population")) {
    return `減らす人数（${wholePeople(deltaPeople)}）が、対象の人口（${wholePeople(targetTotal)}）より多いため、この動かし方はできません。`;
  }
  if (engineMessage.includes('source group is empty')) {
    return '人口を引く側の地域が残らないため、この動かし方はできません。引く県（prefCodes）の指定を見直してください。';
  }
  return 'この条件では人口を動かせません。対象と人数、引く側の指定を見直してください。';
}

export interface Decrease {
  before: number;
  after: number;
}

/** One plain sentence on who loses people and why the list looks the way it does. Digits and advice stay out of it. */
function decreaseNote(count: number, deltaPeople: number, sourceMode: 'proportional' | 'regions', smallShare: boolean): string {
  if (count === 0) return '人口が動いていないので、減る地域はありません。';
  if (deltaPeople < 0) return '減るのは対象の人口で、対象の中のどの地域も、人口に比例して同じ割合で減ります。';
  if (sourceMode === 'regions') {
    return '引く元に指定した県の地域だけが、人口に比例して同じ割合で減るため、この一覧はその中の人口の多い地域の順です。';
  }
  return smallShare
    ? 'ほかの全国のすべての地域が、人口に比例して同じ割合でわずかに減るため、この一覧は人口の多い地域の順です。'
    : 'ほかの全国のすべての地域が、人口に比例して同じ割合で減るため、この一覧は人口の多い地域の順です。';
}

/**
 * The losing side of an allocation as a whole: how many areas lose people, how many people they lose together (the
 * same number as the target gains, up to rounding) and the median of their percentage changes. Inside the group that
 * pays, the engine takes the same share from every area, so the median is also the change of each of them.
 * Exported for tests (the engine alone cannot produce areas with different shares to test the median on).
 */
export function summariseDecreases(
  losing: Decrease[],
  deltaPeople: number,
  sourceMode: 'proportional' | 'regions',
): { areaCount: number; totalRemoved: number; medianChangePercent?: number; note: string } {
  const percents = losing.map((m) => (100 * (m.after - m.before)) / m.before).sort((a, b) => a - b);
  const mid = percents.length >> 1;
  const median = percents.length === 0 ? undefined : percents.length % 2 === 1 ? percents[mid] : (percents[mid - 1] + percents[mid]) / 2;
  return {
    areaCount: losing.length,
    totalRemoved: people(losing.reduce((t, m) => t + (m.before - m.after), 0)),
    ...(median !== undefined ? { medianChangePercent: percent2(median) } : {}),
    note: decreaseNote(losing.length, deltaPeople, sourceMode, median !== undefined && Math.abs(median) < 1),
  };
}

function runAllocation(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  if (!isRecord(input.target)) return fail('invalid_input', 'target は { kind: "pref" か "area", code } で指定してください。');
  const { kind, code } = input.target;
  const index = indexOf(ctx);
  let targetPlace: Place;
  if (kind === 'pref') {
    targetPlace = resolvePref(code, ctx, 'target.code');
  } else if (kind === 'area') {
    if (typeof code !== 'string' || !/^\d{5}$/.test(code.trim())) return fail('invalid_input', 'target.code は市区町村の5桁コードで指定してください。');
    const p = index.places.get(code.trim());
    if (!p || p.kind !== 'area') return fail('unknown_area', `市区町村コード ${shown(code)} は見つかりません。`);
    targetPlace = p;
  } else {
    return fail('invalid_input', 'target.kind は "pref" か "area" のどちらかです。');
  }

  const hasPercent = given(input.deltaPercent);
  const hasPeople = given(input.deltaPeople);
  if (hasPercent === hasPeople) return fail('invalid_input', 'deltaPercent と deltaPeople は、どちらか一方だけを指定してください。');
  const deltaPercent = hasPercent ? parseFiniteNumber(input.deltaPercent, 'deltaPercent') : undefined;
  const deltaPeopleInput = hasPeople ? parseFiniteNumber(input.deltaPeople, 'deltaPeople') : undefined;
  const source = parseSource(input, ctx);
  const year = parseYear(input.year);
  const scenario = parseScenario(input.scenario);

  const run = ctx.run(scenario);
  const popByArea = new Map<string, number>();
  const areaPref = new Map<string, string>();
  for (const a of ctx.areas) {
    popByArea.set(a.code, totalAt(run.get(a.code) ?? fail('internal_error', 'missing series'), year.year));
    areaPref.set(a.code, a.prefCode);
  }
  const sumOf = (codes: string[], pops: Map<string, number>): number => codes.reduce((s, c) => s + pops.get(c)!, 0);
  const targetCodes = targetPlace.areaCodes;
  const targetBefore = sumOf(targetCodes, popByArea);
  const deltaPeople = people(deltaPercent !== undefined ? (targetBefore * deltaPercent) / 100 : deltaPeopleInput!);

  let result: ReturnType<typeof allocate>;
  try {
    result = allocate(popByArea, areaPref, { target: { kind: kind as 'pref' | 'area', code: targetPlace.code }, deltaPeople, source }, ctx.facilities);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    const inTarget = new Set(targetCodes);
    const sourceTotal = ctx.areas.reduce(
      (t, a) => (inTarget.has(a.code) || (source.mode === 'regions' && !source.prefCodes.includes(a.prefCode)) ? t : t + popByArea.get(a.code)!),
      0,
    );
    return { error: 'allocation_not_possible', message: allocationFailureMessage(e.message, deltaPeople, targetBefore, sourceTotal) };
  }

  const name = (code: string): string => index.areaByCode.get(code)!.name;
  const moved = ctx.areas.map((a) => {
    const before = popByArea.get(a.code)!;
    const after = result.pop.get(a.code)!;
    return { a, before, after, rounded: Math.abs(people(after) - people(before)), exact: Math.abs(after - before) };
  });
  type Moved = (typeof moved)[number];
  /** Largest change first (in whole people, then unrounded), ties by code: the order of both lists below. */
  const biggestChange = (x: Moved, y: Moved): number => y.rounded - x.rounded || y.exact - x.exact || (x.a.code < y.a.code ? -1 : 1);
  const top = [...moved]
    .sort(biggestChange)
    .slice(0, MAX_TOP)
    .map(({ a, before, after }) => ({ code: a.code, name: a.name, prefName: a.prefName, before: people(before), after: people(after) }));

  // The losing side: every area whose population fell. `top` is by size of change, so it mostly shows the gaining side.
  const losing = moved.filter((m) => m.after < m.before);
  const largestDecreases = [...losing]
    .sort(biggestChange)
    .slice(0, MAX_TOP)
    .map(({ a, before, after }) => ({
      code: a.code,
      name: a.name,
      prefName: a.prefName,
      before: people(before),
      after: people(after),
      delta: people(after) - people(before),
      changePercent: percent2((100 * (after - before)) / before),
    }));
  const decreaseSummary = summariseDecreases(losing, deltaPeople, source.mode);

  const examples = (codes: string[]): string[] =>
    [...codes].sort((x, y) => result.pop.get(y)! - result.pop.get(x)! || (x < y ? -1 : 1)).slice(0, MAX_EXAMPLES).map(name);
  const facilityById = new Map(ctx.facilities.map((f) => [f.id, f]));
  const changed = result.flips
    .filter((f) => f.lost.length + f.gained.length > 0)
    .map((f, order) => ({ f, order, essential: facilityById.get(f.facilityId)?.essential === true }))
    .sort((x, y) => y.f.lost.length + y.f.gained.length - (x.f.lost.length + x.f.gained.length) || x.order - y.order);
  const entry = ({ f, essential }: (typeof changed)[number]): FlipEntry => ({
    facilityId: f.facilityId,
    name: facilityById.get(f.facilityId)?.name ?? f.facilityId,
    essential,
    before: f.before,
    after: f.after,
    lostCount: f.lost.length,
    gainedCount: f.gained.length,
    lostExamples: examples(f.lost),
    gainedExamples: examples(f.gained),
  });
  // Essential facilities are never cut off: all of them are in essentialFlips, and facilityFlips holds the others.
  const essentialFlips = changed.filter((c) => c.essential).map(entry);
  const others = changed.filter((c) => !c.essential);
  const facilityFlips = others.slice(0, MAX_FLIPS).map(entry);

  return {
    ...yearFields(year),
    scenario,
    target: { kind, code: targetPlace.code, name: targetPlace.name },
    ...(deltaPercent !== undefined ? { deltaPercent } : {}),
    deltaPeople,
    source: source.mode === 'regions' ? { mode: 'regions', prefCodes: source.prefCodes } : { mode: 'proportional' },
    targetBefore: people(targetBefore),
    targetAfter: people(sumOf(targetCodes, result.pop)),
    top,
    largestDecreases,
    decreaseSummary,
    flippedFacilityCount: changed.length,
    essentialFlippedCount: essentialFlips.length,
    omittedFlipCount: others.length - facilityFlips.length,
    essentialFlips,
    facilityFlips,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 7. find_similar_now
// ---------------------------------------------------------------------------------------------------------------

const MAX_SIMILAR = 5;

function findSimilarNow(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolvePlace(input.areaCode, ctx);
  const year = parseYear(input.year);
  const scenario = parseScenario(input.scenario);
  const projected = people(totalAt(seriesOf(place, ctx.run(scenario)), year.year));

  const similar = ctx.areas
    .filter((a) => a.code !== place.code)
    .map((a) => ({ a, pop2020: people(total(a.base)) }))
    .map((x) => ({ ...x, distance: Math.abs(x.pop2020 - projected) }))
    .sort((x, y) => x.distance - y.distance || (x.a.code < y.a.code ? -1 : 1))
    .slice(0, MAX_SIMILAR)
    .map(({ a, pop2020 }) => ({ code: a.code, name: a.name, prefName: a.prefName, pop2020 }));
  return { area: whoIs(place), ...yearFields(year), scenario, population: projected, similar };
}

// ---------------------------------------------------------------------------------------------------------------
// 8. count_areas
// ---------------------------------------------------------------------------------------------------------------

const MAX_EXAMPLES_COUNT = 5;

function countAreas(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const year = parseYear(input.year);
  const scenario = parseScenario(input.scenario);
  const below = given(input.below) ? parseFiniteNumber(input.below, 'below') : undefined;
  const above = given(input.above) ? parseFiniteNumber(input.above, 'above') : undefined;
  if (below === undefined && above === undefined) return fail('invalid_input', 'below（未満）か above（以上）の少なくとも一方を数値で指定してください。');
  const index = indexOf(ctx);
  let pool: Area[] = ctx.areas;
  let prefCode: string | undefined;
  if (given(input.prefCode)) {
    const pref = resolvePref(input.prefCode, ctx, 'prefCode');
    prefCode = pref.code;
    pool = pref.areaCodes.map((c) => index.areaByCode.get(c)!);
  }

  const run = ctx.run(scenario);
  const rows = pool.map((a) => ({ a, population: people(totalAt(run.get(a.code) ?? fail('internal_error', 'missing series'), year.year)) }));
  const hits = rows.filter((r) => (below === undefined || r.population < below) && (above === undefined || r.population >= above));
  const smallestFirst = below !== undefined;
  hits.sort((x, y) => (smallestFirst ? x.population - y.population : y.population - x.population) || (x.a.code < y.a.code ? -1 : 1));
  return {
    ...yearFields(year),
    scenario,
    ...(below !== undefined ? { below } : {}),
    ...(above !== undefined ? { above } : {}),
    ...(prefCode !== undefined ? { prefCode } : {}),
    count: hits.length,
    total: rows.length,
    examples: hits.slice(0, MAX_EXAMPLES_COUNT).map(({ a, population }) => ({ code: a.code, name: a.name, prefName: a.prefName, population })),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 9. get_age_groups
// ---------------------------------------------------------------------------------------------------------------

/**
 * get_age_groups: the same places, years, scenario and rounding as get_series, split into 0-14, 15-64 and 65+ with the
 * engine's own class boundaries (`ageGroups`, shared with the town panel). Each group is rounded on its own, so the
 * three people counts can differ from `total` by one person; the shares use get_series' rule (one decimal), so
 * share65plus is exactly what get_series reports as ages65Share.
 */
function getAgeGroups(raw: unknown, ctx: EngineContext): unknown {
  const input = asInput(raw);
  const place = resolvePlace(input.areaCode, ctx);
  const scenario = parseScenario(input.scenario);
  const wanted = parseYearList(input.years);

  const series = seriesOf(place, ctx.run(scenario));
  const rows = wanted.map((y) => {
    const pop = series[y.year];
    if (!pop) return fail('internal_error', 'missing year');
    const all = total(pop);
    const groups = ageGroups(pop);
    const share = (x: number): number => (all > 0 ? percent1((100 * x) / all) : 0);
    return {
      ...yearFields(y),
      basis: basisOf(y.year),
      total: people(all),
      age0to14: people(groups.age0to14),
      age15to64: people(groups.age15to64),
      age65plus: people(groups.age65plus),
      share0to14: share(groups.age0to14),
      share15to64: share(groups.age15to64),
      share65plus: share(groups.age65plus),
    };
  });
  return { area: whoIs(place), scenario, rows };
}

// ---------------------------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------------------------

const HANDLERS = new Map<string, (input: unknown, ctx: EngineContext) => unknown>([
  ['find_area', findArea],
  ['get_series', getSeries],
  ['compare_sources', compareSources],
  ['run_projection', runProjection],
  ['facility_check', facilityCheck],
  ['run_allocation', runAllocation],
  ['find_similar_now', findSimilarNow],
  ['count_areas', countAreas],
  ['get_age_groups', getAgeGroups],
]);

/** Run one tool. The result is JSON-serialisable and is `{ error, message }` for any bad input; this never throws. */
export function runTool(name: string, input: unknown, ctx: EngineContext): unknown {
  try {
    const handler = typeof name === 'string' ? HANDLERS.get(name) : undefined;
    if (!handler) return fail('unknown_tool', `道具 ${shown(name)} はありません。`);
    return handler(input, ctx);
  } catch (e) {
    if (e instanceof ToolFailure && e.code !== 'internal_error') return { error: e.code, message: e.message };
    return { error: 'internal_error', message: '計算中に問題が起きました。少し置いてからもう一度試すか、聞き方を変えてください。' };
  }
}
