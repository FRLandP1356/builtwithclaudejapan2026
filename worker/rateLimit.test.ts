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
  /** Every argument list get() was called with (so a stray options argument, such as cacheTtl, shows). */
  getArgs: unknown[][] = [];

  async get(key: string, ...rest: unknown[]): Promise<string | null> {
    this.gets.push(key);
    this.getArgs.push([key, ...rest]);
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

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** Every console call made so far as [method, ...arguments]. consumeQuota itself must make none. */
function consoleCalls(): unknown[][] {
  return CONSOLE_METHODS.flatMap((method) => vi.mocked(console[method]).mock.calls.map((args) => [method, ...args]));
}

beforeEach(() => {
  for (const method of CONSOLE_METHODS) vi.spyOn(console, method).mockImplementation(() => {});
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
  it('reads the IP key and all 16 shard keys, then saves this visitor\'s shard and the IP key together (both started before either finishes)', async () => {
    const kv = new RecordingKV();
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    const visitor = await clientKey(SECRET, '203.0.113.7');
    const ipKey = `ip:2026-11-05:${visitor}`;
    const mine = shardKey(shardOf(visitor));
    expect([...kv.gets].sort()).toEqual([ipKey, ...ALL_SHARD_KEYS].sort());
    expect([...kv.store.keys()]).toEqual([mine, ipKey]);
    expect(kv.events).toEqual([`start:${mine}`, `start:${ipKey}`, `end:${mine}`, `end:${ipKey}`]);
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

  it('FAILS CLOSED when the shard write fails: it rejects, so the caller answers 503; no console output', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('total:');
    await expect(consume(kv, '203.0.113.7')).rejects.toThrow('rate counter write failed');
    // The pair was saved together, so the other counter did get its +1: one count too many for a call that is never
    // made. That errs on the side of refusing; nothing is rolled back.
    expect([...kv.store.keys()]).toHaveLength(1);
    expect([...kv.store.keys()][0]).toMatch(/^ip:2026-11-05:[0-9a-f]{32}$/);
    expect(consoleCalls()).toEqual([]);
  });

  it('FAILS CLOSED when the visitor\'s IP-key write fails: it rejects; the shard counter is one too high', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('ip:');
    await expect(consume(kv, '203.0.113.7')).rejects.toThrow('rate counter write failed');
    expect([...kv.store.keys()]).toEqual([shardKey(shardOf(await clientKey(SECRET, '203.0.113.7')))]);
    expect(consoleCalls()).toEqual([]);
  });

  it('FAILS CLOSED when both writes fail: it rejects and saves nothing', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    await expect(consume(kv, '203.0.113.7')).rejects.toThrow('rate counter write failed');
    expect(kv.store.size).toBe(0);
    expect(consoleCalls()).toEqual([]);
  });

  it('the error it throws carries no key, address or KV error text', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    const error = await consume(kv, '203.0.113.7').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('rate counter write failed');
    expect(String((error as Error).stack)).not.toMatch(/203\.0\.113\.7|kv put failed|total:|ip:/);
  });

  it('waits for BOTH saves before answering, even when one fails at once and the other is slow', async () => {
    class SlowSecondKV extends RecordingKV {
      override async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
        if (key.startsWith('ip:')) {
          for (let i = 0; i < 20; i++) await Promise.resolve();
          return super.put(key, value, options);
        }
        throw new Error('shard write refused');
      }
    }
    const kv = new SlowSecondKV();
    await expect(consume(kv, '203.0.113.7')).rejects.toThrow('rate counter write failed');
    // The slow IP save had finished by the time consumeQuota rejected (it is not left running behind the answer).
    expect([...kv.store.keys()]).toHaveLength(1);
    expect(kv.events).toContain(`end:${[...kv.store.keys()][0]}`);
  });

  it('does not log anything when the writes succeed', async () => {
    const kv = new RecordingKV();
    await consume(kv, '203.0.113.7');
    expect(consoleCalls()).toEqual([]);
  });

  it('still refuses (false) when a quota is used up, whether or not writes would fail', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    kv.store.set(shardKey(4), '100');
    expect(await consume(kv, '203.0.113.7')).toBe(false);
    expect(kv.events).toEqual([]); // nothing was written, so there was nothing to fail
    expect(consoleCalls()).toEqual([]);
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

  it('issues all 17 reads together, not one after the other (about 3 KV round trips, not 17)', async () => {
    class ProbeKV extends RecordingKV {
      started = 0;
      resolved = 0;
      maxInFlight = 0;
      startedWhenFirstResolved = -1;
      override async get(key: string, ...rest: unknown[]): Promise<string | null> {
        this.started += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.started - this.resolved);
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (this.resolved === 0) this.startedWhenFirstResolved = this.started;
        this.resolved += 1;
        return super.get(key, ...rest);
      }
    }
    const kv = new ProbeKV();
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect(kv.started).toBe(17);
    expect(kv.maxInFlight).toBe(17);
    expect(kv.startedWhenFirstResolved).toBe(17); // all 17 were issued before the first one came back
  });

  it('reads with get(key) only: no options argument (a cacheTtl would show other locations counts that are late)', async () => {
    const kv = new RecordingKV();
    await consume(kv, '203.0.113.7');
    expect(kv.getArgs).toHaveLength(17);
    for (const args of kv.getArgs) expect(args).toHaveLength(1);
    expect(kv.getArgs.map(([key]) => key).sort()).toEqual([...ALL_SHARD_KEYS, `ip:2026-11-05:${await clientKey(SECRET, '203.0.113.7')}`].sort());
  });

  it('treats a junk, negative or non-finite stored value as 0, so the sum is never NaN and the cap keeps working', async () => {
    // Fail-open for that one counter on purpose: the Worker only ever writes integers, so junk means the store was
    // tampered with or corrupted, and refusing every call until the key expires (two days) would switch the AI off.
    // The cap over the other shards still holds, and the next write by that shard's visitors replaces the junk.
    for (const junk of ['abc', '', ' ', '-5', '-0', 'NaN', 'Infinity', '-Infinity', '{}', 'null', 'undefined']) {
      const kv = new RecordingKV();
      kv.store.set(shardKey(0), junk);
      kv.store.set(shardKey(1), '-5');
      kv.store.set(shardKey(2), '400');
      expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 400 }), `junk ${JSON.stringify(junk)}: sum is 400`).toBe(false);
      kv.store.set(shardKey(2), '399');
      expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 400 }), `junk ${JSON.stringify(junk)}: sum is 399`).toBe(true);
    }
  });

  it('a junk counter is replaced, not carried on, by the next write to it; a junk IP counter counts as 0', async () => {
    const kv = new RecordingKV();
    const visitor = await clientKey(SECRET, '203.0.113.7');
    kv.store.set(shardKey(shardOf(visitor)), 'abc');
    kv.store.set(`ip:2026-11-05:${visitor}`, 'xyz');
    expect(await consume(kv, '203.0.113.7')).toBe(true);
    expect(kv.store.get(shardKey(shardOf(visitor)))).toBe('1');
    expect(kv.store.get(`ip:2026-11-05:${visitor}`)).toBe('1');
  });

  it('reads a stored value as a leading integer, and an absurdly large one still refuses (the safe direction)', async () => {
    const kv = new RecordingKV();
    kv.store.set(shardKey(3), '0007');
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 7 })).toBe(false);
    expect(await consume(kv, '203.0.113.7', { perIp: 5, total: 8 })).toBe(true);
    const big = new RecordingKV();
    big.store.set(shardKey(3), '99999999999999999999');
    expect(await consume(big, '203.0.113.7', { perIp: 5, total: 400 })).toBe(false);
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
// KV). KV refuses a second write to the same key within one second; consecutive waves are `gapMs` apart. A request
// whose counters cannot both be saved is refused (fail closed), so only the first writer of each key in a wave can be
// served. The state of the daily total is the sum of the 16 shards. This is the single-location, writes-visible-at-once
// best case: staleness across locations is not modelled.
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

