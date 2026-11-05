// The population-allocation panel: "what if one prefecture (or town) had N% more people, with the country's total
// unchanged?" The answer is not the change in population (small next to the whole country) but the number of towns
// that cross each facility's population guide (MLIT p50), so the table counts towns, essential facilities first.
//
// The panel reads the store (year, series, selection) and the controls it owns; it never writes to the store.
// Everything it computes uses the full 1,884-area list (Ruling 20) and all 48 facilities.
import './controlsPanel.css';
import type { AppData } from '../data/loader';
import { allocate, type AllocationInput, type AllocationResult, type FacilityFlip } from '../engine/allocation';
import type { Area, Facility, Series } from '../engine/types';
import { buildOverlay } from './allocationOverlay';
import { deriveTotals, yearIndex } from './derive';
import { formatPop } from './format';
import { prefCodesOf, REGION_IDS, REGION_NAMES, type RegionId } from './regions';
import { badgeFor } from './sources';
import type { AllocationOverlay, AppState, PanelContext } from './state';

/** Button texts for drawing the allocation on the map. */
export const MAP_BUTTON = { off: '地図に反映する', on: '地図に反映中' } as const;
export const MAP_STATUS = {
  on: '地図の色は、割り振りによる人口の変化です。施設名を押すと、目安をまたいだ町に印が付きます。',
  cleared: '',
} as const;

// -----------------------------------------------------------------------------------------------------------------
// Pure part.
// -----------------------------------------------------------------------------------------------------------------

export const PERCENT_MIN = -30;
export const PERCENT_MAX = 50;
export const PERCENT_STEP = 5;
export const PERCENT_DEFAULT = 10;
/** Rows of the facility table shown before the rest go into a collapsed list (essential rows are never hidden). */
export const VISIBLE_ROW_CAP = 10;
/** Example town names shown per facility for each direction. */
export const EXAMPLE_COUNT = 3;
/** Prefecture shown when nothing is selected. */
export const DEFAULT_TARGET_PREF = '30';

export interface AllocationForm {
  target: { kind: 'pref' | 'area'; code: string };
  /** Share of the target group's population to move, in percent: negative takes people out of the target. */
  percent: number;
  sourceMode: 'proportional' | 'regions';
  /** Used when `sourceMode` is 'regions'. */
  regionIds: readonly RegionId[];
}

/** A form that cannot be turned into an allocation. The message is for the user (Japanese). */
export class AllocationFormError extends RangeError {
  readonly userMessage: string;
  constructor(userMessage: string) {
    super(`allocation form: ${userMessage}`);
    this.name = 'AllocationFormError';
    this.userMessage = userMessage;
  }
}

/** The engine's input for a form, given the target group's population in people (percent -> people). */
export function buildAllocationInput(form: AllocationForm, targetPeople: number): AllocationInput {
  if (!Number.isFinite(form.percent)) throw new AllocationFormError('割合が数として読めません。');
  let source: AllocationInput['source'] = { mode: 'proportional' };
  if (form.sourceMode === 'regions') {
    const prefCodes = prefCodesOf(form.regionIds);
    if (prefCodes.length === 0) throw new AllocationFormError('人口を動かす元の地域を、1つ以上選んでください。');
    source = { mode: 'regions', prefCodes };
  }
  return { target: { ...form.target }, deltaPeople: (targetPeople * form.percent) / 100, source };
}

/** A message the user can read for anything the allocation can throw. Never shows an English engine message. */
export function allocationErrorMessage(e: unknown): string {
  if (e instanceof AllocationFormError) return e.userMessage;
  if (e instanceof RangeError) {
    const m = e.message;
    if (m.includes('takes more than the target')) return 'そこまで減らせる人口がありません。';
    if (m.includes("larger than the source")) return '人口を動かす元の地域に、それだけの人口がありません。';
    if (m.includes('source group is empty')) return '人口を動かす元になる地域がありません。';
    if (m.includes('no area matches target')) return '選んだ地域が見つかりません。';
  }
  return 'この条件では計算できませんでした。';
}

const countFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** +3 / −12 / ±0 (true minus sign). */
export function signedCount(n: number): string {
  if (n === 0) return '±0';
  return `${n < 0 ? '−' : '+'}${countFormat.format(Math.abs(n))}`;
}

/** 約2.6万人 (always a positive amount; the sign is carried by the sentence). */
export function approxPeople(n: number): string {
  return `約${formatPop(Math.abs(n))}`;
}

export interface DescribeInput {
  year: number;
  targetName: string;
  percent: number;
  /** People moved: positive when the target gains. */
  people: number;
  /** Region names when people come from chosen regions; undefined for "the rest of the country". */
  sourceNames: readonly string[] | undefined;
}

/** The one-sentence summary above the table. */
export function describeAllocation(d: DescribeInput): string {
  if (d.percent === 0) return `割合が0%なので、${d.year}年の${d.targetName}の人口は動きません。`;
  const gain = d.percent > 0;
  const others = d.sourceNames ? `選んだ地域（${d.sourceNames.join('・')}）` : 'ほかの地域';
  return (
    `${d.year}年に${d.targetName}の人口を${Math.abs(d.percent)}%（${approxPeople(d.people)}）${gain ? '増やす' : '減らす'}と、` +
    `全国の合計は変わらず、${others}が合わせて${approxPeople(d.people)}${gain ? '減ります' : '増えます'}。`
  );
}

export interface ExampleList {
  /** How many towns crossed in this direction. */
  count: number;
  /** Up to EXAMPLE_COUNT town names, the towns closest to the guide first. */
  examples: string[];
}

export interface FlipRow {
  facilityId: string;
  name: string;
  essential: boolean;
  /** Towns at or above the guide (p50) before and after, and the difference. */
  before: number;
  after: number;
  diff: number;
  /** Towns that rose to the guide or above. */
  gained: ExampleList;
  /** Towns that fell below the guide. */
  lost: ExampleList;
}

export interface AllocationSummary {
  year: number;
  /** Every facility with at least one town crossing, essential facilities first. */
  rows: FlipRow[];
  /** The first rows (at least all essential rows, at most VISIBLE_ROW_CAP otherwise) and the rest. */
  visible: FlipRow[];
  hidden: FlipRow[];
  nothingFlips: boolean;
}

const nameCache = new WeakMap<readonly Area[], (code: string) => string>();

/** Town name for display: the bare name, plus the prefecture in brackets when another town shares the name. */
export function townNamer(areas: readonly Area[]): (code: string) => string {
  const hit = nameCache.get(areas);
  if (hit) return hit;
  const count = new Map<string, number>();
  for (const a of areas) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  const byCode = new Map(areas.map((a) => [a.code, a]));
  const fn = (code: string): string => {
    const a = byCode.get(code);
    if (!a) return code;
    return (count.get(a.name) ?? 0) > 1 ? `${a.name}（${a.prefName}）` : a.name;
  };
  nameCache.set(areas, fn);
  return fn;
}

/**
 * The facility rows for an allocation result: only facilities where some town crossed its guide, essential ones
 * first, each group ordered by the number of towns that crossed (ties keep the facility list order).
 */
