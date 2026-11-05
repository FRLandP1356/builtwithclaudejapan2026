import { describe, expect, test } from 'vitest';
import { PREF_CODES } from '../data/loader';
import { prefCodesOf, REGION_IDS, REGION_NAMES, REGION_PREFS } from './regions';

describe('regions', () => {
  test('every prefecture 01..47 appears in exactly one region', () => {
    const seen = new Map<string, number>();
    for (const id of REGION_IDS) for (const code of REGION_PREFS[id]) seen.set(code, (seen.get(code) ?? 0) + 1);
    expect([...seen.keys()].sort()).toEqual([...PREF_CODES]);
    expect([...seen.values()].every((n) => n === 1)).toBe(true);
  });

  test('the groupings follow the agreed ranges', () => {
    expect(REGION_PREFS.hokkaido).toEqual(['01']);
    expect(REGION_PREFS.tohoku).toEqual(['02', '03', '04', '05', '06', '07']);
    expect(REGION_PREFS.kanto).toEqual(['08', '09', '10', '11', '12', '13', '14']);
    expect(REGION_PREFS.chubu[0]).toBe('15');
    expect(REGION_PREFS.chubu.at(-1)).toBe('23');
    expect(REGION_PREFS.kinki[0]).toBe('24');
    expect(REGION_PREFS.kinki.at(-1)).toBe('30');
    expect(REGION_PREFS.chugoku).toEqual(['31', '32', '33', '34', '35']);
    expect(REGION_PREFS.shikoku).toEqual(['36', '37', '38', '39']);
    expect(REGION_PREFS.kyushu[0]).toBe('40');
    expect(REGION_PREFS.kyushu.at(-1)).toBe('47');
  });

  test('every region has a Japanese name and the list runs north to south', () => {
    expect(REGION_IDS.map((id) => REGION_NAMES[id])).toEqual(['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄']);
  });

  test('prefCodesOf unions regions', () => {
    expect(prefCodesOf(['shikoku', 'hokkaido'])).toEqual(['01', '36', '37', '38', '39']);
    expect(prefCodesOf([])).toEqual([]);
  });
});
