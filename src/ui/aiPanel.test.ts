// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import v8 from 'node:v8';
import vm from 'node:vm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { repoPath } from '../../test/helpers/paths';
import { ask, forgetAnsweredEndpoints } from '../ai/client';
import type { AskResult, Message } from '../ai/client';
import { SAMPLE_QUESTIONS } from '../ai/cached';
import type { CachedAnswer, CachedAnswers } from '../ai/cached';
import type { AppData } from '../data/loader';
import type { Groups } from '../engine/types';
import { createRunner } from '../data/runner';
import type { Runner } from '../data/runner';
import { CACHE_WAIT_MS, MAX_ANSWERS, PANEL_TEXT, mountAIPanel } from './aiPanel';
import type { AIPanelOptions } from './aiPanel';
import { createAppStore } from './state';
import type { PanelContext } from './state';

// The real ask() stays the real thing; one test makes it reject once to prove the panel contains a crash.
vi.mock('../ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/client')>();
  return { ...actual, ask: vi.fn(actual.ask) };
});

// ---------------------------------------------------------------------------------------------------------------
// Real data, built once. Every test gets its own store, so the selection and scenario never leak between tests.
// ---------------------------------------------------------------------------------------------------------------

let data: AppData;
let runner: Runner;

beforeAll(() => {
  const areas = loadAllAreas();
  const prefNames = new Map<string, string>();
  for (const a of areas) if (!prefNames.has(a.prefCode)) prefNames.set(a.prefCode, a.prefName);
  data = { areas, groups: JSON.parse(readFileSync(repoPath('public/data/groups.json'), 'utf8')) as Groups, facilities: loadFacilities(), japanTopo: { type: 'Topology', objects: {}, arcs: [] } as never, prefNames };
  runner = createRunner(data);
});

function makeContext(over: Partial<AppData> = {}): PanelContext {
  const merged = { ...data, ...over };
  return { store: createAppStore(runner, data, { year: 2050 }), data: merged, runner };
}

/** The first 40 areas with 4,000-character names: a find_area result is then far over the tool-result cap. */
function longNameData(): Partial<AppData> {
  return { areas: data.areas.slice(0, 40).map((a) => ({ ...a, name: `${'x'.repeat(4000)}${a.code}` })) };
}

// ---------------------------------------------------------------------------------------------------------------
// A scripted model behind a fake fetch (nothing here touches the network)
// ---------------------------------------------------------------------------------------------------------------

type Step = Response | Error | ((init: RequestInit | undefined) => Response | Promise<Response>);

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const modelResponse = (content: unknown[], stopReason: string): Response =>
  jsonResponse({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stopReason, usage: {} });
const textResponse = (text: string): Response => modelResponse([{ type: 'text', text }], 'end_turn');
const toolUse = (id: string, name: string, input: unknown): Record<string, unknown> => ({ type: 'tool_use', id, name, input });
const toolUseResponse = (...calls: Array<Record<string, unknown>>): Response => modelResponse(calls, 'tool_use');

interface Script {
  fetchFn: typeof fetch;
  mock: ReturnType<typeof vi.fn<typeof fetch>>;
  body: (n: number) => { messages: Message[] };
}

function script(...steps: Step[]): Script {
  let i = 0;
  const mock = vi.fn<typeof fetch>(async (_input, init) => {
    const step = steps[i++];
    if (step === undefined) throw new Error(`fake fetch: no scripted response for call ${i}`);
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(init);
    return step;
  });
  return { fetchFn: mock, mock, body: (n) => JSON.parse(mock.mock.calls[n]![1]!.body as string) };
}

/** A request that stays open until its signal is aborted. */
function hangUntilAborted(seen?: { signal?: AbortSignal | null }): Step {
  return (init) =>
    new Promise<Response>((_resolve, reject) => {
      if (seen) seen.signal = init?.signal;
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    });
}

const TOKYO_QUESTION = SAMPLE_QUESTIONS[0]!;
/** Every number is in the get_series result for area 13 (the same sentence src/ai/client.test.ts checks). */
const GOOD_TOKYO_ANSWER =
  '東京都の人口は、2020年に約1,405万人、2050年に約1,440万人です。2100年は、このアプリの試算で約1,190万人になります。65歳以上の割合は2100年に30.7%です。';

function savedEntry(question: string, answer: string, overrides: Partial<CachedAnswer> = {}): CachedAnswer {
  return {
    id: 'q1',
    question,
    answer,
    trace: [{ tool: 'get_series', input: { areaCode: '13' }, result: { rows: [{ year: 2050, basis: 'official', population: 14400000 }] } }],
    status: 'verified',
    generatedAt: '2026-11-06T00:00:00Z',
    ...overrides,
  };
}
const cacheOf = (...answers: CachedAnswer[]): CachedAnswers => ({ version: 1, answers });

// ---------------------------------------------------------------------------------------------------------------
// Mounting and driving the panel
// ---------------------------------------------------------------------------------------------------------------

interface Mounted {
  section: HTMLElement;
  ctx: PanelContext;
  destroy: () => void;
  q: <T extends Element = HTMLElement>(sel: string) => T;
  qa: <T extends Element = HTMLElement>(sel: string) => T[];
  textarea: HTMLTextAreaElement;
  submit: HTMLButtonElement;
  samples: () => HTMLButtonElement[];
  answers: () => HTMLElement[];
  newBtn: () => HTMLButtonElement;
  cancelBtn: () => HTMLButtonElement;
  typeAndSend: (text: string) => void;
  sendWithShortcut: (text: string) => void;
}

const mounted: Mounted[] = [];

function mount(options: AIPanelOptions = {}, ctx: PanelContext = makeContext(), section?: HTMLElement): Mounted {
  const el =
    section ??
    (() => {
      const s = document.createElement('section');
      s.className = 'panel';
      s.id = 'panel-ai';
      const h2 = document.createElement('h2');
      h2.className = 'panel-title';
      h2.id = 'panel-ai-title';
      h2.textContent = 'AIに質問';
      s.append(h2);
      document.body.append(s);
      return s;
    })();
  const destroy = mountAIPanel(el, ctx, { cache: null, ...options });
  const q = <T extends Element = HTMLElement>(sel: string): T => el.querySelector<T>(sel)!;
  const qa = <T extends Element = HTMLElement>(sel: string): T[] => [...el.querySelectorAll<T>(sel)];
  const textarea = q<HTMLTextAreaElement>('textarea');
  const m: Mounted = {
    section: el,
    ctx,
    destroy,
    q,
    qa,
    textarea,
    submit: q<HTMLButtonElement>('button[type="submit"]'),
    samples: () => qa<HTMLButtonElement>('.ai-samples button'),
    answers: () => qa('.ai-answer'),
    newBtn: () => q<HTMLButtonElement>('.ai-new'),
    cancelBtn: () => q<HTMLButtonElement>('.ai-cancel'),
    typeAndSend(text) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      m.submit.click();
    },
    sendWithShortcut(text) {
      textarea.value = text;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    },
  };
  mounted.push(m);
  return m;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Waits until an answer (or a failure notice) has been added. */
async function answersCount(m: Mounted, n: number): Promise<void> {
  await vi.waitFor(() => expect(m.answers()).toHaveLength(n), { timeout: 15_000 });
}

beforeEach(() => {
  forgetAnsweredEndpoints(); // every test starts as a fresh page: the client remembers which addresses have answered
});

afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------

describe('mount', () => {
  it('keeps the shell heading, adds the intro and the quiet line about 2050, and lists the five sample questions', () => {
    const m = mount();
    expect(m.section.querySelectorAll('h2')).toHaveLength(1);
    expect(m.section.querySelector('h2')!.textContent).toBe('AIに質問');
    const text = m.section.textContent!;
    expect(text).toContain(PANEL_TEXT.intro);
    expect(PANEL_TEXT.intro).toBe(
      '日本語で質問すると、Claudeがこのアプリの計算を呼び出し、その結果を使って答えます。計算を行うのはこのアプリです。答えが返ってきたら、答えの中の人数や割合などの数字を、その質問で使った計算の結果と照らし合わせます。結果の中に見つからない数字は、「確かめられなかった数字」として知らせます。',
    );
    expect(text).toContain('2050年より後の数字は、このアプリの試算です');
    expect(m.samples().map((b) => b.textContent)).toEqual(SAMPLE_QUESTIONS);
  });

  it('has a labelled textarea limited to 200 characters with a visible counter, and a 質問する button', () => {
    const m = mount();
    const label = m.q<HTMLLabelElement>(`label[for="${m.textarea.id}"]`);
    expect(label.textContent).toContain('質問');
    // maxlength counts UTF-16 units, so it is only a backstop (400 units hold 200 code points); the exact limit is enforced in code
    expect(m.textarea.maxLength).toBe(400);
    expect(m.q('.ai-counter').textContent).toBe('0 / 200');
    expect(m.submit.textContent).toBe('質問する');
    m.textarea.value = 'あいう';
    m.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(m.q('.ai-counter').textContent).toBe('3 / 200');
  });

  it('starts idle: no status, no stop button, no new-conversation button, no answers', () => {
    const m = mount();
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.cancelBtn().hidden).toBe(true);
    expect(m.newBtn().hidden).toBe(true);
    expect(m.answers()).toHaveLength(0);
  });

  it('marks its live regions: a polite status and a polite answer region', () => {
    const m = mount();
    expect(m.q('.ai-status-text').getAttribute('role')).toBe('status');
    expect(m.q('.ai-answers').getAttribute('aria-live')).toBe('polite');
    expect(m.q('.ai-answers').getAttribute('aria-relevant')).toBe('additions'); // clearing the list is not announced
  });

  it('keeps the hidden attribute in force on buttons (.btn sets display, which would show a hidden button)', () => {
    const css = readFileSync(repoPath('src/ui/aiPanel.css'), 'utf8');
    expect(css).toMatch(/\.ai-panel \[hidden\]\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // tokens only, no raw colours
    expect(css).not.toMatch(/box-shadow/); // DESIGN.md: shadows are for the tooltip and the search list only
  });

  it('adds no listeners outside its own elements, and builds no HTML from strings', () => {
    const w = vi.spyOn(window, 'addEventListener');
    const d = vi.spyOn(document, 'addEventListener');
    mount();
    expect(w).not.toHaveBeenCalled();
    expect(d).not.toHaveBeenCalled();
    for (const file of ['aiPanel.ts', 'aiTrace.ts']) {
      const source = readFileSync(repoPath(`src/ui/${file}`), 'utf8');
      expect(source, file).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    }
  });

  it('mounting twice into the same slot does not duplicate the interface', () => {
    const first = mount();
    const second = mount({}, makeContext(), first.section);
    expect(second.section.querySelectorAll('.ai-panel')).toHaveLength(1);
    expect(second.section.querySelectorAll('h2')).toHaveLength(1);
    expect(second.section.querySelectorAll('textarea')).toHaveLength(1);
    expect(second.samples()).toHaveLength(5);
  });

  it('static text never says 予測する, 残せない or tells anyone what to keep or give up', () => {
    const m = mount();
    const text = m.section.textContent!;
    expect(text).not.toMatch(/残せない|予測する|予測します|残すべき|残さない|諦め|閉鎖|やめるべき/);
    expect(text.replace(/予測ではありません/g, '')).not.toContain('予測');
    expect(text).not.toMatch(/[①-⑳]/);
  });
});

