// Town detail panel (Task 9): key numbers, population pyramid, population over time and, for a town, the facility
// panel. Ruling 27 decides what is shown: nothing selected -> Japan summary; only a prefecture -> prefecture summary
// (no facilities); a town -> everything.
//
// The panel is built once. A store notification only changes the parts whose inputs changed: the selection rebuilds the
// lines and the facility rows' owner, a new year rewrites the tiles, the pyramid, the facility tags and moves the
// chart's marker, and a new scenario (a new `series`) redraws the lines. `mountTownPanel` returns its teardown.
import { ages65, sumSeries, total } from '../engine/aggregate';
import { DEFAULT_SCENARIO, type Area, type Pop, type Series } from '../engine/types';
import type { AppData } from '../data/loader';
import { allocationView, overlayCovers, placeNumbers } from './allocationView';
import { deriveTotals, type Totals } from './derive';
import { mountFacilityPanel } from './facilityPanel';
import { formatPct, formatPop } from './format';
import { levelOf, type Level, type Selection } from './nav';
import { mountPyramid } from './pyramid';
import { mountSeriesChart, seriesPoints, type SeriesPointsInput } from './seriesChart';
import { badgeFor, ESTIMATE_BADGE } from './sources';
import type { AppState, PanelContext } from './state';
import './townPanel.css';

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------------------

export interface AgeShares {
  total: number;
  /** Share aged 0-14. */
  child: number;
  /** Share aged 15-64. */
  working: number;
  /** Share aged 65 and over. */
  elderly: number;
}

/** Total and age-group shares of a population; the shares are NaN for an empty population. */
export function ageShares(p: Pop): AgeShares {
  const all = total(p);
  const child = p.M.slice(0, 3).reduce((s, v) => s + v, 0) + p.F.slice(0, 3).reduce((s, v) => s + v, 0);
  const elderly = ages65(p);
  if (!(all > 0)) return { total: all, child: NaN, working: NaN, elderly: NaN };
  return { total: all, child: child / all, working: (all - child - elderly) / all, elderly: elderly / all };
}

export interface TownScope {
  level: Level;
  /** Area code, prefecture code or 'japan'. */
  key: string;
  name: string;
  /** One quiet line under the name. */
  sub: string;
  areaCodes: string[];
  area?: Area;
}

type ScopeData = Pick<AppData, 'areas' | 'groups' | 'prefNames'>;

/** What the panel describes for a selection (Ruling 27). */
export function resolveScope(data: ScopeData, sel: Selection, areaByCode: ReadonlyMap<string, Area>): TownScope {
  const level = levelOf(sel);
  if (level === 'area') {
    const area = areaByCode.get(sel.selectedArea!);
    if (area) return { level, key: area.code, name: area.name, sub: area.prefName, areaCodes: [area.code], area };
  }
  const pp = level === 'japan' ? undefined : sel.selectedPref ?? sel.selectedArea?.slice(0, 2);
  if (pp !== undefined) {
    const codes = data.groups.prefs[pp] ?? data.areas.filter((a) => a.prefCode === pp).map((a) => a.code);
    const name = data.prefNames.get(pp) ?? pp;
    return { level: 'pref', key: pp, name, sub: `${name}の${codes.length}地域の合計`, areaCodes: codes };
  }
  const codes = data.areas.map((a) => a.code);
  return { level: 'japan', key: 'japan', name: '日本全体', sub: `全国${data.prefNames.size}都道府県・${codes.length}地域の合計`, areaCodes: codes };
}

const UNIT = /^(.*?)(万人|億人|人|%)$/;

/** "4.2万人" -> ["4.2", "万人"]; "−31.5%" -> ["−31.5", "%"]; text without a unit comes back whole. */
export function splitUnit(text: string): [string, string] {
  const m = UNIT.exec(text);
  return m ? [m[1], m[2]] : [text, ''];
}

const pctText = (share: number) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : '－');

// ---------------------------------------------------------------------------------------------------------------
// DOM pieces
// ---------------------------------------------------------------------------------------------------------------

