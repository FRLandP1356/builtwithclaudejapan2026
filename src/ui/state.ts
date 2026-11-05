// Application state and the minimal store every panel shares (Rulings 3 and 25).
//
// Panels receive `PanelContext` and re-render on `store.subscribe`. They read `store.get().selectedArea`, `.year`,
// `.scenario`, `.series` and write with `store.set({...})`. The app's store (createAppStore) normalises every patch:
// - `set({ scenario })` sanitises the scenario and recomputes `series` in the same notification;
// - `set({ selectedArea })` also sets `selectedPref` to that area's prefecture; changing `selectedPref` to another
//   prefecture clears an area that does not belong to it; clearing `selectedPref` clears the area;
// - `year` must be 2020..2100 in steps of 5;
// - `set({ allocation })` is checked (known area codes, finite numbers, a year on the grid, a focus that names one
//   of its flips) and copied; `set({ allocation: undefined })` clears it; a scenario change clears it as well.
// A patch that fails these rules is rejected: the state does not change, nobody is notified, `set` returns false
// and a console.warn says why.
import type { Area } from '../engine/types';
import { isScenarioError, sanitizeScenario, scenarioKey, type Runner } from '../data/runner';
import type { AppData } from '../data/loader';
import { DEFAULT_SCENARIO, type Scenario, type Series } from '../engine/types';

/** One facility whose count of towns at or above its guide changed in an allocation. */
export interface AllocationFlip {
  facilityId: string;
  name: string;
  /** Area codes that rose to the guide or above. */
  gained: string[];
  /** Area codes that fell below the guide. */
  lost: string[];
}

/** A reallocation shown on the map: where people moved and which towns crossed a facility guide. */
export interface AllocationOverlay {
  /** The year the allocation was computed for. */
  year: number;
  /** For the headline, e.g. 「和歌山県 +10%」. */
  label: string;
  /** Per area code: (after - before) / before * 100. */
  changePercent: Record<string, number>;
  /** Facilities whose count changed, with every gained and lost area. */
  flips: AllocationFlip[];
  /** Set when the user focuses one facility's flips (rings on the map). Must name one of `flips`. */
  focusFacilityId?: string;
}

export interface AppState {
  /** Selected year, 2020..2100 in steps of 5. */
  year: number;
  /** Current (sanitised) scenario. */
  scenario: Scenario;
  /** Projection for every area under `scenario`, keyed by area code. */
  series: Map<string, Series>;
  /** Prefecture code ("30") when a prefecture or an area is selected. Always set when `selectedArea` is. */
  selectedPref?: string;
  /** Area code ("30206") when an area is selected. */
  selectedArea?: string;
  /** A reallocation drawn on the map, or none. Cleared by a scenario change; not by a year change. */
  allocation?: AllocationOverlay;
}

/**
 * `state` is the newest state; `prev` is the state this listener was last given. They differ by one patch, or by
 * two when a listener that ran earlier made its own `set` during the notification (then both arrive as one change).
 */
export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  /**
   * Merge a patch into the state and notify subscribers once. An explicit `undefined` clears a field
   * (`set({ selectedArea: undefined })`). Returns true when the state changed (and subscribers ran); false when the
   * patch changed nothing or was rejected by the store's rules.
   */
  set(patch: Partial<AppState>): boolean;
  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe(fn: Listener): () => void;
}

/**
 * Hook run on the merged state before subscribers. Return a patch to merge, nothing to accept as is, or `null` to
 * reject the whole patch (state unchanged, no notification).
 */
export type Derive = (next: AppState, prev: AppState, patch: Partial<AppState>) => Partial<AppState> | undefined | void | null;

export interface StoreOptions {
  derive?: Derive;
}

/** What every panel (Tasks 9, 10, 13) receives: `(el: HTMLElement, ctx: PanelContext)`. */
export interface PanelContext {
  store: Store;
  data: AppData;
  runner: Runner;
}

