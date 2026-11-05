import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientKey, consumeQuota, COUNTER_TTL_SECONDS, normalizeClientIp, shardOf, TOTAL_SHARDS } from './rateLimit';

const SECRET = 'unit-test-ip-hash-secret';
const LIMITS = { perIp: 5, total: 100 };
const NOW = new Date('2026-11-05T12:00:00Z');

/** KV fake that records start/end of each put so sequential writes can be asserted. */
class RecordingKV {
  store = new Map<string, string>();
  events: string[] = [];
  failPutFor: ((key: string) => boolean) | null = null;
  failGet = false;
  /** Makes get() throw for the keys this returns true for. */
  failGetFor: ((key: string) => boolean) | null = null;
  gets: string[] = [];

  async get(key: string): Promise<string | null> {
    this.gets.push(key);
    if (this.failGet || this.failGetFor?.(key)) throw new Error('kv get failed');
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.events.push(`start:${key}`);
    await Promise.resolve();
    await Promise.resolve();
    if (this.failPutFor?.(key)) {
      this.events.push(`fail:${key}`);
      throw new Error('kv put failed');
    }
    this.store.set(key, value);
    this.events.push(`end:${key}`);
    // A counter is read again the same UTC day, so it must outlive the day (a 60 s TTL would turn the daily limits
    // into per-minute limits).
    expect(options?.expirationTtl).toBeGreaterThanOrEqual(86_400);
  }
}

