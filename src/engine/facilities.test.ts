import { describe, expect, it } from 'vitest';
import { facilityById, loadFacilities } from '../../test/helpers/loadFacilities';
import { facilityStatus, lostEssentialCount } from './facilities';
import type { Facility } from './types';

const facilities = loadFacilities();

function synthetic(id: string, p50: number, p80: number, essential: boolean): Facility {
  return { id, name: id, p50, p80, essential, excludesMetro: true, source: 'test' };
}

describe('facilities.json (the data the rules below are checked against)', () => {
  it('has the 48 rows of the MLIT chart, 8 of them essential', () => {
    expect(facilities).toHaveLength(48);
    expect(facilities.filter((f) => f.essential).map((f) => f.id).sort()).toEqual([
      'bank',
      'clinic',
      'day_care',
      'general_hospital',
      'grocery',
      'home_help',
      'nursing_home',
      'post_office',
    ]);
  });
});

describe('facilityStatus', () => {
  it('status_boundaries: 診療所 (p50 = p80 = 500) is below at 499 and ok at 500', () => {
    const clinic = facilityById(facilities, 'clinic');
    expect([clinic.p50, clinic.p80]).toEqual([500, 500]);
    expect(facilityStatus(499, clinic)).toBe('below');
    expect(facilityStatus(500, clinic)).toBe('ok');
  });

  it('status_boundaries: 一般病院 (5,500 to 27,500) is below at 5,499, edge at 5,500, ok at 27,500', () => {
    const hospital = facilityById(facilities, 'general_hospital');
    expect([hospital.p50, hospital.p80]).toEqual([5500, 27500]);
    expect(facilityStatus(5499, hospital)).toBe('below');
    expect(facilityStatus(5500, hospital)).toBe('edge');
    expect(facilityStatus(27499, hospital)).toBe('edge');
    expect(facilityStatus(27500, hospital)).toBe('ok');
  });

  it('uses the unrounded population (fractions of a person count)', () => {
    const hospital = facilityById(facilities, 'general_hospital');
    expect(facilityStatus(5499.9999, hospital)).toBe('below');
    expect(facilityStatus(27499.9999, hospital)).toBe('edge');
  });

  it('treats a row with p50 = p80 as two-state: ok from the threshold up, below under it, never edge', () => {
    const f = synthetic('flat', 1000, 1000, true);
    expect(facilityStatus(999.5, f)).toBe('below');
    expect(facilityStatus(1000, f)).toBe('ok');
    expect(facilityStatus(1_000_000, f)).toBe('ok');
    for (const row of facilities.filter((x) => x.p50 === x.p80)) {
      for (const pop of [0, row.p50 - 1, row.p50, row.p50 + 1]) expect(facilityStatus(pop, row)).not.toBe('edge');
    }
  });

  it('gives a population of zero below every threshold', () => {
    for (const f of facilities) expect(facilityStatus(0, f)).toBe('below');
  });

  it('reads a tiny negative population (floating-point noise) as below, and rejects NaN', () => {
    const f = synthetic('x', 10, 20, false);
    expect(facilityStatus(-1e-9, f)).toBe('below');
    expect(() => facilityStatus(Number.NaN, f)).toThrow(RangeError);
  });
});

describe('lostEssentialCount', () => {
  it('counts the essential facilities that are below, step by step through the real thresholds', () => {
    // essential p50: grocery/post_office/clinic/nursing_home 500, general_hospital 5,500,
    // bank/day_care 6,500, home_help 8,500
    const expected: Array<[number, number]> = [
      [0, 8],
      [499, 8],
      [500, 4],
      [5499, 4],
      [5500, 3],
      [6499, 3],
      [6500, 1],
      [8499, 1],
      [8500, 0],
      [1_000_000, 0],
    ];
    for (const [pop, lost] of expected) expect(lostEssentialCount(pop, facilities), `pop ${pop}`).toBe(lost);
  });

  it('ignores facilities that are not essential, however far below they are', () => {
    const list = [synthetic('a', 100, 200, true), synthetic('b', 1_000_000, 2_000_000, false)];
    expect(lostEssentialCount(150, list)).toBe(0);
    expect(lostEssentialCount(99, list)).toBe(1);
  });

  it('counts "edge" as not lost, and is 0 for an empty list', () => {
    const list = [synthetic('a', 100, 200, true)];
    expect(facilityStatus(150, list[0])).toBe('edge');
    expect(lostEssentialCount(150, list)).toBe(0);
    expect(lostEssentialCount(0, [])).toBe(0);
  });

  it('does not modify the facility list', () => {
    const copy = structuredClone(facilities);
    lostEssentialCount(3000, facilities);
    expect(facilities).toEqual(copy);
  });
});
