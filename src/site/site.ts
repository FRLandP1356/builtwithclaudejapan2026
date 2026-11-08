// The site: hash routes, a global menu on every page, one message to a screen (the second wireframe of 2026-11-08).
//   #/                           home: the map of Japan, 2025 census -> 2100 estimate, once, in six seconds
//   #/meisho, #/meisho/g/<slug>  the famous places, by kind
//   #/meisho/<id>                one place: where it is and a hundred people (A), the eight lights (B), what keeping it
//                                would take (C, only where a guide is undershot), what documents say (D, where there are any)
//   #/chizu[/<pref>[/<town>]]    the map, Japan -> prefecture -> town, with the one search box
//   #/awase[/<town>]             the answer check: the projection against the 2025 census
//   #/ai                         the AI panel (src/ui/aiPanel.ts, as it is)
//   #/about                      where the figures come from
// Every figure comes from src/site/model.ts (the engine and the data files); nothing is typed in here.
import './site.css';
import { dataUrl, loadAll, loadPrefGeo, type AppData } from '../data/loader';
import type { Landmark } from '../data/landmarks';
import { createRunner } from '../data/runner';
import { deviationPct } from '../data/checks';
import { bandIndexFor } from '../data/finance';
import { total } from '../engine/aggregate';
import { projectArea, projectAreaFromActual } from '../engine/project';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { PopulationAt } from '../ui/allocationCore';
import { INFRA_STRENGTH } from '../ui/controls';
import { computeKeep } from '../ui/keepGuide';
import { barRows } from '../ui/burden';
import { mountAIPanel } from '../ui/aiPanel';
import { SITE_SOURCES } from '../ui/sources';
import { createAppStore } from '../ui/state';
import { FRAME_H, FRAME_W, prefectureShapes, project, townShapes, unionBB, viewBoxOf, type ShapeOut } from './geo';
import {
  ACTUAL_YEAR,
  AGE_LABELS,
  answerCheck,
  approx,
  BASE_YEAR,
  buildModel,
  DEVIATION_COLORS,
  DEVIATION_LABELS,
  deviationColorOf,
  END_YEAR,
  figure,
  fmt,
  groupBySlug,
  groupOf,
  GROUPS,
  highestBelow,
  homeHeading,
  INTERIM_LABEL,
  LOW_BIRTH_NOTE,
  lowBirthLegend,
  nationalChangeLine,
  OFFICIAL_END,
  SHARE_COLORS,
  SHARE_LABELS,
  shareColor,
  shownLandmarks,
  signedPct,
  STANDARD_LABEL,
  STANDARD_SERIES,
  standardNation,
  STATUS_LABEL,
  statusOf,
  supportLoad,
  YEARS,
  type Group,
  type Model,
  type Shape,
  type Status,
  type Totals,
  type TownFigures,
} from './model';

/** The series the home map, the heading and the hundred people use (one switch: STANDARD_SERIES in model.ts). */
function std(t: TownFigures): Totals {
  return STANDARD_SERIES === 'lowBirth' ? t.lowBirth : t.trial;
}
const stdNation = (m: Model): Totals => standardNation(m);
function stdPref(m: Model, code: string): Totals | undefined {
  return STANDARD_SERIES === 'lowBirth' ? m.prefLowBirth.get(code) : m.pref.get(code);
}

export const DEFAULT_TOWN = '30206'; // 田辺市: the first town whose 2025 count was taken in
export const HAMAMATSU_NOTE = '浜松市の7つの区は、2024年の区の再編で実績の区分が合わず、2025年は公式推計の値です。その先は、ほかの町と同じ試算です。';
export const ESTIMATE_LINE = '2050年より先の数字は、公式の前提を延ばした、このアプリの試算です。';

