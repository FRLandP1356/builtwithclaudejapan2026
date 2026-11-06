import { describe, expect, test } from 'vitest';
import {
  ALLOC_MIN_SCALE,
  allocationColor,
  allocationLegendRamp,
  allocationLegendStops,
  allocationScale,
  changeColor,
  legendStops,
  NEUTRAL_RATIO,
  RATIO_MAX,
  RATIO_MIN,
  ratioToT,
  SUPPORT_BREAKS,
  SUPPORT_COLORS,
  SUPPORT_NO_DATA,
  supportClass,
  supportClassNames,
  supportColor,
  supportLegendRamp,
  supportLegendStops,
} from './colors';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../test/helpers/paths';
import { formatSupport } from '../ui/format';

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

describe('allocation scale (change in percent, centred on 0)', () => {
  test('0 is the same neutral as ratio 1; negative is rust, positive is blue', () => {
    expect(allocationColor(0, 10)).toBe(changeColor(1));
    const minus = allocationColor(-10, 10);
    const plus = allocationColor(10, 10);
    expect(minus).toBe(changeColor(RATIO_MIN)); // full rust arm
    expect(plus).toBe(changeColor(RATIO_MAX)); // full blue arm
    expect(minus).not.toBe(plus);
  });

  test('clamps beyond the domain and darkens monotonically on both sides', () => {
    expect(allocationColor(-50, 10)).toBe(allocationColor(-10, 10));
    expect(allocationColor(50, 10)).toBe(allocationColor(10, 10));
    const lum = (hex: string) => luminance(hex);
    const down = [0, -2, -4, -6, -8, -10].map((p) => lum(allocationColor(p, 10)));
    const up = [0, 2.5, 5, 7.5, 10].map((p) => lum(allocationColor(p, 10)));
    for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThan(down[i - 1]);
    for (let i = 1; i < up.length; i++) expect(up[i]).toBeLessThan(up[i - 1]);
  });

  test('a tiny change on a wide domain stays within a hair of neutral', () => {
    const neutral = allocationColor(0, 10);
    const tiny = allocationColor(-0.04, 10);
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    for (let i = 0; i < 3; i++) expect(Math.abs(channel(tiny, i) - channel(neutral, i))).toBeLessThanOrEqual(2);
    expect(allocationColor(Number.NaN, 10)).toBe(changeColor(1));
  });

  test('allocationScale picks a round half-width at or above the largest change, never below the minimum', () => {
    expect(allocationScale([10, -0.04, 0])).toBe(10);
    expect(allocationScale([3, -1])).toBe(ALLOC_MIN_SCALE);
    expect(allocationScale([-12])).toBe(20);
    expect(allocationScale([49.9])).toBe(50);
    expect(allocationScale([150])).toBe(200);
    expect(allocationScale([])).toBe(ALLOC_MIN_SCALE);
    expect(allocationScale([Number.NaN, 7])).toBe(10);
  });

  test('allocationScale compares at the shown precision: noise around a round number does not widen it', () => {
    expect(allocationScale([10.000000000000018])).toBe(10); // engine noise (北海道 +10% in 2100)
    expect(allocationScale([-10.0001])).toBe(10); // whole-person rounding on the AI path
    expect(allocationScale([20.04])).toBe(20); // shown as +20.0%
    expect(allocationScale([10.06])).toBe(20); // shown as +10.1%: really wider than 10
  });

  test('legend stops are symmetric with signed labels and a 0 in the middle', () => {
    const stops = allocationLegendStops(10);
    expect(stops.map((s) => s.label)).toEqual(['−10%', '−5%', '0', '+5%', '+10%']);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(stops[2].color).toBe(changeColor(1));
    const ramp = allocationLegendRamp(10, 4);
    expect(ramp.map((r) => r.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ramp[2].color).toBe(changeColor(1));
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

// -----------------------------------------------------------------------------------------------------------------
// Support ratio classes
// -----------------------------------------------------------------------------------------------------------------

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
/** sRGB hex -> OKLab (Björn Ottosson's matrices), written here independently of colors.ts. */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const PAPER = '#f6f5f0';
const ACCENT = '#2b4c7e';

describe('support ratio classes', () => {
  test('six classes split at 0.8, 1, 1.5, 2 and 3 people per person aged 65+', () => {
    expect(SUPPORT_BREAKS).toEqual([0.8, 1, 1.5, 2, 3]);
    expect(SUPPORT_COLORS).toHaveLength(SUPPORT_BREAKS.length + 1);
    const cases: Array<[number, number]> = [
      [0, 0], [0.3, 0], [0.74, 0], // shown 0.7
      [0.75, 1], [0.8, 1], [0.94, 1], // shown 0.8 .. 0.9
      [0.96, 2], [1, 2], [1.44, 2], // shown 1.0 .. 1.4
      [1.46, 3], [1.5, 3], [1.94, 3],
      [1.96, 4], [2, 4], [2.94, 4],
      [2.96, 5], [3, 5], [5.08, 5], [100, 5],
    ];
    for (const [v, k] of cases) expect(supportClass(v), String(v)).toBe(k);
  });

  test('the class always agrees with the one-decimal number printed for the same area', () => {
    for (let i = 0; i <= 6000; i++) {
      const v = i / 1000;
      const shown = Number(formatSupport(v).replace('人', ''));
      const k = supportClass(v);
      const lo = k === 0 ? -Infinity : SUPPORT_BREAKS[k - 1];
      const hi = k === SUPPORT_BREAKS.length ? Infinity : SUPPORT_BREAKS[k];
      expect(shown >= lo && shown < hi, `${v} shown ${shown} in class ${k}`).toBe(true);
    }
  });

  test('each class has its own colour; no ratio (nobody aged 65+) is the neutral grey, outside the ramp', () => {
    SUPPORT_COLORS.forEach((c) => expect(c).toMatch(HEX));
    expect(new Set(SUPPORT_COLORS).size).toBe(6);
    expect(supportColor(0.5)).toBe(SUPPORT_COLORS[0]);
    expect(supportColor(1.2)).toBe(SUPPORT_COLORS[2]);
    expect(supportColor(4)).toBe(SUPPORT_COLORS[5]);
    for (const v of [Number.NaN, Infinity, -Infinity]) {
      expect(supportClass(v)).toBe(-1);
      expect(supportColor(v)).toBe(SUPPORT_NO_DATA);
    }
    expect(SUPPORT_NO_DATA).toBe(changeColor(1));
    expect(SUPPORT_COLORS).not.toContain(SUPPORT_NO_DATA);
  });

  test('the ramp is the accent mixed into the paper in OKLab at 40, 52, 64, 76, 88 and 100 %', () => {
    const p = oklab(PAPER);
    const a = oklab(ACCENT);
    [0.4, 0.52, 0.64, 0.76, 0.88, 1].forEach((share, k) => {
      const want = p.map((v, i) => v + (a[i] - v) * share);
      const got = oklab(SUPPORT_COLORS[k]);
      const dE = Math.hypot(...got.map((v, i) => v - want[i]));
      expect(dE, `step ${k + 1}`).toBeLessThan(0.004); // within the 8-bit rounding of the hex
    });
    expect(SUPPORT_COLORS[5]).toBe(ACCENT);
  });

  test('light to dark in even steps that neighbours can tell apart, the palest clear of the paper, one hue', () => {
    const L = SUPPORT_COLORS.map((c) => oklab(c)[0]);
    for (let k = 1; k < L.length; k++) {
      expect(L[k - 1] - L[k], `ΔL ${k}`).toBeGreaterThanOrEqual(0.06);
      expect(contrast(SUPPORT_COLORS[k - 1], SUPPORT_COLORS[k]), `contrast ${k}`).toBeGreaterThanOrEqual(1.25);
    }
    expect(contrast(SUPPORT_COLORS[0], PAPER)).toBeGreaterThanOrEqual(2); // the palest class never reads as sea
    expect(contrast(SUPPORT_COLORS[0], changeColor(1))).toBeGreaterThan(1.3); // nor as the no-data grey
    const hues = SUPPORT_COLORS.map((c) => {
      const [, x, y] = oklab(c);
      return (Math.atan2(y, x) * 180) / Math.PI;
    });
    expect(Math.max(...hues) - Math.min(...hues)).toBeLessThan(10);
  });

  test('theme.css mirrors the ramp as --support-1 ... --support-6', () => {
    const css = readFileSync(repoPath('src/ui/theme.css'), 'utf8');
    SUPPORT_COLORS.forEach((c, k) => expect(css).toMatch(new RegExp(`--support-${k + 1}:\\s*${c};`)));
  });

  test('the legend: one even block per class with hard edges, a tick at each break, the classes in words', () => {
    const ramp = supportLegendRamp();
    expect(ramp).toHaveLength(12);
    SUPPORT_COLORS.forEach((c, k) => {
      expect(ramp[2 * k]).toEqual({ offset: k / 6, color: c });
      expect(ramp[2 * k + 1]).toEqual({ offset: (k + 1) / 6, color: c });
    });
    const stops = supportLegendStops();
    expect(stops.map((s) => s.label)).toEqual(['0.8人', '1人', '1.5人', '2人', '3人']);
    stops.forEach((s, i) => expect(s.offset).toBeCloseTo((i + 1) / 6, 12));
    expect(supportClassNames()).toEqual(['0.8人未満', '0.8〜1人', '1〜1.5人', '1.5〜2人', '2〜3人', '3人以上']);
  });
});
