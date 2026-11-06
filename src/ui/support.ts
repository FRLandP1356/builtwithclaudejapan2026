// Wording of the support ratio (高齢者1人を支える現役世代: people aged 15-64 per person aged 65+), shared by the town
// panel's tile and chart and by the map's colour mode, so every place says it the same way. No DOM here. The number
// itself is supportRatio in src/engine/aggregate.ts; deriveSupport in derive.ts computes it for every place and year.
import { formatSupport, formatSupportExact } from './format';
import type { SeriesChartSpec } from './seriesChart';
import type { MapMode } from './state';

/** The tile's label and the measure's name in sentences. */
export const SUPPORT_LABEL = '高齢者1人を支える現役世代';
/** The one line under the tile that says how the number is made. */
export const SUPPORT_DEFINITION = '15〜64歳の人数 ÷ 65歳以上の人数';

/** Under the ratio's data table: what the numbers are, and that up to 2050 they are this app's recomputation too. */
export const SUPPORT_TABLE_NOTE =
  '15〜64歳の人数を65歳以上の人数で割った値です。公式推計の列も、社人研の発表値ではなく、このアプリが公式の方法で計算し直した年齢別の人口から求めています。';

/** The ratio over the years, drawn by the population chart's view (same lines, legend, summary and table). */
export const SUPPORT_CHART: SeriesChartSpec = {
  kind: 'support',
  title: `${SUPPORT_LABEL}の推移`,
  format: formatSupport,
  cell: formatSupportExact,
  tableSummary: `${SUPPORT_LABEL}の推移の数字を表で見る`,
  columns: ['公式推計（人）', 'このアプリの試算（人）', '前提を変える前（人）'],
  tableNote: SUPPORT_TABLE_NOTE,
};

/** The segmented control above the map: its group label and the two buttons' text. */
export const MAP_MODE_GROUP = '地図の色';
export const MAP_MODE_LABELS: Readonly<Record<MapMode, string>> = {
  change: '人口の変化',
  support: '高齢者1人を支える人数',
};

/** 「2050年 高齢者1人を支える現役世代 1.4人」 for the headline, a tooltip and an area's label. */
export function supportLine(year: number, ratio: number): string {
  return `${year}年 ${SUPPORT_LABEL} ${formatSupport(ratio)}`;
}

/** 「2020年は2.1人」: the comparison under the tile, in the headline and in a tooltip. */
export function support2020Line(ratio2020: number): string {
  return `2020年は${formatSupport(ratio2020)}`;
}
