export const DEFAULT_IP_LIMIT = 20;
export const DEFAULT_TOTAL_LIMIT = 300;

// Counters are keyed by UTC date and expire on their own. Two days leaves room for clock edges
// and is far above the 60 s minimum that KV accepts.
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

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

/** The raw address is never written to KV; only a truncated SHA-256 of it is. */
async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(digest).slice(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readCount(kv: KVNamespace, key: string): Promise<number> {
  const stored = await kv.get(key);
  const count = stored === null ? 0 : Number.parseInt(stored, 10);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

/**
 * Charges one request against the per-IP and the total daily quota.
 * Returns false (and charges nothing) when either quota is used up.
 *
 * KV has no atomic increment, so concurrent requests can overshoot a limit slightly.
 * That is acceptable for a spending cap that only has to stay in the right ballpark.
 * Storage errors are thrown to the caller, which fails closed.
 */
export async function consumeQuota(
  kv: KVNamespace,
  ip: string,
  limits: Limits,
  now: Date = new Date(),
): Promise<boolean> {
  const date = utcDate(now);
  const ipKey = `ip:${date}:${await hashIp(ip)}`;
  const totalKey = `total:${date}`;

  const [ipCount, totalCount] = await Promise.all([readCount(kv, ipKey), readCount(kv, totalKey)]);
  if (ipCount >= limits.perIp || totalCount >= limits.total) return false;

  await Promise.all([
    kv.put(ipKey, String(ipCount + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
    kv.put(totalKey, String(totalCount + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
  ]);
  return true;
}
