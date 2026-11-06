// Colour scales for the maps: the population in year Y relative to 2020 (classes of one indigo from colourless to dark),
// the support ratio (classes from colourless to near black) and, while a reallocation is drawn, its change in percent
// (the diverging rust / blue scale kept at the end of the file).
//
// Population relative to 2020 (decided 2026-11-06 with the owner; see src/ui/DESIGN.md):
// - One hue, the app's indigo (--accent #2b4c7e), by lightness alone: the fewer people remain, the paler the area, down
//   to no colour at all (white; the owner asked for the widest range, 2026-11-06 evening); an area that kept its 2020
//   population is dark; an area that grew is the darkest of all.
// - Hard classes, not a gradient: the owner asked for steps that read at a glance even on the pale end. Nine classes,
//   their lower bounds 1/16, 1/8, 1/4, 0.4, 1/2, 0.7, 0.85 and "more than 1" (CHANGE_BREAKS). Counted on the default
//   scenario (2026-11-06): the four steps from 1/16 to 1/4 and 1/2 resolve the towns of 2100 (median 0.25, 5th percentile
//   0.055: 123 / 324 / 482 / 351 / 156 / 294 / 104 / 41 / 9 towns per class); 0.4 splits the 1/4 .. 1/2 block that held 35
//   of the 47 prefectures of 2100 (now 4 / 20 / 15 / 7 / 1 over five classes; 2075: 3 / 10 / 27 / 6 / 1); the two breaks
//   inside 1/2 .. 1 resolve the prefectures of 2050 (0.58 .. 1.03: 11 / 28 / 7 / 1): Tohoku and Shikoku in 1/2 .. 0.7, most
//   of the country in 0.7 .. 0.85, the Kanto core, Aichi, Fukuoka and Okinawa in 0.85 .. 1, Tokyo above 1.
// - The colours are --accent mixed into white in OKLab at 0, 14.3, 28.6, 42.9, 57.1, 71.4, 85.7, 100 and 120 %: even
//   steps of 0.083 in OKLab lightness from white (L 1.0) to the "same" class (WCAG 1.28 .. 1.43 between neighbours; the
//   first range was 0.904 .. 0.334, now 1.0 .. 0.301). The palest class is white itself, 1.09:1 against the paper: no
//   colour, so the map's lines (translucent ink, app.css) make its shape. The "same as 2020" class is the accent itself,
//   the "grew" class the same hue darker (120 % extrapolates the mix; 122 % would leave the sRGB gamut).
// Values beyond the domain (including +-Infinity) fall into the end classes; NaN (no data) is the neutral grey.

/**
 * Lower bounds of the classes above the first: < 1/16, 1/16 .. 1/8, 1/8 .. 1/4, 1/4 .. 0.4, 0.4 .. 1/2, 1/2 .. 0.7,
 * 0.7 .. 0.85, 0.85 .. 1 (same), > 1 (grew).
 */
export const CHANGE_BREAKS: readonly number[] = [1 / 16, 1 / 8, 1 / 4, 0.4, 1 / 2, 0.7, 0.85];
export const RATIO_MIN = CHANGE_BREAKS[0];
export const NEUTRAL_RATIO = 1;

/**
 * One colour per class, palest (white) to darkest (theme.css --change-1 ... --change-9 mirror these). The OKLab mix of
 * --accent (#2b4c7e) into white at 0 .. 120 % in even steps of lightness (see the header).
 */
export const CHANGE_COLORS: readonly string[] = ['#ffffff', '#dee4ed', '#bec9da', '#9fafc8', '#8196b5', '#637da3', '#476490', '#2b4c7e', '#012a64'];

/** The map's neutral grey (theme.css --map-neutral): no data, and the fill before the first data arrives. */
export const MAP_NEUTRAL = '#d0c9c4';

/**
 * Class index 0..8 of a ratio to 2020, or -1 for NaN. The lower bounds are inclusive; the last class is strictly
 * more than 1 (an area with exactly its 2020 population is "same", not "grew").
 */
