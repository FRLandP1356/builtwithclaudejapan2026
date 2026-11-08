// The 2025 census count (an actual count, not a projection) by sex and age for each town: public/data/actual2025.json,
// built by pipeline/build_actual.py from the 2025 Population Census (Basic Complete Tabulation on Population etc.,
// published 2026-09-29). The loader attaches it to each area as `Area.actual`.
import type { Area, Pop } from '../engine/types';

const AGE_GROUPS = 20;

function isCountVec(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === AGE_GROUPS && v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0);
}

/** Validate actual2025.json: code -> Pop. Throws on a bad shape. */
export function parseActual(raw: unknown): Map<string, Pop> {
  if (typeof raw !== 'object' || raw === null) throw new Error('actual2025.json: not an object');
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) throw new Error('actual2025.json: unsupported version');
  if (typeof r.areas !== 'object' || r.areas === null) throw new Error('actual2025.json: areas is not an object');
  const out = new Map<string, Pop>();
  for (const [code, v] of Object.entries(r.areas as Record<string, unknown>)) {
    const e = v as Record<string, unknown> | null;
    if (!/^\d{5}$/.test(code) || !e || !isCountVec(e.M) || !isCountVec(e.F)) {
      throw new Error(`actual2025.json: ${code} is not in shape`);
    }
    out.set(code, { M: e.M, F: e.F });
  }
  return out;
}

/** Set `area.actual` on every area that has a count. Returns how many were set. */
export function attachActual(areas: Area[], actual: Map<string, Pop>): number {
  let n = 0;
  for (const a of areas) {
    const p = actual.get(a.code);
    if (p) {
      a.actual = p;
      n++;
    }
  }
  return n;
}
