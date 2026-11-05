import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, MAX_MESSAGES, MAX_TOTAL_TEXT_CHARS, validateChatBody } from '../../worker/validate';
import { makeEngineContext } from '../../test/helpers/engineContext';
import { ask, CLIENT_LIMITS, forgetAnsweredEndpoints, formatToolResult, MAX_TOOL_RESULT_CHARS, measureRequest, MSG_NOT_AVAILABLE } from './client';
import type { AskOptions, AskResult, Block, Message } from './client';
import { SAMPLE_QUESTIONS } from './cached';
import type { CachedAnswer, CachedAnswers } from './cached';
import { checkNumbers } from './numberCheck';
import { runTool } from './tools';

// runTool stays the real thing; one test makes it throw once to prove the client contains the failure.
vi.mock('./tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools')>();
  return { ...actual, runTool: vi.fn(actual.runTool) };
});

const ctx = makeEngineContext();

// Every test starts as a fresh page: the client remembers which addresses have answered (see "once the page has had an answer").
beforeEach(() => {
  forgetAnsweredEndpoints();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKYO_QUESTION = '日本の人口が減り出してから、東京はどうなっていますか？';
/** The AI is down and there is a verified saved answer to look at. */
const UNAVAILABLE = 'いまはAIに接続できません。保存済みの質問を試してください。';
/** The AI is down and no saved answer is verified, so none is mentioned. */
const TRY_LATER = 'いまはAIに接続できません。時間をおいて、もう一度お試しください。';

// ---------------------------------------------------------------------------------------------------------------
// A scripted model behind a fake fetch. Nothing here touches the network.
// ---------------------------------------------------------------------------------------------------------------

type Step = Response | Error | ((init: RequestInit | undefined) => Response | Promise<Response>);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** An Anthropic-shaped Messages response. Extra fields are on purpose: the client must not send them back. */
function modelResponse(content: unknown[], stopReason: string): Response {
  return jsonResponse({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

const textResponse = (text: string, stopReason = 'end_turn'): Response =>
  modelResponse([{ type: 'text', text }], stopReason);

function toolUse(id: string, name: string, input: unknown): Record<string, unknown> {
  return { type: 'tool_use', id, name, input };
}

const toolUseResponse = (...calls: Array<Record<string, unknown>>): Response => modelResponse(calls, 'tool_use');

interface Script {
  fetchFn: typeof fetch;
  mock: ReturnType<typeof vi.fn<typeof fetch>>;
  /** The JSON body of request n (0-based), as it was when the request was made. */
  body: (n: number) => { messages: Message[] } & Record<string, unknown>;
  init: (n: number) => RequestInit;
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
  return {
    fetchFn: mock,
    mock,
    body: (n) => JSON.parse(mock.mock.calls[n]![1]!.body as string),
    init: (n) => mock.mock.calls[n]![1]!,
  };
}

/** Every request must be one the real Worker would accept unchanged (nothing stripped, nothing rejected). */
function expectWorkerAccepts(s: Script): void {
  for (let n = 0; n < s.mock.mock.calls.length; n++) {
    const body = s.body(n);
    const checked = validateChatBody(body);
    expect(checked.ok, `request ${n} rejected by worker/validate.ts`).toBe(true);
    if (checked.ok) expect(checked.value).toEqual(body);
  }
}

function verifiedEntry(overrides: Partial<CachedAnswer> = {}): CachedAnswer {
  return {
    id: 'q1',
    question: TOKYO_QUESTION,
    answer: '保存済みの答えです。',
    trace: [{ tool: 'get_series', input: { areaCode: '13' }, result: { rows: [] } }],
    status: 'verified',
    generatedAt: '2026-11-06T00:00:00Z',
    ...overrides,
  };
}
const cacheOf = (...answers: CachedAnswer[]): CachedAnswers => ({ version: 1, answers });

/** A good Tokyo answer: every number is in the get_series result for area 13. */
const GOOD_TOKYO_ANSWER =
  '東京都の人口は、2020年に約1,405万人、2050年に約1,440万人です。2100年は、このアプリの試算で約1,190万人になります。65歳以上の割合は2100年に30.7%です。';

function userText(m: Message): string {
  expect(typeof m.content).toBe('string');
  return m.content as string;
}

// ---------------------------------------------------------------------------------------------------------------

describe('request contract', () => {
  it('posts_exactly_messages_to_the_default_endpoint_with_only_a_content_type_header', async () => {
    const s = script(textResponse('はい。'));
    const result = await ask('こんにちは', ctx, { fetchFn: s.fetchFn });

    expect(result.status).toBe('ok');
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(String(s.mock.mock.calls[0]![0])).toBe('/api/chat');
    const init = s.init(0);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.credentials).toBe('omit');
    expect(Object.keys(s.body(0))).toEqual(['messages']);
    expect(s.body(0).messages).toEqual([{ role: 'user', content: 'こんにちは' }]);
  });

  it('never_sends_tools_system_or_model_even_after_tool_rounds', async () => {
    const s = script(toolUseResponse(toolUse('toolu_01', 'find_area', { query: '東京' })), textResponse('はい。'));
    await ask('東京', ctx, { fetchFn: s.fetchFn });
    for (const n of [0, 1]) expect(Object.keys(s.body(n))).toEqual(['messages']);
  });

  it('uses_a_custom_endpoint', async () => {
    const s = script(textResponse('はい。'));
    await ask('こんにちは', ctx, { fetchFn: s.fetchFn, endpoint: 'https://worker.example.test/api/chat' });
    expect(String(s.mock.mock.calls[0]![0])).toBe('https://worker.example.test/api/chat');
  });

  it('falls_back_to_the_global_fetch_when_no_fetchFn_is_given', async () => {
    const globalFetch = vi.fn<typeof fetch>(async () => textResponse('はい。'));
    vi.stubGlobal('fetch', globalFetch);
    try {
      const result = await ask('こんにちは', ctx);
      expect(result.answer).toBe('はい。');
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('passes_the_abort_signal_to_fetch', async () => {
    const s = script(textResponse('はい。'));
    const controller = new AbortController();
    await ask('こんにちは', ctx, { fetchFn: s.fetchFn, signal: controller.signal });
    expect(s.init(0).signal).toBe(controller.signal);
  });
});

describe('tool loop', () => {
  it('one_round: runs the requested tool for real and sends its result back as a tool_result', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_01', 'find_area', { query: '田辺' })),
      textResponse('田辺市が見つかりました。'),
    );
    const result = await ask('田辺市を探して', ctx, { fetchFn: s.fetchFn });

    const expected = runTool('find_area', { query: '田辺' }, ctx);
    expect(result.trace).toEqual([{ tool: 'find_area', input: { query: '田辺' }, result: expected }]);
    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(s.body(1).messages).toEqual([
      { role: 'user', content: '田辺市を探して' },
      { role: 'assistant', content: [toolUse('toolu_01', 'find_area', { query: '田辺' })] },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: JSON.stringify(expected) }],
      },
    ]);
    expect(result.answer).toBe('田辺市が見つかりました。');
    expect(result.status).toBe('ok');
    expect(result.fromCache).toBe(false);
    expectWorkerAccepts(s);
  });

  it('two_rounds: find_area then get_series using the code from the first result', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_a', 'find_area', { query: '田辺市' })),
      toolUseResponse(toolUse('toolu_b', 'get_series', { areaCode: '30206', years: [2050] })),
      textResponse('2050年の人口は、計算の結果では約4.2万人です。'),
    );
    const result = await ask('田辺市の2050年の人口は？', ctx, { fetchFn: s.fetchFn });

    expect(s.mock).toHaveBeenCalledTimes(3);
    expect(result.trace.map((t) => t.tool)).toEqual(['find_area', 'get_series']);
    expect(result.trace[1]!.result).toEqual(runTool('get_series', { areaCode: '30206', years: [2050] }, ctx));
    // the third request carries both exchanges, in order
    const roles = s.body(2).messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
    expectWorkerAccepts(s);
  });

  it('parallel_tool_use: every tool_use block in one response is executed and answered in one user message', async () => {
    const s = script(
      toolUseResponse(
        toolUse('toolu_1', 'get_series', { areaCode: '13', years: [2020] }),
        toolUse('toolu_2', 'get_series', { areaCode: '27', years: [2020] }),
        toolUse('toolu_3', 'find_area', { query: '和歌山' }),
      ),
      textResponse('比べました。'),
    );
    const result = await ask('東京と大阪を比べて', ctx, { fetchFn: s.fetchFn });

    expect(result.trace.map((t) => t.tool)).toEqual(['get_series', 'get_series', 'find_area']);
    const toolResults = s.body(1).messages[2]!.content as Array<{ type: string; tool_use_id: string; content: string }>;
    expect(toolResults.map((b) => b.tool_use_id)).toEqual(['toolu_1', 'toolu_2', 'toolu_3']);
    expect(toolResults.every((b) => b.type === 'tool_result')).toBe(true);
    expect(JSON.parse(toolResults[0]!.content)).toEqual(runTool('get_series', { areaCode: '13', years: [2020] }, ctx));
    expect(JSON.parse(toolResults[1]!.content)).toEqual(runTool('get_series', { areaCode: '27', years: [2020] }, ctx));
    expectWorkerAccepts(s);
  });

  it('is_error: a tool failure is returned to the model with is_error true, a success has no is_error key', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_bad', 'get_series', { areaCode: '99999' }), toolUse('toolu_ok', 'find_area', { query: '東京' })),
      textResponse('見つかりませんでした。'),
    );
    const result = await ask('99999は？', ctx, { fetchFn: s.fetchFn });

    const [bad, good] = s.body(1).messages[2]!.content as unknown as Array<Record<string, unknown>>;
    expect(bad).toMatchObject({ tool_use_id: 'toolu_bad', is_error: true });
    expect(JSON.parse(bad!.content as string)).toMatchObject({ error: 'unknown_area' });
    expect(good).not.toHaveProperty('is_error');
    // the failed call still shows in the trace, with the error object as its result
    expect(result.trace[0]!.result).toMatchObject({ error: 'unknown_area' });
    expect(result.status).toBe('ok');
  });

  it('unknown_tool: the model asking for a tool that does not exist gets an error result, the loop goes on', async () => {
    // Bug guard only: the model is given the eight real tool names. (The real Worker would refuse a replayed tool_use
    // with an unknown name as invalid_messages, so in production this ends in the generic error message.)
    const s = script(toolUseResponse(toolUse('toolu_x', 'launch_missiles', {})), textResponse('すみません。'));
    const result = await ask('何か', ctx, { fetchFn: s.fetchFn });
    const [block] = s.body(1).messages[2]!.content as unknown as Array<Record<string, unknown>>;
    expect(block).toMatchObject({ tool_use_id: 'toolu_x', is_error: true });
    expect(result.answer).toBe('すみません。');
  });

  it('rebuilds_blocks: extra fields (citations, caller, cache_control) are stripped, known fields kept', async () => {
    const s = script(
      modelResponse(
        [
          { type: 'text', text: '調べます。', citations: [{ type: 'x' }], cache_control: { type: 'ephemeral' } },
          { type: 'tool_use', id: 'toolu_1', name: 'find_area', input: { query: '東京' }, caller: { type: 'direct' }, cache_control: { type: 'ephemeral' } },
        ],
        'tool_use',
      ),
      textResponse('終わり。'),
    );
    await ask('東京', ctx, { fetchFn: s.fetchFn });

    expect(s.body(1).messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: '調べます。' },
        { type: 'tool_use', id: 'toolu_1', name: 'find_area', input: { query: '東京' } },
      ],
    });
    expectWorkerAccepts(s);
  });

  it('keeps_thinking_and_redacted_thinking_in_the_shapes_the_worker_accepts', async () => {
    const s = script(
      modelResponse(
        [
          { type: 'thinking', thinking: '考え中', signature: 'sig_abc', extra: 1 },
          { type: 'redacted_thinking', data: 'ZGF0YQ==', extra: 2 },
          { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} },
          { type: 'tool_use', id: 'toolu_1', name: 'find_area', input: { query: '東京' } },
        ],
        'tool_use',
      ),
      textResponse('終わり。'),
    );
    await ask('東京', ctx, { fetchFn: s.fetchFn });

    expect(s.body(1).messages[1]!.content).toEqual([
      { type: 'thinking', thinking: '考え中', signature: 'sig_abc' },
      { type: 'redacted_thinking', data: 'ZGF0YQ==' },
      { type: 'tool_use', id: 'toolu_1', name: 'find_area', input: { query: '東京' } },
    ]);
    expectWorkerAccepts(s);
  });

  it('drops_blank_text_blocks_because_the_worker_rejects_them', async () => {
    const s = script(
      modelResponse([{ type: 'text', text: '  ' }, toolUse('toolu_1', 'find_area', { query: '東京' })], 'tool_use'),
      textResponse('終わり。'),
    );
    await ask('東京', ctx, { fetchFn: s.fetchFn });
    expect(s.body(1).messages[1]!.content).toEqual([toolUse('toolu_1', 'find_area', { query: '東京' })]);
    expectWorkerAccepts(s);
  });

  it('final_answer_is_the_concatenation_of_the_final_responses_text_blocks_only', async () => {
    const s = script(
      modelResponse([{ type: 'text', text: '調べます。' }, toolUse('toolu_1', 'find_area', { query: '東京' })], 'tool_use'),
      modelResponse([{ type: 'text', text: '東京都は' }, { type: 'text', text: '13です。' }], 'end_turn'),
    );
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
    expect(result.answer).toBe('東京都は13です。');
  });

  it('result_messages_end_with_the_assistants_final_answer_and_can_be_passed_back_as_history', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' })),
      textResponse('東京都です。'),
      textResponse('はい、東京都です。'),
    );
    const first = await ask('東京は？', ctx, { fetchFn: s.fetchFn });
    expect(first.messages).toHaveLength(4);
    expect(first.messages[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '東京都です。' }] });

    const second = await ask('本当に？', ctx, { fetchFn: s.fetchFn, history: first.messages });
    expect(s.body(2).messages).toEqual([...first.messages, { role: 'user', content: '本当に？' }]);
    expect(second.messages).toHaveLength(6);
    expectWorkerAccepts(s);
  });

  it('a_tool_use_block_cut_off_by_max_tokens_is_not_run_and_not_kept_in_the_history', async () => {
    const s = script(
      modelResponse([{ type: 'text', text: '東京都の人口は途中で' }, toolUse('toolu_1', 'get_series', { areaCode: '1' })], 'max_tokens'),
    );
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
    expect(result.trace).toEqual([]);
    expect(result.answer).toBe('東京都の人口は途中で');
    expect(result.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: '東京都の人口は途中で' }] });
    expect(result.message).toContain('途中');
  });
});