export function summarizeAllocation(
  result: Pick<AllocationResult, 'pop' | 'flips'>,
  data: Pick<AppData, 'areas' | 'facilities'>,
  year: number,
): AllocationSummary {
  const facilityById = new Map<string, Facility>(data.facilities.map((f) => [f.id, f]));
  const nameOf = townNamer(data.areas);

  const examplesOf = (codes: string[], distance: (pop: number) => number): ExampleList => {
    const ranked = codes
      .map((code) => ({ code, d: distance(result.pop.get(code) ?? Number.NaN) }))
      .filter((x) => Number.isFinite(x.d))
      .sort((a, b) => a.d - b.d || (a.code < b.code ? -1 : 1));
    return { count: codes.length, examples: ranked.slice(0, EXAMPLE_COUNT).map((x) => nameOf(x.code)) };
  };

  const order = new Map(data.facilities.map((f, i) => [f.id, i]));
  const rows: FlipRow[] = [];
  for (const flip of result.flips as FacilityFlip[]) {
    if (flip.gained.length + flip.lost.length === 0) continue;
    const f = facilityById.get(flip.facilityId);
    if (!f) continue;
    rows.push({
      facilityId: f.id,
      name: f.name,
      essential: f.essential,
      before: flip.before,
      after: flip.after,
      diff: flip.after - flip.before,
      gained: examplesOf(flip.gained, (pop) => pop - f.p50),
      lost: examplesOf(flip.lost, (pop) => f.p50 - pop),
    });
  }
  rows.sort(
    (a, b) =>
      Number(b.essential) - Number(a.essential) ||
      b.gained.count + b.lost.count - (a.gained.count + a.lost.count) ||
      order.get(a.facilityId)! - order.get(b.facilityId)!,
  );
  const essentialCount = rows.filter((r) => r.essential).length;
  const cut = Math.max(VISIBLE_ROW_CAP, essentialCount);
  return { year, rows, visible: rows.slice(0, cut), hidden: rows.slice(cut), nothingFlips: rows.length === 0 };
}

export interface PopulationAt {
  /** Population of each of the full area list at one year, in the order of `areas`. */
  popByArea: Map<string, number>;
  areaPref: Map<string, string>;
}

const prefMapCache = new WeakMap<readonly Area[], Map<string, string>>();

/** Every area's population in `year` under the series (Ruling 20: always the full list). */
export function populationAt(data: Pick<AppData, 'areas' | 'groups'>, series: Map<string, Series>, year: number): PopulationAt {
  const totals = deriveTotals(series, data.groups);
  const i = yearIndex(totals.years, year);
  if (i < 0) throw new RangeError(`populationAt: year ${year} is not in the series`);
  let areaPref = prefMapCache.get(data.areas);
  if (!areaPref) {
    areaPref = new Map(data.areas.map((a) => [a.code, a.prefCode]));
    prefMapCache.set(data.areas, areaPref);
  }
  const popByArea = new Map<string, number>();
  for (const a of data.areas) popByArea.set(a.code, totals.area.get(a.code)?.[i] ?? Number.NaN);
  return { popByArea, areaPref };
}

/** People in the target group (the prefecture, or the one town). */
export function targetPeople(target: AllocationForm['target'], at: PopulationAt): number {
  let sum = 0;
  for (const [code, p] of at.popByArea) {
    if (target.kind === 'area' ? code === target.code : at.areaPref.get(code) === target.code) sum += p;
  }
  return sum;
}

export interface Computed {
  input: AllocationInput;
  result: AllocationResult;
  summary: AllocationSummary;
  targetPeople: number;
}

/** Run one allocation end to end. Throws RangeError (see allocationErrorMessage) when it cannot be done. */
export function computeAllocation(
  data: Pick<AppData, 'areas' | 'groups' | 'facilities'>,
  series: Map<string, Series>,
  year: number,
  form: AllocationForm,
  at: PopulationAt = populationAt(data, series, year),
): Computed {
  const people = targetPeople(form.target, at);
  const input = buildAllocationInput(form, people);
  const result = allocate(at.popByArea, at.areaPref, input, data.facilities);
  return { input, result, summary: summarizeAllocation(result, data, year), targetPeople: people };
}

