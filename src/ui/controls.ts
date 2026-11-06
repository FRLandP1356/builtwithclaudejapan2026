// The assumptions panel: three knobs for the part of the calculation after 2050 (how easily children are born, how
// migration carries on, an infrastructure-linked acceleration of decline) and what they do to 2100.
//
// Everything before 2050 is the official IPSS projection and does not move. Every change is validated with
// sanitizeScenario (Ruling 21) before it reaches the store; a rejected value is shown as a short message and the
// store is left alone. The panel only reads the store in its subscriber and never writes from there, so a scenario
// set elsewhere (the AI panel) shows up here without any feedback loop.
import './controlsPanel.css';
import { isScenarioError, sanitizeScenario, SCENARIO_LIMITS, scenarioKey } from '../data/runner';
import { DEFAULT_SCENARIO, type Scenario } from '../engine/types';
import { birthBlock, infraBlock, marksIntro, migModeBlock, migrationBlock, type MarksBlock } from './barMarks';
import { deriveTotals, yearIndex, type Totals } from './derive';
import { formatPct, formatPop } from './format';
import { phraseNodes } from './phrases';
import { ESTIMATE_BADGE } from './sources';
import type { AppState, PanelContext } from './state';

// -----------------------------------------------------------------------------------------------------------------
// Pure part: controls <-> scenario, wording.
// -----------------------------------------------------------------------------------------------------------------

export type InfraChoice = 'none' | 'weak' | 'strong' | 'custom';

/** What the three groups of controls show. `infraStrength` is only meaningful (and kept) when `infra` is 'custom'. */
export interface ControlValues {
  cwrMult: number;
  migMode: Scenario['migMode'];
  migScale: number;
  infra: InfraChoice;
  infraStrength?: number;
}

/** The infrastructure-linked acceleration for each button. */
export const INFRA_STRENGTH = { none: 0, weak: 0.002, strong: 0.005 } as const;

export const DEFAULT_CONTROLS: ControlValues = { cwrMult: 1, migMode: 'hold', migScale: 1, infra: 'none' };

/** The scenario the controls stand for. 'custom' keeps the strength it carries (0 when it carries none). */
export function scenarioFromControls(v: ControlValues): Scenario {
  const infraStrength = v.infra === 'custom' ? (v.infraStrength ?? 0) : INFRA_STRENGTH[v.infra];
  return { cwrMult: v.cwrMult, migMode: v.migMode, migScale: v.migScale, infraStrength };
}

/** The controls that show scenario `s`. An infra strength that is none of the three buttons is shown as 'custom'. */
export function controlsFromScenario(s: Scenario): ControlValues {
  const base = { cwrMult: s.cwrMult, migMode: s.migMode, migScale: s.migScale };
  for (const k of ['none', 'weak', 'strong'] as const) {
    if (s.infraStrength === INFRA_STRENGTH[k]) return { ...base, infra: k };
  }
  return { ...base, infra: 'custom', infraStrength: s.infraStrength };
}

/** 1.2 -> "1.2", 0.85 -> "0.85", 1 -> "1" (at most `digits` decimals, no trailing zeros). */
function trim(v: number, digits = 2): string {
  return String(Number(v.toFixed(digits)));
}

/** A strength shown with the one decimal the slider steps in, or two decimals when the value is off the steps (set elsewhere). */
function scaleText(v: number): string {
  return Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? v.toFixed(1) : v.toFixed(2);
}

/** The status line: only what differs from the default, in plain words. */
export function describeScenario(s: Scenario): string {
  const parts: string[] = [];
  if (s.cwrMult !== DEFAULT_SCENARIO.cwrMult) parts.push(`子ども×${trim(s.cwrMult)}`);
  if (s.migMode !== DEFAULT_SCENARIO.migMode) parts.push('移動は止まる');
  if (s.migScale !== DEFAULT_SCENARIO.migScale) parts.push(`移動の強さ×${trim(s.migScale, 2)}`);
  if (s.infraStrength !== DEFAULT_SCENARIO.infraStrength) {
    if (s.infraStrength === INFRA_STRENGTH.weak) parts.push('インフラ連動 弱い');
    else if (s.infraStrength === INFRA_STRENGTH.strong) parts.push('インフラ連動 強い');
    else parts.push(`インフラ連動 ${trim(s.infraStrength, 4)}（独自の値）`);
  }
  return parts.length === 0 ? '初期値（2050年の前提を据え置き）' : `いまの前提：${parts.join('、')}`;
}

