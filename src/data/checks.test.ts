import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deviation2018For2025Pct,
  deviationBins,
  deviationPct,
  deviationStep,
  parseChecks,
  summarize,
  type Checks,
} from './checks';

const raw = JSON.parse(readFileSync('public/data/checks.json', 'utf8')) as unknown;
const checks: Checks = parseChecks(raw);
const town = (code: string) => {
  const t = checks.towns.find((x) => x.code === code);
  if (!t) throw new Error(`no ${code}`);
  return t;
};

describe('parseChecks', () => {
  it('reads the shipped file: 1,884 towns, the national counts', () => {
    expect(checks.towns).toHaveLength(1884);
    expect(checks.census.national).toBe(122972528);
    expect(checks.census.national2020).toBe(126146099);
    expect(checks.ipss23.national2025).toBe(123262450);
    expect(checks.ipss18.national2025).toBe(122544103);
  });

  it('rejects a wrong shape', () => {
    expect(() => parseChecks(null)).toThrow();
    expect(() => parseChecks({ version: 2 })).toThrow(/version/);
    expect(() => parseChecks({ ...(raw as object), towns: [['x', 1]] })).toThrow(/town row/);
  });

  it('keeps only the known towns when asked', () => {
    const only = parseChecks(raw, (c) => c === '30206');
    expect(only.towns.map((t) => t.code)).toEqual(['30206']);
  });
});

describe('deviation', () => {
  it('Tanabe: 64,288 counted against 64,651 estimated', () => {
    const t = town('30206');
    expect(t.census2025).toBe(64288);
    expect(deviationPct(t)).toBeCloseTo(-0.5615, 3);
    expect(deviation2018For2025Pct(t)).toBeCloseTo(((64288 - 66008) / 66008) * 100, 6);
  });

  it('Suzu and Wajima fell far below the estimate; the Hamamatsu wards have no count', () => {
    expect(deviationPct(town('17205'))).toBeLessThan(-20);
    expect(deviationPct(town('17204'))).toBeLessThan(-15);
    expect(deviationPct(town('22131'))).toBeNull();
    expect(deviationStep(town('22131'))).toBeNull();
  });
});

describe('summarize', () => {
  const sm = summarize(checks);
  it('matches the numbers reported to the author', () => {
    expect(sm.n).toBe(1877);
    expect(sm.below).toBeGreaterThan(1150);
    expect(sm.median).toBeGreaterThan(-0.7);
    expect(sm.median).toBeLessThan(-0.5);
    expect(sm.national.count).toBe(122972528);
    expect(sm.national.diff).toBe(122972528 - 123262450);
    expect(sm.national.pct).toBeCloseTo(-0.2352, 3);
  });
  it('small towns fell further below the estimate than big ones', () => {
    expect(sm.bySize[0].median).toBeLessThan(sm.bySize[4].median);
    expect(sm.bySize.reduce((a, g) => a + g.n, 0)).toBe(sm.n);
  });
  it('the six steps add up to the towns with a count', () => {
    const bins = deviationBins(checks.towns);
    expect(bins).toHaveLength(6);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(sm.n);
  });
  it('the 2023 estimate (five years ahead) was closer than the 2018 estimate (ten years ahead)', () => {
    expect(sm.mape2023).toBeLessThan(sm.mape2018);
  });
});
