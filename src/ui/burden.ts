// Wording and numbers for the "いま、この規模の市町村は、1人あたりこれだけ使っています" block of the town panel.
// Pure functions: the DOM is in burdenPanel.ts. Every figure here is an ACTUAL of 令和6年度 (municipalities' total
// expenditure divided by residents), compared across the municipalities of today. It is not a forecast of what any
// town would spend, it says nothing about cause, and it never says a town costs too much or what should be kept.
//
// A `get_burden` AI tool could be added next to the other tools (src/ai/tools.ts) and read the same functions; the AI
// tools are deliberately not touched by this block.
import { bandIndexFor, ownPerCapita, reiwaLabel, type Finance, type FinanceBand } from '../data/finance';
import type { AreaKind } from '../engine/types';
import { formatCount, formatPop } from './format';
import { phrases } from './phrases';

/** 1,733 (thousand yen per resident; the unit is written by the sentence around it). */
export const formatThousandYen = (v: number): string => formatCount(v);

/** The title in phrases that stay whole on a line (「1人あたり」 is never split). */
export const TITLE_PARTS: readonly string[] = ['いま、', 'この規模の市町村は、', '1人あたり', 'これだけ使っています'];

export const BURDEN_TEXT = {
  title: TITLE_PARTS.join(''),
  stripTitle: '人口の規模別、1人あたりの歳出の中央値（千円）',
  stripName: '人口の規模別、1人あたりの歳出の中央値（千円）。この町の規模に印が付いています',
  here: 'この町の規模',
  tableSummary: '数字を表で見る',
  tableCaption: '人口の規模別、1人あたりの歳出（千円）',
  tableUnit: '数字は、1人あたりの歳出（千円）です。',
  tableHeads: ['人口の規模', '団体数', '中央値', '真ん中の半数'],
  publishedTitle: '公表されている区分別の値（令和5年度）',
  publishedCaption: '団体区分別、1人あたりの歳出（千円、令和5年度）',
  publishedHeads: ['団体区分', '1人あたりの歳出（千円）'],
  publishedNote:
    '総務省「令和7年版 地方財政白書」第39表の値です。上の表（令和6年度、人口の規模）とは、年度も、分け方（人口の規模でなく団体区分）も違います。',
  limits:
    '同じ時点の市町村どうしの比較で、この町が将来これだけ使うという予測ではありません。災害復旧や大きな事業の年は値が跳ねます。町村や特別区は、都道府県が担う事務が市と違います。',
} as const;

/** The first line under the title: what the numbers are. */
export function leadText(f: Finance): string {
  return `${reiwaLabel(f.fiscalYear)}の決算（実績）です。市町村が1年に使ったお金（歳出総額）を、住民基本台帳の人口で割っています。`;
}

/** The source and processing statement, with the formula, the statistics and the number of municipalities, in phrases. */
export function sourceParts(f: Finance): string[] {
  return [
    '出典：',
    `総務省「${reiwaLabel(f.fiscalYear)} 市町村別決算状況調」を`,
    '加工して作成。',
    '歳出総額 ÷ 住民基本台帳人口',
    '（令和7年1月1日）を',
    '市町村ごとに計算し、',
    '人口の規模ごとに',
    '中央値と、',
    '小さい方から25%・75%の値を',
    '求めました。',
    `${formatCount(f.national.n)}団体`,
    '（特別区を含み、',
    '政令指定都市の区は',
    '数えていません）。',
  ];
}

export const sourceText = (f: Finance): string => sourceParts(f).join('');

/** The national total spent divided by the national residents, for the note under the table. */
export function nationalText(f: Finance): string {
  return `全国の${formatCount(f.national.n)}団体の合計では、1人あたり約${formatThousandYen(f.national.perCapita)}千円です（歳出総額の合計 ÷ 住民基本台帳人口の合計）。`;
}

/** "5" of "5千", "10" of "10万": a population edge as a number with its unit. */
function edge(n: number): { num: string; unit: '千' | '万' } {
  return n < 10_000 ? { num: String(n / 1_000), unit: '千' } : { num: String(n / 10_000), unit: '万' };
}

