// The "answer check": how far the official projection (IPSS, 2023 estimate, starting from the 2020 census) was from the
// 2025 census count, town by town, and how far the earlier 2018 estimate was. Data: public/data/checks.json, built by
// pipeline/build_actual.py. Every figure is a published count or a published projection; nothing here is predicted.

export interface CheckCensus {
  /** "2025-10-01" */
  date: string;
  /** "2026-09-29" */
  published: string;
  /** National count of the 2025 census (all nationalities, unprocessed): 122,972,528. */
  national: number;
  /** National count of the 2020 census: 126,146,099. */
  national2020: number;
  title: string;
  url: string;
}

/** One town: [code, census 2020, IPSS 2023 estimate for 2025, census 2025, IPSS 2018 estimate for 2020, IPSS 2018 estimate for 2025]. */
export interface CheckTown {
  code: string;
  census2020: number;
  ipss23_2025: number;
  /** null for the seven Hamamatsu wards (the city changed its wards in 2024). */
  census2025: number | null;
  /** null where the 2018 estimate has no figure for this code. */
  ipss18_2020: number | null;
  ipss18_2025: number | null;
}

export interface Checks {
  census: CheckCensus;
  ipss23: { national2025: number };
  ipss18: { national2020: number; national2025: number; url: string };
  towns: CheckTown[];
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function numOrNull(v: unknown, what: string): number | null {
  if (v === null) return null;
  if (!isNum(v)) throw new Error(`checks.json: ${what} is not a number or null`);
  return v;
}

/** Validate checks.json. `known` (optional) keeps only the towns the app has. Throws on a bad shape. */
export function parseChecks(raw: unknown, known?: (code: string) => boolean): Checks {
  if (typeof raw !== 'object' || raw === null) throw new Error('checks.json: not an object');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error('checks.json: unsupported version');
  const c = r.census as Record<string, unknown> | undefined;
  const i23 = r.ipss23 as Record<string, unknown> | undefined;
  const i18 = r.ipss18 as Record<string, unknown> | undefined;
  if (!c || !isNum(c.national) || !isNum(c.national2020) || typeof c.date !== 'string' || typeof c.url !== 'string') {
    throw new Error('checks.json: census is not in shape');
  }
  if (!i23 || !isNum(i23.national2025)) throw new Error('checks.json: ipss23 is not in shape');
  if (!i18 || !isNum(i18.national2020) || !isNum(i18.national2025) || typeof i18.url !== 'string') {
    throw new Error('checks.json: ipss18 is not in shape');
  }
  if (!Array.isArray(r.towns)) throw new Error('checks.json: towns is not an array');
  const towns: CheckTown[] = [];
  for (const row of r.towns) {
    if (!Array.isArray(row) || row.length !== 6 || typeof row[0] !== 'string' || !isNum(row[1]) || !isNum(row[2])) {
      throw new Error('checks.json: a town row is not in shape');
    }
    if (known && !known(row[0])) continue;
    towns.push({
      code: row[0],
      census2020: row[1],
      ipss23_2025: row[2],
      census2025: numOrNull(row[3], 'census2025'),
      ipss18_2020: numOrNull(row[4], 'ipss18_2020'),
      ipss18_2025: numOrNull(row[5], 'ipss18_2025'),
    });
  }
  return {
    census: {
      date: c.date,
      published: typeof c.published === 'string' ? c.published : '',
      national: c.national,
      national2020: c.national2020,
      title: typeof c.title === 'string' ? c.title : '',
      url: c.url,
    },
    ipss23: { national2025: i23.national2025 },
    ipss18: { national2020: i18.national2020, national2025: i18.national2025, url: i18.url },
    towns,
  };
}

/** (count - estimate) / estimate in percent for 2025 against the 2023 estimate; null when there is no count. */
export function deviationPct(t: CheckTown): number | null {
  if (t.census2025 === null || t.ipss23_2025 <= 0) return null;
  return ((t.census2025 - t.ipss23_2025) / t.ipss23_2025) * 100;
}

/** Same for the 2018 estimate against the 2020 census (the earlier estimate's first five years). */
export function deviation2018For2020Pct(t: CheckTown): number | null {
  if (t.ipss18_2020 === null || t.ipss18_2020 <= 0) return null;
  return ((t.census2020 - t.ipss18_2020) / t.ipss18_2020) * 100;
}

/** Same for the 2018 estimate against the 2025 count (ten years ahead). */
export function deviation2018For2025Pct(t: CheckTown): number | null {
  if (t.census2025 === null || t.ipss18_2025 === null || t.ipss18_2025 <= 0) return null;
  return ((t.census2025 - t.ipss18_2025) / t.ipss18_2025) * 100;
}

export interface DeviationBin {
  /** Inclusive lower edge in percent (-Infinity for the first bin). */
  min: number;
  /** Exclusive upper edge in percent (Infinity for the last bin). */
  max: number;
  count: number;
}

/** The six steps the map and the bar use: below -3, -3..-1, -1..0, 0..1, 1..3, 3 and above (percent). */
export const DEVIATION_EDGES: readonly number[] = [-Infinity, -3, -1, 0, 1, 3, Infinity];

export function deviationBins(towns: CheckTown[]): DeviationBin[] {
  const bins: DeviationBin[] = [];
  for (let i = 0; i + 1 < DEVIATION_EDGES.length; i++) bins.push({ min: DEVIATION_EDGES[i], max: DEVIATION_EDGES[i + 1], count: 0 });
  for (const t of towns) {
    const d = deviationPct(t);
    if (d === null) continue;
    const bin = bins.find((b) => d >= b.min && d < b.max);
    if (bin) bin.count++;
  }
  return bins;
}

/** The step index (0 = lowest) of a deviation, for colouring; null when there is no count. */
export function deviationStep(t: CheckTown): number | null {
  const d = deviationPct(t);
  if (d === null) return null;
  for (let i = 0; i + 1 < DEVIATION_EDGES.length; i++) if (d >= DEVIATION_EDGES[i] && d < DEVIATION_EDGES[i + 1]) return i;
  return null;
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface SizeGroup {
  label: string;
  /** Inclusive lower edge of the 2023 estimate for 2025 (people). */
  min: number;
  max: number;
  n: number;
  /** Median deviation in percent. */
  median: number;
}

export interface CheckSummary {
  /** Towns with a count. */
  n: number;
  below: number;
  above: number;
  /** Median deviation of the 2023 estimate, percent (negative = fewer people than estimated). */
  median: number;
  within1: number;
  within3: number;
  national: { estimate: number; count: number; diff: number; pct: number };
  bySize: SizeGroup[];
  /** Mean absolute percentage error of the 2023 estimate (five years ahead) and of the 2018 estimate (ten years ahead). */
  mape2023: number;
  mape2018: number;
}

const SIZE_EDGES: Array<[string, number, number]> = [
  ['5千人未満', 0, 5000],
  ['5千〜1万人', 5000, 10000],
  ['1万〜3万人', 10000, 30000],
  ['3万〜10万人', 30000, 100000],
  ['10万人以上', 100000, Infinity],
];

export function summarize(checks: Checks): CheckSummary {
  const withCount = checks.towns.filter((t) => t.census2025 !== null);
  const devs = withCount.map((t) => deviationPct(t) as number);
  const nationalEstimate = checks.ipss23.national2025;
  const nationalCount = checks.census.national;
  const both = withCount.filter((t) => deviation2018For2025Pct(t) !== null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length : 0);
  return {
    n: withCount.length,
    below: devs.filter((d) => d < 0).length,
    above: devs.filter((d) => d > 0).length,
    median: median(devs),
    within1: devs.filter((d) => Math.abs(d) < 1).length,
    within3: devs.filter((d) => Math.abs(d) < 3).length,
    national: {
      estimate: nationalEstimate,
      count: nationalCount,
      diff: nationalCount - nationalEstimate,
      pct: ((nationalCount - nationalEstimate) / nationalEstimate) * 100,
    },
    bySize: SIZE_EDGES.map(([label, min, max]) => {
      const ds = withCount.filter((t) => t.ipss23_2025 >= min && t.ipss23_2025 < max).map((t) => deviationPct(t) as number);
      return { label, min, max, n: ds.length, median: ds.length ? median(ds) : 0 };
    }),
    mape2023: mean(both.map((t) => deviationPct(t) as number)),
    mape2018: mean(both.map((t) => deviation2018For2025Pct(t) as number)),
  };
}
