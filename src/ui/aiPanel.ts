// The "AIに質問" panel: sample questions, a free input, the conversation, and for every answer what it was built from.
//
// The logic (talking to the Worker, running the tools, checking the numbers) lives in src/ai/client.ts and is reused as
// it is. This file is the screen: it builds the DOM, keeps the conversation, and turns an AskResult into text.
//
// SAFETY: everything that comes from the model, from the visitor or from a saved answer is put on the page with
// textContent / text nodes only. No string is ever parsed as markup in this file (a test reads the source to check).
//
// TEARDOWN: the shell's mountPanels ignores what a panel returns and has no teardown hook, so nothing calls the
// function mountAIPanel returns today. It is there for the day the shell keeps it: it aborts a pending ask and removes
// the interface. Without it, an ask that is still running when the shell is destroyed finishes harmlessly into a
// detached element (one Worker request, no listeners, nothing global). Mounting a second time into the same slot tears
// the first mount down, so the interface is never doubled.
import './aiPanel.css';
import { ask, MSG_NOT_AVAILABLE } from '../ai/client';
import type { AskResult, Message, TraceItem } from '../ai/client';
import { findCached, loadCachedAnswers, SAMPLE_QUESTIONS, verifiedSampleQuestions } from '../ai/cached';
import type { CachedAnswers } from '../ai/cached';
import type { EngineContext } from '../ai/tools';
import { isScenarioError, sanitizeScenario, scenarioKey } from '../data/runner';
import {
  allocationOffers,
  clipAtCaret,
  compactJson,
  countCodePoints,
  describeScenario,
  makePlaceNames,
  mapTargets,
  prettyJsonView,
  scenarioOffers,
  toolLabel,
  namesLaterYear,
  traceUsesEstimate,
} from './aiTrace';
import { overlayFromToolInput, toolScenario } from './allocationOverlay';
import { ESTIMATE_BADGE, ESTIMATE_NOTE } from './sources';
import type { PanelContext } from './state';
import type { Scenario } from '../engine/types';

// ---------------------------------------------------------------------------------------------------------------
// Options, constants and wording
// ---------------------------------------------------------------------------------------------------------------

export interface AIPanelOptions {
  /** Where the Worker listens. Default: the build-time variable VITE_CHAT_ENDPOINT, else '/api/chat'. */
  endpoint?: string;
  /** Replaces fetch for the questions (tests). */
  fetchFn?: typeof fetch;
  /** Saved answers: already loaded, a promise of them, or null for none. Default: loaded from the site at mount. */
  cache?: CachedAnswers | null | Promise<CachedAnswers | null>;
}

export const MAX_QUESTION_LENGTH = 200;
/** The most answers kept on the page; the oldest drops off. */
export const MAX_ANSWERS = 20;
/**
 * How long a question waits for the saved answers to load before it goes to the Worker without them. The wait only
 * exists so that a sample question can be answered from a saved answer the moment the file arrives; a file that is
 * slow or never comes must not hold a question back.
 */
export const CACHE_WAIT_MS = 1500;

/** Everything the panel says that is not an answer, in one place (a test scans it for words that must never appear). */
export const PANEL_TEXT = {
  // What the app really does (src/ai/numberCheck.ts): the tools do the arithmetic; once an answer is in, its numbers are
  // checked against this question's tool results, and the ones that cannot be found are flagged. It does not claim that
  // every number comes from the results, and it quotes no label that is not on the screen. Kept to about three lines on a phone.
  intro:
    '日本語で質問すると、Claudeがこのアプリの計算を呼び出して答えます。答えの数字は、その質問で使った計算の結果と照らし合わせ、見つからない数字は知らせます。',
  // The intro when the build names no AI address (VITE_CHAT_ENDPOINT unset, no endpoint option): nothing would answer, so
  // the panel says so before it shows a box and sample questions. It is the card's own sentence (MSG_NOT_AVAILABLE), word
  // for word, so the two cannot drift; the promise and the number check describe a working AI and are left out.
  introUnavailable: MSG_NOT_AVAILABLE,
  after2050: '2050年までの数字は社人研の公式推計、2050年より後の数字は、このアプリの試算です（予測ではありません）。',
  waiting: '計算の結果を引いています…',
  blank: '質問を入力してください。',
  tooLong: `質問は${MAX_QUESTION_LENGTH}文字までにしてください。`,
  limitCut: `${MAX_QUESTION_LENGTH}文字までです。超えた分は入力されません。`,
  crashed: 'うまく処理できませんでした。もう一度お試しください。',
  copied: 'コピーしました',
  copyFailed: 'コピーできませんでした。文字を選んでコピーしてください。',
  scenarioApplied: '画面に反映しました。2050年より後の試算は、この前提で計算されます。',
  scenarioAlready: 'この前提は、すでに画面に反映されています。',
  scenarioRefused: 'この前提は範囲外の値を含むため、画面には反映できません。',
  scenarioFailed: 'この前提を画面に反映できませんでした。',
  trimmed: '古いやり取りは省略しました',
  trySaved: '保存済みの質問を試せます。',
  allocationButton: 'この割り振りを地図に反映する',
  allocationApplied: '地図に反映しました。地図の色は、割り振りによる人口の変化を示します。',
  allocationFailed: 'この割り振りを地図に反映できませんでした。',
  allocationScenario: 'この割り振りの前提も画面に反映しました',
  allocationScenarioHint: '（前提も画面に合わせます）',
} as const;

