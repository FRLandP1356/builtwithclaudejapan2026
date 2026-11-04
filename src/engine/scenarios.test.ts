import { describe, expect, it } from 'vitest';
import { byCode, loadAllAreas, loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { referenceProject } from '../../test/helpers/referenceProjection';
import { total } from './aggregate';
import { projectAll, projectArea } from './project';
import { cwrMultiplier, fadeFactor, migMultiplier } from './scenarios';
import { DEFAULT_SCENARIO } from './types';
import type { Area, Pop, Scenario, Series } from './types';

const areas = loadAllAreas();
const facilities = loadFacilities();

const hold = projectAll(areas, DEFAULT_SCENARIO);
const fade = projectAll(areas, { ...DEFAULT_SCENARIO, migMode: 'fade' });
const cwr12 = projectAll(areas, { ...DEFAULT_SCENARIO, cwrMult: 1.2 });
const cwr08 = projectAll(areas, { ...DEFAULT_SCENARIO, cwrMult: 0.8 });
const fadeCwr12 = projectAll(areas, { ...DEFAULT_SCENARIO, migMode: 'fade', cwrMult: 1.2 });

function seriesOf(map: Map<string, Series>, code: string): Series {
  const s = map.get(code);
  if (!s) throw new Error(`no series for ${code}`);
  return s;
}

function nationalTotal(map: Map<string, Series>, year: number): number {
  let sum = 0;
  for (const s of map.values()) sum += total(s[year]);
  return sum;
}

function prefTotal(map: Map<string, Series>, prefCode: string, year: number): number {
  let sum = 0;
  for (const a of areas) if (a.prefCode === prefCode) sum += total(seriesOf(map, a.code)[year]);
  return sum;
}

/** Assert |actual / expected - 1| <= tolerance. */
function expectWithin(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual / expected - 1), `${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
}

function expectPopsClose(actual: Pop, expected: Pop): void {
  for (const sex of ['M', 'F'] as const) {
    actual[sex].forEach((v, j) => expect(v).toBeCloseTo(expected[sex][j], 6));
  }
}

describe('fadeFactor / migMultiplier / cwrMultiplier (period-start year rules)', () => {
  it("is 1 for 'hold' in every period", () => {
    for (let y = 2020; y <= 2095; y += 5) expect(fadeFactor(y, 'hold')).toBe(1);
  });

  it("'fade' leaves the official periods (starting before 2050) alone, then falls 0.1 per period to 0", () => {
    for (let y = 2020; y <= 2045; y += 5) expect(fadeFactor(y, 'fade')).toBe(1);
    const expected: Record<number, number> = {
      2050: 0.9,
      2055: 0.8,
      2060: 0.7,
      2065: 0.6,
      2070: 0.5,
      2075: 0.4,
      2080: 0.3,
      2085: 0.2,
      2090: 0.1,
      2095: 0,
    };
    for (const [y, f] of Object.entries(expected)) expect(fadeFactor(Number(y), 'fade')).toBeCloseTo(f, 12);
    expect(fadeFactor(2100, 'fade')).toBe(0); // never negative
    expect(fadeFactor(2150, 'fade')).toBe(0);
  });

  it('migMultiplier = migScale x fade from 2050 on, and exactly 1 before (migScale never touches official periods)', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, migMode: 'fade', migScale: 2 };
    for (let y = 2020; y <= 2045; y += 5) expect(migMultiplier(s, y)).toBe(1);
    expect(migMultiplier(s, 2050)).toBeCloseTo(1.8, 12);
    expect(migMultiplier(s, 2095)).toBe(0);
    expect(migMultiplier({ ...DEFAULT_SCENARIO, migScale: 0.5 }, 2070)).toBe(0.5);
    expect(migMultiplier(DEFAULT_SCENARIO, 2070)).toBe(1);
  });

  it('cwrMultiplier is cwrMult for periods starting 2050 or later (ending after 2050), 1 before', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, cwrMult: 1.2 };
    for (let y = 2020; y <= 2045; y += 5) expect(cwrMultiplier(s, y)).toBe(1);
    for (let y = 2050; y <= 2095; y += 5) expect(cwrMultiplier(s, y)).toBe(1.2);
  });
});

describe('national totals in 2100 (all 1,884 areas)', () => {
  it('hold_national_2100: the default holds the 2045->2050 rates and reaches 63,280,000 (+-1%)', () => {
    expectWithin(nationalTotal(hold, 2100), 63_280_000, 0.01);
  });

  it('fade_national_2100: migration fading out by 2100 reaches 58,510,000 (+-1%)', () => {
    expectWithin(nationalTotal(fade, 2100), 58_510_000, 0.01);
  });

  it('cwr_1_2: child-woman ratio x1.2 reaches 70,930,000 and x0.8 reaches 56,340,000 (+-1%)', () => {
    expectWithin(nationalTotal(cwr12, 2100), 70_930_000, 0.01);
    expectWithin(nationalTotal(cwr08, 2100), 56_340_000, 0.01);
  });

  it('fade_and_cwr_1_2: both together reach 65,060,000 (+-1%)', () => {
    expectWithin(nationalTotal(fadeCwr12, 2100), 65_060_000, 0.01);
  });

  it('orders the scenarios the way the knobs push', () => {
    const n = (m: Map<string, Series>) => nationalTotal(m, 2100);
    expect(n(cwr08)).toBeLessThan(n(fade));
    expect(n(fade)).toBeLessThan(n(hold));
    expect(n(hold)).toBeLessThan(n(fadeCwr12));
    expect(n(fadeCwr12)).toBeLessThan(n(cwr12));
  });
});

describe('tokyo_and_wakayama (default scenario, 2100)', () => {
  it('東京都 reaches 11,900,000 (+-1.5%) and 和歌山県 262,000 (+-1.5%)', () => {
    expectWithin(prefTotal(hold, '13', 2100), 11_900_000, 0.015);
    expectWithin(prefTotal(hold, '30', 2100), 262_000, 0.015);
  });
});

describe('scenario fields leave the official period untouched', () => {
  const scenarios: Array<[string, Scenario, boolean]> = [
    ['cwrMult 1.2', { ...DEFAULT_SCENARIO, cwrMult: 1.2 }, false],
    ['cwrMult 0.8', { ...DEFAULT_SCENARIO, cwrMult: 0.8 }, false],
    ['fade', { ...DEFAULT_SCENARIO, migMode: 'fade' }, false],
    ['migScale 2', { ...DEFAULT_SCENARIO, migScale: 2 }, false],
    ['migScale 0', { ...DEFAULT_SCENARIO, migScale: 0 }, false],
    ['infraStrength 0.005', { ...DEFAULT_SCENARIO, infraStrength: 0.005 }, true],
    [
      'everything at once',
      { cwrMult: 1.2, migMode: 'fade', migScale: 1.5, infraStrength: 0.005 },
      true,
    ],
  ];

  it('2050 totals (and every year up to 2050) equal the default for every one of the 1,884 areas', () => {
    for (const [label, s, needsFacilities] of scenarios) {
      const m = projectAll(areas, s, 2100, needsFacilities ? facilities : undefined);
      expect(m.size).toBe(1884);
      for (const a of areas) {
        const base = seriesOf(hold, a.code);
        const got = seriesOf(m, a.code);
        for (let y = 2020; y <= 2050; y += 5) {
          if (JSON.stringify(got[y]) !== JSON.stringify(base[y])) throw new Error(`${label}: ${a.code} ${y} differs from the default`);
        }
      }
      expect(nationalTotal(m, 2050)).toBe(nationalTotal(hold, 2050));
    }
  });

  it('cwrMult 1.2 leaves the national 2050 total equal to the default and changes 2055', () => {
    expect(nationalTotal(cwr12, 2050)).toBe(nationalTotal(hold, 2050));
    expect(nationalTotal(cwr12, 2055)).toBeGreaterThan(nationalTotal(hold, 2055));
  });
});

describe('migration knobs', () => {
  const tanabe = byCode(areas, '30206');

  it('migScale 1 and migMode hold reproduce the default exactly', () => {
    expect(projectArea(tanabe, { ...DEFAULT_SCENARIO, migScale: 1, migMode: 'hold' })).toEqual(projectArea(tanabe, DEFAULT_SCENARIO));
  });

  it('migScale scales the held rates from 2050->2055 on: 田辺市 follows the straight reference calculation', () => {
    for (const migScale of [0, 0.5, 2]) {
      const s: Scenario = { ...DEFAULT_SCENARIO, migScale };
      const expected = referenceProject(tanabe, s);
      const actual = projectArea(tanabe, s);
      for (let y = 2020; y <= 2100; y += 5) expectPopsClose(actual[y], expected[y]);
    }
  });

  it("'fade' follows the straight reference calculation, alone and with cwr and migScale", () => {
    const list: Scenario[] = [
      { ...DEFAULT_SCENARIO, migMode: 'fade' },
      { ...DEFAULT_SCENARIO, migMode: 'fade', cwrMult: 1.2 },
      { ...DEFAULT_SCENARIO, migMode: 'fade', migScale: 1.5, cwrMult: 0.8 },
    ];
    for (const code of ['30206', '30201', '13101', '01209']) {
      const area = byCode(areas, code);
      for (const s of list) {
        const expected = referenceProject(area, s);
        const actual = projectArea(area, s);
        for (let y = 2020; y <= 2100; y += 5) expectPopsClose(actual[y], expected[y]);
      }
    }
  });

  it('fade lowers a town that gains people by migration (千代田区) and lifts one that loses people (田辺市)', () => {
    // measured: 千代田区 73,648 -> 63,122 and 田辺市 11,880 -> 13,690 in 2100 (hold -> fade)
    const fadeScenario: Scenario = { ...DEFAULT_SCENARIO, migMode: 'fade' };
    const chiyoda = byCode(areas, '13101');
    expect(total(projectArea(chiyoda, fadeScenario)[2100])).toBeLessThan(total(seriesOf(hold, '13101')[2100]));
    expect(total(projectArea(tanabe, fadeScenario)[2100])).toBeGreaterThan(total(seriesOf(hold, '30206')[2100]));
  });

  it('migScale 0 (no migration at all after 2050) goes further than fade in the same direction', () => {
    const none: Scenario = { ...DEFAULT_SCENARIO, migScale: 0 };
    const fadeScenario: Scenario = { ...DEFAULT_SCENARIO, migMode: 'fade' };
    const chiyoda = byCode(areas, '13101');
    expect(total(projectArea(chiyoda, none)[2100])).toBeLessThan(total(projectArea(chiyoda, fadeScenario)[2100]));
    expect(total(projectArea(tanabe, none)[2100])).toBeGreaterThan(total(projectArea(tanabe, fadeScenario)[2100]));
  });
});

describe('purity: scenario fields never mutate their inputs', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
      Object.freeze(x);
      for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
    }
    return x;
  }

  it('leaves frozen areas, scenario and facilities usable and unchanged, and returns fresh series', () => {
    const subset: Area[] = structuredClone([...loadSampleAreas(), byCode(areas, '01209'), byCode(areas, '01212')]);
    const scenario: Scenario = { cwrMult: 1.2, migMode: 'fade', migScale: 1.5, infraStrength: 0.005 };
    const frozenAreas = deepFreeze(subset);
    const frozenScenario = deepFreeze(scenario);
    const frozenFacilities = deepFreeze(structuredClone(facilities));
    const areasCopy = structuredClone(subset);

    const first = projectAll(frozenAreas, frozenScenario, 2100, frozenFacilities);
    const second = projectAll(frozenAreas, frozenScenario, 2100, frozenFacilities);

    expect(frozenAreas).toEqual(areasCopy);
    expect(frozenScenario).toEqual({ cwrMult: 1.2, migMode: 'fade', migScale: 1.5, infraStrength: 0.005 });
    expect(frozenFacilities).toEqual(facilities);
    expect(second).toEqual(first); // deterministic, so nothing leaked between runs
    for (const a of frozenAreas.filter((x) => x.assumptions !== null)) {
      const s = first.get(a.code)!;
      expect(s[2020]).not.toBe(a.base);
      for (const p of a.assumptions!) {
        expect(s[2100].M).not.toBe(p.mig.M);
        expect(s[2100].F).not.toBe(p.mig.F);
      }
    }
  });

  it('a later run with the default scenario is unaffected by earlier scenario runs', () => {
    const tanabe = structuredClone(byCode(areas, '30206'));
    const before = projectArea(tanabe, DEFAULT_SCENARIO);
    projectArea(tanabe, { cwrMult: 0.5, migMode: 'fade', migScale: 3, infraStrength: 0.005 }, 2100, facilities);
    expect(projectArea(tanabe, DEFAULT_SCENARIO)).toEqual(before);
    expect(tanabe).toEqual(byCode(areas, '30206'));
  });
});
