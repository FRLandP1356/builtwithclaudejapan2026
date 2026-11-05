import { describe, expect, it } from 'vitest';
import type { Env } from './index';
import wranglerText from './wrangler.jsonc?raw';

// The deploy configuration is code too: a renamed binding would deploy fine and then answer 503 on every call, a
// changed limit or period would quietly change the burst cap, and a DAILY_* var would silently override the code
// defaults. The tests in this file read the committed worker/wrangler.jsonc and pin those things.

/** Removes // and /* *\/ comments that are not inside a string ("http://localhost:5173" contains //). */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
    } else {
      out += char;
    }
  }
  return out;
}

interface WranglerConfig {
  name?: string;
  main?: string;
  observability?: {
    enabled?: boolean;
    logs?: { enabled?: boolean; invocation_logs?: boolean; head_sampling_rate?: number };
    traces?: { enabled?: boolean };
  };
  kv_namespaces?: Array<{ binding?: string; id?: string }>;
  ratelimits?: Array<{ name?: string; namespace_id?: string; simple?: { limit?: number; period?: number } }>;
  vars?: Record<string, unknown>;
}

const config = JSON.parse(stripJsonComments(wranglerText)) as WranglerConfig;

// Type-level link to the code: if a binding is renamed in the Env type, these stop compiling.
const KV_BINDING: keyof Env = 'RATE_KV';
const LIMITER_BINDING: keyof Env = 'IP_LIMITER';

describe('stripJsonComments (the helper these tests rely on)', () => {
  it('drops line and block comments but keeps // inside strings', () => {
    const text = '{ "a": "http://x.example", // gone\n "b": 1, /* gone\n too */ "c": "/* kept */" }';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ a: 'http://x.example', b: 1, c: '/* kept */' });
    expect(JSON.parse(stripJsonComments('{ "q": "a\\"//b" }'))).toEqual({ q: 'a"//b' });
  });
});

describe('worker/wrangler.jsonc', () => {
  it('parsed: it is the Worker config we think it is', () => {
    expect(config.name).toBe('town-2100-api');
    expect(config.main).toBe('index.ts');
  });

  it('declares the burst limiter exactly: binding IP_LIMITER (as the Env type and the code use it), 20 calls per 60 s', () => {
    expect(config.ratelimits).toStrictEqual([
      {
        name: LIMITER_BINDING,
        namespace_id: expect.stringMatching(/^[1-9]\d*$/),
        simple: { limit: 20, period: 60 },
      },
    ]);
    expect(LIMITER_BINDING).toBe('IP_LIMITER');
  });

  it('declares one KV namespace under the binding RATE_KV that the code reads', () => {
    expect(config.kv_namespaces).toHaveLength(1);
    expect(config.kv_namespaces![0]!.binding).toBe(KV_BINDING);
    expect(KV_BINDING).toBe('RATE_KV');
  });

  it('sets no daily-limit var and no secret as a var: the code defaults (60 and 400) apply, secrets stay in `wrangler secret`', () => {
    const names = Object.keys(config.vars ?? {});
    expect(names).toEqual(['ALLOWED_ORIGINS']);
    expect(names.filter((name) => name.startsWith('DAILY_'))).toEqual([]);
    expect(JSON.stringify(config)).not.toMatch(/ANTHROPIC_API_KEY|IP_HASH_SECRET|sk-ant/);
  });

  it('records the Worker\'s console lines only: logs on, invocation logs off, no traces', () => {
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.enabled).toBe(true);
    // Invocation logs would record request details (client address, headers) that the Worker works to keep out of
    // its own logs.
    expect(config.observability?.logs?.invocation_logs).toBe(false);
    expect(config.observability?.traces?.enabled ?? false).toBe(false);
  });
});
