// The figures the site shows, checked against the data files (public/data) and the engine. Published figures (the census,
// the institute's projection, the checks file) are written out; every figure this app calculates is compared with a
// direct engine run and with the relations the pages state (about half, the count where there is one), never typed in,
// so a new data file moves the page and the test together.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AppData } from '../data/loader';
import { attachActual, parseActual } from '../data/actual';
import { parseChecks } from '../data/checks';
import { parseLandmarks } from '../data/landmarks';
import type { Area, Facility, Groups } from '../engine/types';
import { parseFinance } from '../data/finance';
import { total } from '../engine/aggregate';
import { projectAll, projectAreaFromActual } from '../engine/project';
import { DEFAULT_SCENARIO } from '../engine/types';
import { observedBirthsFactor } from '../engine/births';
import { AGE_LABELS, answerCheck, approx, buildModel, figure, groupOf, homeHeading, nationalChangeLine, shareStep, SHARE_COLORS, shownLandmarks, STANDARD_SERIES, standardNation, statusOf, supportLoad, YEARS } from './model';

const read = (p: string): unknown => JSON.parse(readFileSync(`public/data/${p}`, 'utf8'));

function loadData(): AppData {
  const actual = parseActual(read('actual2025.json'));
  const areas: Area[] = readdirSync('public/data/areas')
    .sort()
    .flatMap((f) => read(`areas/${f}`) as Area[]);
  attachActual(areas, actual);
  const prefNames = new Map<string, string>();
  for (const a of areas) if (!prefNames.has(a.prefCode)) prefNames.set(a.prefCode, a.prefName);
  const codes = new Set(areas.map((a) => a.code));
  return {
    areas,
    groups: read('groups.json') as Groups,
    facilities: read('facilities.json') as Facility[],
    finance: parseFinance(read('finance.json')),
    japanTopo: read('geo/japan.topo.json') as AppData['japanTopo'],
    prefNames,
    landmarks: parseLandmarks(read('landmarks.json'), (c) => codes.has(c)),
    checks: parseChecks(read('checks.json'), (c) => codes.has(c)),
  };
}

const data = loadData();
const model = buildModel(data);
const sumAt = (run: Map<string, { [y: number]: { M: number[]; F: number[] } }>, y: number): number => data.areas.reduce((s, a) => s + total(run.get(a.code)![y]), 0);

describe('the national figures', () => {
  it('2020 is the census; the 2025 figure the home page shows is the published count', () => {
    expect(model.nation[2020]).toBe(126146099);
    expect(model.checks?.census.national).toBe(122972528);
  });
  it('2025: the sum of the counts, the seven Hamamatsu wards at their published projection', () => {
    const counted = data.areas.reduce((s, a) => s + (a.actual ? total(a.actual) : a.official[2025]), 0);
    expect(model.nation[2025]).toBe(counted);
    expect(model.nation[2025] - (model.checks?.census.national ?? 0)).toBeLessThan(10000); // the seven wards' drift only
    expect(model.nationOfficial[2025]).toBe(data.areas.reduce((s, a) => s + a.official[2025], 0));
  });
  it('2100: the two estimates are the engine runs summed over every area, and both are about half of 2020', () => {
    const fromCount = projectAll(data.areas, DEFAULT_SCENARIO, 2100, undefined, true);
    const fromBase = projectAll(data.areas, DEFAULT_SCENARIO, 2100, undefined, false);
    expect(model.nation[2100]).toBeCloseTo(sumAt(fromCount, 2100), 3);
    expect(model.nationOfficial[2100]).toBeCloseTo(sumAt(fromBase, 2100), 3);
    expect(model.nation[2100] / model.nation[2020]).toBeGreaterThan(0.45);
    expect(model.nation[2100] / model.nation[2020]).toBeLessThan(0.55);
    // the two differ by well under one percent: the page says 「約半分」 is unchanged
    expect(Math.abs(model.nation[2100] / model.nationOfficial[2100] - 1)).toBeLessThan(0.01);
    expect(nationalChangeLine(model)).toMatch(/^[\d,.]+万人 → [\d,.]+万人（[−+±]\d+\.\d\d%）$/);
  });
  it('the 2025 ages: both series add up to their totals, and the count has fewer 0〜4歳 than the official run', () => {
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum(model.ages2025.count) - model.nation[2025])).toBeLessThan(10); // the seven Hamamatsu wards: engine run vs published figure
    expect(sum(model.ages2025.official)).toBeCloseTo(data.areas.reduce((s, a) => s + total(projectAll(data.areas, DEFAULT_SCENARIO, 2025, undefined, false).get(a.code)![2025]), 0), 3);
    expect(model.ages2025.count[0]).toBeLessThan(model.ages2025.official[0]);
    expect(AGE_LABELS[0]).toBe('0〜4歳');
    expect(AGE_LABELS[19]).toBe('95歳以上');
  });
});