export const YEAR_MIN = 2020;
export const YEAR_MAX = 2100;
export const YEAR_STEP = 5;
export const DEFAULT_YEAR = 2050;

export function isValidYear(y: unknown): y is number {
  return typeof y === 'number' && Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX && (y - YEAR_MIN) % YEAR_STEP === 0;
}

const KEYS: ReadonlyArray<keyof AppState> = ['year', 'scenario', 'series', 'selectedPref', 'selectedArea', 'allocation'];

function changed(a: AppState, b: AppState): boolean {
  return KEYS.some((k) => !Object.is(a[k], b[k]));
}

/** A plain store with an optional derive hook. The app uses createAppStore, which adds the rules above. */
export function createStore(initial: AppState, options: StoreOptions = {}): Store {
  let state: AppState = { ...initial };
  // Each listener's `prev` is the last state it was given. A set made inside a listener notifies everyone at once;
  // the outer loop then skips listeners that already saw the newest state, so nobody ends on a stale one.
  const seen = new Map<Listener, AppState>();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let next: AppState = { ...prev, ...patch };
      if (options.derive) {
        const extra = options.derive(next, prev, patch);
        if (extra === null) return false;
        if (extra) next = { ...next, ...extra };
      }
      if (!changed(prev, next)) return false;
      state = next;
      for (const fn of [...seen.keys()]) {
        const last = seen.get(fn);
        if (last === undefined || last === state) continue; // unsubscribed meanwhile, or already up to date
        const now = state;
        seen.set(fn, now);
        try {
          fn(now, last);
        } catch (e) {
          console.error('store subscriber failed', e);
        }
      }
      return true;
    },
    subscribe(fn) {
      seen.set(fn, state);
      return () => {
        seen.delete(fn);
      };
    },
  };
}

/** The part of AppData the store needs to validate selections. */
export interface AppStoreData {
  areas: ReadonlyArray<Pick<Area, 'code' | 'prefCode'>>;
  prefNames: ReadonlyMap<string, string>;
}

export interface AppStoreInitial {
  year?: number;
  scenario?: Partial<Scenario>;
  selectedPref?: string;
  selectedArea?: string;
}

/**
 * Check an overlay and return an independent copy, or a message saying what is wrong. Area codes must exist,
 * `changePercent` values must be finite, the year must be on the grid, `focusFacilityId` must name a flip.
 */
export function normalizeAllocation(raw: unknown, knownArea: (code: string) => boolean): AllocationOverlay | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'allocation must be an object' };
  const a = raw as Record<string, unknown>;
  if (!isValidYear(a.year)) return { error: `allocation.year must be ${YEAR_MIN}..${YEAR_MAX} in steps of ${YEAR_STEP}, got ${String(a.year)}` };
  if (typeof a.label !== 'string') return { error: 'allocation.label must be a string' };
  if (typeof a.changePercent !== 'object' || a.changePercent === null || Array.isArray(a.changePercent)) {
    return { error: 'allocation.changePercent must be an object' };
  }
  const changePercent: Record<string, number> = {};
  for (const [code, v] of Object.entries(a.changePercent as Record<string, unknown>)) {
    if (!knownArea(code)) return { error: `allocation.changePercent has an unknown area code ${code}` };
    if (typeof v !== 'number' || !Number.isFinite(v)) return { error: `allocation.changePercent[${code}] must be a finite number` };
    changePercent[code] = v;
  }
  if (!Array.isArray(a.flips)) return { error: 'allocation.flips must be an array' };
  const flips: AllocationFlip[] = [];
  for (const f of a.flips as unknown[]) {
    if (typeof f !== 'object' || f === null) return { error: 'allocation.flips entries must be objects' };
    const flip = f as Record<string, unknown>;
    if (typeof flip.facilityId !== 'string' || typeof flip.name !== 'string') return { error: 'allocation.flips entries need facilityId and name' };
    const codes = (key: 'gained' | 'lost'): string[] | { error: string } => {
      const list = flip[key];
      if (!Array.isArray(list)) return { error: `allocation.flips[${flip.facilityId}].${key} must be an array` };
      for (const c of list) {
        if (typeof c !== 'string' || !knownArea(c)) return { error: `allocation.flips[${flip.facilityId}].${key} has an unknown area code ${String(c)}` };
      }
      return [...(list as string[])];
    };
    const gained = codes('gained');
    if (!Array.isArray(gained)) return gained;
    const lost = codes('lost');
    if (!Array.isArray(lost)) return lost;
    flips.push({ facilityId: flip.facilityId, name: flip.name, gained, lost });
  }
  const out: AllocationOverlay = { year: a.year, label: a.label, changePercent, flips };
  if (a.focusFacilityId !== undefined) {
    if (typeof a.focusFacilityId !== 'string' || !flips.some((f) => f.facilityId === a.focusFacilityId)) {
      return { error: `allocation.focusFacilityId must name one of the flips, got ${String(a.focusFacilityId)}` };
    }
    out.focusFacilityId = a.focusFacilityId;
  }
  return out;
}