const ICONS: Record<string, string> = {
  'jinja-jiin': '<path d="M6 13q18-4 36 0M10 19h28M13 14v27M35 14v27"/>',
  'sekai-isan': '<path d="M14 41h20M17 41V16a7 7 0 0 1 14 0v25M21 22h6M21 28h6M21 34h6"/>',
  bunka: '<path d="M7 41h34M11 41V27h26v14M9 27l15-9 15 9M15 18l9-6 9 6M20 41v-8h8v8"/>',
  'resort-keisho': '<path d="M9 31c0 7 30 7 30 0M12 31c-1-5 3-7 24-7M17 10c-3 4 3 6 0 10M24 8c-3 4 3 6 0 10M31 10c-3 4 3 6 0 10"/>',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const reduced = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const PLAIN: Readonly<Record<Status, string>> = { jisseki: '実際', suikei: '計算', shisan: '計算' };
function chip(status: Status): string {
  return `<span class="chip ${status}">${PLAIN[status]}</span>`;
}
const MORE_TARGET: Readonly<Record<string, string>> = { home: 'sources', meisho: 'sources', hito: 'sources', tsunagari: 'idea', mise: 'idea', futan: 'sources', okane: 'idea', yoryoku: 'not-counted', chizu: 'sources', awase: 'sources', ai: 'sources' };
const more = (key: string): string => `<p class="more"><a href="#/about/${MORE_TARGET[key] ?? 'sources'}">くわしく</a></p>`;

// -----------------------------------------------------------------------------------------------------------------
// Site state (built once after the data is loaded)
// -----------------------------------------------------------------------------------------------------------------

interface Site {
  data: AppData;
  model: Model;
  prefs: ShapeOut[];
  prefByCode: Map<string, ShapeOut>;
  /** Town code -> frame position of its centre (for the landmark points). */
  centre: Map<string, [number, number]>;
  landmarks: Landmark[];
  lmById: Map<string, Landmark>;
  townCache: Map<string, Promise<ShapeOut[]>>;
  loadOpts: { fetch?: typeof fetch; base?: string };
}

function townsOf(site: Site, prefCode: string): Promise<ShapeOut[]> {
  let p = site.townCache.get(prefCode);
  if (!p) {
    p = loadPrefGeo(prefCode, site.loadOpts).then((topo) => townShapes(topo, prefCode));
    site.townCache.set(prefCode, p);
  }
  return p;
}

// -----------------------------------------------------------------------------------------------------------------
// SVG pieces
// -----------------------------------------------------------------------------------------------------------------

function shapeMark(shape: Shape, x: number, y: number, r: number, cls = ''): string {
  const a = cls ? ` class="${cls}"` : '';
  if (shape === 'circle') return `<circle${a} cx="${x}" cy="${y}" r="${r}"/>`;
  if (shape === 'square') return `<rect${a} x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}"/>`;
  if (shape === 'diamond') return `<path${a} d="M${x} ${(y - r * 1.3).toFixed(1)}L${(x + r * 1.3).toFixed(1)} ${y}L${x} ${(y + r * 1.3).toFixed(1)}L${(x - r * 1.3).toFixed(1)} ${y}Z"/>`;
  return `<path${a} d="M${x} ${(y - r * 1.3).toFixed(1)}L${(x + r * 1.25).toFixed(1)} ${(y + r).toFixed(1)}L${(x - r * 1.25).toFixed(1)} ${(y + r).toFixed(1)}Z"/>`;
}

function shapeHtml(shape: Shape): string {
  return `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="vertical-align:-1px">${shapeMark(shape, 6, 6, 3.2).replace(/^<(\w+)/, '<$1 fill="#1b2430"')}</svg>`;
}

function dotsSvg(site: Site, filter: ((l: Landmark) => boolean) | undefined, scale: number): string {
  const seen = new Map<string, number>();
  let out = '';
  for (const l of site.landmarks) {
    const g = groupOf(l.kind);
    if (!g || (filter && !filter(l))) continue;
    const c = site.centre.get(l.areaCode);
    if (!c) continue;
    const n = seen.get(l.areaCode) ?? 0;
    seen.set(l.areaCode, n + 1);
    const ang = n * 2.4;
    const rad = n ? 7 * scale : 0;
    const x = +(c[0] + Math.cos(ang) * rad).toFixed(1);
    const y = +(c[1] + Math.sin(ang) * rad).toFixed(1);
    const name = `${l.name}（${site.model.prefNames.get(l.prefCode) ?? ''}）`;
    out += `<g class="dotg" data-id="${esc(l.id)}" role="button" tabindex="0" aria-label="${esc(name)}"><title>${esc(name)}</title>${shapeMark(g.shape, x, y, 3.4 * scale, 'dot')}<circle class="dot hit" cx="${x}" cy="${y}" r="${12 * scale}"/></g>`;
  }
  return out;
}

interface MapOpts {
  year?: number;
  viewBox?: { vb: string; w: number };
  flat?: boolean;
  linkPref?: boolean;
  sel?: string;
  towns?: ShapeOut[];
  selTown?: string;
  /** Fill of a town by code; default the share of 2025 at `year`. */
  townFill?: (code: string, year: number) => string | undefined;
  prefFill?: (code: string, year: number) => string | undefined;
  filter?: (l: Landmark) => boolean;
  dots?: boolean;
  dotScale?: number;
  label: string;
}

function townShare(site: Site, code: string, year: number): number {
  const t = site.model.town.get(code);
  return t ? std(t)[year] / std(t)[ACTUAL_YEAR] : NaN;
}
function prefShare(site: Site, code: string, year: number): number {
  const p = stdPref(site.model, code);
  return p ? p[year] / p[ACTUAL_YEAR] : NaN;
}

function japanSvg(site: Site, o: MapOpts): string {
  const vb = o.viewBox ? o.viewBox.vb : `0 0 ${FRAME_W} ${FRAME_H}`;
  const vbW = o.viewBox ? o.viewBox.w : FRAME_W;
  const ds = ((o.dotScale ?? 1) * vbW) / FRAME_W;
  const y = o.year ?? ACTUAL_YEAR;
  const prefs = site.prefs
    .map((p) => {
      const fill = o.flat ? '#eceae2' : (o.prefFill?.(p.code, y) ?? shareColor(prefShare(site, p.code, y)));
      const cls = `pref${o.linkPref ? ' link' : ''}${o.sel === p.code ? ' sel' : ''}`;
      const link = o.linkPref ? ' role="button" tabindex="0"' : '';
      return `<path class="${cls}" data-code="${p.code}" d="${p.d}" fill="${fill}"${link}><title>${esc(p.name)}</title></path>`;
    })
    .join('');
  const towns = (o.towns ?? [])
    .map((t) => {
      const fill = o.flat ? '#eceae2' : (o.townFill?.(t.code, y) ?? shareColor(townShare(site, t.code, y)));
      return `<path class="pref link${o.selTown === t.code ? ' sel' : ''}" data-town="${t.code}" d="${t.d}" fill="${fill}" role="button" tabindex="0"><title>${esc(t.name)}</title></path>`;
    })
    .join('');
  const oki = site.prefByCode.get('47');
  const frame = oki && !o.viewBox ? `<rect x="${oki.bb[0] - 14}" y="${oki.bb[1] - 14}" width="${oki.bb[2] - oki.bb[0] + 28}" height="${oki.bb[3] - oki.bb[1] + 28}" fill="none" stroke="#d9d6cc" stroke-width="1"/>` : '';
  return `<svg class="map" viewBox="${vb}" role="img" aria-label="${esc(o.label)}">${frame}<g class="g-prefs">${prefs}</g><g class="g-towns">${towns}</g><g class="g-dots">${o.dots === false ? '' : dotsSvg(site, o.filter, ds)}</g></svg>`;
}

function recolor(site: Site, root: HTMLElement, year: number, townFill?: (code: string, year: number) => string | undefined): void {
  root.querySelectorAll<SVGPathElement>('.pref[data-code]').forEach((el) => {
    el.setAttribute('fill', shareColor(prefShare(site, el.getAttribute('data-code')!, year)));
  });
  root.querySelectorAll<SVGPathElement>('.pref[data-town]').forEach((el) => {
    const code = el.getAttribute('data-town')!;
    el.setAttribute('fill', townFill?.(code, year) ?? shareColor(townShare(site, code, year)));
  });
}

function legendShare(): string {
  return `<div class="lg"><span>2025年に対する人口の割合</span>${SHARE_LABELS.map((l, i) => `<span><i style="background:${SHARE_COLORS[i]}"></i>${l}</span>`).join('')}</div>`;
}

function legendShapes(): string {
  return `<div class="lg">${GROUPS.map((g) => `<span>${shapeHtml(g.shape)}${g.name}</span>`).join('')}</div>`;
}

/** A pressed point opens a small sheet with the name and a 44px button (the points themselves are too small to be the target). */
function wireDots(site: Site, wrap: HTMLElement): void {
  const open = (g: Element): void => {
    const l = site.lmById.get(g.getAttribute('data-id') ?? '');
    if (!l) return;
    wrap.querySelector('.tip')?.remove();
    const tip = document.createElement('div');
    tip.className = 'tip';
    const town = site.model.areaByCode.get(l.areaCode);
    tip.innerHTML = `<span>${esc(l.name)}<br><span class="sm">${esc(site.model.prefNames.get(l.prefCode))} ${esc(town?.name ?? '')}</span></span><a class="btn pri" href="#/meisho/${esc(l.id)}">開く</a>`;
    const r = wrap.getBoundingClientRect();
    const gr = g.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(r.width - 284, gr.left - r.left - 20))}px`;
    tip.style.top = `${Math.max(4, gr.top - r.top - 70)}px`;
    wrap.appendChild(tip);
    tip.querySelector<HTMLAnchorElement>('a')?.focus({ preventScroll: true });
  };
  wrap.addEventListener('click', (e) => {
    const target = e.target as Element;
    const g = target.closest?.('.dotg');
    if (!g) {
      if (!target.closest?.('.tip')) wrap.querySelector('.tip')?.remove();
      return;
    }
    open(g);
  });
  wrap.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = (e.target as Element).closest?.('.dotg');
    if (!g) return;
    e.preventDefault();
    open(g);
  });
}

// -----------------------------------------------------------------------------------------------------------------
// The year control: one slider and a play button; the same on every page that moves
// -----------------------------------------------------------------------------------------------------------------

let players: Array<() => void> = [];
function stopAll(): void {
  for (const f of players) f();
  players = [];
}

function yearControl(id: string, y: number, hasActual: boolean): string {
  return `<div class="yc" id="${id}"><button type="button" class="btn play" aria-label="再生">再生</button><div class="yr"><input type="range" min="${BASE_YEAR}" max="${END_YEAR}" step="5" value="${y}" aria-label="年"><div class="ticks"><span>2020</span><span>2050</span><span>2100</span></div></div><span class="yl"><span class="yv">${y}年</span> <span class="ych">${chip(statusOf(y, hasActual))}</span></span></div>`;
}

function wireYear(id: string, onYear: (y: number) => void, hasActual: boolean): ((y: number) => void) | undefined {
  const el = document.getElementById(id);
  if (!el) return undefined;
  const range = el.querySelector<HTMLInputElement>('input')!;
  const yv = el.querySelector('.yv')!;
  const ych = el.querySelector('.ych')!;
  const play = el.querySelector<HTMLButtonElement>('.play')!;
  let timer: ReturnType<typeof setInterval> | null = null;
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
      play.textContent = '再生';
    }
  };
  const set = (y: number): void => {
    range.value = String(y);
    yv.textContent = `${y}年`;
    ych.innerHTML = chip(statusOf(y, hasActual));
    onYear(y);
  };
  range.addEventListener('input', () => {
    stop();
    set(Number(range.value));
  });
  play.addEventListener('click', () => {
    if (timer) return stop();
    let y = Number(range.value);
    if (y >= END_YEAR) y = BASE_YEAR;
    set(y);
    if (reduced()) return set(END_YEAR);
    play.textContent = '止める';
    timer = setInterval(() => {
      y += 5;
      set(y);
      if (y >= END_YEAR) stop();
    }, 350);
  });
  players.push(stop);
  return set;
}

// -----------------------------------------------------------------------------------------------------------------
// Pages
// -----------------------------------------------------------------------------------------------------------------

type After = () => void;
interface Page {
  html: string;
  after?: After;
  title?: string;
  /** The answer check's one-town chart, served at #/kuwashiku/awase-line. */
  detail?: string;
}

/** The one sentence of the home page, from the standard 2100 figure against 2020 (never a fixed sentence). */
function homeLine(m: Model): string {
  const n = standardNation(m);
  const r = n[END_YEAR] / n[BASE_YEAR];
  const how = r < 0.48 ? '今の半分より少なくなります' : r >= 0.52 ? '今の半分より多く残ります' : '今の約半分になります';
  return `計算では、2100年に日本の人口は、${how}。全部は残せません。あなたは、何を残しますか。`;
}

function pageHome(site: Site): Page {
  const m = site.model;
  const national2025 = m.checks?.census.national ?? m.nation[ACTUAL_YEAR];
  const startY = reduced() ? END_YEAR : ACTUAL_YEAR;
  const readout = (y: number): string => {
    const s = statusOf(y, true);
    const label = PLAIN[s];
    const pop = y === ACTUAL_YEAR ? `${fmt(national2025)}人` : figure(stdNation(m)[y], s);
    return `<div class="y">${y}年</div><div class="s">${label}</div><div class="p">${pop}</div>`;
  };
  const html = `<section class="screen"><div class="wrap hero">
    <div><h1>${homeLine(m)}</h1>
    <div id="homeCtl" hidden>${yearControl('homeYear', END_YEAR, true)}</div></div>
    <div class="mapwrap" id="homeMap">${japanSvg(site, { year: startY, label: '日本の地図。2025年の実績から2100年の試算へ、人口の色が薄くなる' })}<div class="ro" id="ro" aria-live="polite">${readout(startY)}</div>${legendShare()}${legendShapes()}${more('home')}</div>
  </div></section>`;
  const after: After = () => {
    const wrap = document.getElementById('homeMap')!;
    wireDots(site, wrap);
    const ro = document.getElementById('ro')!;
    const show = (y: number): void => {
      recolor(site, wrap, y);
      ro.innerHTML = readout(y);
    };
    const ctl = document.getElementById('homeCtl')!;
    const done = (): void => {
      ctl.hidden = false;
      wireYear('homeYear', show, true);
      const play = ctl.querySelector<HTMLButtonElement>('.play')!;
      play.textContent = 'もう一度';
      play.setAttribute('aria-label', 'もう一度');
    };
    if (reduced()) {
      show(END_YEAR);
      done();
      return;
    }
    // one orchestrated run: 2025 -> 2100, 15 steps of 0.4 s, then it stops
    const steps = YEARS.filter((y) => y >= ACTUAL_YEAR);
    let i = 0;
    const t = setInterval(() => {
      i++;
      if (i >= steps.length) {
        clearInterval(t);
        done();
        return;
      }
      show(steps[i]);
    }, 400);
    players.push(() => clearInterval(t));
  };
  return { html, after };
}

function pageMeisho(site: Site, slug: string | undefined): Page {
  const g = groupBySlug(slug);
  if (slug && !g) return page404();
  const cnt = new Map<string, number>();
  for (const l of site.landmarks) {
    const gg = groupOf(l.kind)!;
    cnt.set(gg.slug, (cnt.get(gg.slug) ?? 0) + 1);
  }
  const list = site.landmarks.filter((l) => !g || groupOf(l.kind) === g).sort((a, b) => a.prefCode.localeCompare(b.prefCode));
  const html = `<section class="screen"><div class="wrap">
    <h1>${g ? `${esc(g.name)} ${cnt.get(g.slug) ?? 0}件。` : `日本らしいところ ${site.landmarks.length}件。`}地図の点の形は、この4つの種類です。</h1>
    <p class="lead">残す対象は、名勝・名物・観光地・食・建物・衣装など、日本らしいもの。</p>${more('meisho')}
    <div class="kinds" role="group" aria-label="名所の種類">${GROUPS.map(
      (x) => `<button type="button" data-slug="${x.slug}" aria-pressed="${g === x}"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[x.slug]}</svg><span class="n">${x.name}</span><span class="c">${cnt.get(x.slug) ?? 0}件 ${shapeHtml(x.shape)}</span></button>`,
    ).join('')}</div>
    <div class="two"><div class="mapwrap" id="meishoMap">${japanSvg(site, { flat: true, filter: g ? (l) => groupOf(l.kind) === g : undefined, label: '名所の点を置いた日本の地図' })}</div>
    <div><p class="sm">${g ? esc(g.kinds.join('、')) : '種類を押すと、その種類だけを地図に出します。'}</p><ul class="names">${list
      .map((l) => `<li><a href="#/meisho/${esc(l.id)}">${esc(l.name)}</a><span class="pf">${esc(site.model.prefNames.get(l.prefCode))}</span></li>`)
      .join('')}</ul></div></div>
  </div></section>`;
  const after: After = () => {
    wireDots(site, document.getElementById('meishoMap')!);
    document.querySelectorAll<HTMLButtonElement>('.kinds button').forEach((b) => {
      b.addEventListener('click', () => {
        location.hash = b.getAttribute('aria-pressed') === 'true' ? '#/meisho' : `#/meisho/g/${b.dataset.slug}`;
      });
    });
  };
  return { html, after, title: g ? g.name : '名所' };
}

