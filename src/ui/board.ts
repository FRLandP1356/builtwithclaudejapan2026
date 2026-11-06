// 「分かれ目」: when, where and what falls below its population guide, for the place on screen (pure part, no DOM).
//
// The panel at the head of the right column reads the crossings engine (src/engine/crossings.ts) for the selected
// scope, the whole country, one prefecture or one town, and turns them into three things: a strip of bars (how many
// towns newly fall below a guide in each five-year step, counted on the eight essential facilities only), a short list
// of the earliest crossings (year, facility, town) and the count of what is already below the guide in 2020.
//
// Every sentence here says that a number crosses a statistic's line. It never says that a facility closes, is lost or
// cannot be kept, and it never names a landmark: the guide is how common a facility is among towns of a size.
import { crossingsPerYear, groupCrossings, scopeCrossings, type AreaCrossings, type Crossing, type FacilityYearGroup, type YearCount } from '../engine/crossings';
import type { Facility } from '../engine/types';
import type { Totals } from './derive';
import { formatCount } from './format';
import type { Level } from './nav';
import { OFFICIAL_END_YEAR } from './sources';

// ---------------------------------------------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------------------------------------------

export const BOARD_TITLE = '分かれ目';
/** The number of rows the list shows before the rest is folded away. */
export const BOARD_ROWS = 6;

/** The line under the title: what the list is, for the place on screen. */
export function boardHeading(level: Level, name: string): string {
  if (level === 'japan') return '日本全体で、人口の目安を下回っていく順番';
  if (level === 'pref') return `${name}で、人口の目安を下回っていく順番`;
  return `${name}で、人口の目安を下回る施設と、その年`;
}

/** Under the strip of bars: what one bar counts. */
export function boardBarsLead(level: Level): string {
  return level === 'area' ? '5年ごとに、新しく人口の目安を下回る施設の数' : '5年ごとに、新しく人口の目安を下回る町の数（主な8施設のいずれか）';
}

export const BOARD_ESSENTIAL_NOTE = '日々の暮らしに関わる主な8施設で数えています。';
/** The one sentence that says what the guide is and what it is not. */
export const BOARD_GUIDE_NOTE =
  '人口の目安は、その人口の町の半分でその施設がある、という国土交通省の統計（2009〜2012年）です。下回っても、その施設がなくなると決まるわけではありません。';
export const BOARD_NONE = '2100年までに、主な8施設の人口の目安を新しく下回る町はありません。';
export const BOARD_NONE_ESSENTIAL = '2100年までに、主な8施設で新しく人口の目安を下回るものはありません。';
export const BOARD_OTHERS = 'その他の施設';
export const BOARD_TABLE = '棒の数字を表で見る';
export const BOARD_BAR_SUMMARY_NONE = 'どの年にも、新しく下回るものはありません。';

/** 「続きを見る（残り12件）」 */
export function moreText(rest: number): string {
  return `続きを見る（残り${formatCount(rest)}件）`;
}

/** 「いちばん多いのは2045年（6町）」; two or more years with the maximum: 「いちばん多いのは2035年と2045年（6町）」. */
export function barsSummary(bars: BoardBars, unit: string): string {
  const tops = bars.bars.filter((b) => b.value === bars.max && b.value > 0).map((b) => `${b.year}年`);
  if (tops.length === 0) return BOARD_BAR_SUMMARY_NONE;
  const years = tops.length > 3 ? `${tops.slice(0, 3).join('・')}ほか` : tops.join('と');
  return `いちばん多いのは${years}（${formatCount(bars.max)}${unit}）。`;
}

/** 「2020年の時点で、すでに目安を下回る：3種類」 for a town; the towns already below any essential guide for a scope. */
export function alreadyBelowText(level: Level, count: number): string {
  if (level === 'area') return `2020年の時点で、すでに目安を下回る：${formatCount(count)}種類`;
  return `2020年の時点で、すでに主な8施設のいずれかの目安を下回る：${formatCount(count)}町`;
}

/** 「田辺市」 / 「田辺市 ほか3町」. */
export function townsText(lead: string, others: number): string {
  return others > 0 ? `${lead} ほか${formatCount(others)}町` : lead;
}

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------

export function essentialFacilities(facilities: readonly Facility[]): Facility[] {
  return facilities.filter((f) => f.essential);
}

/** The crossings of the areas of a scope, read from the totals the map colours by. */
export function boardCrossings(totals: Totals, codes: readonly string[], facilities: readonly Facility[]): AreaCrossings {
  return scopeCrossings(codes, totals.years, (code) => totals.area.get(code), facilities);
}

