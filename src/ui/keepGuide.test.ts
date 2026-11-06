import { describe, expect, test } from 'vitest';
import { facilityById } from '../../test/helpers/loadFacilities';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import type { FacilityFlip } from '../engine/allocation';
import { facilityStatus } from '../engine/facilities';
import type { Facility } from '../engine/types';
import { populationAt, type PopulationAt } from './allocationCore';
import {
  computeKeep,
  KEEP_APPLIED,
  KEEP_BUTTON,
  KEEP_FAILED,
  KEEP_LIMITS,
  KEEP_NO_EFFECT,
  KEEP_SUMMARY,
  KEEP_TOO_LARGE,
  KEEP_TOP,
  KEEP_TOP_LEAD,
  keepEffectLine,
  keepEffects,
  keepNeedLines,
  keepNeeds,
  keepOverlay,
  keepPremise,
  keepTopText,
} from './keepGuide';

const fac = (over: Partial<Facility>): Facility => ({
  id: 'x',
  name: 'テスト施設',
  p50: 1500,
  p80: 2500,
  essential: false,
  excludesMetro: true,
  source: 's',
  ...over,
});

const flip = (facilityId: string, lost: string[], gained: string[] = []): FacilityFlip => ({ facilityId, before: 0, after: 0, lost, gained });

/** A world of plain numbers: every area in one prefecture. */
function world(pops: Record<string, number>): PopulationAt {
  return { popByArea: new Map(Object.entries(pops)), areaPref: new Map(Object.keys(pops).map((c) => [c, '01'])) };
}

describe('keepNeeds: the people to reach the guide', () => {
  const f = fac({ p50: 1500, p80: 2500 });

  test('both guides, each rounded UP to whole people', () => {
    expect(keepNeeds(1000, f)).toEqual({ need50: 500, need80: 1500 });
    expect(keepNeeds(1400.5, f)).toEqual({ need50: 100, need80: 1100 }); // 99.5 -> 100, 1099.5 -> 1100
    expect(keepNeeds(1499.2, f)).toEqual({ need50: 1, need80: 1001 }); // 0.8 -> 1, 1000.8 -> 1001
    expect(keepNeeds(0, f)).toEqual({ need50: 1500, need80: 2500 });
  });

  test('a whole-number gap is not rounded up a second time', () => {
    expect(keepNeeds(1499, f)).toEqual({ need50: 1, need80: 1001 });
    expect(keepNeeds(1400, f)).toEqual({ need50: 100, need80: 1100 });
  });

  test('just under the 50% guide still needs one person', () => {
    expect(keepNeeds(1499.9999, f)?.need50).toBe(1);
  });

  test('exactly the 50% guide is on the edge, not below: no needs', () => {
    expect(keepNeeds(1500, f)).toBeUndefined();
    expect(facilityStatus(1500, f)).toBe('edge');
  });

  test('between the guides, at the 80% guide, above both: no needs', () => {
    expect(keepNeeds(2000, f)).toBeUndefined();
    expect(keepNeeds(2500, f)).toBeUndefined();
    expect(keepNeeds(1_000_000, f)).toBeUndefined();
  });

  test('p50 equal to p80: one number only', () => {
    const one = fac({ p50: 500, p80: 500 });
    expect(keepNeeds(400, one)).toEqual({ need50: 100, need80: undefined });
    expect(keepNeeds(499.5, one)).toEqual({ need50: 1, need80: undefined });
    expect(keepNeeds(500, one)).toBeUndefined();
  });

  test('a population that is not a number gives nothing (instead of throwing)', () => {
    expect(keepNeeds(Number.NaN, f)).toBeUndefined();
  });

  test('a population that is not above zero is far below: the whole guide is needed', () => {
    expect(keepNeeds(-0.5, f)).toEqual({ need50: 1501, need80: 2501 });
  });
});

