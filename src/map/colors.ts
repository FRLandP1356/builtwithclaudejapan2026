// Colour scale for "population in year Y relative to 2020".
//
// Design (decided in Task 8, see src/ui/DESIGN.md):
// - The variable is the ratio to 2020. The data is one-sided: by 2100 half of all areas are below 0.25 and the
//   10th percentile is 0.08, while growth never exceeds 1.25 (national default scenario). A linear 0..2 scale
//   would spend half its range on growth that never happens and crush the decline into a few steps.
// - So the scale is logarithmic ("halvings"): t = log2(ratio). Each halving of the population moves the same
//   distance. The decline arm covers 1 .. 1/16 (four halvings); the growth arm covers 1 .. 1.5.
// - Diverging, two hues and a neutral midpoint: decline is warm rust (the story of this map; it gets the longer,
//   darker arm), growth is cool blue (short arm, rarer, lighter). The midpoint at ratio 1 is a quiet warm grey that
//   sits just above the paper background. Both arms darken away from the midpoint, so the scale also reads by
//   lightness alone (colour-blind safe; the two arms differ by about 20 OKLab Delta E under deuteranopia).
// - Stops are specified in OKLCH and interpolated in OKLab so the gradient is perceptually even.
// Values beyond the domain (including +-Infinity) clamp to the ends; NaN gives the neutral colour.

export const RATIO_MIN = 1 / 16;
export const RATIO_MAX = 1.5;
export const NEUTRAL_RATIO = 1;

/** Position on the scale: log2 of the ratio (0 at no change, -1 at a halving, +1 at a doubling). */
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

// [t, colour] stops; t is log2(ratio). Shared neutral at t = 0.
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
// and the cache stays small (about 920 entries over the whole domain).
const QUANT = 200;
const cache = new Map<number, string>();

/** Fill colour for an area whose population is `ratioTo2020` times its 2020 population. */
export function changeColor(ratioTo2020: number): string {
  let t: number;
  if (Number.isNaN(ratioTo2020)) t = 0; // no data reads as "no change"; +-Infinity clamp like any other value
  else if (ratioTo2020 <= RATIO_MIN) t = T_MIN;
  else if (ratioTo2020 >= RATIO_MAX) t = T_MAX;
  else t = ratioToT(ratioTo2020);
  const q = Math.round(t * QUANT);
  let hex = cache.get(q);
  if (hex === undefined) {
    hex = oklabToHex(interpolateAt(q / QUANT));
    cache.set(q, hex);
  }
  return hex;
}

export interface LegendStop {
  /** Ratio to 2020 at this tick. */
  ratio: number;
  /** Position along the legend bar, 0 (strongest decline) .. 1 (strongest growth). */
  offset: number;
  color: string;
  /** Japanese tick label; empty string for an unlabelled tick. */
  label: string;
}

function offsetOf(ratio: number): number {
  const t = Math.min(T_MAX, Math.max(T_MIN, ratioToT(ratio)));
  return (t - T_MIN) / (T_MAX - T_MIN);
}

/** Labelled ticks for the legend, from the strongest decline to the strongest growth. */
export function legendStops(): LegendStop[] {
  const ticks: Array<[number, string]> = [
    [RATIO_MIN, '16分の1以下'],
    [1 / 8, ''],
    [1 / 4, '4分の1'],
    [1 / 2, '半分'],
    [NEUTRAL_RATIO, '同じ'],
    [RATIO_MAX, '1.5倍以上'],
  ];
  return ticks.map(([ratio, label], i, all) => ({
    ratio,
    offset: i === 0 ? 0 : i === all.length - 1 ? 1 : offsetOf(ratio),
    color: changeColor(ratio),
    label,
  }));
}

/** Dense colour stops for drawing the legend gradient (the ramp is not linear in sRGB, so sample it). */
export function legendRamp(steps = 32): Array<{ offset: number; color: string }> {
  const out: Array<{ offset: number; color: string }> = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    const t = T_MIN + (T_MAX - T_MIN) * offset;
    out.push({ offset, color: changeColor(2 ** t) });
  }
  return out;
}

// -----------------------------------------------------------------------------------------------------------------
// Allocation overlay: change in percent caused by a reallocation, a symmetric diverging scale centred on 0.
// Same two arms (rust = fewer people, blue = more people) and the same neutral, so the map keeps one vocabulary;
// each arm is used over its full length (the rust arm has more steps than the blue one, as in the ratio scale).
// -----------------------------------------------------------------------------------------------------------------

/** The smallest half-width of the percent domain: tiny changes stay almost neutral instead of filling the ramp. */
export const ALLOC_MIN_SCALE = 5;
const NICE_SCALES = [5, 10, 20, 30, 50, 100];

/** Half-width of the symmetric domain for a set of percent changes: a round number at or above the largest |change|. */
export function allocationScale(changes: Iterable<number>): number {
  let max = 0;
  for (const v of changes) if (Number.isFinite(v) && Math.abs(v) > max) max = Math.abs(v);
  for (const s of NICE_SCALES) if (max <= s) return Math.max(ALLOC_MIN_SCALE, s);
  return Math.ceil(max / 100) * 100;
}

/** Fill colour for a change of `percent` on a domain of +-`scale` percent. 0 is the neutral; beyond +-scale clamps. */
export function allocationColor(percent: number, scale: number): string {
  if (Number.isNaN(percent) || !(scale > 0)) return changeColor(1);
  const u = Math.max(-1, Math.min(1, percent / scale));
  const t = u < 0 ? T_MIN * -u : T_MAX * u;
  const q = Math.round(t * QUANT);
  let hex = cache.get(q);
  if (hex === undefined) {
    hex = oklabToHex(interpolateAt(q / QUANT));
    cache.set(q, hex);
  }
  return hex;
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

/** Dense stops for the allocation legend gradient. */
export function allocationLegendRamp(scale: number, steps = 32): Array<{ offset: number; color: string }> {
  const out: Array<{ offset: number; color: string }> = [];
  for (let i = 0; i <= steps; i++) {
    const offset = i / steps;
    out.push({ offset, color: allocationColor((offset * 2 - 1) * scale, scale) });
  }
  return out;
}