export interface BoardBar {
  year: number;
  /** Towns (a scope) or facilities (a town) that newly fall below a guide in this year. */
  value: number;
  /** After 2050: this app's estimate. */
  estimate: boolean;
}

export interface BoardBars {
  bars: BoardBar[];
  max: number;
}

/** One bar per grid year after 2020. A scope counts towns (each once), a town counts its facilities. */
export function boardBars(crossings: readonly Crossing[], years: readonly number[], level: Level): BoardBars {
  const counts: YearCount[] = crossingsPerYear(crossings, years);
  const bars = counts.map((c) => ({ year: c.year, value: level === 'area' ? c.crossings : c.areas, estimate: c.year > OFFICIAL_END_YEAR }));
  return { bars, max: bars.reduce((m, b) => Math.max(m, b.value), 0) };
}

export interface NameLookup {
  area(code: string): string | undefined;
  /** The prefecture of an area, by the area's code; only read for the whole country, where a town needs its prefecture. */
  prefOfArea(code: string): string | undefined;
}

/**
 * One line of the list: the year, the facility and the town. For a scope the town is the one that had the most people
 * before the crossing and `others` counts the rest; for a town itself `others` is 0 and `townsText` is empty (the
 * heading already names the town).
 */
export interface BoardRow {
  year: number;
  estimate: boolean;
  facilityId: string;
  facilityName: string;
  essential: boolean;
  /** The town the disclosure 「ここを残すには」 computes for (its code and its name as shown). */
  leadCode: string;
  leadName: string;
  /** The other towns of this facility and year. */
  others: number;
  /** 「田辺市 ほか3町」, or '' for a town's own list. */
  townsText: string;
}

/**
 * The rows of a scope: one per facility and year, earliest first (groupCrossings' order). For the whole country a
 * town's name carries its prefecture, 「歌志内市（北海道）」, because the same name exists in several prefectures.
 */
export function scopeRows(groups: readonly FacilityYearGroup[], facilities: readonly Facility[], names: NameLookup, level: Level): BoardRow[] {
  const byId = new Map(facilities.map((f) => [f.id, f] as const));
  const rows: BoardRow[] = [];
  for (const g of groups) {
    const f = byId.get(g.facilityId);
    const lead = g.items[0];
    if (!f || !lead) continue;
    const name = names.area(lead.areaCode) ?? lead.areaCode;
    const pref = level === 'japan' ? names.prefOfArea(lead.areaCode) : undefined;
    const leadName = pref ? `${name}（${pref}）` : name;
    const others = g.items.length - 1;
    rows.push({
      year: g.year,
      estimate: g.year > OFFICIAL_END_YEAR,
      facilityId: f.id,
      facilityName: f.name,
      essential: f.essential,
      leadCode: lead.areaCode,
      leadName,
      others,
      townsText: townsText(leadName, others),
    });
  }
  return rows;
}

/** The rows of a town, in the crossings' order (year, then the facility list): the essential ones apart from the rest. */
export function townRows(crossings: readonly Crossing[], facilities: readonly Facility[], townName: string): { essential: BoardRow[]; others: BoardRow[] } {
  const byId = new Map(facilities.map((f) => [f.id, f] as const));
  const essential: BoardRow[] = [];
  const others: BoardRow[] = [];
  for (const c of crossings) {
    const f = byId.get(c.facilityId);
    if (!f) continue;
    const row: BoardRow = {
      year: c.year,
      estimate: c.year > OFFICIAL_END_YEAR,
      facilityId: f.id,
      facilityName: f.name,
      essential: f.essential,
      leadCode: c.areaCode,
      leadName: townName,
      others: 0,
      townsText: '',
    };
    (f.essential ? essential : others).push(row);
  }
  return { essential, others };
}

/** The crossings of a scope grouped for its list, essential facilities only (the list is about the eight). */
export function scopeGroups(crossings: readonly Crossing[], facilities: readonly Facility[]): FacilityYearGroup[] {
  const essential = new Set(essentialFacilities(facilities).map((f) => f.id));
  return groupCrossings(crossings.filter((c) => essential.has(c.facilityId)), facilities);
}

/** How many areas of a scope are already below the guide of at least one essential facility in the first year. */
export function alreadyBelowAreas(r: AreaCrossings, facilities: readonly Facility[]): number {
  const essential = new Set(essentialFacilities(facilities).map((f) => f.id));
  return new Set(r.alreadyBelow.filter((a) => essential.has(a.facilityId)).map((a) => a.areaCode)).size;
}
