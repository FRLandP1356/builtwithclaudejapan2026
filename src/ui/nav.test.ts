import { describe, expect, test } from 'vitest';
import { breadcrumbs, goUp, levelOf, pickArea, pickPref, searchPlaces, type SearchEntry } from './nav';

const names = {
  pref: (code: string) => ({ '30': '和歌山県', '13': '東京都' } as Record<string, string>)[code],
  area: (code: string) => ({ '30206': '田辺市', '13101': '千代田区' } as Record<string, string>)[code],
};

describe('levelOf', () => {
  test('japan when nothing is selected', () => {
    expect(levelOf({})).toBe('japan');
  });
  test('pref when a prefecture is selected', () => {
    expect(levelOf({ selectedPref: '30' })).toBe('pref');
  });
  test('area when an area is selected', () => {
    expect(levelOf({ selectedPref: '30', selectedArea: '30206' })).toBe('area');
  });
  test('an area without its prefecture is still the area level (the prefecture is derived)', () => {
    expect(levelOf({ selectedArea: '30206' })).toBe('area');
  });
});

describe('transitions', () => {
  test('pickPref selects the prefecture and clears any area', () => {
    expect(pickPref('30')).toEqual({ selectedPref: '30', selectedArea: undefined });
  });
  test('pickArea selects the area and its prefecture', () => {
    expect(pickArea({ code: '30206', prefCode: '30' })).toEqual({ selectedPref: '30', selectedArea: '30206' });
  });
  test('goUp walks area -> pref -> japan and stays at japan', () => {
    expect(goUp({ selectedPref: '30', selectedArea: '30206' })).toEqual({ selectedPref: '30', selectedArea: undefined });
    expect(goUp({ selectedPref: '30' })).toEqual({ selectedPref: undefined, selectedArea: undefined });
    expect(goUp({})).toEqual({});
  });
});

describe('breadcrumbs', () => {
  test('japan only', () => {
    const c = breadcrumbs({}, names);
    expect(c.map((x) => x.label)).toEqual(['日本']);
    expect(c[0].current).toBe(true);
  });
  test('japan > pref', () => {
    const c = breadcrumbs({ selectedPref: '30' }, names);
    expect(c.map((x) => x.label)).toEqual(['日本', '和歌山県']);
    expect(c[0].current).toBe(false);
    expect(c[0].patch).toEqual({ selectedPref: undefined, selectedArea: undefined });
    expect(c[1].current).toBe(true);
  });
  test('japan > pref > area', () => {
    const c = breadcrumbs({ selectedPref: '30', selectedArea: '30206' }, names);
    expect(c.map((x) => x.label)).toEqual(['日本', '和歌山県', '田辺市']);
    expect(c[1].patch).toEqual({ selectedPref: '30', selectedArea: undefined });
    expect(c[2].current).toBe(true);
  });
  test('unknown codes fall back to the code itself', () => {
    const c = breadcrumbs({ selectedPref: '99' }, names);
    expect(c[1].label).toBe('99');
  });
});

describe('searchPlaces', () => {
  const index: SearchEntry[] = [
    { kind: 'pref', code: '30', name: '和歌山県', prefCode: '30' },
    { kind: 'pref', code: '13', name: '東京都', prefCode: '13' },
    { kind: 'area', code: '30201', name: '和歌山市', prefCode: '30', prefName: '和歌山県' },
    { kind: 'area', code: '30206', name: '田辺市', prefCode: '30', prefName: '和歌山県' },
    { kind: 'area', code: '13101', name: '千代田区', prefCode: '13', prefName: '東京都' },
    { kind: 'area', code: '14106', name: '横浜市保土ケ谷区', prefCode: '14', prefName: '神奈川県' },
    { kind: 'area', code: '40131', name: '福岡市東区', prefCode: '40', prefName: '福岡県' },
  ];

  test('empty or whitespace query returns nothing', () => {
    expect(searchPlaces('', index)).toEqual([]);
    expect(searchPlaces('  ', index)).toEqual([]);
  });

  test('substring match on area names', () => {
    const hits = searchPlaces('田辺', index);
    expect(hits.map((h) => h.code)).toEqual(['30206']);
  });

  test('prefectures come first, then areas; prefix matches before inner matches', () => {
    const hits = searchPlaces('和歌山', index);
    expect(hits.map((h) => h.code)).toEqual(['30', '30201']);
    const hits2 = searchPlaces('東', index);
    expect(hits2[0].code).toBe('13'); // 東京都 (pref) first
    expect(hits2.map((h) => h.code)).toContain('40131'); // 福岡市東区 (inner match)
  });

  test('normalises width and the ke/ga kana variants', () => {
    expect(searchPlaces('保土ヶ谷', index).map((h) => h.code)).toEqual(['14106']);
    expect(searchPlaces('　千代田　', index).map((h) => h.code)).toEqual(['13101']);
  });

  test('respects the limit', () => {
    expect(searchPlaces('市', index, 2)).toHaveLength(2);
  });
});
