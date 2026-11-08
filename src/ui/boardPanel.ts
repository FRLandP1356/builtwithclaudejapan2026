// The 「分かれ目」 panel: the first card of the right column. For the place on screen (the country, a prefecture or a
// town) it shows when, where and what falls below its population guide: a strip of bars (towns newly below a guide in
// each five-year step, on the eight essential facilities), the earliest crossings as a short list (year, facility,
// town) and what is already below in 2020. The wording and the numbers come from board.ts and src/engine/crossings.ts;
// this file is the DOM.
//
// Each row opens a disclosure 「ここを残すには」 (boardKeep.ts): what the town would need to reach the guide and what falls
// below elsewhere when those people come from every other town. One is open at a time; a new place closes them all.
//
// After the rows, for a prefecture or a town, the section 「ここにある有名なもの」 (landmarks.ts) lists the famous places
// and things that are there, with their sources: context, listed as facts, tied to no row and no guide.
//
// After that, for a prefecture only, the section 「公表資料に書かれていること」 (claims.ts) quotes, word for word and with the
// document they come from, what published documents say about population decline for the prefecture. The app quotes; the
// quotations are not its forecast and are tied to no row and no guide.
//
// Built once; a new selection or a new scenario rebuilds the strip and the list, a new year only moves the mark on the
// strip. `mountBoardPanel` returns its teardown.
import { indexClaims } from '../data/claims';
import { indexLandmarks, landmarksOf } from '../data/landmarks';
import {
  alreadyBelowAreas,
  alreadyBelowText,
  BOARD_BAR_SUMMARY_NONE,
  BOARD_ESSENTIAL_NOTE,
  BOARD_GUIDE_NOTE,
  BOARD_GUIDE_SUMMARY,
  BOARD_MORE_PLAIN,
  BOARD_NONE,
  BOARD_NONE_ESSENTIAL,
  BOARD_OTHERS,
  BOARD_ROWS,
  BOARD_TABLE,
  barsSummary,
  boardBars,
  boardBarsLead,
  boardCrossings,
  boardHeading,
  essentialFacilities,
  moreText,
  repeatedYears,
  scopeGroups,
  scopeRows,
  townRows,
  type BoardBars,
  type BoardRow,
} from './board';
import { createBoardKeep, type BoardKeep, type BoardKeepContext } from './boardKeep';
import { createClaimSection } from './claims';
import { deriveTotals } from './derive';
import { formatCount } from './format';
import { createLandmarkSection, rowLandmarksText } from './landmarks';
import { pickArea, type Level } from './nav';
import { phraseNodes } from './phrases';
import { badgeFor } from './sources';
import type { AppState, PanelContext } from './state';
import { resolveScope, type TownScope } from './townPanel';
import './boardPanel.css';

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The years whose label is drawn under the strip; every year is in the table. */
const LABELLED_YEARS: ReadonlySet<number> = new Set([2030, 2050, 2070, 2100]);

// ---------------------------------------------------------------------------------------------------------------
// The strip of bars
// ---------------------------------------------------------------------------------------------------------------

interface Strip {
  root: HTMLElement;
  lead: HTMLElement;
  summary: HTMLElement;
  list: HTMLOListElement;
  tbody: HTMLTableSectionElement;
  bars: Map<number, { li: HTMLLIElement; value: HTMLElement }>;
  shown: BoardBars;
}

function buildStrip(): Strip {
  const root = h('figure', 'board-years');
  const lead = h('figcaption', 'note board-years-lead');
  const list = h('ol', 'board-bars');
  list.setAttribute('aria-hidden', 'true'); // the sentence under it and the table carry the same numbers
  const summary = h('p', 'board-years-summary');
  const details = h('details', 'chart-table board-table');
  details.append(h('summary', undefined, BOARD_TABLE));
  const wrap = h('div', 'table-wrap');
  const table = h('table', 'data-table board-years-table');
  const thead = h('thead');
  const headRow = h('tr');
  const thYear = h('th', undefined, '年');
  thYear.setAttribute('scope', 'col');
  const thValue = h('th', 'num', '数');
  thValue.setAttribute('scope', 'col');
  headRow.append(thYear, thValue);
  thead.append(headRow);
  const tbody = h('tbody');
  table.append(thead, tbody);
  wrap.append(table);
  details.append(wrap);
  root.append(lead, list, summary, details);
  return { root, lead, summary, list, tbody, bars: new Map(), shown: { bars: [], max: 0 } };
}

