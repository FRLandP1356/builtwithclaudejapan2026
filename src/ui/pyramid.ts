// Population pyramid: 20 five-year age classes, males to the left, females to the right, one scale for both sides.
// `pyramidBars` and `pyramidScale` are pure; `mountPyramid` draws them as inline SVG with a data table beside it
// for anyone who cannot read the picture. Sex colours are the theme tokens (--pyramid-m, --pyramid-f) through CSS
// classes in src/ui/townPanel.css; the two halves are also told apart by side and by the direct labels 男 and 女.
import type { Pop } from '../engine/types';
import { formatPop } from './format';
import { formatAxisCount, niceScale, phraseNodes, svgEl, textWidth, type NiceScale } from './seriesChart';

export interface PyramidRow {
  age: string;
  male: number;
  female: number;
}

const WAVE = '〜'; // the wave dash used in the labels, as in the brief

/** 0〜4歳, 5〜9歳 ... 90〜94歳, 95歳以上. */
export const AGE_LABELS: readonly string[] = Array.from({ length: 20 }, (_, i) => (i < 19 ? `${i * 5}${WAVE}${i * 5 + 4}歳` : '95歳以上'));

/** Twenty rows ordered youngest to oldest. Male plus female over all rows equals the population total. */
export function pyramidBars(p: Pop): PyramidRow[] {
  if (p.M.length !== 20 || p.F.length !== 20) throw new RangeError(`pyramidBars: expected 20 age classes, got ${p.M.length} and ${p.F.length}`);
  return AGE_LABELS.map((age, i) => ({ age, male: p.M[i], female: p.F[i] }));
}

/** The axis of one half: 0 up to a clean number at or above `maxPerClass`, the largest value of either sex in any age class. */
export function pyramidScale(maxPerClass: number): NiceScale {
  return niceScale(maxPerClass, 3);
}

// ---------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------

export interface PyramidInput {
  pop: Pop;
  year: number;
  /**
   * The largest single age-class value (either sex) over ALL years for this place and scenario (Ruling 29). The axis is
   * the same for every year so that stepping through the years makes the bars shrink or grow. It must be at least the
   * largest value of `pop`; a smaller axis draws bars that run past the plot.
   */
  axisMax: number;
  /** Used in the accessible name: 「田辺市」. */
  place: string;
}

export interface PyramidView {
  update(input: PyramidInput): void;
  destroy(): void;
}

const W = 360;
const ROW = 13; // pitch of one age class
const BAR = 10; // bar thickness; the 3 units left over are the gap between bars
const TOP = 34;
const RIGHT = 24; // room for the last tick label, which is centred on the plot edge
const GAP = 1; // half of the 2-unit gap at the centre line
const LABEL_ROWS = new Set([0, 4, 8, 12, 16, 19]); // age labels at 0, 20, 40, 60, 80 and 95+
const PLOT_H = ROW * 20;
const H = TOP + PLOT_H + 24;
const LEFT = Math.ceil(Math.max(...AGE_LABELS.filter((_, i) => LABEL_ROWS.has(i)).map(textWidth))) + 12;
/** Width of one half of the plot in SVG units: a bar that reaches the axis maximum is this long. */
export const PYRAMID_HALF_WIDTH = (W - LEFT - RIGHT) / 2;

const num = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** A bar that grows from the centre line outwards; the outer end is rounded, the centre end is square. */
function barPath(side: 'm' | 'f', x0: number, y: number, w: number): string {
  if (!(w > 0.05)) return '';
  const r = Math.min(3, w, BAR / 2);
  if (side === 'm') {
    return `M${x0},${y}H${x0 - w + r}a${r},${r} 0 0 0 ${-r},${r}V${y + BAR - r}a${r},${r} 0 0 0 ${r},${r}H${x0}Z`;
  }
  return `M${x0},${y}H${x0 + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + BAR - r}a${r},${r} 0 0 1 ${-r},${r}H${x0}Z`;
}

