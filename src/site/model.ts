// The numbers behind the site's pages (src/site/): every figure on screen is read from here, and here from the engine
// and the data files. Nothing is typed in. Pure (no DOM), so the page's figures are fixed by tests (model.test.ts).
//
// Three kinds of figure, always told apart on screen:
//   実績      the census counts: 2020 (Area.base) and 2025 (Area.actual, the 2025 census, published 2026-09-29);
//   公式推計  the published projection of the institute (Area.official, 2025..2050);
//   試算      this app's calculation: from 2030 on, the official assumptions applied to the 2025 count (projectAll with
//             fromActual), and after 2050 the held assumptions. The seven Hamamatsu wards have no 2025 count: for them
//             2025..2050 is the official projection and 2055 on the extension of it.
import type { AppData } from '../data/loader';
import type { Checks, CheckTown } from '../data/checks';
import { deviationBins, deviationStep, summarize, type CheckSummary, type DeviationBin } from '../data/checks';
import type { Landmark } from '../data/landmarks';
import { total } from '../engine/aggregate';
import { observedBirthsFactor } from '../engine/births';
import { facilityStatus } from '../engine/facilities';
import { projectAll } from '../engine/project';
import { DEFAULT_SCENARIO, type Area, type Facility, type Pop, type Series } from '../engine/types';

export const YEARS: readonly number[] = Array.from({ length: 17 }, (_, i) => 2020 + i * 5);
export const AGE_GROUPS = 20;
/** 0〜4歳 … 90〜94歳, 95歳以上 */
export const AGE_LABELS: readonly string[] = Array.from({ length: AGE_GROUPS }, (_, i) => (i === AGE_GROUPS - 1 ? '95歳以上' : `${i * 5}〜${i * 5 + 4}歳`));
export const BASE_YEAR = 2020;
export const ACTUAL_YEAR = 2025;
export const OFFICIAL_END = 2050;
export const END_YEAR = 2100;

export type Status = 'jisseki' | 'suikei' | 'shisan';
export const STATUS_LABEL: Readonly<Record<Status, string>> = { jisseki: '実績', suikei: '公式推計', shisan: '試算' };

/** Totals by year, 2020..2100 step 5. */
export type Totals = Record<number, number>;

export interface TownFigures {
  /** The series the pages show: census 2020 and 2025, then this app's calculation from the 2025 count. */
  trial: Totals;
  /** The official projection 2025..2050 (published totals) and its extension after 2050 (2020 is the census). */
  official: Totals;
  /** From the 2025 count, with the 2025 shortfall of births kept (the child-woman ratio at `birthsFactor` of the official one). */
  lowBirth: Totals;
  hasActual: boolean;
}

/**
 * Which calculation the home map, its heading and the hundred people use: the one from the 2025 count with the official
 * assumptions ('trial'), or the one that keeps the 2025 shortfall of births ('lowBirth'). One place to switch (the owner
 * is deciding, 2026-11-08). The answer check always shows both.
 */
export const STANDARD_SERIES: 'trial' | 'lowBirth' = 'lowBirth'; // the owner's decision, 2026-11-08 18:11

export interface Model {
  areas: Area[];
  areaByCode: Map<string, Area>;
  prefNames: Map<string, string>;
  town: Map<string, TownFigures>;
  /** Prefecture totals of the trial series and of the official series. */
  pref: Map<string, Totals>;
  prefOfficial: Map<string, Totals>;
  nation: Totals;
  nationOfficial: Totals;
  /** The country and the prefectures with the 2025 shortfall of births kept. */
  nationLowBirth: Totals;
  prefLowBirth: Map<string, Totals>;
  /** The 2025 child-woman ratio of the count against the official run (one national factor, about 0.92). */
  birthsFactor: number;
  /** The eight facilities marked essential, in the file's order. */
  facilities: Facility[];
  /** Every area's trial series by sex and age (no births factor). */
  trialSeries: Map<string, Series>;
  /** Every area's standard series by sex and age (the births factor applied): the ages the pages read. */
  standardSeries: Map<string, Series>;
  /** The country's standard series by sex and age, summed over every area, 2020..2100. */
  nationStandardAges: Record<number, Pop>;
  /** The country's 2025 population by 5-year age group (both sexes): the census count and the official run from 2020. */
  ages2025: { count: number[]; official: number[] };
  /** The 2025 census against the projection, when checks.json is present. */
  checks?: Checks;
  landmarks: Landmark[];
}

function totalsOf(series: Series): Totals {
  const out: Totals = {};
  for (const y of YEARS) if (series[y]) out[y] = total(series[y]);
  return out;
}

