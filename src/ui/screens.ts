// The six screens (the owner, 2026-11-08: one message to a screen): what each screen says in its one heading, and the
// small pure helpers that build those sentences from the engine's numbers. No DOM here. A heading that carries a figure
// is made from the figure (never typed in), so it cannot drift from the map, the board or the town card.
//
// The order, in the words of the owner: the entrance (how many people are left), the board (when, where, what falls
// below its guide), the choice (a place kept means another place not kept), your town, the AI, the sources.
// The verbs stay as the rest of the app has them: 「人口の目安を下回る」; the two approved headings that say 「残せなくなる」
// carry a line under them that says what it means (BOARD_SCREEN_LEAD).
import type { AppData } from '../data/loader';
import { alreadyBelowAreas, boardCrossings, BOARD_NONE, essentialFacilities, scopeGroups, scopeRows, townRows, type BoardRow, type NameLookup } from './board';
import type { Totals } from './derive';
import { formatCount, formatSupport } from './format';
import { levelOf, type Selection } from './nav';
import type { Series } from '../engine/types';
import { resolveScope, type TownScope } from './townPanel';

/** The six screens, in order: the id of the section and the id of its heading. */
export const SCREEN_IDS = {
  entry: 'screen-entry',
  board: 'screen-board',
  choose: 'screen-choose',
  town: 'screen-town',
  ai: 'screen-ai',
  sources: 'screen-sources',
} as const;
export type ScreenKey = keyof typeof SCREEN_IDS;

export const ENTRY_LEAD = '全部は残せません。何を残すか、いまのうちに選ぶための地図です。';
/** The one small line under the map: what kind of number this is. */
export const ENTRY_NOTE = '試算。2050年までは国立社会保障・人口問題研究所の公式推計';
/** The cue at the foot of the first screen: the next screen's message, as a link to it. */
export const ENTRY_NEXT = '下へ ↓ いつ、どこで、何が残せなくなるのか';

export const BOARD_SCREEN_TITLE = 'いつ、どこで、何が残せなくなるのか。';
export const BOARD_SCREEN_LEAD = 'ここでの「残せない」は、人口が国土交通省の統計の目安を下回ることです。';

export const CHOOSE_TITLE = 'どこかに人を残すと、別のどこかが残せなくなります。';
/** Under the two boxes: why the two numbers are one. */
export const CHOOSE_SAME = '同じ人数が入れ替わるだけです。日本全体の人口は変わりません。';
/** Small, when the example is the whole country's earliest row and not the place on screen. */
export const CHOOSE_EXAMPLE = '日本全体の例';
export const CHOOSE_KEEP_TITLE = 'ここを残すには';
export const CHOOSE_COST_TITLE = '代わりに、ほかの町から';

export const TOWN_TITLE_NONE = 'あなたの町は、どうなりますか。';
export const TOWN_NONE_AT_ALL = '2100年までに、人口の目安を下回る施設はありません。';

export const AI_TITLE = '気になることは、AI に聞いてください。';
export const SOURCES_TITLE = '数字の出どころ';
export const SOURCES_NOTE = '2050年より先の数字は、公式の前提を延ばした、このアプリの試算です。';

// ---------------------------------------------------------------------------------------------------------------
// Figures in words
// ---------------------------------------------------------------------------------------------------------------

/** Round to two significant digits (`Math.round` on the digit below the second). */
function twoSignificant(x: number): number {
  if (x <= 0) return 0;
  const mag = 10 ** (Math.floor(Math.log10(x)) - 1);
  return Math.round(x / mag) * mag;
}

/**
 * A population the way a sentence says it, rounded so it reads at a glance:
 * 約1億500万人 (from 1億 up, to the nearest million), 約6,300万人 / 約52万人 / 約4.2万人 (10,000 up, two
 * significant digits), 約930人 / 約93人 (below 10,000, two significant digits).
 */
export function approxPopulation(n: number): string {
  if (!Number.isFinite(n)) return '－';
  const x = Math.max(0, n);
  if (x >= 1e4) {
    const man = twoSignificant(x / 1e4);
    if (man < 1e4) {
      const text = man < 10 ? String(Number(man.toFixed(1))) : formatCount(man);
      return `約${text}万人`;
    }
    const million = Math.round(x / 1e6);
    const oku = Math.floor(million / 100);
    const rest = (million % 100) * 100;
    return rest > 0 ? `約${oku}億${formatCount(rest)}万人` : `約${oku}億人`;
  }
  return `約${formatCount(x < 100 ? Math.round(x) : twoSignificant(x))}人`;
}

