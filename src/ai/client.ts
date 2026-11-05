// The browser side of the AI guide: asks the Worker proxy, runs the tools the model asks for, checks the numbers.
//
// WHAT HAPPENS IN ask()
//   1. A verified saved answer for exactly this question (and no conversation yet) is returned without any request.
//   2. Otherwise a tool loop: POST { messages } to the Worker; if the model stopped to use tools, run EVERY requested
//      tool here with runTool, send the results back, and repeat. The Worker owns the model, the system prompt and the
//      tool definitions, so the body is `{ messages }` and nothing else.
//   3. checkNumbers compares the numbers in the answer with ALL the numbers the tools returned in this ask. If some are
//      missing, the model is asked ONCE to restate the answer using only numbers from the results (at most 3 requests).
//      Still unchecked: the answer comes back with status 'unverified_numbers' and the numbers, for the UI to warn.
//      Most upstream requests one ask can make: maxRounds + min(3, maxRounds) = 9 at the defaults.
//   4. If the AI cannot be reached (limit, outage, network) the saved answer for the same question is used when there
//      is one; otherwise status 'unavailable'. When nothing answers as the Worker at all (404 or 405, a 200 that is not
//      the model's JSON, or, on a page opened from a file, no connection at the default address) the result is
//      'unavailable' with reason 'not_configured': the AI is not part of this build, and trying again will not help.
//      That is said only while this page has not had a real model message from that address: once it has, every later
//      failure is 'try again later'. On an http(s) page a failed connection is the network breaking, never a sign
//      that nothing is deployed. A user abort is never converted: ask() rejects with the AbortError.
//   5. Before EVERY request the size is measured against the Worker's limits (with a margin). The oldest whole
//      question-and-answer exchanges of `history` are dropped until it fits (result.trimmed); if even the current
//      question and tool loop do not fit, nothing is sent (status 'unavailable', needsNewConversation).
//
// No DOM. The engine is reached only through EngineContext / runTool.
import { findCached, verifiedSampleQuestions } from './cached';
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
  /**
   * The conversation so far: the `messages` of the previous AskResult.
   *
   * The Worker refuses a request with more than 40 messages, more than 48,000 characters of text (counting message
   * text, tool inputs, tool results and thinking) or a body over 64 KB (Japanese is 3 bytes a character, so the byte
   * cap is reached first, at roughly 21,000 characters). ask() therefore keeps every request under CLIENT_LIMITS
   * (36 messages, 40,000 characters, 56,000 bytes): it drops the OLDEST whole exchanges from `history` (a user text
   * message and everything up to the next user text message, so a tool_use is never separated from its tool_result)
   * and reports it as `trimmed` / `trimmedExchanges`. The result's `messages` is the trimmed conversation.
   */
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
  /**
   * Present with status 'unavailable' when the AI is not there at all in this build (no Worker is deployed behind the
   * endpoint), as opposed to being busy or down right now. The UI says so plainly and does not suggest trying again.
   */
  reason?: 'not_configured';
  /** A short Japanese note for the user, when there is something to say. */
  message?: string;
  /** The conversation to pass as `history` next time. After a failure it is the history as it was (trimmed, if it was). */
  messages: Message[];
  /** True when old exchanges had to be dropped from `history` to keep the request inside the Worker's limits. */
  trimmed?: boolean;
  /** How many whole exchanges were dropped (present with `trimmed`). */
  trimmedExchanges?: number;
  /** True when nothing could be sent because even the current question (and tool loop) is too big. The UI should offer a new conversation. */
  needsNewConversation?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Constants and user-facing messages (Japanese)
// ---------------------------------------------------------------------------------------------------------------

export const DEFAULT_ENDPOINT = '/api/chat';
export const DEFAULT_MAX_ROUNDS = 6;
/** A tool result longer than this (as JSON text) is cut before it goes back to the model. */
export const MAX_TOOL_RESULT_CHARS = 20_000;
/** The regeneration pass (restating an answer with unverified numbers) makes at most this many requests. */
export const REGENERATION_MAX_ROUNDS = 3;
/**
 * What one request may hold, kept under the Worker's limits (worker/validate.ts: MAX_MESSAGES 40,
 * MAX_TOTAL_TEXT_CHARS 48,000, MAX_BODY_BYTES 64 KB) so a request the Worker is sure to refuse is never sent.
 * A test checks these stay inside the real constants.
 */
