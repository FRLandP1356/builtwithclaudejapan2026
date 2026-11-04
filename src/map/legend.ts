// Always-visible legend for the map colour: a sampled gradient bar with labelled ticks at the halvings.
import { legendRamp, legendStops } from './colors';

export function mountLegend(el: HTMLElement): void {
  el.className = 'legend';
  el.setAttribute('role', 'img');
  const stops = legendStops();
  const labelled = stops.filter((s) => s.label);
  el.setAttribute('aria-label', `色は2020年の人口との比。左から ${labelled.map((s) => s.label).join('、')}。`);

  const title = document.createElement('div');
  title.className = 'legend-title';
  title.textContent = '色は2020年の人口との比（濃い赤ほど減り、青は増えた所）';

  const bar = document.createElement('div');
  bar.className = 'legend-bar';
  bar.style.background = `linear-gradient(to right, ${legendRamp()
    .map((s) => `${s.color} ${(s.offset * 100).toFixed(1)}%`)
    .join(', ')})`;

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
      t.dataset.row = '2'; // the growth end sits close to the neutral tick; drop its label a row
    }
    t.textContent = s.label;
    ticks.append(t);
  });

  el.replaceChildren(title, bar, ticks);
}