describe('田辺市 (30206)', () => {
  const t = model.town.get('30206')!;
  const area = data.areas.find((a) => a.code === '30206')!;
  it('2020 and 2025 are the census; 2050 and 2100 are the engine run from the 2025 count', () => {
    expect(t.hasActual).toBe(true);
    expect(t.trial[2020]).toBe(69870);
    expect(t.trial[2025]).toBe(64288);
    const run = projectAreaFromActual(area, DEFAULT_SCENARIO, 2100);
    expect(t.trial[2050]).toBeCloseTo(total(run[2050]), 6);
    expect(t.trial[2100]).toBeCloseTo(total(run[2100]), 6);
    expect(t.official[2025]).toBe(64651);
    expect(t.official[2050]).toBe(42309);
    // the extension of the official run keeps going down after 2050
    expect(t.official[2100]).toBeLessThan(t.official[2050]);
    expect(t.trial[2100]).toBeLessThan(t.trial[2050]);
  });
  it('the hundred people: about a fifth remain in 2100', () => {
    const n = Math.round((t.trial[2100] / t.trial[2025]) * 100);
    expect(n).toBeGreaterThanOrEqual(15);
    expect(n).toBeLessThanOrEqual(25);
  });
});

describe('a ward without a 2025 count (the seven Hamamatsu wards)', () => {
  it('shows the official projection and says so', () => {
    const wards = data.areas.filter((a) => !a.actual).map((a) => a.code);
    expect(wards).toHaveLength(7);
    const w = model.town.get(wards[0])!;
    expect(w.hasActual).toBe(false);
    expect(w.trial[2025]).toBe(w.official[2025]);
    expect(statusOf(2025, false)).toBe('suikei');
    expect(statusOf(2050, false)).toBe('shisan'); // the seven Hamamatsu wards: their own run with the births factor, no longer the published projection
    expect(statusOf(2055, false)).toBe('shisan');
  });
});

describe('status and wording', () => {
  it('2020 census, 2025 census where counted, estimate from 2030', () => {
    expect(statusOf(2020, true)).toBe('jisseki');
    expect(statusOf(2025, true)).toBe('jisseki');
    expect(statusOf(2030, true)).toBe('shisan');
    expect(statusOf(2100, true)).toBe('shisan');
  });
  it('a census figure is exact, an estimate is rounded with 約', () => {
    expect(figure(64288, 'jisseki')).toBe('64,288人');
    expect(figure(42568.6, 'shisan')).toBe('約4.3万人');
    expect(figure(12016.5, 'shisan')).toBe('約1.2万人');
    expect(approx(63170053)).toBe('約6,317万人');
    expect(approx(63279524)).toBe('約6,328万人');
    expect(approx(122972528)).toBe('約1.23億人');
  });
});

describe('the answer check (checks.json: published counts and projections)', () => {
  const ac = answerCheck(model.checks!);
  it('1,877 towns with a count; below and above add up with the towns at exactly the estimate', () => {
    expect(ac.summary.n).toBe(1877);
    const exact = model.checks!.towns.filter((t) => t.census2025 !== null && t.census2025 === t.ipss23_2025).length;
    expect(ac.summary.below + ac.summary.above + exact).toBe(ac.summary.n);
    expect(ac.bins.reduce((s, b) => s + b.count, 0)).toBe(ac.summary.n);
    expect(ac.bins.map((b) => b.count)).toEqual([222, 553, 431, 338, 239, 94]);
    expect(ac.summary.below).toBe(1206);
    expect(ac.summary.above).toBe(667);
    expect(ac.summary.national).toEqual({ estimate: 123262450, count: 122972528, diff: -289922, pct: expect.closeTo(-0.2352, 3) });
  });
  it('田辺市: 64,651 estimated, 64,288 counted', () => {
    const t = ac.byCode.get('30206')!;
    expect(t.ipss23_2025).toBe(64651);
    expect(t.census2025).toBe(64288);
  });
});