export const CLIENT_LIMITS = { maxMessages: 36, maxChars: 40_000, maxBytes: 56_000 } as const;

const TRUNCATION_MARKER = '…（結果が長すぎるため、ここから先は省略しました）';

/** The AI is busy or down right now, and there are saved answers to look at meanwhile. */
const MSG_UNAVAILABLE = 'いまはAIに接続できません。保存済みの質問を試してください。';
/** The same, when there are no saved answers to offer (so none is mentioned). */
const MSG_TRY_LATER = 'いまはAIに接続できません。時間をおいて、もう一度お試しください。';
/** Nothing is deployed behind the endpoint: not a matter of waiting. Three facts: not available, why, what still works. */
export const MSG_NOT_AVAILABLE =
  'このバージョンでは、AIへの質問は使えません（AIの接続先がまだ用意されていません）。地図、数値、前提の調整、人口の割り振りはそのまま使えます。';
const MSG_SAVED = 'いまはAIに接続できないため、保存済みの答えを表示しています。';
const MSG_TOO_LONG = '質問が長すぎます。';
const MSG_REJECTED = 'AIへの問い合わせでエラーが起きました。時間をおいて、もう一度お試しください。';
const MSG_TOO_MANY_STEPS = 'この質問は、調べる手順が多すぎて答えを出せませんでした。質問を短くするか、分けてたずねてください。';
const MSG_EMPTY = 'AIから答えが返ってきませんでした。もう一度お試しください。';
const MSG_CUT_OFF = '答えが長くなりすぎて、途中で終わっている可能性があります。';
/** The reply ran out of room before any text was written (nothing to show, so it is an error, not a cut-off answer). */
const MSG_OUT_OF_ROOM = '答えが長くなりすぎて、書き終える前に止まりました。質問を短くするか、分けてたずねてください。';
const MSG_REFUSED = 'この質問にはお答えできません。';
const MSG_NEW_CONVERSATION = '会話が長くなりすぎました。新しい質問を始めてください。';
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

/** A plain-data copy, so what the UI gets back shares no objects with the conversation or the saved answers. */
function cloneData<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Request size (the Worker's limits, measured before every request)
// ---------------------------------------------------------------------------------------------------------------

export interface RequestSize {
  messages: number;
  /** Counted the way worker/validate.ts counts: message text, text blocks, tool inputs (as JSON), tool results, thinking. */
  chars: number;
  /** UTF-8 bytes of the JSON body that would be sent. */
  bytes: number;
}

function charsOf(message: Message): number {
  if (typeof message.content === 'string') return message.content.length;
  let chars = 0;
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        chars += block.text.length;
        break;
      case 'tool_use':
        chars += JSON.stringify(block.input).length;
        break;
      case 'tool_result':
        chars += block.content.length;
        break;
      case 'thinking':
        chars += block.thinking.length + block.signature.length;
        break;
      case 'redacted_thinking':
        chars += block.data.length;
        break;
    }
  }
  return chars;
}

export function measureRequest(messages: Message[]): RequestSize {
  return {
    messages: messages.length,
    chars: messages.reduce((sum, message) => sum + charsOf(message), 0),
    bytes: new TextEncoder().encode(JSON.stringify({ messages })).length,
  };
}

function withinLimits(size: RequestSize): boolean {
  return size.messages <= CLIENT_LIMITS.maxMessages && size.chars <= CLIENT_LIMITS.maxChars && size.bytes <= CLIENT_LIMITS.maxBytes;
}

/** A user message that starts an exchange (the question), as opposed to one that only carries tool results. */
function startsExchange(message: Message): boolean {
  return message.role === 'user' && (typeof message.content === 'string' || !message.content.some((block) => block.type === 'tool_result'));
}

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