const personSvg = (): string => '<svg viewBox="0 0 10 22" aria-hidden="true"><circle cx="5" cy="3" r="2.6"/><path d="M1.6 7h6.8v7H6.9v7.4H3.1V14H1.6z"/></svg>';

/** Every area's population in `year` (the standard series), for the what-if of 「ここを残すには」. */
function populationAtYear(site: Site, year: number): PopulationAt {
  const popByArea = new Map<string, number>();
  const areaPref = new Map<string, string>();
  for (const a of site.model.areas) {
    popByArea.set(a.code, std(site.model.town.get(a.code)!)[year]);
    areaPref.set(a.code, a.prefCode);
  }
  return { popByArea, areaPref };
}

const WORKING = '働く人（15〜64歳）';

/** 「今の約6分の1（17%）」 or 「今の約70%」 for a ratio to 2025. */
function fractionText(ratio: number): string {
  const pct = Math.round(ratio * 100);
  if (ratio >= 0.5) return `今の約${pct}%`;
  return `今の約${Math.round(1 / ratio)}分の1（${pct}%）`;
}

function pageLandmark(site: Site, id: string): Page {
  const l = site.lmById.get(id);
  if (!l) return page404();
  const m = site.model;
  const area = m.areaByCode.get(l.areaCode)!;
  const t = m.town.get(l.areaCode)!;
  const s = std(t);
  const claims = (site.data.claims ?? []).filter((c) => c.prefCodes.includes(l.prefCode)).slice(0, 2);
  const pref = site.prefByCode.get(l.prefCode)!;
  const share2100 = Math.round((s[END_YEAR] / s[ACTUAL_YEAR]) * 100);
  const ages = m.standardSeries.get(l.areaCode)!;
  const fin = site.data.finance;
  const facById = new Map(m.facilities.map((f) => [f.id, f]));
  // the runs where the loss of a place of daily life speeds the outflow (an assumption of this app, from 2050 on)
  const scen = (k: 'weak' | 'strong') => ({ ...DEFAULT_SCENARIO, infraStrength: INFRA_STRENGTH[k] });
  const run2100 = (k: 'weak' | 'strong'): number => {
    const sc = scen(k);
    const r = area.actual ? projectAreaFromActual(area, sc, END_YEAR, site.data.facilities, m.birthsFactor) : projectArea(area, sc, END_YEAR, site.data.facilities);
    return total(r[END_YEAR]);
  };
  const chain = area.assumptions ? { weak: run2100('weak'), strong: run2100('strong') } : undefined;
  const belowCount = (p: number): number => m.facilities.filter((f) => p < f.p50).length;
  const firstBelow = ((): { year: number; n: number } | undefined => {
    for (const y of YEARS) {
      const n = belowCount(s[y]);
      if (n > 0) return { year: y, n };
    }
    return undefined;
  })();
  const nat25 = supportLoad(m.nationStandardAges[ACTUAL_YEAR]).perWorker;
  const nat100 = supportLoad(m.nationStandardAges[END_YEAR]).perWorker;
  const rows = barRows(fin);
  const band25 = bandIndexFor(fin.bands, Math.round(s[ACTUAL_YEAR]));

  const A = `<section class="screen" id="sec-people"><div class="wrap">
    <h1>${esc(l.name)}のある${esc(area.name)}（${esc(area.prefName)}）は、2100年に人が${fractionText(s[END_YEAR] / s[ACTUAL_YEAR])}になります。</h1>
    <p class="lead">残すのは、人です。</p>
    <div class="two"><div class="mapwrap" id="lmMap">${japanSvg(site, { viewBox: viewBoxOf(pref.bb, 30), sel: l.prefCode, filter: (o) => o.id === l.id, dotScale: 2.2, label: `${pref.name}の地図` })}${legendShare()}<p class="map-note" id="lmMapNote">町の境界を読み込んでいます。</p></div>
    <div><div class="people" id="people" aria-label="100人の並び">${Array.from({ length: 100 }, (_, i) => `<span class="p" data-i="${i}">${personSvg()}</span>`).join('')}</div>
    <p style="margin:16px 0 0"><span class="bign num" id="lmPop">${figure(s[ACTUAL_YEAR], statusOf(ACTUAL_YEAR, t.hasActual))}</span> <span id="lmChip">${chip(statusOf(ACTUAL_YEAR, t.hasActual))}</span><br><span class="sm">1人＝2025年の人口の1%。2025年までは実際、その先は計算。</span></p>${more('hito')}</div></div>
  </div></section>`;

  const ICO: Record<string, string> = {
    place: ICONS[groupOf(l.kind)?.slug ?? 'jinja-jiin'],
    people: '<circle cx="17" cy="14" r="5"/><path d="M9 40v-9a8 8 0 0 1 16 0v9M31 40v-7a6 6 0 0 1 12 0v7"/><circle cx="37" cy="21" r="4"/>',
    places: '<path d="M8 40V20l16-10 16 10v20H8zM20 40V30h8v10M8 20h32"/>',
    out: '<path d="M10 24h22M26 16l8 8-8 8M38 10v28"/>',
    load: '<circle cx="24" cy="12" r="5"/><path d="M14 40v-10a10 10 0 0 1 20 0v10M6 20l8-4M42 20l-8-4"/>',
    cost: '<ellipse cx="24" cy="14" rx="14" ry="5"/><path d="M10 14v10c0 3 6 5 14 5s14-2 14-5V14M10 24v10c0 3 6 5 14 5s14-2 14-5V24"/>',
    keep: '<path d="M24 8v32M8 16h32M12 16l-6 12h12l-6-12zM36 16l-6 12h12l-6-12zM16 40h16"/>',
  };
  const dimFrom = firstBelow === undefined; // nothing is under a guide to 2100: the chain thins out after 暮らしの場
  const node = (target: string, key: string, title: string, valueId: string, hint: string, dim = false): string =>
    `<li class="step${dim ? ' dim' : ''}"><button type="button" class="node" data-go="${target}"><svg class="ico" viewBox="0 0 48 48" aria-hidden="true">${ICO[key]}</svg><span class="node-main"><span class="node-t">${title}</span><span class="node-v num" id="${valueId}"></span></span><span class="node-h">${hint}</span></button></li>`;
  const arrow = (label: string, dim = false): string => `<li class="step-arrow${dim ? ' dim' : ''}" aria-hidden="true"><span>${label}</span></li>`;
  const strip = YEARS.filter((y) => y >= ACTUAL_YEAR)
    .map((y) => `<span class="yb" data-y="${y}" style="height:${Math.max(4, Math.round((s[y] / s[ACTUAL_YEAR]) * 100))}%" title="${y}年 ${figure(s[y], statusOf(y, t.hasActual))}"></span>`)
    .join('');
  const CHAIN = `<section class="screen" id="sec-chain"><div class="wrap">
    <h2>人が減ると、病院や店などが成り立たなくなり、人がさらに減り、残った人の負担が増えます。</h2>
    <p class="lead">${esc(area.name)}の数字で、つながりを1枚に。段を押すと、その説明へ。</p>
    <div class="chain-wrap"><ol class="steps">
      ${node('sec-people', 'place', esc(l.name), 'nd-place', '残すのは、人')}
      ${arrow('担い手')}
      ${node('sec-people', 'people', '人', 'nd-pop', `${esc(area.name)}の人口`)}
      ${arrow('成り立つか')}
      ${node('sec-places', 'places', '病院や店など', 'nd-places', '8種のうち、成り立たなくなる数')}
      ${arrow('足りなければ', dimFrom)}
      ${node('sec-places', 'out', '人がさらに減る', 'nd-out', '2100年の人口（計算、弱〜強）', dimFrom)}
      ${arrow('残すなら', dimFrom)}
      ${node('sec-support', 'load', '働く人1人の負担', 'nd-load', `${WORKING}1人が支える人の数`, dimFrom)}
      ${arrow('費用は', dimFrom)}
      ${node('sec-cost', 'cost', '町が1人に使うお金', 'nd-cost', '同じ大きさの町の実際（1年）', dimFrom)}
      ${arrow('そのぶん', dimFrom)}
      ${node('sec-keep', 'keep', 'ほかを残す余力', 'nd-keep', 'ここを保つ人数と、ほかの何町', dimFrom)}
    </ol>
    <div class="trend" aria-label="${esc(area.name)}の人口、2025年から2100年"><div class="sm">人口の推移（2025年＝100）</div><div class="ybars">${strip}</div><div class="ticks"><span>2025</span><span>2050</span><span>2075</span><span>2100</span></div><div class="sm" id="trendNote"></div></div></div>${more('tsunagari')}
  </div></section>`;

  const PLACES = `<section class="screen" id="sec-places"><div class="wrap">
    <h2>病院や店などが成り立たなくなると、住みにくくなり、人がさらに減ります。</h2>
    <p class="lead">明かりは、${esc(area.name)}の人口で成り立つかどうか。年を動かすと消えます。</p>
    <div class="lamps" id="lamps">${m.facilities
      .map((f) => `<div class="lamp" data-id="${esc(f.id)}"><svg viewBox="0 0 48 60" aria-hidden="true"><circle class="bulb" cx="24" cy="22" r="16"/><path d="M18 42h12M20 48h8M24 38v4" stroke="#5b6470" stroke-width="1.5" fill="none"/></svg>${esc(f.name)}<span class="th">${fmt(f.p50)}人で成り立つ</span></div>`)
      .join('')}</div>
    ${chain ? `<div class="three"><div class="box"><div class="sm">2100年の人（計算）</div><div class="v num">${approx(s[END_YEAR])}</div></div><div class="box"><div class="sm">人がさらに減る場合・弱</div><div class="v num dec">${approx(chain.weak)}</div></div><div class="box"><div class="sm">人がさらに減る場合・強</div><div class="v num dec">${approx(chain.strong)}</div></div></div>` : `<p class="sm">${esc(area.name)}は、人がさらに減る場合の計算ができない村です。</p>`}${more('mise')}
  </div></section>`;

  const SUPPORT = `<section class="screen" id="sec-support"><div class="wrap">
    <h2>人が減ると、${WORKING}1人が支える人が増えます。</h2>
    <p class="lead">${esc(area.name)}で、${WORKING}1人が支える人（0〜14歳と65歳以上）の数。</p>
    <div class="carry"><div class="carry-side"><div class="people ten" aria-hidden="true">${Array.from({ length: 10 }, () => `<span class="p">${personSvg()}</span>`).join('')}</div><div class="sm">${WORKING}の10人が</div></div>
    <div class="carry-side"><div class="people ten carried" id="carried" aria-hidden="true"></div><div class="sm" id="carriedLabel"></div></div></div>
    <p style="margin:16px 0 0"><span class="bign num" id="loadN"></span> <span id="loadChip"></span><br><span class="sm" id="loadDetail"></span></p>
    <p class="sm">全国：2025年 ${nat25.toFixed(2)}人 → 2100年 ${nat100.toFixed(2)}人。</p>${more('futan')}
  </div></section>`;

  const COST = `<section class="screen" id="sec-cost"><div class="wrap">
    <h2>いま、人口が少ない町ほど、町が1人に使うお金が大きくなっています。</h2>
    <p class="lead">町の大きさごとの、町が1人に1年に使うお金（${fin.fiscalYear}年度、実際）。${esc(area.name)}の大きさに印。</p>
    <div class="hist fin" id="fin" role="img" aria-label="人口の規模別、1人あたりの歳出の中央値（千円）">${rows
      .map((r, i) => `<div class="bar-row" data-band="${i}"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${(r.widthPct * 0.7).toFixed(1)}%"></div><span class="val num">${fmt(r.median)}千円</span><span class="mark" id="finMark${i}"></span></div></div>`)
      .join('')}</div>
    ${more('okane')}<p>文化を残すには、人が暮らし続けられることが前提です。暮らしの場を、その町の収益だけでまかなえないなら、足りない分は人口の多い地域が負担します。それが続くと、将来の世代の負担が重くなる、とわたしは考えています。</p></div>
  </div></section>`;

  const KEEP = `<section class="screen" id="sec-keep"><div class="wrap">
    <h2>ここを残すと、ほかを残す余力が減ります。</h2>
    <p class="lead">日本全体の人は変わらないので、ここを保つ人は、ほかの町から来ることになります。</p>
    <div id="keepBody"></div>${more('yoryoku')}
  </div></section>`;

  const E = claims.length
    ? `<section class="screen"><div class="wrap"><h2>${esc(area.prefName)}について、公表資料が人口減少に触れている言葉。</h2>${claims
        .map((c) => `<div class="quote"><blockquote>「${esc(c.quote)}」</blockquote><div class="s">${esc(c.subject)}。出典：${esc(c.sourceLabel)}${c.date ? `（${esc(c.date)}）` : ''}</div></div>`)
        .join('')}</div></section>`
    : '';
  const bar = `<div class="ybar">${yearControl('lmYear', ACTUAL_YEAR, t.hasActual)}</div>`;

  const after: After = () => {
    const q = (sel: string) => document.getElementById(sel);
    const people = document.querySelectorAll<HTMLElement>('#people .p');
    const lamps = document.querySelectorAll<HTMLElement>('#lamps .lamp');
    const map = q('lmMap')!;
    wireDots(site, map);
    let year = ACTUAL_YEAR;
    const setText = (sel: string, text: string): void => {
      const el = q(sel);
      if (el) el.textContent = text;
    };
    const show = (y: number): void => {
      year = y;
      const p = s[y];
      const st = statusOf(y, t.hasActual);
      const n = Math.round((p / s[ACTUAL_YEAR]) * 100);
      people.forEach((el, i) => el.classList.toggle('off', i >= n));
      q('lmPop')!.textContent = figure(p, st);
      q('lmChip')!.innerHTML = chip(st);
      recolor(site, map, y);
      // places of daily life
      lamps.forEach((el) => {
        const f = facById.get(el.dataset.id ?? '');
        el.classList.toggle('off', !!f && p < f.p50);
      });
      const nb = belowCount(p);
      // who supports whom
      const load = supportLoad(ages[y]);
      const k = Number.isFinite(load.perWorker) ? Math.round(load.perWorker * 10) : 0;
      q('carried')!.innerHTML = Array.from({ length: k }, () => `<span class="p">${personSvg()}</span>`).join('');
      setText('carriedLabel', `支える人：${k}人`);
      setText('loadN', Number.isFinite(load.perWorker) ? `1人が支える人 ${load.perWorker.toFixed(2)}人` : `${WORKING}がいません`);
      q('loadChip')!.innerHTML = chip(st);
      setText('loadDetail', `0〜14歳 ${figure(load.young, st)}と65歳以上 ${figure(load.old, st)}を、${WORKING}${figure(load.working, st)}で。`);
      // the cost band
      const bandY = bandIndexFor(fin.bands, Math.round(p));
      fin.bands.forEach((_, i) => {
        const mark = q(`finMark${i}`);
        if (!mark) return;
        const tags: string[] = [];
        if (i === band25) tags.push('2025年の大きさ');
        if (i === bandY && y !== ACTUAL_YEAR) tags.push(`${y}年の大きさ`);
        mark.textContent = tags.join('・');
        mark.closest('.bar-row')?.classList.toggle('here', tags.length > 0);
      });
      // keeping this place: the what-if (existing computeKeep), only while a place is under its guide
      const target = highestBelow(p, m.facilities);
      const keep = target ? computeKeep(populationAtYear(site, y), site.data.facilities, target, l.areaCode) : undefined;
      let keepHtml: string;
      let keepShort: string;
      if (!target) {
        keepHtml = `<p>${y}年の${esc(area.name)}では、病院や店などの8種はすべて成り立ちます。動かす人はいません。</p>`;
        keepShort = 'すべて成り立つ';
      } else if (keep && keep.outcome.kind === 'ok') {
        const eff = keep.outcome.effects;
        keepHtml = `<div class="swap"><div class="box"><div class="sm">${esc(area.name)}に</div><div class="v num">+${approx(keep.outcome.people)}</div><div class="sm">いれば、${esc(target.name)}が成り立つ人数（${fmt(target.p50)}人）になります</div></div><svg class="arrow" width="64" height="44" viewBox="0 0 64 44" aria-hidden="true"><path d="M60 14H8m0 0l8-8M8 14l8 8" stroke="#2b4c7e" stroke-width="2" fill="none"/><path d="M4 30h52m0 0l-8-8m8 8l-8 8" stroke="#a43d2b" stroke-width="2" fill="none"/></svg><div class="box"><div class="sm">ほかの町から</div><div class="v num dec">−${approx(keep.outcome.people)}</div><div class="sm">${eff.areaCount === 0 ? 'そのとき、ほかの町で新しく成り立たなくなるものはありません' : `そのとき、ほかの${fmt(eff.areaCount)}町で、新しく成り立たなくなるものが出ます`}</div></div></div>`;
        keepShort = `${approx(keep.outcome.people)}を動かすと、ほか${fmt(eff.areaCount)}町`;
      } else if (keep) {
        keepHtml = `<p>${esc(target.name)}が成り立つ人数（${fmt(target.p50)}人）まで、あと${approx(keep.needs.need50)}。人数が大きすぎて、ほかの町への影響は計算できません。</p>`;
        keepShort = `あと${approx(keep.needs.need50)}`;
      } else {
        keepHtml = '<p>計算できませんでした。</p>';
        keepShort = '';
      }
      q('keepBody')!.innerHTML = keepHtml;
      // the chain's nodes
      setText('nd-place', '');
      setText('nd-pop', figure(p, st));
      setText('nd-places', dimFrom ? '2100年まで、8種とも成り立ちます' : nb === 0 ? `0 / 8（${firstBelow!.year}年に${firstBelow!.n}種）` : `${nb} / 8 が成り立たない`);
      document.querySelectorAll<HTMLElement>('.ybars .yb').forEach((el) => el.classList.toggle('on', Number(el.dataset.y) === y));
      setText('trendNote', `${y}年 ${figure(p, st)}`);
      setText('nd-out', chain ? `${approx(chain.weak)}〜${approx(chain.strong).replace('約', '')}` : '前提なし');
      setText('nd-load', Number.isFinite(load.perWorker) ? `${load.perWorker.toFixed(2)}人` : '—');
      setText('nd-cost', `${fmt(fin.bands[bandY].median)}千円`);
      setText('nd-keep', keepShort);
    };
    wireYear('lmYear', show, t.hasActual);
    show(ACTUAL_YEAR);
    for (const b of document.querySelectorAll<HTMLButtonElement>('.node[data-go]')) {
      b.addEventListener('click', () => {
        const target = q(b.dataset.go ?? '');
        target?.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
      });
    }
    const token = ++routeToken;
    void townsOf(site, l.prefCode).then(
      (towns) => {
        if (token !== routeToken) return;
        const svgWrap = map.querySelector('svg');
        if (!svgWrap) return;
        svgWrap.outerHTML = japanSvg(site, { viewBox: viewBoxOf(unionBB(towns), 10), towns, selTown: l.areaCode, filter: (o) => o.id === l.id, dotScale: 2.2, year, label: `${area.prefName}の町の地図` });
        q('lmMapNote')?.remove();
      },
      () => {
        const note = q('lmMapNote');
        if (note) note.textContent = '町の境界を読み込めませんでした。県の形だけを示しています。';
      },
    );
  };
  return { html: A + CHAIN + PLACES + SUPPORT + COST + KEEP + E + bar, after, title: l.name };
}

let routeToken = 0;

function pageChizu(site: Site, pc: string | undefined, townCode: string | undefined): Page {
  const m = site.model;
  const pref = pc ? site.prefByCode.get(pc) : undefined;
  if (pc && !pref) return page404();
  const area = townCode ? m.areaByCode.get(townCode) : undefined;
  if (townCode && (!area || area.prefCode !== pc)) return page404();
  const subj = area ? area.name : pref ? pref.name : '日本';
  const opts: MapOpts = { year: ACTUAL_YEAR, linkPref: !pc, label: pref ? `${pref.name}の地図` : '日本の地図。県を押すと、県の地図へ' };
  if (pref) {
    opts.viewBox = viewBoxOf(pref.bb, 30);
    opts.sel = pc;
    opts.filter = (o) => o.prefCode === pc;
    opts.dotScale = 2.2;
  }
  const crumb = `<p class="crumb"><a href="#/chizu">日本</a>${pref ? ` › ${area ? `<a href="#/chizu/${pc}">${esc(pref.name)}</a>` : esc(pref.name)}` : ''}${area ? ` › ${esc(area.name)}` : ''}</p>`;
  const sideList = site.landmarks.filter((o) => pref && o.prefCode === pc && (!area || o.areaCode === townCode));
  const side = `<div class="side"><h3 id="sideName">${esc(subj)}</h3><p style="margin:0"><span class="bign num" id="sidePop"></span> <span id="sideChip"></span></p><p class="sm" id="sideNote"></p>${
    pref
      ? `<ul>${sideList.map((o) => `<li><a href="#/meisho/${esc(o.id)}">${esc(o.name)}</a> <span class="sm">${esc(o.kind)}${area ? '' : `・${esc(m.areaByCode.get(o.areaCode)?.name ?? '')}`}</span></li>`).join('')}${sideList.length ? '' : '<li class="sm">この範囲に、登録した名所はありません。</li>'}</ul>`
      : '<p class="sm">県を押すと、県に絞ります。</p>'
  }</div>`;
  const options = m.areas.map((a) => `<option value="${esc(a.name)}（${esc(a.prefName)}）"></option>`).join('');
  const html = `<section class="screen"><div class="wrap">
    <h1>県を押すと県へ、町を押すと町へ。年を動かすと、色が変わります。</h1>
    <div class="search" role="search"><input id="townQ" list="townList" placeholder="町名か県名で探す（例：田辺市）" aria-label="町名か県名で探す"><datalist id="townList">${options}</datalist><button type="button" class="btn" id="townGo">探す</button></div>
    ${crumb}
    <div class="two"><div class="mapwrap" id="chizuMap">${japanSvg(site, opts)}${legendShare()}${pref ? '<p class="map-note" id="chizuNote">町の境界を読み込んでいます。</p>' : ''}${yearControl('chizuYear', ACTUAL_YEAR, true)}</div>${side}</div>${more('chizu')}
  </div></section>`;
  const after: After = () => {
    const map = document.getElementById('chizuMap')!;
    wireDots(site, map);
    const pop = document.getElementById('sidePop')!;
    const ch = document.getElementById('sideChip')!;
    const note = document.getElementById('sideNote')!;
    const t = townCode ? m.town.get(townCode) : undefined;
    const ser: Totals = t ? std(t) : pc ? stdPref(m, pc)! : stdNation(m);
    const hasA = t ? t.hasActual : true;
    const national2025 = m.checks?.census.national;
    let year = ACTUAL_YEAR;
    const show = (y: number): void => {
      year = y;
      recolor(site, map, y);
      const st = statusOf(y, hasA);
      const v = !pc && y === ACTUAL_YEAR && national2025 !== undefined ? national2025 : ser[y];
      pop.textContent = figure(v, st);
      ch.innerHTML = chip(st);
      let text = '';
      text = st === 'jisseki' ? '実際（国勢調査）。' : '計算。';
      note.textContent = text;
    };
    wireYear('chizuYear', show, hasA);
    show(ACTUAL_YEAR);
    map.addEventListener('click', (e) => {
      const el = (e.target as Element).closest?.('.pref') as SVGPathElement | null;
      if (!el) return;
      if (el.hasAttribute('data-town')) location.hash = `#/chizu/${pc}/${el.getAttribute('data-town')}`;
      else if (!pc) location.hash = `#/chizu/${el.getAttribute('data-code')}`;
    });
    map.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = (e.target as Element).closest?.('.pref') as SVGPathElement | null;
      if (!el) return;
      e.preventDefault();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const q = document.getElementById('townQ') as HTMLInputElement;
    const go = (): void => {
      const v = q.value.trim();
      if (!v) return;
      const name = v.replace(/（.*$/, '');
      const hit = m.areas.find((a) => a.name === name) ?? m.areas.find((a) => `${a.name}（${a.prefName}）` === v);
      if (hit) {
        location.hash = `#/chizu/${hit.prefCode}/${hit.code}`;
        return;
      }
      const pr = site.prefs.find((p) => p.name.startsWith(name));
      if (pr) location.hash = `#/chizu/${pr.code}`;
      else note.textContent = `「${v}」は見つかりません。町名か県名を入れてください。`;
    };
    document.getElementById('townGo')!.addEventListener('click', go);
    q.addEventListener('change', go);
    if (pc) {
      const token = ++routeToken;
      void townsOf(site, pc).then(
        (towns) => {
          if (token !== routeToken) return;
          const svg = map?.querySelector('svg');
          if (!svg || !map) return;
          svg.outerHTML = japanSvg(site, { viewBox: viewBoxOf(unionBB(towns), 10), towns, selTown: townCode, filter: (o) => o.prefCode === pc, dotScale: 2.2, year, label: `${pref!.name}の町の地図。町を押すと、その町に絞ります` });
          document.getElementById('chizuNote')?.remove();
        },
        () => {
          const n = document.getElementById('chizuNote');
          if (n) n.textContent = '町の境界を読み込めませんでした。';
        },
      );
    }
  };
  return { html, after, title: subj === '日本' ? '地図' : subj };
}