function paintStrip(strip: Strip, bars: BoardBars, level: Level, year: number): void {
  strip.shown = bars;
  strip.lead.textContent = boardBarsLead(level);
  strip.list.replaceChildren();
  strip.tbody.replaceChildren();
  strip.bars.clear();
  const unit = level === 'area' ? '種類' : '町';
  for (const b of bars.bars) {
    const li = h('li', 'board-bar');
    if (b.estimate) li.classList.add('is-estimate');
    li.dataset.year = String(b.year);
    const pct = bars.max > 0 ? (b.value / bars.max) * 100 : 0;
    li.style.setProperty('--board-h', `${pct.toFixed(1)}%`);
    const value = h('span', 'board-bar-value');
    const fill = h('span', 'board-bar-fill');
    const label = h('span', 'board-bar-year', LABELLED_YEARS.has(b.year) ? String(b.year) : '');
    li.append(value, fill, label);
    strip.list.append(li);
    strip.bars.set(b.year, { li, value });
    const tr = h('tr');
    const th = h('th', undefined, `${b.year}年`);
    th.setAttribute('scope', 'row');
    tr.append(th, h('td', 'num', `${formatCount(b.value)}${unit}`));
    if (b.estimate) tr.classList.add('is-estimate');
    strip.tbody.append(tr);
  }
  strip.summary.textContent = bars.max > 0 ? barsSummary(bars, unit) : BOARD_BAR_SUMMARY_NONE;
  markYear(strip, year);
}