describe('sample questions', () => {
  it('a sample with a verified saved answer appears at once, without any request, marked 保存済みの回答', async () => {
    const s = script();
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) });
    m.samples()[0]!.click();
    await answersCount(m, 1);

    expect(s.mock).not.toHaveBeenCalled();
    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-question')!.textContent).toContain(TOKYO_QUESTION);
    expect(article.querySelector('.ai-answer-text')!.textContent).toBe('保存済みの答えです。');
    expect(article.querySelector('[data-role="saved-badge"]')!.textContent).toBe('保存済みの回答');
    expect(article.querySelector('.ai-trace')).not.toBeNull();
  });

  it('a sample without a saved answer is asked live: the Tokyo question end to end', async () => {
    const s = script(toolUseResponse(toolUse('toolu_01', 'get_series', { areaCode: '13' })), textResponse(GOOD_TOKYO_ANSWER));
    const m = mount({ fetchFn: s.fetchFn });
    m.samples()[0]!.click();
    await answersCount(m, 1);

    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(String(s.mock.mock.calls[0]![0])).toBe('/api/chat');
    expect(s.body(0).messages).toEqual([{ role: 'user', content: TOKYO_QUESTION }]);
    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-answer-text')!.textContent).toBe(GOOD_TOKYO_ANSWER);
    expect(article.querySelector('[data-role="saved-badge"]')).toBeNull();
    expect(article.querySelector('.ai-warning')).toBeNull();
    expect(article.querySelector('.badge-estimate')!.textContent).toBe('試算');
    expect(article.querySelector('.ai-basis')!.textContent).toBe(
      '数字は、下の「使った道具と数字」にある計算の結果から引いています。2050年より後は、このアプリの試算です（予測ではありません）。',
    );

    const items = [...article.querySelectorAll('.ai-trace-item')];
    expect(items).toHaveLength(1);
    expect(items[0]!.querySelector('.ai-trace-name')!.textContent).toBe('人口の推移を取る');
    expect(items[0]!.querySelector('.ai-trace-input')!.textContent).toBe('{"areaCode":"13"}');
    expect(items[0]!.querySelector('.ai-json')!.textContent).toContain('"population"');
  });

  it('the sample question asked live does not touch the typed draft', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.value = '書きかけ';
    m.samples()[1]!.click();
    await answersCount(m, 1);
    expect(m.textarea.value).toBe('書きかけ');
  });

  it('a sample with a saved answer is shown at once even in the middle of a conversation, and the conversation goes on', async () => {
    const s = script(textResponse('最初の答えです。'), textResponse('三つ目の答えです。'));
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) });
    m.typeAndSend('こんにちは');
    await answersCount(m, 1);
    m.samples()[0]!.click();
    await answersCount(m, 2);
    expect(s.mock).toHaveBeenCalledTimes(1); // the saved answer needed no request
    expect(m.answers()[0]!.querySelector('[data-role="saved-badge"]')).not.toBeNull();

    m.typeAndSend('ありがとう');
    await answersCount(m, 3);
    expect(s.body(1).messages.map((x) => (typeof x.content === 'string' ? x.content : x.content.map((b) => ('text' in b ? b.text : '')).join('')))).toEqual([
      'こんにちは',
      '最初の答えです。',
      TOKYO_QUESTION,
      '保存済みの答えです。',
      'ありがとう',
    ]);
  });
});

describe('asking', () => {
  it('shows the question, the answer and the basis note, and clears the typed question on success', async () => {
    const s = script(textResponse('日本語で答えます。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('  このアプリは何ですか  ');
    await answersCount(m, 1);

    expect(s.body(0).messages).toEqual([{ role: 'user', content: 'このアプリは何ですか' }]);
    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-question')!.textContent).toContain('このアプリは何ですか');
    expect(article.querySelector('.ai-answer-text')!.textContent).toBe('日本語で答えます。');
    expect(article.querySelector('.ai-basis')!.textContent).toBe('この答えでは、計算の結果は使っていません。');
    expect(m.textarea.value).toBe('');
    expect(m.q('.ai-counter').textContent).toBe('0 / 200');
    expect(m.newBtn().hidden).toBe(false);
  });

  it('keeps line breaks in the answer', async () => {
    const m = mount({ fetchFn: script(textResponse('一行目\n二行目')).fetchFn });
    m.typeAndSend('改行');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('.ai-answer-text')!.textContent).toBe('一行目\n二行目');
    const css = readFileSync(repoPath('src/ui/aiPanel.css'), 'utf8');
    expect(css).toMatch(/\.ai-answer-text\s*\{[^}]*white-space:\s*pre-wrap/);
  });

  it('while waiting: a calm status, a stop button, inputs disabled; afterwards everything is back', async () => {
    let release!: (r: Response) => void;
    const s = script(() => new Promise<Response>((resolve) => (release = resolve)));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('待ちます');
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));

    expect(m.q('.ai-status-text').textContent).toBe('計算の結果を引いています…');
    expect(m.cancelBtn().hidden).toBe(false);
    expect(m.submit.disabled).toBe(true);
    expect(m.textarea.readOnly).toBe(true);
    expect(m.samples().every((b) => b.disabled)).toBe(true);
    // one at a time: a second send while running does nothing
    m.samples()[0]!.click();
    m.sendWithShortcut('もう一つ');
    expect(s.mock).toHaveBeenCalledTimes(1);

    release(textResponse('終わりました。'));
    await answersCount(m, 1);
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.cancelBtn().hidden).toBe(true);
    expect(m.submit.disabled).toBe(false);
    expect(m.textarea.readOnly).toBe(false);
    expect(m.samples().every((b) => !b.disabled)).toBe(true);
  });

  it('puts the newest answer first', async () => {
    const m = mount({ fetchFn: script(textResponse('一つ目。'), textResponse('二つ目。')).fetchFn });
    m.typeAndSend('一');
    await answersCount(m, 1);
    m.typeAndSend('二');
    await answersCount(m, 2);
    expect(m.answers().map((a) => a.querySelector('.ai-answer-text')!.textContent)).toEqual(['二つ目。', '一つ目。']);
  });

  it('a request that breaks in an unexpected way ends in a plain message, no stack, and the panel is idle again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(ask).mockRejectedValueOnce(new Error('boom: secret internal detail'));
    const m = mount({ fetchFn: script().fetchFn });
    m.typeAndSend('壊れる質問');
    await answersCount(m, 1);
    const text = m.answers()[0]!.textContent!;
    expect(text).toContain('うまく処理できませんでした');
    expect(text).not.toContain('boom');
    expect(m.submit.disabled).toBe(false);
    expect(m.textarea.value).toBe('壊れる質問'); // kept, so it can be sent again
    expect(logged).toHaveBeenCalledTimes(1); // the detail goes to the console for a developer, never to the page
  });
});

