import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO } from './types';
import type { Area, Facility, Groups, Pop, Scenario, Series } from './types';

describe('shared engine types', () => {
  it('DEFAULT_SCENARIO is the neutral scenario', () => {
    expect(DEFAULT_SCENARIO).toEqual({ cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 });
  });

  it('exports the shapes other tasks rely on (type-level check, compiled by typecheck)', () => {
    const pop: Pop = { M: new Array(20).fill(0), F: new Array(20).fill(0) };
    const area: Area = {
      code: '30206',
      name: '橋本市',
      prefCode: '30',
      prefName: '和歌山県',
      kind: 'city',
      base: pop,
      official: { 2025: 0 },
      assumptions: null,
    };
    const facility: Facility = {
      id: 'hospital',
      name: '病院',
      p50: 5000,
      p80: 10000,
      essential: true,
      excludesMetro: true,
      source: 'test',
    };
    const groups: Groups = { cities: { x: ['30206'] }, prefs: { y: ['30'] } };
    const series: Series = { 2020: pop };
    const scenario: Scenario = { ...DEFAULT_SCENARIO };
    expect([area.code, facility.id, groups.cities.x[0], Object.keys(series).length, scenario.cwrMult]).toEqual([
      '30206',
      'hospital',
      '30206',
      1,
      1,
    ]);
  });
});
