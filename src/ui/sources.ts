// UI strings that name the data sources and the official/estimate boundary. Kept in one place so the README task
// can align the wording (Ruling 9) and later panels reuse the same sentences.
import { OFFICIAL_END_YEAR } from '../engine/scenarios';

export const APP_TITLE = '2100年の日本';
export const APP_LEAD =
  '日本、都道府県、町の順に、2100年までの人口を地図で見る。2050年までは社人研の公式推計、それより後はこのアプリの試算。';

export { OFFICIAL_END_YEAR };

/** Shown next to the year while year <= 2050. */
export const OFFICIAL_NOTE = '2050年までは社人研の公式推計';
/** Shown next to the year while year > 2050 (never say 予測). */
export const ESTIMATE_NOTE = '2050年より後は、このアプリの試算です（予測ではありません）';
/** Text of the small dashed badge that marks any estimated figure. */
export const ESTIMATE_BADGE = '試算';
/** 2025-2050: the IPSS official projection. */
export const OFFICIAL_BADGE = '公式推計';
/** 2020: the census base year, not a projection. */
export const CENSUS_BADGE = '実績（国勢調査）';
export const BASE_YEAR = 2020;

/** Badge text for a figure in `year`: census, official projection, or this app's estimate. */
export function badgeFor(year: number): { text: string; estimate: boolean } {
  if (year > OFFICIAL_END_YEAR) return { text: ESTIMATE_BADGE, estimate: true };
  if (year <= BASE_YEAR) return { text: CENSUS_BADGE, estimate: false };
  return { text: OFFICIAL_BADGE, estimate: false };
}

/**
 * Said next to 割り振り後 while an allocation is drawn for a year up to 2050: the number is no longer the official
 * figure (the 公式推計 mark would be wrong), it is this app's own calculation on top of it. After 2050 the 試算 mark
 * already says so, so there is no note.
 */
export function allocatedBasisNote(year: number): string | undefined {
  if (year > OFFICIAL_END_YEAR) return undefined;
  return year <= BASE_YEAR ? '国勢調査をもとにこのアプリが計算' : '公式推計をもとにこのアプリが計算';
}

export interface SourceLine {
  label: string;
  /** What the figure is and how this app processed it. */
  text: string;
  /** The page of the source, shown as a link whose visible text is the URL itself. */
  url: string;
  /** The day the page was read (JST), as in docs/sources.md. */
  retrieved: string;
  /** A line the provider asks to be kept with the data, shown last. */
  approval?: string;
}

/** The three sources, in the footer's order. URLs and retrieval dates are those of docs/sources.md (read 2026-11-05 JST). */
export const SOURCES: readonly SourceLine[] = [
  {
    label: '人口',
    text: '国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」を加工して作成（公共データ利用規約 第1.0版（PDL1.0））。社人研がこのアプリの内容を保証するものではありません',
    url: 'https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp',
    retrieved: '2026年11月5日',
  },
  {
    label: '境界',
    text: '国土交通省「国土数値情報（行政区域データ）」（2021年版）を加工して作成（簡略化と社人研の地域に合わせた結合。国が作成した地図ではありません）',
    url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2021.html',
    retrieved: '2026年11月5日',
    approval: '測量法に基づく国土地理院長承認（複製）R2JHf 450',
  },
  {
    label: '施設の目安',
    text: '国土交通省国土政策局「サービス施設の立地する確率が50%・80%となる自治体の人口規模（三大都市圏を除く）」（2009〜2012年の統計）を加工して作成（図の数値を施設ごとの人口の目安として転記）',
    url: 'https://www.mlit.go.jp/common/001042019.pdf',
    retrieved: '2026年11月5日',
  },
];

export const FOOT_NOTE =
  '2050年より後の数字は、このアプリが前提を置いて計算した試算です。何を残すかを勧めるものではなく、決めるための事実を見せます。';
