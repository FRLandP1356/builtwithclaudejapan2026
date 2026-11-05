import { describe, expect, test } from 'vitest';
import { loadAllAreas, loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { total } from '../engine/aggregate';
import { DEFAULT_SCENARIO } from '../engine/types';
import { createRunner, isScenarioError, sanitizeScenario, scenarioKey } from './runner';

describe('sanitizeScenario', () => {
  test('fills missing fields from the default scenario', () => {
    const s = sanitizeScenario({});
    expect(s).toEqual(DEFAULT_SCENARIO);
  });

  test('accepts values inside the allowed ranges', () => {
    const s = sanitizeScenario({ cwrMult: 1.4, migScale: 0, infraStrength: 0.01, migMode: 'fade' });
    expect(isScenarioError(s)).toBe(false);
    expect(s).toEqual({ cwrMult: 1.4, migScale: 0, infraStrength: 0.01, migMode: 'fade' });
  });

  test('rejects out-of-range values with a message naming the field', () => {
    for (const [patch, field] of [
      [{ cwrMult: 0.59 }, 'cwrMult'],
      [{ cwrMult: 1.41 }, 'cwrMult'],
      [{ migScale: -0.1 }, 'migScale'],
      [{ migScale: 1.6 }, 'migScale'],
      [{ infraStrength: -0.001 }, 'infraStrength'],
      [{ infraStrength: 0.02 }, 'infraStrength'],
    ] as const) {
      const r = sanitizeScenario(patch);
      expect(isScenarioError(r)).toBe(true);
      if (isScenarioError(r)) expect(r.error).toContain(field);
    }
  });

  test('rejects NaN, Infinity and non-numbers', () => {
    expect(isScenarioError(sanitizeScenario({ cwrMult: NaN }))).toBe(true);
    expect(isScenarioError(sanitizeScenario({ migScale: Infinity }))).toBe(true);
    expect(isScenarioError(sanitizeScenario({ infraStrength: '0' as unknown as number }))).toBe(true);
  });

  test('rejects an unknown migMode', () => {
    const r = sanitizeScenario({ migMode: 'stop' as unknown as 'hold' });
    expect(isScenarioError(r)).toBe(true);
    if (isScenarioError(r)) expect(r.error).toContain('migMode');
  });
});

describe('sanitizeScenario with values from an untrusted caller', () => {
  const asScenario = (patch: Record<string, unknown>) => patch as never;
  const hostile: Array<[string, unknown]> = [
    ['an object whose toString is not a function', { toString: 1 }],
    ['an object with no prototype', Object.create(null)],
    ['an object whose toString throws', { toString: () => { throw new Error('boom'); } }],
    ['an array', [1, 2, 3]],
    ['a huge array', new Array(1_000_000).fill(1)],
    ['a function', () => 1],
  ];

  test.each(hostile)('%s is an error result, not a throw, for every field', (_name, value) => {
    for (const key of ['cwrMult', 'migScale', 'infraStrength', 'migMode']) {
      const r = sanitizeScenario(asScenario({ [key]: value }));
      expect(isScenarioError(r)).toBe(true);
      if (isScenarioError(r)) {
        expect(r.error).toContain(key);
        expect(r.error.length).toBeLessThan(120);
      }
    }
  });

  test('an object or a function is named by its type, not turned into text', () => {
    expect(sanitizeScenario(asScenario({ cwrMult: { toString: 1 } }))).toEqual({ error: 'cwrMult must be a finite number, got object' });
    expect(sanitizeScenario(asScenario({ migScale: () => 1 }))).toEqual({ error: 'migScale must be a finite number, got function' });
    expect(sanitizeScenario(asScenario({ migMode: Object.create(null) }))).toEqual({ error: 'migMode must be one of hold|fade, got object' });
  });

  test('null, a symbol and a bigint are told as they are', () => {
    expect(sanitizeScenario(asScenario({ cwrMult: null }))).toEqual({ error: 'cwrMult must be a finite number, got null' });
    expect(sanitizeScenario(asScenario({ migScale: Symbol('s') }))).toEqual({ error: 'migScale must be a finite number, got Symbol(s)' });
    expect(sanitizeScenario(asScenario({ infraStrength: 10n }))).toEqual({ error: 'infraStrength must be a finite number, got 10' });
  });

  test('a long text is cut to 24 characters, in both messages', () => {
    const long = 'x'.repeat(5000);
    expect(sanitizeScenario(asScenario({ cwrMult: long }))).toEqual({ error: `cwrMult must be a finite number, got ${'x'.repeat(24)}` });
    expect(sanitizeScenario(asScenario({ migMode: long }))).toEqual({ error: `migMode must be one of hold|fade, got ${'x'.repeat(24)}` });
  });

  test('ordinary values keep their old messages', () => {
    expect(sanitizeScenario({ cwrMult: NaN })).toEqual({ error: 'cwrMult must be a finite number, got NaN' });
    expect(sanitizeScenario(asScenario({ infraStrength: '0' }))).toEqual({ error: 'infraStrength must be a finite number, got 0' });
    expect(sanitizeScenario({ migMode: 'stop' as unknown as 'hold' })).toEqual({ error: 'migMode must be one of hold|fade, got stop' });
    expect(sanitizeScenario({ cwrMult: 9 })).toEqual({ error: 'cwrMult must be within [0.6, 1.4], got 9' });
  });

  test('the runner refuses a hostile scenario with a RangeError, not a TypeError', () => {
    const runner = createRunner({ areas: [], facilities: [] });
    expect(() => runner.run(asScenario({ cwrMult: { toString: 1 } }))).toThrow(RangeError);
  });
});

describe('scenarioKey', () => {
  test('is independent of key order and object identity', () => {
    const a = { cwrMult: 1.2, migMode: 'fade', migScale: 0.8, infraStrength: 0 } as const;
    const b = { infraStrength: 0, migScale: 0.8, migMode: 'fade', cwrMult: 1.2 } as const;
    expect(scenarioKey(a)).toBe(scenarioKey(b));
    expect(scenarioKey(a)).not.toBe(scenarioKey({ ...a, cwrMult: 1.3 }));
  });
});

describe('createRunner', () => {
  test('runs the full area list and returns one series per area', () => {
    const areas = loadAllAreas();
    const runner = createRunner({ areas, facilities: loadFacilities() });
    const out = runner.run(DEFAULT_SCENARIO);
    expect(out.size).toBe(1884);
    expect(areas.every((a) => out.has(a.code))).toBe(true);
    const tanabe = out.get('30206')!;
    expect(Math.round(total(tanabe[2050]))).toBeGreaterThan(42000);
    expect(tanabe[2100]).toBeDefined();
  });

  test('memoises: an equal scenario (different object) returns the same Map', () => {
    const runner = createRunner({ areas: loadSampleAreas(), facilities: loadFacilities() });
    const a = runner.run({ ...DEFAULT_SCENARIO });
    const b = runner.run({ ...DEFAULT_SCENARIO });
    expect(b).toBe(a);
    const c = runner.run({ ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    expect(c).not.toBe(a);
    expect(runner.run({ ...DEFAULT_SCENARIO })).toBe(a); // still cached after another scenario
  });

  test('results differ between scenarios after 2050 only', () => {
    const areas = loadSampleAreas();
    const runner = createRunner({ areas, facilities: loadFacilities() });
    const hold = runner.run(DEFAULT_SCENARIO);
    const low = runner.run({ ...DEFAULT_SCENARIO, cwrMult: 0.8 });
    const code = areas.find((a) => a.assumptions !== null)!.code;
    expect(total(hold.get(code)![2050])).toBeCloseTo(total(low.get(code)![2050]), 6);
    expect(total(hold.get(code)![2100])).toBeGreaterThan(total(low.get(code)![2100]));
  });

  test('every scenario field changes the memo key and produces a different result', () => {
    const areas = loadAllAreas();
    const runner = createRunner({ areas, facilities: loadFacilities() });
    const base = runner.run(DEFAULT_SCENARIO);
    const variants: Array<[keyof typeof DEFAULT_SCENARIO, Partial<typeof DEFAULT_SCENARIO>]> = [
      ['cwrMult', { cwrMult: 1.2 }],
      ['migMode', { migMode: 'fade' }],
      ['migScale', { migScale: 0.5 }],
      ['infraStrength', { infraStrength: 0.005 }],
    ];
    for (const [field, patch] of variants) {
      const s = { ...DEFAULT_SCENARIO, ...patch };
      expect(scenarioKey(s), field).not.toBe(scenarioKey(DEFAULT_SCENARIO));
      const out = runner.run(s);
      expect(out, field).not.toBe(base);
      expect(out.size).toBe(1884);
      const differing = areas.filter((a) => Math.abs(total(out.get(a.code)![2100]) - total(base.get(a.code)![2100])) > 1e-6);
      expect(differing.length, `${field} changes the 2100 result of some areas`).toBeGreaterThan(0);
      // 2020-2050 are official and never move
      expect(total(out.get('30206')![2050])).toBeCloseTo(total(base.get('30206')![2050]), 6);
    }
  });

  test('a scenario with infra feedback runs with the facility list', () => {
    const runner = createRunner({ areas: loadSampleAreas(), facilities: loadFacilities() });
    const out = runner.run({ ...DEFAULT_SCENARIO, infraStrength: 0.005 });
    expect(out.size).toBe(loadSampleAreas().length);
  });
});