// -----------------------------------------------------------------------------------------------------------------
// The panel.
// -----------------------------------------------------------------------------------------------------------------

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const TEMPLATE = `
  <p class="panel-lead">全国の人口は変えずに、ある県や町の人口を増やすと、ほかの地域がどうなるかを見ます。</p>
  <div class="alloc-form">
    <div class="field">
      <label class="field-label" for="alloc-target"><span>人口を増減させる地域</span></label>
      <select class="input" id="alloc-target"></select>
    </div>
    <div class="field">
      <label class="field-label" for="alloc-percent"><span>増やす・減らす割合</span><span class="field-value" id="alloc-percent-value"></span></label>
      <input class="range" id="alloc-percent" type="range" min="${PERCENT_MIN}" max="${PERCENT_MAX}" step="${PERCENT_STEP}" value="${PERCENT_DEFAULT}" aria-describedby="alloc-percent-help" />
      <p class="field-help" id="alloc-percent-help"></p>
    </div>
    <div class="field">
      <span class="field-label" id="alloc-source-title"><span>人口を動かす元</span></span>
      <div class="choice choice-stack" role="group" aria-labelledby="alloc-source-title">
        <button type="button" data-source="proportional" aria-pressed="true">全国のほかの地域に比例して</button>
        <button type="button" data-source="regions" aria-pressed="false">選んだ地域から</button>
      </div>
      <fieldset class="alloc-regions" id="alloc-regions" hidden>
        <legend class="sr-only">人口を動かす元の地域</legend>
      </fieldset>
    </div>
    <p class="alloc-year" id="alloc-year"></p>
    <div class="actions alloc-map-actions">
      <button type="button" class="btn alloc-map-toggle" id="alloc-map-toggle" aria-pressed="false">${MAP_BUTTON.off}</button>
      <p class="note alloc-map-status" id="alloc-map-status" role="status"></p>
    </div>
  </div>
  <p class="notice" id="alloc-error" role="alert" hidden></p>
  <div class="alloc-result" id="alloc-result">
    <p class="alloc-summary" id="alloc-summary" role="status"></p>
    <div id="alloc-detail"></div>
  </div>
  <div class="alloc-notes">
    <p class="note">人口の差は全国で見ると小さいので、人口の目安をまたぐ町の数で示しています。</p>
    <p class="note">国土交通省の目安は三大都市圏を除く統計ですが、ここでは三大都市圏の町も同じ目安で数えています。</p>
    <p class="note">「人口の目安」は、国土交通省の統計で、その施設がある確率が50%になる人口の大きさです。「目安以上」は、その大きさ以上の町のことです。</p>
    <p class="note">実際の人口の動きの見通しではなく、「もし割り振ったら」の計算です。</p>
  </div>`;

const GROUP_ESSENTIAL = 'くらしの基本の施設';
const GROUP_OTHER = 'その他の施設';

function exampleLine(label: string, list: ExampleList): HTMLElement {
  const more = list.count - list.examples.length;
  const names = list.examples.join('、') + (more > 0 ? `　ほか${countFormat.format(more)}町` : '');
  const line = h('span', 'alloc-example');
  // The count never breaks in the middle ("（1" / "町）"); the rest may wrap.
  line.append(label, h('span', 'alloc-example-count', `（${countFormat.format(list.count)}町）`), `：${names}`);
  return line;
}

/** How a facility row is drawn: the name is a button that focuses that facility's towns on the map. */
interface RowOptions {
  focused: string | undefined;
  onFocus(facilityId: string): void;
}

function rowElement(r: FlipRow, opts: RowOptions): HTMLTableRowElement {
  const tr = h('tr');
  const head = h('td');
  const nameBtn = h('button', 'alloc-name alloc-focus', r.name);
  nameBtn.type = 'button';
  nameBtn.dataset.facility = r.facilityId;
  nameBtn.setAttribute('aria-pressed', String(opts.focused === r.facilityId));
  nameBtn.setAttribute('aria-label', `${r.name}。目安をまたいだ町を地図に示す`);
  nameBtn.addEventListener('click', () => opts.onFocus(r.facilityId));
  head.append(nameBtn);
  if (r.gained.count > 0) head.append(exampleLine('人口の目安以上になる町', r.gained));
  if (r.lost.count > 0) head.append(exampleLine('人口の目安を下回る町', r.lost));
  const diff = h('td', r.diff < 0 ? 'num alloc-down' : 'num', signedCount(r.diff));
  tr.append(head, h('td', 'num', countFormat.format(r.before)), h('td', 'num', countFormat.format(r.after)), diff);
  return tr;
}

