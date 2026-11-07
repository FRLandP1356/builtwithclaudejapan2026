// Application shell: loads the data, creates the store and runner, mounts the maps, the year slider, the search,
// the panel slots (#panel-facts, #panel-board, #panel-town, #panel-controls, #panel-allocation, #panel-ai; Ruling 25)
// and the footer (#panel-sources).
// The first screen shows only what matters most (the owner, 2026-11-06): the title and the question, the map with
// its year and legend, the board (分かれ目) and, for a town, its four numbers. Everything else is the lower layer: the
// town panel, the assumptions, the allocation, the AI and the sources are folded cards standing under the heading
// 「くわしく見る」, each a light row (name and a few grey words) until its row is pressed; then it opens as a card.
// While `store.get().allocation` is set the maps colour by the allocation's change in percent, draw rings on the towns
// that crossed a focused facility's guide and count markers per prefecture, and the headline says 割り振り後.
// Otherwise a segmented control above the map chooses what the maps colour by (`store.get().mapMode`): the change since
// 2020 (default) or the support ratio, people aged 15-64 per person aged 65+; the headline, the tooltips, the areas'
// labels and the legend follow it. The control is hidden while an allocation is drawn (the allocation wins).
import type { Topology } from 'topojson-specification';
import { loadAll, loadPrefGeo, type AppData, type LoadOptions } from '../data/loader';
import { createRunner } from '../data/runner';
import type { Choropleth, TooltipContent } from '../map/choropleth';
import { allocationColor, changeColor, supportColor } from '../map/colors';
import { mountLegend } from '../map/legend';
import { mountNationalMap } from '../map/nationalMap';
import { mountPrefectureMap } from '../map/prefectureMap';
import { mountAllocation } from './allocationPanel';
import { BOARD_TITLE } from './board';
import { mountBoardPanel } from './boardPanel';
import { mountControls } from './controls';
import { allocationLines, allocationView, changeOf, countMarkers, figureChanged, placeNumbers, type AllocationView, type PlaceKind, type PlaceNumbers } from './allocationView';
import { deriveSupport, deriveTotals, ratioAt, yearIndex, type SupportRatios, type Totals } from './derive';
import { formatPct, formatPop, formatSupport } from './format';
import { breadcrumbs, buildSearchIndex, goUp, levelOf, pickArea, pickPref, prefOfArea, type Selection } from './nav';
import { mountSearch } from './search';
import { phrases } from './phrases';
import { mountAIPanel } from './aiPanel';
import { mountPlaceFacts } from './placeFacts';
import { allocatedBasisNote, APP_LEAD, APP_PROBLEM, APP_TITLE, badgeFor, ESTIMATE_BADGE, FOOT_NOTE, NAV_DESCRIPTIONS, NAV_SUMMARIES, NAV_TITLE, SOURCES, type SourceLine } from './sources';
import { createAppStore, DEFAULT_YEAR, MAP_MODES, type AllocationOverlay, type AppState, type MapMode, type PanelContext, type Store } from './state';
import { MAP_MODE_GROUP, MAP_MODE_LABELS, SUPPORT_LABEL, support2020Line, supportLine } from './support';
import { mountTownPanel } from './townPanel';
import { mountYearSlider } from './yearSlider';

export { DEFAULT_YEAR };

/** The footer's id and title: the sources, folded like the other parts of the lower layer. */
export const SOURCES_PANEL = { id: 'panel-sources', title: '出典' } as const;

export interface AppOptions extends LoadOptions {
  /** Cache for prefecture topologies (tests pass their own so apps do not share state). */
  prefGeoCache?: Map<string, Promise<Topology>>;
}

export interface AppHandle {
  store: Store;
  ctx: PanelContext;
  destroy(): void;
}

/** The panel slots, in mobile order. Each is a `<section class="panel">` that already holds its `h2.panel-title`. */
export interface PanelSlots {
  /** The four numbers of a town (hidden for the country and a prefecture), above the board. */
  facts: HTMLElement;
  /** 「分かれ目」: when, where and what falls below its population guide. The first card of the column. */
  board: HTMLElement;
  town: HTMLElement;
  controls: HTMLElement;
  allocation: HTMLElement;
  ai: HTMLElement;
}

interface PanelSpec {
  key: keyof PanelSlots;
  id: string;
  title: string;
  /** The lower layer: folded at first, a light row under 「くわしく見る」 whose title is the button that opens it. */
  folded: boolean;
}

