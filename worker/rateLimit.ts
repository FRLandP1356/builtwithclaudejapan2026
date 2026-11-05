// Daily limits, counted in UPSTREAM CALLS, not in questions: one question can use up to 9 calls (a tool round trip
// each, see src/ai/client.ts), so 60 calls per visitor is between 6 questions (each at the worst case of 9 calls) and
// 60. Worst-case cost: worker/README.md.
export const DEFAULT_IP_LIMIT = 60;
export const DEFAULT_TOTAL_LIMIT = 400;

// Counters are keyed by UTC date and expire on their own. A counter must outlive its UTC day (it is only read again
// the same day), so the TTL must stay above 86,400 s; two days leaves room for clock edges. KV's own minimum is 60 s.
export const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

/**
 * The daily total is spread over this many KV keys. KV refuses a second write to the same key within a second, so a
 * single hot `total:<date>` key loses counts under ordinary traffic. Each visitor always writes the same shard (see
 * shardOf), the cap is checked against the SUM of all shards, so about 1/16 of the writes can collide instead of all.
 */
export const TOTAL_SHARDS = 16;

export interface Limits {
  perIp: number;
  total: number;
}

/** Parses a limit from a Worker var. Anything that is not a non-negative integer falls back to the default. */
export function parseLimit(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : fallback;
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

// ------------------------------------------------------------ client identity

const UNKNOWN_CLIENT = 'unknown';
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_GROUP_PATTERN = /^[0-9a-f]{1,4}$/;

function parseIpv4(text: string): number[] | null {
  const match = IPV4_PATTERN.exec(text);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function parseHexGroups(text: string): number[] | null {
  if (text === '') return [];
  const groups: number[] = [];
  for (const part of text.split(':')) {
    if (!IPV6_GROUP_PATTERN.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/** Parses an IPv6 address (any notation, including "::" and a dotted IPv4 tail) into its 8 groups. */
function parseIpv6(input: string): number[] | null {
  let text = input;
  if (text.includes('.')) {
    const split = text.lastIndexOf(':');
    const v4 = parseIpv4(text.slice(split + 1));
    if (v4 === null) return null;
    const high = ((v4[0]! << 8) | v4[1]!).toString(16);
    const low = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, split + 1)}${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = parseHexGroups(halves[0]!);
  if (head === null) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = parseHexGroups(halves[1]!);
  if (tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * The identity a visitor is limited by.
 * IPv4: the address. IPv4-mapped IPv6: that IPv4 address. Other IPv6: the /64 prefix, because one subscriber
 * normally owns a whole /64 and could otherwise get a fresh bucket per address. Unparseable: one shared bucket.
 */
export function normalizeClientIp(raw: string): string {
  let text = raw.trim().toLowerCase();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  if (!text.includes(':')) {
    const v4 = parseIpv4(text);
    return v4 === null ? UNKNOWN_CLIENT : v4.join('.');
  }

  const groups = parseIpv6(text);
  if (groups === null) return UNKNOWN_CLIENT;
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const g6 = groups[6]!;
    const g7 = groups[7]!;
    return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64`;
}

/**
 * Keyed hash of the client identity (HMAC-SHA-256, truncated to 16 bytes). The raw address is never written to KV or
 * handed to the rate limiter, and without the secret the keys cannot be matched back to an address by brute force
 * over the IP space. One function, so the burst limiter and the daily counters see the same visitor the same way.
 */
export async function clientKey(secret: string, clientIp: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(normalizeClientIp(clientIp)));
  return [...new Uint8Array(mac).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The total-counter shard (0 to TOTAL_SHARDS - 1) a visitor writes: a pure function of the HMAC'd client key, so the
 * same visitor always lands on the same shard and visitors spread evenly (the key is uniformly random hex).
 */
export function shardOf(key: string): number {
  return (Number.parseInt(key.slice(0, 2), 16) || 0) % TOTAL_SHARDS;
}

// -------------------------------------------------------------------- quota

async function readCount(kv: KVNamespace, key: string): Promise<number> {
  const stored = await kv.get(key);
  const count = stored === null ? 0 : Number.parseInt(stored, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Charges one request against the per-IP and the total daily quota. `key` is the visitor's `clientKey`, computed once
 * per request by the caller. Returns false (and charges nothing) when either quota is used up.
 *
 * BEST-EFFORT ONLY, not a security control. KV has no atomic increment and is eventually consistent, so this is
 * read-then-write: concurrent requests read the same values and overwrite each other's increments (lost updates).
 * A burst is therefore undercounted: a wave of N simultaneous requests that all read before any write all pass, and
 * the total then advances only by the number of distinct shards they hit (at most 16, about 15 for N = 50). So the
 * overshoot is up to N - 1 for the wave that crosses the cap, and sustained waves overshoot by a multiple of N (the
 * table in worker/README.md comes from rateLimit.test.ts). The hard stop on spending is the spend limit of the
 * Anthropic workspace that owns the API key.
 *
 * The total is sharded over TOTAL_SHARDS keys (`total:<date>:<0..15>`); the cap is checked against their sum. The old
 * single `total:<date>` key is never read or written.
 *
 * Reads fail closed: the IP key and all shard keys are read together, and if any of them cannot be read the error is
 * thrown and the caller answers 503, because without the counters nothing is enforced. Writes do not: KV allows one
 * write per second to the same key, and a visitor who got past the checks must not be turned away because a counter
 * could not be saved. Only this visitor's shard and the IP key are written, each in its own try/catch (sequential,
 * shard first); a failure is logged once (no key, no address, no error text) and the request is allowed.
 */
export async function consumeQuota(
  kv: KVNamespace,
  key: string,
  limits: Limits,
  now: Date = new Date(),
): Promise<boolean> {
  const date = utcDate(now);
  const ipKey = `ip:${date}:${key}`;
  const shardKeys = Array.from({ length: TOTAL_SHARDS }, (_, shard) => `total:${date}:${shard}`);

  const [ipCount, ...shardCounts] = await Promise.all([readCount(kv, ipKey), ...shardKeys.map((shardKey) => readCount(kv, shardKey))]);
  const totalCount = shardCounts.reduce((sum, count) => sum + count, 0);
  if (ipCount >= limits.perIp || totalCount >= limits.total) return false;

  const shard = shardOf(key);
  let writeFailed = false;
  for (const [counterKey, count] of [
    [shardKeys[shard]!, shardCounts[shard]! + 1],
    [ipKey, ipCount + 1],
  ] as const) {
    try {
      await kv.put(counterKey, String(count), { expirationTtl: COUNTER_TTL_SECONDS });
    } catch {
      writeFailed = true;
    }
  }
  if (writeFailed) console.warn('rate counter write failed');
  return true;
}
