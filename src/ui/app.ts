// Application shell: loads the data, creates the store and runner, mounts the maps, the year slider, the search,
// the panel slots (#panel-town, #panel-controls, #panel-allocation, #panel-ai; Ruling 25) and the footer.
import { DataLoadError, loadAll, loadPrefGeo, type AppData } from '../data/loader';
import { createRunner, isScenarioError, sanitizeScenario } from '../data/runner';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Choropleth, TooltipContent } from '../map/choropleth';
import { changeColor } from '../map/colors';
import { mountLegend } from '../map/legend';
import { mountNationalMap } from '../map/nationalMap';
import { mountPrefectureMap } from '../map/prefectureMap';
import { deriveTotals, ratioAt, yearIndex, type Totals } from './derive';
import { formatPct, formatPop } from './format';
import { breadcrumbs, buildSearchIndex, goUp, levelOf, pickArea, pickPref, prefOfArea, type Selection } from './nav';
import { mountSearch } from './search';
import { APP_LEAD, APP_TITLE, ESTIMATE_BADGE, FOOT_NOTE, OFFICIAL_BADGE, OFFICIAL_END_YEAR, SOURCES } from './sources';
import { createStore, type AppState, type PanelContext } from './state';
import { mountYearSlider } from './yearSlider';

export const DEFAULT_YEAR = 2050;

/** Panel slots in mobile order, with their placeholder heading and line (replaced by Tasks 9, 10, 13). */
const PANELS: ReadonlyArray<{ id: string; title: string; empty: string }> = [
  { id: 'panel-town', title: '町の詳細', empty: '町を選ぶと、ここに詳しい数字が出ます。' },
  { id: 'panel-controls', title: '前提を変える', empty: '2050年より後の出生率と人口移動の前提を、ここで動かせるようになります。' },
  { id: 'panel-allocation', title: '人口の割り振り', empty: '人口を割り振ると、ほかの地域がどう減るかをここで見られるようになります。' },
  { id: 'panel-ai', title: 'AIに質問', empty: '日本語で質問すると、計算の結果をもとに答えます。' },
];

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function headerHtml(): string {
  return `<header class="app-head"><h1 class="app-title">${APP_TITLE}</h1><p class="app-lead">${APP_LEAD}</p></header>`;
}

function renderLoading(root: HTMLElement): void {
  root.innerHTML = `${headerHtml()}
    <div class="load-skeleton" role="status" aria-live="polite">
      <p class="load-status">データを読み込んでいます（約2MB）</p>
      <div class="skeleton skeleton-line" style="width:40%"></div>
      <div class="skeleton skeleton-map"></div>
      <div class="skeleton skeleton-line" style="width:70%"></div>
    </div>`;
}

function renderError(root: HTMLElement, err: unknown, retry: () => void): void {
  const detail = err instanceof DataLoadError ? err.message : err instanceof Error ? err.message : String(err);
  root.innerHTML = `${headerHtml()}
    <div class="load-error" role="alert">
      <h2>データを読み込めませんでした</h2>
      <p>${escapeHtml(detail)}</p>
      <p>通信の状態を確かめてから、もう一度お試しください。</p>
      <button type="button" class="btn btn-primary" id="retry">もう一度読み込む</button>
    </div>`;
  root.querySelector<HTMLButtonElement>('#retry')?.addEventListener('click', retry);
}

export async function mountApp(root: HTMLElement): Promise<void> {
  root.classList.add('app');
  renderLoading(root);

  let data: AppData;
  try {
    data = await loadAll();
  } catch (e) {
    renderError(root, e, () => void mountApp(root));
    return;
  }

  const runner = createRunner(data);
  const store = createStore(
    { year: DEFAULT_YEAR, scenario: DEFAULT_SCENARIO, series: runner.run(DEFAULT_SCENARIO) },
    {
      // set({ scenario }) -> sanitise -> run -> series, in the same notification (Ruling 25).
      derive(next, prev) {
        if (next.scenario === prev.scenario) return;
        const s = sanitizeScenario(next.scenario);
        if (isScenarioError(s)) {
          console.warn(`scenario rejected, keeping the previous one: ${s.error}`);
          return { scenario: prev.scenario, series: prev.series };
        }
        return { scenario: s, series: runner.run(s) };
      },
    },
  );
  const ctx: PanelContext = { store, data, runner };
  buildShell(root, ctx);
}

