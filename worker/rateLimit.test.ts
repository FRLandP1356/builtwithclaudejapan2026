import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clientKey, consumeQuota, normalizeClientIp } from './rateLimit';

const SECRET = 'unit-test-ip-hash-secret';
const LIMITS = { perIp: 5, total: 100 };
const NOW = new Date('2026-11-05T12:00:00Z');

/** KV fake that records start/end of each put so sequential writes can be asserted. */
class RecordingKV {
  store = new Map<string, string>();
  events: string[] = [];
  failPutFor: ((key: string) => boolean) | null = null;
  failGet = false;

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('kv get failed');
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
    expect(options?.expirationTtl).toBeGreaterThanOrEqual(60);
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

describe('consumeQuota', () => {
  it('reads both counters, then writes the total first and the IP second, one after the other', async () => {
    const kv = new RecordingKV();
    expect(await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).toBe(true);
    const keys = [...kv.store.keys()];
    expect(keys[0]).toBe('total:2026-11-05');
    expect(keys[1]).toMatch(/^ip:2026-11-05:[0-9a-f]{32}$/);
    expect(kv.events).toEqual([`start:${keys[0]}`, `end:${keys[0]}`, `start:${keys[1]}`, `end:${keys[1]}`]);
  });

  it('still saves the IP counter, and allows the request, when the total write fails (one warning, no details)', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('total:');
    expect(await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).toBe(true);
    expect([...kv.store.keys()]).toHaveLength(1);
    expect([...kv.store.keys()][0]).toMatch(/^ip:2026-11-05:[0-9a-f]{32}$/);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('rate counter write failed');
  });

  it('still saves the total counter, and allows the request, when the IP write fails', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = (key) => key.startsWith('ip:');
    expect(await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).toBe(true);
    expect([...kv.store.keys()]).toEqual(['total:2026-11-05']);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('allows the request and warns once, not twice, when both writes fail', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    expect(await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).toBe(true);
    expect(kv.store.size).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // Nothing identifying in the log: not the address, not a key, not the error text.
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/203\.0\.113\.7|total:|ip:|kv put failed|[0-9a-f]{32}/);
  });

  it('does not warn when the writes succeed', async () => {
    const kv = new RecordingKV();
    await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still refuses (false) when a quota is used up, whether or not writes would fail', async () => {
    const kv = new RecordingKV();
    kv.failPutFor = () => true;
    kv.store.set('total:2026-11-05', '100');
    expect(await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).toBe(false);
    expect(kv.events).toEqual([]); // nothing was written, so there was nothing to fail
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects, so the caller can fail closed, when a counter cannot be READ', async () => {
    const kv = new RecordingKV();
    kv.failGet = true;
    await expect(consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW)).rejects.toThrow('kv get failed');
    expect(kv.events).toEqual([]); // nothing was charged on the way out
  });

  it('hashes the IP with HMAC-SHA-256 keyed by the secret, truncated to 16 bytes', async () => {
    const kv = new RecordingKV();
    await consumeQuota(asKV(kv), '203.0.113.7', LIMITS, SECRET, NOW);
    const ipKey = [...kv.store.keys()].find((key) => key.startsWith('ip:'))!;
    expect(ipKey).toBe(`ip:2026-11-05:${await hmacHex16(SECRET, '203.0.113.7')}`);
    expect(ipKey).not.toContain('203.0.113.7');
  });

  it('gives the same client a different key under a different secret, and different clients different keys', async () => {
    const ipKeyFor = async (secret: string, ip: string) => {
      const kv = new RecordingKV();
      await consumeQuota(asKV(kv), ip, LIMITS, secret, NOW);
      return [...kv.store.keys()].find((key) => key.startsWith('ip:'))!;
    };
    const a = await ipKeyFor('secret-a', '203.0.113.7');
    expect(await ipKeyFor('secret-a', '203.0.113.7')).toBe(a);
    expect(await ipKeyFor('secret-b', '203.0.113.7')).not.toBe(a);
    expect(await ipKeyFor('secret-a', '203.0.113.8')).not.toBe(a);
  });

  it('hashes the normalized client, so one /64 is one bucket', async () => {
    const kv = new RecordingKV();
    const limits = { perIp: 1, total: 100 };
    expect(await consumeQuota(asKV(kv), '2001:db8:abcd:12::1', limits, SECRET, NOW)).toBe(true);
    expect(await consumeQuota(asKV(kv), '2001:db8:abcd:12:aaaa:bbbb:cccc:dddd', limits, SECRET, NOW)).toBe(false);
    expect(await consumeQuota(asKV(kv), '2001:db8:abcd:13::1', limits, SECRET, NOW)).toBe(true);
  });
});
