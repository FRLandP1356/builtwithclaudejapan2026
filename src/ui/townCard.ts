// The fourth screen, 「あなたの町」: one heading made from the town's own numbers (its 2100 population and the earliest
// facility to fall below its guide, from the same crossings as the board) and one card under the search: the town's
// population from 2020 to 2100 as a line, and three facilities of daily life (a clinic, a post office, a bank) with the
// year each falls below its guide. A town is the only place the card is for; with the country or a prefecture on screen
// the heading is a question or the prefecture's sentence and only the search shows. The rest of the town (ages, the
// support ratio, every facility, spending) is the folded 「町の詳細」 under the sixth screen.
//
// Built once; a new place or new assumptions redraw it, a new year only moves the chart's marker. The 2100 figure is
// always this app's estimate, so the heading carries the 試算 mark whenever it states one.
import { boardCrossings, type NameLookup } from './board';
import { total } from '../engine/aggregate';
import type { Facility } from '../engine/types';
import { deriveTotals } from './derive';
import { evaluateFacilities } from './facilityPanel';
import { levelOf } from './nav';
import { phraseNodes, withTail } from './phrases';
import { boardFirstRow, townHeadline } from './screens';
import { mountSeriesChart, seriesPoints, type SeriesChartView, type SeriesPointsInput } from './seriesChart';
import { badgeFor, ESTIMATE_BADGE } from './sources';
import type { AppState, PanelContext } from './state';
import { resolveScope } from './townPanel';

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The three facilities of daily life the card lists, by id (the names printed are the data's: Ruling 16, never typed here). */
export const CARD_FACILITY_IDS: readonly string[] = ['clinic', 'post_office', 'bank'];

export const CARD_FACILITIES_LEAD = '主な施設が人口の目安を下回る年';
export const CARD_ALREADY = '2020年の時点で、すでに目安を下回る';
export const CARD_NEVER = '2100年まで目安を下回らない';
export const cardWhen = (year: number): string => `${year}年に目安を下回る`;

const mounted = new WeakMap<HTMLElement, () => void>();

/**
 * Fill the section of the fourth screen `el`: it holds `h2.screen-title` (rewritten here) and `.town-card-slot` (the card
 * goes in it). Returns the teardown.
 */
export function mountTownCard(el: HTMLElement, ctx: PanelContext): () => void {
  mounted.get(el)?.();
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a] as const));
  const names: NameLookup = { area: (c) => areaByCode.get(c)?.name, prefOfArea: (c) => areaByCode.get(c)?.prefName };
  const title = el.querySelector<HTMLElement>('.screen-title')!;
  const slot = el.querySelector<HTMLElement>('.town-card-slot')!;

  const card = h('div', 'screen-card town-card');
  card.hidden = true;
  const chartHost = h('div', 'town-card-chart');
  const facilities = h('div', 'town-card-facilities');
  const facilitiesLead = h('p', 'town-card-facilities-lead', CARD_FACILITIES_LEAD);
  facilitiesLead.id = 'town-card-facilities-lead';
  const list = h('ul', 'town-card-list');
  list.setAttribute('aria-labelledby', facilitiesLead.id);
  /** How many of the facility kinds `pop` is below the guide of (the same count the town panel's summary gives). */
  const kindsBelow = (pop: number) => {
    const e = evaluateFacilities(pop, data.facilities);
    return { below: e.belowCount, total: e.total };
  };
  const cardFacilities: Facility[] = CARD_FACILITY_IDS.flatMap((id) => data.facilities.filter((x) => x.id === id));
  const rows = cardFacilities.map((f) => {
    const li = h('li', 'town-card-row');
    li.dataset.facility = f.id;
    const name = h('span', 'town-card-name', f.name);
    const when = h('span', 'town-card-when');
    li.append(name, when);
    list.append(li);
    return { id: f.id, when };
  });
  facilities.append(facilitiesLead, list);
  card.append(chartHost, facilities);
  slot.append(card);

  const chart: SeriesChartView = mountSeriesChart(chartHost);
  let input: Omit<SeriesPointsInput, 'year'> | undefined;

  /** The official totals (2020 census and 2025-2050) of the town, for the solid part of the line. */
  function officialOf(code: string): Record<number, number> {
    const a = areaByCode.get(code);
    const out: Record<number, number> = {};
    if (!a) return out;
    out[2020] = total(a.base);
    for (const [y, v] of Object.entries(a.official)) out[Number(y)] = v;
    return out;
  }

  function renderHeading(s: AppState): void {
    const totals = deriveTotals(s.series, data.groups);
    const scope = resolveScope(data, s, areaByCode);
    const level = levelOf(s);
    const row = scope.level === 'area' ? totals.area.get(scope.key) : scope.level === 'pref' ? totals.pref.get(scope.key) : totals.japan;
    const pop2100 = row ? row[totals.years.indexOf(2100)] : NaN;
    const first = boardFirstRow(data, totals, s.series, scope, names);
    const kinds = level === 'area' && Number.isFinite(pop2100) ? kindsBelow(pop2100) : undefined;
    const tail: Array<Node | string> = level !== 'japan' ? [' ', h('span', 'badge-estimate', ESTIMATE_BADGE)] : [];
    title.replaceChildren(...withTail(phraseNodes(townHeadline({ level, name: scope.name, pop2100, first, kinds })), ...tail));
  }

  function renderCard(s: AppState): void {
    const code = levelOf(s) === 'area' ? s.selectedArea : undefined;
    const area = code ? areaByCode.get(code) : undefined;
    const totals = deriveTotals(s.series, data.groups);
    const row = code ? totals.area.get(code) : undefined;
    if (!code || !area || !row) {
      card.hidden = true;
      input = undefined;
      return;
    }
    card.hidden = false;
    input = { years: totals.years, official: officialOf(code), estimate: row, baseline: null };
    chart.setData(seriesPoints({ ...input, year: s.year }), area.name);
    const r = boardCrossings(totals, [code], cardFacilities);
    for (const f of rows) {
      const first = r.crossings.find((c) => c.facilityId === f.id);
      f.when.replaceChildren();
      if (r.alreadyBelow.some((a) => a.facilityId === f.id)) f.when.append(CARD_ALREADY);
      else if (first) {
        f.when.append(cardWhen(first.year));
        const b = badgeFor(first.year);
        if (b.estimate) f.when.append(' ', h('span', 'badge-estimate', b.text));
      } else f.when.append(CARD_NEVER);
    }
  }

  renderHeading(store.get());
  renderCard(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    const selChanged = s.selectedArea !== prev.selectedArea || s.selectedPref !== prev.selectedPref;
    if (selChanged || s.series !== prev.series) {
      renderHeading(s);
      renderCard(s);
    } else if (s.year !== prev.year && input) chart.setMarker(seriesPoints({ ...input, year: s.year }).marker);
  });

  const teardown = () => {
    if (mounted.get(el) === teardown) mounted.delete(el);
    unsubscribe();
    chart.destroy();
    card.remove();
  };
  mounted.set(el, teardown);
  return teardown;
}