/** 「2020年の約半分です」 and its relatives, from the ratio to 2020 (NaN: no clause). */
export function compareClause(ratio: number): string {
  if (!Number.isFinite(ratio)) return '';
  if (ratio < 0.05) return '2020年の1割に満たない水準です。';
  if (ratio >= 0.45 && ratio < 0.55) return '2020年の約半分です。';
  if (ratio >= 0.95 && ratio < 1.05) return '2020年とほぼ同じです。';
  if (ratio >= 1.05) return `2020年の約${Number((Math.round(ratio * 10) / 10).toFixed(1))}倍です。`;
  return `2020年の約${Math.round(ratio * 10)}割です。`;
}

/** The first screen's heading: 「2100年、日本の人口は約6,300万人。2020年の約半分です。」 (2020 itself: the figure only). */
export function entryHeadline(p: { place: string; year: number; pop: number; ratio: number }): string {
  const figure = approxPopulation(p.pop);
  if (p.year === 2020) return `2020年、${p.place}の人口は${figure}です。`;
  return `${p.year}年、${p.place}の人口は${figure}。${compareClause(p.ratio)}`;
}

/** The same heading while the map colours by the support ratio. */
export function entrySupportHeadline(p: { place: string; year: number; now: number; base: number }): string {
  const lead = `${p.year}年、${p.place}で、高齢者1人を支える現役世代は${formatSupport(p.now)}`;
  return p.year === 2020 ? `${lead}です。` : `${lead}。2020年は${formatSupport(p.base)}です。`;
}

// ---------------------------------------------------------------------------------------------------------------
// The earliest crossing of a place (the board's first row), shared by the headings and the choice screen
// ---------------------------------------------------------------------------------------------------------------

export interface FirstRow {
  /** The earliest new crossing of the place (a town: any of its facilities, the essential one on a tie), if any. */
  row?: BoardRow;
  /** Towns' facilities already below in 2020 (a town: how many kinds; a scope: how many towns). */
  alreadyBelow: number;
}

const memo = new WeakMap<object, Map<string, FirstRow>>();

/**
 * The first row of the board for `scope`, from the same crossings the board panel reads (`boardCrossings`), so a
 * heading and the board never say different things. Memoised per series object and place.
 */
export function boardFirstRow(data: Pick<AppData, 'facilities'>, totals: Totals, series: Map<string, Series>, scope: TownScope, names: NameLookup): FirstRow {
  let byPlace = memo.get(series);
  if (!byPlace) memo.set(series, (byPlace = new Map()));
  const hit = byPlace.get(scope.key);
  if (hit) return hit;
  let out: FirstRow;
  if (scope.level === 'area') {
    const r = boardCrossings(totals, scope.areaCodes, data.facilities);
    const rows = townRows(r.crossings, data.facilities, scope.name);
    // The earliest of all the town's facilities (the board lists the eight essential ones first, then the others folded away);
    // the same year goes to the essential one.
    const e = rows.essential[0];
    const o = rows.others[0];
    out = { row: e && o ? (o.year < e.year ? o : e) : (e ?? o), alreadyBelow: r.alreadyBelow.length };
  } else {
    const r = boardCrossings(totals, scope.areaCodes, essentialFacilities(data.facilities));
    const rows = scopeRows(scopeGroups(r.crossings, data.facilities), data.facilities, names, scope.level);
    out = { row: rows[0], alreadyBelow: alreadyBelowAreas(r, data.facilities) };
  }
  byPlace.set(scope.key, out);
  return out;
}

/** The scope of the whole country (what the choice screen falls back to). */
export function japanScope(data: Parameters<typeof resolveScope>[0], areaByCode: Parameters<typeof resolveScope>[2]): TownScope {
  return resolveScope(data, {} satisfies Selection, areaByCode);
}

// ---------------------------------------------------------------------------------------------------------------
// The fourth screen's heading
// ---------------------------------------------------------------------------------------------------------------

/**
 * 「田辺市は、2100年に約3.4万人。（施設の名前）が人口の目安を下回るのは2035年。」 for a town; the same for a prefecture with the
 * town that comes first left out (「…下回る町が出るのは…」); nothing selected: a question. `pop2100` is the place's 2100 population.
 */
export function townHeadline(p: { level: ReturnType<typeof levelOf>; name: string; pop2100: number; first: FirstRow }): string {
  if (p.level === 'japan') return TOWN_TITLE_NONE;
  const lead = `${p.name}は、2100年に${approxPopulation(p.pop2100)}。`;
  const row = p.first.row;
  if (row) return `${lead}${row.facilityName}が人口の目安を下回る${p.level === 'pref' ? '町が出る' : ''}のは${row.year}年。`;
  if (p.level === 'pref') return `${lead}${BOARD_NONE}`;
  if (p.first.alreadyBelow > 0) return `${lead}2020年の時点で、人口の目安を下回る施設が${formatCount(p.first.alreadyBelow)}種類あります。`;
  return `${lead}${TOWN_NONE_AT_ALL}`;
}
