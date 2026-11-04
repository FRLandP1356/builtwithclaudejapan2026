// The browser side of the AI guide: asks the Worker proxy, runs the tools the model asks for, checks the numbers.
//
// WHAT HAPPENS IN ask()
//   1. A verified saved answer for exactly this question (and no conversation yet) is returned without any request.
//   2. Otherwise a tool loop: POST { messages } to the Worker; if the model stopped to use tools, run EVERY requested
//      tool here with runTool, send the results back, and repeat. The Worker owns the model, the system prompt and the
//      tool definitions, so the body is `{ messages }` and nothing else.
//   3. checkNumbers compares the numbers in the answer with the numbers the tools returned in this ask. If some are
//      missing, the model is asked ONCE to restate the answer using only numbers from the results (its own round budget).
//      Still unchecked: the answer comes back with status 'unverified_numbers' and the numbers, for the UI to warn.
//   4. If the AI cannot be reached (limit, outage, network) the saved answer for the same question is used when there
//      is one; otherwise status 'unavailable'. A user abort is never converted: ask() rejects with the AbortError.
//
// No DOM. The engine is reached only through EngineContext / runTool.
import { findCached } from './cached';
import type { CachedAnswer, CachedAnswers } from './cached';
import { checkNumbers } from './numberCheck';
import { runTool } from './tools';
import type { EngineContext } from './tools';

// ---------------------------------------------------------------------------------------------------------------
// Types. The block shapes are the ones worker/validate.ts accepts; nothing else is ever sent.
// ---------------------------------------------------------------------------------------------------------------

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}
export type Block = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | RedactedThinkingBlock;

export type Message = { role: 'user' | 'assistant'; content: string | Block[] };

/** One tool call of an ask, in the order it ran: what the model asked for and what the tool returned. */
export interface TraceItem {
  tool: string;
  input: unknown;
  result: unknown;
}

export interface AskOptions {
  /** Where the Worker listens. Default '/api/chat'. */
  endpoint?: string;
  fetchFn?: typeof fetch;
  /** Most model requests in one pass of the tool loop (the regeneration pass has its own budget). Default 6. */
  maxRounds?: number;
  signal?: AbortSignal;
  /** The conversation so far: the `messages` of the previous AskResult. */
  history?: Message[];
  cache?: CachedAnswers | null;
}

export interface AskResult {
  answer: string;
  trace: TraceItem[];
  /** Numbers in `answer` that no tool result contains (empty unless status is 'unverified_numbers'). */
  unverified: string[];
  fromCache: boolean;
  status: 'ok' | 'unverified_numbers' | 'unavailable' | 'error';
  /** A short Japanese note for the user, when there is something to say. */
  message?: string;
  /** The conversation to pass as `history` next time. After a failure it is the history as it was. */
  messages: Message[];
}

// ---------------------------------------------------------------------------------------------------------------
// Constants and user-facing messages (Japanese)
// ---------------------------------------------------------------------------------------------------------------

export const DEFAULT_ENDPOINT = '/api/chat';
export const DEFAULT_MAX_ROUNDS = 6;
/** A tool result longer than this (as JSON text) is cut before it goes back to the model. */
export const MAX_TOOL_RESULT_CHARS = 20_000;

const TRUNCATION_MARKER = '…（結果が長すぎるため、ここから先は省略しました）';

const MSG_UNAVAILABLE = 'いまはAIに接続できません。保存済みの質問を試してください。';
const MSG_SAVED = 'いまはAIに接続できないため、保存済みの答えを表示しています。';
const MSG_TOO_LONG = '質問が長すぎます。';
const MSG_REJECTED = 'AIへの問い合わせでエラーが起きました。時間をおいて、もう一度お試しください。';
const MSG_TOO_MANY_STEPS = 'この質問は、調べる手順が多すぎて答えを出せませんでした。質問を短くするか、分けてたずねてください。';
const MSG_EMPTY = 'AIから答えが返ってきませんでした。もう一度お試しください。';
const MSG_CUT_OFF = '答えが長くなりすぎて、途中で終わっている可能性があります。';
const MSG_UNVERIFIED = '答えの中の一部の数字を、計算の結果と照らし合わせて確かめられませんでした。';
const MSG_REGENERATION_FAILED = '数字を言い直してもらえなかったため、確かめられていない数字を含む答えを表示しています。';
const MSG_TOOL_CRASHED = '計算中に問題が起きました。';

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isToolUse = (block: Block): block is ToolUseBlock => block.type === 'tool_use';
const isText = (block: Block): block is TextBlock => block.type === 'text';

