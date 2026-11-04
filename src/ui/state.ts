// Application state and the minimal store every panel shares (Rulings 3 and 25).
//
// Panels receive `PanelContext` and re-render on `store.subscribe`. They read `store.get().selectedArea`, `.year`,
// `.scenario`, `.series` and write with `store.set({...})`. Setting `scenario` through the app's store recomputes
// `series` (wired in app.ts with the `derive` option below) before subscribers are notified, so a panel never sees a
// scenario and a series that disagree.
import type { AppData } from '../data/loader';
import type { Runner } from '../data/runner';
import type { Scenario, Series } from '../engine/types';

export interface AppState {
  /** Selected year, 2020..2100 in steps of 5. */
  year: number;
  /** Current (sanitised) scenario. */
  scenario: Scenario;
  /** Projection for every area under `scenario`, keyed by area code. */
  series: Map<string, Series>;
  /** Prefecture code ("30") when a prefecture or an area is selected. */
  selectedPref?: string;
  /** Area code ("30206") when an area is selected. */
  selectedArea?: string;
}

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  /**
   * Merge a patch into the state and notify subscribers once. An explicit `undefined` clears a field
   * (`set({ selectedArea: undefined })`). A patch that changes nothing does not notify.
   */
  set(patch: Partial<AppState>): void;
  /** Subscribe to changes; returns the unsubscribe function. */
  subscribe(fn: Listener): () => void;
}

export interface StoreOptions {
  /**
   * Compute derived fields from the merged state before subscribers run. Return a patch to merge, or nothing.
   * The app uses this to turn `set({ scenario })` into `series`.
   */
  derive?: (next: AppState, prev: AppState) => Partial<AppState> | undefined | void;
}

/** What every panel (Tasks 9, 10, 13) receives: `(el: HTMLElement, ctx: PanelContext)`. */
export interface PanelContext {
  store: Store;
  data: AppData;
  runner: Runner;
}

const KEYS: ReadonlyArray<keyof AppState> = ['year', 'scenario', 'series', 'selectedPref', 'selectedArea'];

function changed(a: AppState, b: AppState): boolean {
  return KEYS.some((k) => !Object.is(a[k], b[k]));
}

export function createStore(initial: AppState, options: StoreOptions = {}): Store {
  let state: AppState = { ...initial };
  const listeners = new Set<Listener>();

  return {
    get: () => state,
    set(patch) {
      const prev = state;
      let next: AppState = { ...prev, ...patch };
      if (!changed(prev, next)) return;
      if (options.derive) {
        const extra = options.derive(next, prev);
        if (extra) next = { ...next, ...extra };
      }
      state = next;
      for (const fn of [...listeners]) {
        try {
          fn(next, prev);
        } catch (e) {
          console.error('store subscriber failed', e);
        }
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
