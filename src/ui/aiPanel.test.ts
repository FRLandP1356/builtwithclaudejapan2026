// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { repoPath } from '../../test/helpers/paths';
import { ask } from '../ai/client';
import type { Message } from '../ai/client';
import { SAMPLE_QUESTIONS } from '../ai/cached';
import type { CachedAnswer, CachedAnswers } from '../ai/cached';
import type { AppData } from '../data/loader';
import type { Groups } from '../engine/types';
import { createRunner } from '../data/runner';
import type { Runner } from '../data/runner';
import { mountAIPanel } from './aiPanel';
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

afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------------------------------------------

describe('mount', () => {
  it('keeps the shell heading, adds the intro and the quiet line about 2050, and lists the five sample questions', () => {
    const m = mount();
    expect(m.section.querySelectorAll('h2')).toHaveLength(1);
    expect(m.section.querySelector('h2')!.textContent).toBe('AIに質問');
    const text = m.section.textContent!;
    expect(text).toContain('日本語で質問すると、Claudeが計算の結果を引いて答えます。答えの数字は、計算の結果からだけ引いています。');
    expect(text).toContain('2050年より後の数字は、このアプリの試算です');
    expect(m.samples().map((b) => b.textContent)).toEqual(SAMPLE_QUESTIONS);
  });

  it('has a labelled textarea limited to 200 characters with a visible counter, and a 質問する button', () => {
    const m = mount();
    const label = m.q<HTMLLabelElement>(`label[for="${m.textarea.id}"]`);
    expect(label.textContent).toContain('質問');
    expect(m.textarea.maxLength).toBe(200);
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
  });

  it('keeps the hidden attribute in force on buttons (.btn sets display, which would show a hidden button)', () => {
    const css = readFileSync(repoPath('src/ui/aiPanel.css'), 'utf8');
    expect(css).toMatch(/\.ai-panel \[hidden\]\s*\{\s*display:\s*none/);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // tokens only, no raw colours
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

  it('enforces 200 characters: maxlength on the field, and a refusal if more gets in', async () => {
    const s = script(textResponse('はい。'));
    const m = mount({ fetchFn: s.fetchFn });
    expect(m.textarea.getAttribute('maxlength')).toBe('200');

    m.typeAndSend('あ'.repeat(201));
    expect(m.q('.ai-input-msg').textContent).toBe('質問は200文字までにしてください。');
    expect(m.q('.ai-counter').textContent).toBe('201 / 200');
    await settle();
    expect(s.mock).not.toHaveBeenCalled();

    m.typeAndSend('あ'.repeat(200));
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

describe('when the AI cannot be reached', () => {
  it('429 with cached:true: the message and the sample questions again, below it', async () => {
    const s = script(jsonResponse({ error: 'rate_limited', cached: true }, 429));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('どこかの町は？');
    await answersCount(m, 1);

    const article = m.answers()[0]!;
    expect(article.textContent).toContain('いまはAIに接続できません。保存済みの質問を試してください。');
    const again = [...article.querySelectorAll<HTMLButtonElement>('.ai-fail-samples button')];
    expect(again.map((b) => b.textContent)).toEqual(SAMPLE_QUESTIONS);
    expect(article.querySelector('.ai-trace')).toBeNull();
    expect(m.textarea.value).toBe('どこかの町は？'); // kept for another try
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

  it('a request the Worker refuses (403) is an error with the sample questions', async () => {
    const m = mount({ fetchFn: script(jsonResponse({ error: 'origin_not_allowed' }, 403)).fetchFn });
    m.typeAndSend('どこ？');
    await answersCount(m, 1);
    expect(m.answers()[0]!.textContent).toContain('AIへの問い合わせでエラーが起きました');
    expect(m.answers()[0]!.querySelectorAll('.ai-fail-samples button')).toHaveLength(5);
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
    expect(document.activeElement).toBe(m.textarea);
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
  it('the returned function aborts a pending request and removes the interface; a late answer changes nothing', async () => {
    const seen: { signal?: AbortSignal | null } = {};
    const m = mount({ fetchFn: script(hangUntilAborted(seen)).fetchFn });
    m.typeAndSend('消える前の質問');
    await vi.waitFor(() => expect(seen.signal).toBeTruthy());

    m.destroy();
    expect(seen.signal!.aborted).toBe(true);
    expect(m.section.querySelector('.ai-panel')).toBeNull();
    expect(m.section.querySelectorAll('h2')).toHaveLength(1);
    await settle();
    expect(m.section.querySelector('.ai-panel')).toBeNull();
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
  it('a place named in a tool input becomes 「<name> を地図で開く」 and selects it on the map (the prefecture follows)', async () => {
    const s = script(toolUseResponse(toolUse('a', 'get_series', { areaCode: '30206' })), textResponse('田辺市です。'));
    const m = mount({ fetchFn: s.fetchFn });
    m.typeAndSend('田辺市は？');
    await answersCount(m, 1);

    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-links button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['田辺市 を地図で開く']);
    buttons[0]!.click();
    expect(m.ctx.store.get().selectedArea).toBe('30206');
    expect(m.ctx.store.get().selectedPref).toBe('30');
  });

  it('a prefecture code selects the prefecture and clears an area that is not in it', async () => {
    const ctx = makeContext();
    ctx.store.set({ selectedArea: '30206' });
    const s = script(toolUseResponse(toolUse('a', 'count_areas', { year: 2100, below: 3000, prefCode: '13' })), textResponse('数えました。'));
    const m = mount({ fetchFn: s.fetchFn }, ctx);
    m.typeAndSend('東京都の小さな町は？');
    await answersCount(m, 1);
    const buttons = [...m.answers()[0]!.querySelectorAll<HTMLButtonElement>('.ai-links button')];
    expect(buttons.map((b) => b.textContent)).toEqual(['東京都 を地図で開く']);
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