/** True when `end` would cut a surrogate pair in half. */
function splitsSurrogatePair(text: string, end: number): boolean {
  const before = text.charCodeAt(end - 1);
  const after = text.charCodeAt(end);
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff;
}

/**
 * The text a tool_result carries: the result as JSON, cut to MAX_TOOL_RESULT_CHARS (marker included) when longer.
 * `isError` is true for the tools' `{ error }` results and for a result that cannot be turned into JSON.
 */
export function formatToolResult(result: unknown): { content: string; isError: boolean; truncated: boolean } {
  let json: string;
  let isError = isRecord(result) && typeof result.error === 'string';
  try {
    json = JSON.stringify(result) ?? 'null';
  } catch {
    json = JSON.stringify({ error: 'internal_error', message: MSG_TOOL_CRASHED });
    isError = true;
  }
  if (json.length <= MAX_TOOL_RESULT_CHARS) return { content: json, isError, truncated: false };

  let end = MAX_TOOL_RESULT_CHARS - TRUNCATION_MARKER.length;
  if (splitsSurrogatePair(json, end)) end -= 1;
  return { content: json.slice(0, end) + TRUNCATION_MARKER, isError, truncated: true };
}

/**
 * Rebuilds the model's content from known fields only, so that nothing the Worker would reject (citations, caller,
 * cache_control, server-tool blocks, blank text) is sent back.
 */
function rebuildBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  const blocks: Block[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    switch (item.type) {
      case 'text':
        if (typeof item.text === 'string' && item.text.trim() !== '') blocks.push({ type: 'text', text: item.text });
        break;
      case 'tool_use':
        if (typeof item.id === 'string' && typeof item.name === 'string') {
          blocks.push({ type: 'tool_use', id: item.id, name: item.name, input: isRecord(item.input) ? item.input : {} });
        }
        break;
      case 'thinking':
        if (typeof item.thinking === 'string' && typeof item.signature === 'string') {
          blocks.push({ type: 'thinking', thinking: item.thinking, signature: item.signature });
        }
        break;
      case 'redacted_thinking':
        if (typeof item.data === 'string') blocks.push({ type: 'redacted_thinking', data: item.data });
        break;
      default:
        break;
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------
// One request to the Worker
// ---------------------------------------------------------------------------------------------------------------

/** Why a request did not give a usable response. 'unreachable' is the only kind a saved answer can stand in for. */
type FailureKind = 'unreachable' | 'too_long' | 'rejected';

class RequestFailure extends Error {
  kind: FailureKind;
  constructor(kind: FailureKind) {
    super(`AI request failed: ${kind}`);
    this.name = 'RequestFailure';
    this.kind = kind;
  }
}

interface Env {
  ctx: EngineContext;
  endpoint: string;
  fetchFn: typeof fetch;
  maxRounds: number;
  signal?: AbortSignal;
}

interface ModelTurn {
  content: Block[];
  stopReason: string;
}

function failureForStatus(status: number): RequestFailure {
  if (status === 413) return new RequestFailure('too_long');
  // 429 (daily limit; the body says cached: true) and 5xx (502 upstream, 503 not configured / store down) are the
  // AI being unavailable right now. Everything else (403 origin, 400 body, 404, 405) is a problem with the request.
  if (status === 429 || status >= 500) return new RequestFailure('unreachable');
  return new RequestFailure('rejected');
}

/** An abort the caller asked for passes through untouched; anything else that broke the transport is 'unreachable'. */
function transportFailure(error: unknown, signal: AbortSignal | undefined): unknown {
  return signal?.aborted ? error : new RequestFailure('unreachable');
}

async function callModel(messages: Message[], env: Env): Promise<ModelTurn> {
  env.signal?.throwIfAborted();

  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
    credentials: 'omit',
  };
  if (env.signal) init.signal = env.signal;

  let response: Response;
  try {
    response = await env.fetchFn(env.endpoint, init);
  } catch (error) {
    throw transportFailure(error, env.signal);
  }
  if (!response.ok) throw failureForStatus(response.status);

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw transportFailure(error, env.signal);
  }
  if (!isRecord(data) || !Array.isArray(data.content)) throw new RequestFailure('unreachable');
  return {
    content: rebuildBlocks(data.content),
    stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : '',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The tool loop
// ---------------------------------------------------------------------------------------------------------------

interface Conversation {
  messages: Message[];
  trace: TraceItem[];
  /** The tool results of this ask, as the model saw them (JSON text). checkNumbers checks the answer against these. */
  seen: string[];
}

type PassOutcome =
  | { kind: 'answer'; text: string; cutOff: boolean }
  | { kind: 'too_many_steps'; text: string }
  | { kind: 'empty' };

function executeCall(call: ToolUseBlock, conversation: Conversation, ctx: EngineContext): ToolResultBlock {
  let result: unknown;
  try {
    result = runTool(call.name, call.input, ctx);
  } catch {
    // runTool reports bad model input as an { error } object; this is only a bug guard.
    result = { error: 'internal_error', message: MSG_TOOL_CRASHED };
  }
  conversation.trace.push({ tool: call.name, input: call.input, result });

  const formatted = formatToolResult(result);
  conversation.seen.push(formatted.content);
  const block: ToolResultBlock = { type: 'tool_result', tool_use_id: call.id, content: formatted.content };
  if (formatted.isError) block.is_error = true;
  return block;
}

/**
 * Talks to the model until it gives a final answer, running its tools in between. At most `maxRounds` requests.
 * Appends to `conversation.messages` as it goes; on success the last message is the assistant's final answer.
 */
async function runPass(conversation: Conversation, env: Env): Promise<PassOutcome> {
  const earlierText: string[] = [];
  for (let round = 1; round <= env.maxRounds; round++) {
    const turn = await callModel(conversation.messages, env);
    const calls = turn.content.filter(isToolUse);
    const text = turn.content.filter(isText).map((block) => block.text).join('');

    if (turn.stopReason === 'tool_use' && calls.length > 0) {
      if (text.trim() !== '') earlierText.push(text);
      if (round === env.maxRounds) return { kind: 'too_many_steps', text: earlierText.join('\n\n') };
      conversation.messages.push({ role: 'assistant', content: turn.content });
      conversation.messages.push({ role: 'user', content: calls.map((call) => executeCall(call, conversation, env.ctx)) });
      continue;
    }

    if (text.trim() === '') return { kind: 'empty' };
    // A tool_use here (the reply was cut off by max_tokens) has no result to go with it, so it is not kept.
    conversation.messages.push({ role: 'assistant', content: turn.content.filter((block) => !isToolUse(block)) });
    return { kind: 'answer', text, cutOff: turn.stopReason === 'max_tokens' };
  }
  return { kind: 'too_many_steps', text: earlierText.join('\n\n') };
}

function regenerationRequest(unverified: string[]): string {
  return `次の数字は計算の結果に見つかりません: ${unverified.join('、')}。計算の結果にある数字だけを使って言い直してください。`;
}

// ---------------------------------------------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------------------------------------------

function savedAnswerResult(saved: CachedAnswer, history: Message[], question: string, message?: string): AskResult {
  const result: AskResult = {
    answer: saved.answer,
    trace: [...saved.trace],
    unverified: [],
    fromCache: true,
    status: 'ok',
    messages: [
      ...history,
      { role: 'user', content: question },
      { role: 'assistant', content: [{ type: 'text', text: saved.answer }] },
    ],
  };
  if (message !== undefined) result.message = message;
  return result;
}

/** Nothing usable came back. The conversation is left as it was so the failed question is not part of it. */
function failureResult(status: 'unavailable' | 'error', message: string, answer: string, trace: TraceItem[], history: Message[]): AskResult {
  return { answer, trace, unverified: [], fromCache: false, status, message, messages: [...history] };
}

function messageForFailure(kind: FailureKind): string {
  switch (kind) {
    case 'too_long':
      return MSG_TOO_LONG;
    case 'rejected':
      return MSG_REJECTED;
    default:
      return MSG_UNAVAILABLE;
  }
}

export async function ask(question: string, ctx: EngineContext, opts: AskOptions = {}): Promise<AskResult> {
  const history = opts.history ?? [];
  const cache = opts.cache ?? null;

  if (history.length === 0) {
    const saved = findCached(cache, question);
    if (saved) return savedAnswerResult(saved, history, question);
  }

  const rounds = opts.maxRounds !== undefined && Number.isFinite(opts.maxRounds) ? Math.floor(opts.maxRounds) : DEFAULT_MAX_ROUNDS;
  const env: Env = {
    ctx,
    endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
    // Looked up at call time, and called without a receiver (a stored `fetch` throws "Illegal invocation" otherwise).
    fetchFn: opts.fetchFn ?? ((input, init) => fetch(input, init)),
    maxRounds: Math.max(1, rounds),
    ...(opts.signal ? { signal: opts.signal } : {}),
  };
  const conversation: Conversation = {
    messages: [...history, { role: 'user', content: question }],
    trace: [],
    seen: [],
  };

  try {
    const first = await runPass(conversation, env);
    if (first.kind === 'too_many_steps') return failureResult('error', MSG_TOO_MANY_STEPS, first.text, conversation.trace, history);
    if (first.kind === 'empty') return failureResult('error', MSG_EMPTY, '', conversation.trace, history);

    const firstUnverified = checkNumbers(first.text, conversation.seen).unverified;
    if (firstUnverified.length === 0) return okResult(first.text, first.cutOff, conversation);

    // Some numbers are not in the tool results: ask once for a restatement, with a round budget of its own.
    const afterFirstAnswer = [...conversation.messages];
    conversation.messages.push({ role: 'user', content: regenerationRequest(firstUnverified) });
    let second: PassOutcome | null = null;
    try {
      second = await runPass(conversation, env);
    } catch (error) {
      if (!(error instanceof RequestFailure)) throw error;
    }
    if (second?.kind !== 'answer') {
      // The restatement did not happen (request failed, too many steps, nothing came back): the first answer is
      // still the best thing we have, and it goes out flagged.
      return unverifiedResult(first.text, firstUnverified, MSG_REGENERATION_FAILED, afterFirstAnswer, conversation.trace);
    }

    const secondUnverified = checkNumbers(second.text, conversation.seen).unverified;
    if (secondUnverified.length === 0) return okResult(second.text, second.cutOff, conversation);
    return unverifiedResult(second.text, secondUnverified, MSG_UNVERIFIED, conversation.messages, conversation.trace);
  } catch (error) {
    if (!(error instanceof RequestFailure)) throw error; // a user abort, or a bug: not for us to hide
    if (error.kind === 'unreachable') {
      const saved = findCached(cache, question);
      if (saved) return savedAnswerResult(saved, history, question, MSG_SAVED);
    }
    return failureResult('unavailable', messageForFailure(error.kind), '', conversation.trace, history);
  }
}

function okResult(answer: string, cutOff: boolean, conversation: Conversation): AskResult {
  const result: AskResult = {
    answer,
    trace: conversation.trace,
    unverified: [],
    fromCache: false,
    status: 'ok',
    messages: conversation.messages,
  };
  if (cutOff) result.message = MSG_CUT_OFF;
  return result;
}

function unverifiedResult(answer: string, unverified: string[], message: string, messages: Message[], trace: TraceItem[]): AskResult {
  return { answer, trace, unverified, fromCache: false, status: 'unverified_numbers', message, messages };
}