// ---- the answer check ---------------------------------------------------------------------------------------------

function pageAwase(site: Site, townCode: string | undefined): Page {
  const m = site.model;
  if (!m.checks) return { html: '<section class="screen"><div class="wrap"><h1>答え合わせのデータ（checks.json）がありません。</h1></div></section>' };
  const code = townCode ?? DEFAULT_TOWN;
  const area = m.areaByCode.get(code);
  if (!area) return page404();
  const ac = answerCheck(m.checks);
  const sm = ac.summary;
  const o = sm.national.estimate;
  const a = sm.national.count;
  const diff = a - o; // negative: fewer than estimated
  const pct = sm.national.pct;
  const c2020 = m.checks.census.national2020;
  const zoomSpan = 0.5; // the enlarged tip shows the last 0.5% of the bar
  const manJin = (n: number): string => `約${fmt(Math.round(Math.abs(n) / 1e4))}万人`;
  const one = `<section class="screen"><div class="wrap"><h1>日本の人口は、国の計算より${manJin(diff)}${diff < 0 ? '少なく' : '多く'}なりました。人は、思ったより早く減っています。</h1>
    <p class="lead">2025年の日本の人口は ${fmt(a)}人（実際）。国の計算は ${fmt(o)}人でした（${signedPct(pct)}）。</p>
    <div class="bars" role="img" aria-label="全国 2025年の公式推計と実績の2本の棒">
      <div class="bar-row thin"><span>国の計算（2023年）</span><div class="track"><div class="fill" style="width:100%"></div></div><span></span><span class="val">${fmt(o)}人</span></div>
      <div class="bar-row"><span>実際（国勢調査）</span><div class="track"><div class="fill" style="width:${((a / o) * 100).toFixed(3)}%"></div></div><span></span><span class="val">${fmt(a)}人</span></div>
      <div class="bar-row"><span></span><div class="axis"><span>0</span><span>${fmt(o)}人</span></div></div>
      <div class="zoom"><div>先端を拡大（推計より ${fmt(Math.abs(diff))}人、${Math.abs(pct).toFixed(2)}% ${diff < 0 ? '少ない' : '多い'}）</div><div class="track"><div class="fill" style="width:100%;background:#8da0bf"></div></div><div class="track"><div class="fill" style="width:${(100 - (Math.abs(pct) / zoomSpan) * 100).toFixed(1)}%;background:#2b4c7e"></div></div><div class="diff">推計より ${diff < 0 ? '−' : '+'}${fmt(Math.abs(diff))}人（右端の ${zoomSpan}% 分を拡大）</div></div>
    </div>
    ${more('awase')}</div></section>`;
  // bins
  const maxN = Math.max(...ac.bins.map((b) => b.count), 1);
  const hist = `<div class="hist" role="img" aria-label="推計より少ない町・多い町の分布。6つの段階の町の数">${ac.bins
    .map((b, i) => `<div class="bar-row"><span>${DEVIATION_LABELS[i]}</span><div class="track"><div class="fill" style="width:${((b.count / maxN) * 80).toFixed(1)}%;background:${DEVIATION_COLORS[i]}"></div><span class="val num">${fmt(b.count)}町</span></div></div>`)
    .join('')}<p class="hist-note">上＝国の計算より減っていた町、下＝増えていた町。</p></div>`;
  const notable = ['珠洲市', '輪島市', '球磨村'].map((n) => m.areas.find((x) => x.name === n)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!notable.some((x) => x.code === code)) notable.push(area);
  const noteFor = (name: string): string => (name === '珠洲市' || name === '輪島市' ? '令和6年の能登半島地震を含む5年。' : name === '球磨村' ? '令和2年の水害のあと、戻った人がいた5年。' : '');
  const notableHtml = notable
    .map((x) => {
      const t = ac.byCode.get(x.code);
      if (!t || t.census2025 === null) return `<li>${esc(x.name)}（${esc(x.prefName)}）　${HAMAMATSU_NOTE}</li>`;
      const d = deviationPct(t)!;
      const n = noteFor(x.name);
      return `<li>${esc(x.name)}（${esc(x.prefName)}）　国の計算 ${fmt(t.ipss23_2025)}人 → 実際 ${fmt(t.census2025)}人（${signedPct(d, Math.abs(d) >= 10 ? 1 : 2)}）${n ? `<br><span class="sm">${n}</span>` : ''}</li>`;
    })
    .join('');
  const prefSel = `<label class="awase-pick"><span class="sm">地図の県</span><select id="awasePref" aria-label="地図の県">${site.prefs.map((p) => `<option value="${p.code}"${p.code === area.prefCode ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>`;
  const two = `<section class="screen"><div class="wrap"><h2>国の計算より人が減っていた町が${fmt(sm.below)}、増えていた町が${fmt(sm.above)}です（${fmt(sm.n)}の町）。</h2>
    <p class="lead">小さい町ほど、国の計算より減っていました。</p>
    <div class="two"><div>${hist}<div class="mapwrap" id="awaseMap" style="margin-top:16px">${prefSel}${japanSvg(site, { viewBox: viewBoxOf(site.prefByCode.get(area.prefCode)!.bb, 30), sel: area.prefCode, dots: false, flat: true, label: `${area.prefName}の、推計より少ない町・多い町の地図` })}<div class="lg"><span>国の計算より</span>${DEVIATION_LABELS.map((l, i) => `<span><i style="background:${DEVIATION_COLORS[i]}"></i>${l}</span>`).join('')}<span><i style="background:#d0c9c4"></i>実績なし</span></div><p class="map-note" id="awaseNote">町の境界を読み込んでいます。</p></div></div>
    <div class="side"><h3>目立つ町</h3><ul>${notableHtml}</ul></div></div>${more('awase')}</div></section>`;
  // the deviation by age: the 2025 count against the official run, both sexes, 20 age groups (the engine's two series)
  const ageDiff = m.ages2025.count.map((c, i) => c - m.ages2025.official[i]);
  const ageMax = Math.max(...ageDiff.map((d) => Math.abs(d)), 1);
  const ageRows = ageDiff
    .map((d, i) => {
      const pct = (d / m.ages2025.official[i]) * 100;
      const w = ((Math.abs(d) / ageMax) * 50).toFixed(1);
      const bar = d < 0 ? `<div class="fill neg" style="right:50%;width:${w}%"></div>` : `<div class="fill pos" style="left:50%;width:${w}%"></div>`;
      return `<div class="bar-row age"><span>${AGE_LABELS[i]}</span><div class="track">${bar}</div><span class="val num ${d < 0 ? 'dec' : ''}">${d < 0 ? '−' : '+'}${fmt(Math.abs(d))}<span class="sm">（${signedPct(pct, 1)}）</span></span></div>`;
    })
    .join('');
  const short = ageDiff.filter((d) => d < 0).length;
  const mostShort = ageDiff.map((d, i) => [d, i] as const).sort((p, q) => p[0] - q[0]).slice(0, 2).map(([, i]) => AGE_LABELS[i]);
  const mostOver = ageDiff.map((d, i) => [d, i] as const).sort((p, q) => q[0] - p[0]).slice(0, 2).map(([, i]) => AGE_LABELS[i]);
  const ages = `<section class="screen"><div class="wrap"><h2>国の計算より減っていたのは、${mostShort.join('と')}。多かったのは、${mostOver.join('と')}でした。</h2>
    <p class="lead">全国の2025年。年齢ごとに、国の計算よりどれだけ少ないか（左、赤茶）、多いか（右、藍）。</p>
    <div class="hist ages" role="img" aria-label="全国の2025年、年齢5歳階級ごとの実績と公式推計の差の横棒">${ageRows}</div>
    ${more('awase')}
  </div></section>`;
  // the one town's lines
  const t = m.town.get(code)!;
  const ck = ac.byCode.get(code);
  const three = `<section class="screen"><div class="wrap"><h2>2025年の実際の人数から計算し直すと、先の人数も変わります。</h2>
    <div class="awase-pick"><input id="awaseQ" list="awaseList" placeholder="ほかの町を見る（例：高野町）" aria-label="町名で探す"><datalist id="awaseList">${m.areas.map((x) => `<option value="${esc(x.name)}（${esc(x.prefName)}）"></option>`).join('')}</datalist><button type="button" class="btn" id="awaseGo">見る</button></div>
    <p class="lead">${esc(area.name)}（${esc(area.prefName)}）。実際の点、国の計算の線、このアプリの計算の線。</p>
    <div id="lines"></div>
    <div class="leg2"><span><svg width="28" height="10"><circle cx="8" cy="5" r="4" fill="#1b2430"/></svg>実績（国勢調査）</span><span><svg width="28" height="10"><circle cx="8" cy="5" r="3.5" fill="#f6f5f0" stroke="#8a8378" stroke-width="1.5"/></svg>前回推計（平成30年）</span><span><svg width="28" height="10"><line x1="0" x2="28" y1="5" y2="5" stroke="#2b4c7e" stroke-width="1.5"/></svg>公式推計（令和5年）</span><span><svg width="28" height="10"><line x1="0" x2="28" y1="5" y2="5" stroke="#2b4c7e" stroke-width="1.5" stroke-dasharray="5 5"/></svg>公式の前提を延ばした試算</span><span><svg width="28" height="10"><line x1="0" x2="28" y1="5" y2="5" stroke="#1b2430" stroke-width="2.5" stroke-dasharray="6 5"/></svg>${STANDARD_LABEL}</span></div>
    <ul class="vals" id="vals"></ul>
    <p class="sm">全国の2100年は、${nationalChangeLine(m)}。${HAMAMATSU_NOTE}</p></div></section>`;
  const after: After = () => {
    // (2) the prefecture's towns, coloured by their deviation step
    const map = document.getElementById('awaseMap');
    const sel = document.getElementById('awasePref') as HTMLSelectElement | null;
    const devFill = (c: string): string => deviationColorOf(ac.byCode.get(c)) ?? '#d0c9c4';
    const drawPref = (pc: string): void => {
      const token = ++awaseToken;
      const note = document.getElementById('awaseNote');
      if (note) note.textContent = '町の境界を読み込んでいます。';
      void townsOf(site, pc).then(
        (towns) => {
          if (token !== awaseToken) return;
          const svg = map?.querySelector('svg');
          if (!svg || !map) return;
          svg.outerHTML = japanSvg(site, { viewBox: viewBoxOf(unionBB(towns), 10), towns, townFill: devFill, dots: false, flat: true, label: `${site.prefByCode.get(pc)?.name ?? ''}の、推計より少ない町・多い町の地図` });
          map.querySelectorAll<SVGPathElement>('.pref[data-town]').forEach((el) => {
            el.setAttribute('fill', devFill(el.getAttribute('data-town')!));
            const ct = ac.byCode.get(el.getAttribute('data-town')!);
            const d = ct ? deviationPct(ct) : null;
            const title = el.querySelector('title');
            if (title && ct) title.textContent = `${title.textContent}：推計 ${fmt(ct.ipss23_2025)}人 → 実績 ${ct.census2025 === null ? 'なし' : `${fmt(ct.census2025)}人`}${d === null ? '' : `（${signedPct(d)}）`}`;
          });
          document.getElementById('awaseNote')?.remove();
        },
        () => {
          const n = document.getElementById('awaseNote');
          if (n) n.textContent = '町の境界を読み込めませんでした。';
        },
      );
    };
    if (map && sel) {
      sel.addEventListener('change', () => drawPref(sel.value));
      drawPref(area.prefCode);
    }
    map?.addEventListener('click', (e) => {
      const el = (e.target as Element).closest?.('.pref[data-town]');
      if (el) location.hash = `#/awase/${el.getAttribute('data-town')}`;
    });
    // (3) the lines, drawn at the width of the box so type stays 12px
    const box = document.getElementById('lines');
    const vals = document.getElementById('vals');
    const draw = (): void => {
      if (!box || !vals) return;
      const w = Math.max(320, Math.floor(box.clientWidth || 760));
      const r = linesSvg(t.trial, t.official, t.lowBirth, ck ? { c2020: ck.census2020, c2025: ck.census2025, h30_2020: ck.ipss18_2020, h30_2025: ck.ipss18_2025, o2025: ck.ipss23_2025 } : undefined, t.hasActual, area.name, w);
      box.innerHTML = r.svg;
      vals.innerHTML = r.values.map((v) => `<li>${v}</li>`).join('');
    };
    draw();
    const onResize = (): void => draw();
    window.addEventListener('resize', onResize);
    players.push(() => window.removeEventListener('resize', onResize));
    const q = document.getElementById('awaseQ') as HTMLInputElement | null;
    const go = (): void => {
      const v = q?.value.trim() ?? '';
      if (!v) return;
      const name = v.replace(/（.*$/, '');
      const hit = m.areas.find((x) => `${x.name}（${x.prefName}）` === v) ?? m.areas.find((x) => x.name === name);
      if (hit) location.hash = `#/awase/${hit.code}`;
      else q?.setCustomValidity('見つかりません');
    };
    document.getElementById('awaseGo')?.addEventListener('click', go);
    q?.addEventListener('change', go);
  };
  return { html: one + two + ages, after, title: '答え合わせ', detail: three };
}
let awaseToken = 0;

