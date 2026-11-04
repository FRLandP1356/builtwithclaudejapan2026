import {
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
  /** KV namespace holding the daily counters. */
  RATE_KV: KVNamespace;
  /** Comma-separated list of page origins that may call this Worker (exact match). */
  ALLOWED_ORIGINS: string;
  DAILY_TOTAL_LIMIT?: string;
  DAILY_IP_LIMIT?: string;
}

// Decided here and never taken from the client.
const MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 1500;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
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

/**
 * Upstream statuses that are passed through to the page: success, and request-level errors (400, 404, 413, 422 ...).
 * Auth problems with our own key (401, 403), rate limits (429) and server errors become a generic 502.
 */
function isPassThroughStatus(status: number): boolean {
  if (status === 200) return true;
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
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
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // The error object is deliberately not logged: it could carry request details.
    console.warn('upstream request failed');
    return upstreamError();
  }

  if (!isPassThroughStatus(upstream.status)) {
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

export async function handleRequest(
  request: Request,
  env: Env,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== CHAT_PATH) {
    return jsonResponse({ error: 'not_found' }, 404, null);
  }
  if (request.method !== 'POST' && request.method !== 'OPTIONS') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, null, { allow: 'POST, OPTIONS' });
  }

  // Only the public page's origin may use this Worker. A request without an Origin header is refused too:
  // browsers always send one on a cross-origin POST.
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
  const { messages, tools } = validation.value;

  if (!env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not configured');
    return jsonResponse({ error: 'server_misconfigured' }, 500, origin);
  }

  // Quota is charged only for requests that will actually reach the API.
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const limits = {
    perIp: parseLimit(env.DAILY_IP_LIMIT, DEFAULT_IP_LIMIT),
    total: parseLimit(env.DAILY_TOTAL_LIMIT, DEFAULT_TOTAL_LIMIT),
  };
  let allowed: boolean;
  try {
    allowed = await consumeQuota(env.RATE_KV, ip, limits);
  } catch {
    // Fail closed: without the counters the spending cap cannot be enforced.
    console.error('rate limit store unavailable');
    return jsonResponse({ error: 'service_unavailable' }, 503, origin);
  }
  if (!allowed) {
    return jsonResponse({ cached: true, error: 'rate_limited' }, 429, origin);
  }

  // Built only from validated fields and server-side constants.
  const payload = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages,
    ...(tools.length > 0 ? { tools } : {}),
  };
  return callAnthropic(env, payload, fetchFn, origin);
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
