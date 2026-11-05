import { TOOL_DEFS } from '../src/ai/toolDefs';
import {
  clientKey,
  consumeQuota,
  DEFAULT_IP_LIMIT,
  DEFAULT_TOTAL_LIMIT,
  parseLimit,
} from './rateLimit';
import { SYSTEM_PROMPT } from './systemPrompt';
import { MAX_BODY_BYTES, validateChatBody } from './validate';

export interface Env {
  /** Secret. Set with `wrangler secret put ANTHROPIC_API_KEY`; never in config, code, logs or responses. */
  ANTHROPIC_API_KEY: string;
  /** Secret. Set with `wrangler secret put IP_HASH_SECRET`; keys the HMAC that hides client IPs in KV. */
  IP_HASH_SECRET: string;
  /** KV namespace holding the daily counters. */
  RATE_KV: KVNamespace;
  /**
   * Workers Rate Limiting binding (`ratelimits` in wrangler.jsonc, 20 calls per 60 s per key), keyed by the HMAC'd
   * client identity. Stops a quick burst from one visitor. Required: when it is missing the Worker answers 503
   * `server_misconfigured` instead of skipping the check.
   */
  IP_LIMITER: RateLimit;
  /** Comma-separated list of page origins that may call this Worker (exact match). */
  ALLOWED_ORIGINS: string;
  DAILY_TOTAL_LIMIT?: string;
  DAILY_IP_LIMIT?: string;
}

// Decided here and never taken from the client. Behaviour per the Claude API documentation (verified 2026-11-06):
//  - With `thinking` omitted, claude-sonnet-5-5 runs adaptive thinking, and thinking tokens count toward max_tokens,
//    so the budget below leaves room for thinking plus an answer (1500 could cut the answer off or leave it empty).
//  - `output_config.effort` is GA (no beta header) and lives inside output_config, not at the top level.
//  - The client replays assistant turns with their signed thinking blocks and trims old exchanges. A thinking block is
//    valid only while the system prompt, tools and earlier messages are unchanged; on accounts created on or after
//    2026-08-31 a replay after trimming is a 400. `block_binding` with `drop_block` makes the API drop the first
//    mismatched block (and those after it) for that request only, and the request succeeds. It needs the beta header
//    below (without it block_binding is a 400) and works only with `type: 'adaptive'`.
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 3000;
const OUTPUT_CONFIG = { effort: 'low' } as const;
const THINKING = {
  type: 'adaptive',
  block_binding: { prefix_mismatch_behavior: 'drop_block' },
} as const;
const ANTHROPIC_BETA = 'thinking-binding-controls-2026-08-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Kept at or below 90 s on purpose: a 3,000-token answer fits well inside it, and a hung upstream must not hold a
// Worker request for minutes. worker/index.test.ts pins the value.
const UPSTREAM_TIMEOUT_MS = 60_000;

const CHAT_PATH = '/api/chat';

function allowedOriginSet(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

/** `corsOrigin` is only ever an origin that passed the allowlist check, or null. */
function jsonResponse(body: unknown, status: number, corsOrigin: string | null, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('vary', 'Origin');
  if (corsOrigin !== null) headers.set('access-control-allow-origin', corsOrigin);
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function preflightResponse(corsOrigin: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': corsOrigin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
    },
  });
}

/** Reads the request body as text, giving up as soon as it grows past the cap. Returns null when too large. */
async function readTextCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (request.body === null) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Releases the connection for a response we are not going to read. */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Nothing useful to do if the stream is already closed or errored.
  }
}