describe('tool result size', () => {
  it('formatToolResult: a small result is the exact JSON string', () => {
    expect(formatToolResult({ a: 1, b: 'あ' })).toEqual({ content: '{"a":1,"b":"あ"}', isError: false, truncated: false });
    expect(formatToolResult(undefined)).toMatchObject({ content: 'null', isError: false });
  });

  it('formatToolResult: an error object is flagged', () => {
    expect(formatToolResult({ error: 'unknown_area', message: 'x' }).isError).toBe(true);
    expect(formatToolResult({ error: 3 }).isError).toBe(false);
  });

  it('formatToolResult: a result that cannot be serialised becomes an error result', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const formatted = formatToolResult(circular);
    expect(formatted.isError).toBe(true);
    expect(JSON.parse(formatted.content)).toMatchObject({ error: 'internal_error' });
  });

  it('formatToolResult: longer than the cap is cut to the cap with a visible marker', () => {
    const big = { text: 'あ'.repeat(MAX_TOOL_RESULT_CHARS * 2) };
    const formatted = formatToolResult(big);
    expect(MAX_TOOL_RESULT_CHARS).toBe(20_000);
    expect(formatted.truncated).toBe(true);
    expect(formatted.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(formatted.content.startsWith('{"text":"ああ')).toBe(true);
    expect(formatted.content).toContain('省略しました');
  });

  it('formatToolResult: exactly at the cap is not truncated', () => {
    const fits = { text: 'あ'.repeat(MAX_TOOL_RESULT_CHARS - '{"text":""}'.length) };
    const formatted = formatToolResult(fits);
    expect(formatted.content.length).toBe(MAX_TOOL_RESULT_CHARS);
    expect(formatted.truncated).toBe(false);
  });

  it('formatToolResult: never cuts a surrogate pair in half, whichever way the cut would fall', () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    for (const pad of ['', 'a']) {
      const { content } = formatToolResult({ text: pad + '𠮷'.repeat(MAX_TOOL_RESULT_CHARS) });
      expect(content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
      expect(lone.test(content)).toBe(false);
    }
  });

  it('ask: a huge real tool result is truncated in the request, with the marker', async () => {
    // find_area over areas with very long names: the real tool, the real client, a result far over the cap.
    // (ASCII names: 20,000 Japanese characters would be ~60 KB, which cannot go in one request at all; see the size guard tests.)
    const longNames = ctx.areas.slice(0, 40).map((a) => ({ ...a, name: `${'x'.repeat(4000)}${a.code}` }));
    const bigCtx = { ...ctx, areas: longNames };
    const s = script(toolUseResponse(toolUse('toolu_1', 'find_area', { query: 'x' })), textResponse('長い結果でした。'));
    const result = await ask('x', bigCtx, { fetchFn: s.fetchFn });

    const [block] = s.body(1).messages[2]!.content as unknown as Array<{ content: string }>;
    expect(JSON.stringify(runTool('find_area', { query: 'x' }, bigCtx)).length).toBeGreaterThan(MAX_TOOL_RESULT_CHARS);
    expect(block!.content.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
    expect(block!.content).toContain('省略しました');
    expect(result.status).toBe('ok');
  });
});

describe('the Tokyo question, end to end', () => {
  const tokyoSeries = { areaCode: '13' };

  it('tool_call_then_a_verified_answer: numbers taken from the get_series result pass checkNumbers', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_01TOKYO', 'get_series', tokyoSeries)),
      textResponse(GOOD_TOKYO_ANSWER),
    );
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });

    expect(result.status).toBe('ok');
    expect(result.fromCache).toBe(false);
    expect(result.unverified).toEqual([]);
    expect(result.answer).toBe(GOOD_TOKYO_ANSWER);
    expect(result.trace).toHaveLength(1);
    expect(result.trace[0]!.tool).toBe('get_series');
    expect(result.trace[0]!.input).toEqual(tokyoSeries);
    expect(result.trace[0]!.result).toEqual(runTool('get_series', tokyoSeries, ctx));
    // and the answer really is clean against the very results of this ask
    expect(checkNumbers(result.answer, result.trace.map((t) => t.result)).unverified).toEqual([]);
    expect(s.mock).toHaveBeenCalledTimes(2);
    expectWorkerAccepts(s);
  });

  it('invented_number_then_one_regeneration: the second answer is fine', async () => {
    const bad = '東京都の人口は、2100年には約2,500万人になります。';
    const s = script(
      toolUseResponse(toolUse('toolu_01TOKYO', 'get_series', tokyoSeries)),
      textResponse(bad),
      textResponse(GOOD_TOKYO_ANSWER),
    );
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });

    expect(s.mock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
    expect(result.answer).toBe(GOOD_TOKYO_ANSWER);

    // the regeneration request: the bad answer, then the correction request naming the number
    const sent = s.body(2).messages;
    expect(sent).toHaveLength(5);
    expect(sent[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: bad }] });
    expect(sent[4]!.role).toBe('user');
    expect(userText(sent[4]!)).toBe(
      '次の数字は計算の結果に見つかりません: 2,500万。計算の結果にある数字だけを使って言い直してください。',
    );
    // the conversation handed back keeps everything, so a follow-up question continues from it
    expect(result.messages).toHaveLength(6);
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: [{ type: 'text', text: GOOD_TOKYO_ANSWER }] });
    expectWorkerAccepts(s);
  });

  it('names_every_unverified_number_in_the_regeneration_request', async () => {
    const s = script(
      textResponse('東京都は2,500万人で、65歳以上は88.8%です。'),
      textResponse('分かりません。'),
    );
    await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });
    const request = userText(s.body(1).messages.at(-1)!);
    expect(request).toContain('2,500万');
    expect(request).toContain('88.8%');
    expect(request.startsWith('次の数字は計算の結果に見つかりません: ')).toBe(true);
    expect(request.endsWith('計算の結果にある数字だけを使って言い直してください。')).toBe(true);
  });

  it('still_unverified_after_the_regeneration: returns the second answer with the numbers and a warning status', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_01TOKYO', 'get_series', tokyoSeries)),
      textResponse('東京都は2100年に約2,500万人です。'),
      textResponse('東京都は2100年に約2,600万人です。'),
    );
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });

    expect(s.mock).toHaveBeenCalledTimes(3); // regenerated once, not twice
    expect(result.status).toBe('unverified_numbers');
    expect(result.answer).toBe('東京都は2100年に約2,600万人です。');
    expect(result.unverified).toEqual(['2,600万']);
    expect(result.fromCache).toBe(false);
    expect(result.trace).toHaveLength(1);
    expect(result.message).toBeTruthy();
  });

  it('the_regeneration_may_call_tools_again_and_gets_its_own_round_budget', async () => {
    const s = script(
      textResponse('東京都は約2,500万人です。'), // no tool used and a number in the answer: nothing verifies it
      toolUseResponse(toolUse('toolu_01TOKYO', 'get_series', tokyoSeries)),
      textResponse(GOOD_TOKYO_ANSWER),
    );
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, maxRounds: 2 });

    expect(s.mock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('ok');
    expect(result.trace.map((t) => t.tool)).toEqual(['get_series']);
    expect(result.unverified).toEqual([]);
  });

  it('no_tool_and_no_numbers: one call, status ok', async () => {
    const s = script(textResponse('このアプリは、日本の市区町村の人口を2100年まで見られます。'));
    const result = await ask('このアプリは何ですか', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('ok');
    expect(result.trace).toEqual([]);
  });

  it('no_tool_but_a_number: the same check applies, so it is regenerated and then warned about', async () => {
    const s = script(textResponse('日本の人口は約1億2,500万人です。'), textResponse('日本の人口は約1億2,400万人です。'));
    const result = await ask('日本の人口は？', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified.length).toBeGreaterThan(0);
  });

  it('a_failure_while_regenerating_returns_the_first_answer_flagged_as_unverified', async () => {
    const s = script(textResponse('東京都は約2,500万人です。'), jsonResponse({ error: 'upstream_error' }, 502));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('unverified_numbers');
    expect(result.answer).toBe('東京都は約2,500万人です。');
    expect(result.unverified).toEqual(['2,500万']);
    expect(result.messages).toEqual([
      { role: 'user', content: TOKYO_QUESTION },
      { role: 'assistant', content: [{ type: 'text', text: '東京都は約2,500万人です。' }] },
    ]);
  });
});