interface Kpi {
  root: HTMLDivElement;
  label: HTMLDivElement;
  value: HTMLSpanElement;
  unit: HTMLSpanElement;
  note: HTMLDivElement;
}

function makeKpi(): Kpi {
  const root = document.createElement('div');
  root.className = 'kpi';
  const label = document.createElement('div');
  label.className = 'kpi-label';
  const valueBox = document.createElement('div');
  valueBox.className = 'kpi-value';
  const value = document.createElement('span');
  const unit = document.createElement('span');
  unit.className = 'kpi-unit';
  valueBox.append(value, unit);
  const note = document.createElement('div');
  note.className = 'kpi-note';
  root.append(label, valueBox, note);
  return { root, label, value, unit, note };
}

function setKpi(k: Kpi, label: string, valueText: string): void {
  const [v, u] = splitUnit(valueText);
  k.label.textContent = label;
  k.value.textContent = v;
  k.unit.textContent = u;
}

/** A section heading with an optional dashed 試算 badge. */
function makeHeading(): { el: HTMLHeadingElement; set(text: string, estimate: boolean): void } {
  const el = document.createElement('h3');
  el.className = 'panel-section-title';
  const text = document.createTextNode('');
  const badge = document.createElement('span');
  badge.className = 'badge-estimate';
  badge.textContent = ESTIMATE_BADGE;
  el.append(text);
  return {
    el,
    set(t, estimate) {
      text.data = t;
      if (estimate && !badge.isConnected) el.append(' ', badge);
      else if (!estimate && badge.isConnected) {
        badge.previousSibling?.remove();
        badge.remove();
      }
    },
  };
}

function rowFor(t: Totals, scope: TownScope): Float64Array | undefined {
  if (scope.level === 'area') return t.area.get(scope.key);
  if (scope.level === 'pref') return t.pref.get(scope.key);
  return t.japan;
}

// ---------------------------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------------------------

const mounted = new WeakMap<HTMLElement, () => void>();

/**
 * Fill `el` (the #panel-town section, which already holds its h2.panel-title) with the town panel and keep it in step
 * with the store. Returns the teardown: it unsubscribes and removes everything this function added.
 */