const PANEL_TITLES: ReadonlyArray<PanelSpec> = [
  { key: 'facts', id: 'panel-facts', title: '', folded: false },
  { key: 'board', id: 'panel-board', title: BOARD_TITLE, folded: false },
  { key: 'town', id: 'panel-town', title: '町の詳細', folded: true },
  { key: 'controls', id: 'panel-controls', title: '前提を変える', folded: true },
  { key: 'allocation', id: 'panel-allocation', title: '人口の割り振り', folded: true },
  { key: 'ai', id: 'panel-ai', title: 'AIに質問', folded: true },
];

export const ALLOC_BADGE = '割り振り後';
export const ALLOC_CLEAR = '割り振りを地図から消す';
/** The skip link at the start of the map: a keyboard user can leave the map without tabbing through it. */
export const SKIP_TO_YEAR = '地図をとばして、年の選択へ';

// -----------------------------------------------------------------------------------------------------------------
// Panel registry: one mount call per slot; each returns its teardown, which `destroy()` calls.
// -----------------------------------------------------------------------------------------------------------------
function mountPanels(ctx: PanelContext, slots: PanelSlots): Array<() => void> {
  const teardowns: Array<() => void> = [];
  teardowns.push(mountPlaceFacts(slots.facts, ctx));
  teardowns.push(mountBoardPanel(slots.board, ctx));
  teardowns.push(mountTownPanel(slots.town, ctx));
  teardowns.push(mountControls(slots.controls, ctx));
  teardowns.push(mountAllocation(slots.allocation, ctx));
  teardowns.push(mountAIPanel(slots.ai, ctx));
  return teardowns;
}
// -----------------------------------------------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Text as no-break phrases (`.keep`), so a line breaks between phrases, not inside 「R2JHf 450」 or 「（2026年11月5日取得）」. */
function phraseHtml(text: string): string {
  return phrases(text)
    .map((p) => `<span class="keep">${escapeHtml(p)}</span>`)
    .join('');
}

/** One footer entry: what it is, then the page as a link whose text is the URL, the day it was read, and the approval line. */
export function sourceHtml(s: SourceLine): string {
  const link = `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.url)}</a>`;
  const approval = s.approval ? `<span class="src-approval">${phraseHtml(s.approval)}</span>` : '';
  return `<dt>${escapeHtml(s.label)}</dt><dd><span class="src-text">${phraseHtml(s.text)}</span><span class="src-where">${link} ${phraseHtml(`（${s.retrieved}取得）`)}</span>${approval}</dd>`;
}

/** The band: the title and the question the app starts from, nothing else (the one-line description is in the sources card). */
function headerHtml(): string {
  return `<header class="app-head"><div class="app-head-inner"><h1 class="app-title">${APP_TITLE}</h1><p class="app-problem">${phraseHtml(APP_PROBLEM)}</p></div></header>`;
}

/**
 * The lower layer under the board: the heading 「くわしく見る」 and, under it, the folded cards (`cards`, already
 * rendered) in page order, the sources last. Each card's one-line description for a screen reader stands right before
 * the card (`aria-describedby` from the card's title button; clipped from the screen), outside it, so no panel's own
 * content and no panel's name is touched by it, and the last card is the list's last child.
 */
function moreHtml(cards: ReadonlyArray<{ id: string; html: string }>): string {
  const items = cards.map((c) => `<span class="sr-only app-more-desc" id="${c.id}-more-desc">${escapeHtml(NAV_DESCRIPTIONS[c.id] ?? '')}</span>${c.html}`).join('');
  return `<section class="app-more" aria-labelledby="app-more-title"><h2 class="app-more-title" id="app-more-title">${NAV_TITLE}</h2><div class="app-more-list">${items}</div></section>`;
}

/**
 * The title band of a card: a plain heading, or (folded parts) a button that opens and closes the card. The button's
 * name is the title alone; the few grey words after it are for the eye only (the fuller sentence is the button's
 * description, see `moreHtml`), so the card's own name stays its title.
 */
function panelTitleHtml(id: string, title: string, folded: boolean): string {
  const inner = folded
    ? `<button type="button" class="panel-toggle" aria-expanded="false" aria-describedby="${id}-more-desc"><span class="panel-toggle-name">${title}</span><span class="panel-toggle-line" aria-hidden="true">${escapeHtml(NAV_SUMMARIES[id] ?? '')}</span></button>`
    : title;
  return `<h2 class="panel-title" id="${id}-title">${inner}</h2>`;
}