const asKV = (kv: RecordingKV) => kv as unknown as KVNamespace;

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function hmacHex16(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('normalizeClientIp', () => {
  it('leaves IPv4 per address', () => {
    expect(normalizeClientIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeClientIp('203.0.113.8')).not.toBe(normalizeClientIp('203.0.113.7'));
  });

  it('reduces an IPv6 address to its /64 prefix', () => {
    expect(normalizeClientIp('2001:0DB8:abcd:0012:0000:0000:0000:0001')).toBe('2001:db8:abcd:12::/64');
    expect(normalizeClientIp('2001:db8:abcd:12:ffff:ffff:ffff:ffff')).toBe('2001:db8:abcd:12::/64');
    expect(normalizeClientIp('2001:db8:abcd:13::1')).not.toBe(normalizeClientIp('2001:db8:abcd:12::1'));
  });

  it('expands "::" correctly wherever it appears', () => {
    expect(normalizeClientIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(normalizeClientIp('2001:db8::5')).toBe(normalizeClientIp('2001:db8:0:0:1::5'));
    expect(normalizeClientIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeClientIp('::')).toBe('0:0:0:0::/64');
    expect(normalizeClientIp('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
    expect(normalizeClientIp('::2:3:4:5:6:7:8')).toBe('0:2:3:4::/64');
    expect(normalizeClientIp('1:2::7:8')).toBe('1:2:0:0::/64');
    // The "::" can stand for the groups that decide the prefix.
    expect(normalizeClientIp('1::8')).toBe('1:0:0:0::/64');
  });

  it('ignores brackets and zone ids', () => {
    expect(normalizeClientIp('[2001:db8::1]')).toBe(normalizeClientIp('2001:db8::2'));
    expect(normalizeClientIp('fe80::1%eth0')).toBe(normalizeClientIp('fe80::2'));
  });

  it('treats an IPv4-mapped IPv6 address as the IPv4 address', () => {
    expect(normalizeClientIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeClientIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeClientIp('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(normalizeClientIp('0:0:0:0:0:ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('puts anything unparseable into one "unknown" bucket', () => {
    for (const bad of ['', 'garbage', '1:2:3', '2001:db8::1::2', '1:2:3:4:5:6:7:8:9', 'g::1', '999.1.1.1', '1.2.3', 'unknown']) {
      expect(normalizeClientIp(bad), bad).toBe('unknown');
    }
  });
});

describe('clientKey', () => {
  it('is the HMAC-SHA-256 of the normalized client under the secret, 16 bytes as hex', async () => {
    expect(await clientKey(SECRET, '203.0.113.7')).toBe(await hmacHex16(SECRET, '203.0.113.7'));
    expect(await clientKey(SECRET, '2001:db8:abcd:12::1')).toBe(await hmacHex16(SECRET, '2001:db8:abcd:12::/64'));
    expect(await clientKey(SECRET, '::ffff:203.0.113.7')).toBe(await clientKey(SECRET, '203.0.113.7'));
    expect(await clientKey(SECRET, '203.0.113.7')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs per client and per secret', async () => {
    const base = await clientKey(SECRET, '203.0.113.7');
    expect(await clientKey(SECRET, '203.0.113.8')).not.toBe(base);
    expect(await clientKey('another-secret', '203.0.113.7')).not.toBe(base);
  });
});

/** consumeQuota the way the Worker calls it: with the visitor's key, computed once. */
async function consume(kv: RecordingKV, ip: string, limits = LIMITS, secret = SECRET, now = NOW): Promise<boolean> {
  return consumeQuota(asKV(kv), await clientKey(secret, ip), limits, now);
}

const shardKey = (shard: number, date = '2026-11-05') => `total:${date}:${shard}`;
const ALL_SHARD_KEYS = Array.from({ length: TOTAL_SHARDS }, (_, shard) => shardKey(shard));

describe('shardOf', () => {
  it('is the first byte of the HMAC key, mod 16: a pure function of the key', () => {
    expect(TOTAL_SHARDS).toBe(16);
    expect(shardOf('00' + 'a'.repeat(30))).toBe(0);
    expect(shardOf('0f' + 'a'.repeat(30))).toBe(15);
    expect(shardOf('10' + 'b'.repeat(30))).toBe(0);
    expect(shardOf('1a' + 'c'.repeat(30))).toBe(10);
    expect(shardOf('ff' + '0'.repeat(30))).toBe(15);
    expect(shardOf('7e' + 'd'.repeat(30))).toBe(14);
    // Only the first byte matters, and the same key always gives the same shard.
    expect(shardOf('1a' + 'e'.repeat(30))).toBe(shardOf('1a' + 'f'.repeat(30)));
    expect(shardOf('1a' + 'e'.repeat(30))).toBe(shardOf('1a' + 'e'.repeat(30)));
  });

  it('is derived from the real HMAC: a visitor always writes the same shard, and visitors spread over all 16', async () => {
    const counts = new Array<number>(TOTAL_SHARDS).fill(0);
    for (let i = 0; i < 1600; i++) {
      const key = await clientKey(SECRET, `198.51.${Math.floor(i / 250)}.${i % 250}`);
      const shard = shardOf(key);
      expect(shard).toBe(shardOf(await clientKey(SECRET, `198.51.${Math.floor(i / 250)}.${i % 250}`)));
      expect(shard).toBe((Number.parseInt(key.slice(0, 2), 16)) % 16);
      counts[shard]! += 1;
    }
    // 1,600 visitors over 16 shards is 100 each on average; an even spread stays well inside 50 to 150.
    for (const count of counts) {
      expect(count).toBeGreaterThan(50);
      expect(count).toBeLessThan(150);
    }
  });
});

describe('consumeQuota', () => {
  it('reads the IP key and all 16 shard keys, then writes this visitor\'s shard first and the IP key second, one after the other', async () => {
    const kv = new RecordingKV();
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    const visitor = await clientKey(SECRET, '203.0.113.7');
    const ipKey = `ip:2026-11-05:${visitor}`;
    const mine = shardKey(shardOf(visitor));
    expect([...kv.gets].sort()).toEqual([ipKey, ...ALL_SHARD_KEYS].sort());
    expect([...kv.store.keys()]).toEqual([mine, ipKey]);
    expect(kv.events).toEqual([`start:${mine}`, `end:${mine}`, `start:${ipKey}`, `end:${ipKey}`]);
  });

  it('never reads or writes the old single total:<date> key', async () => {
    const kv = new RecordingKV();
    kv.store.set('total:2026-11-05', '100000'); // a leftover from the old design must not count
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect(kv.gets).not.toContain('total:2026-11-05');
    expect(kv.events.filter((event) => event.endsWith(':total:2026-11-05') || event === 'start:total:2026-11-05')).toEqual([]);
    expect(kv.store.get('total:2026-11-05')).toBe('100000');
  });

  it('writes the visitor\'s shard with its own value plus one, and the IP key with the IP count plus one', async () => {
    const kv = new RecordingKV();
    const visitor = await clientKey(SECRET, '203.0.113.7');
    const mine = shardKey(shardOf(visitor));
    kv.store.set(mine, '7');
    kv.store.set(`ip:2026-11-05:${visitor}`, '2');
    // Other shards hold other values; they must stay untouched.
    const others = ALL_SHARD_KEYS.filter((key) => key !== mine);
    others.forEach((key, i) => kv.store.set(key, String(i + 1)));
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 1000 })).toBe(true);
    expect(kv.store.get(mine)).toBe('8');
    expect(kv.store.get(`ip:2026-11-05:${visitor}`)).toBe('3');
    others.forEach((key, i) => expect(kv.store.get(key), key).toBe(String(i + 1)));
  });

  it('decides the total cap on the SUM of the shards: 16 shards at 25 each is 400, refused while every shard is far below the cap', async () => {
    const kv = new RecordingKV();
    ALL_SHARD_KEYS.forEach((key) => kv.store.set(key, '25'));
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 400 })).toBe(false);
    expect(kv.events).toEqual([]);
    // One short of the cap is still allowed (and the boundary is exact).
    kv.store.set(shardKey(3), '24');
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 400 })).toBe(true);
    expect(await consume(kv, '203.0.113.8', { perIp: 5, total: 400 })).toBe(false);
  });

  it('counts every shard in the sum, including the first and the last', async () => {
    for (const shard of [0, 7, 15]) {
      const kv = new RecordingKV();
      kv.store.set(shardKey(shard), '10');
      expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 10 }), `shard ${shard}`).toBe(false);
      expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 11 }), `shard ${shard}`).toBe(true);
    }
  });

  it('refuses everything with a total limit of 0', async () => {
    const kv = new RecordingKV();
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 0 })).toBe(false);
    expect(kv.events).toEqual([]);
  });

  it('still saves the IP counter, and allows the request, when the shard write fails (one warning, no details)', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('total:');
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect([...kv.store.keys()]).toHaveLength(1);
    expect([...kv.store.keys()][0]).toMatch(/^ip:2026-11-05:[0-9a-f]{32}$/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('rate counter write failed');
  });

  it('still saves the visitor\'s shard, and allows the request, when the IP write fails', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('ip:');
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect([...kv.store.keys()]).toEqual([shardKey(shardOf(await clientKey(SECRET, '203.0.113.7')))]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('allows the request and warns once, not twice, when both writes fail', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect(kv.store.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // Nothing identifying in the log: not the address, not a key, not the error text.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/203\.0\.113\.7|total:|ip:|kv put failed|[0-9a-f]{32}/);
  });

  it('does not warn when the writes succeed', async () => {
    const kv = new RecordingKV();
    await consume(kv, '203.0.113.7');
    expect(warn).not.toHaveBeenCalled();
  });

  it('still refuses (false) when a quota is used up, whether or not writes would fail', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    kv.store.set(shardKey(4), '100');
    expect(await consume(kv, '203.0.113.7')).toBe(false);
    expect(kv.events).toEqual([]); // nothing was written, so there was nothing to fail
    expect(warn).not.toHaveBeenCalled();
  });

  it('refuses on the per-IP quota too, without writing', async () => {
    const kv = new RecordingKV();
    const visitor = await clientKey(SECRET, '203.0.113.7');
    kv.store.set(`ip:2026-11-05:${visitor}`, '5');
    expect(await consume(kv, '203.0.113.7')).toBe(false);
    expect(kv.events).toEqual([]);
  });

  it('rejects, so the caller can fail closed, when a counter cannot be READ', async () => {
    const kv = new RecordingKV();
    kv.failGet = true;
    await expect(consume(kv, '203.0.113.7')).rejects.toThrow('kv get failed');
    expect(kv.events).toEqual([]); // nothing was charged on the way out
  });

  it('rejects when ANY ONE of the 16 shard keys, or the IP key, cannot be read', async () => {
    const visitor = await clientKey(SECRET, '203.0.113.7');
    for (const failing of [...ALL_SHARD_KEYS, `ip:2026-11-05:${visitor}`]) {
      const kv = new RecordingKV();
      kv.failGetFor = (key) => key === failing;
      await expect(consume(kv, '203.0.113.7'), failing.slice(0, 20)).rejects.toThrow('kv get failed');
      expect(kv.events, failing.slice(0, 20)).toEqual([]);
    }
  });

  it('keys the IP counter with the key it is given (HMAC-SHA-256 under the secret, 16 bytes as hex)', async () => {
    const kv = new RecordingKV();
    await consume(kv, '203.0.113.7');
    const ipKey = [...kv.store.keys()].find((key) => key.startsWith('ip:'))!;
    expect(ipKey).toBe(`ip:2026-11-05:${await hmacHex16(SECRET, '203.0.113.7')}`);
    expect(ipKey).not.toContain('203.0.113.7');
  });

  it('gives the same client a different key under a different secret, and different clients different keys', async () => {
    const ipKeyFor = async (secret: string, ip: string) => {
      const kv = new RecordingKV();
      await consume(kv, ip, LIMITS, secret);
      return [...kv.store.keys()].find((key) => key.startsWith('ip:'))!;
    };
    const a = await ipKeyFor('secret-a', '203.0.113.7');
    expect(await ipKeyFor('secret-a', '203.0.113.7')).toBe(a);
    expect(await ipKeyFor('secret-b', '203.0.113.7')).not.toBe(a);
    expect(await ipKeyFor('secret-a', '203.0.113.8')).not.toBe(a);
  });

  it('works on the normalized client, so one /64 is one bucket', async () => {
    const kv = new RecordingKV();
    const limits = { perIp: 1, total: 100 };
    expect(await consume(kv, '2001:db8:abcd:12::1', limits)).toBe(true);
    expect(await consume(kv, '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd', limits)).toBe(false);
    expect(await consume(kv, '2001:db8:abcd:13::1', limits)).toBe(true);
  });

  it('expires every counter after at least one day (COUNTER_TTL_SECONDS) and passes exactly that value', async () => {
    expect(COUNTER_TTL_SECONDS).toBeGreaterThanOrEqual(86_400);
    const ttls: Array<number | undefined> = [];
    const kv = new RecordingKV();
    const put = kv.put.bind(kv);
    kv.put = async (key, value, options) => {
      ttls.push(options?.expirationTtl);
      return put(key, value, options);
    };
    await consume(kv, '203.0.113.7');
    expect(ttls).toEqual([COUNTER_TTL_SECONDS, COUNTER_TTL_SECONDS]);
  });
});

