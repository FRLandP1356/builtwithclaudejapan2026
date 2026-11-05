import { describe, expect, test } from 'vitest';
import type { Groups } from '../engine/types';
import { allocationLines, allocationView, changeOf, countMarkers, crossingCounts, figureChanged, overlayCovers, placeNumbers } from './allocationView';
import type { Totals } from './derive';
import type { AllocationOverlay } from './state';

// Two years. Prefecture 01: town 01001 (200 -> 100) and 01002 (100 -> 300); prefecture 02: town 02001 (600 -> 600).
const row = (a: number, b: number) => new Float64Array([a, b]);
const totals: Totals = {
  years: [2020, 2100],
  area: new Map([
    ['01001', row(200, 100)],
    ['01002', row(100, 300)],
    ['02001', row(600, 600)],
  ]),
  pref: new Map([
    ['01', row(300, 400)],
    ['02', row(600, 600)],
  ]),
  japan: row(900, 1000),
};
const groups: Groups = { cities: {}, prefs: { '01': ['01001', '01002'], '02': ['02001'] } };
const overlay: AllocationOverlay = {
  year: 2100,
  label: 'テスト',
  changePercent: { '01001': 10, '01002': 0, '02001': -5 },
  flips: [{ facilityId: 'f', name: '施設F', gained: ['01001'], lost: ['02001', '01002'] }],
  focusFacilityId: 'f',
};
const v = allocationView(overlay, totals, groups);

describe('allocationView', () => {
  test('prefecture totals after: 01 = 110 + 300 = 410 (+2.5%), 02 = 570 (−5%), Japan 980; scale 10; counts per prefecture', () => {
    expect(v.after.prefAfter.get('01')).toBeCloseTo(410, 9);
    expect(v.after.prefAfter.get('02')).toBeCloseTo(570, 9);
    expect(v.after.japanAfter).toBeCloseTo(980, 9);
    expect(changeOf(v, 'pref', '01')).toBeCloseTo(2.5, 9);
    expect(changeOf(v, 'pref', '02')).toBeCloseTo(-5, 9);
    expect(changeOf(v, 'area', '02001')).toBe(-5);
    expect(changeOf(v, 'japan', '')).toBe(0);
    expect(v.scale).toBe(10);
    expect(v.focus?.facilityId).toBe('f');
    expect([...v.gained]).toEqual(['01001']);
    expect([...v.lost]).toEqual(['02001', '01002']);
    expect(Object.fromEntries(v.prefCounts)).toEqual({ '01': { gained: 1, lost: 1 }, '02': { gained: 0, lost: 1 } });
  });

  test('no focus: no rings, no counts', () => {
    const plain = allocationView({ ...overlay, focusFacilityId: undefined }, totals, groups);
    expect(plain.focus).toBeUndefined();
    expect(plain.gained.size + plain.lost.size + plain.prefCounts.size).toBe(0);
    expect(countMarkers(plain)).toEqual([]);
  });
});

describe('placeNumbers', () => {
  test('the year of the allocation: numbers after it, and the number before it kept', () => {
    const area = placeNumbers(totals, 2100, 'area', '01001', v)!;
    expect([area.allocated, area.popBefore]).toEqual([true, 100]);
    expect(area.pop).toBeCloseTo(110, 9); // 100 × (1 + 10 / 100)
    expect(area.ratio).toBeCloseTo(110 / 200, 12);
    const pref = placeNumbers(totals, 2100, 'pref', '01', v)!;
    expect([pref.pop, pref.popBefore, pref.allocated]).toEqual([410, 400, true]);
    expect(pref.ratio).toBeCloseTo(410 / 300, 12);
    const japan = placeNumbers(totals, 2100, 'japan', '', v)!;
    expect([japan.pop, japan.popBefore]).toEqual([980, 1000]);
    expect(japan.ratio).toBeCloseTo(980 / 900, 12);
  });

  test('another year, or no allocation: the projected numbers, not marked', () => {
    expect(placeNumbers(totals, 2020, 'area', '01001', v)).toEqual({ pop: 200, ratio: 1, allocated: false, popBefore: 200 });
    expect(placeNumbers(totals, 2100, 'area', '01001')).toEqual({ pop: 100, ratio: 0.5, allocated: false, popBefore: 100 });
    expect(placeNumbers(totals, 2055, 'area', '01001', v)).toBeUndefined();
    expect(placeNumbers(totals, 2100, 'area', '99999', v)).toBeUndefined();
  });
});

