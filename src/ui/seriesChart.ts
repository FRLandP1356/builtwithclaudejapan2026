// The population line chart of the town panel: the official line (solid, 2020 census to 2050), this app's estimate
// (dashed, 2050 to 2100) and, when the scenario differs from the default, the default estimate as a dotted reference.
// Pure builders (seriesPoints, niceScale, formatAxisCount, seriesSummary) are separate from the SVG view so they can be
// tested without a DOM. Colours come from the theme tokens through CSS classes (src/ui/townPanel.css); nothing here
// writes a raw colour.
import { formatPop } from './format';
import { phraseNodes } from './phrases';
import { OFFICIAL_END_YEAR } from './sources';

// ---------------------------------------------------------------------------------------------------------------
// Axis helpers shared with the pyramid
// ---------------------------------------------------------------------------------------------------------------

export interface NiceScale {
  step: number;
  /** Top of the axis: the last tick. At least the value asked for. */
  max: number;
  /** 0, step, 2 step ... max. */
  ticks: number[];
}

/** An axis from 0 with at most `maxIntervals` steps of 1, 2, 2.5 or 5 times a power of ten that covers `maxValue`. */
export function niceScale(maxValue: number, maxIntervals: number): NiceScale {
  const m = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 1;
  const k = Math.max(1, Math.floor(maxIntervals));
  let pow = 10 ** Math.floor(Math.log10(m / k));
  for (let guard = 0; guard < 60; guard++, pow *= 10) {
    for (const mult of [1, 2, 2.5, 5]) {
      const step = mult * pow;
      const n = Math.ceil(m / step - 1e-9);
      if (n <= k) {
        const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
        return { step, max: ticks[n], ticks };
      }
    }
  }
  return { step: m, max: m, ticks: [0, m] };
}

const axisNumber = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 });

/** Axis tick text: 500 / 1,500 under 10,000, then 1万 / 2.5万 / 5,000万, then 1.2億. The unit (人) is named once, outside. */
export function formatAxisCount(n: number): string {
  if (!Number.isFinite(n)) return '－';
  const a = Math.abs(n);
  if (a >= 1e8) return `${axisNumber.format(n / 1e8)}億`;
  if (a >= 1e4) return `${axisNumber.format(n / 1e4)}万`;
  return axisNumber.format(n);
}

/** Rough text width in SVG user units at 12px: wide (CJK) characters count 12, narrow ones 6.6. */
export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 12 : 6.6;
  return w;
}

const exact = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  text?: string,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------------------------------------------
// Data for the chart
// ---------------------------------------------------------------------------------------------------------------

export interface Point {
  year: number;
  value: number;
}

export interface SeriesPointsInput {
  /** 2020, 2025 ... 2100. */
  years: readonly number[];
  /** The 2020 census total and the official totals for 2025..2050. */
  official: Readonly<Record<number, number>>;
  /** This app's totals under the current scenario, one per year (unrounded). */
  estimate: ArrayLike<number>;
  /** This app's totals under the default scenario; kept only when it differs from `estimate`. */
  baseline?: ArrayLike<number> | null;
  /** The selected year (the marker). */
  year: number;
}

export interface SeriesMarker {
  year: number;
  value: number;
  /** Which line the marker sits on: the official line up to 2050, the estimate after. */
  line: 'official' | 'estimate';
}

export interface SeriesPoints {
  /** 2020..2050. */
  official: Point[];
  /** 2050..2100. Starts at the 2050 estimate so the dashed part joins the solid part. */
  estimate: Point[];
  /** 2050..2100, only when the scenario changes the estimate. */
  baseline: Point[] | null;
  marker: SeriesMarker;
  /** Top of the y axis (the axis starts at 0). */
  yMax: number;
  ticks: number[];
}

