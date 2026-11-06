// Live checks of the DEPLOYED Worker and the saved answers.
//
// What it does: talks to the real Worker with the app's own ask() (src/ai/client.ts), a real EngineContext built from
// public/data, and a fetch wrapper that adds the page Origin, paces the requests, retries a 429/503 after a pause and
// tees every upstream response into a machine log. Phases (pick with --phases, default 1,2,3,3b,7):
//   1  the five sample questions, each in a fresh conversation -> public/data/cached_answers.json (status stays 'pending')
//   2  tool coverage: a question per tool until all 9 tools were called successfully by the real model
//   3  one long conversation (12 to 20 questions, history passed on) with tool calls, to see trimming
//   3b a second long conversation whose questions ask for derived numbers (differences, shares, ratios): the model then
//      tends to think before a tool call, so more thinking blocks end up in the history that is trimmed
//   6  (does not exist: the refusal path is covered by unit tests, not tested live)
//   7  token size: a one-line question and a question of 20,000 Japanese characters (sent straight to the Worker,
//      because ask() itself keeps requests under 56,000 bytes and would refuse it). 7a and 7b can be run apart.
// The cache and stop-reason checks (4 and 5) are computed from the log of the other phases.
//
// How to run (no vite-node here): `node scripts/ai_live_check.ts [options]`. Node strips the types itself; the script
// then starts a Vite server in middleware mode and loads itself through it, so the extension-less imports of src/
// resolve. Options: --phases 1,2,3 | --log <file> | --answers <file> | --dry-run | --help.
// (--endpoint, --pace-ms, --retry-wait-ms exist only for tests against a local stub; for the real Worker the pacing
// is never shorter than 4 s between requests and 30 s before a retry.)
//
// Safety: there is no secret on this machine (the API key lives only inside the Worker) and none is read, printed or
// written. The Worker, Cloudflare and the Anthropic Console are not touched. The run stops by itself when its running
// cost estimate passes 15 dollars, when the Worker answers 503 twice in a row, after 6 failed requests in a row (any
// status that is not 200), or after 330 requests (the per-visitor daily limit is raised to 400 for the run).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AskResult, Message, TraceItem } from '../src/ai/client';
import type { CachedAnswers } from '../src/ai/cached';
import type { EngineContext } from '../src/ai/tools';
import type { Area, Facility, Groups, Scenario, Series } from '../src/engine/types';

// ---------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------