function addInto(sum: Totals, t: Totals): void {
  for (const y of YEARS) sum[y] = (sum[y] ?? 0) + (t[y] ?? 0);
}

/** Build every figure once from the loaded data. About two engine runs over the 1,884 areas. */
export function buildModel(data: AppData): Model {
  const trialAll = projectAll(data.areas, DEFAULT_SCENARIO, END_YEAR, data.facilities, true);
  const officialAll = projectAll(data.areas, DEFAULT_SCENARIO, END_YEAR, data.facilities, false);
  const birthsFactor = observedBirthsFactor(data.areas, officialAll, trialAll);
  const lowBirthAll = projectAll(data.areas, DEFAULT_SCENARIO, END_YEAR, data.facilities, true, birthsFactor);
  const nationStandardAges: Record<number, Pop> = {};
  for (const y of YEARS) nationStandardAges[y] = { M: new Array<number>(AGE_GROUPS).fill(0), F: new Array<number>(AGE_GROUPS).fill(0) };
  for (const a of data.areas) {
    const sr = lowBirthAll.get(a.code) as Series;
    for (const y of YEARS) {
      const pop = sr[y];
      if (!pop) continue;
      for (let i = 0; i < AGE_GROUPS; i++) {
        nationStandardAges[y].M[i] += pop.M[i];
        nationStandardAges[y].F[i] += pop.F[i];
      }
    }
  }
  const town = new Map<string, TownFigures>();
  const pref = new Map<string, Totals>();
  const prefOfficial = new Map<string, Totals>();
  const prefLowBirth = new Map<string, Totals>();
  const nation: Totals = {};
  const nationOfficial: Totals = {};
  const nationLowBirth: Totals = {};
  const ages2025 = { count: new Array<number>(AGE_GROUPS).fill(0), official: new Array<number>(AGE_GROUPS).fill(0) };
  for (const a of data.areas) {
    const trialPop = trialAll.get(a.code) as Series;
    const officialPop = officialAll.get(a.code) as Series;
    for (let i = 0; i < AGE_GROUPS; i++) {
      ages2025.count[i] += trialPop[ACTUAL_YEAR].M[i] + trialPop[ACTUAL_YEAR].F[i];
      ages2025.official[i] += officialPop[ACTUAL_YEAR].M[i] + officialPop[ACTUAL_YEAR].F[i];
    }
    const trialRun = totalsOf(trialPop);
    const officialRun = totalsOf(officialPop);
    const hasActual = a.actual !== undefined;
    // The official series: the published totals where they exist (2025..2050), the engine's extension after.
    const official: Totals = { [BASE_YEAR]: total(a.base) };
    for (const y of YEARS) {
      if (y === BASE_YEAR) continue;
      official[y] = y <= OFFICIAL_END && a.official[y] !== undefined ? a.official[y] : officialRun[y];
    }
    // Without a 2025 count the page shows the official projection itself (not the engine's re-run of it).
    const trial: Totals = hasActual ? trialRun : { ...official };
    const lowBirth: Totals = totalsOf(lowBirthAll.get(a.code) as Series); // every area, the seven wards from their 2020 base
    town.set(a.code, { trial, official, lowBirth, hasActual });
    let p = pref.get(a.prefCode);
    if (!p) pref.set(a.prefCode, (p = {}));
    addInto(p, trial);
    let po = prefOfficial.get(a.prefCode);
    if (!po) prefOfficial.set(a.prefCode, (po = {}));
    addInto(po, official);
    let pl = prefLowBirth.get(a.prefCode);
    if (!pl) prefLowBirth.set(a.prefCode, (pl = {}));
    addInto(pl, lowBirth);
    addInto(nation, trial);
    addInto(nationOfficial, official);
    addInto(nationLowBirth, lowBirth);
  }
  return {
    areas: data.areas,
    areaByCode: new Map(data.areas.map((a) => [a.code, a])),
    prefNames: data.prefNames,
    town,
    pref,
    prefOfficial,
    nation,
    nationOfficial,
    nationLowBirth,
    prefLowBirth,
    birthsFactor,
    facilities: data.facilities.filter((f) => f.essential),
    trialSeries: trialAll,
    standardSeries: lowBirthAll,
    nationStandardAges,
    ages2025,
    checks: data.checks,
    landmarks: data.landmarks ?? [],
  };
}