describe('keyboard and input rules', () => {
  const press = (m: Mounted, init: KeyboardEventInit): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    m.textarea.dispatchEvent(event);
    return event;
  };

  it('plain Enter inserts a newline (the key is left alone) and sends nothing', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.value = '質問です';
    const event = press(m, { key: 'Enter' });
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(s.mock).not.toHaveBeenCalled();
    expect(m.answers()).toHaveLength(0);
  });

  it('Enter during IME composition never triggers anything, with or without Ctrl', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.value = '変換中';
    const events = [
      press(m, { key: 'Enter', isComposing: true }),
      press(m, { key: 'Enter', ctrlKey: true, isComposing: true }),
      press(m, { key: 'Enter', keyCode: 229 }),
      press(m, { key: 'Enter', metaKey: true, keyCode: 229 }),
      press(m, { key: 'Process', keyCode: 229, isComposing: true }),
    ];
    await settle();
    expect(s.mock).not.toHaveBeenCalled();
    expect(events.every((e) => !e.defaultPrevented)).toBe(true);
    expect(m.q('.ai-input-msg').textContent).toBe('');
  });

  it('Ctrl+Enter and Cmd+Enter send', async () => {
    const s = script(textResponse('一。'), textResponse('二。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.value = 'ctrl で送る';
    const event = press(m, { key: 'Enter', ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
    await answersCount(m, 1);
    m.textarea.value = 'cmd で送る';
    press(m, { key: 'Enter', metaKey: true });
    await answersCount(m, 2);
    expect(s.mock).toHaveBeenCalledTimes(2);
  });

  it('a blank or whitespace-only question is refused on the page, with no request', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    for (const blank of ['', '   ', ' \n\t　 ']) {
      m.typeAndSend(blank);
      expect(m.q('.ai-input-msg').textContent).toBe('質問を入力してください。');
      expect(m.textarea.getAttribute('aria-invalid')).toBe('true');
    }
    m.sendWithShortcut('   ');
    await settle();
    expect(s.mock).not.toHaveBeenCalled();
    expect(m.answers()).toHaveLength(0);
    // typing again clears the message
    m.textarea.value = 'あ';
    m.textarea.dispatchEvent(new Event('input', { bubbles: true }));
    expect(m.q('.ai-input-msg').textContent).toBe('');
    expect(m.textarea.hasAttribute('aria-invalid')).toBe(false);
  });

  const input = (m: Mounted, value: string, init: InputEventInit = {}): void => {
    m.textarea.value = value;
    m.textarea.dispatchEvent(new InputEvent('input', { bubbles: true, ...init }));
  };
  const paste = (m: Mounted, text: string): void => {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    m.textarea.dispatchEvent(event);
  };

  it('text typed or pasted past 200 characters keeps the first 200 and says so quietly', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    input(m, 'あ'.repeat(201));
    expect(m.textarea.value).toBe('あ'.repeat(200));
    expect(m.q('.ai-counter').textContent).toBe('200 / 200');
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
    expect(PANEL_TEXT.limitCut).toBe('200文字までです。超えた分は入力されません。');
    expect(m.textarea.hasAttribute('aria-invalid')).toBe(false); // it is a notice, not an error
    expect(s.mock).not.toHaveBeenCalled();

    // typing something else clears the notice; the text that fits is sent
    input(m, 'あ'.repeat(199));
    expect(m.q('.ai-input-msg').textContent).toBe('');
    m.submit.click();
    await answersCount(m, 1);
    expect(s.body(0).messages[0]!.content).toBe('あ'.repeat(199));
  });

  it('typing in the middle of a full question drops what was typed, not the last character, and the caret stays', () => {
    const m = mount();
    const full = 'あ'.repeat(100) + 'い'.repeat(100); // 200: the question is full
    input(m, full);
    expect(m.textarea.value).toBe(full);
    // the visitor types 「X」 between the あ and the い: the browser puts the caret right after it
    m.textarea.value = 'あ'.repeat(100) + 'X' + 'い'.repeat(100);
    m.textarea.setSelectionRange(101, 101);
    m.textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(m.textarea.value).toBe(full); // the い at the end is still there
    expect(m.textarea.selectionStart).toBe(100);
    expect(m.textarea.selectionEnd).toBe(100);
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
    expect(m.q('.ai-counter').textContent).toBe('200 / 200');
  });

  it('a paste into the middle keeps as much of it as fits, from its start, with the caret after what stayed', () => {
    const m = mount();
    const before = 'あ'.repeat(95) + 'い'.repeat(95); // 190
    input(m, before);
    m.textarea.value = 'あ'.repeat(95) + '1234567890ABCDEFGHIJ' + 'い'.repeat(95); // 210
    m.textarea.setSelectionRange(115, 115);
    m.textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(m.textarea.value).toBe('あ'.repeat(95) + '1234567890' + 'い'.repeat(95));
    expect(m.textarea.selectionStart).toBe(105);
    expect(m.textarea.selectionEnd).toBe(105);
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
  });

  it('in the middle of a full question, a pair of UTF-16 units is never split and the caret counts units', () => {
    const m = mount();
    input(m, '😀'.repeat(200));
    m.textarea.value = '😀'.repeat(100) + '𠮷' + '😀'.repeat(100);
    m.textarea.setSelectionRange(202, 202); // 100 emoji = 200 units, then 𠮷 = 2 more
    m.textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(m.textarea.value).toBe('😀'.repeat(200));
    expect(m.textarea.selectionStart).toBe(200);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(m.textarea.value)).toBe(false);
  });

  it('typing at the end of a full question still cuts the end, caret at the end', () => {
    const m = mount();
    input(m, 'あ'.repeat(201));
    expect(m.textarea.value).toBe('あ'.repeat(200));
    expect(m.textarea.selectionStart).toBe(200);
  });

  it('when a conversion (IME) ends in the middle of a full question, the same rule applies', () => {
    const m = mount();
    const full = 'あ'.repeat(100) + 'い'.repeat(100);
    input(m, full);
    input(m, 'あ'.repeat(100) + 'ほげほげ' + 'い'.repeat(100), { isComposing: true }); // 204, held until the conversion ends
    m.textarea.setSelectionRange(104, 104);
    expect(m.textarea.value.length).toBe(204);
    m.textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(m.textarea.value).toBe(full);
    expect(m.textarea.selectionStart).toBe(100);
  });

  it('the paste event shows the notice at once, even when the browser has already cut the text', () => {
    const m = mount();
    input(m, 'あ'.repeat(190));
    m.textarea.setSelectionRange(190, 190);
    paste(m, 'い'.repeat(50));
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
    // the browser then inserts what it can; the notice is still there
    input(m, 'あ'.repeat(190) + 'い'.repeat(10));
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
    expect(m.textarea.value.length).toBe(200);
  });

  it('a paste that replaces a selection and still fits shows no notice', () => {
    const m = mount();
    input(m, 'あ'.repeat(150));
    m.textarea.setSelectionRange(50, 150);
    paste(m, 'い'.repeat(100));
    input(m, 'あ'.repeat(50) + 'い'.repeat(100));
    expect(m.q('.ai-input-msg').textContent).toBe('');
    expect(m.q('.ai-counter').textContent).toBe('150 / 200');
  });

  it('counts code points: an emoji or a rare kanji counts once, and a pair is never cut in half', () => {
    const m = mount();
    input(m, '😀'.repeat(200)); // 400 UTF-16 units
    expect(m.q('.ai-counter').textContent).toBe('200 / 200');
    expect(m.q('.ai-input-msg').textContent).toBe('');
    expect(m.textarea.value).toBe('😀'.repeat(200));
    input(m, '😀'.repeat(200) + '𠮷');
    expect(m.textarea.value).toBe('😀'.repeat(200));
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(m.textarea.value)).toBe(false);
  });

  it('never trims in the middle of an IME conversion; it trims when the conversion ends', () => {
    const m = mount();
    input(m, 'あ'.repeat(230), { isComposing: true });
    expect(m.textarea.value.length).toBe(230);
    expect(m.q('.ai-counter').textContent).toBe('230 / 200');
    m.textarea.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(m.textarea.value.length).toBe(200);
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.limitCut);
  });

  it('refuses a question that is still too long when it is sent (a value set without an input event), with no request', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.value = 'あ'.repeat(201);
    m.submit.click();
    expect(m.q('.ai-input-msg').textContent).toBe(PANEL_TEXT.tooLong);
    expect(m.textarea.getAttribute('aria-invalid')).toBe('true');
    await settle();
    expect(s.mock).not.toHaveBeenCalled();

    m.textarea.value = '😀'.repeat(200); // 400 units but 200 code points: allowed
    m.submit.click();
    await answersCount(m, 1);
    expect(s.mock).toHaveBeenCalledTimes(1);
  });
});

describe('numbers that could not be checked', () => {
  it('an invented number twice: a visible warning lists it', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_01', 'get_series', { areaCode: '13' })),
      textResponse('東京都は2100年に約2,500万人です。'),
      textResponse('東京都は2100年に約2,600万人です。'),
    );
    const m = mount({ fetchFn: s.fetchFn });
    m.samples()[0]!.click();
    await answersCount(m, 1);

    const warning = m.answers()[0]!.querySelector('.ai-warning')!;
    expect(warning).not.toBeNull();
    expect(warning.textContent).toContain('次の数字は、計算の結果で確かめられませんでした：2,600万');
    expect(warning.textContent).toContain('使った道具と数字');
    expect(m.answers()[0]!.querySelector('.ai-answer-text')!.textContent).toBe('東京都は2100年に約2,600万人です。');
  });
});

/** The three facts: not available now, why, and what still works. */
const NOT_AVAILABLE_TEXT =
  'このバージョンでは、AIへの質問は使えません（AIの接続先がまだ用意されていません）。地図、数値、前提の調整、人口の割り振りはそのまま使えます。';
const TRY_LATER_TEXT = 'いまはAIに接続できません。時間をおいて、もう一度お試しください。';
const SAVED_HINT_TEXT = 'いまはAIに接続できません。保存済みの質問を試してください。';
const pendingEntry = (i: number): CachedAnswer => savedEntry(SAMPLE_QUESTIONS[i]!, '', { id: `q${i + 1}`, status: 'pending', trace: [] });
const allPending = (): CachedAnswers => cacheOf(...SAMPLE_QUESTIONS.map((_, i) => pendingEntry(i)));
const unavailableNotices = (m: Mounted): HTMLElement[] => m.qa('.ai-answers [data-role="ai-unavailable"]');
const countOf = (text: string, part: string): number => text.split(part).length - 1;

describe('the intro does not overclaim', () => {
  it('says what is checked, not that every number comes from the calculation', () => {
    const intro = PANEL_TEXT.intro;
    expect(intro).not.toContain('からだけ');
    expect(intro).not.toContain('だけ引いて');
    expect(intro).toContain('照らし合わせ'); // a check after the answer arrives
    expect(intro).toContain('見つからない数字'); // what the check finds
    expect(intro).toContain('知らせます'); // and says so
    expect(intro.indexOf('答えが返ってきたら')).toBeGreaterThan(intro.indexOf('計算を行うのはこのアプリ')); // the order of events
  });

  it('is true of the panel: a number the calculation never returned is flagged, one it returned is not', async () => {
    const flagged = script(
      toolUseResponse(toolUse('toolu_01', 'get_series', { areaCode: '13' })),
      textResponse('東京都は2100年に約2,500万人です。'),
      textResponse('東京都は2100年に約2,600万人です。'),
    );
    const bad = mount({ fetchFn: flagged.fetchFn });
    bad.samples()[0]!.click();
    await answersCount(bad, 1);
    expect(bad.answers()[0]!.querySelector('.ai-warning')).not.toBeNull();
    expect(bad.answers()[0]!.querySelector('.ai-warning')!.textContent).toContain('確かめられませんでした');

    const slot = document.createElement('section');
    document.body.append(slot);
    const good = mount({ fetchFn: script(toolUseResponse(toolUse('toolu_01', 'get_series', { areaCode: '13' })), textResponse(GOOD_TOKYO_ANSWER)).fetchFn }, makeContext(), slot);
    good.samples()[0]!.click();
    await answersCount(good, 1);
    expect(good.answers()[0]!.querySelector('.ai-warning')).toBeNull();
  });
});

