// Per-year population totals derived from a projection, for colouring maps and writing headlines.
// Computed once per series object (the runner memoises series per scenario, so this is cheap to key by identity).
import { total } from '../engine/aggregate';
import type { Groups, Series } from '../engine/types';

export interface Totals {
  /** 2020, 2025, ... 2100. */
  years: number[];
  /** area code -> total per year (same order as `years`). */
  area: Map<string, Float64Array>;
  /** prefecture code -> total per year. */
  pref: Map<string, Float64Array>;
  /** All areas together. */
  japan: Float64Array;
}

const memo = new WeakMap<Map<string, Series>, Totals>();

export function deriveTotals(series: Map<string, Series>, groups: Groups): Totals {
  const hit = memo.get(series);
  if (hit) return hit;

  const first = series.values().next().value;
  const years = first ? Object.keys(first).map(Number).sort((a, b) => a - b) : [];
  const n = years.length;
  const area = new Map<string, Float64Array>();
  const japan = new Float64Array(n);
  for (const [code, s] of series) {
    const row = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = s[years[i]];
      row[i] = p ? total(p) : NaN;
      japan[i] += row[i];
    }
    area.set(code, row);
  }
  const pref = new Map<string, Float64Array>();
  for (const [pp, codes] of Object.entries(groups.prefs)) {
    const row = new Float64Array(n);
    for (const c of codes) {
      const r = area.get(c);
      if (!r) continue;
      for (let i = 0; i < n; i++) row[i] += r[i];
    }
    pref.set(pp, row);
  }
  const out: Totals = { years, area, pref, japan };
  memo.set(series, out);
  return out;
}

/** Index of `year` in `years`, or -1. */
export function yearIndex(years: number[], year: number): number {
  return years.indexOf(year);
}

export interface AllocatedTotals {
  /** Prefecture code -> population after the allocation. */
  prefAfter: Map<string, number>;
  /** Prefecture code -> change caused by the allocation, (after - before) / before * 100 (0 for an empty prefecture). */
  prefChange: Map<string, number>;
  /** All areas together, after the allocation. */
  japanAfter: number;
}

/**
 * Totals at year index `idx` once an allocation's per-area change (in percent) is applied: each area's population
 * times (1 + change / 100); an area without a change keeps its population. Areas without a number are skipped.
 */
export function allocatedTotals(totals: Totals, groups: Groups, idx: number, changePercent: Readonly<Record<string, number>>): AllocatedTotals {
  const prefAfter = new Map<string, number>();
  const prefChange = new Map<string, number>();
  let japanAfter = 0;
  for (const [pp, codes] of Object.entries(groups.prefs)) {
    let before = 0;
    let after = 0;
    for (const c of codes) {
      const p = totals.area.get(c)?.[idx];
      if (p === undefined || !Number.isFinite(p)) continue;
      before += p;
      after += p * (1 + (changePercent[c] ?? 0) / 100);
    }
    prefAfter.set(pp, after);
    prefChange.set(pp, before > 0 ? ((after - before) / before) * 100 : 0);
    japanAfter += after;
  }
  return { prefAfter, prefChange, japanAfter };
}

/** Ratio of the value at `idx` to the 2020 value (index 0); NaN when 2020 is zero or missing. */
export function ratioAt(row: Float64Array, idx: number): number {
  const base = row[0];
  if (!(base > 0)) return NaN;
  return row[idx] / base;
}