interface WaveResult {
  /** Served: the counters were saved and the request would go on to the upstream API. */
  passed: number;
  /** Refused because a daily cap is used up (429). */
  capped: number;
  /** Refused because the counters could not be saved (503 "try again later"). */
  unavailable: number;
}

/** One wave: every key in `keys` calls consumeQuota at the same moment, all reading the state at the wave's start. */
async function runWave(kv: WaveKV, keys: string[], clockMs: number, limits: { perIp: number; total: number }): Promise<WaveResult> {
  kv.startWave(clockMs);
  const outcomes = await Promise.all(
    keys.map((key) =>
      consumeQuota(kv as unknown as KVNamespace, key, limits, NOW).then(
        (allowed) => (allowed ? ('passed' as const) : ('capped' as const)),
        () => 'unavailable' as const,
      ),
    ),
  );
  return {
    passed: outcomes.filter((outcome) => outcome === 'passed').length,
    capped: outcomes.filter((outcome) => outcome === 'capped').length,
    unavailable: outcomes.filter((outcome) => outcome === 'unavailable').length,
  };
}

/** N visitors, each new, calling at the same moment. */
async function distinctVisitors(n: number, wave: number): Promise<string[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => clientKey(SECRET, `10.${Math.floor(wave / 250)}.${wave % 250}.${i}`)));
}

interface Sustained extends WaveResult {
  waves: number;
  kv: WaveKV;
}

/**
 * Runs waves until one is refused by a cap (429) with nobody served. `keysOf(wave)` says who calls in each wave;
 * waves are `gapMs` apart. Returns the totals over all waves.
 */
async function sustained(
  keysOf: (wave: number) => Promise<string[]>,
  limits: { perIp: number; total: number },
  gapMs = 1000,
): Promise<Sustained> {
  const kv = new WaveKV();
  const totals = { passed: 0, capped: 0, unavailable: 0 };
  let waves = 0;
  for (let wave = 0; wave < 5000; wave++) {
    const result = await runWave(kv, await keysOf(wave), wave * gapMs, limits);
    if (result.passed === 0 && result.capped > 0) break;
    totals.passed += result.passed;
    totals.unavailable += result.unavailable;
    waves += 1;
  }
  return { ...totals, waves, kv };
}