describe('when the AI cannot be reached', () => {
  it('429 with cached:true and no verified saved answer: try again later, and no saved questions are offered or mentioned', async () => {
    const s = script(jsonResponse({ error: 'rate_limited', cached: true }, 429));
    const m = mount({ fetchFn: s.fetchFn, cache: allPending() });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-fail')!.textContent).toBe(TRY_LATER_TEXT);
    expect(article.querySelector('.ai-fail-samples')).toBeNull();
    expect(article.querySelectorAll('button')).toHaveLength(0);
    expect(article.textContent).not.toContain('保存済み');
    expect(article.hasAttribute('data-role')).toBe(false); // not the "not available" notice
    expect(article.querySelector('.ai-trace')).toBeNull();
    expect(m.textarea.value).toBe('どこかの町は？'); // kept for another try
  });

  it('429 with cached:true and one verified saved answer: the message says so and offers exactly that question', async () => {
    const s = script(jsonResponse({ error: 'rate_limited', cached: true }, 429));
    const verified = savedEntry(SAMPLE_QUESTIONS[2]!, '保存済みの答えです。', { id: 'q3' });
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(pendingEntry(0), pendingEntry(1), verified, pendingEntry(3), pendingEntry(4)) });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-fail')!.textContent).toBe(SAVED_HINT_TEXT);
    expect(article.querySelector('.ai-fail-samples .note')!.textContent).toBe(PANEL_TEXT.trySaved);
    expect([...article.querySelectorAll<HTMLButtonElement>('.ai-fail-samples button')].map((b) => b.textContent)).toEqual([SAMPLE_QUESTIONS[2]]);
  });

  it('every verified sample gets a button in the notice, in the order the samples are listed', async () => {
    const s = script(jsonResponse({ error: 'upstream_error' }, 502));
    const entries = [4, 0, 2].map((i) => savedEntry(SAMPLE_QUESTIONS[i]!, '保存済みの答えです。', { id: `q${i + 1}` }));
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(...entries) });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);
    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-fail-samples button')];
    expect(buttons.map((b) => b.textContent)).toEqual([SAMPLE_QUESTIONS[0], SAMPLE_QUESTIONS[2], SAMPLE_QUESTIONS[4]]);
  });

  it('the sample buttons in the notice work: a saved answer appears, and the old notice drops its buttons', async () => {
    const s = script(jsonResponse({ error: 'rate_limited', cached: true }, 429));
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);
    m.answers()[0]!.querySelector<HTMLButtonElement>('.ai-fail-samples button')!.click();
    await answersCount(m, 2);
    expect(m.answers()[0]!.querySelector('[data-role="saved-badge"]')).not.toBeNull();
    expect(m.answers()[1]!.querySelector('.ai-fail-samples')).toBeNull();
    expect(m.answers()[1]!.textContent).toContain('いまはAIに接続できません');
  });

  it('a 5xx while a saved answer exists for the typed question: the saved answer is shown and says so', async () => {
    const s = script(textResponse('はじめの答え。'), jsonResponse({ error: 'upstream_error' }, 502));
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) });
    m.typeAndSend('こんにちは');
    await answersCount(m, 1);
    m.typeAndSend(TOKYO_QUESTION);
    await answersCount(m, 2);
    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-answer-text')!.textContent).toBe('保存済みの答えです。');
    expect(article.querySelector('[data-role="saved-badge"]')!.textContent).toBe('保存済みの回答');
    expect(article.textContent).toContain('いまはAIに接続できないため、保存済みの答えを表示しています。');
  });

  it('a request the Worker refuses (403) is an error; the saved questions follow only when some answer is verified', async () => {
    const none = mount({ fetchFn: script(jsonResponse({ error: 'origin_not_allowed' }, 403)).fetchFn, cache: allPending() });
    none.typeAndSend('どこ？');
    await answersCount(none, 1);
    expect(none.answers()[0]!.textContent).toContain('AIへの問い合わせでエラーが起きました');
    expect(none.answers()[0]!.querySelector('.ai-fail-samples')).toBeNull();
    expect(none.answers()[0]!.textContent).not.toContain('保存済み');
    expect(none.answers()[0]!.hasAttribute('data-role')).toBe(false);

    const all = mount(
      { fetchFn: script(jsonResponse({ error: 'origin_not_allowed' }, 403)).fetchFn, cache: cacheOf(...SAMPLE_QUESTIONS.map((q, i) => savedEntry(q, '保存済みの答えです。', { id: `q${i + 1}` }))) },
      makeContext(),
      (() => {
        const other = document.createElement('section');
        other.id = 'panel-ai-second';
        document.body.append(other);
        return other;
      })(),
    );
    all.typeAndSend('どこ？');
    await answersCount(all, 1);
    expect(all.answers()[0]!.querySelectorAll('.ai-fail-samples button')).toHaveLength(5);
  });
});

describe('when there is no AI behind the page (nothing is deployed)', () => {
  const html = (): Response => new Response('<!doctype html><title>2100年の日本</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  const noWorker: Array<[string, () => Step]> = [
    ['404', () => jsonResponse({ error: 'not_found' }, 404)],
    ['405', () => new Response('Method Not Allowed', { status: 405 })],
    ['a 200 with the index page', html],
  ];

  it.each(noWorker)('%s: a sample click shows the plain sentence, not the retry text, and no retry button', async (_name, step) => {
    const s = script(step());
    const m = mount({ fetchFn: s.fetchFn, cache: allPending() });
    m.samples()[1]!.click();
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.getAttribute('data-role')).toBe('ai-unavailable');
    expect(article.querySelector('.ai-question')!.textContent).toContain(SAMPLE_QUESTIONS[1]!);
    expect(article.querySelector('.ai-fail')!.textContent).toBe(NOT_AVAILABLE_TEXT);
    expect(article.textContent).not.toContain('時間をおいて');
    expect(article.textContent).not.toContain('もう一度');
    expect(article.textContent).not.toContain('保存済み');
    expect(article.querySelectorAll('button')).toHaveLength(0);
    expect(s.mock).toHaveBeenCalledTimes(1);
  });

  it('a result that names the reason but carries no message still shows the plain sentence', async () => {
    vi.mocked(ask).mockResolvedValueOnce({ answer: '', trace: [], unverified: [], fromCache: false, status: 'unavailable', reason: 'not_configured', messages: [] });
    const m = mount({ cache: allPending() });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('.ai-fail')!.textContent).toBe(NOT_AVAILABLE_TEXT);
  });

  it('a dropped connection at the default address (a flaky link, the page was served over http) says to try again later, not that there is no AI', async () => {
    const m = mount({ fetchFn: script(new TypeError('Failed to fetch')).fetchFn, cache: allPending() });
    m.samples()[1]!.click();
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('.ai-fail')!.textContent).toBe(TRY_LATER_TEXT);
    expect(unavailableNotices(m)).toHaveLength(0);
    expect(m.answers()[0]!.textContent).not.toContain('このバージョンでは');
  });

  it('once the AI has answered, a later 404 or a dropped connection never turns into "not available"', async () => {
    const s = script(textResponse('一つ目の答え。'), jsonResponse({ error: 'not_found' }, 404), new TypeError('Failed to fetch'), html());
    const m = mount({ fetchFn: s.fetchFn, cache: allPending() });
    m.typeAndSend('一つ目');
    await answersCount(m, 1);
    for (const [i, question] of ['二つ目', '三つ目', '四つ目'].entries()) {
      m.typeAndSend(question);
      await answersCount(m, i + 2);
      expect(m.answers()[0]!.querySelector('.ai-fail')!.textContent).toBe(TRY_LATER_TEXT);
    }
    expect(unavailableNotices(m)).toHaveLength(0);
    expect(m.section.textContent).not.toContain('このバージョンでは');
  });

  it('the five sample buttons stay (they are the tour), and are usable again after the sentence', async () => {
    const m = mount({ fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn, cache: allPending() });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    expect(m.samples().map((b) => b.textContent)).toEqual(SAMPLE_QUESTIONS);
    expect(m.samples().every((b) => !b.disabled)).toBe(true);
  });

  it('the sentence is on the page once: asking again replaces it and shows the newest question', async () => {
    const s = script(jsonResponse({ error: 'not_found' }, 404), jsonResponse({ error: 'not_found' }, 404), jsonResponse({ error: 'not_found' }, 404));
    const m = mount({ fetchFn: s.fetchFn, cache: allPending() });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    m.samples()[3]!.click();
    await vi.waitFor(() => expect(m.answers()[0]!.querySelector('.ai-question')!.textContent).toContain(SAMPLE_QUESTIONS[3]!));
    m.typeAndSend('自分の質問');
    await vi.waitFor(() => expect(m.answers()[0]!.querySelector('.ai-question')!.textContent).toContain('自分の質問'));

    expect(s.mock).toHaveBeenCalledTimes(3); // it did ask each time
    expect(m.answers()).toHaveLength(1);
    expect(unavailableNotices(m)).toHaveLength(1);
    expect(countOf(m.q('.ai-answers').textContent!, NOT_AVAILABLE_TEXT)).toBe(1);
  });

  it('the sentence stays where it is, and answers that arrive later go above it (a Worker that appears after the first try is believed)', async () => {
    const s = script(jsonResponse({ error: 'not_found' }, 404), textResponse('二つ目の答え。'), textResponse('三つ目の答え。'));
    const m = mount({ fetchFn: s.fetchFn, cache: allPending() });
    m.typeAndSend('一つ目');
    await answersCount(m, 1);
    m.typeAndSend('二つ目');
    await answersCount(m, 2);
    m.typeAndSend('三つ目');
    await answersCount(m, 3);
    expect(m.answers().map((a) => a.querySelector('.ai-answer-text')?.textContent ?? 'notice')).toEqual(['三つ目の答え。', '二つ目の答え。', 'notice']);
    expect(unavailableNotices(m)).toHaveLength(1);
  });

  it('a verified saved question is still offered under the sentence; pending ones are not', async () => {
    const s = script(jsonResponse({ error: 'not_found' }, 404));
    const verified = savedEntry(SAMPLE_QUESTIONS[3]!, '保存済みの答えです。', { id: 'q4' });
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(pendingEntry(0), pendingEntry(1), pendingEntry(2), verified, pendingEntry(4)) });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);
    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-fail')!.textContent).toBe(NOT_AVAILABLE_TEXT);
    expect([...article.querySelectorAll<HTMLButtonElement>('.ai-fail-samples button')].map((b) => b.textContent)).toEqual([SAMPLE_QUESTIONS[3]]);
  });

  it('a verified saved answer is shown for its sample question at the start, with no request at all', async () => {
    const s = script();
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    expect(s.mock).not.toHaveBeenCalled();
    expect(m.answers()[0]!.querySelector('.ai-answer-text')!.textContent).toBe('保存済みの答えです。');
    expect(unavailableNotices(m)).toHaveLength(0);
  });

  it('busy or down is not the same: a 502, and a failed connection to an address that was configured, still say to try again later', async () => {
    const a = mount({ fetchFn: script(jsonResponse({ error: 'upstream_error' }, 502)).fetchFn, cache: allPending() });
    a.samples()[0]!.click();
    await answersCount(a, 1);
    expect(a.answers()[0]!.querySelector('.ai-fail')!.textContent).toBe(TRY_LATER_TEXT);
    expect(unavailableNotices(a)).toHaveLength(0);

    const slot = document.createElement('section');
    document.body.append(slot);
    const b = mount({ fetchFn: script(new TypeError('Failed to fetch')).fetchFn, endpoint: 'https://worker.example.test/api/chat', cache: allPending() }, makeContext(), slot);
    b.samples()[0]!.click();
    await answersCount(b, 1);
    expect(b.answers()[0]!.querySelector('.ai-fail')!.textContent).toBe(TRY_LATER_TEXT);
    expect(unavailableNotices(b)).toHaveLength(0);
  });

  it('the sentence passes the same wording rules as the rest of the panel', async () => {
    const m = mount({ fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn, cache: allPending() });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    const text = m.answers()[0]!.textContent!;
    expect(text).not.toMatch(/残せない|予測|残すべき|残さない|諦め|閉鎖|やめるべき|守るべき|切り捨て/);
    expect(text).not.toMatch(/[\u2460-\u2473]/);
  });

  it('keyboard focus goes back to the sample button that was pressed', async () => {
    const m = mount({ fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn, cache: allPending() });
    const button = m.samples()[2]!;
    button.focus();
    button.click();
    await answersCount(m, 1);
    expect(document.activeElement).toBe(button);
  });
});