interface CheckPoints {
  c2020: number;
  c2025: number | null;
  h30_2020: number | null;
  h30_2025: number | null;
  o2025: number;
}

/** The one town's chart: official line (thin), its extension (thin dashed), the trial (thick dashed), the counts (dots), the 2018 estimate (rings). */
export function linesSvg(trial: Totals, official: Totals, lowBirth: Totals, ck: CheckPoints | undefined, hasActual: boolean, name: string, CW: number): { svg: string; values: string[] } {
  const L = 56;
  const wide = CW >= 700; // room on the right for the end labels; on a phone the list under the chart carries them
  const R = wide ? 190 : 16;
  const T = 20;
  const B = 36;
  const CH = Math.round(Math.min(360, Math.max(240, CW * 0.42)));
  const all = [...YEARS.map((y) => official[y]), ...YEARS.map((y) => trial[y]), ck?.c2020 ?? 0, ck?.h30_2020 ?? 0];
  const top = Math.max(...all);
  const stepN = top > 1e6 ? 500000 : top > 2e5 ? 100000 : top > 5e4 ? 25000 : top > 2e4 ? 10000 : top > 5e3 ? 2500 : 1000;
  const max = Math.ceil((top * 1.05) / stepN) * stepN;
  const X = (y: number): number => L + ((y - BASE_YEAR) / 80) * (CW - L - R);
  const Y = (v: number): number => T + (1 - v / max) * (CH - T - B);
  const pt = (y: number, v: number): string => `${X(y).toFixed(1)},${Y(v).toFixed(1)}`;
  let off = '';
  let offd = '';
  let tr = '';
  for (const y of YEARS) {
    if (y <= OFFICIAL_END) off += (off ? ' L' : 'M') + pt(y, official[y]);
    if (y >= OFFICIAL_END) offd += (offd ? ' L' : 'M') + pt(y, official[y]);
    if (hasActual && y >= ACTUAL_YEAR) tr += (tr ? ' L' : 'M') + pt(y, lowBirth[y]);
  }
  const grid: string[] = [];
  for (let v = 0; v <= max; v += stepN) {
    grid.push(`<line x1="${L}" x2="${CW - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#d9d6cc"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" font-size="12" fill="#5b6470" text-anchor="end">${v >= 10000 ? `${v / 10000}万` : v}</text>`);
  }
  const xs = [2020, 2025, 2050, 2075, 2100].map((y) => `<text x="${X(y).toFixed(1)}" y="${CH - 14}" font-size="12" fill="#5b6470" text-anchor="middle">${y}</text>`).join('');
  let h30 = '';
  if (ck && ck.h30_2020 !== null && ck.h30_2025 !== null) {
    h30 = `<path d="M${pt(2020, ck.h30_2020)} L${pt(2025, ck.h30_2025)}" stroke="#8a8378" stroke-width="1.5" fill="none"/><circle cx="${X(2020).toFixed(1)}" cy="${Y(ck.h30_2020).toFixed(1)}" r="3.5" fill="#f6f5f0" stroke="#8a8378" stroke-width="1.5"/><circle cx="${X(2025).toFixed(1)}" cy="${Y(ck.h30_2025).toFixed(1)}" r="3.5" fill="#f6f5f0" stroke="#8a8378" stroke-width="1.5"/>`;
  }
  const dots = `<circle cx="${X(2020).toFixed(1)}" cy="${Y(trial[BASE_YEAR]).toFixed(1)}" r="5" fill="#1b2430"/>${hasActual ? `<circle cx="${X(2025).toFixed(1)}" cy="${Y(trial[ACTUAL_YEAR]).toFixed(1)}" r="5" fill="#1b2430"/>` : ''}`;
  // right-edge labels, pushed apart so they never sit on each other (the long names are in the list under the chart)
  const labels: Array<{ y: number; text: string; color: string }> = [{ y: Y(official[END_YEAR]), text: `${fmt(official[END_YEAR])} 公式の前提`, color: '#2b4c7e' }];
  if (hasActual) labels.push({ y: Y(lowBirth[END_YEAR]), text: `${fmt(lowBirth[END_YEAR])} ${STANDARD_LABEL}`, color: '#1b2430' });
  labels.sort((p, q) => p.y - q.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 18) labels[i].y = labels[i - 1].y + 18;
  const endLabels = wide ? labels.map((l) => `<text x="${(X(END_YEAR) + 10).toFixed(1)}" y="${(l.y + 4).toFixed(1)}" font-size="12" fill="${l.color}">2100 ${l.text}</text>`).join('') : '';
  // below and to the left of the 2025 point: the lines come from the upper left and leave to the lower right
  const start = hasActual && wide ? `<text x="${(X(2025) - 10).toFixed(1)}" y="${(Y(trial[ACTUAL_YEAR]) + 24).toFixed(1)}" font-size="12" fill="#1b2430" text-anchor="end">2025 実績 ${fmt(trial[ACTUAL_YEAR])}</text>` : '';
  const svg = `<svg class="chart" viewBox="0 0 ${CW} ${CH}" width="${CW}" height="${CH}" role="img" aria-label="${esc(name)}の人口。公式推計の線、国勢調査の実績の点、前回推計の点、実績から延ばし直した試算の線">${grid.join('')}${xs}${h30}<path d="${off}" fill="none" stroke="#2b4c7e" stroke-width="1.5"/><path d="${offd}" fill="none" stroke="#2b4c7e" stroke-width="1.5" stroke-dasharray="5 5"/>${tr ? `<path d="${tr}" fill="none" stroke="#1b2430" stroke-width="2.5" stroke-dasharray="6 5"/>` : ''}${dots}${start}${endLabels}</svg>`;
  const values: string[] = [`2020 実績 <span class="num">${fmt(trial[BASE_YEAR])}</span>人`];
  if (ck) {
    if (ck.c2025 !== null) values.push(`2025 実績 <span class="num">${fmt(ck.c2025)}</span>人（公式推計 ${fmt(ck.o2025)}、${signedPct(((ck.c2025 - ck.o2025) / ck.o2025) * 100)}）`);
    else values.push(`2025 公式推計 <span class="num">${fmt(ck.o2025)}</span>人（実績なし）`);
    if (ck.h30_2025 !== null) values.push(`前回推計（平成30年）の2025 <span class="num">${fmt(ck.h30_2025)}</span>人`);
  }
  values.push(`2050 公式推計 <span class="num">${fmt(official[OFFICIAL_END])}</span>人`);
  if (hasActual) values.push(`2050 ${STANDARD_LABEL} <span class="num">${fmt(lowBirth[OFFICIAL_END])}</span>人（${INTERIM_LABEL} ${fmt(trial[OFFICIAL_END])}）`);
  values.push(`2100 公式の前提を延ばした試算 <span class="num">${fmt(official[END_YEAR])}</span>人`);
  if (hasActual) values.push(`2100 ${STANDARD_LABEL} <span class="num">${fmt(lowBirth[END_YEAR])}</span>人（${INTERIM_LABEL} ${fmt(trial[END_YEAR])}）`);
  return { svg, values };
}