function panelHtml(p: PanelSpec): string {
  const cls = ['panel', p.folded ? 'is-collapsed' : '', p.key === 'facts' ? 'place-facts' : ''].filter(Boolean).join(' ');
  const hidden = p.key === 'facts' ? ' hidden' : '';
  return `<section class="${cls}" id="${p.id}" aria-labelledby="${p.id}-title"${hidden}>${panelTitleHtml(p.id, p.title, p.folded)}</section>`;
}

/** The sources: a folded card like the rest of the lower layer, the last row under 「くわしく見る」. */
function sourcesHtml(): string {
  return `<footer class="app-foot panel is-collapsed" id="${SOURCES_PANEL.id}" aria-labelledby="${SOURCES_PANEL.id}-title">
      ${panelTitleHtml(SOURCES_PANEL.id, SOURCES_PANEL.title, true)}
      <p class="app-foot-lead">${APP_LEAD}</p>
      <dl>${SOURCES.map(sourceHtml).join('')}</dl>
      <p>${FOOT_NOTE}</p>
    </footer>`;
}

/** `<main>` stays a plain landmark; the live region is a child. */
function renderLoading(root: HTMLElement): void {
  root.innerHTML = `${headerHtml()}
    <div class="app-inner"><main>
      <div class="load-skeleton" role="status" aria-live="polite">
        <p class="load-status">データを読み込んでいます（約2MB）</p>
        <div class="skeleton skeleton-line" style="width:40%"></div>
        <div class="skeleton skeleton-map"></div>
        <div class="skeleton skeleton-line" style="width:70%"></div>
      </div>
    </main></div>`;
}

function renderError(root: HTMLElement, err: unknown, retry: () => void): void {
  const detail = err instanceof Error ? err.message : String(err);
  root.innerHTML = `${headerHtml()}
    <div class="app-inner"><main>
      <div class="load-error" role="alert">
        <h2>データを読み込めませんでした</h2>
        <p>${escapeHtml(detail)}</p>
        <p>通信の状態を確かめてから、もう一度お試しください。</p>
        <button type="button" class="btn btn-primary" id="retry">もう一度読み込む</button>
      </div>
    </main></div>`;
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

/** Input types that take no typed text: Esc has no meaning in them, so it may clear the allocation from there. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file', 'color']);

/**
 * Whether Esc, pressed with focus on `el`, already means something there: a text field (clearing it or closing its
 * list), a select (closing its list) or an editable region. A range slider or a checkbox does not use Esc.
 */
function escapeBelongsToField(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  return el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type);
}