describe('the conversation', () => {
  it('follow-up questions carry the conversation; 新しい質問を始める clears it and the shown answers', async () => {
    const s = script(textResponse('一つ目。'), textResponse('二つ目。'), textResponse('三つ目。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('最初の質問');
    await answersCount(m, 1);
    m.typeAndSend('続きの質問');
    await answersCount(m, 2);
    expect(s.body(1).messages).toHaveLength(3); // question, answer, follow-up

    expect(m.newBtn().textContent).toBe('新しい質問を始める');
    m.newBtn().click();
    expect(m.answers()).toHaveLength(0);
    expect(m.newBtn().hidden).toBe(true);
    expect(document.activeElement).toBe(m.textarea);

    m.typeAndSend('別の質問');
    await answersCount(m, 1);
    expect(s.body(2).messages).toEqual([{ role: 'user', content: '別の質問' }]);
  });

  it('a conversation too long to send: the message, and the new-conversation button is highlighted and focused', async () => {
    const three = [
      toolUse('t1', 'find_area', { query: 'x' }),
      toolUse('t2', 'find_area', { query: 'x' }),
      toolUse('t3', 'find_area', { query: 'x' }),
    ];
    const s = script(toolUseResponse(...three));
    const m = mount({ fetchFn: s.fetchFn }, makeContext(longNameData()));
    m.typeAndSend('長い質問');
    await answersCount(m, 1);

    expect(s.mock).toHaveBeenCalledTimes(1); // the second request would not fit, so it was never sent
    expect(m.answers()[0]!.textContent).toContain('会話が長くなりすぎました。新しい質問を始めてください。');
    expect(m.newBtn().hidden).toBe(false);
    expect(m.newBtn().classList.contains('is-attention')).toBe(true);
    expect(document.activeElement).toBe(m.newBtn());

    m.newBtn().click();
    expect(m.newBtn().classList.contains('is-attention')).toBe(false);
  });

  it('says quietly when old exchanges had to be left out', async () => {
    const one = () => toolUseResponse(toolUse('t1', 'find_area', { query: 'x' }));
    const s = script(one(), textResponse('一つ目。'), one(), textResponse('二つ目。'));
    const m = mount({ fetchFn: s.fetchFn }, makeContext(longNameData()));
    m.typeAndSend('一つ目');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('.ai-trimmed')).toBeNull();
    m.typeAndSend('二つ目');
    await answersCount(m, 2);
    // the second question's tool result (20,000 characters) no longer fits next to the first exchange, so ask() drops it
    expect(s.body(3).messages).toHaveLength(3);
    expect(m.answers()[0]!.querySelector('.ai-trimmed')!.textContent).toBe('古いやり取りは省略しました');
  });
});

describe('stopping', () => {
  it('やめる aborts the request, shows nothing, and returns the input to idle', async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const s = script(hangUntilAborted(seen));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('途中でやめる');
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));
    expect(m.cancelBtn().textContent).toBe('やめる');

    m.cancelBtn().click();
    await vi.waitFor(() => expect(m.submit.disabled).toBe(false));

    expect(seen.signal!.aborted).toBe(true);
    expect(m.answers()).toHaveLength(0);
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.cancelBtn().hidden).toBe(true);
    expect(m.textarea.readOnly).toBe(false);
    expect(m.samples().every((b) => !b.disabled)).toBe(true);
    expect(m.textarea.value).toBe('途中でやめる');
    expect(m.newBtn().hidden).toBe(true);
    expect(document.activeElement).toBe(m.submit); // the button that sent it (a phone would open its keyboard for the field)
  });

  it('a new question can be asked after stopping, and the stopped one is not in the conversation', async () => {
    const s = script(hangUntilAborted(), textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('やめる質問');
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));
    m.cancelBtn().click();
    await vi.waitFor(() => expect(m.submit.disabled).toBe(false));
    m.typeAndSend('次の質問');
    await answersCount(m, 1);
    expect(s.body(1).messages).toEqual([{ role: 'user', content: '次の質問' }]);
  });
});

describe('teardown', () => {
  it('the returned function aborts a pending request and removes the interface', async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const m = mount({ fetchFn: script(hangUntilAborted(seen)).fetchFn });
    m.typeAndSend('消える前の質問');
    await vi.waitFor(() => expect(seen.signal).toBeTruthy());

    m.destroy();
    expect(seen.signal!.aborted).toBe(true);
    expect(m.section.querySelector('.ai-panel')).toBeNull();
    expect(m.section.querySelectorAll('h2')).toHaveLength(1);
  });

  it('an answer that arrives after the teardown adds nothing, anywhere, and rejects nothing', async () => {
    let release!: (response: Response) => void;
    const s = script(() => new Promise<Response>((resolve) => (release = resolve))); // ignores the abort on purpose
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => void rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const m = mount({ fetchFn: s.fetchFn });
      const root = m.q('.ai-panel');
      m.typeAndSend('消えたあとに答えが届く');
      await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));

      m.destroy();
      release(textResponse('遅れて届いた答えです。'));
      await settle();
      await settle();
      await settle();

      expect(root.querySelector('.ai-answer')).toBeNull(); // the detached interface was left alone
      expect(m.section.querySelector('.ai-answer')).toBeNull();
      expect(m.section.textContent).not.toContain('遅れて届いた答え');
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('remounting after a teardown starts clean', () => {
    const first = mount();
    first.destroy();
    const second = mount({}, makeContext(), first.section);
    expect(second.section.querySelectorAll('.ai-panel')).toHaveLength(1);
  });
});

describe('model text is only ever text', () => {
  it('renders HTML in the answer, the question, an unknown tool name and a tool input as plain text', async () => {
    const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
    const s = script(
      toolUseResponse(toolUse('toolu_x', '<img src=x onerror=alert(1)>', { areaCode: '<script>alert(3)</script>' })),
      textResponse(hostile),
    );
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('<b>太字</b>？');
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.querySelector('.ai-answer-text')!.textContent).toBe(hostile);
    expect(article.querySelector('.ai-question')!.textContent).toContain('<b>太字</b>？');
    expect(m.section.querySelector('img, script, b, [onerror]')).toBeNull();
    expect(article.querySelector('.ai-trace-name')!.textContent).toBe('道具（<img src=x onerror=alert(1)>）');
    expect(article.querySelector('.ai-trace-input')!.textContent).toContain('<script>alert(3)</script>');
  });

  it('shows an unverified number that looks like HTML as text', async () => {
    const s = script(textResponse('東京は<i>9,999万</i>人です。'), textResponse('東京は<i>9,999万</i>人です。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('東京は？');
    await answersCount(m, 1);
    expect(m.section.querySelector('i')).toBeNull();
    expect(m.answers()[0]!.querySelector('.ai-warning')).not.toBeNull();
  });
});

describe('what the answer was built from', () => {
  it('lists every tool call in order with a label, the input on one line and the result as pretty JSON', async () => {
    const s = script(
      toolUseResponse(toolUse('a', 'find_area', { query: '田辺' }), toolUse('b', 'get_series', { areaCode: '30206', years: [2050] })),
      textResponse('見つけました。'),
    );
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('田辺市は？');
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.querySelector('details.ai-trace > summary')!.textContent).toContain('使った道具と数字');
    const items = [...article.querySelectorAll('.ai-trace-item')];
    expect(items.map((i) => i.querySelector('.ai-trace-name')!.textContent)).toEqual(['地域をさがす', '人口の推移を取る']);
    expect(items[1]!.querySelector('.ai-trace-input')!.textContent).toBe('{"areaCode":"30206","years":[2050]}');
    const result = items[1]!.querySelector('details.ai-trace-result')!;
    expect(result.querySelector('pre.ai-json')!.textContent).toContain('\n  "area"');
    expect(result.querySelector('button')!.textContent).toBe('コピー');
  });

  it('cuts a very long result at 4,000 characters in the display and keeps the whole text for copying', async () => {
    const s = script(toolUseResponse(toolUse('a', 'find_area', { query: 'x' })), textResponse('長い結果でした。'));
    const m = mount({ fetchFn: s.fetchFn }, makeContext(longNameData()));
    m.typeAndSend('長い？');
    await answersCount(m, 1);

    const shown = m.answers()[0]!.querySelector('pre.ai-json')!.textContent!;
    expect(shown.endsWith('…（以下省略）')).toBe(true);
    expect(shown.length).toBe(4000 + '…（以下省略）'.length);

    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    m.answers()[0]!.querySelector<HTMLButtonElement>('details.ai-trace-result button')!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]![0].length).toBeGreaterThan(4000 + 50);
    expect(m.answers()[0]!.querySelector('.ai-copy-status')!.textContent).toBe('コピーしました');
  });

  it('says so when copying is not possible', async () => {
    const s = script(toolUseResponse(toolUse('a', 'find_area', { query: '田辺' })), textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('田辺？');
    await answersCount(m, 1);
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    m.answers()[0]!.querySelector<HTMLButtonElement>('details.ai-trace-result button')!.click();
    await vi.waitFor(() => expect(m.answers()[0]!.querySelector('.ai-copy-status')!.textContent).toContain('コピーできませんでした'));
  });

});