const DEFAULT_ENDPOINT = '/api/chat';

/** The address named at build time with VITE_CHAT_ENDPOINT (see docs/ai-endpoint.md), or undefined when the build names none. */
function buildEndpoint(): string | undefined {
  const value: unknown = import.meta.env.VITE_CHAT_ENDPOINT;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The Worker's address: the build's, else same-origin '/api/chat'. */
function configuredEndpoint(): string {
  return buildEndpoint() ?? DEFAULT_ENDPOINT;
}

// ---------------------------------------------------------------------------------------------------------------
// Tiny DOM helper: attributes and children are set with setAttribute / append, never parsed as HTML
// ---------------------------------------------------------------------------------------------------------------

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child) el.append(child);
  return el;
}

const registry = new WeakMap<HTMLElement, () => void>();
let mountCount = 0;

// ---------------------------------------------------------------------------------------------------------------
// mountAIPanel
// ---------------------------------------------------------------------------------------------------------------

/**
 * Fills `el` (the shell's `<section class="panel" id="panel-ai">`, which already holds the h2) with the AI panel.
 * Returns the teardown function (see the header comment).
 */
export function mountAIPanel(el: HTMLElement, ctx: PanelContext, options: AIPanelOptions = {}): () => void {
  registry.get(el)?.(); // a second mount into the same slot replaces the first

  const uid = ++mountCount;
  const engine: EngineContext = {
    areas: ctx.data.areas,
    facilities: ctx.data.facilities,
    groups: ctx.data.groups, // the full list: village results depend on it (Ruling 20)
    run: (s) => ctx.runner.run(s),
  };
  const places = makePlaceNames(ctx.data.areas, ctx.data.prefNames);
  const endpoint = options.endpoint ?? configuredEndpoint();
  // An address was named (by the build or by the caller): the intro describes a working AI. Without one the same-origin
  // default is only a guess, and in this version nothing is there, so the intro says so first.
  const endpointNamed = options.endpoint !== undefined || buildEndpoint() !== undefined;

  // Saved answers: loaded once, in the background. A question asked before they arrive waits for them, but only
  // for CACHE_WAIT_MS and never without showing the waiting status and the stop button (see waitForCache).
  let cache: CachedAnswers | null = null;
  let cacheReady = false;
  let cacheGaveUp = false; // a question has already stopped waiting: later ones do not wait again
  const cachePromise: Promise<CachedAnswers | null> = Promise.resolve(options.cache === undefined ? loadCachedAnswers() : options.cache)
    .catch(() => null)
    .then((loaded) => {
      cache = loaded;
      cacheReady = true;
      return loaded;
    });

  // ---- state ------------------------------------------------------------------------------------------------
  let history: Message[] = [];
  let running = false;
  let destroyed = false;
  let controller: AbortController | null = null;

  // ---- structure --------------------------------------------------------------------------------------------
  const inputId = `ai-input-${uid}`;
  const helpId = `ai-help-${uid}`;
  const msgId = `ai-msg-${uid}`;

  const samplesList = h('ul', { class: 'ai-samples' });
  const textarea = h('textarea', {
    class: 'input ai-input',
    id: inputId,
    rows: '3',
    // maxlength counts UTF-16 units, so it is only a backstop (400 units hold 200 code points); the exact limit is enforced below
    maxlength: String(MAX_QUESTION_LENGTH * 2),
    'aria-describedby': `${helpId} ${msgId}`,
    autocomplete: 'off',
  });
  const counter = h('span', { class: 'ai-counter num' }, `0 / ${MAX_QUESTION_LENGTH}`);
  const inputMsg = h('p', { class: 'ai-input-msg', id: msgId, 'aria-live': 'polite' });
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, '質問する');
  const newBtn = h('button', { type: 'button', class: 'btn ai-new', hidden: true }, '新しい質問を始める');
  const statusText = h('p', { class: 'ai-status-text', role: 'status', 'aria-live': 'polite', tabindex: '-1' });
  const cancelBtn = h('button', { type: 'button', class: 'btn btn-quiet ai-cancel', hidden: true }, 'やめる');
  const answersEl = h('div', { class: 'ai-answers', 'aria-live': 'polite', 'aria-relevant': 'additions' });

  const form = h(
    'form',
    { class: 'ai-form', novalidate: true },
    h(
      'div',
      { class: 'field' },
      h('label', { class: 'field-label', for: inputId }, '質問を入力'),
      textarea,
      h(
        'p',
        { class: 'field-help ai-help', id: helpId },
        h('span', {}, `${MAX_QUESTION_LENGTH}文字まで。Ctrl か Cmd を押しながら Enter でも送れます。`),
        counter,
      ),
      inputMsg,
    ),
    h('div', { class: 'actions' }, submitBtn, newBtn),
  );

  const statusBox = h('div', { class: 'ai-status' }, statusText, cancelBtn);

  const lead = h('p', { class: 'panel-lead' }, endpointNamed ? PANEL_TEXT.intro : PANEL_TEXT.introUnavailable);

  const root = h(
    'div',
    { class: 'ai-panel' },
    lead,
    h('p', { class: 'note' }, PANEL_TEXT.after2050),
    h('div', { class: 'panel-section' }, h('h3', { class: 'panel-section-title' }, '質問の例'), samplesList),
    h('div', { class: 'panel-section' }, h('h3', { class: 'panel-section-title' }, '自分で質問する'), form),
    statusBox,
    answersEl,
  );
  el.append(root);

  // ---- small helpers ----------------------------------------------------------------------------------------

  /** A button that asks one of the sample questions. */
  function sampleButton(question: string): HTMLLIElement {
    const button = h('button', { type: 'button', class: 'btn ai-sample', 'data-ask': 'sample' }, question);
    button.addEventListener('click', () => void send(question, 'sample', button));
    return h('li', {}, button);
  }
  for (const question of SAMPLE_QUESTIONS) samplesList.append(sampleButton(question));

  function updateCounter(): void {
    const n = countCodePoints(textarea.value);
    counter.textContent = `${n} / ${MAX_QUESTION_LENGTH}`;
    counter.classList.toggle('is-over', n > MAX_QUESTION_LENGTH);
  }

  /** `invalid` is false for a notice (the text was fixed for the visitor) as opposed to an error to correct. */
  function showInputMessage(message: string, invalid = true): void {
    inputMsg.textContent = message;
    if (message && invalid) textarea.setAttribute('aria-invalid', 'true');
    else textarea.removeAttribute('aria-invalid');
  }

  function updateNewButton(): void {
    newBtn.hidden = history.length === 0 && answersEl.childElementCount === 0;
  }

  /** One thing at a time: while a question runs the controls are off and the stop button is on. */
  function setBusy(busy: boolean): void {
    // A button that is about to be disabled must not hold the focus: put it on the status line (not on やめる, which
    // a repeated key press would then activate; やめる stays one Tab away).
    const active = document.activeElement;
    if (busy && active instanceof HTMLButtonElement && root.contains(active) && active !== cancelBtn) statusText.focus();
    running = busy;
    textarea.readOnly = busy;
    if (busy) textarea.setAttribute('aria-busy', 'true');
    else textarea.removeAttribute('aria-busy');
    submitBtn.disabled = busy;
    newBtn.disabled = busy;
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-ask]')) button.disabled = busy;
  }

  /** Put keyboard focus back where the visitor was, unless it is somewhere useful already. */
  function restoreFocus(origin: HTMLElement | null): void {
    const active = document.activeElement;
    const lost =
      !active || active === document.body || active === cancelBtn || active === statusText || (root.contains(active) && (active as HTMLButtonElement).disabled === true);
    if (!lost) return;
    // preventScroll: bringing the answer into view (below) is what moves the page, not the focus going back up to the button.
    (origin && origin.isConnected ? origin : textarea).focus({ preventScroll: true });
  }

  /** The control that started the question being asked (the sample button, the submit button or the text field). */
  let asker: HTMLElement | null = null;

  /** Whether any part of the element is inside the window (an element with no box, as in a test DOM, counts as on screen). */
  function isOnScreen(el: Element): boolean {
    const box = el.getBoundingClientRect();
    return box.bottom >= 0 && box.top <= window.innerHeight;
  }

  /**
   * On a phone the answer area is hundreds of pixels below the sample question or the form, so the first tap would
   * look like nothing happened. Scroll just enough to show `target` ('nearest': nothing moves if it is in view), and
   * not smoothly for a visitor who asked for less motion. Focus is not touched.
   */
  function bringIntoView(target: Element): void {
    if (typeof target.scrollIntoView !== 'function') return;
    // Only while the visitor is still where they asked: the control they pressed, the waiting line or the target itself
    // is on screen. One who scrolled away while waiting (to look at the map, say) is not pulled back.
    const anchors = [asker, statusBox, target];
    if (!anchors.some((el) => el !== null && isOnScreen(el))) return;
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' });
  }

  /** The map is above the panels on a phone: bring it into view after a link has moved it. */
  function revealMap(): void {
    const map = document.querySelector('.map-column');
    if (!map || typeof map.scrollIntoView !== 'function') return;
    if (map.getBoundingClientRect().top < 0) map.scrollIntoView({ block: 'start' });
  }

  // ---- rendering an answer ----------------------------------------------------------------------------------

  function renderTrace(trace: TraceItem[]): HTMLElement {
    const list = h('ol', { class: 'ai-trace-list' });
    for (const item of trace) {
      const view = prettyJsonView(item.result);
      const copyStatus = h('span', { class: 'ai-copy-status', role: 'status' });
      const copy = h('button', { type: 'button', class: 'btn btn-quiet' }, 'コピー');
      copy.addEventListener('click', () => {
        const clipboard: Clipboard | undefined = navigator.clipboard;
        if (!clipboard || typeof clipboard.writeText !== 'function') {
          copyStatus.textContent = PANEL_TEXT.copyFailed;
          return;
        }
        clipboard.writeText(view.full).then(
          () => {
            copyStatus.textContent = PANEL_TEXT.copied;
          },
          () => {
            copyStatus.textContent = PANEL_TEXT.copyFailed;
          },
        );
      });
      list.append(
        h(
          'li',
          { class: 'ai-trace-item' },
          h('p', { class: 'ai-trace-name' }, toolLabel(item.tool)),
          h('p', { class: 'note ai-trace-label' }, '入力'),
          h('p', { class: 'ai-trace-input' }, compactJson(item.input)),
          h(
            'details',
            { class: 'ai-trace-result' },
            h('summary', {}, '結果を見る'),
            h('pre', { class: 'ai-json', tabindex: '0', role: 'region', 'aria-label': `${toolLabel(item.tool)}の結果` }, view.text),
            h('div', { class: 'actions' }, copy, copyStatus),
          ),
        ),
      );
    }
    return h('details', { class: 'ai-trace' }, h('summary', {}, `使った道具と数字（${trace.length}件）`), list);
  }

  function renderMapLinks(trace: TraceItem[]): HTMLElement | null {
    const targets = mapTargets(trace, places);
    if (targets.length === 0) return null;
    const box = h('div', { class: 'actions ai-links' });
    for (const target of targets) {
      const button = h('button', { type: 'button', class: 'btn' }, `${target.label}を地図で開く`);
      button.addEventListener('click', () => {
        const done = ctx.store.set(target.kind === 'area' ? { selectedArea: target.code } : { selectedPref: target.code });
        if (done) revealMap();
      });
      box.append(button);
    }
    return box;
  }

  /** One assumption from an answer, with a button that applies it. `labelled`: several are offered, so the button says which. */
  function renderScenarioOffer(offer: Scenario, labelled: boolean): HTMLElement {
    const message = h('p', { class: 'ai-scenario-msg', role: 'status', 'aria-live': 'polite' });
    const summary = describeScenario(offer);
    const button = h(
      'button',
      { type: 'button', class: 'btn', 'data-role': 'apply-scenario' },
      labelled ? `この前提を画面に反映する（${summary}）` : 'この前提を画面に反映する',
    );
    button.addEventListener('click', () => {
      const checked = sanitizeScenario(offer);
      if (isScenarioError(checked)) {
        message.textContent = PANEL_TEXT.scenarioRefused; // Ruling 21: nothing out of range reaches the engine
        return;
      }
      if (scenarioKey(ctx.store.get().scenario) === scenarioKey(checked)) {
        message.textContent = PANEL_TEXT.scenarioAlready;
        return;
      }
      message.textContent = ctx.store.set({ scenario: checked }) ? PANEL_TEXT.scenarioApplied : PANEL_TEXT.scenarioFailed;
    });
    return h('div', { class: 'ai-scenario' }, labelled ? null : h('p', { class: 'note' }, `この答えの前提：${summary}`), button, message);
  }

  function renderScenarioOffers(trace: TraceItem[]): HTMLElement | null {
    const offers = scenarioOffers(trace);
    if (offers.length === 0) return null;
    return h('div', { class: 'ai-scenarios' }, ...offers.map((offer) => renderScenarioOffer(offer, offers.length > 1)));
  }

  /**
   * What an allocation button needs to repaint its hint when the screen's assumptions change: its text without the
   * hint, and the assumptions it would bring. Kept per button in a WeakMap and found again through the page, so a
   * button whose answer was trimmed, cleared or replaced is let go with it: there is no list to prune.
   */
  const allocationOffer = new WeakMap<HTMLButtonElement, { text: string; scenario: Scenario | undefined }>();
  function paintAllocationButtons(): void {
    const current = scenarioKey(ctx.store.get().scenario);
    for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-role="apply-allocation"]')) {
      const offer = allocationOffer.get(button);
      if (!offer) continue;
      const differs = offer.scenario !== undefined && scenarioKey(offer.scenario) !== current;
      const text = differs ? `${offer.text}${PANEL_TEXT.allocationScenarioHint}` : offer.text;
      if (button.textContent !== text) button.textContent = text;
    }
  }
  const unsubscribeScenario = ctx.store.subscribe((s, prev) => {
    if (s.scenario !== prev.scenario) paintAllocationButtons();
  });

  /**
   * For each run_allocation call that returned a result (allocationOffers): a button that recomputes that allocation
   * locally from the tool INPUT (never from the model's text or the tool result) and draws it on the map, moving the
   * year slider to the allocation's year. A bad input is refused with a message (text only).
   */
  function renderAllocationOffers(trace: TraceItem[]): HTMLElement | null {
    const inputs = allocationOffers(trace);
    if (inputs.length === 0) return null;
    const box = h('div', { class: 'ai-allocations' });
    inputs.forEach((input, i) => {
      const message = h('p', { class: 'ai-scenario-msg', role: 'status', 'aria-live': 'polite' });
      const text = inputs.length > 1 ? `${PANEL_TEXT.allocationButton}（${i + 1}件目）` : PANEL_TEXT.allocationButton;
      const read = typeof input === 'object' && input !== null && !Array.isArray(input) ? toolScenario((input as Record<string, unknown>).scenario) : 'unreadable';
      const scenario = typeof read === 'string' ? undefined : read;
      const differs = scenario !== undefined && scenarioKey(scenario) !== scenarioKey(ctx.store.get().scenario);
      const button = h('button', { type: 'button', class: 'btn', 'data-role': 'apply-allocation' }, differs ? `${text}${PANEL_TEXT.allocationScenarioHint}` : text);
      allocationOffer.set(button, { text, scenario });
      button.addEventListener('click', () => {
        const rebuilt = overlayFromToolInput(input, ctx.data, ctx.runner);
        if ('error' in rebuilt) {
          message.textContent = rebuilt.error;
          return;
        }
        const { overlay, scenario } = rebuilt;
        // The towns that cross a guide depend on the assumptions: the screen takes the allocation's own, in the
        // same patch (a scenario change alone would clear the overlay), and the message says so.
        const withScenario = scenarioKey(ctx.store.get().scenario) !== scenarioKey(scenario);
        const done = ctx.store.set(withScenario ? { scenario, year: overlay.year, allocation: overlay } : { year: overlay.year, allocation: overlay });
        message.textContent = !done
          ? PANEL_TEXT.allocationFailed
          : withScenario
            ? `${PANEL_TEXT.allocationApplied}${PANEL_TEXT.allocationScenario}（${describeScenario(scenario)}）。`
            : PANEL_TEXT.allocationApplied;
        if (done) revealMap();
      });
      box.append(h('div', { class: 'ai-scenario' }, button, message));
    });
    return box;
  }

  /**
   * Buttons for the sample questions that have a verified saved answer, under a failure notice. While every saved
   * answer is still a placeholder there is nothing to offer, so there is nothing here and nothing says there is.
   */
  function renderFailureSamples(): HTMLElement | null {
    const questions = verifiedSampleQuestions(cache);
    if (questions.length === 0) return null;
    const list = h('ul', { class: 'ai-samples' });
    for (const question of questions) list.append(sampleButton(question));
    return h('div', { class: 'ai-fail-samples' }, h('p', { class: 'note' }, PANEL_TEXT.trySaved), list);
  }

  function renderAnswer(question: string, result: AskResult): HTMLElement {
    const failed = result.status === 'unavailable' || result.status === 'error';
    // No Worker behind the endpoint: one plain sentence instead of a "try again" that cannot work (kept to one on the page by showResult).
    const notAvailable = failed && result.reason === 'not_configured';
    const article = h(
      'article',
      { class: 'ai-answer', 'data-role': notAvailable ? 'ai-unavailable' : undefined },
      h('p', { class: 'ai-question' }, h('span', { class: 'sr-only' }, '質問：'), question),
    );

    if (failed) {
      article.append(h('p', { class: 'ai-fail' }, notAvailable ? (result.message ?? MSG_NOT_AVAILABLE) : (result.message ?? PANEL_TEXT.crashed)));
      // A trace of 2051+ figures is shown behind 「使った道具と数字」: say that they are estimates, outside the raw JSON.
      if (traceUsesEstimate(result.trace)) article.append(h('p', { class: 'note ai-estimate' }, `${ESTIMATE_NOTE}。`));
      if (result.trace.length > 0) article.append(renderTrace(result.trace));
      const saved = renderFailureSamples();
      if (saved) article.append(saved);
      return article;
    }

    // 2051+ figures are always 試算: from the tool results, and from the answer's own words (it may name a year no tool result does)
    const usesEstimate = traceUsesEstimate(result.trace) || namesLaterYear(result.answer);
    const head = h('div', { class: 'ai-answer-head' });
    if (result.fromCache) head.append(h('span', { class: 'tag', 'data-role': 'saved-badge' }, '保存済みの回答'));
    if (usesEstimate) head.append(h('span', { class: 'badge-estimate' }, ESTIMATE_BADGE));
    if (head.childElementCount > 0) article.append(head);

    article.append(h('p', { class: 'ai-answer-text' }, result.answer));

    if (result.status === 'unverified_numbers') {
      article.append(
        h(
          'div',
          { class: 'notice ai-warning', role: 'note' },
          h('p', { class: 'ai-warning-lead' }, `次の数字は、計算の結果で確かめられませんでした：${result.unverified.join('、')}`),
          result.message ? h('p', {}, result.message) : null,
          h('p', {}, result.trace.length > 0 ? '下の「使った道具と数字」を開いて、計算の結果と見比べてください。' : 'この答えには、引いた計算の結果がありません。'),
        ),
      );
    }

    // An answer whose numbers could not be confirmed has no basis line, but the label for 2051+ figures stays.
    if (result.status === 'unverified_numbers' && usesEstimate) article.append(h('p', { class: 'note ai-estimate' }, `${ESTIMATE_NOTE}。`));

    // What the numbers rest on, said only for an answer whose numbers passed the check (status ok). For one that did
    // not, the warning above says what could not be confirmed, and a line here would contradict it. The line says
    // that the numbers are checked against the results, never that they are only taken from them.
    if (result.status === 'ok') {
      const basis: string[] = [];
      if (result.fromCache) {
        basis.push(result.trace.length > 0 ? 'あらかじめ保存した回答です。そのとき使った計算の結果は、下の「使った道具と数字」で見られます。' : 'あらかじめ保存した回答です。');
      } else {
        basis.push(result.trace.length > 0 ? '答えの数字は、下の「使った道具と数字」にある計算の結果と照らし合わせています。' : 'この答えでは、計算の結果は使っていません。');
      }
      if (usesEstimate) basis.push(`${ESTIMATE_NOTE}。`);
      article.append(h('p', { class: 'note ai-basis' }, basis.join('')));
    }

    if (result.status === 'ok' && result.message) article.append(h('p', { class: 'note ai-message' }, result.message));
    if (result.trimmed) article.append(h('p', { class: 'note ai-trimmed' }, PANEL_TEXT.trimmed));

    if (result.trace.length > 0) {
      article.append(renderTrace(result.trace));
      const links = renderMapLinks(result.trace);
      if (links) article.append(links);
      const scenarios = renderScenarioOffers(result.trace);
      if (scenarios) article.append(scenarios);
      const allocations = renderAllocationOffers(result.trace);
      if (allocations) article.append(allocations);
    }
    return article;
  }

  /** Shows a finished ask at the top of the list. The older failure notices lose their sample buttons (the newest keeps its own). */
  function showResult(question: string, result: AskResult): HTMLElement {
    const article = renderAnswer(question, result); // drawn first: if it throws, the page is left as it was
    for (const old of answersEl.querySelectorAll('.ai-fail-samples')) old.remove();
    // The "not available" sentence is on the page once: the newest one replaces the one before it.
    if (article.dataset.role === 'ai-unavailable') for (const old of answersEl.querySelectorAll('[data-role="ai-unavailable"]')) old.remove();
    answersEl.prepend(article);
    // Bounded growth: the oldest answers leave the page, and their buttons and closures with them.
    while (answersEl.childElementCount > MAX_ANSWERS) answersEl.lastElementChild?.remove();
    return article;
  }

  const errorResult = (): AskResult => ({ answer: '', trace: [], unverified: [], fromCache: false, status: 'error', message: PANEL_TEXT.crashed, messages: history });

  /** Waits for the saved answers, but no longer than CACHE_WAIT_MS, and not past a stop: null means "ask without them". */
  function waitForCache(signal: AbortSignal): Promise<CachedAnswers | null> {
    if (cacheGaveUp) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        done();
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        done();
        cacheGaveUp = true;
        resolve(null);
      }, CACHE_WAIT_MS);
      signal.addEventListener('abort', onAbort, { once: true });
      void cachePromise.then((loaded) => {
        done();
        resolve(loaded);
      });
    });
  }

  function showWaiting(): void {
    statusText.textContent = PANEL_TEXT.waiting;
    cancelBtn.hidden = false;
    bringIntoView(statusBox); // the waiting line and the stop button, which sit just above the answers
  }

  // ---- asking -----------------------------------------------------------------------------------------------

  async function send(raw: string, from: 'typed' | 'sample', trigger: HTMLElement): Promise<void> {
    if (running || destroyed) return;
    const question = raw.trim();
    if (from === 'typed') {
      if (question === '') return showInputMessage(PANEL_TEXT.blank);
      if (countCodePoints(raw) > MAX_QUESTION_LENGTH) return showInputMessage(PANEL_TEXT.tooLong);
      showInputMessage('');
    }

    setBusy(true);
    asker = trigger;
    const abort = new AbortController();
    controller = abort;
    let result: AskResult | undefined;
    try {
      let saved: CachedAnswers | null;
      if (cacheReady) {
        saved = cache;
      } else {
        showWaiting(); // before anything is awaited: the visitor can see it and stop it
        saved = await waitForCache(abort.signal);
      }
      // A saved answer is shown at once: for a sample at any time, for typed text only at the start of a conversation.
      const useSaved = findCached(saved, question) !== null && (from === 'sample' || history.length === 0);
      if (useSaved) {
        statusText.textContent = '';
        cancelBtn.hidden = true;
      } else {
        showWaiting();
      }
      const answered = await ask(question, engine, {
        endpoint,
        ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
        signal: abort.signal,
        cache: saved,
        history: useSaved ? [] : history,
      });
      // A saved answer asked mid-conversation joins the conversation instead of replacing it.
      result = useSaved && history.length > 0 ? { ...answered, messages: [...history, ...answered.messages] } : answered;
    } catch (error) {
      if (!abort.signal.aborted) {
        console.error('AI panel: ask failed', error);
        result = errorResult();
      }
    }

    statusText.textContent = '';
    cancelBtn.hidden = true;
    if (controller === abort) controller = null;
    if (destroyed) return;
    setBusy(false);

    if (result) {
      let shown = result;
      let drawn: HTMLElement | undefined;
      try {
        drawn = showResult(question, result);
      } catch (error) {
        // Drawing failed: say so plainly. The answer nobody saw is not put into the conversation.
        console.error('AI panel: could not draw the answer', error);
        shown = errorResult();
        try {
          drawn = showResult(question, shown);
        } catch (again) {
          console.error('AI panel: could not draw the error either', again);
        }
      }
      history = shown.messages;
      // The build named no address, yet the AI just answered (a Worker is routed on this origin): it is there, so the
      // intro stops saying it is not. (When an address was named the intro already is this one.)
      if (!shown.fromCache && (shown.status === 'ok' || shown.status === 'unverified_numbers')) lead.textContent = PANEL_TEXT.intro;
      if (from === 'typed' && (shown.status === 'ok' || shown.status === 'unverified_numbers')) {
        textarea.value = '';
        updateCounter();
      }
      updateNewButton();
      if (shown.needsNewConversation) {
        newBtn.hidden = false;
        newBtn.classList.add('is-attention');
        newBtn.focus({ preventScroll: true });
        if (drawn) bringIntoView(drawn);
        return;
      }
      restoreFocus(trigger);
      if (drawn) bringIntoView(drawn); // after the focus is back: the page ends up showing the answer, not the button
      return;
    }
    restoreFocus(trigger);
  }

  // ---- events -----------------------------------------------------------------------------------------------

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    // Whoever sent it gets the focus back afterwards: the button that was pressed, not the text field (a phone would open its keyboard).
    void send(textarea.value, 'typed', (event as SubmitEvent).submitter ?? textarea);
  });

  /** Keeps the first MAX_QUESTION_LENGTH code points and says so, quietly. Not while a conversion (IME) is in progress. */
  let pasteCut = false;
  function applyLimit(): void {
    // What was typed or pasted ends at the caret: that is what goes, and the caret stays where the typing was.
    const { text, caret, cut } = clipAtCaret(textarea.value, textarea.selectionEnd, MAX_QUESTION_LENGTH);
    if (cut) {
      textarea.value = text;
      textarea.setSelectionRange(caret, caret);
    }
    updateCounter();
    showInputMessage(cut || pasteCut ? PANEL_TEXT.limitCut : '', false);
    pasteCut = false;
  }

  textarea.addEventListener('input', (event) => {
    if ((event as InputEvent).isComposing) {
      updateCounter();
      if (inputMsg.textContent) showInputMessage('');
      return;
    }
    applyLimit();
  });
  textarea.addEventListener('compositionend', applyLimit);
  textarea.addEventListener('paste', (event) => {
    // The browser may cut a long paste at maxlength before any input event shows how long it was: say so now.
    const pasted = (event as ClipboardEvent).clipboardData?.getData('text') ?? '';
    const value = textarea.value;
    const start = textarea.selectionStart ?? value.length;
    const end = textarea.selectionEnd ?? start;
    const kept = countCodePoints(value.slice(0, start)) + countCodePoints(value.slice(end));
    if (kept + countCodePoints(pasted) > MAX_QUESTION_LENGTH) {
      pasteCut = true;
      showInputMessage(PANEL_TEXT.limitCut, false);
    }
  });

  textarea.addEventListener('keydown', (event) => {
    // Never act while the visitor is converting Japanese text: the Enter that confirms a conversion is not a send.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void send(textarea.value, 'typed', textarea);
    }
  });

  cancelBtn.addEventListener('click', () => controller?.abort());

  newBtn.addEventListener('click', () => {
    if (running) return;
    history = [];
    answersEl.replaceChildren();
    newBtn.classList.remove('is-attention');
    updateNewButton();
    textarea.focus();
  });

  // ---- teardown ---------------------------------------------------------------------------------------------

  const destroy = (): void => {
    if (destroyed) return;
    destroyed = true;
    unsubscribeScenario();
    controller?.abort();
    root.remove();
    if (registry.get(el) === destroy) registry.delete(el);
  };
  registry.set(el, destroy);
  return destroy;
}