/** An open dialog closes itself on Esc (and keeps focus inside it), so the allocation stays. */
function dialogIsOpen(doc: Document): boolean {
  return doc.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') !== null;
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
  let supports: SupportRatios = deriveSupport(store.get().series, data.groups);

  // The right column: the town's numbers, the board, then the lower layer (the folded cards and the sources under
  // the heading 「くわしく見る」).
  const column = [
    ...PANEL_TITLES.filter((p) => !p.folded).map(panelHtml),
    moreHtml([...PANEL_TITLES.filter((p) => p.folded).map((p) => ({ id: p.id, html: panelHtml(p) })), { id: SOURCES_PANEL.id, html: sourcesHtml() }]),
  ].join('');
  root.innerHTML = `${headerHtml()}
    <div class="app-inner"><main class="app-body">
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
        <div class="map-mode">
          <div class="choice" role="group" aria-label="${MAP_MODE_GROUP}">${MAP_MODES.map(
            (m) => `<button type="button" data-map-mode="${m}" aria-pressed="false">${MAP_MODE_LABELS[m]}</button>`,
          ).join('')}</div>
        </div>
        <div class="map-stage">
          <a class="skip-link" href="#year-range">${SKIP_TO_YEAR}</a>
          <div class="map-host map-host-national"></div>
          <div class="map-overlay" hidden></div>
        </div>
        <div class="map-foot">
          <div class="legend-slot"></div>
          <div class="year-slot"></div>
        </div>
      </section>
      <section class="panel-column" aria-label="詳細">${column}</section>
    </main></div>`;

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
  const skipLink = q<HTMLAnchorElement>('.skip-link');
  const modeBox = q<HTMLDivElement>('.map-mode');
  const modeButtons = [...modeBox.querySelectorAll<HTMLButtonElement>('[data-map-mode]')];
  const stage = q<HTMLDivElement>('.map-stage');
  const nationalHost = q<HTMLDivElement>('.map-host-national');
  const overlay = q<HTMLDivElement>('.map-overlay');

  // ---- allocation overlay: one derived view per overlay and series (allocationView.ts holds the logic) ----------
  let allocView: AllocationView | undefined;
  function allocViewFor(a: AllocationOverlay | undefined): AllocationView | undefined {
    if (!a) return (allocView = undefined);
    if (allocView?.overlay !== a) allocView = allocationView(a, totals, data.groups);
    return allocView;
  }
  const numbersOf = (kind: PlaceKind, code: string): PlaceNumbers | undefined =>
    placeNumbers(totals, store.get().year, kind, code, allocViewFor(store.get().allocation));
  const isEstimate = () => badgeFor(store.get().year).estimate;
  /** 「（割り振り前 471人）」 while the numbers include the allocation and it shows a different number, else ''. */
  const beforeText = (n: PlaceNumbers) =>
    n.allocated && formatPop(n.popBefore) !== formatPop(n.pop) ? `（割り振り前 ${formatPop(n.popBefore)}）` : '';
  const popText = (n: PlaceNumbers) => `${formatPop(n.pop)}${beforeText(n)}`;

  // ---- support ratio mode: the map, the headline, the tooltips and the labels say the ratio instead -----------------
  /** Whether the maps show the support ratio now (an allocation on the map takes precedence). */
  const supportShown = (s: AppState = store.get()) => s.mapMode === 'support' && !s.allocation;
  /** The support ratio of a place in the year shown and in 2020 (NaN without one). */
  function supportOf(kind: PlaceKind, code: string): { now: number; base: number } {
    const row = kind === 'japan' ? supports.japan : kind === 'pref' ? supports.pref.get(code) : supports.area.get(code);
    const i = yearIndex(supports.years, store.get().year);
    return { now: row && i >= 0 ? row[i] : NaN, base: row ? row[0] : NaN };
  }

  /** Lines added to tooltips and labels while an allocation is drawn. */
  function allocLines(kind: PlaceKind, code: string): string[] {
    const v = allocViewFor(store.get().allocation);
    return v ? allocationLines(v, kind, code, store.get().year) : [];
  }

  function tooltipFor(kind: PlaceKind, code: string, name: string): TooltipContent | null {
    if (supportShown()) {
      const r = supportOf(kind, code);
      return {
        title: name,
        lines: [supportLine(store.get().year, r.now), support2020Line(r.base)],
        badge: isEstimate() ? ESTIMATE_BADGE : undefined,
      };
    }
    const n = numbersOf(kind, code);
    if (!n) return null;
    return {
      title: name,
      lines: [`${store.get().year}年 ${popText(n)}`, `2020年比 ${formatPct(n.ratio)}`, ...allocLines(kind, code)],
      badge: isEstimate() ? ESTIMATE_BADGE : undefined,
      allocBadge: n.allocated ? ALLOC_BADGE : undefined,
    };
  }
  function ariaFor(kind: PlaceKind, code: string, name: string): string {
    if (supportShown()) {
      const r = supportOf(kind, code);
      return `${name}、${supportLine(store.get().year, r.now)}、${support2020Line(r.base)}${isEstimate() ? '（このアプリの試算）' : ''}`;
    }
    const n = numbersOf(kind, code);
    if (!n) return name;
    const marks = `${isEstimate() ? '（このアプリの試算）' : ''}${n.allocated ? `（${ALLOC_BADGE}）` : ''}`;
    const base = `${name}、${store.get().year}年 ${popText(n)}、2020年比 ${formatPct(n.ratio)}${marks}`;
    const extra = allocLines(kind, code);
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
      current.update((code) => allocationColor(changeOf(v, kind, code), v.scale));
      current.setRings(isNational ? [] : v.gained, isNational ? [] : v.lost);
      current.setMarkers(isNational ? countMarkers(v) : []);
    } else if (supportShown(s)) {
      const rows = isNational ? supports.pref : supports.area;
      current.update((code) => supportColor(i < 0 ? NaN : (rows.get(code)?.[i] ?? NaN)));
      current.setRings([], []);
      current.setMarkers([]);
    } else {
      const rows = isNational ? totals.pref : totals.area;
      current.update((code) => changeColor(i < 0 ? NaN : ratioAt(rows.get(code) ?? new Float64Array(0), i)));
      current.setRings([], []);
      current.setMarkers([]);
    }
    current.setSelected(level === 'area' && !isNational ? s.selectedArea : undefined);
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

  /**
   * Name, year, population, ratio and marks: the 試算 / 公式推計 / 実績 mark, plus 割り振り後 when the numbers include an
   * allocation; up to 2050 that replaces the 公式推計 / 実績 mark with a note that it is this app's own calculation.
   */
  function renderHeadline(s: AppState): void {
    const place = placeOf(s);
    headName.textContent = place.name;
    if (supportShown(s)) {
      renderSupportHeadline(s, place);
      return;
    }
    const n = numbersOf(place.kind, place.code);
    if (!n) {
      headNum.textContent = '';
      return;
    }
    const b = document.createElement('b');
    b.textContent = formatPop(n.pop);
    const badgeInfo = badgeFor(s.year);
    // While the numbers include the allocation, the number without it stays in sight (the town panel shows that one).
    const before = beforeText(n); // the country's total does not change: no second number there
    // Phrases that must not break inside (「2020年 / 比」 at 390px): each is one nowrap span; lines break between them.
    const keep = (...nodes: Array<Node | string>) => {
      const span = document.createElement('span');
      span.className = 'head-keep';
      span.append(...nodes);
      return span;
    };
    const parts: Node[] = [keep(`${s.year}年 `, b)];
    if (before) parts.push(keep(before));
    parts.push(document.createTextNode('　'), keep(`2020年比 ${formatPct(n.ratio)}`), document.createTextNode('　'));
    // An allocation up to 2050 that changes this place's figure makes it this app's own calculation: the 公式推計 / 実績
    // mark would be wrong, so 割り振り後 comes with a note on what it is based on instead. Where the figure cannot change
    // (the whole country) the original mark stays. After 2050 the 試算 mark stays and 割り振り後 follows.
    const basisNote = figureChanged(n) ? allocatedBasisNote(s.year) : undefined;
    if (!basisNote) {
      const badge = document.createElement('span');
      badge.className = badgeInfo.estimate ? 'badge-estimate' : 'badge-official';
      badge.textContent = badgeInfo.text;
      parts.push(badge);
    }
    if (n.allocated) {
      const alloc = document.createElement('span');
      alloc.className = 'badge-alloc';
      alloc.textContent = ALLOC_BADGE;
      if (!basisNote) parts.push(document.createTextNode(' '));
      parts.push(alloc);
      if (basisNote) {
        const note = keep(basisNote);
        note.classList.add('head-basis');
        parts.push(document.createTextNode(' '), note);
      }
    }
    headNum.replaceChildren(...parts);
  }

  /** In the support ratio mode: 「2050年 高齢者1人を支える現役世代 1.4人　2020年は2.1人　公式推計」 for the place shown. */
  function renderSupportHeadline(s: AppState, place: { kind: PlaceKind; code: string }): void {
    const r = supportOf(place.kind, place.code);
    const b = document.createElement('b');
    b.textContent = formatSupport(r.now);
    const keep = (...nodes: Array<Node | string>) => {
      const span = document.createElement('span');
      span.className = 'head-keep';
      span.append(...nodes);
      return span;
    };
    const info = badgeFor(s.year);
    const badge = document.createElement('span');
    badge.className = info.estimate ? 'badge-estimate' : 'badge-official';
    badge.textContent = info.text;
    headNum.replaceChildren(
      keep(`${s.year}年 ${SUPPORT_LABEL} `, b),
      document.createTextNode('　'),
      keep(support2020Line(r.base)),
      document.createTextNode('　'),
      badge,
    );
  }

  /** The colour-mode control: the pressed button follows the store; hidden while an allocation is drawn. */
  function renderMapMode(s: AppState): void {
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mapMode === s.mapMode));
    const hide = s.allocation !== undefined;
    if (hide === modeBox.hidden) return;
    // Do not leave keyboard focus on a button that goes away.
    const hadFocus = hide && modeBox.contains(document.activeElement);
    modeBox.hidden = hide;
    if (hadFocus) headName.focus({ preventScroll: true });
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
    if (supportShown(s)) {
      const r = supportOf(place.kind, place.code);
      placeStatus.textContent = `${place.name}、${supportLine(s.year, r.now)}、${support2020Line(r.base)}`;
      return;
    }
    const n = numbersOf(place.kind, place.code);
    placeStatus.textContent = n
      ? `${place.name}、${s.year}年 ${popText(n)}、2020年比 ${formatPct(n.ratio)}${n.allocated ? `（${ALLOC_BADGE}）` : ''}`
      : place.name;
  }

  const ac = new AbortController();
  // ---- the lower layer: folded cards under 「くわしく見る」, opened and closed by their title buttons ------------------
  /** Open or fold a card: the class hides everything but the title band; the button says which it is. */
  function setFolded(panel: HTMLElement, folded: boolean): void {
    panel.classList.toggle('is-collapsed', folded);
    panel.querySelector<HTMLButtonElement>(':scope > .panel-title > .panel-toggle')?.setAttribute('aria-expanded', String(!folded));
  }
  /** Open a card, bring it to the top of the window and land keyboard focus on its title. */
  function goToPanel(id: string): void {
    const panel = root.querySelector<HTMLElement>(`#${id}`);
    if (!panel) return;
    setFolded(panel, false);
    const win = root.ownerDocument.defaultView;
    const reduce = typeof win?.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    // Land keyboard focus on the panel's title (its button, where there is one), so a screen reader reads where it is
    // and that it is open (the scroll is above).
    const toggle = panel.querySelector<HTMLElement>(':scope > .panel-title > .panel-toggle');
    const title = toggle ?? panel.querySelector<HTMLElement>('h2.panel-title') ?? panel;
    if (!toggle && !title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: true });
  }
  // A closed row's button opens its card and goes to it (the card's top at the top of the window, the focus on this
  // button); an open card's button folds it again, where it is.
  for (const toggle of root.querySelectorAll<HTMLButtonElement>('.panel-toggle')) {
    toggle.addEventListener(
      'click',
      () => {
        const panel = toggle.closest<HTMLElement>('.panel');
        if (!panel) return;
        if (panel.classList.contains('is-collapsed')) goToPanel(panel.id);
        else setFolded(panel, true);
      },
      { signal: ac.signal },
    );
  }
  backBtn.addEventListener('click', () => store.set(goUp(store.get())), { signal: ac.signal });
  allocClear.addEventListener('click', () => store.set({ allocation: undefined }), { signal: ac.signal });
  for (const b of modeButtons) {
    b.addEventListener('click', () => store.set({ mapMode: b.dataset.mapMode as MapMode }), { signal: ac.signal });
  }
  skipLink.addEventListener(
    'click',
    (e) => {
      e.preventDefault(); // focus the slider ourselves: the hash would change the address and jump the page
      slider.focus();
    },
    { signal: ac.signal },
  );
  root.ownerDocument.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !store.get().allocation) return;
      if (escapeBelongsToField(e.target) || dialogIsOpen(root.ownerDocument)) return;
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
    legend.setMode(v ? { kind: 'allocation', scale: v.scale } : supportShown(s) ? { kind: 'support' } : { kind: 'ratio' });
  }

  const slots: PanelSlots = {
    facts: q<HTMLElement>('#panel-facts'),
    board: q<HTMLElement>('#panel-board'),
    town: q<HTMLElement>('#panel-town'),
    controls: q<HTMLElement>('#panel-controls'),
    allocation: q<HTMLElement>('#panel-allocation'),
    ai: q<HTMLElement>('#panel-ai'),
  };
  const panelTeardowns = mountPanels(ctx, slots);

  const unsubscribe = store.subscribe((s, prev) => {
    if (s.series !== prev.series) {
      totals = deriveTotals(s.series, data.groups);
      supports = deriveSupport(s.series, data.groups);
      allocView = undefined; // the overlay year's populations may have changed
    }
    const prefChanged = s.selectedPref !== prev.selectedPref;
    const selChanged = prefChanged || s.selectedArea !== prev.selectedArea;
    const allocChanged = s.allocation !== prev.allocation;
    const modeChanged = s.mapMode !== prev.mapMode;
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
    if (s.year !== prev.year || s.series !== prev.series || allocChanged || modeChanged) recolor();
    if (allocChanged || s.series !== prev.series || modeChanged) updateLegend(s);
    if (allocChanged || modeChanged) renderMapMode(s);
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
  renderMapMode(s0);
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