describe('links back to the map and to the assumptions', () => {
  it('a place named in a tool input becomes 「<name>を地図で開く」 with no space and selects it on the map (the prefecture follows)', async () => {
    const s = script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '30206' })), textResponse('田辺市です。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('田辺市は？');
    await answersCount(m, 1);

    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-links button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['田辺市を地図で開く']);
    expect(buttons[0]!.hasAttribute('aria-label')).toBe(false); // the visible text is the name the button has
    expect(buttons[0]!.textContent).not.toMatch(/\s/);
    buttons[0]!.click();
    expect(m.ctx.store.get().selectedArea).toBe('30206');
    expect(m.ctx.store.get().selectedPref).toBe('30');
  });

  it('a name that two towns share carries its prefecture, still with no space before を', async () => {
    const twin = data.areas.find((a) => data.areas.some((b) => b !== a && b.name === a.name))!;
    const s = script(toolUseResponse(toolUse('a', 'get_series', { areaCode: twin.code })), textResponse('二つある名前です。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('その町は？');
    await answersCount(m, 1);
    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-links button')];
    expect(buttons.map((b) => b.textContent)).toEqual([`${twin.name}（${twin.prefName}）を地図で開く`]);
  });

  it('an assumption with hostile values from the model is shown short and does not break the answer', async () => {
    const hostile = { cwrMult: { toString: 1 }, migMode: 'あ'.repeat(300), migScale: [1, 2, 3], infraStrength: 'x'.repeat(500) };
    const s = script(toolUseResponse(toolUse('a', 'run_projection', { areaCode: '13', scenario: hostile })), textResponse('計算できませんでした。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('どうなりますか？');
    await answersCount(m, 1);

    const answer = m.answers()[0]!;
    expect(answer.querySelector('.ai-answer-text')!.textContent).toBe('計算できませんでした。'); // not the "could not draw it" notice
    expect(answer.textContent).not.toContain(PANEL_TEXT.crashed);
    const note = answer.querySelector('.ai-scenario .note')!.textContent!;
    expect(note).toBe(`この答えの前提：子どもの数の倍率 （数ではない値）、人口の移動 ${'あ'.repeat(23)}…、移動の強さ （数ではない値）、施設の影響 ${'x'.repeat(23)}…`);
    answer.querySelector<HTMLButtonElement>('button[data-role="apply-scenario"]')!.click();
    expect(answer.querySelector('.ai-scenario-msg')!.textContent).toBe(PANEL_TEXT.scenarioRefused); // and it is refused, as before
  });

  it('a prefecture code selects the prefecture and clears an area that is not in it', async () => {
    const ctx = makeContext();
    ctx.store.set({ selectedArea: '30206' });
    const s = script(toolUseResponse(toolUse('a', 'count_areas', { year: 2100, below: 3000, prefCode: '13' })), textResponse('数えました。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('東京都の小さな町は？');
    await answersCount(m, 1);
    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-links button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['東京都を地図で開く']);
    buttons[0]!.click();
    expect(ctx.store.get().selectedPref).toBe('13');
    expect(ctx.store.get().selectedArea).toBeUndefined();
  });

  it('offers at most three places, and none when no input names one', async () => {
    const s = script(
      toolUseResponse(
        toolUse('a', 'get_series', { areaCode: '30206' }),
        toolUse('b', 'get_series', { areaCode: '13101' }),
        toolUse('c', 'get_series', { areaCode: '13' }),
        toolUse('d', 'get_series', { areaCode: '30' }),
      ),
      textResponse('四か所です。'),
      textResponse('地名なし。'),
    );
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('四つ');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelectorAll('.ai-links button')).toHaveLength(3);
    m.typeAndSend('なし');
    await answersCount(m, 2);
    expect(m.answers()[0]!.querySelector('.ai-links')).toBeNull();
  });

  it('「この前提を画面に反映する」 applies a valid scenario through the store', async () => {
    const ctx = makeContext();
    const before = ctx.store.get().scenario;
    const s = script(toolUseResponse(toolUse('a', 'run_projection', { areaCode: '13', scenario: { cwrMult: 1.2 } })), textResponse('計算しました。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('出生が増えたら？');
    await answersCount(m, 1);

    const button = m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-scenario"]')!;
    expect(button.textContent).toBe('この前提を画面に反映する');
    expect(m.answers()[0]!.querySelector('.ai-scenario')!.textContent).toContain('子どもの数の倍率 1.2');
    button.click();
    expect(ctx.store.get().scenario).toEqual({ cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 });
    expect(ctx.store.get().scenario).not.toBe(before);
    expect(m.answers()[0]!.querySelector('.ai-scenario-msg')!.textContent).toContain('画面に反映しました');
  });

  it('refuses an out-of-range scenario with a message and leaves the store alone (Ruling 21)', async () => {
    const ctx = makeContext();
    const before = ctx.store.get().scenario;
    const s = script(toolUseResponse(toolUse('a', 'run_projection', { areaCode: '13', scenario: { cwrMult: 9 } })), textResponse('計算できませんでした。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('出生が9倍なら？');
    await answersCount(m, 1);

    m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-scenario"]')!.click();
    expect(ctx.store.get().scenario).toBe(before);
    expect(m.answers()[0]!.querySelector('.ai-scenario-msg')!.textContent).toContain('範囲外');
  });

  it('says when the screen already uses the scenario, and offers no button for the default one', async () => {
    const ctx = makeContext();
    ctx.store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    const s = script(
      toolUseResponse(toolUse('a', 'run_projection', { areaCode: '13', scenario: { cwrMult: 1.2 } })),
      textResponse('計算しました。'),
      toolUseResponse(toolUse('b', 'get_series', { areaCode: '13', scenario: {} })),
      textResponse('標準です。'),
    );
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('一');
    await answersCount(m, 1);
    m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-scenario"]')!.click();
    expect(m.answers()[0]!.querySelector('.ai-scenario-msg')!.textContent).toContain('すでに');
    m.typeAndSend('二');
    await answersCount(m, 2);
    expect(m.answers()[0]!.querySelector('button[data-role="apply-scenario"]')).toBeNull();
  });
});

describe('more than one assumption in an answer', () => {
  const calls = (...inputs: Array<Record<string, unknown>>): Response =>
    toolUseResponse(...inputs.map((scenario, i) => toolUse(`t${i}`, 'run_projection', { areaCode: '13', scenario })));

  it('offers each distinct scenario as its own button, labelled with what differs, at most three', async () => {
    const ctx = makeContext();
    const s = script(
      calls({ cwrMult: 1.2 }, { migMode: 'fade' }, { infraStrength: 0.0025 }, { migScale: 0.5 }, { cwrMult: 1.2 }),
      textResponse('四つの前提を計算しました。'),
    );
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('いくつかの前提で');
    await answersCount(m, 1);

    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('button[data-role="apply-scenario"]')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'この前提を画面に反映する（子どもの数の倍率 1.2）',
      'この前提を画面に反映する（人口の移動は少しずつ止まる）',
      'この前提を画面に反映する（施設の影響 0.0025）',
    ]);

    buttons[1]!.click();
    expect(ctx.store.get().scenario).toEqual({ cwrMult: 1, migMode: 'fade', migScale: 1, infraStrength: 0 });
    const messages = [...m.answers()[0]!.querySelectorAll('.ai-scenario-msg')].map((x) => x.textContent);
    expect(messages[0]).toBe('');
    expect(messages[1]).toContain('画面に反映しました');
    expect(messages[2]).toBe('');
  });

  it('a lone scenario keeps the plain label and shows what differs above it', async () => {
    const s = script(calls({ infraStrength: 0.0004 }), textResponse('計算しました。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('一つだけ');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('button[data-role="apply-scenario"]')!.textContent).toBe('この前提を画面に反映する');
    expect(m.answers()[0]!.querySelector('.ai-scenario')!.textContent).toContain('施設の影響 0.0004');
  });
});

describe('the map link brings the map into view on a phone', () => {
  const addMap = (top: number): HTMLElement => {
    const map = document.createElement('div');
    map.className = 'map-column';
    map.scrollIntoView = vi.fn();
    map.getBoundingClientRect = () => ({ top }) as DOMRect;
    document.body.append(map);
    return map;
  };

  it('scrolls the map column to the top when it is above the viewport', async () => {
    const map = addMap(-400);
    const m = mount({ fetchFn: script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '30206' })), textResponse('田辺市です。')).fetchFn });
    m.typeAndSend('田辺市は？');
    await answersCount(m, 1);
    m.answers()[0]!.querySelector<HTMLButtonElement>('.ai-links button')!.click();
    expect(map.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('leaves the page alone when the map is already in view, and when the selection did not change', async () => {
    const map = addMap(20);
    const m = mount({ fetchFn: script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '30206' })), textResponse('田辺市です。')).fetchFn });
    m.typeAndSend('田辺市は？');
    await answersCount(m, 1);
    const link = m.answers()[0]!.querySelector<HTMLButtonElement>('.ai-links button')!;
    link.click();
    expect(map.scrollIntoView).not.toHaveBeenCalled();
    (map.getBoundingClientRect as () => DOMRect) = () => ({ top: -400 }) as DOMRect;
    link.click(); // the same place again: the store reports no change
    expect(map.scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('saved answers that are slow to arrive', () => {
  const never = (): Promise<CachedAnswers | null> => new Promise(() => undefined);
  const fakeTimers = (): void => void vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const flush = async (ms = 0): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
  };

  it('shows the waiting status and 「やめる」 at once, and after the wait asks the Worker live', async () => {
    fakeTimers();
    const s = script(textResponse('一つ目。'), textResponse('二つ目。'));
    const m = mount({ fetchFn: s.fetchFn, cache: never() });
    m.samples()[1]!.click();

    expect(m.q('.ai-status-text').textContent).toBe(PANEL_TEXT.waiting); // before anything has been awaited
    expect(m.cancelBtn().hidden).toBe(false);
    expect(m.submit.disabled).toBe(true);
    expect(s.mock).not.toHaveBeenCalled();

    await flush(CACHE_WAIT_MS - 1);
    expect(s.mock).not.toHaveBeenCalled();
    await flush(1);
    expect(s.mock).toHaveBeenCalledTimes(1);
    await flush();
    expect(m.answers()).toHaveLength(1);
    expect(m.answers()[0]!.querySelector('.ai-answer-text')!.textContent).toBe('一つ目。');
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.submit.disabled).toBe(false);

    // the wait is not repeated: the saved answers are given up on for the later asks
    m.samples()[2]!.click();
    await flush();
    expect(s.mock).toHaveBeenCalledTimes(2);
    await flush();
    expect(m.answers()).toHaveLength(2);
  });

  it('a typed question waits the same way, with no request until the wait is over', async () => {
    fakeTimers();
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn, cache: never() });
    m.typeAndSend('入力した質問');
    expect(m.q('.ai-status-text').textContent).toBe(PANEL_TEXT.waiting);
    expect(m.cancelBtn().hidden).toBe(false);
    await flush(CACHE_WAIT_MS);
    expect(s.mock).toHaveBeenCalledTimes(1);
    await flush();
    expect(m.answers()).toHaveLength(1);
    expect(m.textarea.value).toBe('');
  });

  it('やめる during the wait returns the panel to idle without any request, and the next question is not blocked', async () => {
    fakeTimers();
    const s = script(textResponse('次の答え。'));
    const m = mount({ fetchFn: s.fetchFn, cache: never() });
    m.typeAndSend('途中でやめる質問');
    m.cancelBtn().click();
    await flush();

    expect(m.answers()).toHaveLength(0);
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.cancelBtn().hidden).toBe(true);
    expect(m.submit.disabled).toBe(false);
    expect(m.textarea.readOnly).toBe(false);
    expect(m.samples().every((b) => !b.disabled)).toBe(true);
    expect(m.textarea.value).toBe('途中でやめる質問');
    expect(m.newBtn().hidden).toBe(true);
    await flush(CACHE_WAIT_MS * 4);
    expect(s.mock).not.toHaveBeenCalled(); // the stopped question never goes out later

    m.submit.click(); // the same text again: not blocked, and it waits (and goes live) afresh
    await flush(CACHE_WAIT_MS);
    expect(s.mock).toHaveBeenCalledTimes(1);
    await flush();
    expect(m.answers()).toHaveLength(1);
  });

  it('a teardown during the wait sends nothing afterwards', async () => {
    fakeTimers();
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn, cache: never() });
    m.typeAndSend('消える質問');
    m.destroy();
    await flush(CACHE_WAIT_MS * 4);
    expect(s.mock).not.toHaveBeenCalled();
    expect(m.section.querySelector('.ai-panel')).toBeNull();
  });

  it('saved answers that arrive during the wait are used: the answer appears without a request', async () => {
    fakeTimers();
    const s = script(textResponse('使われない。'));
    const late = new Promise<CachedAnswers | null>((resolve) => setTimeout(() => resolve(cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。'))), 500));
    const m = mount({ fetchFn: s.fetchFn, cache: late });
    m.samples()[0]!.click();
    expect(m.q('.ai-status-text').textContent).toBe(PANEL_TEXT.waiting);
    await flush(500);
    await flush();
    expect(s.mock).not.toHaveBeenCalled();
    expect(m.answers()).toHaveLength(1);
    expect(m.answers()[0]!.querySelector('[data-role="saved-badge"]')).not.toBeNull();
    expect(m.q('.ai-status-text').textContent).toBe('');
    expect(m.cancelBtn().hidden).toBe(true);
  });

  it('saved answers that arrive after the wait are used by the later asks', async () => {
    fakeTimers();
    const s = script(textResponse('一つ目。'));
    let arrive!: (cache: CachedAnswers | null) => void;
    const m = mount({ fetchFn: s.fetchFn, cache: new Promise<CachedAnswers | null>((resolve) => (arrive = resolve)) });
    m.samples()[1]!.click();
    await flush(CACHE_WAIT_MS);
    await flush();
    expect(m.answers()).toHaveLength(1);

    arrive(cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')));
    await flush();
    m.samples()[0]!.click();
    await flush();
    expect(s.mock).toHaveBeenCalledTimes(1); // no second request: the saved answer was served
    expect(m.answers()).toHaveLength(2);
    expect(m.answers()[0]!.querySelector('[data-role="saved-badge"]')).not.toBeNull();
  });

  it('a saved-answers load that fails does not block anything', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn, cache: Promise.reject(new Error('offline')) });
    await settle();
    m.samples()[1]!.click();
    await answersCount(m, 1);
    expect(s.mock).toHaveBeenCalledTimes(1);
  });

  it('a saved entry that is still pending is never served: the question goes live', async () => {
    const s = script(textResponse('生の答えです。'));
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '', { status: 'pending' })) });
    await settle();
    m.samples()[0]!.click();
    await answersCount(m, 1);
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(m.answers()[0]!.querySelector('.ai-answer-text')!.textContent).toBe('生の答えです。');
    expect(m.answers()[0]!.querySelector('[data-role="saved-badge"]')).toBeNull();
  });
});

