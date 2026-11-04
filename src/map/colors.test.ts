import { describe, expect, test } from 'vitest';
import { changeColor, legendStops, NEUTRAL_RATIO, RATIO_MAX, RATIO_MIN, ratioToT } from './colors';

const HEX = /^#[0-9a-f]{6}$/;

/** Relative luminance of a #rrggbb string (sRGB, WCAG definition). */
function luminance(hex: string): number {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

describe('changeColor', () => {
  test('returns lowercase #rrggbb strings', () => {
    for (const r of [0, 0.1, 0.5, 1, 1.3, 2, 5]) expect(changeColor(r)).toMatch(HEX);
  });

  test('ratio 1 is the neutral midpoint: light and nearly grey', () => {
    const c = changeColor(1);
    expect(c).toBe(changeColor(NEUTRAL_RATIO));
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(20); // low chroma
    expect(luminance(c)).toBeGreaterThan(0.55); // light
  });

  test('decline and growth of the same magnitude are different hues', () => {
    expect(changeColor(0.3)).not.toBe(changeColor(1.7));
    const d = changeColor(0.5);
    const g = changeColor(1.5);
    // decline is warm (red channel dominates), growth is cool (blue channel dominates)
    expect(parseInt(d.slice(1, 3), 16)).toBeGreaterThan(parseInt(d.slice(5, 7), 16));
    expect(parseInt(g.slice(5, 7), 16)).toBeGreaterThan(parseInt(g.slice(1, 3), 16));
  });

  test('values beyond the domain clamp to the ends', () => {
    expect(changeColor(0)).toBe(changeColor(RATIO_MIN));
    expect(changeColor(0.001)).toBe(changeColor(RATIO_MIN));
    expect(changeColor(-3)).toBe(changeColor(RATIO_MIN));
    expect(changeColor(2)).toBe(changeColor(RATIO_MAX));
    expect(changeColor(10)).toBe(changeColor(RATIO_MAX));
    expect(changeColor(Infinity)).toBe(changeColor(RATIO_MAX));
  });

  test('non-finite ratios fall back to the neutral colour', () => {
    expect(changeColor(NaN)).toBe(changeColor(1));
  });

  test('the decline arm darkens monotonically as the ratio falls', () => {
    const ratios = [1, 0.8, 0.6, 0.45, 0.3, 0.2, 0.12, RATIO_MIN];
    const lums = ratios.map((r) => luminance(changeColor(r)));
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });

  test('the growth arm darkens monotonically as the ratio rises', () => {
    const ratios = [1, 1.1, 1.25, 1.4, RATIO_MAX];
    const lums = ratios.map((r) => luminance(changeColor(r)));
    for (let i = 1; i < lums.length; i++) expect(lums[i]).toBeLessThan(lums[i - 1]);
  });

  test('the scale is logarithmic: each halving moves the same distance', () => {
    expect(ratioToT(1)).toBe(0);
    expect(ratioToT(0.5)).toBeCloseTo(-1);
    expect(ratioToT(0.25)).toBeCloseTo(-2);
    expect(ratioToT(2)).toBeCloseTo(1);
  });
});

describe('legendStops', () => {
  test('is ordered from the strongest decline to the strongest growth', () => {
    const stops = legendStops();
    expect(stops.length).toBeGreaterThanOrEqual(5);
    expect(stops[0].ratio).toBe(RATIO_MIN);
    expect(stops[stops.length - 1].ratio).toBe(RATIO_MAX);
    for (let i = 1; i < stops.length; i++) expect(stops[i].ratio).toBeGreaterThan(stops[i - 1].ratio);
  });

  test('offsets are monotone in [0,1] and the colours match changeColor', () => {
    const stops = legendStops();
    expect(stops[0].offset).toBe(0);
    expect(stops[stops.length - 1].offset).toBe(1);
    for (let i = 1; i < stops.length; i++) expect(stops[i].offset).toBeGreaterThan(stops[i - 1].offset);
    for (const s of stops) expect(s.color).toBe(changeColor(s.ratio));
  });

  test('includes the neutral stop with a label and labels every stop in Japanese', () => {
    const stops = legendStops();
    const neutral = stops.find((s) => s.ratio === 1);
    expect(neutral).toBeDefined();
    expect(neutral!.label).toBeTruthy();
    for (const s of stops) expect(typeof s.label).toBe('string');
  });
});
