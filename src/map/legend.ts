// Always-visible legend for the map colour. Three modes: the ratio to 2020 (default; eight classes of one indigo, paler
// = fewer people remain), the support ratio (people aged 15-64 per person aged 65+, six classes, closer to black = fewer)
// and, while a reallocation is drawn, the change in percent caused by it (the diverging rust / blue scale).
// The two sequential scales run in opposite directions, so the title that says which way sits right under the map, in
// the body size (app.css .legend-title).
import {
  allocationLegendRamp,
  allocationLegendStops,
  legendRamp,
  legendStops,
  supportClassNames,
  supportLegendRamp,
  supportLegendStops,
  type LegendStop,
} from './colors';

export type LegendMode = { kind: 'ratio' } | { kind: 'support' } | { kind: 'allocation'; scale: number };

export interface Legend {
  setMode(mode: LegendMode): void;
  /** The mode currently shown. */
  mode(): LegendMode;
}

export const RATIO_TITLE = '色は2020年の人口に対して、どれだけ残るか（薄いほど少ない）';
const ALLOCATION_TITLE = '割り振りによる人口の変化（%）（赤は減り、青は増えた所）';
export const SUPPORT_TITLE = '色は高齢者1人を支える人数（黒に近いほど少なく、大変）';

interface RenderOptions {
  /** The first and last ticks sit on the bar's ends (aligned inward); off for ticks that all sit between classes. */
  edges: boolean;
  /** Drop the last label a row (the end label of the ratio legend, 増えた所は一番濃い, is wider than its block). */
  twoRowEnd: boolean;
  /** What the label reads after the title; by default the tick labels from left to right. */
  spoken?: string[];
}

function render(el: HTMLElement, title: string, ramp: Array<{ offset: number; color: string }>, stops: LegendStop[], opts: RenderOptions): void {
  const spoken = opts.spoken ?? stops.filter((s) => s.label).map((s) => s.label);
  el.setAttribute('aria-label', `${title}。左から ${spoken.join('、')}。`);

  const titleEl = document.createElement('div');
  titleEl.className = 'legend-title';
  titleEl.textContent = title;

  const bar = document.createElement('div');
  bar.className = 'legend-bar';
  bar.style.background = `linear-gradient(to right, ${ramp.map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`).join(', ')})`;

  const ticks = document.createElement('div');
  ticks.className = 'legend-ticks';
  ticks.setAttribute('aria-hidden', 'true');
  stops.forEach((s, i) => {
    const t = document.createElement('span');
    t.className = 'legend-tick';
    t.style.left = `${(s.offset * 100).toFixed(2)}%`;
    if (opts.edges && i === 0) t.dataset.edge = 'start';
    else if (opts.edges && i === stops.length - 1) {
      t.dataset.edge = 'end';
      if (opts.twoRowEnd) t.dataset.row = '2'; // the end label is wider than its block; drop it a row
    }
    if (s.row === 2) t.dataset.row = '2'; // a stop may ask for the second row itself (colors.ts legendStops)
    t.textContent = s.label;
    ticks.append(t);
  });

  el.replaceChildren(titleEl, bar, ticks);
}

export function mountLegend(el: HTMLElement): Legend {
  el.className = 'legend';
  el.setAttribute('role', 'img');
  let current: LegendMode = { kind: 'ratio' };

  function apply(mode: LegendMode): void {
    current = mode;
    el.dataset.mode = mode.kind;
    if (mode.kind === 'ratio') render(el, RATIO_TITLE, legendRamp(), legendStops(), { edges: true, twoRowEnd: true });
    else if (mode.kind === 'support') render(el, SUPPORT_TITLE, supportLegendRamp(), supportLegendStops(), { edges: false, twoRowEnd: false, spoken: supportClassNames() });
    else render(el, ALLOCATION_TITLE, allocationLegendRamp(mode.scale), allocationLegendStops(mode.scale), { edges: true, twoRowEnd: false });
  }

  apply(current);
  return {
    setMode(mode) {
      if (mode.kind === current.kind && (mode.kind !== 'allocation' || mode.scale === (current as { scale: number }).scale)) return;
      apply(mode);
    },
    mode: () => current,
  };
}