/** The bar of the year on screen carries `aria-current`; the tallest bars and that bar show their number. */
function markYear(strip: Strip, year: number): void {
  const { bars, max } = strip.shown;
  for (const b of bars) {
    const el = strip.bars.get(b.year);
    if (!el) continue;
    const now = b.year === year;
    if (now) el.li.setAttribute('aria-current', 'true');
    else el.li.removeAttribute('aria-current');
    const isMax = b.value > 0 && b.value === max;
    const text = isMax || (now && b.value > 0) ? formatCount(b.value) : '';
    if (el.value.textContent !== text) el.value.textContent = text;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------------------------

/**
 * One line of the list: the year (with the 試算 mark after 2050), the facility and, for a scope, the town; then the
 * disclosure. `sameYear` (the row before it in its list has this year) only dims the year: the text stays.
 */
export function buildRow(row: BoardRow, keep?: (row: BoardRow) => BoardKeep, sameYear = false): HTMLLIElement {
  const li = h('li', 'board-row');
  if (sameYear) li.classList.add('is-same-year');
  li.dataset.year = String(row.year);
  li.dataset.facility = row.facilityId;
  li.dataset.area = row.leadCode;
  const head = h('div', 'board-row-head');
  const yearEl = h('span', 'board-row-year');
  yearEl.append(h('span', 'num', String(row.year)), '年');
  if (row.estimate) yearEl.append(' ', h('span', 'badge-estimate', badgeFor(row.year).text));
  const what = h('span', 'board-row-what');
  what.append(h('span', 'board-row-facility', row.facilityName));
  if (row.townsText) what.append(h('span', 'board-row-towns', row.townsText));
  head.append(yearEl, what);
  li.append(head);
  if (keep) li.append(keep(row).details);
  return li;
}

const mounted = new WeakMap<HTMLElement, () => void>();

/**
 * Fill `el` (the #panel-board section, which already holds its h2.panel-title) and keep it in step with the store.
 * Returns the teardown.
 */
export function mountBoardPanel(el: HTMLElement, ctx: PanelContext): () => void {
  mounted.get(el)?.();
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a] as const));
  const names = { area: (c: string) => areaByCode.get(c)?.name, prefOfArea: (c: string) => areaByCode.get(c)?.prefName };
  const essential = essentialFacilities(data.facilities);
  // The landmarks file is optional: without it the index is empty and the section stays hidden.
  const landmarkIndex = indexLandmarks(data.landmarks ?? []);
  const landmarks = createLandmarkSection({
    index: landmarkIndex,
    areaName: (code) => areaByCode.get(code)?.name,
    select: (l) => store.set(pickArea({ code: l.areaCode, prefCode: l.prefCode })),
  });
  // The claims file is optional too: without it the index is empty and the section stays hidden.
  const claims = createClaimSection({ index: indexClaims(data.claims ?? []) });

  const root = h('div', 'board');
  const heading = h('h3', 'board-heading');
  const strip = buildStrip();
  const list = h('ol', 'board-list');
  const none = h('p', 'board-none');
  none.hidden = true;
  // 「続きを見る（残り59件）」: one fold under the first rows. It holds everything the first look leaves out: the rest of the
  // rows, a town's other facilities, the famous places, the published documents, what is already below and the note on
  // the guide (2026-11-08: the screen shows the bars, three rows and this fold).
  const more = h('details', 'board-more');
  const moreSummary = h('summary');
  const moreList = h('ol', 'board-list');
  const others = h('details', 'board-others');
  const othersSummary = h('summary');
  const othersList = h('ol', 'board-list');
  others.append(othersSummary, othersList);
  others.hidden = true;
  const already = h('p', 'note board-already');
  // What the guide is, and that the count is on the eight essential facilities: one disclosure, closed at first.
  const guideBox = h('details', 'board-guide');
  guideBox.append(h('summary', undefined, BOARD_GUIDE_SUMMARY));
  const essentialNote = h('p', 'note board-essential-note', BOARD_ESSENTIAL_NOTE);
  const guide = h('p', 'note board-note');
  guide.replaceChildren(...phraseNodes(BOARD_GUIDE_NOTE));
  guideBox.append(essentialNote, guide);
  more.append(moreSummary, moreList, others, landmarks.root, claims.root, already, guideBox);
  root.append(heading, strip.root, list, none, more);
  el.append(root);

  let scope: TownScope | undefined;
  let keeps: BoardKeep[] = [];
  const keepCtx: BoardKeepContext = {
    data,
    facilities: data.facilities,
    store,
    areaName: (code) => areaByCode.get(code)?.name,
    closeOthers(except) {
      for (const k of keeps) if (k !== except && k.details.open) k.details.open = false;
    },
    landmarkLine: (code) => rowLandmarksText(landmarksOf(landmarkIndex, 'area', code)),
  };
  const makeKeep = (row: BoardRow): BoardKeep => {
    const k = createBoardKeep(row, keepCtx);
    keeps.push(k);
    return k;
  };

  function fillList(target: HTMLOListElement, rows: BoardRow[]): void {
    const repeats = repeatedYears(rows);
    target.replaceChildren(...rows.map((r, i) => buildRow(r, makeKeep, repeats[i])));
  }

  function render(s: AppState): void {
    scope = resolveScope(data, s, areaByCode);
    const sc = scope;
    const totals = deriveTotals(s.series, data.groups);
    heading.textContent = boardHeading(sc.level, sc.name);
    // The rows are rebuilt: every disclosure goes with them (a new place or new assumptions start with all closed).
    for (const k of keeps) k.destroy();
    keeps = [];
    let bars: BoardBars;
    if (sc.level === 'area') {
      // A town: every facility, the essential ones first and the rest behind 「その他の施設」.
      const r = boardCrossings(totals, sc.areaCodes, data.facilities);
      bars = boardBars(r.crossings, totals.years, sc.level);
      const rows = townRows(r.crossings, data.facilities, sc.name);
      fillList(list, rows.essential.slice(0, BOARD_ROWS));
      none.textContent = BOARD_NONE_ESSENTIAL;
      none.hidden = rows.essential.length > 0;
      const rest = rows.essential.slice(BOARD_ROWS);
      moreSummary.textContent = rest.length + rows.others.length > 0 ? moreText(rest.length + rows.others.length) : BOARD_MORE_PLAIN;
      fillList(moreList, rest);
      others.hidden = rows.others.length === 0;
      othersSummary.textContent = `${BOARD_OTHERS}（${formatCount(rows.others.length)}）`;
      fillList(othersList, rows.others);
      already.textContent = alreadyBelowText(sc.level, r.alreadyBelow.length);
      essentialNote.hidden = true;
    } else {
      // The country or a prefecture: the eight essential facilities only, the earliest rows first.
      const r = boardCrossings(totals, sc.areaCodes, essential);
      bars = boardBars(r.crossings, totals.years, sc.level);
      const rows = scopeRows(scopeGroups(r.crossings, data.facilities), data.facilities, names, sc.level);
      fillList(list, rows.slice(0, BOARD_ROWS));
      none.textContent = BOARD_NONE;
      none.hidden = rows.length > 0;
      const rest = rows.slice(BOARD_ROWS);
      moreSummary.textContent = rest.length > 0 ? moreText(rest.length) : BOARD_MORE_PLAIN;
      fillList(moreList, rest);
      others.hidden = true;
      others.open = false;
      othersList.replaceChildren();
      already.textContent = alreadyBelowText(sc.level, alreadyBelowAreas(r, data.facilities));
      essentialNote.hidden = false;
    }
    more.open = false;
    paintStrip(strip, bars, sc.level, s.year);
    landmarks.render(sc.level, sc.key);
    claims.render(sc.level, sc.key);
  }

  render(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    const selChanged = s.selectedArea !== prev.selectedArea || s.selectedPref !== prev.selectedPref;
    if (selChanged || s.series !== prev.series) render(s);
    else if (s.year !== prev.year) markYear(strip, s.year);
  });

  const teardown = () => {
    if (mounted.get(el) === teardown) mounted.delete(el);
    unsubscribe();
    for (const k of keeps) k.destroy();
    keeps = [];
    root.remove();
  };
  mounted.set(el, teardown);
  return teardown;
}