/** 5千人未満 / 5千〜1万人 / 1〜3万人 / 10〜20万人 / 20万人以上: the lower edge drops its unit when the upper edge has the same one. */
export function bandLabel(b: Pick<FinanceBand, 'min' | 'max'>): string {
  if (b.min === 0) {
    const hi = edge(b.max ?? 0);
    return `${hi.num}${hi.unit}人未満`;
  }
  const lo = edge(b.min);
  if (b.max === null) return `${lo.num}${lo.unit}人以上`;
  const hi = edge(b.max);
  return `${lo.num}${lo.unit === hi.unit ? '' : lo.unit}〜${hi.num}${hi.unit}人`;
}

export type NoFigureReason = 'ward' | 'hamadori' | 'missing';

export interface OwnFigure {
  /** Thousand yen per resident, or undefined with the reason there is none. */
  value?: number;
  reason?: NoFigureReason;
  text: string;
  /** The text in phrases that stay whole on a line (「1人あたり」 is never split from its number). */
  parts: string[];
}

/** The town's own 令和6年度 figure, or the sentence saying why it has none. Wards of designated cities and the 浜通り area have no settlement of their own. */
export function ownFigure(f: Finance, code: string, kind: AreaKind): OwnFigure {
  const value = ownPerCapita(f, code);
  if (value !== undefined) {
    const parts = [`この町の${reiwaLabel(f.fiscalYear)}：`, `1人あたり約${formatThousandYen(value)}千円`];
    return { value, text: parts.join(''), parts };
  }
  const none = (reason: NoFigureReason, text: string): OwnFigure => ({ reason, text, parts: phrases(text) });
  if (kind === 'ward') return none('ward', 'この区は政令指定都市の一部で、区ごとの決算はありません。');
  if (kind === 'hamadori') return none('hamadori', 'この地域は複数の市町村をまとめたもので、地域としての決算はありません。');
  return none('missing', `この町の${reiwaLabel(f.fiscalYear)}の値は、このデータにありません。`);
}

/**
 * The residents used to pick the band: the projected population rounded to a whole person, which is the number the
 * panel prints for any town under 1万人 (formatPop). NaN or a negative number picks nothing.
 */
export function bandPopulation(population: number): number | undefined {
  return Number.isFinite(population) && population >= 0 ? Math.round(population) : undefined;
}

/** The band for a projected population (index into finance.bands), or undefined when the population is not a number. */
export function bandFor(f: Finance, population: number): number | undefined {
  const p = bandPopulation(population);
  return p === undefined ? undefined : bandIndexFor(f.bands, p);
}

/** The year line in phrases (the panel adds the mark for the year after it: 試算, 公式推計 or 実績（国勢調査）). */
export function yearParts(year: number, population: number): [string, string, string] {
  return ['規模は、', `${year}年の人口 ${formatPop(Math.round(population))}`, 'で選んでいます。'];
}

/** 「いま、人口が1〜3万人の市町村（447団体）：中央値 約724千円、真ん中の半数が561〜883千円。」 in phrases that stay whole on a line. */
export function bandParts(b: FinanceBand): string[] {
  return [
    'いま、',
    `人口が${bandLabel(b)}の市町村（${formatCount(b.n)}団体）：`,
    `中央値 約${formatThousandYen(b.median)}千円、`,
    `真ん中の半数が${formatThousandYen(b.p25)}〜${formatThousandYen(b.p75)}千円。`,
  ];
}

export interface BarRow {
  label: string;
  median: number;
  /** Bar length as a percentage of the longest median. */
  widthPct: number;
}

/** The seven bars: length proportional to the median, the longest (smallest towns) full. */
export function barRows(f: Finance): BarRow[] {
  const longest = Math.max(...f.bands.map((b) => b.median));
  return f.bands.map((b) => ({ label: bandLabel(b), median: b.median, widthPct: (b.median / longest) * 100 }));
}