export function changeClass(ratioTo2020: number): number {
  if (Number.isNaN(ratioTo2020)) return -1;
  if (ratioTo2020 > NEUTRAL_RATIO) return CHANGE_COLORS.length - 1;
  let k = 0;
  while (k < CHANGE_BREAKS.length && ratioTo2020 >= CHANGE_BREAKS[k]) k++;
  return k;
}

/** Fill colour for an area whose population is `ratioTo2020` times its 2020 population. */
export function changeColor(ratioTo2020: number): string {
  const k = changeClass(ratioTo2020);
  return k < 0 ? MAP_NEUTRAL : CHANGE_COLORS[k];
}

export interface LegendStop {
  /** Ratio to 2020 at this tick. */
  ratio: number;
  /** Position along the legend bar, 0 (strongest decline) .. 1 (strongest growth). */
  offset: number;
  color: string;
  /** Japanese tick label; empty string for an unlabelled tick. */
  label: string;
  /** 2 drops the label a row (a longer tick line), for labels that would touch their neighbours on one row. */
  row?: 1 | 2;
}

/**
 * Ticks for the population legend over nine equal blocks: the first block's label on the left end, the labelled
 * breaks at the borders between blocks, the last block's label on the right end. Only the breaks the owner named are
 * labelled (16分の1以下 / 4分の1 / 半分 / 同じ / 増えた所は一番濃い); the block edges show the other borders. Two labels
 * drop a row so that none touches its neighbour on a legend as narrow as 280px (the desktop column).
 */
export function legendStops(): LegendStop[] {
  const n = CHANGE_COLORS.length;
  return [
    { ratio: RATIO_MIN, offset: 0, color: CHANGE_COLORS[0], label: '16分の1以下' },
    { ratio: 1 / 4, offset: 3 / n, color: CHANGE_COLORS[3], label: '4分の1', row: 2 }, // close to the first label: a row down
    { ratio: 1 / 2, offset: 5 / n, color: CHANGE_COLORS[5], label: '半分' },
    { ratio: NEUTRAL_RATIO, offset: 8 / n, color: CHANGE_COLORS[7], label: '同じ' },
    { ratio: Infinity, offset: 1, color: CHANGE_COLORS[n - 1], label: '増えた所は一番濃い', row: 2 }, // wider than its block
  ];
}

/** Hard-edged stops for the population legend: one even block per class, palest to darkest. */
export function legendRamp(): Array<{ offset: number; color: string }> {
  const n = CHANGE_COLORS.length;
  return CHANGE_COLORS.flatMap((color, k) => [
    { offset: k / n, color },
    { offset: (k + 1) / n, color },
  ]);
}

// -----------------------------------------------------------------------------------------------------------------
// Allocation overlay: change in percent caused by a reallocation, a symmetric diverging scale centred on 0.
// Two arms (rust = fewer people, blue = more people) around the neutral grey; the rust arm has more steps than the
// blue one. This is the diverging scale the ratio map used before 2026-11-06, kept for the allocation only: stops in
// OKLCH, interpolated in OKLab, positioned on t = log2(ratio) (0 at no change, -4 at 1/16, about 0.585 at 1.5).
// -----------------------------------------------------------------------------------------------------------------

export const RATIO_MAX = 1.5;

/** Position on the diverging scale: log2 of the ratio (0 at no change, -1 at a halving, +1 at a doubling). */
export function ratioToT(ratio: number): number {
  return Math.log2(ratio);
}

const T_MIN = ratioToT(RATIO_MIN); // -4
const T_MAX = ratioToT(RATIO_MAX); // ~0.585

type Oklab = [number, number, number];

/** OKLCH (L 0..1, C, hue in degrees) -> OKLab. */
function lch(L: number, C: number, h: number): Oklab {
  const rad = (h * Math.PI) / 180;
  return [L, C * Math.cos(rad), C * Math.sin(rad)];
}

