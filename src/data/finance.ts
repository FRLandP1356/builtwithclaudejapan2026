// Municipal spending per resident, fiscal 2024 (令和6年度) ACTUALS, from public/data/finance.json (built by
// pipeline/build_finance.py from MIC's 市町村別決算状況調). A cross-section of today's municipalities, not a forecast
// and not causal: the panel only shows what municipalities of a given size spend now.

export interface FinanceBand {
  /** Residents, inclusive. */
  min: number;
  /** Residents, exclusive; null for the open top band. */
  max: number | null;
  /** Number of municipalities in the band. */
  n: number;
  /** Thousand yen per resident. */
  median: number;
  p25: number;
  p75: number;
}

export interface FinancePublishedRow {
  label: string;
  /** Thousand yen per resident. */
  perCapita: number;
}

export interface Finance {
  /** Gregorian year of the fiscal year: 2024 is 令和6年度. */
  fiscalYear: number;
  populationDate: string;
  national: { n: number; perCapita: number; population: number; expenditure: number };
  /** Seven population bands, ascending, edge to edge. */
  bands: FinanceBand[];
  /** 地方財政白書 第39表: a different year and a different classification (団体区分), shown apart from the bands. */
  published: { fiscalYear: number; rows: FinancePublishedRow[] };
  /** 5-digit area code -> [thousand yen per resident, residents (住民基本台帳)]. */
  municipalities: Record<string, readonly [number, number]>;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** Check the shape of a parsed finance.json and return it typed; throws a plain Error naming what is wrong. */
export function parseFinance(raw: unknown): Finance {
  const fail = (what: string): never => {
    throw new Error(`finance.json: ${what}`);
  };
  if (typeof raw !== 'object' || raw === null) return fail('not an object');
  const f = raw as Partial<Finance>;
  if (!isCount(f.fiscalYear) || typeof f.populationDate !== 'string') fail('fiscalYear or populationDate');
  const nat = f.national;
  if (!nat || !isCount(nat.n) || !isCount(nat.perCapita) || !isCount(nat.population) || !isCount(nat.expenditure)) fail('national');
  const bands = f.bands;
  if (!Array.isArray(bands) || bands.length < 2) return fail('bands');
  bands.forEach((b, i) => {
    if (!isCount(b.min) || !isCount(b.n) || b.n < 1 || !isCount(b.median) || !isCount(b.p25) || !isCount(b.p75)) fail(`band ${i}`);
    if (!(b.p25 <= b.median && b.median <= b.p75)) fail(`band ${i}: p25 <= median <= p75`);
    const last = i === bands.length - 1;
    if (last ? b.max !== null : b.max !== bands[i + 1].min) fail(`band ${i}: edges`);
    if (i === 0 && b.min !== 0) fail('first band must start at 0');
  });
  const pub = f.published;
  if (!pub || !isCount(pub.fiscalYear) || !Array.isArray(pub.rows) || pub.rows.some((r) => typeof r.label !== 'string' || !isCount(r.perCapita))) fail('published');
  const m = f.municipalities;
  if (typeof m !== 'object' || m === null) return fail('municipalities');
  for (const [code, v] of Object.entries(m)) {
    if (!/^\d{5}$/.test(code) || !Array.isArray(v) || v.length !== 2 || !isCount(v[0]) || !isCount(v[1]) || v[1] < 1) fail(`municipality ${code}`);
  }
  return f as Finance;
}

/**
 * The index of the band holding `population` (residents): the last band whose lower edge is <= population. A band
 * holds min <= population < max, so 4,999 is in the first band and 5,000 in the second.
 */
export function bandIndexFor(bands: readonly FinanceBand[], population: number): number {
  let index = 0;
  bands.forEach((b, i) => {
    if (population >= b.min) index = i;
  });
  return index;
}

/** A municipality's own per-resident figure (thousand yen), or undefined when the source has none for this code. */
export function ownPerCapita(finance: Finance, code: string): number | undefined {
  // An inherited name such as 'constructor' is not an array, so it has no [0]: the answer is undefined for it too.
  return finance.municipalities[code]?.[0];
}

/** "令和6年度" from the Gregorian fiscal year (2019 is 令和1年度, written 令和元年度 by convention; the data starts at 令和2). */
export function reiwaLabel(fiscalYear: number): string {
  return `令和${fiscalYear - 2018}年度`;
}