describe('keepEffects: the other areas that fall below', () => {
  const facilities = [fac({ id: 'f1', name: '一' }), fac({ id: 'f2', name: '二' }), fac({ id: 'f3', name: '三' }), fac({ id: 'f4', name: '四' }), fac({ id: 'f5', name: '五' })];

  test('nothing lost: zero areas, no facilities', () => {
    expect(keepEffects([], facilities, 'T')).toEqual({ areaCount: 0, top: [] });
    expect(keepEffects([flip('f1', [], ['A'])], facilities, 'T')).toEqual({ areaCount: 0, top: [] });
  });

  test('the town itself is never counted, in the areas or in a facility', () => {
    const e = keepEffects([flip('f1', ['T', 'A']), flip('f2', ['T'])], facilities, 'T');
    expect(e).toEqual({ areaCount: 1, top: [{ facilityId: 'f1', name: '一', count: 1 }] });
  });

  test('an area that goes below two facilities is one area, but counts for each facility', () => {
    const e = keepEffects([flip('f1', ['A', 'B']), flip('f2', ['B', 'C'])], facilities, 'T');
    expect(e.areaCount).toBe(3);
    expect(e.top).toEqual([
      { facilityId: 'f1', name: '一', count: 2 },
      { facilityId: 'f2', name: '二', count: 2 },
    ]);
  });

  test('most areas first; equal counts keep the facility list order; only the first three', () => {
    const flips = [
      flip('f4', ['A', 'B']),
      flip('f1', ['A']),
      flip('f5', ['A', 'B', 'C', 'D', 'E']),
      flip('f3', ['A', 'B']),
      flip('f2', ['C', 'D']),
    ];
    const e = keepEffects(flips, facilities, 'T');
    expect(KEEP_TOP).toBe(3);
    // f5 (5), then the three with 2 areas in list order f2, f3, f4: the first two of those fit, f4 and f1 are cut
    expect(e.top.map((x) => [x.facilityId, x.count])).toEqual([
      ['f5', 5],
      ['f2', 2],
      ['f3', 2],
    ]);
    expect(e.areaCount).toBe(5); // A..E, each once
  });

  test('exactly three facilities are all kept, and the list order decides regardless of the order of the flips', () => {
    const e = keepEffects([flip('f3', ['A']), flip('f2', ['B']), flip('f1', ['C'])], facilities, 'T');
    expect(e.top.map((x) => x.facilityId)).toEqual(['f1', 'f2', 'f3']);
  });

  test('a facility the list does not know comes last and is named by its id, whichever way round the flips come', () => {
    const known = [flip('f2', ['B']), flip('f1', ['C'])];
    const unknown = flip('zz', ['A']);
    for (const flips of [[unknown, ...known], [known[0], unknown, known[1]], [...known, unknown]]) {
      expect(keepEffects(flips, facilities, 'T').top).toEqual([
        { facilityId: 'f1', name: '一', count: 1 },
        { facilityId: 'f2', name: '二', count: 1 },
        { facilityId: 'zz', name: 'zz', count: 1 },
      ]);
    }
  });
});

