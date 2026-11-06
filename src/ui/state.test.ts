import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { createRunner } from '../data/runner';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Series } from '../engine/types';
import { createAppStore, createStore, isValidYear, type AppState } from './state';

function initial(): AppState {
  return { year: 2050, scenario: DEFAULT_SCENARIO, series: new Map<string, Series>(), mapMode: 'change' };
}

describe('createStore', () => {
  test('get returns the initial state', () => {
    const store = createStore(initial());
    expect(store.get().year).toBe(2050);
    expect(store.get().selectedPref).toBeUndefined();
  });

  test('set merges a patch, returns true and notifies subscribers with next and previous state', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ year: 2100 })).toBe(true);
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

  test('a patch that changes nothing returns false and does not notify', () => {
    const store = createStore(initial());
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ year: 2050 })).toBe(false);
    expect(store.set({})).toBe(false);
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

  test('a derive hook returning null rejects the patch: false, state unchanged, no notification', () => {
    const store = createStore(initial(), { derive: (_n, _p, patch) => ('year' in patch ? null : undefined) });
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ year: 2100 })).toBe(false);
    expect(store.get().year).toBe(2050);
    expect(fn).not.toHaveBeenCalled();
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

  test('a set made inside a subscriber reaches later subscribers as one change from what they last saw', () => {
    // The allocation panel redraws its overlay from inside its subscriber when the year changes; the shell, which
    // subscribed later, must end on the newest state, not on the one the outer set started with.
    const store = createStore(initial());
    store.subscribe((s, prev) => {
      if (s.year !== prev.year) store.set({ selectedPref: String(s.year) });
    });
    const seen: Array<[number, string | undefined, number, string | undefined]> = [];
    store.subscribe((s, prev) => seen.push([s.year, s.selectedPref, prev.year, prev.selectedPref]));
    store.set({ year: 2100 });
    expect(seen).toEqual([[2100, '2100', 2050, undefined]]);
    expect(store.get()).toMatchObject({ year: 2100, selectedPref: '2100' });
  });

  test('nested sets that cancel out are not delivered to a listener that had not seen them', () => {
    // A selects 13; an earlier listener puts it back at once. B, last given the state before, would get a "change"
    // with nothing changed.
    const store = createStore(initial());
    store.subscribe((s) => {
      if (s.selectedPref === '13') store.set({ selectedPref: undefined });
    });
    const b = vi.fn();
    store.subscribe(b);
    expect(store.set({ selectedPref: '13' })).toBe(true);
    expect(store.get().selectedPref).toBeUndefined();
    expect(b).not.toHaveBeenCalled();
    store.set({ year: 2100 }); // and B still hears the next real change, from the right previous state
    expect(b).toHaveBeenCalledTimes(1);
    expect(b.mock.calls[0]![1].year).toBe(2050);
  });

  test('a subscriber that unsubscribes another during a notification stops it at once', () => {
    const store = createStore(initial());
    const late = vi.fn();
    let off: () => void = () => {};
    store.subscribe(() => off());
    off = store.subscribe(late);
    store.set({ year: 2030 });
    expect(late).not.toHaveBeenCalled();
  });
});

describe('isValidYear', () => {
  test('accepts 2020..2100 in steps of 5 only', () => {
    expect(isValidYear(2020)).toBe(true);
    expect(isValidYear(2055)).toBe(true);
    expect(isValidYear(2100)).toBe(true);
    expect(isValidYear(2015)).toBe(false);
    expect(isValidYear(2105)).toBe(false);
    expect(isValidYear(2052)).toBe(false);
    expect(isValidYear(NaN)).toBe(false);
    expect(isValidYear('2050')).toBe(false);
  });
});