// A wave is N visitors whose reads all complete before any of their writes land (what a burst looks like on real
// KV). KV refuses a second write to the same key within one second; consecutive waves are one second apart, so the
// first writer to a shard in each wave succeeds and the others are refused. Every visitor is new, so only the total
// cap is in play. This is the single-location, writes-visible-at-once, best case: more locations make it worse.
class WaveKV {
  store = new Map<string, string>();
  private snapshot = new Map<string, string>();
  private lastWrite = new Map<string, number>();
  clockMs = 0;
  refusedWrites = 0;

  startWave(clockMs: number): void {
    this.snapshot = new Map(this.store);
    this.clockMs = clockMs;
  }

  async get(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.snapshot.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    const last = this.lastWrite.get(key);
    if (last !== undefined && this.clockMs - last < 1000) {
      this.refusedWrites += 1;
      throw new Error('KV PUT failed: 429 Too Many Requests');
    }
    this.lastWrite.set(key, this.clockMs);
    this.store.set(key, value);
  }

  total(): number {
    return [...this.store.entries()].filter(([key]) => key.startsWith('total:')).reduce((sum, [, v]) => sum + Number(v), 0);
  }
}

async function runWave(kv: WaveKV, visitors: number, wave: number, totalCap: number): Promise<number> {
  kv.startWave(wave * 1000);
  const keys = await Promise.all(
    Array.from({ length: visitors }, (_, i) => clientKey(SECRET, `10.${Math.floor(wave / 250)}.${wave % 250}.${i}`)),
  );
  const outcomes = await Promise.all(keys.map((key) => consumeQuota(kv as unknown as KVNamespace, key, { perIp: 60, total: totalCap }, NOW)));
  return outcomes.filter(Boolean).length;
}