const PAGE_ORIGIN = 'https://japan2100.pages.dev';
// The Worker has no public address of its own: the page's /api/chat (functions/api/chat.ts) hands the call to it.
const WORKER_URL = `${PAGE_ORIGIN}/api/chat`;
const PACE_MS = 4000; // least gap between two requests (end of one to start of the next)
const RETRY_WAIT_MS = 30_000; // pause before retrying a 429 or 503
const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 180_000;
const BUDGET_USD = 15;
const MAX_REQUESTS = 330;
const CACHE_WINDOW_MS = 5 * 60 * 1000;
/** Sonnet 5.5, US dollars per million tokens. */
const PRICE = { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 };
const DEFAULT_PHASES = ['1', '2', '3', '3b', '7'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const preview = (s: string, n = 200) => (s.length <= n ? s : s.slice(0, n - 1) + '…');
const out = (line: string) => process.stdout.write(line + '\n');

// ---------------------------------------------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------------------------------------------

/** Phase 2: per tool, a question and an alternative if the model did not call the tool. */
const TOOL_QUESTIONS: Array<[string, string[]]> = [
  ['find_area', ['「高野町」は何県にありますか？コードも教えてください。', '「白浜町」という町の、都道府県とコードを教えてください。']],
  [
    'get_series',
    ['田辺市の2020年、2050年、2100年の総人口を教えてください。', '白浜町の2020年から2100年までの総人口の推移を教えてください。'],
  ],
  [
    'compare_sources',
    ['田辺市について、国立社会保障・人口問題研究所の公式推計とこのアプリの計算は、2050年までにどのくらい違いますか？', '和歌山市の公式推計とこのアプリの計算は、どのくらい合っていますか？'],
  ],
  [
    'run_projection',
    [
      '田辺市で人口の移動が今の半分になったら、2100年の人口は標準の前提と比べてどう変わりますか？',
      '和歌山市で子ども女性比が1.1倍になったら、2100年の人口は標準と比べてどう変わりますか？',
    ],
  ],
  [
    'facility_check',
    ['田辺市の2050年の人口は、生活に必須の施設の人口の目安と比べてどうなっていますか？', '白浜町の2040年の人口で、人口の目安を下回る施設はありますか？'],
  ],
  [
    'run_allocation',
    [
      '和歌山県の2050年の人口を10%増やし、その分を全国から人口比で引くと、変化が大きい地域はどこですか？',
      '田辺市の2050年の人口を1,000人増やし、同じ人数を全国から引くとどうなりますか？',
    ],
  ],
  [
    'find_similar_now',
    ['2100年の田辺市は、今のどのくらいの人口の町と同じくらいですか？', '2075年の和歌山市の人口に近い、2020年の市区町村を教えてください。'],
  ],
  [
    'count_areas',
    ['2075年に人口が1,000人を下回る市区町村は、全国で何件ありますか？', '2100年に人口が3,000人以上の市区町村は、和歌山県に何件ありますか？'],
  ],
  [
    'get_age_groups',
    [
      '田辺市の2100年の子ども（0〜14歳）の人数と、65歳以上の割合を教えてください。',
      '和歌山県の2050年の、0〜14歳、15〜64歳、65歳以上の人数を教えてください。',
    ],
  ],
  // A second question for run_allocation: the answer has to come from the list of areas that lose people (largestDecreases).
  // The tool is already covered above, so this row only checks that the model reads the losing side.
  [
    'run_allocation',
    [
      '和歌山県の2100年の人口を10%増やし、その分を全国から人口比で引くと、人口が減る地域はどこで、いくつありますか？',
      '和歌山県の2100年の人口を10%増やし、その分を大阪府だけから引くと、人口が減る地域はどこですか？',
    ],
  ],
];

/** Phase 3: up to 20 questions in one conversation. Each needs numbers, so the model has to call tools. */
const LONG_QUESTIONS: string[] = [
  '田辺市の2020年と2050年の総人口を教えてください。',
  'では、2100年の田辺市の総人口はいくつですか？',
  '65歳以上の割合は、2020年と2100年でどう変わりますか？',
  '隣の白浜町の2020年、2050年、2100年の総人口も教えてください。',
  '白浜町の2050年の人口は、生活に必須の施設の人口の目安と比べてどうですか？',
  '田辺市の人口移動が半分になったら、2100年の人口は標準の前提と比べてどう変わりますか？',
  '2100年の田辺市は、今のどのくらいの人口の町に近いですか？',
  '和歌山県で、2075年に人口が3,000人を下回る市区町村は何件ありますか？',
  '田辺市で、公式の推計とこのアプリの計算は、2050年までにどのくらい違いますか？',
  '田辺市の2050年の人口を5%増やし、同じ人数を全国から人口比で引くと、変化が大きい地域はどこですか？',
  '高野町の2050年の人口を教えてください。',
  '高野町の2100年の人口は、標準の前提でいくつですか？',
  '高野町の2050年の人口は、施設の人口の目安と比べてどうですか？',
  '東京都の2020年と2100年の総人口を教えてください。',
  '夕張市の2100年の人口は、2020年の何%ですか？',
  '夕張市の2100年は、今のどのくらいの人口の町に近いですか？',
  '北海道で、2100年に人口が1,000人を下回る市区町村は何件ありますか？',
  '札幌市と大阪市の2100年の人口を比べると、どちらが多いですか？',
  '子ども女性比を1割下げたとき、札幌市の2100年の人口はどう変わりますか？',
  '稚内市の2100年の人口は、2020年から何人減りますか？',
];

/** Phase 3b: derived numbers and comparisons, which make the model reason (and so think) before it calls a tool. */
const LONG_QUESTIONS_B: string[] = [
  '田辺市の人口は、2020年から2100年までに何%減りますか？',
  '白浜町は何%減りますか？ 田辺市と比べて、どちらの減り方が大きいですか？',
  'その二つの減る割合の差は、何ポイントですか？',
  '和歌山市の2020年と2100年の総人口と、減る割合を教えてください。',
  '和歌山県内で、2100年に人口が1万人を超える市区町村は何件ありますか？',
  '田辺市で人口の移動が半分になると、2100年の人口は標準の前提と比べて何%違いますか？',
  '田辺市で子ども女性比が1.2倍になると、2100年の人口は標準と比べて何人増えますか？',
  '白浜町の2050年と2100年の65歳以上の人数の差は、何人ですか？',
  '高野町の2050年の人口は、人口の目安を下回る施設がありますか？ ある場合は何件ですか？',
  '夕張市の2100年の人口は、田辺市の2100年の人口の何分の一ですか？',
  '夕張市の2100年は、今のどのくらいの人口の町に近いですか？',
  '北海道で2100年に人口が1,000人を下回る市区町村は何件で、全体の何%ですか？',
  '札幌市の2020年から2100年までの人口の減り方は、田辺市と比べてどうですか？',
  '和歌山県の人口を5%増やし、同じ人数を全国から人口比で引くと、田辺市の2050年の人口は何人になりますか？',
  '最初に聞いた田辺市の減る割合を、もう一度教えてください。',
  '田辺市、白浜町、和歌山市のうち、2020年と比べて2100年の人口が最も多く残るのはどこですか？',
];

const ONE_LINER = 'こんにちは。';

/** "2060年から" / "2060〜" / "2060年以降": the first estimated year is 2055, so this is a wrong statement. */
const STARTS_IN_2060 = /2060\s*年?\s*(から|〜|～|~|以降|より)/;

const FORBIDDEN_WORDS = ['予測', '予想', '残せない', '維持できない', 'なくなる', '残すべき', 'やめるべき', '優先すべき'];

// ---------------------------------------------------------------------------------------------------------------
// Log types and run state
// ---------------------------------------------------------------------------------------------------------------

interface CallEntry {
  seq: number;
  phase: string;
  label: string;
  askId: number | null;
  logicalIndex: number;
  attempt: number;
  startedAt: string;
  startedAtMs: number;
  endedAtMs: number;
  elapsedMs: number;
  httpStatus: number; // 0 = the request did not complete
  error?: string;
  retryAfter?: string;
  request: {
    messages: number;
    expectedMessages: number;
    chars: number;
    bodyBytes: number;
    blocks: Record<string, number>;
    /** True when the first message is no longer the conversation's first question: old exchanges were dropped. */
    conversationTrimmed: boolean;
  };
  response?: {
    model?: unknown;
    stop_reason?: unknown;
    usage?: unknown;
    input_transformations?: unknown;
    content: Array<Record<string, unknown>>;
    textChars: number;
    firstTextPreview: string;
    extra: Record<string, string>;
  };
  errorBody?: string;
  inputTokensTotal: number;
  costUsd: number;
  costTotalUsd: number;
}

interface AskEntry {
  id: number;
  phase: string;
  label: string;
  question: string;
  startedAt: string;
  elapsedMs: number;
  status: string;
  fromCache?: boolean;
  answerChars: number;
  answerPreview: string;
  message?: string;
  unverified: string[];
  trace: Array<{ tool: string; ok: boolean }>;
  historyMessagesIn: number;
  messagesOut: number;
  trimmed: boolean;
  trimmedExchanges: number;
  needsNewConversation: boolean;
  callSeqs: number[];
  error?: string;
}

const state = {
  startedAt: new Date().toISOString(),
  calls: [] as CallEntry[],
  asks: [] as AskEntry[],
  phases: {} as Record<string, unknown>,
  costUsd: 0,
  stop: null as string | null,
  consecutive503: 0,
  consecutiveFailures: 0,
  lastEnd: 0,
  askCounter: 0,
  toolOk: new Map<string, number>(),
  current: { askId: null as number | null, phase: '-', label: '-', historyLen: 0, k: 0, convFirst: '' },
};

interface Opts {
  endpoint: string;
  logPath: string;
  answersPath: string;
  phases: Set<string>;
  paceMs: number;
  retryWaitMs: number;
  dryRun: boolean;
  /** Phase 1 only: ask just these saved questions (ids q1..q5); null = all. */
  only: Set<string> | null;
  root: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------------------------

function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : 0;
}

function costOf(usage: unknown): number {
  if (!isRec(usage)) return 0;
  return (
    (num(usage.input_tokens) * PRICE.input +
      num(usage.cache_creation_input_tokens) * PRICE.cacheWrite +
      num(usage.cache_read_input_tokens) * PRICE.cacheRead +
      num(usage.output_tokens) * PRICE.output) /
    1e6
  );
}

function inputTotal(usage: unknown): number {
  if (!isRec(usage)) return 0;
  return num(usage.input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.cache_read_input_tokens);
}

function countBlocks(messages: Message[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    if (typeof m.content === 'string') {
      counts.text_message = (counts.text_message ?? 0) + 1;
      continue;
    }
    for (const b of m.content) counts[b.type] = (counts[b.type] ?? 0) + 1;
  }
  return counts;
}

/** One line per content block: type and sizes, never the full text. */
function describeContent(content: unknown): { blocks: Array<Record<string, unknown>>; textChars: number; firstText: string } {
  const blocks: Array<Record<string, unknown>> = [];
  let textChars = 0;
  let firstText = '';
  if (!Array.isArray(content)) return { blocks, textChars, firstText };
  for (const b of content) {
    if (!isRec(b)) {
      blocks.push({ type: 'unknown' });
      continue;
    }
    const type = String(b.type);
    if (type === 'text') {
      const text = typeof b.text === 'string' ? b.text : '';
      textChars += text.length;
      if (firstText === '' && text !== '') firstText = text;
      blocks.push({ type, chars: text.length });
    } else if (type === 'thinking') {
      blocks.push({
        type,
        chars: typeof b.thinking === 'string' ? b.thinking.length : 0,
        signatureChars: typeof b.signature === 'string' ? b.signature.length : 0,
      });
    } else if (type === 'redacted_thinking') {
      blocks.push({ type, chars: typeof b.data === 'string' ? b.data.length : 0 });
    } else if (type === 'tool_use') {
      blocks.push({ type, name: b.name, inputChars: JSON.stringify(b.input ?? null).length });
    } else {
      blocks.push({ type });
    }
  }
  return { blocks, textChars, firstText };
}

function summarizeResponse(data: unknown): CallEntry['response'] | undefined {
  if (!isRec(data)) return undefined;
  const { blocks, textChars, firstText } = describeContent(data.content);
  const known = new Set(['content', 'usage', 'input_transformations', 'model', 'stop_reason', 'id', 'type', 'role', 'stop_sequence']);
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) if (!known.has(k)) extra[k] = preview(JSON.stringify(v) ?? 'undefined', 300);
  return {
    model: data.model,
    stop_reason: data.stop_reason,
    usage: data.usage,
    input_transformations: data.input_transformations,
    content: blocks,
    textChars,
    firstTextPreview: preview(firstText),
    extra,
  };
}

