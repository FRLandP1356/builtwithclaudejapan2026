import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { total } from '../engine/aggregate';
import { attachActual, parseActual } from './actual';
import type { Area } from '../engine/types';

const raw = JSON.parse(readFileSync('public/data/actual2025.json', 'utf8')) as unknown;

describe('parseActual', () => {
  it('reads the shipped file: 1,877 areas of 20 age groups each', () => {
    const m = parseActual(raw);
    expect(m.size).toBe(1877);
    expect(total(m.get('30206')!)).toBe(64288);
    expect(m.has('22131')).toBe(false); // the Hamamatsu wards
  });
  it('the counts add up to the national count except for the Hamamatsu wards', () => {
    const m = parseActual(raw);
    let sum = 0;
    for (const p of m.values()) sum += total(p);
    expect(sum).toBe(122207274);
  });
  it('rejects a wrong shape', () => {
    expect(() => parseActual(null)).toThrow();
    expect(() => parseActual({ version: 2, areas: {} })).toThrow(/version/);
    expect(() => parseActual({ version: 1, areas: { '30206': { M: [1], F: [1] } } })).toThrow(/30206/);
    expect(() => parseActual({ version: 1, areas: { abc: { M: Array(20).fill(1), F: Array(20).fill(1) } } })).toThrow();
    expect(() => parseActual({ version: 1, areas: { '30206': { M: Array(20).fill(-1), F: Array(20).fill(1) } } })).toThrow();
  });
});

describe('attachActual', () => {
  it('sets actual on the areas that have a count and returns how many', () => {
    const m = parseActual(raw);
    const areas = [{ code: '30206' }, { code: '22131' }] as unknown as Area[];
    expect(attachActual(areas, m)).toBe(1);
    expect(areas[0].actual).toBeDefined();
    expect(areas[1].actual).toBeUndefined();
  });
});
