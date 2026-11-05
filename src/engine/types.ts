// Shared engine types. Every other task imports from here; names and shapes are fixed.

export type AgeVec = number[]; // length 20: 0-4 ... 90-94, 95+

export interface Pop {
  M: AgeVec;
  F: AgeVec;
}

/** Cohort-component assumptions for one 5-year period. */
export interface Assumption {
  surv: { M: number[]; F: number[] }; // length 19: 0-4->5-9 ... 85-89->90-94, 90+->95+
  mig: { M: number[]; F: number[] }; // length 19, same order, net migration rate
  cwr: number; // children 0-4 / women 20-44 at period end
  sexRatio: number; // males per 100 females, age 0-4
}

export type AreaKind = 'ward' | 'city' | 'town' | 'hamadori'; // IPSS 0, 2, 3, 9

export interface Area {
  code: string; // 5 digits, zero padded, e.g. "30206"
  name: string;
  prefCode: string;
  prefName: string;
  kind: AreaKind;
  base: Pop; // 2020 census
  official: Record<number, number>; // 2025..2050 official totals
  officialAges?: Record<number, Pop>; // only when assumptions === null
  assumptions: Assumption[] | null; // 6 periods: 2020->25 ... 2045->50; null for 13 villages
}

export interface Scenario {
  cwrMult: number; // from 2050 on. default 1
  migMode: 'hold' | 'fade'; // fade: linear to 0 at 2100. default 'hold'
  migScale: number; // default 1
  infraStrength: number; // default 0
}

export type Series = Record<number, Pop>; // years 2020..2100 step 5

export const DEFAULT_SCENARIO: Scenario = { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 };

/** A service facility and the population sizes at which it is present in 50% / 80% of municipalities. */
export interface Facility {
  id: string;
  name: string;
  p50: number;
  p80: number;
  essential: boolean;
  excludesMetro: true; // source statistics exclude the three major metropolitan areas
  source: string;
}

/** Group definitions loaded from groups.json: group id -> list of codes, for cities and for prefectures. */
export interface Groups {
  cities: Record<string, string[]>;
  prefs: Record<string, string[]>;
}