function tableElement(rows: FlipRow[], grouped: boolean, className: string, rowOpts: RowOptions): HTMLElement {
  const wrap = h('div', 'table-wrap');
  const table = h('table', `data-table ${className}`);
  const thead = h('thead');
  const hr = h('tr');
  const th = (text: string, cls?: string, spoken?: string) => {
    const cell = h('th', cls);
    cell.scope = 'col';
    if (spoken) {
      const short = h('span', undefined, text);
      short.setAttribute('aria-hidden', 'true');
      cell.append(short, h('span', 'sr-only', spoken));
    } else {
      cell.textContent = text;
    }
    return cell;
  };
  hr.append(th('施設'), th('前', 'num', '割り振る前の、人口の目安以上の町の数'), th('後', 'num', '割り振った後の、人口の目安以上の町の数'), th('差', 'num', '町の数の増減'));
  thead.append(hr);
  table.append(thead);

  const groups: Array<{ title: string; rows: FlipRow[] }> = grouped
    ? [
        { title: GROUP_ESSENTIAL, rows: rows.filter((r) => r.essential) },
        { title: GROUP_OTHER, rows: rows.filter((r) => !r.essential) },
      ]
    : [{ title: '', rows }];
  for (const g of groups) {
    if (g.rows.length === 0) continue;
    const tbody = h('tbody');
    if (grouped) {
      const gr = h('tr', 'alloc-group');
      const cell = h('th', undefined, g.title);
      cell.colSpan = 4;
      cell.scope = 'rowgroup';
      gr.append(cell);
      tbody.append(gr);
    }
    for (const r of g.rows) tbody.append(rowElement(r, rowOpts));
    table.append(tbody);
  }
  wrap.append(table);
  return wrap;
}

function detailElement(summary: AllocationSummary, rowOpts: RowOptions): HTMLElement {
  const section = h('div', 'panel-section');
  section.append(h('h3', 'panel-section-title', '施設の人口の目安をまたぐ町の数'));
  if (summary.nothingFlips) {
    section.append(h('p', 'panel-empty', 'この割り振りでは、人口の目安をまたぐ町はありませんでした。'));
    return section;
  }
  section.append(
    h('p', 'note', '各施設について、人口の目安以上の町の数を、割り振る前と後で並べています。施設名を押すと、またいだ町を地図に示します。'),
    tableElement(summary.visible, true, 'alloc-table-visible', rowOpts),
  );
  if (summary.hidden.length > 0) {
    const details = h('details', 'alloc-more');
    details.append(h('summary', undefined, `その他の施設を、さらに${summary.hidden.length}件見る`), tableElement(summary.hidden, false, 'alloc-table-hidden', rowOpts));
    section.append(details);
  }
  return section;
}

function signedPercent(p: number): string {
  if (p === 0) return '±0%';
  return `${p < 0 ? '−' : '+'}${Math.abs(p)}%`;
}

/** Write text into a live region only when it differs, so a screen reader is not told the same thing again. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** Remove a badge (and the space before it) that an earlier mount left in the heading. */
function resetHeadingBadge(title: Element): void {
  for (const b of title.querySelectorAll(':scope > .badge-estimate')) {
    const gap = b.previousSibling;
    if (gap?.nodeType === Node.TEXT_NODE && gap.textContent === ' ') gap.remove();
    b.remove();
  }
}

/** The teardown of the panel currently mounted in an element: a second mount into it ends the first. */
const mounted = new WeakMap<HTMLElement, () => void>();