describe('maxRounds', () => {
  it('stops_after_maxRounds_model_calls_and_explains: status error, text so far kept, history unchanged', async () => {
    const loop = (): Response =>
      modelResponse([{ type: 'text', text: '調べます。' }, toolUse('toolu_x', 'find_area', { query: '東京' })], 'tool_use');
    const s = script(loop(), loop(), loop(), loop());
    const history: Message[] = [
      { role: 'user', content: '前の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '前の答え' }] },
    ];
    const result = await ask('調べ続けて', ctx, { fetchFn: s.fetchFn, maxRounds: 2, history });

    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('error');
    expect(result.message).toContain('手順が多すぎ');
    expect(result.answer).toContain('調べます。');
    expect(result.trace).toHaveLength(1); // the first round's tool ran; the second round's request was never answered
    expect(result.fromCache).toBe(false);
    expect(result.messages).toEqual(history);
  });

  it('defaults_to_six_rounds', async () => {
    const steps: Step[] = Array.from({ length: 10 }, (_, i) =>
      toolUseResponse(toolUse(`toolu_${i}`, 'find_area', { query: '東京' })),
    );
    const s = script(...steps);
    const result = await ask('調べ続けて', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(6);
    expect(result.status).toBe('error');
  });

  it('an_empty_final_answer_is_an_error_not_an_ok_empty_answer', async () => {
    const s = script(modelResponse([], 'end_turn'));
    const result = await ask('こんにちは', ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('error');
    expect(result.answer).toBe('');
    expect(result.message).toBeTruthy();
  });
});

describe('errors', () => {
  const cache = cacheOf(verifiedEntry());
  // A saved answer is returned up front when there is no conversation, so the fall-back-after-an-error path is only
  // reached inside a conversation (history present), for instance when a visitor asks a sample question as a follow-up.
  const HISTORY: Message[] = [
    { role: 'user', content: '最初の質問' },
    { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
  ];
  const SAVED_MESSAGES: Message[] = [
    ...HISTORY,
    { role: 'user', content: TOKYO_QUESTION },
    { role: 'assistant', content: [{ type: 'text', text: '保存済みの答えです。' }] },
  ];

  it('429_cached_true_without_a_saved_answer: unavailable with the short message', async () => {
    const s = script(jsonResponse({ cached: true, error: 'rate_limited' }, 429));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache: null });
    expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER, answer: '', fromCache: false, unverified: [] });
    expect(result.messages).toEqual([]);
  });

  it('429_cached_true_with_a_saved_answer_for_the_same_question: served from the cache with an explanation', async () => {
    const s = script(jsonResponse({ cached: true, error: 'rate_limited' }, 429));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache, history: HISTORY });
    expect(s.mock).toHaveBeenCalledTimes(1); // it did try the AI first
    expect(result.status).toBe('ok');
    expect(result.fromCache).toBe(true);
    expect(result.answer).toBe('保存済みの答えです。');
    expect(result.trace).toEqual(verifiedEntry().trace);
    expect(result.message).toContain('保存済み');
    expect(result.messages).toEqual(SAVED_MESSAGES);
  });

  it('429_with_a_cache_that_has_other_questions_only: unavailable', async () => {
    const s = script(jsonResponse({ cached: true, error: 'rate_limited' }, 429));
    const result = await ask('別の質問です', ctx, { fetchFn: s.fetchFn, cache, history: HISTORY });
    expect(result.status).toBe('unavailable');
  });

  it('a_pending_saved_answer_is_never_used_as_a_fallback', async () => {
    const s = script(jsonResponse({ error: 'upstream_error' }, 502));
    const pending = cacheOf(verifiedEntry({ status: 'pending', answer: '' }));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache: pending });
    expect(result.status).toBe('unavailable');
  });

  it.each([
    [502, { error: 'upstream_error' }],
    [503, { error: 'service_unavailable' }],
    [503, { error: 'server_misconfigured' }],
    [500, { error: 'boom' }],
  ])('%i %j: unavailable, or the saved answer when there is one', async (status, body) => {
    const none = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse(body, status)).fetchFn });
    expect(none).toMatchObject({ status: 'unavailable', message: TRY_LATER });

    const saved = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse(body, status)).fetchFn, cache, history: HISTORY });
    expect(saved).toMatchObject({ status: 'ok', fromCache: true, answer: '保存済みの答えです。' });
  });

  // The default address is covered in 'an endpoint that is not there': a failed connection there means nothing is deployed.
  const CONFIGURED = 'https://worker.example.test/api/chat';

  it('network_failure: unavailable, or the saved answer when there is one', async () => {
    const none = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, endpoint: CONFIGURED });
    expect(none).toMatchObject({ status: 'unavailable', message: TRY_LATER });

    const fetchFn = script(new TypeError('Failed to fetch')).fetchFn;
    const saved = await ask(TOKYO_QUESTION, ctx, { fetchFn, endpoint: CONFIGURED, cache, history: HISTORY });
    expect(saved).toMatchObject({ status: 'ok', fromCache: true, answer: '保存済みの答えです。' });
  });

  describe('the_message_mentions_saved_questions_only_when_one_is_verified', () => {
    const down = (cacheValue: CachedAnswers | null) =>
      ask('別の質問です', ctx, { fetchFn: script(jsonResponse({ error: 'upstream_error' }, 502)).fetchFn, cache: cacheValue, history: HISTORY });
    const sampleEntry = (i: number, overrides: Partial<CachedAnswer> = {}): CachedAnswer =>
      verifiedEntry({ id: `q${i + 1}`, question: SAMPLE_QUESTIONS[i]!, ...overrides });

    it('no cache, a cache of placeholders, or verified answers to questions that are not samples: nothing is offered, so nothing is mentioned', async () => {
      expect((await down(null)).message).toBe(TRY_LATER);
      expect((await down(cacheOf(...SAMPLE_QUESTIONS.map((_, i) => sampleEntry(i, { status: 'pending', answer: '' }))))).message).toBe(TRY_LATER);
      expect((await down(cacheOf(verifiedEntry({ question: 'サンプルにない質問' })))).message).toBe(TRY_LATER);
      expect(TRY_LATER).not.toContain('保存済み');
    });

    it('one verified sample is enough: the saved questions are mentioned', async () => {
      expect((await down(cacheOf(sampleEntry(2)))).message).toBe(UNAVAILABLE);
      expect(UNAVAILABLE).toContain('保存済みの質問');
    });
  });

  it('a_200_that_is_not_json_or_has_no_content_is_unavailable', async () => {
    const html = await ask('q', ctx, { fetchFn: script(new Response('<html>oops</html>', { status: 200 })).fetchFn });
    expect(html.status).toBe('unavailable');
    const noContent = await ask('q', ctx, { fetchFn: script(jsonResponse({ hello: 'world' })).fetchFn });
    expect(noContent.status).toBe('unavailable');
  });

  it('a_failure_in_a_later_round_keeps_the_trace_so_far', async () => {
    const s = script(toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' })), jsonResponse({ error: 'upstream_error' }, 502));
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('unavailable');
    expect(result.trace.map((t) => t.tool)).toEqual(['find_area']);
  });

  it('413: tells the user the question is too long; the saved answer is not offered', async () => {
    const s = script(jsonResponse({ error: 'body_too_large' }, 413));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache, history: HISTORY });
    expect(result).toMatchObject({ status: 'unavailable', message: '質問が長すぎます。', fromCache: false });
  });

  it.each([
    [403, { error: 'origin_not_allowed' }],
    [400, { error: 'invalid_messages' }],
    [401, { error: 'unauthorized' }],
  ])('%i %j: a generic error message, no saved answer, no retry', async (status, body) => {
    const s = script(jsonResponse(body, status), textResponse('should not be reached'));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache, history: HISTORY });
    expect(result.status).toBe('unavailable');
    expect(result.fromCache).toBe(false);
    expect(result.message).toBeTruthy();
    expect(result.message).not.toBe(UNAVAILABLE);
    expect(result.message).not.toContain('origin_not_allowed'); // server error codes are not shown to the user
    expect(s.mock).toHaveBeenCalledTimes(1);
  });

  it('an_abort_rejects_with_the_AbortError_and_is_never_converted_or_answered_from_the_cache', async () => {
    const controller = new AbortController();
    const s = script(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason));
          controller.abort();
        }),
    );
    await expect(
      ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, signal: controller.signal, cache, history: HISTORY }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('an_already_aborted_signal_rejects_before_any_request', async () => {
    const controller = new AbortController();
    controller.abort();
    const s = script(textResponse('はい。'));
    await expect(ask('q', ctx, { fetchFn: s.fetchFn, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.mock).not.toHaveBeenCalled();
  });

  it('an_abort_between_rounds_stops_the_loop', async () => {
    const controller = new AbortController();
    const s = script(
      () => {
        controller.abort();
        return toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' }));
      },
      textResponse('should not be reached'),
    );
    await expect(ask('q', ctx, { fetchFn: s.fetchFn, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(s.mock).toHaveBeenCalledTimes(1);
  });

  it('an_abort_error_that_did_not_come_from_the_users_signal_is_just_a_network_failure', async () => {
    const timeout = new DOMException('The operation timed out', 'AbortError');
    const result = await ask('q', ctx, { fetchFn: script(timeout).fetchFn, endpoint: CONFIGURED, signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER });
  });
});

// "Not available" (no Worker behind the endpoint: say so, do not suggest trying again) against "try again later" (the
// AI is busy or down right now). Ruling 36.
describe('an endpoint that is not there', () => {
  const EXPLICIT = 'https://worker.example.test/api/chat';
  const HISTORY: Message[] = [
    { role: 'user', content: '最初の質問' },
    { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
  ];
  const html = (): Response => new Response('<!doctype html><title>2100年の日本</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  /** A 200 whose body breaks off on the way: a transport failure, not a page that is not JSON. */
  const brokenBody = (): Response =>
    new Response(new ReadableStream({ start: (controller) => controller.error(new TypeError('terminated')) }), { status: 200 });

  const NOT_AVAILABLE_TEXT =
    'このバージョンでは、AIへの質問は使えません（AIの接続先がまだ用意されていません）。地図、数値、前提の調整、人口の割り振りはそのまま使えます。';

  it('the message names the three facts: not available now, why, and what still works', () => {
    expect(MSG_NOT_AVAILABLE).toBe(NOT_AVAILABLE_TEXT);
    expect(MSG_NOT_AVAILABLE).not.toContain('時間をおいて');
    expect(MSG_NOT_AVAILABLE).not.toContain('もう一度');
  });

  it.each([
    ['404', () => jsonResponse({ error: 'not_found' }, 404)],
    ['404 with an HTML body', () => new Response('<h1>Not found</h1>', { status: 404 })],
    ['405', () => new Response('Method Not Allowed', { status: 405 })],
    ['200 with the index page', html],
    ['200 with an empty body', () => new Response('', { status: 200 })],
    ['200 with JSON that is not a model message', () => jsonResponse({ hello: 'world' })],
    ['200 with JSON whose content is not a list', () => jsonResponse({ content: 'text' })],
  ])('%s: not available, with the reason, after one request, and nothing is retried', async (_name, response) => {
    for (const endpoint of [undefined, EXPLICIT]) {
      const s = script(response(), textResponse('should not be reached'));
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, ...(endpoint ? { endpoint } : {}) });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'not_configured', message: NOT_AVAILABLE_TEXT, answer: '', fromCache: false, unverified: [] });
      expect(result.messages).toEqual([]);
      expect(s.mock).toHaveBeenCalledTimes(1);
    }
  });

  it('a_failed_connection_on_an_http_page_is_try_again_later_even_at_the_default_address: a host with no Worker answers, it does not drop the connection', async () => {
    for (const protocol of ['http:', 'https:']) {
      for (const onLine of [true, false]) {
        vi.stubGlobal('location', { protocol });
        vi.stubGlobal('navigator', { onLine }); // a lossy mobile link, a captive portal and a real outage all look like this or that
        for (const endpoint of [undefined, '/api/chat', EXPLICIT]) {
          const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, ...(endpoint ? { endpoint } : {}) });
          expect(result.status, `${protocol} ${onLine} ${endpoint}`).toBe('unavailable');
          expect(result.reason).toBeUndefined();
          expect(result.message).toBe(TRY_LATER);
        }
        const cut = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(brokenBody()).fetchFn });
        expect(cut).toMatchObject({ status: 'unavailable', message: TRY_LATER });
        expect(cut.reason).toBeUndefined();
      }
    }
  });

  it('a_failed_connection_without_any_page_location_is_try_again_later_too (a Worker, an old runtime): no ReferenceError', async () => {
    vi.stubGlobal('location', undefined);
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn });
    expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER });
    expect(result.reason).toBeUndefined();
  });

  it('a_page_opened_from_a_file_has_nothing_at_its_default_address: a failed connection there is not available', async () => {
    vi.stubGlobal('location', { protocol: 'file:' });
    for (const endpoint of [undefined, '/api/chat']) {
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, ...(endpoint ? { endpoint } : {}) });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'not_configured', message: NOT_AVAILABLE_TEXT });
    }
    const cut = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(brokenBody()).fetchFn });
    expect(cut).toMatchObject({ status: 'unavailable', reason: 'not_configured' });
    // an address someone configured is a real network address, even from a file
    const configured = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, endpoint: EXPLICIT });
    expect(configured.reason).toBeUndefined();
    expect(configured.message).toBe(TRY_LATER);
  });

  it('a_page_opened_from_a_file_that_has_had_an_answer_gets_try_again_later_for_a_dropped_connection', async () => {
    vi.stubGlobal('location', { protocol: 'file:' });
    await ask('こんにちは', ctx, { fetchFn: script(textResponse('はい。')).fetchFn });
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn });
    expect(result.reason).toBeUndefined();
    expect(result.message).toBe(TRY_LATER);
  });

  it('a_failed_connection_to_a_configured_address_is_try_again_later: the Worker may well be there', async () => {
    const down = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, endpoint: EXPLICIT });
    expect(down.status).toBe('unavailable');
    expect(down.reason).toBeUndefined();
    expect(down.message).toBe(TRY_LATER);
    const cut = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(brokenBody()).fetchFn, endpoint: EXPLICIT });
    expect(cut.status).toBe('unavailable');
    expect(cut.reason).toBeUndefined();
    expect(cut.message).toBe(TRY_LATER);
  });

  it('a_page_that_is_not_JSON_is_not_available_even_at_a_configured_address', async () => {
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(html()).fetchFn, endpoint: EXPLICIT });
    expect(result.reason).toBe('not_configured');
  });

  it.each([
    [429, { error: 'rate_limited', cached: true }],
    [500, { error: 'boom' }],
    [502, { error: 'upstream_error' }],
    [503, { error: 'service_unavailable' }],
  ])('%i stays try again later, with no reason, at the default address and at a configured one', async (status, body) => {
    for (const endpoint of [undefined, EXPLICIT]) {
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse(body, status)).fetchFn, ...(endpoint ? { endpoint } : {}) });
      expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER });
      expect(result.reason).toBeUndefined();
    }
  });

  it('403_400_and_413_are_not_called_not_available', async () => {
    for (const [status, body] of [[403, { error: 'origin_not_allowed' }], [400, { error: 'invalid_messages' }], [413, { error: 'body_too_large' }]] as const) {
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse(body, status)).fetchFn });
      expect(result.status).toBe('unavailable');
      expect(result.reason).toBeUndefined();
      expect(result.message).not.toBe(NOT_AVAILABLE_TEXT);
    }
  });

  it('no_other_status_carries_a_reason', async () => {
    const ok = await ask('こんにちは', ctx, { fetchFn: script(textResponse('はい。')).fetchFn });
    expect(ok.reason).toBeUndefined();
    const error = await ask('こんにちは', ctx, { fetchFn: script(modelResponse([], 'end_turn')).fetchFn });
    expect(error.status).toBe('error');
    expect(error.reason).toBeUndefined();
  });

  it('a_verified_saved_answer_for_the_same_question_still_stands_in_for_the_missing_AI', async () => {
    const s = script(jsonResponse({ error: 'not_found' }, 404));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache: cacheOf(verifiedEntry()), history: HISTORY });
    expect(result).toMatchObject({ status: 'ok', fromCache: true, answer: '保存済みの答えです。' });
    expect(result.reason).toBeUndefined();
    // a pending placeholder never does
    const pending = await ask(TOKYO_QUESTION, ctx, {
      fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn,
      cache: cacheOf(verifiedEntry({ status: 'pending', answer: '' })),
      history: HISTORY,
    });
    expect(pending).toMatchObject({ status: 'unavailable', reason: 'not_configured', fromCache: false });
    // and a verified answer to another question does not either
    const other = await ask('別の質問です', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn, cache: cacheOf(verifiedEntry()), history: HISTORY });
    expect(other.reason).toBe('not_configured');
    expect(other.messages).toEqual(HISTORY);
  });

  describe('once the page has had an answer', () => {
    const answerOnce = async (endpoint?: string): Promise<void> => {
      const first = await ask('こんにちは', ctx, { fetchFn: script(textResponse('はい。')).fetchFn, ...(endpoint ? { endpoint } : {}) });
      expect(first.status).toBe('ok');
    };

    it('question 1 answered, then the connection drops on question 2: try again later, on a link that says it is online', async () => {
      vi.stubGlobal('location', { protocol: 'https:' });
      vi.stubGlobal('navigator', { onLine: true });
      await answerOnce();
      const second = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn });
      expect(second).toMatchObject({ status: 'unavailable', message: TRY_LATER });
      expect(second.reason).toBeUndefined();
    });

    it.each([
      ['404', () => jsonResponse({ error: 'not_found' }, 404)],
      ['405', () => new Response('Method Not Allowed', { status: 405 })],
      ['200 with the index page', html],
      ['200 with an empty body', () => new Response('', { status: 200 })],
      ['200 with JSON that is not a model message', () => jsonResponse({ hello: 'world' })],
      ['200 with JSON whose content is not a list', () => jsonResponse({ content: 'text' })],
    ])('%s after an answer is try again later, never not available', async (_name, response) => {
      await answerOnce();
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(response()).fetchFn });
      expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER });
      expect(result.reason).toBeUndefined();
    });

    it.each([
      ['a dropped connection', () => new TypeError('Failed to fetch')],
      ['a 404', () => jsonResponse({ error: 'not_found' }, 404)],
      ['the index page', html],
      ['a body that breaks off', brokenBody],
    ])('round 1 is a tool call, round 2 is %s: the trace so far stays, and it is try again later', async (_name, failure) => {
      const s = script(toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' })), failure());
      const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
      expect(result).toMatchObject({ status: 'unavailable', message: TRY_LATER, answer: '' });
      expect(result.reason).toBeUndefined();
      expect(result.trace.map((t) => t.tool)).toEqual(['find_area']);
      expect(result.messages).toEqual([]);
    });

    it('the same on a page opened from a file, where nothing is deployed at the default address until it has answered', async () => {
      vi.stubGlobal('location', { protocol: 'file:' });
      const s = script(toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' })), new TypeError('Failed to fetch'));
      const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
      expect(result.reason).toBeUndefined();
      expect(result.message).toBe(TRY_LATER);
    });

    it('a model message of any kind counts, an empty one included; a reply that is not a model message does not', async () => {
      await ask('q', ctx, { fetchFn: script(modelResponse([], 'end_turn')).fetchFn }); // an empty reply is still the Worker speaking
      expect((await ask('q', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn })).reason).toBeUndefined();

      forgetAnsweredEndpoints();
      await ask('q', ctx, { fetchFn: script(jsonResponse({ hello: 'world' })).fetchFn }); // not one
      await ask('q', ctx, { fetchFn: script(html()).fetchFn }); // not one
      expect((await ask('q', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn })).reason).toBe('not_configured');
    });

    it('a body with a content list but no stop_reason is not a model message: it is used, but the address is not remembered as answering', async () => {
      const stub = (): Response => jsonResponse({ content: [{ type: 'text', text: 'はい。' }] });
      expect((await ask('q', ctx, { fetchFn: script(stub()).fetchFn })).status).toBe('ok');
      expect((await ask('q', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn })).reason).toBe('not_configured');
      await ask('q', ctx, { fetchFn: script(jsonResponse({ content: [], stop_reason: 5 })).fetchFn });
      expect((await ask('q', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn })).reason).toBe('not_configured');
      await ask('q', ctx, { fetchFn: script(jsonResponse({ content: [], stop_reason: 'end_turn' })).fetchFn });
      expect((await ask('q', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn })).reason).toBeUndefined();
    });

    it('is remembered per address: an answer from one says nothing about another', async () => {
      await answerOnce(EXPLICIT);
      const elsewhere = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn });
      expect(elsewhere.reason).toBe('not_configured');
      const same = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn, endpoint: EXPLICIT });
      expect(same.reason).toBeUndefined();
    });

    it('forgetAnsweredEndpoints starts the page over', async () => {
      await answerOnce();
      forgetAnsweredEndpoints();
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn });
      expect(result.reason).toBe('not_configured');
    });

    it('a 404 on the very first request of a page is still not available, and the trace is empty', async () => {
      const result = await ask('東京', ctx, { fetchFn: script(jsonResponse({ error: 'not_found' }, 404)).fetchFn });
      expect(result).toMatchObject({ status: 'unavailable', reason: 'not_configured', trace: [] });
    });

    it('a verified saved answer for the same question stands in after the connection drops', async () => {
      await answerOnce();
      const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn, cache: cacheOf(verifiedEntry()), history: HISTORY });
      expect(result).toMatchObject({ status: 'ok', fromCache: true });
    });
  });

  it('a_stop_that_arrives_before_a_page_that_is_not_JSON_is_read_is_still_an_abort', async () => {
    const controller = new AbortController();
    const s = script(() => {
      controller.abort();
      return html();
    });
    await expect(ask('q', ctx, { fetchFn: s.fetchFn, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('a_user_abort_while_the_body_is_read_is_still_an_abort, not_available', async () => {
    const controller = new AbortController();
    const body = new ReadableStream({ start: (c) => controller.signal.addEventListener('abort', () => c.error(controller.signal.reason)) });
    const s = script(() => {
      queueMicrotask(() => controller.abort());
      return new Response(body, { status: 200 });
    });
    await expect(ask('q', ctx, { fetchFn: s.fetchFn, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('history and the saved-answer shortcut', () => {
  const cache = cacheOf(verifiedEntry());

  it('a_verified_cache_hit_makes_no_fetch_call: no tools, no network', async () => {
    const s = script();
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache });
    expect(s.mock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      answer: '保存済みの答えです。',
      fromCache: true,
      status: 'ok',
      unverified: [],
      trace: verifiedEntry().trace,
    });
    expect(result.message).toBeUndefined();
    expect(result.messages).toEqual([
      { role: 'user', content: TOKYO_QUESTION },
      { role: 'assistant', content: [{ type: 'text', text: '保存済みの答えです。' }] },
    ]);
  });

  it('the_cache_match_is_forgiving_about_punctuation_and_spaces', async () => {
    const s = script();
    const result = await ask(' 日本の人口が減り出してから、東京はどうなっていますか? ', ctx, { fetchFn: s.fetchFn, cache });
    expect(result.fromCache).toBe(true);
  });

  it('a_pending_entry_is_not_a_hit: the model is asked', async () => {
    const s = script(textResponse('はい。'));
    const pending = cacheOf(verifiedEntry({ status: 'pending', answer: '' }));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache: pending });
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
  });

  it('with_a_history_the_cache_shortcut_is_skipped', async () => {
    const s = script(textResponse('続きです。'));
    const history: Message[] = [
      { role: 'user', content: '最初の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
    ];
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache, history });
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
    expect(result.answer).toBe('続きです。');
  });

  it('history_is_sent_first_then_the_new_question_and_is_not_mutated', async () => {
    const s = script(textResponse('続きです。'));
    const history: Message[] = [
      { role: 'user', content: '最初の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
    ];
    const snapshot = structuredClone(history);
    const result = await ask('次の質問', ctx, { fetchFn: s.fetchFn, history });

    expect(s.body(0).messages).toEqual([...snapshot, { role: 'user', content: '次の質問' }]);
    expect(history).toEqual(snapshot);
    expect(result.messages).toEqual([
      ...snapshot,
      { role: 'user', content: '次の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '続きです。' }] },
    ]);
    expectWorkerAccepts(s);
  });

  it('an_empty_history_array_behaves_like_no_history', async () => {
    const s = script();
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, cache, history: [] });
    expect(result.fromCache).toBe(true);
  });

  it('an_error_leaves_the_conversation_as_it_was', async () => {
    const history: Message[] = [
      { role: 'user', content: '最初の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
    ];
    const result = await ask('次の質問', ctx, { fetchFn: script(jsonResponse({ error: 'upstream_error' }, 502)).fetchFn, history });
    expect(result.status).toBe('unavailable');
    expect(result.messages).toEqual(history);
  });
});

describe('module boundaries', () => {
  it('AskOptions_and_AskResult_have_the_documented_shape', async () => {
    const options: AskOptions = { endpoint: '/api/chat', fetchFn: script(textResponse('はい。')).fetchFn, maxRounds: 3, history: [], cache: null };
    const result: AskResult = await ask('こんにちは', ctx, options);
    expect(Object.keys(result).sort()).toEqual(['answer', 'fromCache', 'messages', 'status', 'trace', 'unverified']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Fix round 1
// ---------------------------------------------------------------------------------------------------------------

const NEW_CONVERSATION = '会話が長くなりすぎました。新しい質問を始めてください。';

const isToolResultBlock = (b: Block): b is Extract<Block, { type: 'tool_result' }> => b.type === 'tool_result';
const isToolUseBlock = (b: Block): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use';

function isUserTextMessage(m: Message): boolean {
  return m.role === 'user' && (typeof m.content === 'string' || !m.content.some(isToolResultBlock));
}

/** The first message is the user's, and no tool_use / tool_result pair is split (each is answered by the next message). */
function expectWholeExchanges(messages: Message[]): void {
  expect(messages.length).toBeGreaterThan(0);
  expect(isUserTextMessage(messages[0]!)).toBe(true);
  messages.forEach((m, i) => {
    if (typeof m.content === 'string') return;
    const uses = m.content.filter(isToolUseBlock).map((b) => b.id);
    if (m.role === 'assistant' && uses.length > 0) {
      const next = messages[i + 1];
      const answered = next && typeof next.content !== 'string' ? next.content.filter(isToolResultBlock).map((b) => b.tool_use_id) : [];
      expect(answered).toEqual(uses);
    }
    const results = m.content.filter(isToolResultBlock).map((b) => b.tool_use_id);
    if (m.role === 'user' && results.length > 0) {
      const prev = messages[i - 1];
      const asked = prev && typeof prev.content !== 'string' ? prev.content.filter(isToolUseBlock).map((b) => b.id) : [];
      expect(results).toEqual(asked);
    }
  });
}

/** One finished question-and-answer with a tool call in it: 4 messages. `pad` makes the answer longer. */
function exchange(i: number, pad = ''): Message[] {
  const id = `toolu_h${i}`;
  return [
    { role: 'user', content: `質問${i}` },
    { role: 'assistant', content: [{ type: 'tool_use', id, name: 'find_area', input: { query: '東京' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '{"matches":[]}' }] },
    { role: 'assistant', content: [{ type: 'text', text: `答え${i}${pad}` }] },
  ];
}

/** A question and a text answer only: 2 messages. */
function plainExchange(i: number, pad = ''): Message[] {
  return [
    { role: 'user', content: `質問${i}` },
    { role: 'assistant', content: [{ type: 'text', text: `答え${i}${pad}` }] },
  ];
}

describe('the size guard (the Worker must never be sent a request it will refuse)', () => {
  it('the_client_limits_are_inside_the_workers_limits_with_a_margin', () => {
    expect(CLIENT_LIMITS).toEqual({ maxMessages: 36, maxChars: 40_000, maxBytes: 56_000 });
    expect(CLIENT_LIMITS.maxMessages).toBeLessThan(MAX_MESSAGES);
    expect(CLIENT_LIMITS.maxChars).toBeLessThan(MAX_TOTAL_TEXT_CHARS);
    expect(CLIENT_LIMITS.maxBytes).toBeLessThan(MAX_BODY_BYTES);
  });

  it('measureRequest: counts messages, text the way the Worker counts it, and the UTF-8 bytes of the body', () => {
    const messages: Message[] = [
      { role: 'user', content: 'あい' }, // 2
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'abc' }, // 3
          { type: 'tool_use', id: 'toolu_1', name: 'find_area', input: { a: 1 } }, // JSON '{"a":1}' = 7
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'xyz' }] }, // 3
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'ab', signature: 'cde' }, { type: 'redacted_thinking', data: 'fgh' }] }, // 2 + 3 + 3
    ];
    const size = measureRequest(messages);
    expect(size.messages).toBe(4);
    expect(size.chars).toBe(2 + 3 + 7 + 3 + 2 + 3 + 3);
    expect(size.bytes).toBe(new TextEncoder().encode(JSON.stringify({ messages })).length);
    expect(size.bytes).toBeGreaterThan(JSON.stringify({ messages }).length); // あ and い are 3 bytes each
  });

  it('twelve_questions_in_a_row_with_facility_check_sized_results_never_make_a_request_the_worker_refuses', async () => {
    const replies: Step[] = [];
    for (let q = 0; q < 12; q++) {
      replies.push(toolUseResponse(toolUse(`toolu_q${q}`, 'facility_check', { areaCode: '30206', year: 2100 })));
      replies.push(textResponse('田辺市の施設を、人口の目安との比べ方で確かめました。'));
    }
    const s = script(...replies);

    let history: Message[] = [];
    let trimmedAtLeastOnce = false;
    for (let q = 0; q < 12; q++) {
      const result = await ask('田辺市の施設は？', ctx, { fetchFn: s.fetchFn, history });
      expect(result.status, `question ${q + 1}`).toBe('ok');
      expect(result.trace.map((t) => t.tool)).toEqual(['facility_check']);
      expect(result.messages.length).toBeLessThanOrEqual(CLIENT_LIMITS.maxMessages);
      if (result.trimmed) {
        trimmedAtLeastOnce = true;
        expect(result.trimmedExchanges).toBeGreaterThan(0);
      }
      history = result.messages;
    }

    expect(trimmedAtLeastOnce).toBe(true);
    expect(s.mock).toHaveBeenCalledTimes(24); // never a refused request that was retried or skipped
    expectWorkerAccepts(s); // the real validator, on every body
    for (let n = 0; n < 24; n++) {
      expectWholeExchanges(s.body(n).messages);
      const size = measureRequest(s.body(n).messages);
      expect(size.chars).toBeLessThanOrEqual(CLIENT_LIMITS.maxChars);
      expect(size.bytes).toBeLessThanOrEqual(CLIENT_LIMITS.maxBytes);
      expect(size.bytes).toBeLessThanOrEqual(MAX_BODY_BYTES);
    }
  });

  it('trims_the_oldest_whole_exchanges_when_the_history_has_too_many_messages', async () => {
    const history = Array.from({ length: 20 }, (_, i) => exchange(i)).flat(); // 80 messages
    const s = script(textResponse('はい。'));
    const result = await ask('次の質問', ctx, { fetchFn: s.fetchFn, history });

    // 8 exchanges (32 messages) + the new question = 33 <= 36; a ninth would make 37
    const sent = s.body(0).messages;
    expect(sent).toEqual([...history.slice(48), { role: 'user', content: '次の質問' }]);
    expectWholeExchanges(sent);
    expectWorkerAccepts(s);
    expect(result.trimmed).toBe(true);
    expect(result.trimmedExchanges).toBe(12);
    expect(result.status).toBe('ok');
    // the conversation handed back is the trimmed one plus this exchange
    expect(result.messages).toEqual([...history.slice(48), { role: 'user', content: '次の質問' }, { role: 'assistant', content: [{ type: 'text', text: 'はい。' }] }]);
  });

  it('a_history_that_fits_is_left_alone_and_the_result_carries_no_trim_fields', async () => {
    const history = exchange(1);
    const s = script(textResponse('はい。'));
    const result = await ask('次の質問', ctx, { fetchFn: s.fetchFn, history });
    expect(s.body(0).messages.slice(0, 4)).toEqual(history);
    expect(result).not.toHaveProperty('trimmed');
    expect(result).not.toHaveProperty('trimmedExchanges');
    expect(result).not.toHaveProperty('needsNewConversation');
  });

  it('trims_on_the_text_cap_and_on_the_byte_cap_separately', async () => {
    // 15 two-message exchanges of ASCII: 36,000 characters, 36 KB: fits. Add one more question: still fits.
    const ascii = Array.from({ length: 15 }, (_, i) => plainExchange(i, 'a'.repeat(2_400))).flat();
    const fits = script(textResponse('はい。'));
    const first = await ask('次の質問', ctx, { fetchFn: fits.fetchFn, history: ascii });
    expect(first.trimmed).toBeUndefined();
    expect(fits.body(0).messages).toHaveLength(31);

    // the same amount of Japanese text is about three times the bytes, so the byte cap makes it trim
    const japanese = Array.from({ length: 15 }, (_, i) => plainExchange(i, 'あ'.repeat(1_300))).flat(); // ~19,700 chars, ~60 KB
    expect(measureRequest(japanese).chars).toBeLessThan(CLIENT_LIMITS.maxChars); // so it is the bytes that force the trim
    expect(measureRequest(japanese).bytes).toBeGreaterThan(CLIENT_LIMITS.maxBytes);
    const bytes = script(textResponse('はい。'));
    const second = await ask('次の質問です', ctx, { fetchFn: bytes.fetchFn, history: japanese });
    expect(second.trimmed).toBe(true);
    expect(measureRequest(bytes.body(0).messages).bytes).toBeLessThanOrEqual(CLIENT_LIMITS.maxBytes);
    expectWorkerAccepts(bytes);
  });

  it('every_round_is_checked: results that grow the request in the tool loop trim the oldest history before the next request', async () => {
    const history = Array.from({ length: 15 }, (_, i) => plainExchange(i, 'a'.repeat(2_400))).flat(); // ~36,000 chars
    const s = script(
      toolUseResponse(toolUse('toolu_big', 'facility_check', { areaCode: '30206', year: 2100 })), // adds ~5,000 characters
      textResponse('田辺市の施設を確かめました。'),
    );
    const result = await ask('田辺市の施設は？', ctx, { fetchFn: s.fetchFn, history });

    expect(s.body(0).messages).toHaveLength(31); // request 1 still carried the whole history
    const second = s.body(1).messages;
    expect(second.length).toBeLessThan(31 + 2);
    expect(second[0]).not.toEqual(history[0]); // the oldest exchange went
    expect(second.at(-3)).toEqual({ role: 'user', content: '田辺市の施設は？' }); // the new question and its tool exchange are intact
    expectWholeExchanges(second);
    expectWorkerAccepts(s);
    expect(result.trimmed).toBe(true);
    expect(result.status).toBe('ok');
  });

  it('one_oversize_question_is_not_sent: needsNewConversation, no fetch call', async () => {
    const s = script(textResponse('should not be reached'));
    const result = await ask('あ'.repeat(45_000), ctx, { fetchFn: s.fetchFn });
    expect(s.mock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'unavailable',
      message: NEW_CONVERSATION,
      needsNewConversation: true,
      answer: '',
      fromCache: false,
      unverified: [],
    });
  });

  it('a_question_under_the_text_cap_but_over_the_byte_cap_is_not_sent_either', async () => {
    const s = script(textResponse('should not be reached'));
    const question = 'あ'.repeat(20_000); // 20,000 characters, ~60,000 bytes
    expect(question.length).toBeLessThan(CLIENT_LIMITS.maxChars);
    const result = await ask(question, ctx, { fetchFn: s.fetchFn, history: exchange(1) });
    expect(s.mock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'unavailable', needsNewConversation: true, message: NEW_CONVERSATION });
    expect(result.messages).toEqual([]); // the history was dropped to make room and it still did not fit
  });

  it('a_tool_loop_that_outgrows_the_limits_by_itself_stops_without_sending_the_next_request', async () => {
    const longNames = ctx.areas.slice(0, 40).map((a) => ({ ...a, name: `${'あ'.repeat(4000)}${a.code}` }));
    const bigCtx = { ...ctx, areas: longNames };
    const s = script(
      toolUseResponse(
        toolUse('toolu_1', 'find_area', { query: 'あ' }),
        toolUse('toolu_2', 'find_area', { query: 'あ' }),
        toolUse('toolu_3', 'find_area', { query: 'あ' }),
      ), // three results of 20,000 characters
      textResponse('should not be reached'),
    );
    const result = await ask('あ', bigCtx, { fetchFn: s.fetchFn, history: exchange(1) });
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'unavailable', needsNewConversation: true, message: NEW_CONVERSATION });
    expect(result.trace).toHaveLength(3);
  });

  it('a_regeneration_request_that_cannot_fit_returns_the_first_answer_flagged_instead', async () => {
    const long = `${'あ'.repeat(39_980)}2,500万人`; // an answer so long that question + answer + correction is over the cap
    const s = script(textResponse(long), textResponse('should not be reached'));
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('unverified_numbers');
    expect(result.answer).toBe(long);
    expect(result.unverified).toEqual(['2,500万']);
    expect(result).not.toHaveProperty('needsNewConversation');
  });
});

