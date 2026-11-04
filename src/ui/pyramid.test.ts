import { describe, expect, test } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { total } from '../engine/aggregate';
import { projectArea } from '../engine/project';
import { DEFAULT_SCENARIO, type Pop } from '../engine/types';
import { AGE_LABELS, pyramidBars, pyramidScale } from './pyramid';

const areas = loadAllAreas();
const tanabe = byCode(areas, '30206');

describe('pyramidBars', () => {
  test('pyramidBars_has_20_rows', () => {
    const rows = pyramidBars(tanabe.base);
    expect(rows).toHaveLength(20);
    expect(rows[0].age).toBe('0〜4歳');
    expect(rows[1].age).toBe('5〜9歳');
    expect(rows[18].age).toBe('90〜94歳');
    expect(rows[19].age).toBe('95歳以上');
    expect(AGE_LABELS).toHaveLength(20);
    expect(rows.map((r) => r.age)).toEqual([...AGE_LABELS]);
  });

  test('uses the wave dash U+301C, not the fullwidth tilde', () => {
    for (const r of pyramidBars(tanabe.base).slice(0, 19)) {
      expect(r.age).toContain('〜');
      expect(r.age).not.toContain('～');
    }
  });

  test('males plus females equal total(p) for the census base and for projected years', () => {
    const series = projectArea(tanabe, DEFAULT_SCENARIO);
    for (const p of [tanabe.base, series[2050], series[2100]]) {
      const rows = pyramidBars(p);
      expect(rows.reduce((s, r) => s + r.male + r.female, 0)).toBeCloseTo(total(p), 6);
    }
  });

  test('rows run from the youngest to the oldest and keep the sexes apart', () => {
    const p: Pop = { M: Array.from({ length: 20 }, (_, i) => i + 1), F: Array.from({ length: 20 }, (_, i) => 100 + i) };
    const rows = pyramidBars(p);
    expect(rows[0]).toEqual({ age: '0〜4歳', male: 1, female: 100 });
    expect(rows[19]).toEqual({ age: '95歳以上', male: 20, female: 119 });
  });

  test('rejects a population that does not have 20 age classes', () => {
    expect(() => pyramidBars({ M: [1, 2], F: [1, 2] })).toThrow(RangeError);
  });
});

describe('pyramidScale', () => {
  test('rounds the larger sex up to a clean axis with at most three steps', () => {
    const s = pyramidScale(3420);
    expect(s.ticks[0]).toBe(0);
    expect(s.max).toBeGreaterThanOrEqual(3420);
    expect(s.max).toBeLessThan(3420 * 1.6);
    expect(s.ticks.length - 1).toBeLessThanOrEqual(3);
    expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
  });

  test('gives a usable axis for a place with nobody in it', () => {
    const s = pyramidScale(0);
    expect(s.max).toBeGreaterThan(0);
    expect(s.ticks[0]).toBe(0);
  });
});