function pageAi(site: Site): Page {
  const html = `<section class="screen"><div class="wrap"><h1>聞きたいことを聞いてください。</h1><div class="ai-host" id="aiHost"></div>${more('ai')}</div></section>`;
  const after: After = () => {
    const host = document.getElementById('aiHost')!;
    const runner = createRunner(site.data);
    const store = createAppStore(runner, site.data, { year: END_YEAR });
    const teardown = mountAIPanel(host, { store, data: site.data, runner });
    players.push(teardown);
  };
  return { html, after, title: 'AIに聞く' };
}

const ABOUT_PAGES: ReadonlyArray<{ key: string; title: string }> = [
  { key: 'purpose', title: '何のために' },
  { key: 'idea', title: '考え方' },
  { key: 'not-counted', title: '数えていないこと' },
  { key: 'sources', title: '数字の出どころ' },
];

function pageAbout(site: Site, sub?: string): Page {
  const m = site.model;
  const back = `<p class="more"><a href="#/about">このアプリについて</a> ／ <a href="#/">ホーム</a></p>`;
  if (!sub) {
    return {
      html: `<section class="screen"><div class="wrap"><h1>このアプリについて。</h1><ul class="src links">${ABOUT_PAGES.map((x) => `<li><a href="#/about/${x.key}">${x.title}</a></li>`).join('')}</ul></div></section>`,
      title: 'このアプリについて',
    };
  }
  const by = (label: string) => SITE_SOURCES.find((x) => x.label === label);
  const line = (label: string): string => {
    const x = by(label);
    return x ? `<li>${esc(x.label)}：${esc(x.text)}。<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.url)}</a>（${esc(x.retrieved)}取得）${x.approval ? `。${esc(x.approval)}` : ''}</li>` : '';
  };
  let body = '';
  let title = '';
  if (sub === 'purpose') {
    title = '何のために';
    body = `<h1>何のために。</h1>
  <p class="approach">日本に暮らすわたしたちは、「何を残すか」を決めないといけない時に来ています。まだ、そのことが広く知られていません。<br>このアプリは、何を残せば何が残せなくなるか、何を残せば負担がどう増えるか、何を残さないと国防が危うくなる可能性があるか、を町ごとの数字で見せます。<br>理解したあとに決めるための、材料です。決めるのは使う人で、このアプリは勧めません。</p>`;
  } else if (sub === 'idea') {
    title = '考え方';
    body = `<h1>考え方。</h1>
  <p class="approach">問いは「何を残すか」。残す対象は、名勝・名物・観光地・食・建物・衣装など、日本らしいもの。<br>それを残すのは人で、人が住み続けるには、暮らしと仕事の場が要ります。<br>人口が減ると、病院や店のような暮らしの場が成り立つ人口の目安を下回り、住みにくくなって、人の減りが速まります。<br>暮らしの場を残すには、町の収益で足りない分を、人口の多い地域と働く世代が負担します。人口が減るほど、1人あたりの費用は大きく、1人が支える人は増えます。<br>負担は有限なので、ここを残せば、ほかの町やほかの日本らしいものを残す余力が減ります。重くなりすぎれば、次の世代の重荷になります。</p>
  <p class="sm">「人がさらに減る場合」は、病院や店などが成り立たなくなると住みたい人が減り、人の減りが速まる、と置いた計算です（弱・強）。速まり方はこのアプリの仮定で、測った根拠はありません。2050年以降に当てはめています。予測ではありません。</p>
  <p class="sm">ここを保つ人数は、日本全体の人を変えずに、ほかの町から人口に比例して動かす「もし移ったら」の計算で、実際の人の動きの予測ではありません。</p>
  <div class="opinion"><div class="sm">作者の考え</div><p>文化を残すには、人が暮らし続けられることが前提です。暮らしの場を、その町の収益だけでまかなえないなら、足りない分は人口の多い地域が負担します。それが続くと、将来の世代の負担が重くなる、とわたしは考えています。</p><p>病院などの暮らしを支えるものを残すには、人口の少ない町ほど、1人あたりの費用が大きくなります。その負担が、文化など、ほかに残したいものを残す余力を減らす、とわたしは考えています。</p></div>`;
  } else if (sub === 'not-counted') {
    title = '数えていないこと';
    body = `<h1>数えていないこと。</h1>
  <p>人がいなくなる地域の国防は、別の形で考える必要があります。このアプリでは数えていません（数字は出せません）。ほかに、国土の管理、災害への備え、水源や森林の手入れも数えていません。</p>`;
  } else if (sub === 'sources') {
    title = '数字の出どころ';
    body = `<h1>数字の出どころ。</h1>
  <ul class="src">
    ${line('人口')}
    ${line('人口の実績')}
    ${line('前回の推計')}
    <li>${ESTIMATE_LINE}2025年の実績がある町は、実績の年齢構成を出発点に計算し直しています（${STANDARD_LABEL}：${lowBirthLegend(m)}${LOW_BIRTH_NOTE}全国の2100年は ${nationalChangeLine(m)}）。</li>
    ${line('境界')}
    <li>残す対象は、名勝・名物・観光地・食・建物・衣装など、日本らしいもの（日本全体の対象と、各都道府県の対象）。名所のデータ ${site.model.landmarks.length}件のうち、表示は各県の代表的な例 ${site.landmarks.length}件（名物・食・衣装は、まだ入っていません）。名所と公表資料の言葉 ${(site.data.claims ?? []).length}件は、各公式サイトと公表資料から。地図の形は簡略化していて、測量には使えません。</li>
    ${line('市町村の歳出')}
    ${line('歳出の公表値')}
  </ul>
  <p class="sm">${HAMAMATSU_NOTE}</p>`;
  } else {
    return page404();
  }
  return { html: `<section class="screen"><div class="wrap">${body}${back}</div></section>`, title };
}