describe('the number check uses ALL the tool results of the ask', () => {
  it('a_number_that_only_the_earlier_result_contains_is_verified', async () => {
    const s = script(
      toolUseResponse(toolUse('toolu_1', 'get_series', { areaCode: '13', years: [2020] })),
      toolUseResponse(toolUse('toolu_2', 'find_area', { query: '大阪' })), // contains no population at all
      textResponse('東京都の2020年の人口は、約1,405万人です。大阪を探しました。'),
    );
    const result = await ask('東京と大阪', ctx, { fetchFn: s.fetchFn });
    expect(result.trace.map((t) => t.tool)).toEqual(['get_series', 'find_area']);
    expect(s.mock).toHaveBeenCalledTimes(3); // no regeneration
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
  });

  it('numbers_from_the_first_and_the_last_result_are_both_verified', async () => {
    const osaka = runTool('get_series', { areaCode: '27', years: [2020] }, ctx) as { rows: Array<{ population: number }> };
    const osakaMan = Math.round(osaka.rows[0]!.population / 10_000).toLocaleString('en-US');
    const s = script(
      toolUseResponse(toolUse('toolu_1', 'get_series', { areaCode: '13', years: [2020] })),
      toolUseResponse(toolUse('toolu_2', 'get_series', { areaCode: '27', years: [2020] })),
      textResponse(`2020年は、東京都が約1,405万人、大阪府が約${osakaMan}万人です。`),
    );
    const result = await ask('東京と大阪', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(3);
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
  });

  it('negative_twin: a number that no result contains is flagged, even with two tools having run', async () => {
    const bad = '東京都の2020年の人口は、約2,500万人です。';
    const s = script(
      toolUseResponse(toolUse('toolu_1', 'get_series', { areaCode: '13', years: [2020] })),
      toolUseResponse(toolUse('toolu_2', 'find_area', { query: '大阪' })),
      textResponse(bad),
      textResponse(bad),
    );
    const result = await ask('東京と大阪', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(4); // regenerated once
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['2,500万']);
  });
});

describe('the number check also uses the tool results of the earlier turns of the conversation', () => {
  /** Turn 1: Tokyo's 2020 population is fetched (14,047,594 is in a tool_result) and the answer is clean. */
  async function firstTurn(): Promise<Message[]> {
    const s = script(
      toolUseResponse(toolUse('toolu_1', 'get_series', { areaCode: '13', years: [2020] })),
      textResponse('東京都の2020年の人口は、約1,405万人です。'),
    );
    const result = await ask('東京都の2020年の人口は？', ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('ok');
    return result.messages;
  }
  const REUSE = '先ほど調べたとおり、東京都の2020年の人口は約1,405万人です。';

  it('a_number_the_model_reuses_from_an_earlier_tool_result_is_verified: no warning, no extra request', async () => {
    const history = await firstTurn();
    const s = script(textResponse(REUSE));
    const result = await ask('もう一度、人口を教えてください。', ctx, { fetchFn: s.fetchFn, history });
    expect(s.mock).toHaveBeenCalledTimes(1); // not regenerated
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
    expect(result.trace).toEqual([]); // this ask ran no tool: the earlier result is the only source
  });

  it('negative_twin: the same answer in a conversation without that earlier result is flagged', async () => {
    const s = script(textResponse(REUSE), textResponse(REUSE));
    const result = await ask('もう一度、人口を教えてください。', ctx, { fetchFn: s.fetchFn });
    expect(s.mock).toHaveBeenCalledTimes(2); // regenerated once
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['1,405万']);
  });

  it('numbers_that_occur_only_in_earlier_assistant_text_or_user_text_are_still_flagged', async () => {
    const history: Message[] = [
      { role: 'user', content: '人口が7,777万人の町はありますか？' },
      { role: 'assistant', content: [{ type: 'text', text: '東京都は約2,500万人です。' }] },
    ];
    const answer = '先ほどの約2,500万人と、7,777万人のことですね。';
    const s = script(textResponse(answer), textResponse(answer));
    const result = await ask('続きを教えてください。', ctx, { fetchFn: s.fetchFn, history });
    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['2,500万', '7,777万']);
  });

  it('an_unverified_answer_cannot_launder_its_number_through_the_next_turn', async () => {
    const bad = '東京都は約2,500万人です。';
    const first = script(textResponse(bad), textResponse(bad));
    const turn1 = await ask('東京都の人口は？', ctx, { fetchFn: first.fetchFn });
    expect(turn1.status).toBe('unverified_numbers');
    expect(JSON.stringify(turn1.messages)).toContain('2,500万'); // the bad number is now in the history
    const second = script(textResponse(bad), textResponse(bad));
    const turn2 = await ask('もう一度お願いします。', ctx, { fetchFn: second.fetchFn, history: turn1.messages });
    expect(second.mock).toHaveBeenCalledTimes(2);
    expect(turn2.status).toBe('unverified_numbers');
    expect(turn2.unverified).toEqual(['2,500万']);
  });

  it('the_regeneration_pass_uses_the_earlier_results_too: a restated answer that reuses an earlier result passes', async () => {
    const history = await firstTurn();
    const s = script(textResponse('東京都は約2,500万人です。'), textResponse(REUSE));
    const result = await ask('もう一度、人口を教えてください。', ctx, { fetchFn: s.fetchFn, history });
    expect(s.mock).toHaveBeenCalledTimes(2); // the invented number was caught, once
    expect(userText(s.body(1).messages.at(-1)!)).toContain('2,500万');
    expect(result.status).toBe('ok');
    expect(result.unverified).toEqual([]);
    expect(result.answer).toBe(REUSE);
  });

  it('the_regeneration_pass_still_flags_a_number_that_only_earlier_assistant_text_has', async () => {
    const history: Message[] = [
      { role: 'user', content: '東京都の人口は？' },
      { role: 'assistant', content: [{ type: 'text', text: '東京都は約2,500万人です。' }] },
    ];
    const s = script(textResponse('東京都は約2,500万人です。'), textResponse('言い直しても約2,500万人です。'));
    const result = await ask('もう一度お願いします。', ctx, { fetchFn: s.fetchFn, history });
    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['2,500万']);
  });

  it('a_result_in_an_exchange_the_size_guard_dropped_no_longer_counts', async () => {
    const earlier = await firstTurn(); // 4 messages, with the tool_result
    const padding = Array.from({ length: 15 }, (_, i) => plainExchange(i, 'a'.repeat(2_650))).flat(); // ~39,800 characters: with the first turn, over the 40,000 cap
    const history = [...earlier, ...padding];
    const s = script(textResponse(REUSE), textResponse(REUSE));
    const result = await ask('もう一度、人口を教えてください。', ctx, { fetchFn: s.fetchFn, history });
    expect(result.trimmed).toBe(true);
    expect(JSON.stringify(s.body(0).messages)).not.toContain('tool_result'); // the model no longer sees the result
    expect(s.mock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['1,405万']);
  });

  it('only_a_tool_result_in_a_user_message_counts', async () => {
    // A tool_result-shaped block inside an assistant message is not something a tool returned.
    const history = [
      { role: 'user', content: '東京都の人口は？' },
      { role: 'assistant', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: '{"population":25000000}' }] },
    ] as unknown as Message[];
    const answer = '東京都は約2,500万人です。';
    const s = script(textResponse(answer), textResponse(answer));
    const result = await ask('もう一度お願いします。', ctx, { fetchFn: s.fetchFn, history });
    expect(result.status).toBe('unverified_numbers');
    expect(result.unverified).toEqual(['2,500万']);
  });
});

