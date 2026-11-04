import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, MAX_MESSAGES, MAX_TOTAL_TEXT_CHARS, validateChatBody } from '../../worker/validate';
import { makeEngineContext } from '../../test/helpers/engineContext';
import { ask, CLIENT_LIMITS, formatToolResult, MAX_TOOL_RESULT_CHARS, measureRequest } from './client';
import type { AskOptions, AskResult, Block, Message } from './client';
import type { CachedAnswer, CachedAnswers } from './cached';
import { checkNumbers } from './numberCheck';
import { runTool } from './tools';

// runTool stays the real thing; one test makes it throw once to prove the client contains the failure.
vi.mock('./tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools')>();
  return { ...actual, runTool: vi.fn(actual.runTool) };
});

const ctx = makeEngineContext();

const TOKYO_QUESTION = '日本の人口が減り出してから、東京はどうなっていますか？';
const UNAVAILABLE = 'いまはAIに接続できません。保存済みの質問を試してください。';

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
    expect(result).toMatchObject({ status: 'unavailable', message: UNAVAILABLE, answer: '', fromCache: false, unverified: [] });
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
    expect(none).toMatchObject({ status: 'unavailable', message: UNAVAILABLE });

    const saved = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(jsonResponse(body, status)).fetchFn, cache, history: HISTORY });
    expect(saved).toMatchObject({ status: 'ok', fromCache: true, answer: '保存済みの答えです。' });
  });

  it('network_failure: unavailable, or the saved answer when there is one', async () => {
    const none = await ask(TOKYO_QUESTION, ctx, { fetchFn: script(new TypeError('Failed to fetch')).fetchFn });
    expect(none).toMatchObject({ status: 'unavailable', message: UNAVAILABLE });

    const fetchFn = script(new TypeError('Failed to fetch')).fetchFn;
    const saved = await ask(TOKYO_QUESTION, ctx, { fetchFn, cache, history: HISTORY });
    expect(saved).toMatchObject({ status: 'ok', fromCache: true, answer: '保存済みの答えです。' });
  });

  it('a_200_that_is_not_json_or_has_no_content_is_treated_like_an_upstream_failure', async () => {
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
    [404, { error: 'not_found' }],
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
    const result = await ask('q', ctx, { fetchFn: script(timeout).fetchFn, signal: new AbortController().signal });
    expect(result).toMatchObject({ status: 'unavailable', message: UNAVAILABLE });
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