function buildShell(root: HTMLElement, ctx: PanelContext): void {
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a]));
  const names = {
    pref: (code: string) => data.prefNames.get(code),
    area: (code: string) => areaByCode.get(code)?.name,
  };
  let totals: Totals = deriveTotals(store.get().series, data.groups);

  root.innerHTML = `${headerHtml()}
    <div class="app-body">
      <section class="map-column" aria-label="地図">
        <div class="map-bar">
          <nav class="crumbs" aria-label="場所"><ol></ol></nav>
          <button type="button" class="btn btn-quiet back" hidden></button>
          <div class="search-slot"></div>
        </div>
        <div class="map-headline" aria-live="polite">
          <span class="map-headline-name"></span>
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
        ${PANELS.map(
          (p) => `<section class="panel" id="${p.id}" aria-labelledby="${p.id}-title">
            <h2 class="panel-title" id="${p.id}-title">${p.title}</h2>
            <p class="panel-empty">${p.empty}</p>
          </section>`,
        ).join('')}
      </section>
    </div>
    <footer class="app-foot">
      <dl>${SOURCES.map((s) => `<dt>${s.label}</dt><dd>${s.text}</dd>`).join('')}</dl>
      <p>${FOOT_NOTE}</p>
    </footer>`;

  const q = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const crumbList = q<HTMLOListElement>('.crumbs ol');
  const backBtn = q<HTMLButtonElement>('.back');
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
  const isEstimate = () => store.get().year > OFFICIAL_END_YEAR;

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

  function mountPref(pp: string, topology: AppData['japanTopo']): { host: HTMLDivElement; map: Choropleth } {
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

  function showOverlay(content: Node | string | null): void {
    if (content === null) {
      overlay.hidden = true;
      overlay.replaceChildren();
      return;
    }
    overlay.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content);
    overlay.hidden = false;
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

  async function showLevel(s: AppState): Promise<void> {
    const token = ++showToken;
    const level = levelOf(s);
    if (level === 'japan') {
      for (const e of prefMaps.values()) e.host.hidden = true;
      nationalHost.hidden = false;
      showOverlay(null);
      current = national;
      recolor();
      return;
    }
    const pp = s.selectedPref ?? prefOfArea(s.selectedArea!);
    let entry = prefMaps.get(pp);
    if (!entry) {
      showOverlay('地図を読み込んでいます');
      try {
        const topo = await loadPrefGeo(pp);
        if (token !== showToken) return;
        entry = mountPref(pp, topo);
      } catch (e) {
        if (token !== showToken) return;
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
      showOverlay(null);
    }
    for (const [k, e] of prefMaps) e.host.hidden = k !== pp;
    nationalHost.hidden = true;
    current = entry.map;
    recolor();
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

  function renderHeadline(s: AppState): void {
    const level = levelOf(s);
    let name = '日本';
    let row: Float64Array | undefined = totals.japan;
    if (level === 'pref') {
      const pp = s.selectedPref!;
      name = data.prefNames.get(pp) ?? pp;
      row = totals.pref.get(pp);
    } else if (level === 'area') {
      const code = s.selectedArea!;
      name = areaByCode.get(code)?.name ?? code;
      row = totals.area.get(code);
    }
    headName.textContent = name;
    const st = statsOf(row);
    if (!st) {
      headNum.textContent = '';
      return;
    }
    const b = document.createElement('b');
    b.textContent = formatPop(st.pop);
    const badge = document.createElement('span');
    badge.className = isEstimate() ? 'badge-estimate' : 'badge-official';
    badge.textContent = isEstimate() ? ESTIMATE_BADGE : OFFICIAL_BADGE;
    headNum.replaceChildren(
      document.createTextNode(`${s.year}年 `),
      b,
      document.createTextNode(`　2020年比 ${formatPct(st.ratio)}　`),
      badge,
    );
  }

  backBtn.addEventListener('click', () => store.set(goUp(store.get())));

  mountSearch(q<HTMLDivElement>('.search-slot'), {
    index: buildSearchIndex(data.areas, data.prefNames),
    onPick: (e) => store.set(e.kind === 'pref' ? pickPref(e.code) : pickArea({ code: e.code, prefCode: e.prefCode })),
  });
  mountLegend(q<HTMLDivElement>('.legend-slot'));
  const slider = mountYearSlider(q<HTMLDivElement>('.year-slot'), {
    year: store.get().year,
    onChange: (year) => store.set({ year }),
  });

  store.subscribe((s, prev) => {
    if (s.series !== prev.series) totals = deriveTotals(s.series, data.groups);
    const selChanged = s.selectedPref !== prev.selectedPref || s.selectedArea !== prev.selectedArea;
    if (selChanged) {
      renderPlace(s);
      void showLevel(s);
    }
    if (s.year !== prev.year) slider.update(s.year);
    if (s.year !== prev.year || s.series !== prev.series) recolor();
    renderHeadline(s);
  });

  const s0 = store.get();
  renderPlace(s0);
  renderHeadline(s0);
  void showLevel(s0);
}