export function seriesPoints(input: SeriesPointsInput): SeriesPoints {
  const { years, official, estimate, baseline, year } = input;
  if (estimate.length !== years.length) throw new RangeError(`seriesPoints: estimate has ${estimate.length} values for ${years.length} years`);
  if (baseline && baseline.length !== years.length) throw new RangeError(`seriesPoints: baseline has ${baseline.length} values for ${years.length} years`);

  const officialPts: Point[] = [];
  const estimatePts: Point[] = [];
  const baselinePts: Point[] = [];
  let differs = false; // the reference line is data-based: it stays only while the numbers differ from the estimate
  years.forEach((y, i) => {
    if (y <= OFFICIAL_END_YEAR && official[y] !== undefined) officialPts.push({ year: y, value: official[y] });
    if (y >= OFFICIAL_END_YEAR) {
      estimatePts.push({ year: y, value: estimate[i] });
      if (baseline) {
        baselinePts.push({ year: y, value: baseline[i] });
        if (Math.abs(baseline[i] - estimate[i]) > 1e-6 * Math.max(1, Math.abs(estimate[i]))) differs = true;
      }
    }
  });

  const idx = years.indexOf(year);
  if (idx < 0) throw new RangeError(`seriesPoints: year ${year} is not in the series`);
  const onOfficial = year <= OFFICIAL_END_YEAR && official[year] !== undefined;
  const marker: SeriesMarker = onOfficial
    ? { year, value: official[year], line: 'official' }
    : { year, value: estimate[idx], line: 'estimate' };

  const all = [...officialPts, ...estimatePts, ...(differs ? baselinePts : [])].map((p) => p.value).filter(Number.isFinite);
  const scale = niceScale(Math.max(0, ...all) * 1.15, 4); // headroom keeps the highest point and its label clear of the captions
  return {
    official: officialPts,
    estimate: estimatePts,
    baseline: differs ? baselinePts : null,
    marker,
    yMax: scale.max,
    ticks: scale.ticks,
  };
}

/** The three figures that carry the whole line: 2020 (census), 2050 (official) and 2100 (this app's estimate). */
export function seriesSummaryParts(p: SeriesPoints): string[] {
  const first = p.official[0];
  const last = p.official[p.official.length - 1];
  const end = p.estimate[p.estimate.length - 1];
  if (!first || !last || !end) return [];
  return [
    `${first.year}年 ${formatPop(first.value)}（国勢調査）`,
    `${last.year}年 ${formatPop(last.value)}（公式推計）`,
    `${end.year}年 ${formatPop(end.value)}（このアプリの試算）`,
  ];
}

/** One sentence that carries the whole line for a screen reader (and for anyone who skips the picture). */
export function seriesSummary(p: SeriesPoints): string {
  return seriesSummaryParts(p).join('、');
}

// ---------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------

export interface SeriesChartView {
  /** Draw the lines, the legend, the summary and the table. Also places the marker from `points.marker`. */
  setData(points: SeriesPoints, place: string): void;
  /** Move the marker only (the year changed; the lines did not). */
  setMarker(marker: SeriesMarker): void;
  destroy(): void;
}

/** Under the data table: the 公式推計 column is the published figure; this app's own numbers are recomputed from the published assumptions. */
export const TABLE_NOTE =
  '公式推計の列は、社人研が発表した値です。このアプリは、公表された仮定から公式の方法で計算し直しています。そのため、2050年までの地図や町の数字は、発表値と数人違うことがあります。';

const W = 360;
const H = 232;
const TOP = 32;
const BOTTOM = 46;
const RIGHT = 74;
const X_TICKS = [2020, 2040, 2060, 2080, 2100];
/** The chart's frame in SVG units: the plot runs from `top` down to `height - bottom`, which is where the 0 gridline sits. */
export const SERIES_VIEW = { width: W, height: H, top: TOP, bottom: BOTTOM } as const;
const FIRST_YEAR = 2020;
const LAST_YEAR = 2100;

