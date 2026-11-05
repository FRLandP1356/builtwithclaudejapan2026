// Runs the engine for the UI: always on the FULL area list (Ruling 20), only with sanitised scenarios (Ruling 21),
// memoised by scenario so moving the year slider or re-rendering a panel never recomputes anything.
import { projectAll } from '../engine/project';
import { DEFAULT_SCENARIO, type Area, type Facility, type Scenario, type Series } from '../engine/types';

/** Allowed ranges for the scenario knobs (Ruling 21). */
export const SCENARIO_LIMITS = {
  cwrMult: [0.6, 1.4],
  migScale: [0, 1.5],
  infraStrength: [0, 0.01],
} as const;

export const MIG_MODES: ReadonlyArray<Scenario['migMode']> = ['hold', 'fade'];

export interface ScenarioError {
  error: string;
}

export function isScenarioError(x: Scenario | ScenarioError): x is ScenarioError {
  return typeof (x as ScenarioError).error === 'string';
}

/**
 * A value from an untrusted caller (model JSON), as short text for an error message. Never throws and never calls
 * the value's own toString: String({ toString: 1 }) and String(Object.create(null)) throw a TypeError. An object or
 * a function is named by its type; anything else is cut to 24 characters.
 */
function shown(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'object' || typeof v === 'function') return typeof v;
  return String(v).slice(0, 24);
}

/**
 * Fill a partial scenario from the defaults and check every value: finite numbers inside SCENARIO_LIMITS and a
 * known migMode. Returns the complete scenario, or `{ error }` naming the first offending field. Out-of-range values
 * are rejected, not clamped, so a caller with a bug finds out.
 */
export function sanitizeScenario(s: Partial<Scenario> | null | undefined): Scenario | ScenarioError {
  const src = s ?? {};
  const out: Scenario = { ...DEFAULT_SCENARIO };
  for (const key of ['cwrMult', 'migScale', 'infraStrength'] as const) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `${key} must be a finite number, got ${shown(v)}` };
    const [lo, hi] = SCENARIO_LIMITS[key];
    if (v < lo || v > hi) return { error: `${key} must be within [${lo}, ${hi}], got ${v}` };
    out[key] = v;
  }
  if (src.migMode !== undefined) {
    if (!MIG_MODES.includes(src.migMode)) return { error: `migMode must be one of ${MIG_MODES.join('|')}, got ${shown(src.migMode)}` };
    out.migMode = src.migMode;
  }
  return out;
}

/** Stable cache key for a scenario (independent of key order and object identity). */
export function scenarioKey(s: Scenario): string {
  return `${s.cwrMult}|${s.migMode}|${s.migScale}|${s.infraStrength}`;
}

export interface Runner {
  /** Project every area under `s` to 2100. Equal scenarios return the same Map object. Throws on an invalid scenario. */
  run(s: Scenario): Map<string, Series>;
}

export interface RunnerOptions {
  endYear?: number;
  /** How many scenario results to keep (each is about 10 MB for 1,884 areas). */
  cacheSize?: number;
}

export function createRunner(data: { areas: Area[]; facilities: Facility[] }, opts: RunnerOptions = {}): Runner {
  const endYear = opts.endYear ?? 2100;
  const cacheSize = Math.max(1, opts.cacheSize ?? 6);
  const cache = new Map<string, Map<string, Series>>(); // insertion order = recency

  return {
    run(s) {
      const checked = sanitizeScenario(s);
      if (isScenarioError(checked)) throw new RangeError(`runner.run: ${checked.error}`);
      const key = scenarioKey(checked);
      const hit = cache.get(key);
      if (hit) {
        cache.delete(key);
        cache.set(key, hit); // mark as most recent
        return hit;
      }
      const result = projectAll(data.areas, checked, endYear, data.facilities);
      cache.set(key, result);
      while (cache.size > cacheSize) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
      return result;
    },
  };
}