export function mountTownPanel(el: HTMLElement, ctx: PanelContext): () => void {
  // A second mount into the same element replaces the first one (its subscription and DOM go first) instead of duplicating the UI.
  mounted.get(el)?.();
  const { store, data, runner } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a] as const));
  const title = el.querySelector<HTMLElement>('.panel-title');
  const titleBadge = document.createElement('span');
  titleBadge.className = 'badge-estimate';
  titleBadge.textContent = ESTIMATE_BADGE;

  const root = document.createElement('div');
  root.className = 'town';

  const head = document.createElement('div');
  head.className = 'town-head';
  const name = document.createElement('h3');
  name.className = 'town-name';
  const sub = document.createElement('p');
  sub.className = 'town-sub';
  head.append(name, sub);
  const hint = document.createElement('p');
  hint.className = 'panel-empty town-hint';

  const kpiSection = document.createElement('div');
  kpiSection.className = 'panel-section town-kpis';
  const kpiRow = document.createElement('div');
  kpiRow.className = 'kpi-row';
  const kpis = [makeKpi(), makeKpi(), makeKpi(), makeKpi()];
  kpiRow.append(...kpis.map((k) => k.root));
  kpiSection.append(kpiRow);
  const basis = document.createElement('span');
  kpis[0].note.append(basis);
  // While the map shows a reallocation for this year, one quiet line says that these tiles are before it.
  const allocNote = document.createElement('p');
  allocNote.className = 'note town-alloc-note';
  allocNote.hidden = true;
  kpiSection.append(allocNote);

  const pyramidSection = document.createElement('div');
  pyramidSection.className = 'panel-section town-pyramid';
  const pyramidHeading = makeHeading();
  const pyramidHost = document.createElement('div');
  pyramidSection.append(pyramidHeading.el, pyramidHost);
  const pyramid = mountPyramid(pyramidHost);

  const seriesSection = document.createElement('div');
  seriesSection.className = 'panel-section town-series';
  const seriesHeading = makeHeading();
  seriesHeading.set('人口の推移', false);
  const seriesHost = document.createElement('div');
  seriesSection.append(seriesHeading.el, seriesHost);
  const chart = mountSeriesChart(seriesHost);

  const facilitySection = document.createElement('div');
  facilitySection.className = 'panel-section town-facilities';
  const facilities = mountFacilityPanel(facilitySection, data.facilities);

  root.append(head, hint, kpiSection, pyramidSection, seriesSection);
  el.append(root);

  // Per-selection and per-series caches.
  let scope: TownScope | undefined;
  let officialRow: Record<number, number> = {};
  let seriesInput: Omit<SeriesPointsInput, 'year'> | undefined;
  const popCache = new Map<string, Pop>();
  const axisCache = new Map<string, number>();
  let popCacheSeries: Map<string, Series> | undefined;

  function popAt(series: Map<string, Series>, sc: TownScope, year: number): Pop {
    if (popCacheSeries !== series) {
      popCache.clear();
      axisCache.clear();
      popCacheSeries = series;
    }
    const key = `${sc.key}:${year}`;
    const hit = popCache.get(key);
    if (hit) return hit;
    const slices = sc.areaCodes.flatMap((c) => {
      const p = series.get(c)?.[year];
      return p ? [{ [year]: p } as Series] : [];
    });
    const pop = slices.length === 1 ? slices[0][year] : sumSeries(slices)[year];
    popCache.set(key, pop);
    return pop;
  }

  /** Ruling 29: the pyramid axis is the largest single age-class value (either sex) over every year, for this place and series. */
  function axisMaxFor(series: Map<string, Series>, sc: TownScope, years: readonly number[]): number {
    popAt(series, sc, years[0]); // drops the caches first when the series changed
    const hit = axisCache.get(sc.key);
    if (hit !== undefined) return hit;
    let max = 0;
    for (const y of years) {
      const p = popAt(series, sc, y);
      max = Math.max(max, ...p.M, ...p.F);
    }
    axisCache.set(sc.key, max);
    return max;
  }

  function officialTotals(codes: string[]): Record<number, number> {
    const out: Record<number, number> = {};
    for (const c of codes) {
      const a = areaByCode.get(c);
      if (!a) continue;
      out[2020] = (out[2020] ?? 0) + total(a.base);
      for (const [y, v] of Object.entries(a.official)) out[Number(y)] = (out[Number(y)] ?? 0) + v;
    }
    return out;
  }

  function render(s: AppState, prev: AppState | undefined): void {
    const selChanged = !prev || s.selectedArea !== prev.selectedArea || s.selectedPref !== prev.selectedPref || !scope;
    const seriesChanged = !prev || s.series !== prev.series;
    const estimate = badgeFor(s.year).estimate;

    if (selChanged) {
      scope = resolveScope(data, s, areaByCode);
      officialRow = officialTotals(scope.areaCodes);
      name.textContent = scope.name;
      sub.textContent = scope.sub;
      hint.hidden = scope.level === 'area';
      hint.textContent = scope.level === 'japan' ? '町を選ぶと、ここにその町の数字と施設の目安が出ます。' : '市区町村を選ぶと、その町の施設の目安も出ます。';
      if (scope.level === 'area') {
        if (!facilitySection.isConnected) root.append(facilitySection);
      } else {
        facilitySection.remove();
      }
    }
    const sc = scope!;

    // Title badge on the panel heading (the shell's h2): only while the figures are this app's estimate.
    if (title) {
      if (estimate && !titleBadge.isConnected) title.append(' ', titleBadge);
      else if (!estimate && titleBadge.isConnected) {
        titleBadge.previousSibling?.remove();
        titleBadge.remove();
      }
    }

    const totals = deriveTotals(s.series, data.groups);
    const row = rowFor(totals, sc);
    const idx = totals.years.indexOf(s.year);
    if (!row || idx < 0) return;

    // Key numbers and the pyramid.
    const pop = popAt(s.series, sc, s.year);
    const pop0 = popAt(s.series, sc, 2020);
    const now = ageShares(pop);
    const base = ageShares(pop0);
    setKpi(kpis[0], `${s.year}年の人口`, formatPop(now.total));
    setKpi(kpis[1], '2020年との比較', formatPct(base.total > 0 ? now.total / base.total : NaN));
    setKpi(kpis[2], '65歳以上の割合', pctText(now.elderly));
    setKpi(kpis[3], '0〜14歳の割合', pctText(now.child));
    kpis[1].note.textContent = `2020年は${formatPop(base.total)}`;
    kpis[2].note.textContent = `2020年は${pctText(base.elderly)}`;
    kpis[3].note.textContent = `2020年は${pctText(base.child)}`;
    const b = badgeFor(s.year);
    basis.className = b.estimate ? 'badge-estimate' : 'badge-official';
    basis.textContent = b.text;
    pyramidHeading.set(`${s.year}年の年齢別の人口`, estimate);
    pyramid.update({ pop, year: s.year, place: sc.name, axisMax: axisMaxFor(s.series, sc, totals.years) });

    // The line chart: redraw when the place or the scenario changed, otherwise only move the marker.
    let redraw = false;
    if (selChanged || seriesChanged || !seriesInput) {
      // The reference line is data-based: seriesPoints keeps it only if the default scenario's numbers differ from the
      // current ones for this place, so a scenario that changes nothing here shows no second line.
      const baseRow = rowFor(deriveTotals(runner.run(DEFAULT_SCENARIO), data.groups), sc);
      seriesInput = { years: totals.years, official: officialRow, estimate: row, baseline: baseRow };
      redraw = true;
    }
    const points = seriesPoints({ ...seriesInput, year: s.year });
    if (redraw) chart.setData(points, sc.name);
    else chart.setMarker(points.marker);

    // Facilities: only for a town, judged on the unrounded projected population.
    if (sc.level === 'area' && sc.area) {
      facilities.update({
        pop: row[idx],
        year: s.year,
        prefCode: sc.area.prefCode,
        infraStrength: s.scenario.infraStrength,
        estimate,
        place: sc.name,
      });
    }
  }

  /** The note under the tiles while the map shows this place after a reallocation for the year shown. */
  function renderAllocNote(s: AppState): void {
    const a = s.allocation;
    const sc = scope;
    let text = '';
    if (a && sc && a.year === s.year && overlayCovers(a, sc.areaCodes)) {
      const totals = deriveTotals(s.series, data.groups);
      const n = placeNumbers(totals, s.year, sc.level, sc.key, allocationView(a, totals, data.groups));
      // Only when the map's number differs from the tiles' (the country's total never does).
      if (n?.allocated && formatPop(n.pop) !== formatPop(n.popBefore)) text = `地図は割り振り後（${formatPop(n.pop)}）です。この欄の数字は割り振り前です。`;
    }
    if (allocNote.textContent !== text) allocNote.textContent = text;
    allocNote.hidden = text === '';
  }

  render(store.get(), undefined);
  renderAllocNote(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    const same = s.year === prev.year && s.series === prev.series && s.selectedArea === prev.selectedArea && s.selectedPref === prev.selectedPref;
    if (!same) render(s, prev);
    if (!same || s.allocation !== prev.allocation) renderAllocNote(s);
  });

  const teardown = () => {
    if (mounted.get(el) === teardown) mounted.delete(el);
    unsubscribe();
    pyramid.destroy();
    chart.destroy();
    facilities.destroy();
    if (titleBadge.isConnected) {
      titleBadge.previousSibling?.remove();
      titleBadge.remove();
    }
    root.remove();
  };
  mounted.set(el, teardown);
  return teardown;
}
