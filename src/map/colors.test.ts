import { describe, expect, test } from 'vitest';
import {
  ALLOC_MIN_SCALE,
  allocationColor,
  allocationLegendRamp,
  allocationLegendStops,
  allocationScale,
  CHANGE_BREAKS,
  CHANGE_COLORS,
  changeClass,
  changeColor,
  DIVERGING_NEUTRAL,
  legendRamp,
  legendStops,
  MAP_NEUTRAL,
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
const WHITE = '#ffffff';
const ACCENT = '#2b4c7e';
const theme = readFileSync(repoPath('src/ui/theme.css'), 'utf8');

// -----------------------------------------------------------------------------------------------------------------
// Population relative to 2020: nine classes of one indigo, the fewer remain the paler
// -----------------------------------------------------------------------------------------------------------------

describe('changeClass and changeColor (population relative to 2020)', () => {
  test('nine classes, split at 1/16, 1/8, 1/4, 0.4, 1/2, 0.7 and 0.85, with "more than 1" as the last', () => {
    expect(CHANGE_BREAKS).toEqual([1 / 16, 1 / 8, 1 / 4, 0.4, 1 / 2, 0.7, 0.85]);
    expect(CHANGE_COLORS).toHaveLength(CHANGE_BREAKS.length + 2);
    expect(RATIO_MIN).toBe(1 / 16);
    const cases: Array<[number, number]> = [
      [-3, 0], [0, 0], [0.001, 0], [0.06, 0], // less than 1/16 remains
      [1 / 16, 1], [0.1, 1], // the lower bound belongs to its class
      [1 / 8, 2], [0.2, 2],
      [1 / 4, 3], [0.39, 3],
      [0.4, 4], [0.49, 4],
      [1 / 2, 5], [0.69, 5],
      [0.7, 6], [0.84, 6],
      [0.85, 7], [0.95, 7], [1, 7], // exactly the 2020 population is "same", not "grew"
      [1.0001, 8], [1.5, 8], [10, 8], [Infinity, 8],
    ];
    for (const [v, k] of cases) expect(changeClass(v), String(v)).toBe(k);
    expect(changeClass(NaN)).toBe(-1);
  });

  test('every class has its own lowercase #rrggbb colour; the fewer remain, the paler', () => {
    CHANGE_COLORS.forEach((c) => expect(c).toMatch(HEX));
    expect(new Set(CHANGE_COLORS).size).toBe(CHANGE_COLORS.length);
    const lums = CHANGE_COLORS.map(luminance);
    for (let k = 1; k < lums.length; k++) expect(lums[k], `class ${k}`).toBeLessThan(lums[k - 1]);
    // the colour of a ratio is the colour of its class, at the ends too
    expect(changeColor(0)).toBe(CHANGE_COLORS[0]);
    expect(changeColor(0.001)).toBe(CHANGE_COLORS[0]);
    expect(changeColor(-3)).toBe(CHANGE_COLORS[0]);
    expect(changeColor(0.3)).toBe(CHANGE_COLORS[3]);
    expect(changeColor(1)).toBe(changeColor(NEUTRAL_RATIO));
    expect(changeColor(1)).toBe(CHANGE_COLORS[7]);
    expect(changeColor(1.3)).toBe(CHANGE_COLORS[8]);
    expect(changeColor(Infinity)).toBe(CHANGE_COLORS[8]);
  });

  test('a ratio never seen as growth is not coloured as growth: only more than 1 gets the darkest class', () => {
    expect(changeColor(1)).not.toBe(changeColor(1.0001));
    expect(changeColor(0.99)).toBe(changeColor(1));
  });

  test('no data (NaN) is the map\'s neutral grey, which no class uses', () => {
    expect(changeColor(NaN)).toBe(MAP_NEUTRAL);
    expect(CHANGE_COLORS).not.toContain(MAP_NEUTRAL);
    expect(theme).toMatch(new RegExp(`--map-neutral:\\s*${MAP_NEUTRAL};`));
  });

  test('the colours are the accent mixed into white in OKLab: 0 .. 100 % in even sevenths, then 120 % for "grew"', () => {
    const w = oklab(WHITE);
    const a = oklab(ACCENT);
    const shares = [0, 1 / 7, 2 / 7, 3 / 7, 4 / 7, 5 / 7, 6 / 7, 1, 1.2];
    shares.forEach((share, k) => {
      const want = w.map((v, i) => v + (a[i] - v) * share);
      const got = oklab(CHANGE_COLORS[k]);
      const dE = Math.hypot(...got.map((v, i) => v - want[i]));
      expect(dE, `class ${k + 1}`).toBeLessThan(0.004); // within the 8-bit rounding of the hex
    });
    expect(CHANGE_COLORS[0]).toBe(WHITE); // the fewest remain: no colour at all
    expect(CHANGE_COLORS[7]).toBe(ACCENT); // "same as 2020" is the app's accent itself
  });

  test('the range is wide (white to a deep indigo), neighbouring classes can be told apart, and no class is the paper', () => {
    for (let k = 1; k < CHANGE_COLORS.length; k++) {
      expect(oklab(CHANGE_COLORS[k - 1])[0] - oklab(CHANGE_COLORS[k])[0], `ΔL ${k}`).toBeGreaterThanOrEqual(0.08);
      expect(contrast(CHANGE_COLORS[k - 1], CHANGE_COLORS[k]), `contrast ${k}`).toBeGreaterThanOrEqual(1.27);
    }
    // the owner asked for a wider range, down to no colour: the lightness spans 1.0 .. 0.3 (it was 0.90 .. 0.33)
    expect(oklab(CHANGE_COLORS[0])[0]).toBeCloseTo(1, 2);
    expect(oklab(CHANGE_COLORS[8])[0]).toBeLessThan(0.31);
    expect(oklab(CHANGE_COLORS[0])[0] - oklab(CHANGE_COLORS[8])[0]).toBeGreaterThan(0.69);
    expect(CHANGE_COLORS[0]).not.toBe(PAPER); // white, not the paper: the land is a hair lighter than the sea
    expect(contrast(CHANGE_COLORS[8], PAPER)).toBeGreaterThan(12);
  });

  test('theme.css mirrors the classes as --change-1 ... --change-9', () => {
    CHANGE_COLORS.forEach((c, k) => expect(theme).toMatch(new RegExp(`--change-${k + 1}:\\s*${c};`)));
    expect(theme).not.toMatch(/--change-10:/);
  });

  test('the diverging scale (kept for the allocation) is logarithmic: each halving moves the same distance', () => {
    expect(ratioToT(1)).toBe(0);
    expect(ratioToT(0.5)).toBeCloseTo(-1);
    expect(ratioToT(0.25)).toBeCloseTo(-2);
    expect(ratioToT(2)).toBeCloseTo(1);
  });
});

describe('allocation scale (change in percent, centred on 0)', () => {
  test('0 is the neutral; negative is rust, positive is blue', () => {
    expect(allocationColor(0, 10)).toBe(DIVERGING_NEUTRAL);
    const minus = allocationColor(-10, 10);
    const plus = allocationColor(10, 10);
    expect(minus).not.toBe(plus);
    // rust: the red channel dominates; blue: the blue channel dominates
    expect(parseInt(minus.slice(1, 3), 16)).toBeGreaterThan(parseInt(minus.slice(5, 7), 16));
    expect(parseInt(plus.slice(5, 7), 16)).toBeGreaterThan(parseInt(plus.slice(1, 3), 16));
    expect(RATIO_MAX).toBe(1.5);
  });

  test('the neutral is not any of the population classes (a reallocation reads as another map)', () => {
    expect(CHANGE_COLORS).not.toContain(DIVERGING_NEUTRAL);
    expect(DIVERGING_NEUTRAL).toMatch(HEX);
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
    expect(allocationColor(Number.NaN, 10)).toBe(DIVERGING_NEUTRAL);
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
    expect(stops[2].color).toBe(DIVERGING_NEUTRAL);
    const ramp = allocationLegendRamp(10, 4);
    expect(ramp.map((r) => r.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(ramp[2].color).toBe(DIVERGING_NEUTRAL);
  });
});

describe('legendStops and legendRamp (population relative to 2020)', () => {
  test('three labelled ticks on one row (2026-11-07; five on two rows before), from the fewest remaining to the 2020 level and more', () => {
    const stops = legendStops();
    expect(stops.map((s) => s.label)).toEqual(['16分の1以下', '半分', '同じ以上']);
    expect(stops.map((s) => s.ratio)).toEqual([RATIO_MIN, 1 / 2, Infinity]);
    for (let i = 1; i < stops.length; i++) expect(stops[i].ratio).toBeGreaterThan(stops[i - 1].ratio);
    expect(stops.some((s) => 'row' in s)).toBe(false); // nothing drops a row any more
  });

  test('the ticks sit on the bar\'s two ends and on the block edge at a half (nine equal blocks)', () => {
    const stops = legendStops();
    expect(stops.map((s) => s.offset)).toEqual([0, 5 / 9, 1]);
    for (let i = 1; i < stops.length; i++) expect(stops[i].offset).toBeGreaterThan(stops[i - 1].offset);
    expect(changeColor(1 / 2)).toBe(CHANGE_COLORS[5]); // 半分 opens the sixth block, whose left edge the tick marks
    expect(changeColor(NEUTRAL_RATIO)).toBe(CHANGE_COLORS[7]); // 同じ以上: the eighth block and the ninth, up to the right end
  });

  test('each tick carries the colour of the class it names (the first is the left-end block)', () => {
    const stops = legendStops();
    expect(stops[0].color).toBe(CHANGE_COLORS[0]);
    for (const s of stops.slice(1)) expect(s.color, s.label).toBe(changeColor(s.ratio));
  });

  test('the bar is one hard-edged block per class: 18 stops, equal widths, palest to darkest', () => {
    const ramp = legendRamp();
    const n = CHANGE_COLORS.length;
    expect(ramp).toHaveLength(2 * n);
    CHANGE_COLORS.forEach((c, k) => {
      expect(ramp[2 * k]).toEqual({ offset: k / n, color: c });
      expect(ramp[2 * k + 1]).toEqual({ offset: (k + 1) / n, color: c });
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Support ratio classes: grey to near black, the harder, the darker
// -----------------------------------------------------------------------------------------------------------------

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
    expect(SUPPORT_NO_DATA).toBe(MAP_NEUTRAL);
    expect(SUPPORT_COLORS).not.toContain(SUPPORT_NO_DATA);
  });

  test('the harder (the fewer people per older person), the closer to black: the first class is the darkest, the last the palest', () => {
    const lums = SUPPORT_COLORS.map(luminance);
    for (let k = 1; k < lums.length; k++) expect(lums[k], `class ${k}`).toBeGreaterThan(lums[k - 1]);
    expect(SUPPORT_COLORS[0]).toBe('#14181f'); // the darkest the owner allows
    expect(contrast(SUPPORT_COLORS[0], PAPER)).toBeGreaterThan(14);
  });

  test('the ramp is #14181f mixed into white in OKLab at 100, 80, 60, 40, 20 and 0 %', () => {
    const w = oklab(WHITE);
    const a = oklab('#14181f');
    [1, 0.8, 0.6, 0.4, 0.2, 0].forEach((share, k) => {
      const want = w.map((v, i) => v + (a[i] - v) * share);
      const got = oklab(SUPPORT_COLORS[k]);
      const dE = Math.hypot(...got.map((v, i) => v - want[i]));
      expect(dE, `step ${k + 1}`).toBeLessThan(0.004); // within the 8-bit rounding of the hex
    });
  });

  test('neighbouring classes can be told apart in even steps, and the palest is white, no colour', () => {
    const L = SUPPORT_COLORS.map((c) => oklab(c)[0]);
    for (let k = 1; k < L.length; k++) {
      expect(L[k] - L[k - 1], `ΔL ${k}`).toBeGreaterThanOrEqual(0.15);
      expect(contrast(SUPPORT_COLORS[k - 1], SUPPORT_COLORS[k]), `contrast ${k}`).toBeGreaterThanOrEqual(1.6);
    }
    expect(SUPPORT_COLORS[5]).toBe(WHITE); // the easiest places have no colour at all
    expect(SUPPORT_COLORS[5]).not.toBe(SUPPORT_NO_DATA); // and no data is a different, tinted grey
    // a grey ramp: every class has almost no chroma
    for (const c of SUPPORT_COLORS) {
      const [, x, y] = oklab(c);
      expect(Math.hypot(x, y), c).toBeLessThan(0.02);
    }
  });

  test('theme.css mirrors the ramp as --support-1 ... --support-6', () => {
    SUPPORT_COLORS.forEach((c, k) => expect(theme).toMatch(new RegExp(`--support-${k + 1}:\\s*${c};`)));
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