// [t, colour] stops; t is log2(ratio). Shared neutral at t = 0 (the same grey as MAP_NEUTRAL).
const NEUTRAL: Oklab = lch(0.84, 0.01, 60);
const STOPS: ReadonlyArray<readonly [number, Oklab]> = [
  [T_MIN, lch(0.37, 0.12, 30)], // 1/16
  [-3, lch(0.5, 0.14, 32)], // 1/8
  [-2, lch(0.64, 0.125, 35)], // 1/4
  [-1, lch(0.76, 0.075, 40)], // 1/2
  [0, NEUTRAL], // same as 2020
  [ratioToT(1.22), lch(0.7, 0.105, 250)],
  [T_MAX, lch(0.53, 0.12, 255)], // 1.5x
];

function oklabToHex([L, a, b]: Oklab): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (x: number): string => {
    const c = Math.min(1, Math.max(0, x));
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${gamma(r)}${gamma(g)}${gamma(bl)}`;
}

function interpolateAt(t: number): Oklab {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const u = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// Quantise t to 1/200 so repeated calls return identical strings (cheap to diff against the current fill)
// and the cache stays small.
const QUANT = 200;
const cache = new Map<number, string>();

/** Colour of the diverging scale at t = log2(ratio): the allocation's two arms and their neutral. */
function divergingColor(t: number): string {
  const q = Math.round(t * QUANT);
  let hex = cache.get(q);
  if (hex === undefined) {
    hex = oklabToHex(interpolateAt(q / QUANT));
    cache.set(q, hex);
  }
  return hex;
}

/** The diverging scale's neutral (ratio 1): the map's neutral grey. */
export const DIVERGING_NEUTRAL = divergingColor(0);

/** The smallest half-width of the percent domain: tiny changes stay almost neutral instead of filling the ramp. */
export const ALLOC_MIN_SCALE = 5;
const NICE_SCALES = [5, 10, 20, 30, 50, 100];

/**
 * Half-width of the symmetric domain for a set of percent changes: a round number at or above the largest |change|,
 * compared at the precision the screen shows (one decimal, as formatDeltaPct). Floating-point noise from the engine
 * (10.000000000000018) or whole-person rounding (10.0001) must not widen a +10% allocation to ±20.
 */
export function allocationScale(changes: Iterable<number>): number {
  let max = 0;
  for (const v of changes) if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v);
  const shown = Math.round(max * 10) / 10;
  for (const s of NICE_SCALES) if (shown <= s) return Math.max(ALLOC_MIN_SCALE, s);
  return Math.ceil(shown / 100) * 100;
}

/** Fill colour for a change of `percent` on a domain of +-`scale` percent. 0 is the neutral; beyond +-scale clamps. */
export function allocationColor(percent: number, scale: number): string {
  if (Number.isNaN(percent) || !(scale > 0)) return DIVERGING_NEUTRAL;
  const u = Math.max(-1, Math.min(1, percent / scale));
  return divergingColor(u < 0 ? T_MIN * -u : T_MAX * u);
}

/** Labelled ticks for the allocation legend: -scale, -scale/2, 0, +scale/2, +scale. */
export function allocationLegendStops(scale: number): LegendStop[] {
  const fmt = (p: number) => (p === 0 ? '0' : `${p < 0 ? '−' : '+'}${Math.abs(p)}%`);
  return [-scale, -scale / 2, 0, scale / 2, scale].map((p, i) => ({
    ratio: p,
    offset: i / 4,
    color: allocationColor(p, scale),
    label: fmt(p),
  }));
}

// -----------------------------------------------------------------------------------------------------------------
// Support ratio: people aged 15-64 per person aged 65+ (src/engine/aggregate.ts supportRatio), a sequential scale in
// classes. The fewer people there are per older person (the harder it is), the closer to black; the more, the paler,
// down to no colour at all (white). Decided 2026-11-06 with the owner (the earlier indigo ramp read "darker = more", the
// opposite of what people expect from a map of strain; the pale end was widened to white the same evening).
//
// Class breaks, from the distribution of all 1,884 areas in 2020 and 2100 (default scenario, computed 2026-11-06 from
// public/data; the class counts use the values rounded to one decimal, as on screen):
//   2020: min 0.50, 5th percentile 0.93, median 1.62, 95th 2.91, max 5.08; prefectures 1.41..2.91; Japan 2.08.
//   2100: min 0.20, 5th percentile 0.45, median 0.98, 95th 1.69, max 4.29; prefectures 0.80..1.94; Japan 1.44.
// Breaks 0.8 / 1 / 1.5 / 2 / 3 give six classes that each hold areas in both years (areas per class, low to high:
// 2020: 21, 85, 637, 553, 501, 87; 2050: 363, 401, 756, 295, 63, 6; 2100: 556, 338, 686, 257, 43, 4), keep 1 (one
// working-age person per older person) as a break, and leave the prefectures spread over four classes. Breaks at
// 1 / 1.5 / 2 / 3 / 4 alone would put about half of all areas of 2100 (894) into the lowest class.
// -----------------------------------------------------------------------------------------------------------------

/** Lower bounds of the classes above the first: < 0.8, 0.8-1, 1-1.5, 1.5-2, 2-3, 3 and more. */
export const SUPPORT_BREAKS: readonly number[] = [0.8, 1, 1.5, 2, 3];

/**
 * One colour per class, fewest people per older person first (near black) to most (white, no colour): #14181f mixed
 * into white in OKLab at 100, 80, 60, 40, 20 and 0 % (theme.css --support-1 ... --support-6 mirror these). Even steps
 * of 0.158 in OKLab lightness (WCAG 1.62 to 1.95 between neighbours); the palest is white, 1.09:1 against the paper, so
 * the map's lines (translucent ink, app.css) make its shape; the darkest is #14181f, the darkest the owner allows.
 */
export const SUPPORT_COLORS: readonly string[] = ['#14181f', '#3b3f45', '#676a70', '#97999d', '#cacbcd', '#ffffff'];

/** An area without a ratio (nobody aged 65+): the map's neutral grey, outside the grey ramp (warmer, lighter). */
export const SUPPORT_NO_DATA = MAP_NEUTRAL;

/**
 * Class index 0..5 of a support ratio, or -1 without a ratio. Judged on the value rounded to one decimal, the way the
 * tooltip and the headline print it (formatSupport): an area shown as 「1.0人」 is in the 「1〜1.5」 class.
 */
export function supportClass(ratio: number): number {
  if (!Number.isFinite(ratio)) return -1;
  const shown = Number(ratio.toFixed(1));
  let k = 0;
  while (k < SUPPORT_BREAKS.length && shown >= SUPPORT_BREAKS[k]) k++;
  return k;
}

/** Fill colour for an area whose support ratio is `ratio` (people aged 15-64 per person aged 65+). */
export function supportColor(ratio: number): string {
  const k = supportClass(ratio);
  return k < 0 ? SUPPORT_NO_DATA : SUPPORT_COLORS[k];
}

/** Hard-edged stops for the support legend: one even block per class, fewest (near black) to most (palest). */
export function supportLegendRamp(): Array<{ offset: number; color: string }> {
  const n = SUPPORT_COLORS.length;
  return SUPPORT_COLORS.flatMap((color, k) => [
    { offset: k / n, color },
    { offset: (k + 1) / n, color },
  ]);
}

/** One tick per break, at the border between two blocks: 0.8人, 1人, 1.5人, 2人, 3人. */
export function supportLegendStops(): LegendStop[] {
  const n = SUPPORT_COLORS.length;
  return SUPPORT_BREAKS.map((ratio, i) => ({ ratio, offset: (i + 1) / n, color: SUPPORT_COLORS[i + 1], label: `${ratio}人` }));
}

/** The classes in words, low to high, for the legend's label: 0.8人未満、0.8〜1人 … 3人以上. */
export function supportClassNames(): string[] {
  const b = SUPPORT_BREAKS;
  return [`${b[0]}人未満`, ...b.slice(0, -1).map((lo, i) => `${lo}〜${b[i + 1]}人`), `${b[b.length - 1]}人以上`];
}

/** Dense stops for the allocation legend gradient. */
export function allocationLegendRamp(scale: number, steps = 32): Array<{ offset: number; color: string }> {
  const out: Array<{ offset: number; color: string }> = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    out.push({ offset, color: allocationColor((offset * 2 - 1) * scale, scale) });
  }
  return out;
}