describe('figureChanged', () => {
  test('a place whose number moved: yes; the whole country (zero-sum), a place at 0 % and a place without the allocation: no', () => {
    expect(figureChanged(placeNumbers(totals, 2100, 'area', '01001', v)!)).toBe(true); // +10 %
    expect(figureChanged(placeNumbers(totals, 2100, 'pref', '02', v)!)).toBe(true); // -5 %
    expect(figureChanged(placeNumbers(totals, 2100, 'area', '01002', v)!)).toBe(false); // 0 %
    // a zero-sum allocation: 01001 gains 10 people (100 -> 110), 02001 gives 10 up (600 -> 590); the country's 1,000 stays
    const zeroSum = allocationView({ ...overlay, changePercent: { '01001': 10, '01002': 0, '02001': -(10 / 600) * 100 } }, totals, groups);
    const japan = placeNumbers(totals, 2100, 'japan', '', zeroSum)!;
    expect(japan.allocated).toBe(true); // the numbers do include the allocation...
    expect(figureChanged(japan)).toBe(false); // ...and it is the same total
    expect(figureChanged(placeNumbers(totals, 2100, 'pref', '02', zeroSum)!)).toBe(true);
    expect(figureChanged(placeNumbers(totals, 2100, 'area', '01001')!)).toBe(false); // no allocation drawn
    expect(figureChanged(placeNumbers(totals, 2020, 'area', '01001', v)!)).toBe(false); // an allocation for another year
  });

  test('arithmetic noise is not a change; one person in a million is', () => {
    expect(figureChanged({ pop: 1_000_000_000 * (1 + 1e-12), ratio: 1, allocated: true, popBefore: 1_000_000_000 })).toBe(false);
    expect(figureChanged({ pop: 1_000_001, ratio: 1, allocated: true, popBefore: 1_000_000 })).toBe(true);
    expect(figureChanged({ pop: 0.4, ratio: 1, allocated: true, popBefore: 0 })).toBe(true);
    expect(figureChanged({ pop: 5, ratio: 1, allocated: false, popBefore: 3 })).toBe(false);
  });
});

describe('allocationLines and countMarkers', () => {
  test('the change and the focused facility, per kind of shape', () => {
    expect(allocationLines(v, 'area', '01001', 2100)).toEqual(['割り振りによる変化 +10.0%', '施設Fが目安以上になる（増えた）']);
    expect(allocationLines(v, 'area', '02001', 2100)).toEqual(['割り振りによる変化 −5.0%', '施設Fが目安を下回る（減った）']);
    expect(allocationLines(v, 'pref', '01', 2100)).toEqual(['割り振りによる変化 +2.5%', '施設F：目安以上になる町 +1、下回る町 −1']);
    expect(allocationLines(v, 'pref', '02', 2050)).toEqual(['割り振りによる変化 −5.0%（2100年の計算）', '施設F：目安を下回る町 −1']);
  });

  test('a prefecture line never prints a zero side: only gained, only lost, both, or no line at all', () => {
    expect(crossingCounts({ gained: 3, lost: 0 })).toBe('目安以上になる町 +3');
    expect(crossingCounts({ gained: 0, lost: 2 })).toBe('目安を下回る町 −2');
    expect(crossingCounts({ gained: 1, lost: 4 })).toBe('目安以上になる町 +1、下回る町 −4');
    expect(crossingCounts({ gained: 0, lost: 0 })).toBeUndefined();
    for (const code of ['01', '02']) {
      const text = allocationLines(v, 'pref', code, 2100).join('\n');
      expect(text).not.toMatch(/[+−]0(?![.\d])/);
    }
    const onlyGain = allocationView({ ...overlay, flips: [{ facilityId: 'f', name: '施設F', gained: ['01001'], lost: [] }] }, totals, groups);
    expect(allocationLines(onlyGain, 'pref', '01', 2100)).toEqual(['割り振りによる変化 +2.5%', '施設F：目安以上になる町 +1']);
    const none = allocationView({ ...overlay, flips: [{ facilityId: 'f', name: '施設F', gained: ['01001'], lost: [] }] }, totals, groups);
    expect(allocationLines(none, 'pref', '02', 2100)).toEqual(['割り振りによる変化 −5.0%']); // a prefecture without crossings gets no facility line
  });

  test('one marker per prefecture with crossings: mixed or loss', () => {
    expect(countMarkers(v)).toEqual([
      { code: '01', text: '+1 −1', kind: 'mixed' },
      { code: '02', text: '−1', kind: 'loss' },
    ]);
  });

  test('overlayCovers: a place is covered when any of its areas has a change', () => {
    expect(overlayCovers(overlay, ['01001', '01002'])).toBe(true);
    expect(overlayCovers(overlay, ['99999'])).toBe(false);
  });
});
