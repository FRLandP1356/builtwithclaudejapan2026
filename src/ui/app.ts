// Application shell: loads the data, creates the store and runner, mounts the maps, the year slider, the search,
// the panel slots (#panel-town, #panel-controls, #panel-allocation, #panel-ai; Ruling 25) and the footer.
// While `store.get().allocation` is set the maps colour by the allocation's change in percent, draw rings on the towns
// that crossed a focused facility's guide and count markers per prefecture, and the headline says 割り振り後.
import type { Topology } from 'topojson-specification';
import { loadAll, loadPrefGeo, type AppData, type LoadOptions } from '../data/loader';
import { createRunner } from '../data/runner';
import type { Choropleth, MapMarker, TooltipContent } from '../map/choropleth';
import { allocationColor, allocationScale, changeColor } from '../map/colors';
import { mountLegend } from '../map/legend';
import { mountNationalMap } from '../map/nationalMap';
import { mountPrefectureMap } from '../map/prefectureMap';
import { mountAllocation } from './allocationPanel';
import { mountControls } from './controls';
import { allocatedTotals, deriveTotals, ratioAt, yearIndex, type AllocatedTotals, type Totals } from './derive';
import { formatDeltaPct, formatPct, formatPop } from './format';
import { breadcrumbs, buildSearchIndex, goUp, levelOf, pickArea, pickPref, prefOfArea, type Selection } from './nav';
import { mountSearch } from './search';
import { mountAIPanel } from './aiPanel';
import { APP_LEAD, APP_TITLE, badgeFor, ESTIMATE_BADGE, FOOT_NOTE, SOURCES } from './sources';
import { createAppStore, DEFAULT_YEAR, type AllocationFlip, type AllocationOverlay, type AppState, type PanelContext, type Store } from './state';
import { mountTownPanel } from './townPanel';
import { mountYearSlider } from './yearSlider';

export { DEFAULT_YEAR };

export interface AppOptions extends LoadOptions {
  /** Cache for prefecture topologies (tests pass their own so apps do not share state). */
  prefGeoCache?: Map<string, Promise<Topology>>;
}

export interface AppHandle {
  store: Store;
  ctx: PanelContext;
  destroy(): void;
}

/** The four panel slots, in mobile order. Each is a `<section class="panel">` that already holds its `h2.panel-title`. */
export interface PanelSlots {
  town: HTMLElement;
  controls: HTMLElement;
  allocation: HTMLElement;
  ai: HTMLElement;
}

const PANEL_TITLES: ReadonlyArray<{ key: keyof PanelSlots; id: string; title: string }> = [
  { key: 'town', id: 'panel-town', title: '町の詳細' },
  { key: 'controls', id: 'panel-controls', title: '前提を変える' },
  { key: 'allocation', id: 'panel-allocation', title: '人口の割り振り' },
  { key: 'ai', id: 'panel-ai', title: 'AIに質問' },
];

export const ALLOC_BADGE = '割り振り後';
export const ALLOC_CLEAR = '割り振りを地図から消す';

// -----------------------------------------------------------------------------------------------------------------
// Panel registry: one mount call per slot; each returns its teardown, which `destroy()` calls.
// -----------------------------------------------------------------------------------------------------------------
function mountPanels(ctx: PanelContext, slots: PanelSlots): Array<() => void> {
  const teardowns: Array<() => void> = [];
  teardowns.push(mountTownPanel(slots.town, ctx));
  teardowns.push(mountControls(slots.controls, ctx));
  teardowns.push(mountAllocation(slots.allocation, ctx));
  teardowns.push(mountAIPanel(slots.ai, ctx));
  return teardowns;
}
// -----------------------------------------------------------------------------------------------------------------