const CAP = { perIp: 60, total: 400 };

/** Waves of `visitors` simultaneous new visitors, one wave a second, until a cap bites. */
const sustainedWaves = (visitors: number) => sustained((wave) => distinctVisitors(visitors, wave), CAP);

describe('overshoot of the daily total under simultaneous requests, failing closed (cap 400; the table in worker/README.md)', () => {
  it('a wave of N simultaneous visitors serves only the first writer of each shard: at most 16, one per distinct shard', async () => {
    const kv = new WaveKV();
    kv.store.set(shardKey(0), '399'); // one call left under the cap of 400
    const keys = await distinctVisitors(50, 0);
    const distinctShards = new Set(keys.map(shardOf)).size;
    const result = await runWave(kv, keys, 0, CAP);
    // Every one of the 50 read 399, so none was capped; the others could not save their shard counter and got a 503.
    expect(result.capped).toBe(0);
    expect(result.passed).toBe(distinctShards);
    expect(result.passed).toBeGreaterThan(1);
    expect(result.passed).toBeLessThanOrEqual(TOTAL_SHARDS);
    expect(result.unavailable).toBe(50 - distinctShards);
    // The overshoot of the cap is what passed minus the one call that was left: at most TOTAL_SHARDS - 1 = 15.
    expect(kv.total()).toBe(399 + result.passed);
    // The very next wave sees the sum over the cap and serves nobody.
    const next = await runWave(kv, await distinctVisitors(50, 1), 1000, CAP);
    expect(next).toEqual({ passed: 0, capped: 50, unavailable: 0 });
  });

  it('sustained waves, one a second: the exact calls served before the cap bites, as quoted in worker/README.md', async () => {
    // Deterministic: the HMAC of fixed addresses under a fixed secret, and a KV model that refuses a second write to
    // a key within one second. These are the numbers in the README table. They change if the sharding rule, the
    // secret SECRET or the addresses in distinctVisitors change; then change the README table too.
    const expected: Record<number, { passed: number; unavailable: number }> = {
      1: { passed: 400, unavailable: 0 },
      2: { passed: 400, unavailable: 14 },
      3: { passed: 401, unavailable: 19 },
      5: { passed: 403, unavailable: 52 },
      10: { passed: 402, unavailable: 118 },
      20: { passed: 409, unavailable: 291 },
      50: { passed: 403, unavailable: 897 },
    };
    for (const [n, want] of Object.entries(expected)) {
      const result = await sustainedWaves(Number(n));
      expect({ passed: result.passed, unavailable: result.unavailable }, `waves of ${n}`).toEqual(want);
      // Every served call was counted exactly once in the total, and the total overshoots 400 by at most 15.
      expect(result.kv.total()).toBe(result.passed);
      expect(result.passed).toBeGreaterThanOrEqual(400);
      expect(result.passed).toBeLessThanOrEqual(400 + TOTAL_SHARDS - 1);
    }
  });

  it('faster waves do not overshoot more: 50 simultaneous requests every 0.2 s still serve only one write a second per shard', async () => {
    const result = await sustained((wave) => distinctVisitors(50, wave), CAP, 200);
    expect({ passed: result.passed, unavailable: result.unavailable }).toEqual({ passed: 400, unavailable: 5800 });
    expect(result.kv.total()).toBe(result.passed);
    expect(result.passed).toBeGreaterThanOrEqual(400);
    expect(result.passed).toBeLessThanOrEqual(400 + TOTAL_SHARDS - 1);
  });

  it('one visitor sending 20 concurrent calls: only one is served per second, so it stops exactly at its own cap of 60', async () => {
    // Concurrent calls from one visitor all read the same counts and then race for the same two keys (its IP key and
    // its shard): one write a second per key, so one call is served and 19 get a 503. 60 waves reach the cap.
    const key = await clientKey(SECRET, '203.0.113.7');
    const result = await sustained(async () => Array<string>(20).fill(key), CAP);
    expect(result.waves).toBe(60);
    expect(result.passed).toBe(60);
    expect(result.unavailable).toBe(60 * 19);
  });

  it('...and new such visitors in turn: one call is served per wave, so the total stops at its cap of 400', async () => {
    const result = await sustained(async (wave) => Array<string>(20).fill((await distinctVisitors(1, wave))[0]!), CAP);
    expect(result.waves).toBe(400);
    expect(result.passed).toBe(400);
    expect(result.unavailable).toBe(400 * 19);
  });

  it('visitors who call less than once a second are all served until the cap (the "try again later" is for bursts)', async () => {
    // One call per second from a new visitor each time, and the same visitor again 20 s later: never two writes to a
    // key within a second, so nobody gets a 503 and the cap is exact.
    const result = await sustained((wave) => distinctVisitors(1, wave % 200), CAP);
    expect(result.unavailable).toBe(0);
    expect(result.passed).toBe(400);
  });
});