describe('the regeneration pass has a smaller budget', () => {
  it('uses_at_most_three_requests_even_when_maxRounds_is_larger', async () => {
    const s = script(
      textResponse('東京都は約2,500万人です。'),
      ...Array.from({ length: 6 }, (_, i) => toolUseResponse(toolUse(`toolu_${i}`, 'find_area', { query: '東京' }))),
    );
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn }); // maxRounds 6
    expect(s.mock).toHaveBeenCalledTimes(1 + 3); // 6 + min(3, 6) = 9 is the most a single ask can make
    expect(result.status).toBe('unverified_numbers');
    expect(result.answer).toBe('東京都は約2,500万人です。');
  });

  it('never_exceeds_maxRounds_when_that_is_smaller_than_three', async () => {
    const s = script(
      textResponse('東京都は約2,500万人です。'),
      ...Array.from({ length: 6 }, (_, i) => toolUseResponse(toolUse(`toolu_${i}`, 'find_area', { query: '東京' }))),
    );
    await ask(TOKYO_QUESTION, ctx, { fetchFn: s.fetchFn, maxRounds: 1 });
    expect(s.mock).toHaveBeenCalledTimes(1 + 1);
  });
});

describe('stop reasons', () => {
  it('refusal_with_no_text: an error with the short refusal message', async () => {
    const s = script(modelResponse([], 'refusal'));
    const result = await ask('よくない質問', ctx, { fetchFn: s.fetchFn });
    expect(result).toMatchObject({ status: 'error', message: 'この質問にはお答えできません。', answer: '' });
  });

  it('refusal_with_text: the text is kept and the message is added', async () => {
    const s = script(textResponse('その質問にはお答えできません。', 'refusal'));
    const result = await ask('よくない質問', ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('ok');
    expect(result.answer).toBe('その質問にはお答えできません。');
    expect(result.message).toBe('この質問にはお答えできません。');
  });

  describe('a reply that ran out of room before any text was written', () => {
    const OUT_OF_ROOM = '答えが長くなりすぎて、書き終える前に止まりました。質問を短くするか、分けてたずねてください。';
    const HISTORY: Message[] = [
      { role: 'user', content: '最初の質問' },
      { role: 'assistant', content: [{ type: 'text', text: '最初の答え' }] },
    ];

    it.each([
      ['max_tokens with no content', () => modelResponse([], 'max_tokens')],
      ['max_tokens with blank text', () => textResponse('  \n', 'max_tokens')],
      ['max_tokens with a tool call that was cut off and no text', () => modelResponse([toolUse('toolu_1', 'get_series', { areaCode: '1' })], 'max_tokens')],
      ['model_context_window_exceeded with no content', () => modelResponse([], 'model_context_window_exceeded')],
    ])('%s: the message says it ran out of room and to ask a shorter or split question', async (_name, response) => {
      const s = script(response());
      const result = await ask('長い質問', ctx, { fetchFn: s.fetchFn, history: HISTORY });
      expect(result).toMatchObject({ status: 'error', message: OUT_OF_ROOM, answer: '', fromCache: false });
      expect(result.message).not.toContain('トークン'); // no jargon
      expect(result.message).not.toContain('token');
      expect(result.messages).toEqual(HISTORY); // the failed question is not part of the conversation
      expect(vi.mocked(runTool)).not.toHaveBeenCalledWith('get_series', expect.anything(), expect.anything());
    });

    it('is_not_the_generic_message: an empty reply that did not run out of room still says no answer came back', async () => {
      const result = await ask('質問', ctx, { fetchFn: script(modelResponse([], 'end_turn')).fetchFn });
      expect(result).toMatchObject({ status: 'error', message: 'AIから答えが返ってきませんでした。もう一度お試しください。' });
    });

    it('a_refusal_still_wins_and_a_cut_off_answer_with_text_is_still_shown', async () => {
      expect((await ask('質問', ctx, { fetchFn: script(modelResponse([], 'refusal')).fetchFn })).message).toBe('この質問にはお答えできません。');
      const withText = await ask('質問', ctx, { fetchFn: script(textResponse('東京都の人口は途中で', 'max_tokens')).fetchFn });
      expect(withText.status).toBe('ok');
      expect(withText.answer).toBe('東京都の人口は途中で');
    });
  });

  it('model_context_window_exceeded_is_treated_like_max_tokens', async () => {
    const s = script(textResponse('東京都の人口は途中で', 'model_context_window_exceeded'));
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
    expect(result.status).toBe('ok');
    expect(result.message).toContain('途中');
  });
});

describe('a tool that crashes', () => {
  it('runTool_throwing_becomes_an_is_error_tool_result_without_the_exception_text', async () => {
    vi.mocked(runTool).mockImplementationOnce(() => {
      throw new Error('SECRET-INTERNAL-DETAIL at /Users/someone/src/engine.ts:42');
    });
    const s = script(toolUseResponse(toolUse('toolu_1', 'get_series', { areaCode: '13' })), textResponse('計算できませんでした。'));
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });

    const [block] = s.body(1).messages[2]!.content as unknown as Array<Record<string, unknown>>;
    expect(block).toMatchObject({ tool_use_id: 'toolu_1', is_error: true });
    expect(JSON.parse(block!.content as string)).toMatchObject({ error: 'internal_error' });
    expect(JSON.stringify(s.body(1))).not.toContain('SECRET-INTERNAL-DETAIL');
    expect(JSON.stringify(result)).not.toContain('SECRET-INTERNAL-DETAIL');
    expect(result.trace[0]!.result).toMatchObject({ error: 'internal_error' });
    expect(result.status).toBe('ok');
  });
});

describe('results do not share references with the conversation or the cache', () => {
  it('changing_trace_input_does_not_change_the_messages', async () => {
    const s = script(toolUseResponse(toolUse('toolu_1', 'find_area', { query: '東京' })), textResponse('東京都です。'));
    const result = await ask('東京', ctx, { fetchFn: s.fetchFn });
    (result.trace[0]!.input as { query: string }).query = 'MUTATED';
    expect(JSON.stringify(result.messages)).not.toContain('MUTATED');
  });

  it('changing_the_trace_of_a_saved_answer_does_not_change_the_cache', async () => {
    const cache = cacheOf(verifiedEntry());
    const result = await ask(TOKYO_QUESTION, ctx, { fetchFn: script().fetchFn, cache });
    (result.trace[0]!.input as { areaCode: string }).areaCode = 'MUTATED';
    result.trace.pop();
    expect(cache.answers[0]!.trace).toEqual([{ tool: 'get_series', input: { areaCode: '13' }, result: { rows: [] } }]);
  });
});