describe('computeKeep on a small world', () => {
  // The town has 1,400 people; the others 5,000 + 3,000 + 2,000. Moving 100 people in takes 1% from each other area:
  // 4,950 / 2,970 / 1,980. 'b_h' (3,000) is lost by B, 'a_g' (2,000) by C, 'k' (900) by nobody.
  const target = fac({ id: 'target', name: '対象', p50: 1500, p80: 2500 });
  const h = fac({ id: 'b_h', name: 'H', p50: 3000, p80: 4000 });
  const g = fac({ id: 'a_g', name: 'G', p50: 2000, p80: 2000 });
  const k = fac({ id: 'k', name: 'K', p50: 900, p80: 900 });
  const facilities = [target, h, g, k];
  const at = world({ T: 1400, A: 5000, B: 3000, C: 2000 });

  test('moves need50 people in, takes them from the others in proportion, and reads the other areas', () => {
    const c = computeKeep(at, facilities, target, 'T')!;
    expect(c.needs).toEqual({ need50: 100, need80: 1100 });
    if (c.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(c.outcome.people).toBe(100);
    expect(c.outcome.result.pop.get('T')).toBeCloseTo(1500, 9);
    expect(c.outcome.result.pop.get('A')).toBeCloseTo(4950, 9);
    expect(c.outcome.result.pop.get('B')).toBeCloseTo(2970, 9);
    expect(c.outcome.result.pop.get('C')).toBeCloseTo(1980, 9);
    expect(c.outcome.result.total).toBeCloseTo(11_400, 9); // the national total does not change
    // two other areas fall below some guide; the facility order b_h, a_g decides the tie (not the ids)
    expect(c.outcome.effects).toEqual({
      areaCount: 2,
      top: [
        { facilityId: 'b_h', name: 'H', count: 1 },
        { facilityId: 'a_g', name: 'G', count: 1 },
      ],
    });
  });

  test('the facility asked about is not in the losses (only the town gains it)', () => {
    const c = computeKeep(at, facilities, target, 'T')!;
    if (c.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(c.outcome.effects.top.map((x) => x.facilityId)).not.toContain('target');
  });

  test('nothing falls below when no other area sits just above a guide', () => {
    const c = computeKeep(world({ T: 1400, A: 90_000, B: 80_000 }), facilities, target, 'T')!;
    expect(c.outcome).toMatchObject({ kind: 'ok', effects: { areaCount: 0, top: [] } });
  });

  test('more people than the other areas have: too large, and nothing else', () => {
    const c = computeKeep(world({ T: 1400, A: 50 }), facilities, target, 'T')!;
    expect(c.needs).toEqual({ need50: 100, need80: 1100 });
    expect(c.outcome).toEqual({ kind: 'too-large' });
  });

  test('a town with no other area to take people from: too large', () => {
    expect(computeKeep(world({ T: 1400 }), facilities, target, 'T')!.outcome).toEqual({ kind: 'too-large' });
  });

  test('a RangeError is "too large"; any other error is a bug and is not hidden', () => {
    const poisoned = { ...fac({ id: 'p' }), get p80(): number { throw new Error('boom'); } } as Facility;
    expect(() => computeKeep(at, [target, poisoned], target, 'T')).toThrow('boom');
  });

  test('a town that is not below the guide, or is unknown, has no computation', () => {
    expect(computeKeep(world({ T: 1500, A: 5000 }), facilities, target, 'T')).toBeUndefined();
    expect(computeKeep(world({ T: 2600, A: 5000 }), facilities, target, 'T')).toBeUndefined();
    expect(computeKeep(at, facilities, target, 'nobody')).toBeUndefined();
  });

  test('the inputs are not changed', () => {
    const before = [...at.popByArea.entries()];
    computeKeep(at, facilities, target, 'T');
    expect([...at.popByArea.entries()]).toEqual(before);
  });

  test('keepOverlay: the label carries the people moved, this facility is in focus, every flip is kept', () => {
    const c = computeKeep(at, facilities, target, 'T')!;
    if (c.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    const o = keepOverlay(c.outcome, at, facilities, 2100, '田辺市', 'target');
    expect(o.year).toBe(2100);
    expect(o.label).toBe('田辺市 +100人');
    expect(o.focusFacilityId).toBe('target');
    expect(o.changePercent.T).toBeCloseTo((100 / 1400) * 100, 9);
    expect(o.changePercent.A).toBeCloseTo(-1, 9);
    const byId = new Map(o.flips.map((f) => [f.facilityId, f]));
    expect(byId.get('target')).toMatchObject({ name: '対象', gained: ['T'], lost: [] });
    expect(byId.get('b_h')).toMatchObject({ lost: ['B'] });
    expect(byId.get('a_g')).toMatchObject({ lost: ['C'] });
    expect(byId.has('k')).toBe(false);
  });
});

describe('wording', () => {
  test('keepNeedLines: the 50% line and the 80% line, with the guide as the table prints it', () => {
    const f = fac({ p50: 175_000, p80: 225_000 });
    const needs = keepNeeds(11_879.876, f)!;
    expect(keepNeedLines(f, needs)).toEqual([
      { label: '50%の目安（175,000人）まで', value: 'あと約16.3万人' },
      { label: '80%の目安（225,000人）まで', value: 'あと約21.3万人' },
    ]);
    const small = fac({ p50: 1500, p80: 2500 });
    expect(keepNeedLines(small, keepNeeds(1000, small)!)).toEqual([
      { label: '50%の目安（1,500人）まで', value: 'あと約500人' },
      { label: '80%の目安（2,500人）まで', value: 'あと約1,500人' },
    ]);
  });

  test('keepNeedLines: one guide, one line, without the 50%', () => {
    const one = fac({ p50: 500, p80: 500 });
    expect(keepNeedLines(one, keepNeeds(470.6, one)!)).toEqual([{ label: '目安（500人）まで', value: 'あと約30人' }]);
  });

  test('keepPremise names the 50% guide when there are two, and says the others shrink in proportion', () => {
    expect(keepPremise(fac({ p50: 1500, p80: 2500 }), 500)).toBe(
      '50%の目安に届くところまで、ほかの町から約500人が移ってきたと考えます。ほかの町の人口に比例して減らし、全国の合計は変わりません。',
    );
    expect(keepPremise(fac({ p50: 500, p80: 500 }), 30)).toBe(
      '目安に届くところまで、ほかの町から約30人が移ってきたと考えます。ほかの町の人口に比例して減らし、全国の合計は変わりません。',
    );
  });

  test('keepEffectLine: a count, or one plain sentence saying nothing changes', () => {
    expect(keepEffectLine({ areaCount: 19, top: [] })).toBe('このとき、ほかの19町が、いずれかの施設の人口の目安を下回ります。');
    expect(keepEffectLine({ areaCount: 1_234, top: [] })).toBe('このとき、ほかの1,234町が、いずれかの施設の人口の目安を下回ります。');
    expect(keepEffectLine({ areaCount: 0, top: [] })).toBe('このとき、ほかの町で新しく人口の目安を下回る施設はありません。');
    expect(KEEP_NO_EFFECT).toBe('このとき、ほかの町で新しく人口の目安を下回る施設はありません。');
  });

  test('keepTopText: name and number of towns', () => {
    expect(keepTopText({ facilityId: 'a', name: '喫茶店', count: 2 })).toBe('喫茶店（2町）');
  });

  test('the fixed sentences', () => {
    expect(KEEP_SUMMARY).toBe('この目安に届くには');
    expect(KEEP_BUTTON).toBe('地図に反映する');
    expect(KEEP_TOO_LARGE).toBe('人数が大きすぎて、この計算はできません。');
    expect(KEEP_TOP_LEAD).toBe('下回る町がいちばん多い施設');
    expect(KEEP_APPLIED).toBe('地図に反映しました。地図の色は、割り振りによる人口の変化を示します。');
    expect(KEEP_FAILED).toBe('地図に反映できませんでした。');
  });

  test('the limits say: a thought experiment (not a forecast), a 2009-2012 statistic, no causal link; one sentence', () => {
    expect(KEEP_LIMITS).toContain('もし移ったら');
    expect(KEEP_LIMITS).toContain('実際の人の動きの予測ではありません');
    expect(KEEP_LIMITS).toContain('2009〜2012年の統計');
    expect(KEEP_LIMITS).toContain('人口が増えれば施設ができるという関係を示すものではありません');
    expect(KEEP_LIMITS.match(/。/g)).toHaveLength(1);
  });

  test('no sentence claims, advises or forecasts', () => {
    const all = [
      KEEP_SUMMARY, KEEP_BUTTON, KEEP_APPLIED, KEEP_FAILED, KEEP_TOO_LARGE, KEEP_NO_EFFECT, KEEP_TOP_LEAD, KEEP_LIMITS,
      keepPremise(fac({}), 500), keepEffectLine({ areaCount: 3, top: [] }), ...keepNeedLines(fac({}), keepNeeds(10, fac({}))!).flatMap((l) => [l.label, l.value]),
    ].join('\n');
    expect(all).not.toMatch(/残せない|閉鎖|閉店|撤退|廃止|なくなる|無くなる|消える|潰れ|残す|残さ|守る|維持|おすすめ|べき|した方が|ほうがよい|必要です/);
    expect(all.replace(/予測ではありません/g, '')).not.toContain('予測');
    expect(all).not.toMatch(/[←-⇿▲▶▼①-⑳]/); // arrows and circled numbers
  });
});

describe('on the real data (default scenario)', () => {
  const ctx2100 = makeRealContext({ year: 2100 });
  const at2100 = populationAt(ctx2100.data, ctx2100.store.get().series, 2100);
  const ctx2050 = makeRealContext({ year: 2050 });
  const at2050 = populationAt(ctx2050.data, ctx2050.store.get().series, 2050);
  const ctx2020 = makeRealContext({ year: 2020 });
  const at2020 = populationAt(ctx2020.data, ctx2020.store.get().series, 2020);
  const facilities = ctx2100.data.facilities;
  const get = (id: string) => facilityById(facilities, id);

  test('田辺市 in 2100 (11,879.88 people): the numbers for ペット用品 and 外車ディーラー', () => {
    expect(at2100.popByArea.get('30206')).toBeCloseTo(11_879.876, 3);
    const pet = computeKeep(at2100, facilities, get('pet_supplies'), '30206')!;
    expect(pet.needs).toEqual({ need50: 20_621, need80: 35_621 }); // 32,500 and 47,500
    expect(pet.outcome).toMatchObject({ kind: 'ok', people: 20_621, effects: { areaCount: 1, top: [{ facilityId: 'cafe', name: '喫茶店', count: 1 }] } });

    const car = computeKeep(at2100, facilities, get('import_car_dealer'), '30206')!;
    expect(car.needs).toEqual({ need50: 163_121, need80: 213_121 }); // 175,000 and 225,000
    if (car.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(car.outcome.people).toBe(163_121);
    expect(car.outcome.effects.areaCount).toBe(19);
    // 3 / 2 / 2 areas: 書籍・文房具小売業 first, then 喫茶店 and 遊戯場 in the facility list order
    expect(car.outcome.effects.top).toEqual([
      { facilityId: 'stationery_books', name: '書籍・文房具小売業', count: 3 },
      { facilityId: 'cafe', name: '喫茶店', count: 2 },
      { facilityId: 'arcade', name: '遊戯場', count: 2 },
    ]);
  });

  test('田辺市 in 2100: 百貨店 has one guide (275,000) and one number of people', () => {
    const d = computeKeep(at2100, facilities, get('department_store'), '30206')!;
    expect(d.needs).toEqual({ need50: 263_121, need80: undefined });
    expect(d.outcome).toMatchObject({ kind: 'ok', effects: { areaCount: 35 } });
  });

  test('田辺市 in 2050 (42,311 people): フィットネスクラブ needs 190 more people and no other area falls below', () => {
    expect(at2050.popByArea.get('30206')).toBeCloseTo(42_310.99, 2);
    const fit = computeKeep(at2050, facilities, get('fitness_club'), '30206')!;
    expect(fit.needs).toEqual({ need50: 190, need80: 20_190 });
    expect(fit.outcome).toMatchObject({ kind: 'ok', people: 190, effects: { areaCount: 0, top: [] } });

    const car = computeKeep(at2050, facilities, get('import_car_dealer'), '30206')!;
    expect(car.needs).toEqual({ need50: 132_690, need80: 182_690 });
    if (car.outcome.kind !== 'ok') throw new Error('expected an ok outcome');
    expect(car.outcome.effects.areaCount).toBe(7);
    expect(car.outcome.effects.top.map((x) => [x.facilityId, x.count])).toEqual([
      ['performance_venue', 2],
      ['stationery_books', 1],
      ['import_car_dealer', 1],
    ]);
  });

  test('every facility 田辺市 is below gets a computation, the town reaches the guide, and the national total stays', () => {
    for (const [at, below] of [[at2050, 18], [at2100, 29]] as const) {
      const pop = at.popByArea.get('30206')!;
      const list = facilities.filter((f) => facilityStatus(pop, f) === 'below');
      expect(list).toHaveLength(below);
      for (const f of list) {
        const c = computeKeep(at, facilities, f, '30206')!;
        expect(c.needs.need50).toBe(Math.ceil(f.p50 - pop));
        if (c.outcome.kind !== 'ok') throw new Error(`${f.id}: expected an ok outcome`);
        expect(facilityStatus(c.outcome.result.pop.get('30206')!, f)).not.toBe('below');
        const sum = [...at.popByArea.values()].reduce((t, v) => t + v, 0);
        expect(c.outcome.result.total).toBeCloseTo(sum, 3);
        expect(c.outcome.effects.top.length).toBeLessThanOrEqual(KEEP_TOP);
        expect(c.outcome.effects.top.map((x) => x.facilityId)).not.toContain('30206');
      }
    }
    // the facilities above the town in 2100 have no computation
    expect(computeKeep(at2100, facilities, get('stationery_books'), '30206')).toBeUndefined();
    expect(computeKeep(at2100, facilities, get('general_hospital'), '30206')).toBeUndefined(); // edge: 5,500 <= pop < 27,500
  });

  test('高野町 in 2100 (471 people): 飲食料品小売業 needs 30 more people', () => {
    const c = computeKeep(at2100, facilities, get('grocery'), '30344')!;
    expect(c.needs).toEqual({ need50: 30, need80: undefined });
    expect(c.outcome).toMatchObject({ kind: 'ok', people: 30, effects: { areaCount: 0, top: [] } });
  });

  test('a large city in 2020 (鹿児島市, 593,128 people) is not below any facility: nothing to compute', () => {
    expect(at2020.popByArea.get('46201')).toBe(593_128);
    for (const f of facilities) expect(computeKeep(at2020, facilities, f, '46201')).toBeUndefined();
  });
});