const REJECTED_FIELD: Record<string, string> = {
  cwrMult: `子どもの生まれやすさは${SCENARIO_LIMITS.cwrMult[0]}〜${SCENARIO_LIMITS.cwrMult[1]}の範囲で選んでください`,
  migScale: `移動の強さは${SCENARIO_LIMITS.migScale[0]}〜${SCENARIO_LIMITS.migScale[1]}の範囲で選んでください`,
  infraStrength: 'インフラ連動の強さが、使える範囲を外れています',
  migMode: '人口の移動の選び方が正しくありません',
};

/** Validate a scenario for the store (Ruling 21); a rejection becomes a short Japanese message. */
export function checkScenario(s: Scenario): { scenario: Scenario } | { message: string } {
  const checked = sanitizeScenario(s);
  if (!isScenarioError(checked)) return { scenario: checked };
  const field = checked.error.split(' ')[0];
  return { message: `${REJECTED_FIELD[field] ?? 'この値は使えません'}。前の値のままにしています。` };
}

/** "+765万人" / "−500人": a signed number of people, in 万人 from 1万. */
function signedPeople(diff: number): string {
  const sign = diff < 0 ? '−' : '+';
  const a = Math.abs(diff);
  const jp = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
  if (a >= 1e6) return `${sign}${jp.format(Math.round(a / 1e4))}万人`;
  if (a >= 1e4) return `${sign}${(a / 1e4).toFixed(1)}万人`;
  return `${sign}${jp.format(Math.round(a))}人`;
}

/** The note under an effect tile: the default value and how far the current one is from it. */
export function compareNote(current: number, baseline: number): string {
  const base = formatPop(baseline);
  const diff = current - baseline;
  if (!Number.isFinite(diff) || Math.abs(diff) < 0.5) return `初期値と同じ（${base}）`;
  const pct = baseline > 0 ? `（${formatPct(current / baseline)}）` : '';
  return `初期値（${base}）より ${signedPeople(diff)}${pct}`;
}

// -----------------------------------------------------------------------------------------------------------------
// The panel.
// -----------------------------------------------------------------------------------------------------------------

const EFFECT_YEAR = 2100;

const LIMITS = SCENARIO_LIMITS;