function page404(): Page {
  return { html: '<section class="screen"><div class="wrap"><h1>このページは見つかりません。</h1><a class="btn" href="#/">ホームへ</a></div></section>', title: '見つかりません' };
}

// -----------------------------------------------------------------------------------------------------------------
// Shell and router
// -----------------------------------------------------------------------------------------------------------------

export const NAV: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'meisho', label: '名所' },
  { key: 'chizu', label: '地図' },
  { key: 'awase', label: '答え合わせ' },
  { key: 'ai', label: 'AIに聞く' },
  { key: 'about', label: 'このアプリについて' },
];

function shellHtml(): string {
  return `<header class="gm"><div class="gm-in"><a class="brand" href="#/">2100年の日本</a><button type="button" class="menu-btn" id="menuBtn" aria-expanded="false" aria-controls="nav">メニュー</button><ul class="nav" id="nav">${NAV.map((n) => `<li><a href="#/${n.key}" data-nav="${n.key}">${n.label}</a></li>`).join('')}</ul></div></header><main id="page"></main>`;
}

/** Route a hash to a page. Exported for tests. */
export function routePage(site: Site, hash: string): { top: string; page: Page } {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const top = parts[0] ?? '';
  if (!top) return { top, page: pageHome(site) };
  if (top === 'meisho') {
    if (parts[1] === 'g') return { top, page: pageMeisho(site, parts[2]) };
    if (parts[1]) return { top, page: pageLandmark(site, parts[1]) };
    return { top, page: pageMeisho(site, undefined) };
  }
  if (top === 'chizu') return { top, page: pageChizu(site, parts[1], parts[2]) };
  if (top === 'awase') return { top, page: pageAwase(site, parts[1]) };
  if (top === 'ai') return { top, page: pageAi(site) };
  if (top === 'about') return { top, page: pageAbout(site, parts[1]) };
  return { top, page: page404() };
}