/** Waves of `visitors` simultaneous new visitors, one per second, until a whole wave is refused. */
async function sustainedWaves(visitors: number, totalCap = 400): Promise<{ passed: number; waves: number; kv: WaveKV }> {
  const kv = new WaveKV();
  let passed = 0;
  let waves = 0;
  for (let wave = 0; wave < 3000; wave++) {
    const ok = await runWave(kv, visitors, wave, totalCap);
    if (ok === 0) break;
    passed += ok;
    waves += 1;
  }
  return { passed, waves, kv };
}

describe('overshoot of the daily total under simultaneous requests (cap 400; the table in worker/README.md)', () => {
  it('a single wave that starts just under the cap lets all N through (overshoot N - 1), then the cap holds', async () => {
    const kv = new WaveKV();
    kv.store.set(shardKey(0), '399');
    const passed = await runWave(kv, 50, 0, 400);
    expect(passed).toBe(50); // every one of the 50 read 399 before any write: the worst overshoot is N - 1 = 49
    // The sum advanced by the shards that were hit (at most 16), so the very next wave is refused in full.
    expect(kv.total()).toBeGreaterThan(399);
    expect(kv.total()).toBeLessThanOrEqual(399 + TOTAL_SHARDS);
    expect(await runWave(kv, 50, 1, 400)).toBe(0);
  });

  it('sustained waves: calls allowed before the cap bites, for N = 1, 5, 10, 20, 50 simultaneous requests a second', async () => {
    const results: Record<number, number> = {};
    for (const n of [1, 5, 10, 20, 50]) results[n] = (await sustainedWaves(n)).passed;
    // Sequential traffic is exact; simultaneous traffic overshoots, more with bigger waves. The bands are around the
    // values this deterministic simulation gives (HMAC of fixed addresses): 400, 455, 520, 700 and 1,300. The README
    // table quotes them; if the sharding changes, change both.
    expect(results[1]).toBe(400);
    expect(results[5]).toBeGreaterThanOrEqual(410);
    expect(results[5]).toBeLessThanOrEqual(500);
    expect(results[10]).toBeGreaterThanOrEqual(470);
    expect(results[10]).toBeLessThanOrEqual(580);
    expect(results[20]).toBeGreaterThanOrEqual(620);
    expect(results[20]).toBeLessThanOrEqual(780);
    expect(results[50]).toBeGreaterThanOrEqual(1170);
    expect(results[50]).toBeLessThanOrEqual(1430);
  });

  it('is what sharding buys: with one shard the same N = 50 waves would let about 50 x 400 calls through', async () => {
    // Reference model of the old single key (not used by the code): every wave advances the one counter by 1.
    let counter = 0;
    let passed = 0;
    while (counter < 400) {
      passed += 50;
      counter += 1;
    }
    expect(passed).toBe(20_000);
    const { passed: sharded } = await sustainedWaves(50);
    expect(sharded).toBeLessThan(passed / 5);
  });
});