/** What kind of figure a year holds for a town: its own count for 2025 when it has one. */
export function statusOf(year: number, hasActual: boolean): Status {
  if (year <= BASE_YEAR) return 'jisseki';
  if (year === ACTUAL_YEAR) return hasActual ? 'jisseki' : 'suikei';
  return 'shisan'; // after 2025 every figure is this app's calculation (the wards without a count only start from the published 2025 projection)
}

/** The first year (2020..2100) the town's trial figure is below the facility's guide; undefined when it never is. */
export function belowYear(t: Totals, f: Facility): number | undefined {
  for (const y of YEARS) if (facilityStatus(t[y], f) === 'below') return y;
  return undefined;
}

/** Among the essential facilities the town is below in `year`, the one with the highest guide; undefined when none. */
export function highestBelow(pop: number, facilities: readonly Facility[]): Facility | undefined {
  let best: Facility | undefined;
  for (const f of facilities) if (facilityStatus(pop, f) === 'below' && (!best || f.p50 > best.p50)) best = f;
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Landmarks: the four groups the map's point shapes stand for. Infrastructure and universities are not among what is
// to be kept (the owner, 2026-11-08), so they are not on the map.
// ---------------------------------------------------------------------------------------------------------------

export type Shape = 'circle' | 'diamond' | 'square' | 'triangle';
export interface Group {
  slug: string;
  name: string;
  kinds: readonly string[];
  shape: Shape;
}
export const GROUPS: readonly Group[] = [
  { slug: 'jinja-jiin', name: '神社・寺院', kinds: ['神社', '寺院'], shape: 'circle' },
  { slug: 'sekai-isan', name: '世界遺産', kinds: ['世界遺産'], shape: 'diamond' },
  { slug: 'bunka', name: '文化', kinds: ['祭り・伝統', '城', '美術館・博物館', '産業・名産'], shape: 'square' },
  { slug: 'resort-keisho', name: 'リゾート・景勝', kinds: ['温泉地', '観光地', '自然', 'テーマパーク'], shape: 'triangle' },
];

export function groupOf(kind: string): Group | undefined {
  return GROUPS.find((g) => g.kinds.includes(kind));
}

export function groupBySlug(slug: string | undefined): Group | undefined {
  return GROUPS.find((g) => g.slug === slug);
}

/** The landmarks that belong to one of the four groups (shown on the maps), in the file's order. */
export function shownLandmarks(all: readonly Landmark[]): Landmark[] {
  return all.filter((l) => groupOf(l.kind) !== undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Colour: the share of the 2025 population, one hue (the app's indigo), light = fewer people. Six steps, chosen so
// that 2025 is the darkest everywhere and 2100 spreads the prefectures over the lighter steps (model.test.ts counts).
// The colours are six of the nine OKLab steps of src/map/colors.ts (CHANGE_COLORS), so no new hue is added.
// ---------------------------------------------------------------------------------------------------------------

/** Lower bounds (inclusive) of the steps, darkest first; the last step is everything below the fifth bound. */
export const SHARE_BREAKS: readonly number[] = [0.9, 0.75, 0.6, 0.5, 0.4];
export const SHARE_COLORS: readonly string[] = ['#2b4c7e', '#476490', '#637da3', '#8196b5', '#9fafc8', '#dee4ed'];
export const SHARE_LABELS: readonly string[] = ['90%〜', '75〜90%', '60〜75%', '50〜60%', '40〜50%', '〜40%'];

export function shareStep(ratio: number): number {
  if (!Number.isFinite(ratio)) return SHARE_COLORS.length - 1;
  for (let i = 0; i < SHARE_BREAKS.length; i++) if (ratio >= SHARE_BREAKS[i]) return i;
  return SHARE_COLORS.length - 1;
}

export function shareColor(ratio: number): string {
  return SHARE_COLORS[shareStep(ratio)];
}

/** Colours of the six deviation steps (checks.ts DEVIATION_EDGES): rust = fewer than estimated, indigo = more. */
export const DEVIATION_COLORS: readonly string[] = ['#a43d2b', '#c98b7f', '#e3c9c2', '#c3cedf', '#8da0bf', '#2b4c7e'];
export const DEVIATION_LABELS: readonly string[] = ['−3%未満', '−3〜−1%', '−1〜0%', '0〜+1%', '+1〜+3%', '+3%以上'];

export function deviationColorOf(t: CheckTown | undefined): string | undefined {
  if (!t) return undefined;
  const k = deviationStep(t);
  return k === null ? undefined : DEVIATION_COLORS[k];
}

export interface AnswerCheck {
  summary: CheckSummary;
  bins: DeviationBin[];
  byCode: Map<string, CheckTown>;
}

export function answerCheck(checks: Checks): AnswerCheck {
  return { summary: summarize(checks), bins: deviationBins(checks.towns), byCode: new Map(checks.towns.map((t) => [t.code, t])) };
}

// ---------------------------------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------------------------------

const jp = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** 64,288 */
export function fmt(n: number): string {
  return jp.format(Math.round(n));
}

/** An estimate, rounded for reading: 約6,358万人 / 約4.2万人 / 約1,200人. The exact figure is never shown for an estimate. */
export function approx(n: number): string {
  if (n >= 1e8) return `約${(n / 1e8).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}億人`;
  if (n >= 1e6) return `約${jp.format(Math.round(n / 1e4))}万人`;
  if (n >= 1e4) return `約${(n / 1e4).toFixed(1)}万人`;
  if (n >= 1000) return `約${jp.format(Math.round(n / 100) * 100)}人`;
  if (n >= 100) return `約${jp.format(Math.round(n / 10) * 10)}人`;
  return `約${jp.format(Math.round(n))}人`;
}

/** A figure with its kind: the exact count for a census figure, 約 for a projection or an estimate. */
export function figure(n: number, status: Status): string {
  return status === 'jisseki' ? `${fmt(n)}人` : approx(n);
}

/** The standard national series (STANDARD_SERIES). */
export function standardNation(m: Pick<Model, 'nation' | 'nationLowBirth'>): Totals {
  return STANDARD_SERIES === 'lowBirth' ? m.nationLowBirth : m.nation;
}

/**
 * The home heading, from the standard 2100 figure against 2020: under 0.48 「半分を下回る」, 0.48..0.52 「約半分」, over 「半分を上回る」.
 * Never a fixed sentence (the owner, 2026-11-08).
 */
export function homeHeading(m: Pick<Model, 'nation' | 'nationLowBirth'>): string {
  const n = standardNation(m);
  const r = n[END_YEAR] / n[BASE_YEAR];
  const tail = 'あなたが残したい日本は、どこですか。';
  if (r < 0.48) return `2100年、日本の人口は、2020年の半分を下回る試算です。${tail}`;
  if (r >= 0.52) return `2100年、日本の人口は、2020年の半分を上回る試算です。${tail}`;
  return `2100年、日本の人口は約半分。${tail}`;
}

/** 「6,328万人 → 5,719万人（−9.63%）」: the national 2100 figure from the 2020 start against the standard one. */
export function nationalChangeLine(m: Pick<Model, 'nation' | 'nationOfficial' | 'nationLowBirth'>): string {
  const a = m.nationOfficial[END_YEAR];
  const b = standardNation(m)[END_YEAR];
  return `${approx(a).replace('約', '')} → ${approx(b).replace('約', '')}（${signedPct(((b - a) / a) * 100)}）`;
}

/** The legend of the third line and its one-line note (the factor is the engine's, printed to two decimals). */
export function lowBirthLegend(m: Pick<Model, 'birthsFactor'>): string {
  return `2025年の実績から計算し直し、公式の前提のうち、子どもの生まれやすさだけ、2025年の実績の水準（公式の前提の約${m.birthsFactor.toFixed(2)}倍）のまま続くとしました。予測ではありません。`;
}
export const LOW_BIRTH_NOTE = '高齢の人の亡くなる割合や人の移動の変化は、一時的な出来事の影響を分けられないので、調整していません。';
export const STANDARD_LABEL = '実績で直した試算';
export const INTERIM_LABEL = '途中の段階（実績から、公式の前提のまま）';

/** −0.56% / +57.0% */
export function signedPct(pct: number, digits = 2): string {
  const t = Math.abs(pct).toFixed(digits);
  return `${pct < 0 ? '−' : pct > 0 ? '+' : '±'}${t}%`;
}

// ---------------------------------------------------------------------------------------------------------------
// Who supports whom: people aged 0-14 and 65 and over per person aged 15-64 (age groups 0-2, 3-12 and 13-19).
// ---------------------------------------------------------------------------------------------------------------

export interface SupportLoad {
  young: number;
  working: number;
  old: number;
  /** (young + old) / working; NaN when nobody is of working age. */
  perWorker: number;
}

export function supportLoad(p: Pop): SupportLoad {
  const sum = (from: number, to: number): number => {
    let t = 0;
    for (let i = from; i <= to; i++) t += p.M[i] + p.F[i];
    return t;
  };
  const young = sum(0, 2);
  const working = sum(3, 12);
  const old = sum(13, AGE_GROUPS - 1);
  return { young, working, old, perWorker: working > 0 ? (young + old) / working : NaN };
}
