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
  text: string;
}

export const SOURCES: readonly SourceLine[] = [
  {
    label: '人口',
    text: '国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」を加工して作成（公共データ利用規約 第1.0版（PDL1.0））',
  },
  {
    label: '境界',
    text: '国土交通省「国土数値情報（行政区域データ）」（2021年版）を加工して作成（簡略化と社人研の地域に合わせた結合。国が作成した地図ではありません）。測量法に基づく国土地理院長承認（複製）R2JHf 450',
  },
  {
    label: '施設の目安',
    text: '国土交通省「サービス施設の立地する確率が50%・80%となる自治体の人口規模（三大都市圏を除く）」（2009〜2012年の統計）',
  },
];

export const FOOT_NOTE =
  '2050年より後の数字は、このアプリが前提を置いて計算した試算です。何を残すかを勧めるものではなく、決めるための事実を見せます。';