/**
 * Why a request did not give a usable response. A saved answer can stand in for 'unreachable' (busy or down right now)
 * and 'not_configured' (nothing is deployed); the others are about the request itself.
 */
type FailureKind = 'unreachable' | 'not_configured' | 'too_long' | 'rejected';

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

/**
 * The addresses that have given this page a real model message. Such an address is there: whatever goes wrong with it
 * afterwards (a dropped connection, a gateway error page, a 404 from a broken deploy) is "try again later", never
 * "this version has no AI". Kept for the life of the page, as module state: it is a fact about this page's session.
 */
const answered = new Set<string>();

/** Forgets what the page has seen (tests: each starts as a fresh page). */
export function forgetAnsweredEndpoints(): void {
  answered.clear();
}

/** Nothing there takes our request: 'not_configured', unless this page has already had an answer from this address. */
function notThere(env: Env): RequestFailure {
  return new RequestFailure(answered.has(env.endpoint) ? 'unreachable' : 'not_configured');
}

function failureForStatus(status: number, env: Env): RequestFailure {
  if (status === 413) return new RequestFailure('too_long');
  // 404 and 405: the address answers, but nothing there takes a POST (a static host, a Worker that was never deployed).
  if (status === 404 || status === 405) return notThere(env);
  // 429 (daily limit; the body says cached: true) and 5xx (502 upstream, 503 not configured / store down) are the
  // AI being unavailable right now. Everything else (403 origin, 400 body) is a problem with the request.
  if (status === 429 || status >= 500) return new RequestFailure('unreachable');
  return new RequestFailure('rejected');
}

/** A page opened from a file: its same-origin default address is file:///api/chat, where nothing can ever answer. */
function isFilePage(): boolean {
  return typeof location !== 'undefined' && location.protocol === 'file:';
}

/**
 * An abort the caller asked for passes through untouched; anything else that broke the transport is 'unreachable':
 * on an http(s) page a failed connection (offline, a lossy link, a reset) says nothing about whether a Worker is
 * deployed, because a host with no Worker answers with a 404, a 405 or its index page. The one place where a failed
 * connection does mean nothing is there is the default address of a page opened from a file.
 */
function transportFailure(error: unknown, env: Env): unknown {
  if (env.signal?.aborted) return error;
  return env.endpoint === DEFAULT_ENDPOINT && isFilePage() ? notThere(env) : new RequestFailure('unreachable');
}