/**
 * The application store: a store whose patches are validated and completed (see the header comment).
 * `series` is always the runner's result for the current scenario.
 */
export function createAppStore(runner: Runner, data: AppStoreData, initial: AppStoreInitial = {}): Store {
  const prefOf = new Map(data.areas.map((a) => [a.code, a.prefCode] as const));
  const reject = (why: string): null => {
    console.warn(`store: patch rejected, ${why}`);
    return null;
  };

  const scenario0 = sanitizeScenario(initial.scenario ?? DEFAULT_SCENARIO);
  if (isScenarioError(scenario0)) throw new RangeError(`createAppStore: ${scenario0.error}`);
  const year0 = initial.year ?? DEFAULT_YEAR;
  if (!isValidYear(year0)) throw new RangeError(`createAppStore: invalid year ${String(year0)}`);

  const derive: Derive = (next, prev, patch) => {
    const out: Partial<AppState> = {};
    if ('year' in patch && !isValidYear(next.year)) {
      return reject(`year must be ${YEAR_MIN}..${YEAR_MAX} in steps of ${YEAR_STEP}, got ${String(next.year)}`);
    }
    if (next.scenario !== prev.scenario) {
      const s = sanitizeScenario(next.scenario);
      if (isScenarioError(s)) return reject(s.error);
      if (scenarioKey(s) === scenarioKey(prev.scenario)) {
        out.scenario = prev.scenario; // same values: keep identity so an unchanged scenario does not notify
      } else {
        out.scenario = s;
        out.series = runner.run(s);
        // The overlay was computed under the old assumptions: drop it unless this same patch brings a new one.
        if (!('allocation' in patch) && next.allocation !== undefined) out.allocation = undefined;
      }
    }
    if ('allocation' in patch && patch.allocation !== undefined) {
      const a = normalizeAllocation(patch.allocation, (code) => prefOf.has(code));
      if ('error' in a) return reject(a.error);
      out.allocation = a;
    }
    if ('selectedArea' in patch && patch.selectedArea !== undefined) {
      const pp = prefOf.get(patch.selectedArea);
      if (!pp) return reject(`unknown area code ${patch.selectedArea}`);
      out.selectedPref = pp;
    } else if ('selectedPref' in patch) {
      if (patch.selectedPref !== undefined) {
        if (!data.prefNames.has(patch.selectedPref)) return reject(`unknown prefecture code ${patch.selectedPref}`);
        if (next.selectedArea !== undefined && prefOf.get(next.selectedArea) !== patch.selectedPref) out.selectedArea = undefined;
      } else if (next.selectedArea !== undefined) {
        out.selectedArea = undefined;
      }
    }
    return out;
  };

  const store = createStore({ year: year0, scenario: scenario0, series: runner.run(scenario0) }, { derive });
  if (initial.selectedArea !== undefined || initial.selectedPref !== undefined) {
    store.set({ selectedPref: initial.selectedPref, selectedArea: initial.selectedArea });
  }
  return store;
}
