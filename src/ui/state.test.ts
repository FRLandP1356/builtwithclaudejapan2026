import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Series } from '../engine/types';
import { createStore, type AppState } from './state';

function initial(): AppState {
  return { year: 2050, scenario: DEFAULT_SCENARIO, series: new Map<string, Series>() };
}

describe('createStore', () => {
  test('get returns the initial state', () => {
    const store = createStore(initial());
    expect(store.get().year).toBe(2050);
    expect(store.get().selectedPref).toBeUndefined();
  });

  test('set merges a patch and notifies subscribers with next and previous state', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ year: 2100 });
    expect(store.get().year).toBe(2100);
    expect(fn).toHaveBeenCalledTimes(1);
    const [next, prev] = fn.mock.calls[0];
    expect(next.year).toBe(2100);
    expect(prev.year).toBe(2050);
    expect(next).not.toBe(prev);
    expect(next.scenario).toBe(DEFAULT_SCENARIO); // untouched fields are carried over
  });

  test('an explicit undefined clears a selection', () => {
    const store = createStore({ ...initial(), selectedPref: '30', selectedArea: '30206' });
    store.set({ selectedArea: undefined });
    expect(store.get().selectedArea).toBeUndefined();
    expect(store.get().selectedPref).toBe('30');
  });

  test('a patch that changes nothing does not notify', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    store.subscribe(fn);
    store.set({ year: 2050 });
    store.set({});
    expect(fn).not.toHaveBeenCalled();
  });

  test('unsubscribe stops notifications', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.set({ year: 2055 });
    off();
    store.set({ year: 2060 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('the derive hook adds derived fields before subscribers see the state', () => {
    const run = vi.fn((s: { cwrMult: number }) => new Map<string, Series>([[`k${s.cwrMult}`, {}]]));
    const store = createStore(initial(), {
      derive: (next, prev) => (next.scenario !== prev.scenario ? { series: run(next.scenario) } : undefined),
    });
    const seen: string[] = [];
    store.subscribe((s) => seen.push([...s.series.keys()].join(',')));
    store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.2 } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['k1.2']); // one notification, already carrying the derived series
    store.set({ year: 2075 });
    expect(run).toHaveBeenCalledTimes(1); // unrelated patches do not re-run
  });

  test('a subscriber that throws does not block the others', () => {
    const store = createStore(initial());
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    store.subscribe(bad);
    store.subscribe(good);
    store.set({ year: 2030 });
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
