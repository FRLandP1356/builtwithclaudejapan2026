import { describe, expect, test } from 'vitest';
import { approxPopulation, compareClause, entryHeadline, entrySupportHeadline, TOWN_NONE_AT_ALL, TOWN_TITLE_NONE, townHeadline, type FirstRow } from './screens';
import type { BoardRow } from './board';

const row = (year: number, facilityName: string): BoardRow => ({
  year,
  estimate: year > 2050,
  facilityId: 'x',
  facilityName,
  essential: true,
  leadCode: '30001',
  leadName: '美浜町',
  others: 0,
  townsText: '',
});

describe('approxPopulation: a population as a sentence says it', () => {
  test.each([
    [63_280_000, '約6,300万人'],
    [104_690_000, '約1億500万人'],
    [126_150_000, '約1億2,600万人'],
    [100_000_000, '約1億人'],
    [99_960_000, '約1億人'], // rounds up across the boundary to 1億, never 「10,000万人」
    [5_230_000, '約520万人'],
    [523_000, '約52万人'],
    [52_300, '約5.2万人'],
    [34_400, '約3.4万人'],
    [10_000, '約1万人'],
    [9_312, '約9,300人'],
    [931, '約930人'],
    [93.4, '約93人'],
    [7, '約7人'],
  ])('%d -> %s', (n, text) => {
    expect(approxPopulation(n)).toBe(text);
  });

  test('no number: a dash, never NaN', () => {
    expect(approxPopulation(NaN)).toBe('－');
  });
});

describe('compareClause: the ratio to 2020 in a few words', () => {
  test.each([
    [0.5017, '2020年の約半分です。'],
    [0.45, '2020年の約半分です。'],
    [0.549, '2020年の約半分です。'],
    [0.55, '2020年の約6割です。'],
    [0.25, '2020年の約3割です。'],
    [0.3, '2020年の約3割です。'],
    [0.12, '2020年の約1割です。'],
    [0.04, '2020年の1割に満たない水準です。'],
    [1, '2020年とほぼ同じです。'],
    [1.2, '2020年の約1.2倍です。'],
    [2, '2020年の約2倍です。'],
    [0.7, '2020年の約7割です。'],
  ])('%d -> %s', (r, text) => {
    expect(compareClause(r)).toBe(text);
  });
  test('without a ratio there is no clause', () => {
    expect(compareClause(NaN)).toBe('');
  });
});

describe('entryHeadline: made from the figures', () => {
  test('the default heading of the whole country in 2100', () => {
    expect(entryHeadline({ place: '日本', year: 2100, pop: 63_280_000, ratio: 63_280_000 / 126_146_000 })).toBe('2100年、日本の人口は約6,300万人。2020年の約半分です。');
  });
  test('2020 is the figure alone', () => {
    expect(entryHeadline({ place: '日本', year: 2020, pop: 126_146_000, ratio: 1 })).toBe('2020年、日本の人口は約1億2,600万人です。');
  });
  test('a town says its own name and its own small figure', () => {
    expect(entryHeadline({ place: '美浜町', year: 2100, pop: 93.4, ratio: 0.012 })).toBe('2100年、美浜町の人口は約93人。2020年の1割に満たない水準です。');
  });
  test('the year, the figure and the clause follow their inputs (nothing is typed in)', () => {
    const a = entryHeadline({ place: '和歌山県', year: 2050, pop: 640_000, ratio: 0.7 });
    const b = entryHeadline({ place: '和歌山県', year: 2075, pop: 410_000, ratio: 0.45 });
    expect(a).toBe('2050年、和歌山県の人口は約64万人。2020年の約7割です。');
    expect(b).toBe('2075年、和歌山県の人口は約41万人。2020年の約半分です。');
  });
  test('while the map colours by the support ratio the heading says that ratio', () => {
    expect(entrySupportHeadline({ place: '日本', year: 2050, now: 1.4, base: 2.1 })).toBe('2050年、日本で、高齢者1人を支える現役世代は1.4人。2020年は2.1人です。');
    expect(entrySupportHeadline({ place: '日本', year: 2020, now: 2.1, base: 2.1 })).toBe('2020年、日本で、高齢者1人を支える現役世代は2.1人です。');
  });
});

describe('townHeadline', () => {
  const none: FirstRow = { alreadyBelow: 0 };
  test('nothing selected: a question', () => {
    expect(townHeadline({ level: 'japan', name: '日本', pop2100: 6e7, first: none })).toBe(TOWN_TITLE_NONE);
  });
  test('a town: its 2100 figure, then the earliest facility below its guide and the year', () => {
    const first: FirstRow = { row: row(2035, '銀行（中央銀行を除く）'), alreadyBelow: 0 };
    expect(townHeadline({ level: 'area', name: '美浜町', pop2100: 3_400, first })).toBe('美浜町は、2100年に約3,400人。銀行（中央銀行を除く）が人口の目安を下回るのは2035年。');
  });
  test('a town with no new crossing and nothing already below: the plain sentence', () => {
    expect(townHeadline({ level: 'area', name: '田辺市', pop2100: 34_000, first: none })).toBe(`田辺市は、2100年に約3.4万人。${TOWN_NONE_AT_ALL}`);
  });
  test('a town with no new crossing but facilities already below in 2020 does not say 「ありません」', () => {
    const text = townHeadline({ level: 'area', name: '売木村', pop2100: 120, first: { alreadyBelow: 4 } });
    expect(text).toBe('売木村は、2100年に約120人。2020年の時点で、人口の目安を下回る施設が4種類あります。');
    expect(text).not.toContain('ありません');
  });
  test('a prefecture: the town that comes first is not named, the facility and the year are', () => {
    const first: FirstRow = { row: row(2025, '飲食料品小売業'), alreadyBelow: 3 };
    expect(townHeadline({ level: 'pref', name: '和歌山県', pop2100: 320_000, first })).toBe('和歌山県は、2100年に約32万人。飲食料品小売業が人口の目安を下回る町が出るのは2025年。');
  });
  test('the heading about a place never says 残せない (the owner: say the fact, not the verdict)', () => {
    const first: FirstRow = { row: row(2035, '郵便局'), alreadyBelow: 0 };
    for (const level of ['area', 'pref'] as const) expect(townHeadline({ level, name: 'X', pop2100: 1000, first })).not.toMatch(/残せ/);
  });
});