/** Mount the panel into `el`. Returns a teardown that stops listening to the store and cancels a pending update. */
export function mountAllocation(el: HTMLElement, ctx: PanelContext): () => void {
  const { store, data } = ctx;
  mounted.get(el)?.();

  const title = el.querySelector('.panel-title');
  el.replaceChildren(...(title ? [title] : []));
  if (title) resetHeadingBadge(title);
  el.insertAdjacentHTML('beforeend', TEMPLATE); // static text only: nothing from data is interpolated

  const q = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
  const targetSelect = q<HTMLSelectElement>('#alloc-target');
  const percentInput = q<HTMLInputElement>('#alloc-percent');
  const percentValue = q<HTMLElement>('#alloc-percent-value');
  const percentHelp = q<HTMLElement>('#alloc-percent-help');
  const sourceButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-source]')];
  const regionsEl = q<HTMLFieldSetElement>('#alloc-regions');
  const yearEl = q<HTMLElement>('#alloc-year');
  const errorEl = q<HTMLElement>('#alloc-error');
  const summaryEl = q<HTMLElement>('#alloc-summary');
  const detailEl = q<HTMLElement>('#alloc-detail');
  const mapToggle = q<HTMLButtonElement>('#alloc-map-toggle');
  const mapStatus = q<HTMLElement>('#alloc-map-status');

  // The map overlay this panel owns: on while the toggle is pressed; redrawn on every recompute while on.
  let mapActive = false;
  let focusFacilityId: string | undefined;
  let lastComputed: { c: Computed; form: AllocationForm } | undefined; // the result on screen and the form it came from
  let ownOverlay: AllocationOverlay | undefined; // the object the store holds, to tell our overlay from another's
  let pushing = false; // true while our own set({ allocation }) notifies, so the subscriber does not read it as external

  // The estimate marker next to the heading, present only while the chosen year is after 2050.
  const titleBadge = h('span', 'badge-estimate', badgeFor(2100).text);
  const titleGap = document.createTextNode(' ');

  const nameOf = townNamer(data.areas);
  const prefName = (code: string) => data.prefNames.get(code) ?? code;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a]));

  // Form state, owned by the panel.
  let targetValue = `pref:${pickPref(store.get())}`;
  let percent = PERCENT_DEFAULT;
  let sourceMode: AllocationForm['sourceMode'] = 'proportional';
  const regionIds = new Set<RegionId>(['kanto']);
  let pending: number | undefined;
  let alive = true;

  function pickPref(s: AppState): string {
    if (s.selectedPref !== undefined && data.prefNames.has(s.selectedPref)) return s.selectedPref;
    if (data.prefNames.has(DEFAULT_TARGET_PREF)) return DEFAULT_TARGET_PREF;
    return [...data.prefNames.keys()].sort()[0] ?? DEFAULT_TARGET_PREF;
  }

  // Region checkboxes.
  for (const id of REGION_IDS) {
    const label = h('label', 'alloc-region');
    const box = h('input');
    box.type = 'checkbox';
    box.dataset.region = id;
    box.checked = regionIds.has(id);
    box.addEventListener('change', () => {
      if (!alive) return;
      if (box.checked) regionIds.add(id);
      else regionIds.delete(id);
      renderAll();
    });
    label.append(box, h('span', undefined, REGION_NAMES[id]));
    regionsEl.append(label);
  }

  function rebuildTargetOptions(s: AppState): void {
    const options: HTMLOptionElement[] = [];
    const add = (value: string, text: string) => {
      const o = h('option', undefined, text);
      o.value = value;
      options.push(o);
    };
    if (s.selectedArea !== undefined && areaByCode.has(s.selectedArea)) add(`area:${s.selectedArea}`, `選んだ町：${nameOf(s.selectedArea)}`);
    for (const code of [...data.prefNames.keys()].sort()) add(`pref:${code}`, prefName(code));
    targetSelect.replaceChildren(...options);
    if (!options.some((o) => o.value === targetValue)) targetValue = `pref:${pickPref(s)}`;
    targetSelect.value = targetValue;
  }

  function currentForm(): AllocationForm {
    const [kind, code] = targetValue.split(':');
    return { target: { kind: kind === 'area' ? 'area' : 'pref', code }, percent, sourceMode, regionIds: REGION_IDS.filter((id) => regionIds.has(id)) };
  }

  function targetName(f: AllocationForm): string {
    return f.target.kind === 'area' ? nameOf(f.target.code) : prefName(f.target.code);
  }

  // The population table is rebuilt only when the series or the year changes.
  let atKey: { series: Map<string, Series>; year: number; at: PopulationAt } | undefined;
  function populations(s: AppState): PopulationAt {
    if (!atKey || atKey.series !== s.series || atKey.year !== s.year) atKey = { series: s.series, year: s.year, at: populationAt(data, s.series, s.year) };
    return atKey.at;
  }

  function paintYear(s: AppState): void {
    const badge = badgeFor(s.year);
    const note = h('span', undefined, `${s.year}年の人口で計算　`);
    const mark = h('span', badge.estimate ? 'badge-estimate' : 'badge-official', badge.text);
    yearEl.replaceChildren(note, mark);
    percentHelp.textContent = `選んだ地域の${s.year}年の人口に対する割合です。`;
    if (badge.estimate) {
      if (!titleBadge.isConnected) title?.append(titleGap, titleBadge);
    } else {
      titleGap.remove();
      titleBadge.remove();
    }
  }

  function paintPercent(people: number): void {
    const moved = (people * percent) / 100;
    percentValue.textContent = `${signedPercent(percent)}（${percent === 0 ? '0人' : approxPeople(moved)}）`;
    percentInput.setAttribute(
      'aria-valuetext',
      percent === 0 ? '0%、0人' : `${percent > 0 ? 'プラス' : 'マイナス'}${Math.abs(percent)}%、${approxPeople(moved)}`,
    );
  }

  function showError(message: string): void {
    if (errorEl.hidden) errorEl.hidden = false;
    setText(errorEl, message);
    setText(summaryEl, '');
    detailEl.replaceChildren();
  }

  function paintMapToggle(): void {
    mapToggle.setAttribute('aria-pressed', String(mapActive));
    setText(mapToggle, mapActive ? MAP_BUTTON.on : MAP_BUTTON.off);
    setText(mapStatus, mapActive ? MAP_STATUS.on : MAP_STATUS.cleared);
  }

  /** Draw (or redraw) the current result on the map. */
  function pushOverlay(c: Computed, s: AppState, form: AllocationForm): void {
    const label = `${targetName(form)} ${signedPercent(form.percent)}`;
    if (focusFacilityId !== undefined && !c.summary.rows.some((r) => r.facilityId === focusFacilityId)) focusFacilityId = undefined;
    const overlay = buildOverlay({
      result: c.result,
      before: populations(s).popByArea,
      facilities: data.facilities,
      year: s.year,
      label,
      focusFacilityId,
    });
    pushing = true;
    try {
      if (store.set({ allocation: overlay })) ownOverlay = store.get().allocation;
    } finally {
      pushing = false;
    }
  }

  function clearOverlay(): void {
    if (ownOverlay !== undefined && store.get().allocation === ownOverlay) store.set({ allocation: undefined });
    ownOverlay = undefined;
  }

  /** The pressed state of the facility names, updated in place (keyboard focus and open disclosures stay). */
  function paintFocus(): void {
    for (const b of detailEl.querySelectorAll<HTMLButtonElement>('.alloc-focus')) {
      b.setAttribute('aria-pressed', String(mapActive && b.dataset.facility === focusFacilityId));
    }
  }

  const rowOpts: RowOptions = {
    get focused() {
      return mapActive ? focusFacilityId : undefined;
    },
    onFocus(facilityId) {
      if (!alive || !lastComputed) return;
      focusFacilityId = mapActive && focusFacilityId === facilityId ? undefined : facilityId;
      mapActive = true;
      paintMapToggle();
      pushOverlay(lastComputed.c, store.get(), lastComputed.form);
      paintFocus();
    },
  };

  function renderAll(): void {
    pending = undefined;
    const s = store.get();
    paintYear(s);
    for (const b of sourceButtons) b.setAttribute('aria-pressed', String(b.dataset.source === sourceMode));
    regionsEl.hidden = sourceMode !== 'regions';
    targetSelect.value = targetValue;
    percentInput.value = String(percent);

    const form = currentForm();
    const at = populations(s);
    paintPercent(targetPeople(form.target, at));
    try {
      const c = computeAllocation(data, s.series, s.year, form, at);
      lastComputed = { c, form };
      if (!errorEl.hidden) errorEl.hidden = true;
      setText(errorEl, '');
      setText(
        summaryEl,
        describeAllocation({
          year: s.year,
          targetName: targetName(form),
          percent: form.percent,
          people: c.input.deltaPeople,
          sourceNames: form.sourceMode === 'regions' ? form.regionIds.map((id) => REGION_NAMES[id]) : undefined,
        }),
      );
      if (mapActive) pushOverlay(c, s, form);
      detailEl.replaceChildren(detailElement(c.summary, rowOpts));
    } catch (e) {
      if (!(e instanceof RangeError)) console.error('allocation failed', e);
      lastComputed = undefined;
      showError(allocationErrorMessage(e));
      if (mapActive) {
        mapActive = false;
        clearOverlay();
        paintMapToggle();
      }
    }
  }

  mapToggle.addEventListener('click', () => {
    if (!alive) return;
    if (mapActive) {
      mapActive = false;
      clearOverlay();
      paintMapToggle();
      paintFocus(); // the rows lose their pressed state
      return;
    }
    if (!lastComputed) return; // the form has an error: nothing to draw
    mapActive = true;
    paintMapToggle();
    pushOverlay(lastComputed.c, store.get(), lastComputed.form);
    paintFocus();
  });

  targetSelect.addEventListener('change', () => {
    if (!alive) return;
    targetValue = targetSelect.value;
    renderAll();
  });
  percentInput.addEventListener('input', () => {
    if (!alive) return;
    percent = Number(percentInput.value);
    paintPercent(targetPeople(currentForm().target, populations(store.get())));
    if (pending === undefined) pending = requestAnimationFrame(renderAll);
  });
  for (const b of sourceButtons) {
    b.addEventListener('click', () => {
      if (!alive) return;
      sourceMode = b.dataset.source === 'regions' ? 'regions' : 'proportional';
      renderAll();
    });
  }

  // The map drives the default: moving to another prefecture retargets; a selected town is offered as a choice.
  const unsubscribe = store.subscribe((s, prev) => {
    const selChanged = s.selectedPref !== prev.selectedPref || s.selectedArea !== prev.selectedArea;
    if (selChanged) {
      if (s.selectedPref !== undefined && s.selectedPref !== prev.selectedPref) targetValue = `pref:${pickPref(s)}`;
      else if (targetValue.startsWith('area:') && s.selectedArea !== undefined) targetValue = `area:${s.selectedArea}`;
      else if (targetValue.startsWith('area:') && s.selectedArea === undefined) targetValue = `pref:${pickPref(prev)}`;
      rebuildTargetOptions(s);
    }
    // The overlay left the store without us: replaced by another one (the AI panel), or cleared from the map. The
    // toggle follows. A scenario change alone clears it too, but then the series changed and renderAll below draws
    // it again.
    if (mapActive && !pushing && s.allocation !== prev.allocation && s.allocation !== ownOverlay) {
      const replaced = s.allocation !== undefined;
      const cleared = s.allocation === undefined && s.series === prev.series;
      if (replaced || cleared) {
        mapActive = false;
        ownOverlay = undefined;
        paintMapToggle();
        paintFocus();
      }
    }
    if (selChanged || s.year !== prev.year || s.series !== prev.series) renderAll();
  });

  rebuildTargetOptions(store.get());
  renderAll();

  const teardown = (): void => {
    if (!alive) return;
    alive = false;
    if (mapActive) clearOverlay();
    unsubscribe();
    if (pending !== undefined) cancelAnimationFrame(pending);
    pending = undefined;
    if (mounted.get(el) === teardown) mounted.delete(el);
  };
  mounted.set(el, teardown);
  return teardown;
}