/** JSON.parse and Response.json() throw a SyntaxError for text that is not JSON (checked by name: it may come from another realm). */
function isSyntaxError(error: unknown): boolean {
  return error instanceof Error && error.name === 'SyntaxError';
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
    throw transportFailure(error, env);
  }
  if (!response.ok) throw failureForStatus(response.status, env);

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    env.signal?.throwIfAborted(); // a stop the visitor asked for is never turned into "not available"
    // A page that is not JSON (a static host answering with its index.html) means no Worker is there. A body that was
    // cut off on the way is a transport failure like any other.
    throw isSyntaxError(error) ? notThere(env) : transportFailure(error, env);
  }
  // A 200 that is JSON but not a model message is not our Worker either.
  if (!isRecord(data) || !Array.isArray(data.content)) throw notThere(env);
  // Only a body with a stop_reason is the Worker relaying a model message; any stub that answers {"content":[]} is not.
  if (typeof data.stop_reason === 'string') answered.add(env.endpoint);
  return {
    content: rebuildBlocks(data.content),
    stopReason: typeof data.stop_reason === 'string' ? data.stop_reason : '',
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The tool loop
// ---------------------------------------------------------------------------------------------------------------

interface Conversation {
  /** The history (trimmable), then this ask's question, then the tool loop so far. */
  messages: Message[];
  /** How many leading messages of `messages` are history. Only these may be dropped. */
  historyCount: number;
  /** Whole exchanges dropped from the history so far. */
  trimmedExchanges: number;
  trace: TraceItem[];
  /** The tool results of this ask, as the model saw them (JSON text). checkNumbers checks the answer against these. */
  seen: string[];
}

type PassOutcome =
  | { kind: 'answer'; text: string; note?: string }
  | { kind: 'too_many_steps'; text: string }
  | { kind: 'empty'; refused: boolean; outOfRoom: boolean };

/** Even the current question and tool loop, with all the history dropped, do not fit in one request. */
class ConversationTooLong extends Error {
  constructor() {
    super('conversation too long for one request');
    this.name = 'ConversationTooLong';
  }
}

/** Drops the oldest whole exchange of the history. False when there is no history left to drop. */
function dropOldestExchange(conversation: Conversation): boolean {
  if (conversation.historyCount === 0) return false;
  let end = 1;
  while (end < conversation.historyCount && !startsExchange(conversation.messages[end]!)) end++;
  conversation.messages.splice(0, end);
  conversation.historyCount -= end;
  conversation.trimmedExchanges += 1;
  return true;
}

/** Makes the next request fit the Worker's limits: trims old exchanges, or throws when that cannot be enough. */
function fitRequest(conversation: Conversation): void {
  while (!withinLimits(measureRequest(conversation.messages))) {
    if (!dropOldestExchange(conversation)) throw new ConversationTooLong();
  }
}

function currentHistory(conversation: Conversation): Message[] {
  return conversation.messages.slice(0, conversation.historyCount);
}

function executeCall(call: ToolUseBlock, conversation: Conversation, ctx: EngineContext): ToolResultBlock {
  let result: unknown;
  try {
    result = runTool(call.name, call.input, ctx);
  } catch {
    // runTool reports bad model input as an { error } object; this is only a bug guard.
    result = { error: 'internal_error', message: MSG_TOOL_CRASHED };
  }
  conversation.trace.push({ tool: call.name, input: cloneData(call.input), result });

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
async function runPass(conversation: Conversation, env: Env, maxRounds: number): Promise<PassOutcome> {
  const earlierText: string[] = [];
  for (let round = 1; round <= maxRounds; round++) {
    fitRequest(conversation);
    const turn = await callModel(conversation.messages, env);
    const calls = turn.content.filter(isToolUse);
    const text = turn.content.filter(isText).map((block) => block.text).join('');

    if (turn.stopReason === 'tool_use' && calls.length > 0) {
      if (text.trim() !== '') earlierText.push(text);
      if (round === maxRounds) return { kind: 'too_many_steps', text: earlierText.join('\n\n') };
      conversation.messages.push({ role: 'assistant', content: turn.content });
      conversation.messages.push({ role: 'user', content: calls.map((call) => executeCall(call, conversation, env.ctx)) });
      continue;
    }

    const refused = turn.stopReason === 'refusal';
    const cutOff = turn.stopReason === 'max_tokens' || turn.stopReason === 'model_context_window_exceeded';
    if (text.trim() === '') return { kind: 'empty', refused, outOfRoom: cutOff };
    // A tool_use here (the reply was cut off) has no result to go with it, so it is not kept.
    conversation.messages.push({ role: 'assistant', content: turn.content.filter((block) => !isToolUse(block)) });
    return { kind: 'answer', text, ...(cutOff ? { note: MSG_CUT_OFF } : refused ? { note: MSG_REFUSED } : {}) };
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
    trace: saved.trace.map((item) => ({ tool: item.tool, input: cloneData(item.input), result: cloneData(item.result) })),
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
function failureResult(
  status: 'unavailable' | 'error',
  message: string,
  answer: string,
  conversation: Conversation,
): AskResult {
  return {
    answer,
    trace: conversation.trace,
    unverified: [],
    fromCache: false,
    status,
    message,
    messages: currentHistory(conversation),
  };
}

/** `cache` decides whether "try the saved questions" may be said: it is only true while some saved answer is verified. */
function messageForFailure(kind: FailureKind, cache: CachedAnswers | null): string {
  switch (kind) {
    case 'too_long':
      return MSG_TOO_LONG;
    case 'rejected':
      return MSG_REJECTED;
    case 'not_configured':
      return MSG_NOT_AVAILABLE;
    default:
      return verifiedSampleQuestions(cache).length > 0 ? MSG_UNAVAILABLE : MSG_TRY_LATER;
  }
}

function okResult(answer: string, note: string | undefined, conversation: Conversation): AskResult {
  const result: AskResult = {
    answer,
    trace: conversation.trace,
    unverified: [],
    fromCache: false,
    status: 'ok',
    messages: conversation.messages,
  };
  if (note !== undefined) result.message = note;
  return result;
}

function unverifiedResult(
  answer: string,
  unverified: string[],
  message: string,
  messages: Message[],
  conversation: Conversation,
): AskResult {
  return { answer, trace: conversation.trace, unverified, fromCache: false, status: 'unverified_numbers', message, messages };
}

/** Says that old exchanges were dropped, when they were. */
function withTrimInfo(result: AskResult, conversation: Conversation): AskResult {
  if (conversation.trimmedExchanges > 0) {
    result.trimmed = true;
    result.trimmedExchanges = conversation.trimmedExchanges;
  }
  return result;
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
    historyCount: history.length,
    trimmedExchanges: 0,
    trace: [],
    seen: [],
  };
  return withTrimInfo(await converse(question, cache, conversation, env), conversation);
}

async function converse(question: string, cache: CachedAnswers | null, conversation: Conversation, env: Env): Promise<AskResult> {
  try {
    const first = await runPass(conversation, env, env.maxRounds);
    if (first.kind === 'too_many_steps') return failureResult('error', MSG_TOO_MANY_STEPS, first.text, conversation);
    if (first.kind === 'empty') return failureResult('error', first.refused ? MSG_REFUSED : first.outOfRoom ? MSG_OUT_OF_ROOM : MSG_EMPTY, '', conversation);

    const firstUnverified = checkNumbers(first.text, conversation.seen).unverified;
    if (firstUnverified.length === 0) return okResult(first.text, first.note, conversation);

    // Some numbers are not in the tool results: ask once for a restatement, with a smaller budget of its own.
    const afterFirstAnswer = [...conversation.messages];
    const trimmedBeforeRestatement = conversation.trimmedExchanges;
    conversation.messages.push({ role: 'user', content: regenerationRequest(firstUnverified) });
    let second: PassOutcome | null = null;
    try {
      second = await runPass(conversation, env, Math.min(REGENERATION_MAX_ROUNDS, env.maxRounds));
    } catch (error) {
      if (!(error instanceof RequestFailure) && !(error instanceof ConversationTooLong)) throw error;
    }
    if (second?.kind !== 'answer') {
      // The restatement did not happen (request failed or did not fit, too many steps, nothing came back): the first
      // answer is still the best thing we have, and it goes out flagged. The conversation is the one after that answer.
      conversation.trimmedExchanges = trimmedBeforeRestatement;
      return unverifiedResult(first.text, firstUnverified, MSG_REGENERATION_FAILED, afterFirstAnswer, conversation);
    }

    const secondUnverified = checkNumbers(second.text, conversation.seen).unverified;
    if (secondUnverified.length === 0) return okResult(second.text, second.note, conversation);
    return unverifiedResult(second.text, secondUnverified, MSG_UNVERIFIED, conversation.messages, conversation);
  } catch (error) {
    if (error instanceof ConversationTooLong) {
      const result = failureResult('unavailable', MSG_NEW_CONVERSATION, '', conversation);
      result.needsNewConversation = true;
      return result;
    }
    if (!(error instanceof RequestFailure)) throw error; // a user abort, or a bug: not for us to hide
    if (error.kind === 'unreachable' || error.kind === 'not_configured') {
      const saved = findCached(cache, question);
      if (saved) return savedAnswerResult(saved, currentHistory(conversation), question, MSG_SAVED);
    }
    const failed = failureResult('unavailable', messageForFailure(error.kind, cache), '', conversation);
    if (error.kind === 'not_configured') failed.reason = 'not_configured';
    return failed;
  }
}