describe('createAppStore', () => {
  const areas = loadSampleAreas(); // prefectures 30 (和歌山県), 13 (東京都), 01 (北海道)
  const runner = createRunner({ areas, facilities: loadFacilities() });
  const data = {
    areas,
    prefNames: new Map([
      ['01', '北海道'],
      ['13', '東京都'],
      ['30', '和歌山県'],
    ]),
  };
  let warn: ReturnType<typeof vi.spyOn>;
  afterEach(() => warn?.mockRestore());

  test('starts at the default year and scenario with the series already computed', () => {
    const store = createAppStore(runner, data);
    expect(store.get().year).toBe(2050);
    expect(store.get().scenario).toEqual(DEFAULT_SCENARIO);
    expect(store.get().series).toBe(runner.run(DEFAULT_SCENARIO));
    expect(store.get().selectedPref).toBeUndefined();
  });

  test('selecting an area sets its prefecture', () => {
    const store = createAppStore(runner, data);
    expect(store.set({ selectedArea: '30206' })).toBe(true);
    expect(store.get()).toMatchObject({ selectedPref: '30', selectedArea: '30206' });
  });

  test('selecting an area of another prefecture moves the prefecture with it', () => {
    const store = createAppStore(runner, data, { selectedPref: '13' });
    const seen: AppState[] = [];
    store.subscribe((s) => seen.push(s));
    store.set({ selectedArea: '30206' });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ selectedPref: '30', selectedArea: '30206' });
  });

  test('changing the prefecture clears an area that does not belong to it, and keeps one that does', () => {
    const store = createAppStore(runner, data, { selectedArea: '30206' });
    store.set({ selectedPref: '13' });
    expect(store.get()).toMatchObject({ selectedPref: '13', selectedArea: undefined });
    store.set({ selectedArea: '13101' });
    store.set({ selectedPref: '13' });
    expect(store.get()).toMatchObject({ selectedPref: '13', selectedArea: '13101' });
  });

  test('clearing the prefecture clears the area', () => {
    const store = createAppStore(runner, data, { selectedArea: '30206' });
    store.set({ selectedPref: undefined });
    expect(store.get().selectedPref).toBeUndefined();
    expect(store.get().selectedArea).toBeUndefined();
  });

  test('an area patch wins over a disagreeing prefecture in the same patch', () => {
    const store = createAppStore(runner, data);
    store.set({ selectedPref: '13', selectedArea: '30206' });
    expect(store.get()).toMatchObject({ selectedPref: '30', selectedArea: '30206' });
  });

  test('unknown codes are rejected: false, no notification, state unchanged, a warning', () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(runner, data, { selectedPref: '30' });
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ selectedArea: '99999' })).toBe(false);
    expect(store.set({ selectedPref: '99' })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(store.get()).toMatchObject({ selectedPref: '30', selectedArea: undefined });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('the year must be 2020..2100 in steps of 5', () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(runner, data);
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ year: 2055 })).toBe(true);
    expect(store.set({ year: 2052 })).toBe(false);
    expect(store.set({ year: 2105 })).toBe(false);
    expect(store.set({ year: NaN })).toBe(false);
    expect(store.get().year).toBe(2055);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('a scenario change recomputes the series in the same notification', () => {
    const store = createAppStore(runner, data);
    const seen: AppState[] = [];
    store.subscribe((s) => seen.push(s));
    const s = { ...DEFAULT_SCENARIO, cwrMult: 1.2 };
    expect(store.set({ scenario: s })).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].series).toBe(runner.run(s));
    expect(seen[0].series).not.toBe(runner.run(DEFAULT_SCENARIO));
  });

  test('a scenario with the same values does not notify; an invalid one is rejected without notifying', () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(runner, data);
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ scenario: { ...DEFAULT_SCENARIO } })).toBe(false);
    expect(store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 9 } })).toBe(false);
    expect(store.set({ scenario: { ...DEFAULT_SCENARIO, migMode: 'stop' as 'hold' } })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(store.get().scenario).toEqual(DEFAULT_SCENARIO);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a partial scenario is completed from the defaults', () => {
    const store = createAppStore(runner, data);
    store.set({ scenario: { migMode: 'fade' } as never });
    expect(store.get().scenario).toEqual({ ...DEFAULT_SCENARIO, migMode: 'fade' });
  });

  test('the initial selection is normalised too', () => {
    const store = createAppStore(runner, data, { selectedArea: '13101' });
    expect(store.get()).toMatchObject({ selectedPref: '13', selectedArea: '13101' });
  });
});

describe('createAppStore: the map colour mode', () => {
  const areas = loadSampleAreas();
  const runner = createRunner({ areas, facilities: loadFacilities() });
  const data = { areas, prefNames: new Map(areas.map((a) => [a.prefCode, a.prefName])) };
  afterEach(() => vi.restoreAllMocks());

  test('starts on the change since 2020, switches to the support ratio and back, notifying once each', () => {
    const store = createAppStore(runner, data);
    expect(store.get().mapMode).toBe('change');
    const seen: string[] = [];
    store.subscribe((s, prev) => seen.push(`${prev.mapMode}>${s.mapMode}`));
    expect(store.set({ mapMode: 'support' })).toBe(true);
    expect(store.set({ mapMode: 'support' })).toBe(false); // same value: no notification
    expect(store.set({ mapMode: 'change' })).toBe(true);
    expect(seen).toEqual(['change>support', 'support>change']);
  });

  test('an unknown mode is rejected: state unchanged, no notification, a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(runner, data, { mapMode: 'support' });
    expect(store.get().mapMode).toBe('support');
    let calls = 0;
    store.subscribe(() => calls++);
    for (const bad of ['ratio', '', undefined, null, 1]) {
      expect(store.set({ mapMode: bad as never })).toBe(false);
      expect(store.get().mapMode).toBe('support');
    }
    expect(calls).toBe(0);
    expect(warn).toHaveBeenCalledTimes(5);
    expect(String(warn.mock.calls[0][0])).toContain('mapMode');
    expect(() => createAppStore(runner, data, { mapMode: 'other' as never })).toThrow(RangeError);
  });

  test('a year, a scenario or an allocation leave the mode alone', () => {
    const store = createAppStore(runner, data, { mapMode: 'support' });
    store.set({ year: 2100 });
    store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.2 } });
    store.set({ allocation: { year: 2100, label: 'x', changePercent: { [areas[0].code]: 5 }, flips: [] } });
    expect(store.get().mapMode).toBe('support');
    store.set({ allocation: undefined });
    expect(store.get().mapMode).toBe('support');
  });
});