export function mountPyramid(host: HTMLElement): PyramidView {
  const fig = document.createElement('figure');
  fig.className = 'chart-figure pyramid-figure';
  const svg = svgEl('svg', { class: 'chart pyramid-svg', viewBox: `0 0 ${W} ${H}`, role: 'img', focusable: 'false' });

  const half = PYRAMID_HALF_WIDTH;
  const cx = LEFT + half; // centre line
  const mx = cx - GAP; // male bars end here and grow left
  const fx = cx + GAP; // female bars start here and grow right

  // Direct labels: a swatch and the sex, with its total, over each half.
  const swatchM = svgEl('rect', { class: 'pyr-swatch pyr-m', x: LEFT, y: 6, width: 10, height: 10, rx: 2 });
  const swatchF = svgEl('rect', { class: 'pyr-swatch pyr-f', x: cx + 4, y: 6, width: 10, height: 10, rx: 2 });
  const nameM = svgEl('text', { class: 'chart-caption', x: LEFT + 15, y: 16, 'text-anchor': 'start' });
  const nameF = svgEl('text', { class: 'chart-caption', x: cx + 19, y: 16, 'text-anchor': 'start' });
  const axis = svgEl('g', { class: 'pyr-axis' });
  const centre = svgEl('line', { class: 'chart-grid pyr-centre', x1: cx, x2: cx, y1: TOP - 4, y2: TOP + PLOT_H });
  const labels = svgEl('g', { class: 'pyr-ages' });
  const rowsG = svgEl('g', { class: 'pyr-rows' });

  const rowEls = AGE_LABELS.map((_, i) => {
    const y = TOP + (19 - i) * ROW + (ROW - BAR) / 2; // oldest on top
    const hit = svgEl('rect', { class: 'pyr-hit', x: 0, y: TOP + (19 - i) * ROW, width: W, height: ROW });
    const tip = svgEl('title');
    hit.append(tip);
    const m = svgEl('path', { class: 'pyr-bar pyr-m' });
    const f = svgEl('path', { class: 'pyr-bar pyr-f' });
    rowsG.append(m, f, hit);
    if (LABEL_ROWS.has(i)) {
      labels.append(svgEl('text', { class: 'chart-tick', x: LEFT - 6, y: y + BAR - 1, 'text-anchor': 'end' }, AGE_LABELS[i]));
    }
    return { m, f, tip, y };
  });
  svg.append(axis, centre, labels, rowsG, swatchM, swatchF, nameM, nameF);

  const legend = document.createElement('p');
  legend.className = 'note pyramid-note';
  legend.replaceChildren(...phraseNodes('横軸は各年齢の人数（人）で、2020〜2100年を通じて同じ幅です。年を動かすと、人数の増減に応じて棒の長さが変わります。'));

  const details = document.createElement('details');
  details.className = 'chart-table';
  const sum = document.createElement('summary');
  sum.textContent = '年齢別の数字を表で見る';
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.className = 'data-table';
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th scope="col">年齢</th><th scope="col" class="num">男（人）</th><th scope="col" class="num">女（人）</th><th scope="col" class="num">計（人）</th></tr>';
  const body = document.createElement('tbody');
  const cells = AGE_LABELS.map((age) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = age;
    const m = document.createElement('td');
    const f = document.createElement('td');
    const t = document.createElement('td');
    m.className = f.className = t.className = 'num';
    tr.append(th, m, f, t);
    body.append(tr);
    return { m, f, t };
  });
  const foot = document.createElement('tfoot');
  const footTr = document.createElement('tr');
  const footTh = document.createElement('td');
  footTh.textContent = '合計';
  const footM = document.createElement('td');
  const footF = document.createElement('td');
  const footT = document.createElement('td');
  footM.className = footF.className = footT.className = 'num';
  footTr.append(footTh, footM, footF, footT);
  foot.append(footTr);
  table.append(caption, head, body, foot);
  wrap.append(table);
  details.append(sum, wrap);

  fig.append(svg, legend, details);
  host.append(fig);

  let lastMax = -1;

  function drawAxis(scale: NiceScale): void {
    const kids: SVGElement[] = [];
    const px = (v: number) => (v / scale.max) * half;
    for (const t of scale.ticks) {
      const label = formatAxisCount(t);
      if (t > 0) {
        kids.push(svgEl('line', { class: 'chart-grid', x1: mx - px(t), x2: mx - px(t), y1: TOP - 4, y2: TOP + PLOT_H }));
        kids.push(svgEl('line', { class: 'chart-grid', x1: fx + px(t), x2: fx + px(t), y1: TOP - 4, y2: TOP + PLOT_H }));
        kids.push(svgEl('text', { class: 'chart-tick', x: mx - px(t), y: TOP + PLOT_H + 16, 'text-anchor': 'middle' }, label));
      }
      kids.push(svgEl('text', { class: 'chart-tick', x: t === 0 ? cx : fx + px(t), y: TOP + PLOT_H + 16, 'text-anchor': 'middle' }, label));
    }
    kids.push(svgEl('text', { class: 'chart-unit', x: LEFT - 22, y: TOP + PLOT_H + 16, 'text-anchor': 'end' }, '人'));
    axis.replaceChildren(...kids);
  }

  return {
    update({ pop, year, place, axisMax }) {
      const bars = pyramidBars(pop);
      const scale = pyramidScale(axisMax);
      if (scale.max !== lastMax) {
        drawAxis(scale);
        lastMax = scale.max;
      }
      let totalM = 0;
      let totalF = 0;
      bars.forEach((b, i) => {
        const r = rowEls[i];
        const wm = (b.male / scale.max) * half;
        const wf = (b.female / scale.max) * half;
        r.m.setAttribute('d', barPath('m', mx, r.y, wm));
        r.f.setAttribute('d', barPath('f', fx, r.y, wf));
        r.m.setAttribute('data-w', wm.toFixed(3)); // the bar length in SVG units, also what the tests read
        r.f.setAttribute('data-w', wf.toFixed(3));
        r.tip.textContent = `${b.age}：男 ${num.format(Math.round(b.male))}人、女 ${num.format(Math.round(b.female))}人`;
        cells[i].m.textContent = num.format(Math.round(b.male));
        cells[i].f.textContent = num.format(Math.round(b.female));
        cells[i].t.textContent = num.format(Math.round(b.male + b.female));
        totalM += b.male;
        totalF += b.female;
      });
      nameM.textContent = `男 ${formatPop(totalM)}`;
      nameF.textContent = `女 ${formatPop(totalF)}`;
      footM.textContent = num.format(Math.round(totalM));
      footF.textContent = num.format(Math.round(totalF));
      footT.textContent = num.format(Math.round(totalM + totalF));
      const young = bars.slice(0, 3).reduce((s, b) => s + b.male + b.female, 0);
      const old = bars.slice(13).reduce((s, b) => s + b.male + b.female, 0);
      const all = totalM + totalF;
      const pct = (v: number) => (all > 0 ? `${((v / all) * 100).toFixed(1)}%` : '－');
      svg.setAttribute('aria-label', `${place}の${year}年の人口ピラミッド。男 ${formatPop(totalM)}、女 ${formatPop(totalF)}。0〜14歳が${pct(young)}、65歳以上が${pct(old)}。`);
      caption.textContent = `${place}の${year}年の年齢別人口`;
    },
    destroy() {
      fig.remove();
    },
  };
}