const TEMPLATE = `
  <p class="panel-lead">2050年までの数字は、社人研の公式推計のまま変わりません。ここで変えるのは、2050年より後の計算に使う前提です。</p>
  <div class="controls-groups">
    <div class="field" data-group="birth">
      <label class="field-label" for="ctl-cwr"><span>子どもの生まれやすさ</span><span class="field-value" id="ctl-cwr-value"></span></label>
      <input class="range" id="ctl-cwr" type="range" min="${LIMITS.cwrMult[0]}" max="${LIMITS.cwrMult[1]}" step="0.05" aria-describedby="ctl-cwr-marks ctl-cwr-help" />
      <p class="field-help" id="ctl-cwr-help">2050年の水準を1.0とした倍率です（子ども女性比）。</p>
    </div>
    <div class="field" data-group="migration">
      <span class="field-label" id="ctl-mig-title"><span>人口の移動</span></span>
      <div class="choice choice-stack" role="group" aria-labelledby="ctl-mig-title" aria-describedby="ctl-migmode-marks">
        <button type="button" data-mig="hold" aria-pressed="false">2050年ごろの傾向を続ける</button>
        <button type="button" data-mig="fade" aria-pressed="false">2100年に向けて少しずつ止まる</button>
      </div>
      <label class="field-label" for="ctl-migscale"><span>移動の強さ</span><span class="field-value" id="ctl-migscale-value"></span></label>
      <input class="range" id="ctl-migscale" type="range" min="${LIMITS.migScale[0]}" max="${LIMITS.migScale[1]}" step="0.1" aria-describedby="ctl-migscale-marks ctl-migscale-help" />
      <p class="field-help" id="ctl-migscale-help">1.0が2050年ごろの強さ、0なら人口の移動はなくなります。</p>
    </div>
    <div class="field" data-group="infra">
      <span class="field-label" id="ctl-infra-title">
        <span>インフラ連動の過疎の加速</span>
        <span class="field-tags"><span class="tag">仮定</span><span class="tag">公式の方法にはない要素</span></span>
      </span>
      <div class="choice choice-wide" role="group" aria-labelledby="ctl-infra-title" aria-describedby="ctl-infra-marks">
        <button type="button" data-infra="none" aria-pressed="false">なし</button>
        <button type="button" data-infra="weak" aria-pressed="false">弱い</button>
        <button type="button" data-infra="strong" aria-pressed="false">強い</button>
      </div>
      <p class="field-help" id="ctl-infra-custom" hidden></p>
      <div class="notice notice-estimate">町の人口が、病院や店などの人口の目安を下回ると、町を出る人が増える、という仮定を置いた計算です。どれだけ増えるかを測った根拠は手元にありません。幅を見るための仮定です。</div>
    </div>
  </div>
  <div class="actions controls-actions"><button type="button" class="btn" id="ctl-reset">初期値に戻す</button></div>
  <p class="note controls-status" id="ctl-status" role="status"></p>
  <p class="notice" id="ctl-error" role="alert" hidden></p>
  <div class="panel-section">
    <h3 class="panel-section-title">この前提での${EFFECT_YEAR}年 <span class="badge-estimate">${ESTIMATE_BADGE}</span></h3>
    <div class="kpi-row" id="ctl-tiles"></div>
  </div>`;

interface Tile {
  label: string;
  value: string;
  note: string;
}

function nextFrame(fn: () => void): { cancel(): void } {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(fn);
    return { cancel: () => cancelAnimationFrame(id) };
  }
  const id = setTimeout(fn, 16);
  return { cancel: () => clearTimeout(id) };
}

/**
 * The guidance block under a control: the estimate badge and a title, then position and national 2100 total as a
 * definition list, then (bars only) the one derived sentence. Plain text: no focus stop, nothing a script updates.
 */
