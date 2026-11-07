// The four numbers of a town, above the board: the population of the year on screen, the change since 2020, the share
// aged 65 and over, and the support ratio (people aged 15-64 per person aged 65+). They are the first four tiles of the
// town panel, which is folded away on the first screen; the numbers come from the same functions (deriveTotals,
// ageShares, deriveSupport) and are formatted the same way, so the two never disagree.
//
// Shown for a town only (the headline over the map already carries the country's and a prefecture's population and
// change). Pure part first; `mountPlaceFacts` is the DOM.
import type { Groups, Series } from '../engine/types';
import { deriveSupport, deriveTotals, ratioAt, yearIndex } from './derive';
import { formatPct, formatPop, formatSupport } from './format';
import { levelOf } from './nav';
import { badgeFor } from './sources';
import type { AppState, PanelContext } from './state';
import { SUPPORT_LABEL } from './support';
import { ageShares, splitUnit } from './townPanel';
import './placeFacts.css';

export interface PlaceFact {
  label: string;
  /** 「4.2万人」 / 「−38.5%」 / 「44.1%」 / 「0.9人」 */
  value: string;
}

export interface PlaceFacts {
  name: string;
  year: number;
  /** After 2050: this app's estimate. */
  estimate: boolean;
  /** 「試算」 / 「公式推計」 / 「実績（国勢調査）」 */
  badge: string;
  facts: [PlaceFact, PlaceFact, PlaceFact, PlaceFact];
}

export const FACT_ELDERLY = '65歳以上の割合';
export const FACT_CHANGE = '2020年比';

/** A share as the town panel prints it: 44.1%; 「－」 when there is none. */
export function shareText(share: number): string {
  return Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : '－';
}

/**
 * The four facts of area `code` in `year` under `series`, or undefined when the area has no series. The population and
 * the change read the same totals the map colours by; the share and the ratio read the year's age classes.
 */
export function placeFacts(series: Map<string, Series>, groups: Groups, code: string, name: string, year: number): PlaceFacts | undefined {
  const totals = deriveTotals(series, groups);
  const row = totals.area.get(code);
  const i = yearIndex(totals.years, year);
  const pop = series.get(code)?.[year];
  if (!row || i < 0 || !pop) return undefined;
  const supports = deriveSupport(series, groups);
  const b = badgeFor(year);
  return {
    name,
    year,
    estimate: b.estimate,
    badge: b.text,
    facts: [
      { label: `${year}年の人口`, value: formatPop(row[i]) },
      { label: FACT_CHANGE, value: formatPct(ratioAt(row, i)) },
      { label: FACT_ELDERLY, value: shareText(ageShares(pop).elderly) },
      { label: SUPPORT_LABEL, value: formatSupport(supports.area.get(code)?.[i] ?? NaN) },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

const mounted = new WeakMap<HTMLElement, () => void>();

/**
 * Fill `el` (the #panel-facts section with its h2.panel-title) with the four tiles (two by two: the label over the
 * number, whose unit is a smaller span, as the town panel's tiles print it; the tile's text is still 「4.2万人」) and
 * keep them in step with the store: the section is hidden unless a town is selected. Returns the teardown.
 */
export function mountPlaceFacts(el: HTMLElement, ctx: PanelContext): () => void {
  mounted.get(el)?.();
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a] as const));
  const title = el.querySelector<HTMLElement>('.panel-title');
  const nameEl = document.createElement('span');
  nameEl.className = 'place-facts-name';
  const badge = document.createElement('span');
  title?.replaceChildren(nameEl, ' ', badge);

  const list = document.createElement('dl');
  list.className = 'place-facts-list';
  const rows = [0, 1, 2, 3].map(() => {
    const row = document.createElement('div');
    row.className = 'place-fact';
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    const num = document.createElement('span');
    num.className = 'place-fact-num';
    const unit = document.createElement('span');
    unit.className = 'place-fact-unit';
    dd.append(num, unit);
    row.append(dt, dd);
    list.append(row);
    return { dt, dd, num, unit };
  });
  el.append(list);

  function render(s: AppState): void {
    const code = levelOf(s) === 'area' ? s.selectedArea : undefined;
    const area = code ? areaByCode.get(code) : undefined;
    const f = area ? placeFacts(s.series, data.groups, area.code, area.name, s.year) : undefined;
    if (!f) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    nameEl.textContent = f.name;
    badge.className = f.estimate ? 'badge-estimate' : 'badge-official';
    badge.textContent = f.badge;
    f.facts.forEach((fact, i) => {
      const r = rows[i];
      if (r.dt.textContent !== fact.label) r.dt.textContent = fact.label;
      if (r.dd.textContent !== fact.value) {
        const [value, unit] = splitUnit(fact.value);
        r.num.textContent = value;
        r.unit.textContent = unit;
      }
    });
  }

  render(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.selectedArea !== prev.selectedArea || s.year !== prev.year || s.series !== prev.series) render(s);
  });

  const teardown = () => {
    if (mounted.get(el) === teardown) mounted.delete(el);
    unsubscribe();
    list.remove();
    el.hidden = true;
  };
  mounted.set(el, teardown);
  return teardown;
}
