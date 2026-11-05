// Always-visible legend for the map colour. Two modes: the ratio to 2020 (default) and, while a reallocation is
// drawn, the change in percent caused by it.
import { allocationLegendRamp, allocationLegendStops, legendRamp, legendStops, type LegendStop } from './colors';

export type LegendMode = { kind: 'ratio' } | { kind: 'allocation'; scale: number };

export interface Legend {
  setMode(mode: LegendMode): void;
  /** The mode currently shown. */
  mode(): LegendMode;
}

const RATIO_TITLE = '色は2020年の人口との比（濃い赤ほど減り、青は増えた所）';
const ALLOCATION_TITLE = '割り振りによる人口の変化（%）（赤は減り、青は増えた所）';

function render(el: HTMLElement, title: string, ramp: Array<{ offset: number; color: string }>, stops: LegendStop[], twoRowEnd: boolean): void {
  const labelled = stops.filter((s) => s.label);
  el.setAttribute('aria-label', `${title}。左から ${labelled.map((s) => s.label).join('、')}。`);

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
    if (i === 0) t.dataset.edge = 'start';
    else if (i === stops.length - 1) {
      t.dataset.edge = 'end';
      if (twoRowEnd) t.dataset.row = '2'; // the growth end sits close to the neutral tick; drop its label a row
    }
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
    if (mode.kind === 'ratio') render(el, RATIO_TITLE, legendRamp(), legendStops(), true);
    else render(el, ALLOCATION_TITLE, allocationLegendRamp(mode.scale), allocationLegendStops(mode.scale), false);
  }

  apply(current);
  return {
    setMode(mode) {
      if (mode.kind === current.kind && (mode.kind === 'ratio' || mode.scale === (current as { scale: number }).scale)) return;
      apply(mode);
    },
    mode: () => current,
  };
}