function traceStatus(trace: TraceItem[]): Array<{ tool: string; ok: boolean }> {
  return trace.map((t) => ({ tool: t.tool, ok: !(isRec(t.result) && typeof t.result.error === 'string') }));
}

function saveLog(opts: Opts, summary?: unknown): void {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const body = {
    meta: {
      script: 'scripts/ai_live_check.ts',
      startedAt: state.startedAt,
      savedAt: new Date().toISOString(),
      endpoint: opts.endpoint,
      origin: PAGE_ORIGIN,
      phases: [...opts.phases],
      stoppedBecause: state.stop,
      pricesUsdPerMillionTokens: PRICE,
    },
    summary: summary ?? null,
    phases: state.phases,
    asks: state.asks,
    calls: state.calls,
  };
  writeFileSync(opts.logPath, JSON.stringify(body, null, 1) + '\n');
}

// ---------------------------------------------------------------------------------------------------------------
// The fetch wrapper: Origin header, pacing, retry on 429/503, log of every response
// ---------------------------------------------------------------------------------------------------------------

type ClientMod = typeof import('../src/ai/client');

function makeFetch(opts: Opts, client: ClientMod): typeof fetch {
  return async (_input, init) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    let messages: Message[] = [];
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRec(parsed) && Array.isArray(parsed.messages)) messages = parsed.messages as Message[];
    } catch {
      // the log will show 0 messages
    }
    const cur = state.current;
    const logicalIndex = cur.k++;
    const size = client.measureRequest(messages);
    const first = messages[0]?.content;
    const request: CallEntry['request'] = {
      messages: size.messages,
      expectedMessages: cur.historyLen + 1 + 2 * logicalIndex,
      chars: size.chars,
      bodyBytes: new TextEncoder().encode(body).length,
      blocks: countBlocks(messages),
      conversationTrimmed: typeof first === 'string' ? first !== cur.convFirst : true,
    };

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      if (state.stop) throw new Error(`run stopped: ${state.stop}`);
      if (state.calls.length >= MAX_REQUESTS) {
        state.stop = `request cap ${MAX_REQUESTS} reached`;
        throw new Error(`run stopped: ${state.stop}`);
      }
      const wait = state.lastEnd + opts.paceMs - Date.now();
      if (wait > 0) await sleep(wait);

      const startedAtMs = Date.now();
      const headers = new Headers(init?.headers);
      headers.set('origin', PAGE_ORIGIN);
      const signals = [AbortSignal.timeout(REQUEST_TIMEOUT_MS)];
      if (init?.signal) signals.push(init.signal);
      const entry: CallEntry = {
        seq: state.calls.length + 1,
        phase: cur.phase,
        label: cur.label,
        askId: cur.askId,
        logicalIndex,
        attempt,
        startedAt: new Date(startedAtMs).toISOString(),
        startedAtMs,
        endedAtMs: startedAtMs,
        elapsedMs: 0,
        httpStatus: 0,
        request,
        inputTokensTotal: 0,
        costUsd: 0,
        costTotalUsd: state.costUsd,
      };

      let response: Response;
      let text = '';
      try {
        response = await fetch(opts.endpoint, { method: 'POST', headers, body, credentials: 'omit', signal: AbortSignal.any(signals) });
        text = await response.clone().text();
      } catch (error) {
        entry.endedAtMs = Date.now();
        entry.elapsedMs = entry.endedAtMs - startedAtMs;
        entry.error = preview(String(error), 300);
        state.lastEnd = entry.endedAtMs;
        state.calls.push(entry);
        state.consecutive503 = 0;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= 6) state.stop = 'six requests in a row did not get HTTP 200';
        logCall(entry);
        saveLog(opts);
        throw error;
      }
      entry.endedAtMs = Date.now();
      entry.elapsedMs = entry.endedAtMs - startedAtMs;
      entry.httpStatus = response.status;
      state.lastEnd = entry.endedAtMs;
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) entry.retryAfter = retryAfter;

      if (response.status === 200) {
        try {
          const data: unknown = JSON.parse(text);
          entry.response = summarizeResponse(data);
          const usage = isRec(data) ? data.usage : undefined;
          entry.inputTokensTotal = inputTotal(usage);
          entry.costUsd = costOf(usage);
          state.costUsd += entry.costUsd;
          entry.costTotalUsd = state.costUsd;
        } catch {
          entry.error = 'response body is not JSON';
          entry.errorBody = preview(text);
        }
      } else {
        entry.errorBody = preview(text, 400);
      }
      state.calls.push(entry);
      logCall(entry);
      saveLog(opts);

      if (state.costUsd > BUDGET_USD) state.stop = `estimated cost passed ${BUDGET_USD} dollars`;
      state.consecutive503 = response.status === 503 ? state.consecutive503 + 1 : 0;
      state.consecutiveFailures = response.status === 200 ? 0 : state.consecutiveFailures + 1;
      if (state.consecutiveFailures >= 6) {
        state.stop = 'six requests in a row did not get HTTP 200';
        return response;
      }
      if (state.consecutive503 >= 2) {
        state.stop = 'the Worker answered 503 twice in a row';
        return response;
      }
      const retryable = response.status === 429 || response.status === 503;
      if (retryable && attempt <= MAX_RETRIES && !state.stop) {
        out(`  ... HTTP ${response.status}; waiting ${Math.round(opts.retryWaitMs / 1000)} s, then retry ${attempt}/${MAX_RETRIES}`);
        await response.body?.cancel();
        await sleep(opts.retryWaitMs);
        continue;
      }
      return response;
    }
    throw new Error('unreachable');
  };
}

