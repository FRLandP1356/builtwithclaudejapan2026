import { describe, expect, test } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { isMetroPref, METRO_PREF_CODES } from './metro';

describe('METRO_PREF_CODES (Ruling 10)', () => {
  test('holds exactly the eleven prefectures of the three metropolitan areas', () => {
    expect([...METRO_PREF_CODES].sort()).toEqual(['11', '12', '13', '14', '21', '23', '24', '26', '27', '28', '29']);
  });

  test('isMetroPref is true for Tokyo and Osaka and false for Wakayama, Hokkaido and Shizuoka', () => {
    expect(isMetroPref('13')).toBe(true);
    expect(isMetroPref('27')).toBe(true);
    expect(isMetroPref('30')).toBe(false);
    expect(isMetroPref('01')).toBe(false);
    expect(isMetroPref('22')).toBe(false);
  });

  test('every code names a prefecture that exists in the data', () => {
    const present = new Set(loadAllAreas().map((a) => a.prefCode));
    for (const c of METRO_PREF_CODES) expect(present.has(c)).toBe(true);
  });
});