export interface SiteOptions {
  fetch?: typeof fetch;
  base?: string;
}

/** Build the site's state from the loaded data (the centroids file is read here; without it the maps have no points). */
export async function buildSite(data: AppData, opts: SiteOptions = {}): Promise<Site> {
  const model = buildModel(data);
  const prefs = prefectureShapes(data.japanTopo);
  const centre = new Map<string, [number, number]>();
  try {
    const f = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
    const url = opts.base === undefined ? dataUrl('data/geo/centroids.json') : dataUrl('data/geo/centroids.json', opts.base);
    const res = await f(url);
    const raw = (await res.json()) as { areas?: Record<string, [number, number]> };
    for (const [code, [lon, lat]] of Object.entries(raw.areas ?? {})) {
      const p = project(lon, lat, code.slice(0, 2));
      centre.set(code, [Math.round(p[0]), Math.round(p[1])]);
    }
  } catch (e) {
    console.warn('data/geo/centroids.json could not be loaded; the landmark points are left out', e);
  }
  const landmarks = shownLandmarks(model.landmarks);
  return {
    data,
    model,
    prefs,
    prefByCode: new Map(prefs.map((p) => [p.code, p])),
    centre,
    landmarks,
    lmById: new Map(landmarks.map((l) => [l.id, l])),
    townCache: new Map(),
    loadOpts: { fetch: opts.fetch, base: opts.base },
  };
}

export async function mountSite(root: HTMLElement, opts: SiteOptions = {}): Promise<void> {
  root.classList.add('site');
  root.innerHTML = `${shellHtml()}`;
  const main = root.querySelector<HTMLElement>('#page')!;
  main.innerHTML = '<p class="loading" role="status">データを読み込んでいます（約2MB）</p>';
  let site: Site;
  try {
    const data = await loadAll(opts);
    site = await buildSite(data, opts);
  } catch (e) {
    console.error('mountSite failed', e);
    main.innerHTML = `<div class="load-error" role="alert"><p>データを読み込めませんでした。</p><p>${esc(e instanceof Error ? e.message : String(e))}</p><button type="button" class="btn btn-primary" id="retry">もう一度読み込む</button></div>`;
    main.querySelector('#retry')?.addEventListener('click', () => void mountSite(root, opts));
    return;
  }
  const nav = root.querySelector<HTMLElement>('#nav')!;
  const menuBtn = root.querySelector<HTMLButtonElement>('#menuBtn')!;
  menuBtn.addEventListener('click', () => {
    const open = !nav.classList.contains('open');
    nav.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  nav.addEventListener('click', () => {
    nav.classList.remove('open');
    menuBtn.setAttribute('aria-expanded', 'false');
  });
  const route = (): void => {
    stopAll();
    routeToken++;
    const { top, page } = routePage(site, location.hash);
    main.innerHTML = page.html;
    root.querySelectorAll<HTMLAnchorElement>('.nav a').forEach((a) => {
      if (a.dataset.nav === top) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.title = page.title ? `${page.title}｜2100年の日本` : '2100年の日本';
    window.scrollTo(0, 0);
    page.after?.();
  };
  window.addEventListener('hashchange', route);
  route();
}