function marksElement(b: MarksBlock): HTMLElement {
  const root = document.createElement('div');
  root.className = 'bar-marks';
  root.id = b.id;
  const title = document.createElement('p');
  title.className = 'note bar-marks-title';
  const badge = document.createElement('span');
  badge.className = 'badge-estimate';
  badge.textContent = ESTIMATE_BADGE;
  title.append(badge, ' ', ...phraseNodes(b.title));
  const list = document.createElement('dl');
  list.className = 'bar-marks-list';
  for (const row of b.rows) {
    const at = document.createElement('dt');
    at.textContent = row.at;
    const people = document.createElement('dd');
    people.textContent = row.people;
    list.append(at, people);
  }
  root.append(title, list);
  if (b.fact !== undefined) {
    const fact = document.createElement('p');
    fact.className = 'note bar-marks-fact';
    fact.append(...phraseNodes(b.fact));
    root.append(fact);
  }
  return root;
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
export function mountControls(el: HTMLElement, ctx: PanelContext): () => void {
  const { store, data, runner } = ctx;
  mounted.get(el)?.();

  // Keep the shell's heading, replace everything else (the placeholder).
  const title = el.querySelector('.panel-title');
  el.replaceChildren(...(title ? [title] : []));
  if (title) {
    resetHeadingBadge(title);
    const badge = document.createElement('span');
    badge.className = 'badge-estimate';
    badge.textContent = ESTIMATE_BADGE;
    title.append(' ', badge);
  }
  el.insertAdjacentHTML('beforeend', TEMPLATE); // static text only: nothing from data is interpolated

  // The guidance marks (barMarks.ts): fixed text, one block under each control; they describe the control, not its value.
  const intro = document.createElement('p');
  intro.className = 'note bar-marks-intro';
  intro.append(...phraseNodes(marksIntro()));
  el.querySelector('.controls-groups')!.before(intro);
  el.querySelector('#ctl-cwr')!.after(marksElement(birthBlock(DEFAULT_SCENARIO.cwrMult)));
  el.querySelector('[data-group="migration"] .choice')!.after(marksElement(migModeBlock()));
  el.querySelector('#ctl-migscale')!.after(marksElement(migrationBlock(DEFAULT_SCENARIO.migScale)));
  el.querySelector('[data-group="infra"] .notice')!.before(marksElement(infraBlock()));

  const q = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
  const cwr = q<HTMLInputElement>('#ctl-cwr');
  const cwrValue = q<HTMLElement>('#ctl-cwr-value');
  const migScale = q<HTMLInputElement>('#ctl-migscale');
  const migScaleValue = q<HTMLElement>('#ctl-migscale-value');
  const migButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-mig]')];
  const infraButtons = [...el.querySelectorAll<HTMLButtonElement>('[data-infra]')];
  const infraCustom = q<HTMLElement>('#ctl-infra-custom');
  const resetBtn = q<HTMLButtonElement>('#ctl-reset');
  const statusEl = q<HTMLElement>('#ctl-status');
  const errorEl = q<HTMLElement>('#ctl-error');
  const tilesEl = q<HTMLElement>('#ctl-tiles');

  const areaByCode = new Map(data.areas.map((a) => [a.code, a]));

  /** What the controls show right now. Follows the store, except while the user's change is waiting for its frame. */
  let view: ControlValues = controlsFromScenario(store.get().scenario);
  let pending: { cancel(): void } | undefined;
  let alive = true;

  // The default's 2100 numbers, computed on first use and kept (the runner's own cache holds only a few scenarios).
  let baseline: Totals | undefined;
  const baselineTotals = (): Totals => (baseline ??= deriveTotals(runner.run(DEFAULT_SCENARIO), data.groups));

  function paintControls(): void {
    if (Number(cwr.value) !== view.cwrMult) cwr.value = String(view.cwrMult);
    cwrValue.textContent = `×${view.cwrMult.toFixed(2)}`;
    cwr.setAttribute('aria-valuetext', `2050年の水準の${view.cwrMult.toFixed(2)}倍`);
    if (Number(migScale.value) !== view.migScale) migScale.value = String(view.migScale);
    migScaleValue.textContent = `×${scaleText(view.migScale)}`;
    migScale.setAttribute('aria-valuetext', `標準の${scaleText(view.migScale)}倍`);
    for (const b of migButtons) b.setAttribute('aria-pressed', String(b.dataset.mig === view.migMode));
    for (const b of infraButtons) b.setAttribute('aria-pressed', String(b.dataset.infra === view.infra));
    if (view.infra === 'custom') {
      infraCustom.hidden = false;
      infraCustom.textContent = `いまは独自の値（${trim(view.infraStrength ?? 0, 4)}）を使っています。ボタンを押すと、その強さに置き換わります。`;
    } else {
      infraCustom.hidden = true;
      infraCustom.textContent = '';
    }
  }

  function tiles(s: AppState): Tile[] {
    const now = deriveTotals(s.series, data.groups);
    const base = baselineTotals();
    const i = yearIndex(now.years, EFFECT_YEAR);
    const j = yearIndex(base.years, EFFECT_YEAR);
    if (i < 0 || j < 0) return [];
    const out: Tile[] = [
      { label: `${EFFECT_YEAR}年の日本全体の人口`, value: formatPop(now.japan[i]), note: compareNote(now.japan[i], base.japan[j]) },
    ];
    let place: { label: string; now?: Float64Array; base?: Float64Array } | undefined;
    if (s.selectedArea !== undefined) {
      const a = areaByCode.get(s.selectedArea);
      place = { label: a ? `${a.prefName} ${a.name}` : s.selectedArea, now: now.area.get(s.selectedArea), base: base.area.get(s.selectedArea) };
    } else if (s.selectedPref !== undefined) {
      place = { label: data.prefNames.get(s.selectedPref) ?? s.selectedPref, now: now.pref.get(s.selectedPref), base: base.pref.get(s.selectedPref) };
    }
    if (place?.now && place.base) {
      out.push({
        label: `${place.label}の${EFFECT_YEAR}年の人口`,
        value: formatPop(place.now[i]),
        note: compareNote(place.now[i], place.base[j]),
      });
    }
    return out;
  }

  function paintTiles(s: AppState): void {
    tilesEl.replaceChildren(
      ...tiles(s).map((t) => {
        const kpi = document.createElement('div');
        kpi.className = 'kpi';
        for (const [cls, text] of [
          ['kpi-label', t.label],
          ['kpi-value', t.value],
          ['kpi-note', t.note],
        ] as const) {
          const d = document.createElement('div');
          d.className = cls;
          d.textContent = text;
          kpi.append(d);
        }
        return kpi;
      }),
    );
  }

  function paintCommitted(s: AppState): void {
    setText(statusEl, describeScenario(s.scenario));
    paintTiles(s);
  }

  function showError(message: string | undefined): void {
    if (errorEl.hidden !== (message === undefined)) errorEl.hidden = message === undefined;
    setText(errorEl, message ?? '');
  }

  /** Send the controls' scenario to the store. A rejected value is explained and the display goes back to the store. */
  function commit(): void {
    pending?.cancel();
    pending = undefined;
    const checked = checkScenario(scenarioFromControls(view));
    if ('message' in checked) {
      showError(checked.message);
      view = controlsFromScenario(store.get().scenario);
      paintControls();
      return;
    }
    showError(undefined);
    const applied = store.set({ scenario: checked.scenario });
    if (!applied && scenarioKey(checked.scenario) !== scenarioKey(store.get().scenario)) {
      showError('この前提を反映できませんでした。前の値のままにしています。');
      view = controlsFromScenario(store.get().scenario);
      paintControls();
    }
  }

  /** Slider input: show the new value at once, send it to the store once per animation frame. Only the moved knob changes. */
  function onSlider(change: Partial<ControlValues>): void {
    if (!alive) return;
    view = { ...view, ...change };
    paintControls();
    pending ??= nextFrame(commit);
  }
  cwr.addEventListener('input', () => onSlider({ cwrMult: Math.round(Number(cwr.value) * 100) / 100 }));
  migScale.addEventListener('input', () => onSlider({ migScale: Math.round(Number(migScale.value) * 10) / 10 }));

  for (const b of migButtons) {
    b.addEventListener('click', () => {
      if (!alive) return;
      view = { ...view, migMode: b.dataset.mig as Scenario['migMode'] };
      paintControls();
      commit();
    });
  }
  for (const b of infraButtons) {
    b.addEventListener('click', () => {
      if (!alive) return;
      view = { cwrMult: view.cwrMult, migMode: view.migMode, migScale: view.migScale, infra: b.dataset.infra as InfraChoice };
      paintControls();
      commit();
    });
  }
  resetBtn.addEventListener('click', () => {
    if (!alive) return;
    pending?.cancel();
    pending = undefined;
    showError(undefined);
    view = { ...DEFAULT_CONTROLS };
    store.set({ scenario: DEFAULT_SCENARIO });
    view = controlsFromScenario(store.get().scenario);
    paintControls();
    paintCommitted(store.get());
  });

  // The store drives the display; this subscriber never writes to the store.
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.scenario !== prev.scenario) {
      if (!pending) view = controlsFromScenario(s.scenario);
      showError(undefined);
    }
    paintControls();
    paintCommitted(s);
  });

  paintControls();
  paintCommitted(store.get());

  const teardown = (): void => {
    if (!alive) return;
    alive = false;
    unsubscribe();
    pending?.cancel();
    pending = undefined;
    if (mounted.get(el) === teardown) mounted.delete(el);
  };
  mounted.set(el, teardown);
  return teardown;
}