describe('the landmarks on the map', () => {
  it('the four groups: infrastructure and universities are not among them', () => {
    const shown = shownLandmarks(model.landmarks);
    expect(model.landmarks).toHaveLength(220);
    expect(shown).toHaveLength(201);
    expect(groupOf('空港・港・鉄道・橋（インフラ）')).toBeUndefined();
    expect(groupOf('大学・研究')).toBeUndefined();
    expect(groupOf('神社')?.slug).toBe('jinja-jiin');
  });
});

describe('the colour steps of the share of 2025', () => {
  it('2025 is the darkest step everywhere; 2100 spreads the prefectures over at least four steps', () => {
    const steps = (y: number) => [...model.pref.values()].map((p) => shareStep(p[y] / p[2025]));
    expect(new Set(steps(2025))).toEqual(new Set([0]));
    const s2100 = steps(2100);
    expect(new Set(s2100).size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...s2100)).toBe(SHARE_COLORS.length - 1);
    expect(YEARS).toHaveLength(17);
  });
});

describe('the standard estimate: from the 2025 count, with the births shortfall carried forward', () => {
  const fromBase = projectAll(data.areas, DEFAULT_SCENARIO, 2100, undefined, false);
  const fromCount = projectAll(data.areas, DEFAULT_SCENARIO, 2100, undefined, true);
  const factor = observedBirthsFactor(data.areas, fromBase, fromCount);
  const standard = projectAll(data.areas, DEFAULT_SCENARIO, 2100, undefined, true, factor);
  const std = standardNation(model);

  it('is the one the pages use, and equals a direct engine run', () => {
    expect(STANDARD_SERIES).toBe('lowBirth');
    expect(model.birthsFactor).toBeCloseTo(factor, 10);
    expect(model.birthsFactor).toBeGreaterThan(0.915);
    expect(model.birthsFactor).toBeLessThan(0.925);
    for (const y of [2050, 2075, 2100]) expect(std[y]).toBeCloseTo(sumAt(standard, y), 3);
    expect(model.town.get('30206')!.lowBirth[2100]).toBeCloseTo(total(standard.get('30206')![2100]), 6);
  });

  it('is lower than the estimate that keeps the official births, and below half of 2020, so the home heading says so', () => {
    expect(std[2100]).toBeLessThan(model.nation[2100]);
    const r = std[2100] / std[2020];
    expect(r).toBeLessThan(0.48);
    expect(homeHeading(model)).toBe('2100年、日本の人口は、2020年の半分を下回る試算です。あなたが残したい日本は、どこですか。');
    expect(homeHeading({ nation: { 2020: 100, 2100: 50 }, nationLowBirth: { 2020: 100, 2100: 50 } })).toContain('約半分');
    expect(homeHeading({ nation: { 2020: 100, 2100: 60 }, nationLowBirth: { 2020: 100, 2100: 60 } })).toContain('半分を上回る');
  });

  it('pinned: the national totals and Tanabe that the application text and the home page state', () => {
    expect(Math.round(std[2050] / 10000)).toBe(10333);
    expect(Math.round(std[2100] / 10000)).toBe(5719);
    expect(Math.round((std[2100] / std[2020]) * 100)).toBe(45); // percent of 2020
    expect(Math.round(model.nationOfficial[2100] / 10000)).toBe(6328);
    const t = model.town.get('30206')!;
    expect(t.trial[2025]).toBe(64288);
    expect(Math.round(t.lowBirth[2050] / 10) * 10).toBe(42120);
    expect(Math.round(t.lowBirth[2100] / 10) * 10).toBe(11140);
  });
});

describe('who supports whom (supportLoad)', () => {
  it('0-14 and 65+ per person aged 15-64, from the age groups; the country rises from 2025 to 2100', () => {
    const p = { M: new Array(20).fill(0), F: new Array(20).fill(0) };
    p.M[0] = 10; p.F[14] = 20; p.M[5] = 30; p.F[12] = 30;
    expect(supportLoad(p)).toEqual({ young: 10, working: 60, old: 20, perWorker: 0.5 });
    const n25 = supportLoad(model.nationStandardAges[2025]);
    const n100 = supportLoad(model.nationStandardAges[2100]);
    expect(n25.young + n25.working + n25.old).toBeCloseTo(model.nationLowBirth[2025], 3);
    expect(n100.perWorker).toBeGreaterThan(n25.perWorker);
    expect(model.standardSeries.get('30206')![2100]).toBeDefined();
  });
});