/** A finished-looking empty state: one quiet line under the panel heading. */
export function mountPlaceholder(el: HTMLElement, line: string): void {
  const p = document.createElement('p');
  p.className = 'panel-empty';
  p.textContent = line;
  el.append(p);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function headerHtml(): string {
  return `<header class="app-head"><h1 class="app-title">${APP_TITLE}</h1><p class="app-lead">${APP_LEAD}</p></header>`;
}

/** `<main>` stays a plain landmark; the live region is a child. */
function renderLoading(root: HTMLElement): void {
  root.innerHTML = `${headerHtml()}
    <main>
      <div class="load-skeleton" role="status" aria-live="polite">
        <p class="load-status">データを読み込んでいます（約2MB）</p>
        <div class="skeleton skeleton-line" style="width:40%"></div>
        <div class="skeleton skeleton-map"></div>
        <div class="skeleton skeleton-line" style="width:70%"></div>
      </div>
    </main>`;
}

function renderError(root: HTMLElement, err: unknown, retry: () => void): void {
  const detail = err instanceof Error ? err.message : String(err);
  root.innerHTML = `${headerHtml()}
    <main>
      <div class="load-error" role="alert">
        <h2>データを読み込めませんでした</h2>
        <p>${escapeHtml(detail)}</p>
        <p>通信の状態を確かめてから、もう一度お試しください。</p>
        <button type="button" class="btn btn-primary" id="retry">もう一度読み込む</button>
      </div>
    </main>`;
  root.querySelector<HTMLButtonElement>('#retry')?.addEventListener('click', retry);
}

/**
 * Mount the whole app into `root`. Resolves with a handle once the shell is up, or with `undefined` after showing
 * the error state (which offers a retry that mounts again).
 */
export async function mountApp(root: HTMLElement, options: AppOptions = {}): Promise<AppHandle | undefined> {
  root.classList.add('app');
  renderLoading(root);
  try {
    const data = await loadAll(options);
    const runner = createRunner(data);
    const store = createAppStore(runner, data, { year: DEFAULT_YEAR });
    const ctx: PanelContext = { store, data, runner };
    return buildShell(root, ctx, options);
  } catch (e) {
    console.error('mountApp failed', e);
    renderError(root, e, () => void mountApp(root, options));
    return undefined;
  }
}

function isFormField(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

function buildShell(root: HTMLElement, ctx: PanelContext, options: AppOptions): AppHandle {
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a]));
  const names = {
    pref: (code: string) => data.prefNames.get(code),
    area: (code: string) => areaByCode.get(code)?.name,
  };
  const geoOpts = { fetch: options.fetch, base: options.base, timeoutMs: options.timeoutMs, cache: options.prefGeoCache };
  let totals: Totals = deriveTotals(store.get().series, data.groups);

  root.innerHTML = `${headerHtml()}
    <main class="app-body">
      <section class="map-column" aria-label="地図">
        <div class="map-bar">
          <nav class="crumbs" aria-label="場所"><ol></ol></nav>
          <button type="button" class="btn btn-quiet back" hidden></button>
          <div class="search-slot"></div>
        </div>
        <p class="sr-only place-status" role="status"></p>
        <div class="map-headline">
          <span class="map-headline-name" tabindex="-1"></span>
          <span class="map-headline-num"></span>
        </div>
        <div class="alloc-bar" hidden>
          <span class="alloc-bar-label">地図に反映中の割り振り：<b class="alloc-bar-name"></b></span>
          <span class="alloc-bar-stale note" hidden></span>
          <button type="button" class="btn btn-quiet alloc-clear">${ALLOC_CLEAR}</button>
        </div>
        <div class="map-stage">
          <div class="map-host map-host-national"></div>
          <div class="map-overlay" hidden></div>
        </div>
        <div class="map-foot">
          <div class="legend-slot"></div>
          <div class="year-slot"></div>
        </div>
      </section>
      <section class="panel-column" aria-label="詳細">
        ${PANEL_TITLES.map(
          (p) => `<section class="panel" id="${p.id}" aria-labelledby="${p.id}-title">
            <h2 class="panel-title" id="${p.id}-title">${p.title}</h2>
          </section>`,
        ).join('')}
      </section>
    </main>
    <footer class="app-foot">
      <dl>${SOURCES.map((s) => `<dt>${s.label}</dt><dd>${s.text}</dd>`).join('')}</dl>
      <p>${FOOT_NOTE}</p>
    </footer>`;

  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const crumbList = q<HTMLOListElement>('.crumbs ol');
  const backBtn = q<HTMLButtonElement>('.back');
  const placeStatus = q<HTMLParagraphElement>('.place-status');
  const headName = q<HTMLSpanElement>('.map-headline-name');
  const headNum = q<HTMLSpanElement>('.map-headline-num');
  const allocBar = q<HTMLDivElement>('.alloc-bar');
  const allocName = q<HTMLElement>('.alloc-bar-name');
  const allocStale = q<HTMLElement>('.alloc-bar-stale');
  const allocClear = q<HTMLButtonElement>('.alloc-clear');
  const stage = q<HTMLDivElement>('.map-stage');
  const nationalHost = q<HTMLDivElement>('.map-host-national');
  const overlay = q<HTMLDivElement>('.map-overlay');

  // ---- allocation overlay: derived views, memoised per overlay object ------------------------------------------
  type PlaceKind = 'japan' | 'pref' | 'area';
  interface AllocView {
    overlay: AllocationOverlay;
    /** Half-width of the colour domain, in percent. */
    scale: number;
    /** Prefecture totals at the overlay's year once the change is applied (the national map's colours). */
    after: AllocatedTotals;
    focus?: AllocationFlip;
    gained: Set<string>;
    lost: Set<string>;
    /** Per prefecture: how many towns rose to / fell below the focused facility's guide. */
    prefCounts: Map<string, { gained: number; lost: number }>;
  }
  let allocView: AllocView | undefined;

  function allocViewFor(a: AllocationOverlay | undefined): AllocView | undefined {
    if (!a) return (allocView = undefined);
    if (allocView?.overlay === a) return allocView;
    const focus = a.focusFacilityId ? a.flips.find((f) => f.facilityId === a.focusFacilityId) : undefined;
    const prefCounts = new Map<string, { gained: number; lost: number }>();
    const count = (codes: string[], key: 'gained' | 'lost') => {
      for (const c of codes) {
        const pp = prefOfArea(c);
        const e = prefCounts.get(pp) ?? { gained: 0, lost: 0 };
        e[key]++;
        prefCounts.set(pp, e);
      }
    };
    if (focus) {
      count(focus.gained, 'gained');
      count(focus.lost, 'lost');
    }
    allocView = {
      overlay: a,
      scale: allocationScale(Object.values(a.changePercent)),
      after: allocatedTotals(totals, data.groups, yearIndex(totals.years, a.year), a.changePercent),
      focus,
      gained: new Set(focus?.gained ?? []),
      lost: new Set(focus?.lost ?? []),
      prefCounts,
    };
    return allocView;
  }

  /** The overlay's change for a place on the map, in percent (a prefecture on the national map, else an area). */
  function changeFor(v: AllocView, code: string, kind: PlaceKind): number {
    return kind === 'pref' ? (v.after.prefChange.get(code) ?? 0) : (v.overlay.changePercent[code] ?? 0);
  }

  // ---- numbers for one place in the current year ----------------------------------------------------------------
  interface PlaceNumbers {
    pop: number;
    ratio: number;
    /** The numbers include the allocation (it was computed for the year on screen). */
    allocated: boolean;
  }

  /**
   * Population and ratio to 2020 of a place in the selected year. While an allocation for that same year is drawn,
   * they are the numbers after it; an allocation for another year leaves them as they are (the bar says so).
   */
  function numbersOf(kind: PlaceKind, code: string): PlaceNumbers | undefined {
    const s = store.get();
    const i = yearIndex(totals.years, s.year);
    const row = kind === 'japan' ? totals.japan : kind === 'pref' ? totals.pref.get(code) : totals.area.get(code);
    if (!row || i < 0) return undefined;
    const v = allocViewFor(s.allocation);
    if (!v || v.overlay.year !== s.year) return { pop: row[i], ratio: ratioAt(row, i), allocated: false };
    const pop =
      kind === 'japan'
        ? v.after.japanAfter
        : kind === 'pref'
          ? (v.after.prefAfter.get(code) ?? row[i])
          : row[i] * (1 + (v.overlay.changePercent[code] ?? 0) / 100);
    return { pop, ratio: row[0] > 0 ? pop / row[0] : NaN, allocated: true };
  }
  const isEstimate = () => badgeFor(store.get().year).estimate;

  /** Lines added to tooltips and labels while an allocation is drawn. */
  function allocLines(code: string, kind: PlaceKind): string[] {
    const v = allocViewFor(store.get().allocation);
    if (!v) return [];
    const stale = v.overlay.year !== store.get().year ? `（${v.overlay.year}年の計算）` : '';
    const lines = [`割り振りによる変化 ${formatDeltaPct(changeFor(v, code, kind))}${stale}`];
    if (v.focus) {
      if (kind === 'pref') {
        const c = v.prefCounts.get(code);
        if (c) lines.push(`${v.focus.name}：目安を上回る町 +${c.gained}、下回る町 −${c.lost}`);
      } else if (v.gained.has(code)) lines.push(`${v.focus.name}が目安を上回る（増えた）`);
      else if (v.lost.has(code)) lines.push(`${v.focus.name}が目安を下回る（減った）`);
    }
    return lines;
  }

  function tooltipFor(kind: PlaceKind, code: string, name: string): TooltipContent | null {
    const n = numbersOf(kind, code);
    if (!n) return null;
    return {
      title: name,
      lines: [`${store.get().year}年 ${formatPop(n.pop)}`, `2020年比 ${formatPct(n.ratio)}`, ...allocLines(code, kind)],
      badge: isEstimate() ? ESTIMATE_BADGE : undefined,
      allocBadge: n.allocated ? ALLOC_BADGE : undefined,
    };
  }
  function ariaFor(kind: PlaceKind, code: string, name: string): string {
    const n = numbersOf(kind, code);
    if (!n) return name;
    const marks = `${isEstimate() ? '（このアプリの試算）' : ''}${n.allocated ? `（${ALLOC_BADGE}）` : ''}`;
    const base = `${name}、${store.get().year}年 ${formatPop(n.pop)}、2020年比 ${formatPct(n.ratio)}${marks}`;
    const extra = allocLines(code, kind);
    return extra.length ? `${base}、${extra.join('、')}` : base;
  }

  // ---- maps --------------------------------------------------------------------------------------------------------
  const national = mountNationalMap(nationalHost, {
    topology: data.japanTopo,
    label: '日本地図。都道府県を選ぶと、その県の地図に進みます',
    ariaLabel: (code, name) => ariaFor('pref', code, name),
    tooltip: (code, name) => tooltipFor('pref', code, name),
    onPick: (code) => store.set(pickPref(code)),
  });

  // Prefecture maps, mounted on first visit and kept.
  const prefMaps = new Map<string, { host: HTMLDivElement; map: Choropleth }>();
  let current: Choropleth = national;
  let showToken = 0;

  function mountPref(pp: string, topology: Topology): { host: HTMLDivElement; map: Choropleth } {
    const host = document.createElement('div');
    host.className = 'map-host';
    host.hidden = true;
    stage.insertBefore(host, overlay);
    const prefName = data.prefNames.get(pp) ?? pp;
    try {
      const map = mountPrefectureMap(host, {
        topology,
        label: `${prefName}の地図。市区町村を選ぶと、その町の数字が出ます`,
        ariaLabel: (code, name) => ariaFor('area', code, name),
        tooltip: (code, name) => tooltipFor('area', code, name),
        onPick: (code) => store.set(pickArea({ code, prefCode: pp })),
      });
      const entry = { host, map };
      prefMaps.set(pp, entry);
      return entry;
    } catch (e) {
      host.remove(); // a broken topology leaves nothing behind; the caller shows the error
      throw e;
    }
  }

  function showOverlay(content: Node | string): void {
    overlay.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
    overlay.hidden = false;
  }
  function hideOverlay(): void {
    overlay.hidden = true;
    overlay.replaceChildren();
  }

  function recolor(): void {
    const s = store.get();
    const level = levelOf(s);
    const i = yearIndex(totals.years, s.year);
    const isNational = current === national;
    const v = allocViewFor(s.allocation);
    if (v) {
      const kind: PlaceKind = isNational ? 'pref' : 'area';
      current.update((code) => allocationColor(changeFor(v, code, kind), v.scale));
      current.setRings(isNational ? [] : v.gained, isNational ? [] : v.lost);
      current.setMarkers(isNational ? markersFor(v) : []);
    } else {
      const rows = isNational ? totals.pref : totals.area;
      current.update((code) => changeColor(i < 0 ? NaN : ratioAt(rows.get(code) ?? new Float64Array(0), i)));
      current.setRings([], []);
      current.setMarkers([]);
    }
    current.setSelected(level === 'area' && !isNational ? s.selectedArea : undefined);
    current.refresh();
  }

  function markersFor(v: AllocView): MapMarker[] {
    const out: MapMarker[] = [];
    for (const [pp, c] of v.prefCounts) {
      const parts: string[] = [];
      if (c.gained) parts.push(`+${c.gained}`);
      if (c.lost) parts.push(`−${c.lost}`);
      out.push({ code: pp, text: parts.join(' '), kind: c.gained && c.lost ? 'mixed' : c.gained ? 'gain' : 'loss' });
    }
    return out;
  }

  /** Make `map` the visible one; every path that ends here also drops the overlay. */
  function switchTo(map: Choropleth, host: HTMLDivElement): void {
    if (current !== map) current.clearHover();
    for (const e of prefMaps.values()) e.host.hidden = e.host !== host;
    nationalHost.hidden = host !== nationalHost;
    current = map;
    hideOverlay();
    recolor();
  }

  async function showLevel(s: AppState): Promise<void> {
    const token = ++showToken;
    if (levelOf(s) === 'japan') {
      switchTo(national, nationalHost);
      return;
    }
    const pp = s.selectedPref ?? prefOfArea(s.selectedArea!);
    let entry = prefMaps.get(pp);
    if (!entry) {
      showOverlay('地図を読み込んでいます');
      try {
        const topo = await loadPrefGeo(pp, geoOpts);
        if (token !== showToken) return;
        entry = prefMaps.get(pp) ?? mountPref(pp, topo); // a malformed topology throws here and gets the error overlay
      } catch (e) {
        if (token !== showToken) return; // a newer request owns the overlay now
        const box = document.createElement('div');
        const msg = document.createElement('p');
        msg.textContent = e instanceof Error ? e.message : '地図を読み込めませんでした';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn';
        retry.textContent = 'もう一度読み込む';
        retry.addEventListener('click', () => void showLevel(store.get()));
        box.append(msg, retry);
        showOverlay(box);
        return;
      }
    }
    switchTo(entry.map, entry.host);
  }

  // ---- place bar, headline, allocation bar -------------------------------------------------------------------------
  function renderPlace(s: AppState): void {
    const sel: Selection = s;
    const level = levelOf(sel);
    const crumbs = breadcrumbs(sel, names);
    crumbList.replaceChildren(
      ...crumbs.map((c, i) => {
        const li = document.createElement('li');
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'crumb-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '›';
          li.append(sep);
        }
        if (c.current) {
          const span = document.createElement('span');
          span.className = 'crumb-current';
          span.setAttribute('aria-current', 'page');
          span.textContent = c.label;
          li.append(span);
        } else {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'crumb';
          btn.textContent = c.label;
          btn.addEventListener('click', () => c.patch && store.set(c.patch));
          li.append(btn);
        }
        return li;
      }),
    );
    backBtn.hidden = level === 'japan';
    backBtn.textContent = level === 'pref' ? '日本地図へ戻る' : '県全体へ戻る';
    document.title = level === 'japan' ? APP_TITLE : `${crumbs[crumbs.length - 1].label}｜${APP_TITLE}`;
  }

  function placeOf(s: AppState): { name: string; kind: PlaceKind; code: string } {
    const level = levelOf(s);
    if (level === 'pref') {
      const pp = s.selectedPref!;
      return { name: data.prefNames.get(pp) ?? pp, kind: 'pref', code: pp };
    }
    if (level === 'area') {
      const code = s.selectedArea!;
      return { name: areaByCode.get(code)?.name ?? code, kind: 'area', code };
    }
    return { name: '日本', kind: 'japan', code: '' };
  }

  /** Name, year, population, ratio and marks: the 試算/公式 mark always, 割り振り後 when the numbers include it. */
  function renderHeadline(s: AppState): void {
    const place = placeOf(s);
    headName.textContent = place.name;
    const n = numbersOf(place.kind, place.code);
    if (!n) {
      headNum.textContent = '';
      return;
    }
    const b = document.createElement('b');
    b.textContent = formatPop(n.pop);
    const badgeInfo = badgeFor(s.year);
    const badge = document.createElement('span');
    badge.className = badgeInfo.estimate ? 'badge-estimate' : 'badge-official';
    badge.textContent = badgeInfo.text;
    const parts: Node[] = [document.createTextNode(`${s.year}年 `), b, document.createTextNode(`　2020年比 ${formatPct(n.ratio)}　`), badge];
    if (n.allocated) {
      const alloc = document.createElement('span');
      alloc.className = 'badge-alloc';
      alloc.textContent = ALLOC_BADGE;
      parts.push(document.createTextNode(' '), alloc);
    }
    headNum.replaceChildren(...parts);
  }

  function renderAllocBar(s: AppState): void {
    const a = s.allocation;
    if (!a) {
      // The bar (and its clear button) goes away: do not leave keyboard focus on a hidden button.
      const hadFocus = allocBar.contains(document.activeElement);
      allocBar.hidden = true;
      if (hadFocus) headName.focus({ preventScroll: true });
      return;
    }
    allocBar.hidden = false;
    allocName.textContent = a.label;
    const stale = a.year !== s.year;
    allocStale.hidden = !stale;
    allocStale.textContent = stale ? `この割り振りは${a.year}年の計算です` : '';
  }

  /** Announce a new place once (the headline itself is not a live region). */
  function announcePlace(s: AppState): void {
    const place = placeOf(s);
    const n = numbersOf(place.kind, place.code);
    placeStatus.textContent = n
      ? `${place.name}、${s.year}年 ${formatPop(n.pop)}、2020年比 ${formatPct(n.ratio)}${n.allocated ? `（${ALLOC_BADGE}）` : ''}`
      : place.name;
  }

  const ac = new AbortController();
  backBtn.addEventListener('click', () => store.set(goUp(store.get())), { signal: ac.signal });
  allocClear.addEventListener('click', () => store.set({ allocation: undefined }), { signal: ac.signal });
  root.ownerDocument.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isFormField(e.target) || !store.get().allocation) return;
      store.set({ allocation: undefined });
    },
    { signal: ac.signal },
  );

  const search = mountSearch(q<HTMLDivElement>('.search-slot'), {
    index: buildSearchIndex(data.areas, data.prefNames),
    onPick: (e) => store.set(e.kind === 'pref' ? pickPref(e.code) : pickArea({ code: e.code, prefCode: e.prefCode })),
  });
  const legend = mountLegend(q<HTMLDivElement>('.legend-slot'));
  const slider = mountYearSlider(q<HTMLDivElement>('.year-slot'), {
    year: store.get().year,
    onChange: (year) => store.set({ year }),
  });

  function updateLegend(s: AppState): void {
    const v = allocViewFor(s.allocation);
    legend.setMode(v ? { kind: 'allocation', scale: v.scale } : { kind: 'ratio' });
  }

  const slots: PanelSlots = {
    town: q<HTMLElement>('#panel-town'),
    controls: q<HTMLElement>('#panel-controls'),
    allocation: q<HTMLElement>('#panel-allocation'),
    ai: q<HTMLElement>('#panel-ai'),
  };
  const panelTeardowns = mountPanels(ctx, slots);

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.series !== prev.series) {
      totals = deriveTotals(s.series, data.groups);
      allocView = undefined; // the overlay year's populations may have changed
    }
    const prefChanged = s.selectedPref !== prev.selectedPref;
    const selChanged = prefChanged || s.selectedArea !== prev.selectedArea;
    const allocChanged = s.allocation !== prev.allocation;
    if (selChanged) {
      renderPlace(s);
      void showLevel(s);
    }
    if (s.year !== prev.year) slider.update(s.year);
    if (allocChanged) {
      // Hidden maps are recoloured when they are shown again; their rings and markers must not wait for that.
      for (const m of [national, ...[...prefMaps.values()].map((e) => e.map)]) {
        if (m === current) continue;
        m.setRings([], []);
        m.setMarkers([]);
      }
    }
    if (s.year !== prev.year || s.series !== prev.series || allocChanged) recolor();
    if (allocChanged || s.series !== prev.series) updateLegend(s);
    if (allocChanged || s.year !== prev.year) renderAllocBar(s);
    renderHeadline(s);
    if (selChanged) announcePlace(s);
    // The map was replaced (drill-down or back): keep keyboard focus in the map region instead of dropping it.
    if (prefChanged) headName.focus({ preventScroll: true });
  });

  const s0 = store.get();
  renderPlace(s0);
  renderHeadline(s0);
  renderAllocBar(s0);
  updateLegend(s0);
  void showLevel(s0);

  return {
    store,
    ctx,
    destroy() {
      unsubscribe();
      ac.abort();
      for (const t of panelTeardowns) t();
      slider.destroy();
      search.destroy();
      national.destroy();
      for (const e of prefMaps.values()) e.map.destroy();
      root.replaceChildren();
    },
  };
}
