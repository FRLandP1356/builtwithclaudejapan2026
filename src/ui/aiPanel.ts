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
import { ask } from '../ai/client';
import type { AskResult, Message, TraceItem } from '../ai/client';
import { findCached, loadCachedAnswers, SAMPLE_QUESTIONS } from '../ai/cached';
import type { CachedAnswers } from '../ai/cached';
import type { EngineContext } from '../ai/tools';
import { isScenarioError, sanitizeScenario, scenarioKey } from '../data/runner';
import {
  compactJson,
  describeScenario,
  makePlaceNames,
  mapTargets,
  prettyJsonView,
  scenarioOffer,
  toolLabel,
  traceUsesEstimate,
} from './aiTrace';
import { ESTIMATE_BADGE, ESTIMATE_NOTE } from './sources';
import type { PanelContext } from './state';

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

const INTRO = '日本語で質問すると、Claudeが計算の結果を引いて答えます。答えの数字は、計算の結果からだけ引いています。';
const AFTER_2050 = '2050年までの数字は社人研の公式推計、2050年より後の数字は、このアプリの試算です（予測ではありません）。';
const STATUS_WAITING = '計算の結果を引いています…';
const MSG_BLANK = '質問を入力してください。';
const MSG_TOO_LONG = `質問は${MAX_QUESTION_LENGTH}文字までにしてください。`;
const MSG_CRASHED = 'うまく処理できませんでした。もう一度お試しください。';
const MSG_COPIED = 'コピーしました';
const MSG_COPY_FAILED = 'コピーできませんでした。文字を選んでコピーしてください。';
const MSG_SCENARIO_APPLIED = '画面に反映しました。2050年より後の試算は、この前提で計算されます。';
const MSG_SCENARIO_ALREADY = 'この前提は、すでに画面に反映されています。';
const MSG_SCENARIO_REFUSED = 'この前提は範囲外の値を含むため、画面には反映できません。';
const MSG_SCENARIO_FAILED = 'この前提を画面に反映できませんでした。';

const DEFAULT_ENDPOINT = '/api/chat';