function logCall(e: CallEntry): void {
  const r = e.response;
  const usage = isRec(r?.usage) ? r.usage : {};
  const tools = (r?.content ?? []).filter((b) => b.type === 'tool_use').map((b) => String(b.name));
  out(
    `[${String(e.seq).padStart(3)}] ${e.phase}/${e.label} try${e.attempt} HTTP ${e.httpStatus} ${(e.elapsedMs / 1000).toFixed(1)}s` +
      ` msgs=${e.request.messages}${e.request.conversationTrimmed ? '(trimmed)' : ''}` +
      (r
        ? ` stop=${String(r.stop_reason)} in=${num(usage.input_tokens)}+w${num(usage.cache_creation_input_tokens)}+r${num(usage.cache_read_input_tokens)}` +
          ` out=${num(usage.output_tokens)}` +
          (tools.length ? ` tools=${tools.join(',')}` : '') +
          (Array.isArray(r.input_transformations) && r.input_transformations.length ? ` transforms=${JSON.stringify(r.input_transformations)}` : '')
        : e.errorBody
          ? ` body=${e.errorBody}`
          : e.error
            ? ` error=${e.error}`
            : '') +
      ` cost+${e.costUsd.toFixed(4)} total=$${state.costUsd.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The engine context (like test/helpers/engineContext.ts, without the test-only imports)
// ---------------------------------------------------------------------------------------------------------------

async function buildContext(root: string): Promise<EngineContext> {
  const { projectAll } = await import('../src/engine/project');
  const dir = join(root, 'public/data/areas');
  const areas: Area[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    areas.push(...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Area[]));
  }
  const facilities = JSON.parse(readFileSync(join(root, 'public/data/facilities.json'), 'utf8')) as Facility[];
  const groups = JSON.parse(readFileSync(join(root, 'public/data/groups.json'), 'utf8')) as Groups;
  const memo = new Map<string, Map<string, Series>>();
  const run = (s: Scenario): Map<string, Series> => {
    const key = JSON.stringify([s.cwrMult, s.migMode, s.migScale, s.infraStrength]);
    let hit = memo.get(key);
    if (!hit) {
      hit = projectAll(areas, s, 2100, facilities);
      memo.set(key, hit);
    }
    return hit;
  };
  return { areas, facilities, groups, run };
}

// ---------------------------------------------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------------------------------------------

interface Harness {
  opts: Opts;
  ctx: EngineContext;
  client: ClientMod;
  fetchFn: typeof fetch;
  sampleQuestions: string[];
  toolNames: readonly string[];
  numbers: { namesLaterYear: (t: string) => boolean; traceUsesEstimate: (t: TraceItem[]) => boolean; source: string };
}

async function runAsk(h: Harness, phase: string, label: string, question: string, history?: Message[], convFirst?: string): Promise<{ result: AskResult | null; entry: AskEntry }> {
  const id = ++state.askCounter;
  state.current = { askId: id, phase, label, historyLen: history?.length ?? 0, k: 0, convFirst: convFirst ?? question };
  const firstSeq = state.calls.length + 1;
  const t0 = Date.now();
  let result: AskResult | null = null;
  let error: string | undefined;
  out(`--- ask ${id} (${phase}/${label}): ${question.slice(0, 60)}${question.length > 60 ? '…' : ''}`);
  try {
    result = await h.client.ask(question, h.ctx, { endpoint: h.opts.endpoint, fetchFn: h.fetchFn, ...(history && history.length ? { history } : {}) });
  } catch (e) {
    error = preview(String(e), 300);
  }
  const callSeqs = state.calls.slice(firstSeq - 1).map((c) => c.seq);
  const entry: AskEntry = {
    id,
    phase,
    label,
    question: preview(question, 120),
    startedAt: new Date(t0).toISOString(),
    elapsedMs: Date.now() - t0,
    status: result?.status ?? 'exception',
    answerChars: result?.answer.length ?? 0,
    answerPreview: preview(result?.answer ?? ''),
    unverified: result?.unverified ?? [],
    trace: result ? traceStatus(result.trace) : [],
    historyMessagesIn: history?.length ?? 0,
    messagesOut: result?.messages.length ?? 0,
    trimmed: result?.trimmed ?? false,
    trimmedExchanges: result?.trimmedExchanges ?? 0,
    needsNewConversation: result?.needsNewConversation ?? false,
    callSeqs,
  };
  if (result) {
    entry.fromCache = result.fromCache;
    if (result.message) entry.message = result.message;
    for (const t of entry.trace) if (t.ok) state.toolOk.set(t.tool, (state.toolOk.get(t.tool) ?? 0) + 1);
  }
  if (error) entry.error = error;
  state.asks.push(entry);
  out(
    `    => ${entry.status}${entry.message ? ` (${entry.message})` : ''} answer=${entry.answerChars} chars, tools=[${entry.trace.map((t) => t.tool + (t.ok ? '' : '!')).join(',')}], calls=${callSeqs.length}` +
      `${entry.trimmed ? `, TRIMMED ${entry.trimmedExchanges}` : ''}${error ? `, ERROR ${error}` : ''}`,
  );
  saveLog(h.opts);
  return { result, entry };
}

const okStatus = (r: AskResult | null): boolean => r !== null && (r.status === 'ok' || r.status === 'unverified_numbers');

// ---------------------------------------------------------------------------------------------------------------
// Phase 1: saved answers
// ---------------------------------------------------------------------------------------------------------------

interface NumbersCheck {
  status: string;
  unverified: string[];
  namesYearAfter2050: boolean;
  estimateLabelInText: boolean;
  yearAfter2050WithoutLabelInText: boolean;
  traceUsesEstimate: boolean;
  forbiddenWordHits: string[];
  toolNameLeaks: string[];
  toolsInTrace: string[];
  /** The text says the app's estimates start in 2060 (they start in 2055, the first 5-year step after the official end). */
  saysEstimatesStartIn2060: boolean;
}

function numbersCheck(h: Harness, result: AskResult): NumbersCheck {
  const answer = result.answer;
  const later = h.numbers.namesLaterYear(answer);
  const labelInText = answer.includes('試算');
  return {
    status: result.status,
    unverified: result.unverified,
    namesYearAfter2050: later,
    estimateLabelInText: labelInText,
    yearAfter2050WithoutLabelInText: later && !labelInText,
    traceUsesEstimate: h.numbers.traceUsesEstimate(result.trace),
    forbiddenWordHits: FORBIDDEN_WORDS.filter((w) => answer.includes(w)),
    toolNameLeaks: h.toolNames.filter((n) => answer.includes(n)),
    toolsInTrace: [...new Set(result.trace.map((t) => t.tool))],
    saysEstimatesStartIn2060: STARTS_IN_2060.test(answer),
  };
}

/** What is wrong with a saved answer: numbers the tools did not return, and a wrong first estimated year. */
function defects(r: AskResult | null, h: Harness): number {
  if (!okStatus(r)) return Number.POSITIVE_INFINITY;
  return r!.unverified.length + (STARTS_IN_2060.test(r!.answer) ? 1 : 0) + (h.toolNames.some((n) => r!.answer.includes(n)) ? 1 : 0);
}

/** True when `a` is a better saved answer than `b`: usable beats unusable, fewer defects beats more. */
function betterAnswer(a: AskResult | null, b: AskResult | null, h: Harness): boolean {
  return defects(a, h) < defects(b, h);
}

async function phase1(h: Harness): Promise<void> {
  const file = h.opts.answersPath;
  const items: Rec[] = [];
  for (let i = 0; i < h.sampleQuestions.length; i++) {
    if (state.stop) break;
    const question = h.sampleQuestions[i]!;
    if (h.opts.only && !h.opts.only.has(`q${i + 1}`)) continue;
    // Ask; if the answer is unusable or still has numbers the tools did not return, ask again (3 tries in all) and keep the better one.
    let best: { result: AskResult | null; entry: AskEntry } | null = null;
    let totalCalls = 0;
    const attempts: Rec[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      const got = await runAsk(h, '1', `q${i + 1}${attempt > 1 ? '_again' : ''}`, question);
      totalCalls += got.entry.callSeqs.length;
      attempts.push({ askId: got.entry.id, status: got.entry.status, unverified: got.entry.unverified, calls: got.entry.callSeqs.length });
      if (best === null || betterAnswer(got.result, best.result, h)) best = got;
      if (defects(best.result, h) === 0 || state.stop) break;
      out('    (not clean; asking this sample question once more)');
    }
    const result = best?.result ?? null;
    const item: Rec = { id: `q${i + 1}`, question, keptAskId: best?.entry.id, status: result?.status ?? 'exception', workerCallsForThisQuestion: totalCalls, attempts };
    const cached = JSON.parse(readFileSync(file, 'utf8')) as CachedAnswers;
    const index = cached.answers.findIndex((a) => a.id === `q${i + 1}`);
    const slot = index >= 0 ? cached.answers[index]! : undefined;
    if (slot && slot.question === question && result && okStatus(result)) {
      const check = numbersCheck(h, result);
      item.checks = check;
      const notes = [
        `Generated by scripts/ai_live_check.ts from the deployed Worker (claude-sonnet-5-5), status ${result.status}, ${totalCalls} Worker calls (${attempts.length} ask${attempts.length > 1 ? 's' : ''}, the better one kept).`,
        'Pending: the owner reads it before it becomes verified.',
        result.unverified.length ? `Numbers not found in the tool results: ${result.unverified.join(', ')}.` : 'Every number in the answer was found in the tool results.',
        check.yearAfter2050WithoutLabelInText ? 'Names a year after 2050 without the word 試算 in the text (the app adds its own label).' : '',
        check.saysEstimatesStartIn2060 ? 'WRONG: says the estimates start in 2060 (the first estimated year is 2055).' : '',
        check.forbiddenWordHits.length ? `Contains words the system prompt avoids: ${check.forbiddenWordHits.join(', ')}.` : '',
      ].filter(Boolean);
      cached.answers[index] = {
        id: slot.id,
        question: slot.question,
        answer: result.answer,
        trace: result.trace.map((t) => ({ tool: t.tool, input: t.input, result: t.result })),
        status: 'pending', // never 'verified': the owner reads the answers first
        generatedAt: new Date().toISOString(),
        note: notes.join(' '),
      };
      writeFileSync(file, JSON.stringify(cached, null, 2) + '\n');
    } else if (slot) {
      slot.note = `Live run on ${new Date().toISOString().slice(0, 10)} gave no usable answer (${result?.status ?? 'exception'}); nothing saved.`;
      writeFileSync(file, JSON.stringify(cached, null, 2) + '\n');
    }
    items.push(item);
    state.phases['1'] = { items };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 2: tool coverage
// ---------------------------------------------------------------------------------------------------------------

async function phase2(h: Harness): Promise<void> {
  const rows: Rec[] = [];
  for (const [tool, questions] of TOOL_QUESTIONS) {
    if (state.stop) break;
    const tries: Rec[] = [];
    let called = false;
    for (let t = 0; t < questions.length && !called; t++) {
      const { result, entry } = await runAsk(h, '2', `${tool}_try${t + 1}`, questions[t]!);
      const ok = entry.trace.some((x) => x.tool === tool && x.ok);
      tries.push({ question: questions[t], askId: entry.id, status: entry.status, toolsInTrace: entry.trace, targetToolCalledOk: ok });
      called = ok;
      if (!ok && (state.toolOk.get(tool) ?? 0) > 0 && result) break; // the tool was called successfully in another trace: one try is enough
      if (state.stop) break;
    }
    rows.push({ tool, tries, calledOk: called, calledOkAnywhere: (state.toolOk.get(tool) ?? 0) > 0 });
    state.phases['2'] = { rows };
  }
  const missing = h.toolNames.filter((n) => (state.toolOk.get(n) ?? 0) === 0);
  state.phases['2'] = { rows, successfulCallsByTool: Object.fromEntries(state.toolOk), toolsNeverCalledOk: missing };
  out(`Phase 2 done. Tools never called successfully: ${missing.length ? missing.join(', ') : 'none'}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 3: one long conversation
// ---------------------------------------------------------------------------------------------------------------

/**
 * One long conversation: every question gets the previous result's `messages` as history. At least 12 questions; after
 * that it stops once trimming has been seen in three questions (otherwise it goes on to the end of the list).
 */
async function longConversation(h: Harness, phase: string, prefix: string, questions: string[]): Promise<void> {
  let conv: Message[] = [];
  let convFirst = questions[0]!;
  const turns: Rec[] = [];
  let trimTurns = 0;
  let resets = 0;
  for (let i = 0; i < questions.length && !state.stop; i++) {
    const question = questions[i]!;
    if (conv.length === 0) convFirst = question;
    const { result, entry } = await runAsk(h, phase, `${prefix}_${String(i + 1).padStart(2, '0')}`, question, conv, convFirst);
    turns.push({ n: i + 1, askId: entry.id, status: entry.status, calls: entry.callSeqs.length, trimmedExchanges: entry.trimmedExchanges, historyMessagesIn: entry.historyMessagesIn, messagesOut: entry.messagesOut, tools: entry.trace.map((t) => t.tool) });
    if (entry.trimmed) trimTurns++;
    if (result) {
      if (result.needsNewConversation) {
        conv = [];
        resets++;
      } else {
        conv = result.messages;
      }
    }
    if (i + 1 >= 12 && trimTurns >= 3) break;
  }
  state.phases[phase] = { turns, turnsAsked: turns.length, trimTurns, conversationResets: resets };
}

const phase3 = (h: Harness): Promise<void> => longConversation(h, '3', 'long', LONG_QUESTIONS);
const phase3b = (h: Harness): Promise<void> => longConversation(h, '3b', 'longB', LONG_QUESTIONS_B);

// ---------------------------------------------------------------------------------------------------------------
// Phase 6 and 7
// ---------------------------------------------------------------------------------------------------------------


function buildBigQuestion(areas: Area[], targetChars: number): string {
  const templates: Array<(a: Area, y: number) => string> = [
    (a, y) => `${a.prefName}${a.name}の${y}年の総人口と、65歳以上の人の割合を教えてください。`,
    (a, y) => `${a.name}は、${y}年に人口が何人くらいになりますか。`,
    (a, y) => `${y}年の${a.name}で、子どもの数はどのくらい減りますか。`,
    (a, y) => `${a.prefName}の${a.name}について、${y}年の人口の見通しを知りたいです。`,
  ];
  const suffix = '（ここまでの質問は読み飛ばして構いません。道具は使わず、「はい」とだけ答えてください。）';
  let text = '';
  for (let i = 0; text.length < targetChars - suffix.length; i++) {
    const area = areas[(i * 37) % areas.length]!;
    text += `${i + 1}. ${templates[i % templates.length]!(area, 2020 + 5 * (i % 17))}\n`;
  }
  return text.slice(0, targetChars - suffix.length) + suffix;
}

/** One request straight through the wrapper (no tool loop): the first response is what is measured. */
async function postDirect(h: Harness, phase: string, label: string, content: string): Promise<Rec> {
  state.current = { askId: null, phase, label, historyLen: 0, k: 0, convFirst: content };
  let status = 0;
  try {
    const res = await h.fetchFn(h.opts.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', content }] }) });
    status = res.status;
    await res.arrayBuffer();
  } catch (e) {
    out(`    direct post failed: ${preview(String(e), 200)}`);
  }
  const call = state.calls.filter((c) => c.phase === phase && c.label === label).pop();
  return {
    label,
    chars: content.length,
    nonAsciiChars: [...content].filter((c) => c.charCodeAt(0) > 0x7f).length,
    bodyBytes: call?.request.bodyBytes ?? null,
    httpStatus: status,
    inputTokensTotal: call?.inputTokensTotal ?? null,
    usage: call?.response?.usage ?? null,
    stop_reason: call?.response?.stop_reason ?? null,
    input_transformations: call?.response?.input_transformations ?? null,
  };
}

async function phase7(h: Harness, which: Set<string>): Promise<void> {
  const rows: Rec[] = [];
  const keep = (state.phases['7'] as { rows?: Rec[] } | undefined)?.rows ?? [];
  rows.push(...keep);
  if (which.has('7') || which.has('7a')) rows.push(await postDirect(h, '7', '7a_one_line', ONE_LINER));
  if ((which.has('7') || which.has('7b')) && !state.stop) {
    const big = buildBigQuestion(h.ctx.areas, 20_000);
    out(`    big question: ${big.length} chars, ${new TextEncoder().encode(JSON.stringify({ messages: [{ role: 'user', content: big }] })).length} body bytes`);
    rows.push(await postDirect(h, '7', '7b_20000_chars', big));
  }
  const small = rows.find((r) => r.label === '7a_one_line');
  const big = rows.find((r) => r.label === '7b_20000_chars');
  const derived: Rec = {};
  if (small && big && typeof small.inputTokensTotal === 'number' && typeof big.inputTokensTotal === 'number' && typeof big.bodyBytes === 'number') {
    const extraTokens = big.inputTokensTotal - small.inputTokensTotal;
    derived.baselineTokens = small.inputTokensTotal;
    derived.tokensForTheLongQuestionAlone = extraTokens;
    derived.tokensPerChar = extraTokens / (20_000 - ONE_LINER.length);
    if (typeof big.nonAsciiChars === 'number') derived.tokensPerNonAsciiChar = extraTokens / big.nonAsciiChars;
    derived.tokensPerBodyByte = extraTokens / big.bodyBytes;
    derived.readmeCeilingTokens = big.bodyBytes + 4600; // worker/README.md: one token per body byte, plus ~4,600 for the fixed prefix
    derived.observedShareOfCeiling = big.inputTokensTotal / (big.bodyBytes + 4600);
  }
  state.phases['7'] = { rows, derived };
}

// ---------------------------------------------------------------------------------------------------------------
// Summary: phases 4 and 5 and the totals, computed from the log
// ---------------------------------------------------------------------------------------------------------------

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function buildSummary(h: Harness | null): Rec {
  const ok = state.calls.filter((c) => c.httpStatus === 200 && c.response);
  const byStatus: Record<string, number> = {};
  for (const c of state.calls) byStatus[String(c.httpStatus)] = (byStatus[String(c.httpStatus)] ?? 0) + 1;

  // Phase 4: cache reads for calls that follow another successful call within five minutes.
  const inWindow: CallEntry[] = [];
  const outsideWindow: CallEntry[] = [];
  let prevEnd: number | null = null;
  const firstOfAsk = new Set<number>();
  for (const c of ok) {
    if (prevEnd !== null && c.startedAtMs - prevEnd <= CACHE_WINDOW_MS) inWindow.push(c);
    else outsideWindow.push(c);
    prevEnd = c.endedAtMs;
    if (c.askId !== null && c.logicalIndex === 0) firstOfAsk.add(c.seq);
  }
  const readOf = (c: CallEntry): number => num((c.response?.usage as Rec | undefined)?.cache_read_input_tokens);
  const writeOf = (c: CallEntry): number => num((c.response?.usage as Rec | undefined)?.cache_creation_input_tokens);
  const reading = inWindow.filter((c) => readOf(c) > 0);
  const firstCalls = inWindow.filter((c) => firstOfAsk.has(c.seq));
  const cache = {
    callsWithinFiveMinutesOfAPreviousCall: inWindow.length,
    ofThemReadingTheCache: reading.length,
    shareReading: inWindow.length ? reading.length / inWindow.length : null,
    cacheReadTokens: { min: reading.length ? Math.min(...reading.map(readOf)) : null, median: median(reading.map(readOf)), max: reading.length ? Math.max(...reading.map(readOf)) : null },
    firstCallOfAnAskWithinWindow: { n: firstCalls.length, reading: firstCalls.filter((c) => readOf(c) > 0).length },
    withinWindowButNoRead: inWindow.filter((c) => readOf(c) === 0).map((c) => ({ seq: c.seq, label: c.label, cache_creation: writeOf(c), input: c.inputTokensTotal })),
    callsWithoutAPreviousCallWithinWindow: outsideWindow.map((c) => ({ seq: c.seq, label: c.label, cache_creation: writeOf(c), cache_read: readOf(c) })),
    totalCacheReadTokens: ok.reduce((s, c) => s + readOf(c), 0),
    totalCacheWriteTokens: ok.reduce((s, c) => s + writeOf(c), 0),
  };

  // Phase 5: stop reasons.
  const stopReasons: Record<string, number> = {};
  for (const c of ok) {
    const k = String(c.response!.stop_reason);
    stopReasons[k] = (stopReasons[k] ?? 0) + 1;
  }
  const maxTokens = ok
    .filter((c) => c.response!.stop_reason === 'max_tokens')
    .map((c) => ({ seq: c.seq, phase: c.phase, label: c.label, question: state.asks.find((a) => a.id === c.askId)?.question ?? null, textChars: c.response!.textChars, outputTokens: num((c.response!.usage as Rec | undefined)?.output_tokens), content: c.response!.content }));

  // input_transformations over all calls.
  const transforms = ok
    .filter((c) => Array.isArray(c.response!.input_transformations) ? (c.response!.input_transformations as unknown[]).length > 0 : c.response!.input_transformations !== undefined && c.response!.input_transformations !== null)
    .map((c) => ({ seq: c.seq, phase: c.phase, label: c.label, conversationTrimmed: c.request.conversationTrimmed, thinkingBlocksSent: c.request.blocks.thinking ?? 0, input_transformations: c.response!.input_transformations }));
  const transformsBeforeTrim = transforms.filter((t) => !t.conversationTrimmed);
  const nonThinkingDropped = transforms.filter((t) => !Array.isArray(t.input_transformations) || (t.input_transformations as unknown[]).some((x) => !(isRec(x) && x.type === 'thinking_dropped')));
  const trimmedCalls = ok.filter((c) => c.request.conversationTrimmed);
  const transformedTrimmedCalls = trimmedCalls.filter((c) => Array.isArray(c.response!.input_transformations) && (c.response!.input_transformations as unknown[]).length > 0);

  // Thinking blocks: how many the model wrote, and how the calls that carried one behaved.
  const thinkingWritten = ok.reduce((n, c) => n + c.response!.content.filter((b) => b.type === 'thinking').length, 0);
  const withThinking = ok.filter((c) => (c.request.blocks.thinking ?? 0) > 0);
  const emptyList = (c: CallEntry): boolean => Array.isArray(c.response!.input_transformations) && (c.response!.input_transformations as unknown[]).length === 0;
  const thinking = {
    blocksWrittenByTheModel: thinkingWritten,
    thinkingTokensTotal: ok.reduce((n, c) => n + num((((c.response!.usage as Rec | undefined)?.output_tokens_details) as Rec | undefined)?.thinking_tokens), 0),
    callsSentWithAThinkingBlock: withThinking.length,
    ofThemNotTrimmedAndEmptyTransformations: withThinking.filter((c) => !c.request.conversationTrimmed && emptyList(c)).length,
    ofThemNotTrimmed: withThinking.filter((c) => !c.request.conversationTrimmed).length,
    ofThemTrimmedWithAThinkingDropped: withThinking.filter((c) => c.request.conversationTrimmed && !emptyList(c)).length,
    ofThemTrimmed: withThinking.filter((c) => c.request.conversationTrimmed).length,
  };

  const failures = state.calls.filter((c) => c.httpStatus !== 200).map((c) => ({ seq: c.seq, phase: c.phase, label: c.label, attempt: c.attempt, httpStatus: c.httpStatus, error: c.error ?? null, errorBody: c.errorBody ?? null, request: c.request }));
  const models = [...new Set(ok.map((c) => String(c.response!.model)))];

  return {
    totalRequestsToTheWorker: state.calls.length,
    successful200: ok.length,
    byHttpStatus: byStatus,
    models,
    estimatedCostUsd: Number(state.costUsd.toFixed(4)),
    totalInputTokens: ok.reduce((s, c) => s + c.inputTokensTotal, 0),
    totalOutputTokens: ok.reduce((s, c) => s + num((c.response!.usage as Rec | undefined)?.output_tokens), 0),
    asks: state.asks.length,
    stoppedBecause: state.stop,
    cache,
    stopReasons,
    maxTokensFindings: maxTokens,
    thinking,
    toolsCalledSuccessfully: Object.fromEntries(state.toolOk),
    toolsNeverCalledSuccessfully: h ? h.toolNames.filter((n) => (state.toolOk.get(n) ?? 0) === 0) : null,
    inputTransformations: {
      callsWithNonEmpty: transforms.length,
      beforeAnyTrim: transformsBeforeTrim,
      entriesOtherThanThinkingDropped: nonThinkingDropped,
      callsSentAfterATrim: trimmedCalls.length,
      ofThemWithTransformations: transformedTrimmedCalls.length,
      all: transforms,
    },
    failures,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Dry run: no network
// ---------------------------------------------------------------------------------------------------------------

async function dryRun(h: Harness): Promise<void> {
  const { runTool } = await import('../src/ai/tools');
  const tanabe = h.ctx.areas.find((a) => a.name === '田辺市')!;
  const inputs: Array<[string, unknown]> = [
    ['find_area', { query: '田辺' }],
    ['get_series', { areaCode: tanabe.code }],
    ['compare_sources', { areaCode: tanabe.code }],
    ['run_projection', { areaCode: tanabe.code, scenario: { migScale: 0.5 } }],
    ['facility_check', { areaCode: tanabe.code, year: 2050 }],
    ['run_allocation', { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2050 }],
    ['find_similar_now', { areaCode: tanabe.code, year: 2100 }],
    ['count_areas', { year: 2075, below: 1000 }],
    ['get_age_groups', { areaCode: tanabe.code }],
  ];
  for (const [name, input] of inputs) {
    const r = runTool(name, input, h.ctx);
    out(`  ${name}: ${isRec(r) && typeof r.error === 'string' ? 'ERROR ' + r.error : 'ok'} (${JSON.stringify(r).length} chars)`);
  }
  const big = buildBigQuestion(h.ctx.areas, 20_000);
  out(`  big question: ${big.length} chars, ${new TextEncoder().encode(JSON.stringify({ messages: [{ role: 'user', content: big }] })).length} bytes`);
  out(`  sample questions: ${h.sampleQuestions.length}; tools: ${h.toolNames.join(', ')}; numbers helper: ${h.numbers.source}`);
}

// ---------------------------------------------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------------------------------------------

function parseArgs(argv: string[], root: string): Opts {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--help')) {
    out('node scripts/ai_live_check.ts [--phases 1,2,3,3b,7] [--only q1,q3] [--log <file>] [--answers <file>] [--dry-run]');
    process.exit(0);
  }
  const endpoint = get('--endpoint') ?? WORKER_URL;
  const real = endpoint === WORKER_URL;
  const paceMs = Number(get('--pace-ms') ?? PACE_MS);
  const retryWaitMs = Number(get('--retry-wait-ms') ?? RETRY_WAIT_MS);
  return {
    endpoint,
    logPath: resolve(get('--log') ?? join(root, '.staging/ai-live-check/live-check-log.json')),
    answersPath: resolve(get('--answers') ?? join(root, 'public/data/cached_answers.json')),
    phases: new Set((get('--phases') ?? DEFAULT_PHASES.join(',')).split(',').map((s) => s.trim()).filter(Boolean)),
    paceMs: real ? Math.max(paceMs, PACE_MS) : paceMs,
    retryWaitMs: real ? Math.max(retryWaitMs, RETRY_WAIT_MS) : retryWaitMs,
    dryRun: argv.includes('--dry-run'),
    only: get('--only') ? new Set(get('--only')!.split(',').map((x) => x.trim()).filter(Boolean)) : null,
    root,
  };
}

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const opts = parseArgs(process.argv.slice(2), root);
  const client = await import('../src/ai/client');
  const { SAMPLE_QUESTIONS } = await import('../src/ai/cached');
  const { TOOL_NAMES } = await import('../src/ai/toolDefs');
  client.forgetAnsweredEndpoints();

  let numbers: Harness['numbers'];
  try {
    const m = await import('../src/ui/aiTrace');
    numbers = { namesLaterYear: m.namesLaterYear, traceUsesEstimate: m.traceUsesEstimate, source: "src/ui/aiTrace.ts" };
  } catch {
    numbers = { namesLaterYear: (t) => /(20[5-9]\d|2100)\s*年/.test(t), traceUsesEstimate: () => false, source: 'built-in regex (aiTrace.ts could not be loaded)' };
  }

  out(`ai_live_check: endpoint ${opts.endpoint}, phases ${[...opts.phases].join(',')}, pace ${opts.paceMs} ms${opts.dryRun ? ', DRY RUN' : ''}`);
  const ctx = await buildContext(root);
  out(`context: ${ctx.areas.length} areas, ${ctx.facilities.length} facilities`);
  const h: Harness = { opts, ctx, client, fetchFn: makeFetch(opts, client), sampleQuestions: SAMPLE_QUESTIONS, toolNames: TOOL_NAMES, numbers };
  if (opts.dryRun) {
    await dryRun(h);
    return;
  }

  try {
    if (opts.phases.has('1')) await phase1(h);
    if (opts.phases.has('2') && !state.stop) await phase2(h);
    if (opts.phases.has('3') && !state.stop) await phase3(h);
    if (opts.phases.has('3b') && !state.stop) await phase3b(h);
    if ([...opts.phases].some((p) => p.startsWith('7')) && !state.stop) await phase7(h, opts.phases);
  } finally {
    const summary = buildSummary(h);
    saveLog(opts, summary);
    out('\n===== SUMMARY =====');
    out(JSON.stringify({ ...summary, inputTransformations: { ...(summary.inputTransformations as Rec), all: undefined }, phases: undefined }, null, 1));
    out(`phases detail and every call: ${opts.logPath}`);
    if (state.stop) {
      out(`RUN STOPPED: ${state.stop}`);
      process.exitCode = 2;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Entry: run plain under Node, load this same file through a Vite server so src/ imports resolve
// ---------------------------------------------------------------------------------------------------------------

if (process.env.AI_LIVE_CHECK_RUNNER === 'vite') {
  await main();
} else {
  process.env.AI_LIVE_CHECK_RUNNER = 'vite';
  const self = fileURLToPath(import.meta.url);
  const { createServer } = await import('vite');
  const server = await createServer({
    root: resolve(dirname(self), '..'),
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    cacheDir: join(tmpdir(), 'ai-live-check-vite'),
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.ssrLoadModule(self);
  } finally {
    await server.close();
  }
}