describe('keyboard focus while asking', () => {
  it('a keyboard send keeps focus on the field; やめる is one Tab away and a repeated key does not abort', async () => {
    let release!: (response: Response) => void;
    const s = script(() => new Promise<Response>((resolve) => (release = resolve)));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.focus();
    m.sendWithShortcut('キーボードで送る');
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));

    expect(document.activeElement).toBe(m.textarea);
    expect(m.cancelBtn().hidden).toBe(false);
    expect(m.cancelBtn().tabIndex).toBeGreaterThanOrEqual(0);
    m.textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, repeat: true, bubbles: true, cancelable: true }));
    expect(m.cancelBtn().hidden).toBe(false);
    expect(s.mock).toHaveBeenCalledTimes(1);

    release(textResponse('はい。'));
    await answersCount(m, 1);
    expect(document.activeElement).toBe(m.textarea);
  });

  it('a sample click moves focus off the button that is about to be disabled and puts it back when the answer is in', async () => {
    let release!: (response: Response) => void;
    const s = script(() => new Promise<Response>((resolve) => (release = resolve)));
    const m = mount({ fetchFn: s.fetchFn });
    const button = m.samples()[2]!;
    button.focus();
    button.click();
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));
    expect(document.activeElement).toBe(m.q('.ai-status-text'));
    expect(document.activeElement).not.toBe(m.cancelBtn());

    release(textResponse('はい。'));
    await answersCount(m, 1);
    expect(document.activeElement).toBe(button);
  });

  it('focus the visitor has moved elsewhere is left alone when the answer arrives', async () => {
    let release!: (response: Response) => void;
    const s = script(() => new Promise<Response>((resolve) => (release = resolve)));
    const m = mount({ fetchFn: s.fetchFn });
    m.textarea.focus();
    m.sendWithShortcut('待つ');
    await vi.waitFor(() => expect(s.mock).toHaveBeenCalledTimes(1));
    m.cancelBtn().focus();
    m.cancelBtn().blur();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    elsewhere.focus();
    release(textResponse('はい。'));
    await answersCount(m, 1);
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('growth limits', () => {
  it('keeps at most 20 answers: the oldest drops off the page', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => textResponse('はい。'));
    const m = mount({ fetchFn });
    for (let i = 0; i < MAX_ANSWERS + 1; i++) {
      m.typeAndSend(`質問${i}`);
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(i + 1));
      await vi.waitFor(() => expect(m.submit.disabled).toBe(false));
    }
    expect(MAX_ANSWERS).toBe(20);
    expect(m.answers()).toHaveLength(20);
    expect(m.answers()[0]!.querySelector('.ai-question')!.textContent).toContain('質問20');
    expect(m.answers()[19]!.querySelector('.ai-question')!.textContent).toContain('質問1');
    expect(m.section.textContent).not.toContain('質問0はい'); // the first one is gone
  });

  it('cuts a very long tool input at 4,000 characters like a result', async () => {
    const note = 'あ'.repeat(5000);
    const s = script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '30206', years: [2050], note })), textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('長い入力');
    await answersCount(m, 1);
    const shown = m.answers()[0]!.querySelector('.ai-trace-input')!.textContent!;
    expect(shown.endsWith('…（以下省略）')).toBe(true);
    expect(shown.length).toBe(4000 + '…（以下省略）'.length);
  });
});

describe('when drawing an answer fails', () => {
  it('shows the plain error, keeps the panel usable, and does not put the unseen answer in the conversation', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      answer: '表示できない答え',
      get trace(): never {
        throw new Error('render boom: secret detail');
      },
      unverified: [],
      fromCache: false,
      status: 'ok',
      messages: [
        { role: 'user', content: '壊れる表示' },
        { role: 'assistant', content: [{ type: 'text', text: '表示できない答え' }] },
      ],
    } as unknown as AskResult;
    vi.mocked(ask).mockResolvedValueOnce(broken);
    const s = script(textResponse('次の答えです。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('壊れる表示');
    await answersCount(m, 1);

    expect(m.answers()[0]!.textContent).toContain(PANEL_TEXT.crashed);
    expect(m.answers()[0]!.textContent).not.toContain('boom');
    expect(m.section.textContent).not.toContain('表示できない答え');
    expect(m.submit.disabled).toBe(false);
    expect(m.textarea.readOnly).toBe(false);
    expect(logged).toHaveBeenCalled();

    m.typeAndSend('次の質問');
    await answersCount(m, 2);
    expect(s.body(0).messages).toEqual([{ role: 'user', content: '次の質問' }]); // the broken exchange is not in it
  });
});

describe('wording', () => {
  const forbidden = /残せない|予測する|予測します|残すべき|残さない|諦め|閉鎖|やめるべき|守るべき|切り捨て/;

  it('no message the panel can show tells anyone what to keep or give up, or calls a 2050+ number a 予測', async () => {
    for (const [name, text] of Object.entries(PANEL_TEXT)) {
      expect(text, name).not.toMatch(forbidden);
      expect(text.replace(/予測ではありません/g, ''), name).not.toContain('予測');
      expect(text, name).not.toMatch(/[\u2460-\u2473]/);
    }
  });

  it('nor does any state it renders: saved, unverified, failed, refused and applied', async () => {
    const ctx = makeContext();
    const s = script(
      toolUseResponse(toolUse('a', 'get_series', { areaCode: '13' })),
      textResponse('東京都は2100年に約2,500万人です。'),
      textResponse('東京都は2100年に約2,600万人です。'),
      toolUseResponse(toolUse('b', 'run_projection', { areaCode: '13', scenario: { cwrMult: 9 } })),
      textResponse('計算できませんでした。'),
      jsonResponse({ error: 'rate_limited', cached: true }, 429),
    );
    const m = mount({ fetchFn: s.fetchFn, cache: cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。')) }, ctx);
    await settle();
    m.samples()[0]!.click(); // saved
    await answersCount(m, 1);
    m.typeAndSend('数字は？'); // unverified (twice)
    await answersCount(m, 2);
    m.typeAndSend('九倍なら？'); // out-of-range scenario
    await answersCount(m, 3);
    m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-scenario"]')!.click();
    m.typeAndSend('もう一つ'); // unavailable
    await answersCount(m, 4);
    input2(m, 'あ'.repeat(300)); // the 200-character notice

    const text = m.section.textContent!;
    expect(text).toContain('範囲外');
    expect(text).toContain(PANEL_TEXT.limitCut);
    expect(text).not.toMatch(forbidden);
    expect(text.replace(/予測ではありません/g, '')).not.toContain('予測');
  });

  function input2(m: Mounted, value: string): void {
    m.textarea.value = value;
    m.textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
});

describe('endpoint', () => {
  it('uses the endpoint option when given', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn, endpoint: 'https://worker.example.test/api/chat' });
    m.typeAndSend('どこへ？');
    await answersCount(m, 1);
    expect(String(s.mock.mock.calls[0]![0])).toBe('https://worker.example.test/api/chat');
  });
});

