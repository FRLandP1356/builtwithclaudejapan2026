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
export const OFFICIAL_BADGE = '公式推計';

export interface SourceLine {
  label: string;
  text: string;
}

export const SOURCES: readonly SourceLine[] = [
  {
    label: '人口',
    text: '国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」を加工して作成',
  },
  {
    label: '境界',
    text: '国土交通省「国土数値情報（行政区域データ）」を加工して作成（簡略化した表示用の図形で、国が作成した地図ではありません）',
  },
  {
    label: '施設の目安',
    text: '国土交通省「サービス施設の立地する確率が50%・80%となる自治体の人口規模（三大都市圏を除く）」（2009〜2012年の統計）',
  },
];

export const FOOT_NOTE =
  '2050年より後の数字は、このアプリが前提を置いて計算した試算です。何を残すかを勧めるものではなく、決めるための事実を見せます。';
