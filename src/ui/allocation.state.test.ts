import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { createRunner } from '../data/runner';
import { DEFAULT_SCENARIO } from '../engine/types';
import { createAppStore, normalizeAllocation, type AllocationOverlay } from './state';

const areas = loadSampleAreas(); // 30206 30201 13101 01101 13402 30427
const runner = createRunner({ areas, facilities: loadFacilities() });
const data = {
  areas,
  prefNames: new Map([
    ['01', '北海道'],
    ['13', '東京都'],
    ['30', '和歌山県'],
  ]),
};
const known = (c: string) => areas.some((a) => a.code === c);

function overlay(patch: Partial<AllocationOverlay> = {}): AllocationOverlay {
  return {
    year: 2100,
    label: '和歌山県 +10%',
    changePercent: { '30206': 10, '30201': 10, '13101': -0.04 },
    flips: [{ facilityId: 'grocery', name: '飲食料品小売業', gained: ['30206'], lost: [] }],
    ...patch,
  };
}

let warn: ReturnType<typeof vi.spyOn> | undefined;
afterEach(() => warn?.mockRestore());

describe('normalizeAllocation', () => {
  test('accepts a valid overlay and returns an independent copy', () => {
    const src = overlay();
    const out = normalizeAllocation(src, known);
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out.changePercent).not.toBe(src.changePercent);
    expect(out.flips[0]).not.toBe(src.flips[0]);
    expect(out.flips[0].gained).not.toBe(src.flips[0].gained);
    src.flips[0].gained.push('99999');
    expect(out.flips[0].gained).toEqual(['30206']);
  });

  test('rejects unknown area codes in changePercent and in flips', () => {
    expect(normalizeAllocation(overlay({ changePercent: { '99999': 1 } }), known)).toMatchObject({ error: expect.stringContaining('99999') });
    expect(normalizeAllocation(overlay({ flips: [{ facilityId: 'x', name: 'x', gained: ['99999'], lost: [] }] }), known)).toMatchObject({ error: expect.stringContaining('99999') });
    expect(normalizeAllocation(overlay({ flips: [{ facilityId: 'x', name: 'x', gained: [], lost: ['12345'] }] }), known)).toMatchObject({ error: expect.stringContaining('12345') });
  });

  test('rejects a bad year, a non-finite change, a bad shape, and a focus that names no flip', () => {
    expect(normalizeAllocation(overlay({ year: 2052 }), known)).toMatchObject({ error: expect.stringContaining('year') });
    expect(normalizeAllocation(overlay({ changePercent: { '30206': Number.NaN } }), known)).toMatchObject({ error: expect.stringContaining('finite') });
    expect(normalizeAllocation({ year: 2100 }, known)).toMatchObject({ error: expect.any(String) });
    expect(normalizeAllocation(overlay({ focusFacilityId: 'hospital' }), known)).toMatchObject({ error: expect.stringContaining('focusFacilityId') });
    expect(normalizeAllocation(overlay({ focusFacilityId: 'grocery' }), known)).toMatchObject({ focusFacilityId: 'grocery' });
  });
});

describe('createAppStore with an allocation overlay', () => {
  test('set({ allocation }) stores a copy; set({ allocation: undefined }) clears it', () => {
    const store = createAppStore(runner, data, { year: 2100 });
    const src = overlay();
    expect(store.set({ allocation: src })).toBe(true);
    expect(store.get().allocation).toEqual(src);
    expect(store.get().allocation).not.toBe(src);
    expect(store.set({ allocation: undefined })).toBe(true);
    expect(store.get().allocation).toBeUndefined();
  });

  test('an invalid overlay is rejected without notifying', () => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createAppStore(runner, data, { year: 2100 });
    const fn = vi.fn();
    store.subscribe(fn);
    expect(store.set({ allocation: overlay({ changePercent: { '99999': 1 } }) })).toBe(false);
    expect(store.set({ allocation: overlay({ year: 2101 }) })).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    expect(store.get().allocation).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  test('a year change keeps the overlay; a scenario change clears it', () => {
    const store = createAppStore(runner, data, { year: 2100 });
    store.set({ allocation: overlay() });
    store.set({ year: 2080 });
    expect(store.get().allocation?.year).toBe(2100); // stale but kept (the shell shows a note)
    const seen: Array<AllocationOverlay | undefined> = [];
    store.subscribe((s) => seen.push(s.allocation));
    store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.2 } });
    expect(seen).toEqual([undefined]); // cleared in the same notification as the series
    expect(store.get().allocation).toBeUndefined();
  });

  test('a scenario change together with a new overlay keeps the new overlay', () => {
    const store = createAppStore(runner, data, { year: 2100 });
    store.set({ allocation: overlay({ label: 'old' }) });
    store.set({ scenario: { ...DEFAULT_SCENARIO, migMode: 'fade' }, allocation: overlay({ label: 'new' }) });
    expect(store.get().allocation?.label).toBe('new');
  });

  test('the same scenario values do not clear the overlay', () => {
    const store = createAppStore(runner, data, { year: 2100 });
    store.set({ allocation: overlay() });
    expect(store.set({ scenario: { ...DEFAULT_SCENARIO } })).toBe(false);
    expect(store.get().allocation).toBeDefined();
  });
});