export function mountSeriesChart(host: HTMLElement): SeriesChartView {
  const fig = document.createElement('figure');
  fig.className = 'chart-figure series-figure';
  const svg = svgEl('svg', { class: 'chart series-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', focusable: 'false' });
  const legend = document.createElement('ul');
  legend.className = 'chart-legend';
  const keyOfficial = legendItem('key-official', '公式推計（2050年まで）');
  const keyEstimate = legendItem('key-estimate', 'このアプリの試算（2050年より後）');
  const keyBaseline = legendItem('key-baseline', '前提を変える前の試算');
  legend.append(keyOfficial, keyEstimate);
  const summary = document.createElement('p');
  summary.className = 'chart-summary';
  const details = document.createElement('details');
  details.className = 'chart-table';
  const sum = document.createElement('summary');
  sum.textContent = '人口の推移の数字を表で見る';
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'data-table';
  wrap.append(table);
  const tableNote = document.createElement('p');
  tableNote.className = 'note chart-table-note';
  tableNote.replaceChildren(...phraseNodes(TABLE_NOTE));
  details.append(sum, wrap, tableNote);
  fig.append(svg, legend, summary, details);
  host.append(fig);

  let plot = { x: (_year: number) => 0, y: (_v: number) => 0 };
  let markerEls: { line: SVGLineElement; dot: SVGCircleElement; label: SVGTextElement } | undefined;

  function legendItem(cls: string, text: string): HTMLLIElement {
    const li = document.createElement('li');
    const key = document.createElement('span');
    key.className = `chart-key ${cls}`;
    key.setAttribute('aria-hidden', 'true');
    li.append(key, document.createTextNode(text));
    return li;
  }

  function setData(points: SeriesPoints, place: string): void {
    const labels = points.ticks.map(formatAxisCount);
    const left = Math.max(34, Math.ceil(Math.max(...labels.map(textWidth)) + 12));
    const right = W - RIGHT;
    const plotH = H - TOP - BOTTOM;
    const x = (year: number) => left + ((year - FIRST_YEAR) / (LAST_YEAR - FIRST_YEAR)) * (right - left);
    const y = (v: number) => TOP + (1 - v / points.yMax) * plotH;
    plot = { x, y };

    const kids: SVGElement[] = [];
    // Horizontal grid and the y axis labels (people).
    points.ticks.forEach((t, i) => {
      kids.push(svgEl('line', { class: 'chart-grid', x1: left, x2: right, y1: y(t), y2: y(t) }));
      kids.push(svgEl('text', { class: 'chart-tick', x: left - 6, y: y(t) + 4, 'text-anchor': 'end' }, labels[i]));
    });
    kids.push(svgEl('text', { class: 'chart-unit', x: 2, y: TOP - 12, 'text-anchor': 'start' }, '人'));
    // X axis labels.
    for (const t of X_TICKS) kids.push(svgEl('text', { class: 'chart-tick', x: x(t), y: TOP + plotH + 18, 'text-anchor': 'middle' }, `${t}年`));
    // The 2050 border between official and estimate, with the two captions above it.
    const bx = x(OFFICIAL_END_YEAR);
    kids.push(svgEl('line', { class: 'chart-border', x1: bx, x2: bx, y1: TOP - 20, y2: TOP + plotH }));
    kids.push(svgEl('text', { class: 'chart-caption', x: bx - 6, y: TOP - 12, 'text-anchor': 'end' }, '公式推計'));
    kids.push(svgEl('text', { class: 'chart-caption', x: bx + 6, y: TOP - 12, 'text-anchor': 'start' }, 'このアプリの試算'));

    const path = (pts: Point[]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.year).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    if (points.baseline) kids.push(svgEl('path', { class: 'line line-baseline', d: path(points.baseline) }));
    kids.push(svgEl('path', { class: 'line line-estimate', d: path(points.estimate) }));
    kids.push(svgEl('path', { class: 'line line-official', d: path(points.official) }));

    // Selected-year marker (placed by setMarker).
    const mLine = svgEl('line', { class: 'chart-marker', y1: TOP, y2: TOP + plotH });
    kids.push(mLine);

    // End dots and end labels; the two labels at the right edge are kept 14 units apart.
    const dot = (p: Point, cls: string) => svgEl('circle', { class: `dot ${cls}`, cx: x(p.year), cy: y(p.value), r: 5 });
    const firstO = points.official[0];
    const lastO = points.official[points.official.length - 1];
    const endE = points.estimate[points.estimate.length - 1];
    const endB = points.baseline?.[points.baseline.length - 1];
    if (firstO) kids.push(dot(firstO, 'dot-official'));
    if (lastO) kids.push(dot(lastO, 'dot-official'));
    if (endB) kids.push(dot(endB, 'dot-baseline'));
    if (endE) kids.push(dot(endE, 'dot-estimate'));
    const ends = [endE && { p: endE, cls: 'end-estimate' }, endB && { p: endB, cls: 'end-baseline' }]
      .filter((e): e is { p: Point; cls: string } => Boolean(e))
      .map((e) => ({ ...e, ty: y(e.p.value) + 4 }))
      .sort((a, b) => a.ty - b.ty);
    if (ends.length === 2 && ends[1].ty - ends[0].ty < 14) {
      const push = (14 - (ends[1].ty - ends[0].ty)) / 2;
      ends[0].ty -= push;
      ends[1].ty += push;
    }
    for (const e of ends) kids.push(svgEl('text', { class: `chart-end ${e.cls}`, x: right + 8, y: e.ty, 'text-anchor': 'start' }, formatPop(e.p.value)));
    if (firstO) kids.push(svgEl('text', { class: 'chart-end', x: x(firstO.year) + 8, y: y(firstO.value) - 10, 'text-anchor': 'start' }, formatPop(firstO.value)));

    // Marker dot and label go last so they sit on top.
    const mDot = svgEl('circle', { class: 'dot dot-marker', r: 6 });
    const mLabel = svgEl('text', { class: 'chart-marker-label', y: TOP + plotH + 38, 'text-anchor': 'middle' });
    kids.push(mDot, mLabel);

    svg.replaceChildren(...kids);
    markerEls = { line: mLine, dot: mDot, label: mLabel };

    const text = seriesSummary(points);
    svg.setAttribute('aria-label', `${place}の人口の推移。${text}`);
    summary.replaceChildren(...phraseNodes(seriesSummaryParts(points).map((part, i, all) => (i < all.length - 1 ? `${part}、` : part))));
    legend.replaceChildren(keyOfficial, keyEstimate, ...(points.baseline ? [keyBaseline] : []));
    renderTable(points, place);
    setMarker(points.marker);
  }

  function setMarker(m: SeriesMarker): void {
    if (!markerEls) return;
    const mx = plot.x(m.year);
    markerEls.line.setAttribute('x1', String(mx));
    markerEls.line.setAttribute('x2', String(mx));
    markerEls.dot.setAttribute('cx', String(mx));
    markerEls.dot.setAttribute('cy', String(plot.y(m.value)));
    markerEls.dot.setAttribute('class', `dot dot-marker ${m.line === 'official' ? 'dot-official' : 'dot-estimate'}`);
    markerEls.label.setAttribute('x', String(Math.min(Math.max(mx, 30), W - 30)));
    // The axis already prints this year when it is a tick (2100年 under the marker): say it once.
    markerEls.label.textContent = X_TICKS.includes(m.year) ? '' : `${m.year}年`;
  }

  function renderTable(points: SeriesPoints, place: string): void {
    const byYear = (pts: Point[] | null) => new Map((pts ?? []).map((p) => [p.year, p.value]));
    const o = byYear(points.official);
    const e = byYear(points.estimate);
    const b = byYear(points.baseline);
    const cell = (v: number | undefined) => {
      const td = document.createElement('td');
      td.className = 'num';
      td.textContent = v === undefined ? '－' : exact.format(Math.round(v));
      return td;
    };
    const caption = document.createElement('caption');
    caption.className = 'sr-only';
    caption.textContent = `${place}の人口の推移`;
    const head = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const [text, num] of [['年', false], ['公式推計（人）', true], ['このアプリの試算（人）', true], ...(points.baseline ? [['前提を変える前（人）', true] as const] : [])] as const) {
      const th = document.createElement('th');
      th.scope = 'col';
      if (num) th.className = 'num';
      th.textContent = text;
      hr.append(th);
    }
    head.append(hr);
    const body = document.createElement('tbody');
    const years = [...new Set([...o.keys(), ...e.keys()])].sort((a, c) => a - c);
    for (const yr of years) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = `${yr}年`;
      tr.append(th, cell(o.get(yr)), cell(e.get(yr)));
      if (points.baseline) tr.append(cell(b.get(yr)));
      body.append(tr);
    }
    table.replaceChildren(caption, head, body);
  }

  return {
    setData,
    setMarker,
    destroy() {
      fig.remove();
      markerEls = undefined;
    },
  };
}