/** The Worker's address: set at build time with VITE_CHAT_ENDPOINT (see docs/ai-endpoint.md), same-origin by default. */
function configuredEndpoint(): string {
  const value: unknown = import.meta.env.VITE_CHAT_ENDPOINT;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_ENDPOINT;
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

  // Saved answers: loaded once, in the background. A question asked before they arrive waits for them.
  let cache: CachedAnswers | null = null;
  let cacheReady = false;
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
    maxlength: String(MAX_QUESTION_LENGTH),
    'aria-describedby': `${helpId} ${msgId}`,
    autocomplete: 'off',
  });
  const counter = h('span', { class: 'ai-counter num' }, `0 / ${MAX_QUESTION_LENGTH}`);
  const inputMsg = h('p', { class: 'ai-input-msg', id: msgId, 'aria-live': 'polite' });
  const submitBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, '質問する');
  const newBtn = h('button', { type: 'button', class: 'btn ai-new', hidden: true }, '新しい質問を始める');
  const statusText = h('p', { class: 'ai-status-text', role: 'status', 'aria-live': 'polite' });
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

  const root = h(
    'div',
    { class: 'ai-panel' },
    h('p', { class: 'panel-lead' }, INTRO),
    h('p', { class: 'note' }, AFTER_2050),
    h('div', { class: 'panel-section' }, h('h3', { class: 'panel-section-title' }, '質問の例'), samplesList),
    h('div', { class: 'panel-section' }, h('h3', { class: 'panel-section-title' }, '自分で質問する'), form),
    h('div', { class: 'ai-status' }, statusText, cancelBtn),
    answersEl,
  );
  el.append(root);

  // ---- small helpers ----------------------------------------------------------------------------------------

  /** A button that asks one of the sample questions. */
  function sampleButton(question: string): HTMLLIElement {
    const button = h('button', { type: 'button', class: 'btn ai-sample', 'data-ask': 'sample' }, question);
    button.disabled = running;
    button.addEventListener('click', () => void send(question, 'sample', button));
    return h('li', {}, button);
  }
  for (const question of SAMPLE_QUESTIONS) samplesList.append(sampleButton(question));

  function updateCounter(): void {
    const n = textarea.value.length;
    counter.textContent = `${n} / ${MAX_QUESTION_LENGTH}`;
    counter.classList.toggle('is-over', n > MAX_QUESTION_LENGTH);
  }

  function showInputMessage(message: string): void {
    inputMsg.textContent = message;
    if (message) textarea.setAttribute('aria-invalid', 'true');
    else textarea.removeAttribute('aria-invalid');
  }

  function updateNewButton(): void {
    newBtn.hidden = history.length === 0 && answersEl.childElementCount === 0;
  }

  /** One thing at a time: while a question runs the controls are off and the stop button is on. */
  function setBusy(busy: boolean): void {
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
    const lost = !active || active === document.body || active === cancelBtn || (root.contains(active) && (active as HTMLButtonElement).disabled === true);
    if (!lost) return;
    (origin && origin.isConnected ? origin : textarea).focus();
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
          copyStatus.textContent = MSG_COPY_FAILED;
          return;
        }
        clipboard.writeText(view.full).then(
          () => {
            copyStatus.textContent = MSG_COPIED;
          },
          () => {
            copyStatus.textContent = MSG_COPY_FAILED;
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
      const button = h('button', { type: 'button', class: 'btn' }, `${target.label} を地図で開く`);
      button.addEventListener('click', () => {
        const done = ctx.store.set(target.kind === 'area' ? { selectedArea: target.code } : { selectedPref: target.code });
        if (done) revealMap();
      });
      box.append(button);
    }
    return box;
  }

  function renderScenarioOffer(trace: TraceItem[]): HTMLElement | null {
    const offer = scenarioOffer(trace);
    if (!offer) return null;
    const message = h('p', { class: 'ai-scenario-msg', role: 'status', 'aria-live': 'polite' });
    const button = h('button', { type: 'button', class: 'btn', 'data-role': 'apply-scenario' }, 'この前提を画面に反映する');
    button.addEventListener('click', () => {
      const checked = sanitizeScenario(offer);
      if (isScenarioError(checked)) {
        message.textContent = MSG_SCENARIO_REFUSED; // Ruling 21: nothing out of range reaches the engine
        return;
      }
      if (scenarioKey(ctx.store.get().scenario) === scenarioKey(checked)) {
        message.textContent = MSG_SCENARIO_ALREADY;
        return;
      }
      message.textContent = ctx.store.set({ scenario: checked }) ? MSG_SCENARIO_APPLIED : MSG_SCENARIO_FAILED;
    });
    return h('div', { class: 'ai-scenario' }, h('p', { class: 'note' }, `この答えの前提：${describeScenario(offer)}`), button, message);
  }

  function renderFailureSamples(): HTMLElement {
    const list = h('ul', { class: 'ai-samples' });
    for (const question of SAMPLE_QUESTIONS) list.append(sampleButton(question));
    return h('div', { class: 'ai-fail-samples' }, h('p', { class: 'note' }, '保存済みの質問を試せます。'), list);
  }

  function renderAnswer(question: string, result: AskResult): HTMLElement {
    const article = h('article', { class: 'ai-answer' }, h('p', { class: 'ai-question' }, h('span', { class: 'sr-only' }, '質問：'), question));
    const failed = result.status === 'unavailable' || result.status === 'error';

    if (failed) {
      article.append(h('p', { class: 'ai-fail' }, result.message ?? MSG_CRASHED));
      if (result.trace.length > 0) article.append(renderTrace(result.trace));
      article.append(renderFailureSamples());
      return article;
    }

    const usesEstimate = traceUsesEstimate(result.trace);
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

    const basis = [
      result.fromCache ? 'あらかじめ保存した回答です。数字は、そのとき引いた計算の結果から取っています。' : null,
      !result.fromCache && result.trace.length > 0 ? '数字は、下の「使った道具と数字」にある計算の結果から引いています。' : null,
      !result.fromCache && result.trace.length === 0 ? 'この答えでは、計算の結果は使っていません。' : null,
      usesEstimate ? `${ESTIMATE_NOTE}。` : null,
    ].filter((line): line is string => line !== null);
    article.append(h('p', { class: 'note ai-basis' }, basis.join('')));

    if (result.status === 'ok' && result.message) article.append(h('p', { class: 'note ai-message' }, result.message));
    if (result.trimmed) article.append(h('p', { class: 'note ai-trimmed' }, '古いやり取りは省略しました'));

    if (result.trace.length > 0) {
      article.append(renderTrace(result.trace));
      const links = renderMapLinks(result.trace);
      if (links) article.append(links);
      const scenario = renderScenarioOffer(result.trace);
      if (scenario) article.append(scenario);
    }
    return article;
  }

  /** Shows a finished ask at the top of the list. The older failure notices lose their sample buttons (the newest keeps its own). */
  function showResult(question: string, result: AskResult): void {
    for (const old of answersEl.querySelectorAll('.ai-fail-samples')) old.remove();
    answersEl.prepend(renderAnswer(question, result));
  }

  // ---- asking -----------------------------------------------------------------------------------------------

  async function send(raw: string, from: 'typed' | 'sample', trigger: HTMLElement): Promise<void> {
    if (running || destroyed) return;
    const question = raw.trim();
    if (from === 'typed') {
      if (question === '') return showInputMessage(MSG_BLANK);
      if (raw.length > MAX_QUESTION_LENGTH) return showInputMessage(MSG_TOO_LONG);
      showInputMessage('');
    }
    const origin = from === 'typed' ? textarea : trigger;

    setBusy(true);
    const abort = new AbortController();
    controller = abort;
    let result: AskResult | undefined;
    try {
      const saved = cacheReady ? cache : await cachePromise;
      // A saved answer is shown at once: for a sample at any time, for typed text only at the start of a conversation.
      const useSaved = findCached(saved, question) !== null && (from === 'sample' || history.length === 0);
      if (!useSaved) {
        statusText.textContent = STATUS_WAITING;
        cancelBtn.hidden = false;
        cancelBtn.focus();
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
        result = { answer: '', trace: [], unverified: [], fromCache: false, status: 'error', message: MSG_CRASHED, messages: history };
      }
    }

    statusText.textContent = '';
    cancelBtn.hidden = true;
    if (controller === abort) controller = null;
    if (destroyed) return;
    setBusy(false);

    if (result) {
      history = result.messages;
      showResult(question, result);
      if (from === 'typed' && (result.status === 'ok' || result.status === 'unverified_numbers')) {
        textarea.value = '';
        updateCounter();
      }
      updateNewButton();
      if (result.needsNewConversation) {
        newBtn.hidden = false;
        newBtn.classList.add('is-attention');
        newBtn.focus();
        return;
      }
    }
    restoreFocus(origin);
  }

  // ---- events -----------------------------------------------------------------------------------------------

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send(textarea.value, 'typed', textarea);
  });

  textarea.addEventListener('input', () => {
    updateCounter();
    showInputMessage('');
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
    controller?.abort();
    root.remove();
    if (registry.get(el) === destroy) registry.delete(el);
  };
  registry.set(el, destroy);
  return destroy;
}
