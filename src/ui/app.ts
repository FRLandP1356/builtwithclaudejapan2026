// Application shell: loads the data, creates the store and runner, mounts the maps, the year slider, the search,
// the panel slots (#panel-town, #panel-controls, #panel-allocation, #panel-ai; Ruling 25) and the footer.
import type { Topology } from 'topojson-specification';
import { loadAll, loadPrefGeo, type AppData, type LoadOptions } from '../data/loader';
import { createRunner } from '../data/runner';
import type { Choropleth, TooltipContent } from '../map/choropleth';
import { changeColor } from '../map/colors';
import { mountLegend } from '../map/legend';
import { mountNationalMap } from '../map/nationalMap';
import { mountPrefectureMap } from '../map/prefectureMap';
import { mountAllocation } from './allocationPanel';
import { mountControls } from './controls';
import { deriveTotals, ratioAt, yearIndex, type Totals } from './derive';
import { formatPct, formatPop } from './format';
import { breadcrumbs, buildSearchIndex, goUp, levelOf, pickArea, pickPref, prefOfArea, type Selection } from './nav';
import { mountSearch } from './search';
import { APP_LEAD, APP_TITLE, badgeFor, ESTIMATE_BADGE, FOOT_NOTE, SOURCES } from './sources';
import { createAppStore, DEFAULT_YEAR, type AppState, type PanelContext, type Store } from './state';
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