async function callAnthropic(
  env: Env,
  payload: unknown,
  fetchFn: typeof fetch,
  corsOrigin: string,
): Promise<Response> {
  const upstreamError = () => jsonResponse({ error: 'upstream_error' }, 502, corsOrigin);

  let upstream: Response;
  try {
    upstream = await fetchFn(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'anthropic-beta': ANTHROPIC_BETA,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Cloudflare's fetch accepts only 'follow' or 'manual' (the standard 'error' throws a TypeError in workerd, so
      // every call would fail). 'manual' hands a 3xx back unfollowed, and the status check below turns it into the
      // generic 502: the key header is never sent to a redirect target.
      redirect: 'manual',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // The error object is deliberately not logged: it could carry request details.
    console.warn('upstream request failed');
    return upstreamError();
  }

  // Only a 200 is relayed. Every other status, 4xx included, becomes the same generic 502 and the upstream
  // body is never returned: error text can describe our account (billing state, key problems) to a stranger.
  if (upstream.status !== 200) {
    await discardBody(upstream);
    console.warn(`upstream responded ${upstream.status}`);
    return upstreamError();
  }

  let text: string;
  try {
    text = await upstream.text();
    JSON.parse(text);
  } catch {
    console.warn('upstream body unreadable');
    return upstreamError();
  }
  // Defence in depth: the upstream never echoes the key, but nothing containing it may leave this Worker.
  if (text.includes(env.ANTHROPIC_API_KEY)) {
    console.warn('upstream body rejected');
    return upstreamError();
  }

  // Only the body and status are returned; upstream headers are dropped.
  return jsonResponse(text, upstream.status, corsOrigin);
}

/**
 * Answers every request with a response the Worker built itself. Anything that escapes the routing below (for example
 * a client that aborts mid-upload, which rejects the body read) would otherwise get the runtime's own error page,
 * without `nosniff` or the uniform JSON error. Nothing about the failure is logged: it could carry request details.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  try {
    return await routeRequest(request, env, fetchFn);
  } catch {
    console.error('unexpected error');
    return jsonResponse({ error: 'internal_error' }, 500, null);
  }
}

async function routeRequest(request: Request, env: Env, fetchFn: typeof fetch): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== CHAT_PATH) {
    return jsonResponse({ error: 'not_found' }, 404, null);
  }
  if (request.method !== 'POST' && request.method !== 'OPTIONS') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, null, { allow: 'POST, OPTIONS' });
  }

  // Only the public page's origin gets CORS headers, so the BROWSERS of other websites cannot read our answers or
  // spend our quota from their pages. This is not authentication: curl and any script outside a browser can send
  // whatever Origin they like. (A request without an Origin header is refused too, because browsers always send one
  // on a cross-origin POST.) The hard limits are the counters and, above all, the Anthropic workspace spend limit.
  const origin = request.headers.get('origin');
  if (origin === null || !allowedOriginSet(env).has(origin)) {
    return jsonResponse({ error: 'origin_not_allowed' }, 403, null);
  }
  if (request.method === 'OPTIONS') {
    return preflightResponse(origin);
  }

  // Body size: trust neither the header alone nor the body alone.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'body_too_large' }, 413, origin);
  }
  const text = await readTextCapped(request, MAX_BODY_BYTES);
  if (text === null) {
    return jsonResponse({ error: 'body_too_large' }, 413, origin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin);
  }
  const validation = validateChatBody(parsed);
  if (!validation.ok) {
    return jsonResponse({ error: validation.error }, 400, origin);
  }
  const { messages } = validation.value;

  // Fail closed when a secret or the burst limiter binding is missing, before any quota is charged. Names only;
  // values are never logged.
  const missing = !env.ANTHROPIC_API_KEY
    ? 'ANTHROPIC_API_KEY'
    : !env.IP_HASH_SECRET
      ? 'IP_HASH_SECRET'
      : !env.IP_LIMITER
        ? 'IP_LIMITER'
        : null;
  if (missing !== null) {
    console.error(`server configuration missing: ${missing}`);
    return jsonResponse({ error: 'server_misconfigured' }, 503, origin);
  }

  // Quota is charged only for requests that will actually reach the API.
  const clientIp = request.headers.get('cf-connecting-ip') ?? '';
  const limits = {
    perIp: parseLimit(env.DAILY_IP_LIMIT, DEFAULT_IP_LIMIT),
    total: parseLimit(env.DAILY_TOTAL_LIMIT, DEFAULT_TOTAL_LIMIT),
  };
  // Burst limit first (20 calls per 60 s per visitor, see wrangler.jsonc). The binding is per Cloudflare location and
  // eventually consistent, a courtesy limit like the daily counters. A refusal here costs no KV read or write.
  let withinBurst: boolean;
  try {
    const outcome = await env.IP_LIMITER.limit({ key: await clientKey(env.IP_HASH_SECRET, clientIp) });
    withinBurst = outcome.success;
  } catch {
    // Fail closed, like a KV read failure: without the limiter the burst cap cannot be enforced.
    console.error('burst limiter unavailable');
    return jsonResponse({ error: 'service_unavailable' }, 503, origin);
  }
  if (!withinBurst) {
    return jsonResponse({ cached: true, error: 'rate_limited' }, 429, origin);
  }

  let allowed: boolean;
  try {
    allowed = await consumeQuota(env.RATE_KV, clientIp, limits, env.IP_HASH_SECRET);
  } catch {
    // Fail closed on a failed READ: without the counters the spending cap cannot be enforced. (A failed write is
    // handled inside consumeQuota and does not end up here.)
    console.error('rate limit store unavailable');
    return jsonResponse({ error: 'service_unavailable' }, 503, origin);
  }
  if (!allowed) {
    return jsonResponse({ cached: true, error: 'rate_limited' }, 429, origin);
  }

  // Built only from validated messages and server-side constants. The tool definitions are always the canonical
  // ones from the shared module; whatever `tools` the client sent was never read.
  // The one cache_control breakpoint is on the system block: it caches tools + system, the constant prefix of about
  // 4.6K tokens, so each call re-reads that prefix at the cache-read price. Nothing here comes from the client.
  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    output_config: OUTPUT_CONFIG,
    thinking: THINKING,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages,
    tools: TOOL_DEFS,
  };
  return callAnthropic(env, payload, fetchFn, origin);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