describe('run uses the shared runner', () => {
  it('the tools run on the app\'s runner, so no scenario is computed twice', async () => {
    const run = vi.spyOn(runner, 'run');
    const s = script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '13' })), textResponse(GOOD_TOKYO_ANSWER));
    const m = mount({ fetchFn: s.fetchFn });
    m.samples()[0]!.click();
    await answersCount(m, 1);
    expect(run).toHaveBeenCalled();
  });
});

describe('この割り振りを地図に反映する (run_allocation in the trace)', () => {
  const allocationCall = (input: Record<string, unknown>): Response => toolUseResponse(toolUse('a', 'run_allocation', input));

  it('offers a button that recomputes the allocation from the tool input and puts it on the map', async () => {
    const ctx = makeContext();
    const s = script(allocationCall({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 }), textResponse('和歌山県を1割増やすと、ほかが少し減ります。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('和歌山を増やしたら？');
    await answersCount(m, 1);

    const button = m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-allocation"]')!;
    expect(button.textContent).toBe(PANEL_TEXT.allocationButton);
    expect(ctx.store.get().allocation).toBeUndefined();
    button.click();
    const a = ctx.store.get().allocation!;
    expect(a.year).toBe(2100);
    expect(ctx.store.get().year).toBe(2100); // the map moves to the allocation's year
    expect(a.label).toBe('和歌山県 +10%');
    expect(a.changePercent['30206']).toBeCloseTo(10, 3);
    expect(a.flips.find((f) => f.facilityId === 'grocery')?.gained).toContain('30344');
    const msg = m.answers()[0]!.querySelector('.ai-allocations .ai-scenario-msg')!;
    expect(msg.textContent).toBe(PANEL_TEXT.allocationApplied);
    expect(msg.getAttribute('role')).toBe('status');
  });

  it('an allocation computed under other assumptions brings them along in the same change, and says so', async () => {
    const ctx = makeContext();
    const input = { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario: { cwrMult: 1.2 } };
    const s = script(allocationCall(input), textResponse('前提を変えて計算しました。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('出生率が高いと？');
    await answersCount(m, 1);
    const button = m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-allocation"]')!;
    expect(button.textContent).toBe(`${PANEL_TEXT.allocationButton}${PANEL_TEXT.allocationScenarioHint}`); // no surprise
    button.click();
    expect(ctx.store.get().scenario).toEqual({ cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 });
    expect(button.textContent).toBe(PANEL_TEXT.allocationButton); // the screen now has those assumptions
    expect(ctx.store.get().allocation?.label).toBe('和歌山県 +10%'); // not cleared by its own scenario change
    expect(m.answers()[0]!.querySelector('.ai-allocations .ai-scenario-msg')!.textContent).toBe(
      `${PANEL_TEXT.allocationApplied}${PANEL_TEXT.allocationScenario}（子どもの数の倍率 1.2）。`,
    );
    ctx.store.set({ scenario: { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    expect(button.textContent).toBe(`${PANEL_TEXT.allocationButton}${PANEL_TEXT.allocationScenarioHint}`); // and back
  });

  it('offers nothing for a call the tool refused (there is no allocation to draw)', async () => {
    const ctx = makeContext();
    const s = script(allocationCall({ target: { kind: 'pref', code: '99' }, deltaPercent: 10, year: 2100 }), textResponse('できませんでした。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('どこか');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('.ai-trace')).not.toBeNull(); // the call is in the trace
    expect(m.answers()[0]!.querySelector('button[data-role="apply-allocation"]')).toBeNull();
  });

  it('a saved answer whose input cannot be reproduced is refused in Japanese, as text, and the store is left alone', async () => {
    const ctx = makeContext();
    const forged = { target: { kind: 'pref', code: '<img src=x onerror=alert(1)>' }, deltaPercent: 10, year: 2100 };
    const entry = savedEntry(TOKYO_QUESTION, '保存済みの答えです。', { trace: [{ tool: 'run_allocation', input: forged, result: { year: 2100 } }] });
    const m = mount({ cache: cacheOf(entry) }, ctx);
    m.samples()[0]!.click();
    await answersCount(m, 1);
    m.answers()[0]!.querySelector<HTMLButtonElement>('button[data-role="apply-allocation"]')!.click();
    expect(ctx.store.get().allocation).toBeUndefined();
    expect(ctx.store.get().year).toBe(2050);
    const msg = m.answers()[0]!.querySelector('.ai-allocations .ai-scenario-msg')!;
    expect(msg.textContent).toContain('<img src=x o…');
    expect(msg.textContent).toContain('地図に反映できません');
    expect(msg.children).toHaveLength(0); // the model's text never becomes markup
    expect(m.section.querySelector('img')).toBeNull();
  });

  it('hostile assumptions in a saved allocation call: the answer is still drawn, and the button refuses in Japanese instead of throwing', async () => {
    const ctx = makeContext();
    const hostile = { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario: { cwrMult: { toString: 1 }, migMode: 'x'.repeat(100) } };
    const entry = savedEntry(TOKYO_QUESTION, '保存済みの答えです。', { trace: [{ tool: 'run_allocation', input: hostile, result: { year: 2100 } }] });
    const m = mount({ cache: cacheOf(entry) }, ctx);
    m.samples()[0]!.click();
    await answersCount(m, 1);
    const answer = m.answers()[0]!;
    expect(answer.querySelector('.ai-answer-text')!.textContent).toBe('保存済みの答えです。'); // drawn, not the "could not draw" notice
    expect(answer.textContent).not.toContain(PANEL_TEXT.crashed);
    const button = answer.querySelector<HTMLButtonElement>('button[data-role="apply-allocation"]')!;
    expect(button.textContent).toBe(PANEL_TEXT.allocationButton); // no "assumptions change too" hint for what cannot be read
    const errors: unknown[] = [];
    const record = (event: ErrorEvent): void => void errors.push(event.error);
    window.addEventListener('error', record);
    button.click();
    window.removeEventListener('error', record);
    expect(errors).toEqual([]);
    expect(ctx.store.get().allocation).toBeUndefined();
    expect(answer.querySelector('.ai-allocations .ai-scenario-msg')!.textContent).not.toBe('');
  });

  describe('the allocation buttons of answers that left the page', () => {
    const OTHER = { cwrMult: 1.2, migMode: 'hold' as const, migScale: 1, infraStrength: 0 };
    const withOtherAssumptions = (): CachedAnswers => {
      const input = { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario: { cwrMult: 1.2 } };
      return cacheOf(savedEntry(TOKYO_QUESTION, '保存済みの答えです。', { trace: [{ tool: 'run_allocation', input, result: { year: 2100 } }] }));
    };
    const hinted = `${PANEL_TEXT.allocationButton}${PANEL_TEXT.allocationScenarioHint}`;
    const askSaved = async (m: Mounted, times: number): Promise<void> => {
      for (let i = 0; i < times; i++) {
        const newest = m.answers()[0];
        m.samples()[0]!.click();
        await vi.waitFor(() => expect(m.answers()[0]).not.toBe(newest));
        await vi.waitFor(() => expect(m.submit.disabled).toBe(false));
      }
    };
    const buttons = (m: Mounted) => m.qa<HTMLButtonElement>('button[data-role="apply-allocation"]');

    it('only the buttons still on the page follow the screen\'s assumptions; one that was trimmed off the page is left as it was', async () => {
      const ctx = makeContext();
      const m = mount({ cache: withOtherAssumptions() }, ctx);
      m.samples()[0]!.click();
      await answersCount(m, 1);
      const first = buttons(m)[0]!;
      expect(first.textContent).toBe(hinted);
      await askSaved(m, MAX_ANSWERS); // the first answer is now the 21st: trimmed
      expect(first.isConnected).toBe(false);
      expect(buttons(m)).toHaveLength(MAX_ANSWERS);

      ctx.store.set({ scenario: OTHER }); // the screen now has the assumptions the buttons would bring
      expect(buttons(m).every((b) => b.textContent === PANEL_TEXT.allocationButton)).toBe(true);
      expect(first.textContent).toBe(hinted); // not repainted: it is no longer part of the panel
      ctx.store.set({ scenario: { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 } });
      expect(buttons(m).every((b) => b.textContent === hinted)).toBe(true);
    });

    it('a new conversation clears the answers and their buttons; the next answer\'s button is still repainted', async () => {
      const ctx = makeContext();
      const m = mount({ cache: withOtherAssumptions() }, ctx);
      m.samples()[0]!.click();
      await answersCount(m, 1);
      const old = buttons(m)[0]!;
      m.newBtn().click();
      expect(buttons(m)).toHaveLength(0);
      m.samples()[0]!.click();
      await answersCount(m, 1);
      ctx.store.set({ scenario: OTHER });
      expect(buttons(m)[0]!.textContent).toBe(PANEL_TEXT.allocationButton);
      expect(old.textContent).toBe(hinted);
    });

    it('the panel holds on to no button once its answer has left the page', async () => {
      v8.setFlagsFromString('--expose-gc');
      const gc = vm.runInNewContext('gc') as () => void;
      const m = mount({ cache: withOtherAssumptions() });
      m.samples()[0]!.click();
      await answersCount(m, 1);
      const ref = new WeakRef(buttons(m)[0]!);
      await askSaved(m, MAX_ANSWERS); // trims the first answer off the page
      expect(ref.deref()?.isConnected).toBe(false); // still alive for a moment: nothing has collected it yet
      for (let i = 0; i < 10 && ref.deref() !== undefined; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        gc();
      }
      expect(ref.deref()).toBeUndefined();
    });
  });

  it('offers nothing when no run_allocation was used, and numbers each button when several were', async () => {
    const ctx = makeContext();
    const s = script(
      toolUseResponse(toolUse('a', 'get_series', { areaCode: '13' })),
      textResponse(GOOD_TOKYO_ANSWER),
      toolUseResponse(
        toolUse('b', 'run_allocation', { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 }),
        toolUse('c', 'run_allocation', { target: { kind: 'pref', code: '13' }, deltaPercent: -5, year: 2100 }),
      ),
      textResponse('二つ計算しました。'),
    );
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('一');
    await answersCount(m, 1);
    expect(m.answers()[0]!.querySelector('button[data-role="apply-allocation"]')).toBeNull();
    m.typeAndSend('二');
    await answersCount(m, 2);
    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('button[data-role="apply-allocation"]')];
    expect(buttons.map((b) => b.textContent)).toEqual([`${PANEL_TEXT.allocationButton}（1件目）`, `${PANEL_TEXT.allocationButton}（2件目）`]);
    buttons[1]!.click();
    expect(ctx.store.get().allocation?.label).toBe('東京都 −5%');
  });
});