// -----------------------------------------------------------------------------------------------------------------
// Panel registry. Tasks 9, 10 and 13 each replace exactly ONE line below with their own mount call, for example
// `mountTownPanel(slots.town, ctx);`. Nothing else in this file needs to change for a panel.
// -----------------------------------------------------------------------------------------------------------------
function mountPanels(ctx: PanelContext, slots: PanelSlots): Array<() => void> {
  void ctx;
  const teardowns: Array<() => void> = [];
  teardowns.push(mountTownPanel(slots.town, ctx));
  teardowns.push(mountControls(slots.controls, ctx));
  teardowns.push(mountAllocation(slots.allocation, ctx));
  mountPlaceholder(slots.ai, '日本語で質問すると、計算の結果をもとに答えます。'); // Task 13: teardowns.push(mountAIPanel(slots.ai, ctx))
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

function renderLoading(root: HTMLElement): void {
  root.innerHTML = `${headerHtml()}
    <main class="load-skeleton" role="status" aria-live="polite">
      <p class="load-status">データを読み込んでいます（約2MB）</p>
      <div class="skeleton skeleton-line" style="width:40%"></div>
      <div class="skeleton skeleton-map"></div>
      <div class="skeleton skeleton-line" style="width:70%"></div>
    </main>`;
}

function renderError(root: HTMLElement, err: unknown, retry: () => void): void {
  const detail = err instanceof Error ? err.message : String(err);
  root.innerHTML = `${headerHtml()}
    <main class="load-error" role="alert">
      <h2>データを読み込めませんでした</h2>
      <p>${escapeHtml(detail)}</p>
      <p>通信の状態を確かめてから、もう一度お試しください。</p>
      <button type="button" class="btn btn-primary" id="retry">もう一度読み込む</button>
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
  const stage = q<HTMLDivElement>('.map-stage');
  const nationalHost = q<HTMLDivElement>('.map-host-national');
  const overlay = q<HTMLDivElement>('.map-overlay');

  // Numbers for one place in the current year.
  function statsOf(row: Float64Array | undefined): { pop: number; ratio: number } | undefined {
    const i = yearIndex(totals.years, store.get().year);
    if (!row || i < 0) return undefined;
    return { pop: row[i], ratio: ratioAt(row, i) };
  }
  const isEstimate = () => badgeFor(store.get().year).estimate;

  function tooltipFor(row: Float64Array | undefined, name: string): TooltipContent | null {
    const st = statsOf(row);
    if (!st) return null;
    return {
      title: name,
      lines: [`${store.get().year}年 ${formatPop(st.pop)}`, `2020年比 ${formatPct(st.ratio)}`],
      badge: isEstimate() ? ESTIMATE_BADGE : undefined,
    };
  }
  function ariaFor(row: Float64Array | undefined, name: string): string {
    const st = statsOf(row);
    if (!st) return name;
    return `${name}、${store.get().year}年 ${formatPop(st.pop)}、2020年比 ${formatPct(st.ratio)}${isEstimate() ? '（このアプリの試算）' : ''}`;
  }

  // National map.
  const national = mountNationalMap(nationalHost, {
    topology: data.japanTopo,
    label: '日本地図。都道府県を選ぶと、その県の地図に進みます',
    ariaLabel: (code, name) => ariaFor(totals.pref.get(code), name),
    tooltip: (code, name) => tooltipFor(totals.pref.get(code), name),
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
    const map = mountPrefectureMap(host, {
      topology,
      label: `${prefName}の地図。市区町村を選ぶと、その町の数字が出ます`,
      ariaLabel: (code, name) => ariaFor(totals.area.get(code), name),
      tooltip: (code, name) => tooltipFor(totals.area.get(code), name),
      onPick: (code) => store.set(pickArea({ code, prefCode: pp })),
    });
    const entry = { host, map };
    prefMaps.set(pp, entry);
    return entry;
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
    const rows = current === national ? totals.pref : totals.area;
    current.update((code) => changeColor(i < 0 ? NaN : ratioAt(rows.get(code) ?? new Float64Array(0), i)));
    current.setSelected(level === 'area' && current !== national ? s.selectedArea : undefined);
    current.refresh();
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
      let topo: Topology;
      try {
        topo = await loadPrefGeo(pp, geoOpts);
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
      if (token !== showToken) return;
      entry = prefMaps.get(pp) ?? mountPref(pp, topo);
    }
    switchTo(entry.map, entry.host);
  }

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

  function placeOf(s: AppState): { name: string; row: Float64Array | undefined } {
    const level = levelOf(s);
    if (level === 'pref') {
      const pp = s.selectedPref!;
      return { name: data.prefNames.get(pp) ?? pp, row: totals.pref.get(pp) };
    }
    if (level === 'area') {
      const code = s.selectedArea!;
      return { name: areaByCode.get(code)?.name ?? code, row: totals.area.get(code) };
    }
    return { name: '日本', row: totals.japan };
  }

  function renderHeadline(s: AppState): void {
    const { name, row } = placeOf(s);
    headName.textContent = name;
    const st = statsOf(row);
    if (!st) {
      headNum.textContent = '';
      return;
    }
    const b = document.createElement('b');
    b.textContent = formatPop(st.pop);
    const badgeInfo = badgeFor(s.year);
    const badge = document.createElement('span');
    badge.className = badgeInfo.estimate ? 'badge-estimate' : 'badge-official';
    badge.textContent = badgeInfo.text;
    headNum.replaceChildren(
      document.createTextNode(`${s.year}年 `),
      b,
      document.createTextNode(`　2020年比 ${formatPct(st.ratio)}　`),
      badge,
    );
  }

  /** Announce a new place once (the headline itself is not a live region). */
  function announcePlace(s: AppState): void {
    const { name, row } = placeOf(s);
    const st = statsOf(row);
    placeStatus.textContent = st
      ? `${name}、${s.year}年 ${formatPop(st.pop)}、2020年比 ${formatPct(st.ratio)}`
      : name;
  }

  backBtn.addEventListener('click', () => store.set(goUp(store.get())));

  const search = mountSearch(q<HTMLDivElement>('.search-slot'), {
    index: buildSearchIndex(data.areas, data.prefNames),
    onPick: (e) => store.set(e.kind === 'pref' ? pickPref(e.code) : pickArea({ code: e.code, prefCode: e.prefCode })),
  });
  mountLegend(q<HTMLDivElement>('.legend-slot'));
  const slider = mountYearSlider(q<HTMLDivElement>('.year-slot'), {
    year: store.get().year,
    onChange: (year) => store.set({ year }),
  });

  const slots: PanelSlots = {
    town: q<HTMLElement>('#panel-town'),
    controls: q<HTMLElement>('#panel-controls'),
    allocation: q<HTMLElement>('#panel-allocation'),
    ai: q<HTMLElement>('#panel-ai'),
  };
  const panelTeardowns = mountPanels(ctx, slots);

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.series !== prev.series) totals = deriveTotals(s.series, data.groups);
    const prefChanged = s.selectedPref !== prev.selectedPref;
    const selChanged = prefChanged || s.selectedArea !== prev.selectedArea;
    if (selChanged) {
      renderPlace(s);
      void showLevel(s);
    }
    if (s.year !== prev.year) slider.update(s.year);
    if (s.year !== prev.year || s.series !== prev.series) recolor();
    renderHeadline(s);
    if (selChanged) announcePlace(s);
    // The map was replaced (drill-down or back): keep keyboard focus in the map region instead of dropping it.
    if (prefChanged) headName.focus();
  });

  const s0 = store.get();
  renderPlace(s0);
  renderHeadline(s0);
  void showLevel(s0);

  return {
    store,
    ctx,
    destroy() {
      unsubscribe();
      for (const t of panelTeardowns) t();
      slider.destroy();
      search.destroy();
      national.destroy();
      for (const e of prefMaps.values()) e.map.destroy();
      root.replaceChildren();
    },
  };
}
