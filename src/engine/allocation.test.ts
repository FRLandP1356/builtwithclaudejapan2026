import { describe, expect, it } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { total } from './aggregate';
import { allocate } from './allocation';
import type { AllocationInput } from './allocation';
import { facilityStatus } from './facilities';
import { projectAll } from './project';
import { DEFAULT_SCENARIO } from './types';
import type { Facility } from './types';

/** Neumaier-compensated sum, so that 1e-6 comparisons on a 1e8 total do not depend on summation noise. */
function exactSum(values: Iterable<number>): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const t = sum + v;
    c += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  return sum + c;
}

function synthetic(id: string, p50: number, p80: number, essential = false): Facility {
  return { id, name: id, p50, p80, essential, excludesMetro: true, source: 'test' };
}

function world(rows: Array<[string, string, number]>): { pop: Map<string, number>; pref: Map<string, string> } {
  return {
    pop: new Map(rows.map(([code, , p]) => [code, p])),
    pref: new Map(rows.map(([code, pref]) => [code, pref])),
  };
}

function areasOfPref(pref: Map<string, string>, prefCode: string): string[] {
  return [...pref].filter(([, p]) => p === prefCode).map(([code]) => code);
}

// ---------------------------------------------------------------------------------------------------------------
// Real data: 2100 populations of all 1,884 areas under the default scenario.
// ---------------------------------------------------------------------------------------------------------------
const areas = loadAllAreas();
const realFacilities = loadFacilities();
const series2100 = projectAll(areas, DEFAULT_SCENARIO);
const pop2100 = new Map<string, number>(areas.map((a) => [a.code, total(series2100.get(a.code)![2100])]));
const prefOf = new Map<string, string>(areas.map((a) => [a.code, a.prefCode]));

const KANTO = ['08', '09', '10', '11', '12', '13', '14'];
const wakayamaTotal = exactSum(areasOfPref(prefOf, '30').map((c) => pop2100.get(c)!));
const wakayamaPlus10: AllocationInput = {
  target: { kind: 'pref', code: '30' },
  deltaPeople: wakayamaTotal * 0.1,
  source: { mode: 'proportional' },
};

describe('allocate on the real 2100 projection', () => {
  it('total_is_conserved: +10% to Wakayama (30) leaves the national total unchanged within 1e-6', () => {
    const before = exactSum(pop2100.values());
    const r = allocate(pop2100, prefOf, wakayamaPlus10, realFacilities);
    expect(r.pop.size).toBe(1884);
    expect(Math.abs(exactSum(r.pop.values()) - before)).toBeLessThan(1e-6);
    expect(Math.abs(r.total - before)).toBeLessThan(1e-6);
    expect(Math.abs(r.total - exactSum(r.pop.values()))).toBeLessThan(1e-6);
  });

  it('target_gets_delta: the prefecture total rises by deltaPeople and its areas scale by one common factor', () => {
    const r = allocate(pop2100, prefOf, wakayamaPlus10, realFacilities);
    const codes = areasOfPref(prefOf, '30');
    const after = exactSum(codes.map((c) => r.pop.get(c)!));
    expect(Math.abs(after - wakayamaTotal - wakayamaPlus10.deltaPeople)).toBeLessThan(1e-6);
    for (const c of codes) expect(r.pop.get(c)! / pop2100.get(c)!).toBeCloseTo(1.1, 12);
    // Everybody else pays proportionally: one common factor below 1.
    const others = [...pop2100.keys()].filter((c) => prefOf.get(c) !== '30');
    const factor = r.pop.get(others[0])! / pop2100.get(others[0])!;
    expect(factor).toBeLessThan(1);
    for (const c of others) expect(r.pop.get(c)! / pop2100.get(c)!).toBeCloseTo(factor, 12);
  });

  it('regions_mode_only_touches_selected: with Kanto (08-14) as the source, every other prefecture is unchanged', () => {
    const input: AllocationInput = { ...wakayamaPlus10, source: { mode: 'regions', prefCodes: KANTO } };
    const r = allocate(pop2100, prefOf, input, realFacilities);
    let kantoBefore = 0;
    let kantoAfter = 0;
    for (const [code, p] of pop2100) {
      const pref = prefOf.get(code)!;
      if (KANTO.includes(pref)) {
        kantoBefore += p;
        kantoAfter += r.pop.get(code)!;
        expect(r.pop.get(code)!).toBeLessThan(p);
      } else if (pref !== '30') {
        expect(r.pop.get(code)).toBe(p); // bit-for-bit unchanged
      }
    }
    expect(Math.abs(kantoBefore - kantoAfter - input.deltaPeople)).toBeLessThan(1e-3);
    expect(Math.abs(r.total - exactSum(pop2100.values()))).toBeLessThan(1e-6);
  });

  it('real_facilities_flip: +10% to Wakayama lifts 高野町 (30344) over 500 people in 2100, so eight 500-person facilities appear there', () => {
    const koya = '30344';
    const before = pop2100.get(koya)!;
    const r = allocate(pop2100, prefOf, wakayamaPlus10, realFacilities);
    const after = r.pop.get(koya)!;
    // Data check: under the default scenario 高野町 has about 471 people in 2100, so +10% (about 518) crosses 500.
    expect(before).toBeGreaterThan(450);
    expect(before).toBeLessThan(500);
    expect(after).toBeGreaterThanOrEqual(500);

    expect(r.flips.map((f) => f.facilityId)).toEqual(realFacilities.map((f) => f.id));
    const gainedByKoya = r.flips.filter((f) => f.gained.includes(koya)).map((f) => f.facilityId).sort();
    // Exactly the facilities whose 50% threshold is 500 people (and none with a higher threshold) are gained.
    const threshold500 = realFacilities.filter((f) => f.p50 === 500).map((f) => f.id).sort();
    expect(threshold500).toEqual(['bar', 'clinic', 'dental_clinic', 'grocery', 'hotel', 'nursing_home', 'post_office', 'restaurant']);
    expect(gainedByKoya).toEqual(threshold500);

    // Positive delta, proportional source: only Wakayama areas gain a facility and only outside areas lose one.
    for (const f of r.flips) {
      expect(f.gained.every((c) => prefOf.get(c) === '30')).toBe(true);
      expect(f.lost.every((c) => prefOf.get(c) !== '30')).toBe(true);
      expect(f.after - f.before).toBe(f.gained.length - f.lost.length);
    }
    expect(r.flips.filter((f) => f.gained.length > 0 || f.lost.length > 0).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Synthetic data: facility flips.
// ---------------------------------------------------------------------------------------------------------------
describe('allocate facility flips (synthetic data)', () => {
  const hall = synthetic('hall', 5000, 10000);
  const clinic = synthetic('clinic', 500, 500, true);

  it('flips_listed: a town of 4,900 growing 5% (to 5,145) moves below -> edge and is listed in gained', () => {
    const w = world([
      ['T', '01', 4900],
      ['A', '02', 100000],
      ['B', '02', 20000],
    ]);
    const r = allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 245, source: { mode: 'proportional' } }, [hall, clinic]);
    expect(r.pop.get('T')).toBeCloseTo(5145, 9);

    const [hallFlip, clinicFlip] = r.flips;
    expect(hallFlip).toEqual({ facilityId: 'hall', before: 2, after: 3, lost: [], gained: ['T'] });
    // 4,900 is already above 500: the clinic never changes, so nothing is listed.
    expect(clinicFlip).toEqual({ facilityId: 'clinic', before: 3, after: 3, lost: [], gained: [] });
  });

  it('flips_listed: a source town pushed under the threshold is listed in lost (regions mode)', () => {
    const w = world([
      ['T', '01', 4900],
      ['S', '02', 5100],
      ['A', '03', 100000],
    ]);
    const r = allocate(
      w.pop,
      w.pref,
      { target: { kind: 'area', code: 'T' }, deltaPeople: 245, source: { mode: 'regions', prefCodes: ['02'] } },
      [hall],
    );
    expect(r.pop.get('S')).toBeCloseTo(4855, 9);
    expect(r.pop.get('A')).toBe(100000);
    // T gains the hall, S loses it: the count stays the same but both towns are named.
    expect(r.flips[0]).toEqual({ facilityId: 'hall', before: 2, after: 2, lost: ['S'], gained: ['T'] });
  });

  it('flips_listed: edge -> ok is not a flip, because both count as having the facility', () => {
    const w = world([
      ['T', '01', 9900],
      ['A', '02', 100000],
    ]);
    const r = allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 495, source: { mode: 'proportional' } }, [hall]);
    expect(r.pop.get('T')).toBeCloseTo(10395, 9);
    expect(facilityStatus(w.pop.get('T')!, hall)).toBe('edge');
    expect(facilityStatus(r.pop.get('T')!, hall)).toBe('ok');
    expect(r.flips[0]).toEqual({ facilityId: 'hall', before: 2, after: 2, lost: [], gained: [] });
  });

  it('flips_listed: a prefecture target lists several towns, in the order of the population map, one entry per facility', () => {
    const w = world([
      ['T1', '01', 4000],
      ['X', '02', 50000],
      ['T2', '01', 4500],
      ['T3', '01', 8000],
    ]);
    // +30% of the prefecture's 16,500 people = +4,950, spread proportionally: T1 -> 5,200, T2 -> 5,850.
    const r = allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: 4950, source: { mode: 'proportional' } }, [hall, clinic]);
    expect(r.flips.map((f) => f.facilityId)).toEqual(['hall', 'clinic']);
    expect(r.flips[0]).toEqual({ facilityId: 'hall', before: 2, after: 4, lost: [], gained: ['T1', 'T2'] });
    expect(r.flips[1].gained).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Edge cases and contract.
// ---------------------------------------------------------------------------------------------------------------
describe('allocate edge cases', () => {
  const hall = synthetic('hall', 5000, 10000);
  const base = () =>
    world([
      ['T', '01', 1000],
      ['U', '01', 3000],
      ['A', '02', 6000],
      ['B', '03', 10000],
    ]); // national total 20,000; prefecture 01 has 4,000; outside 01 there are 16,000
  const prop: AllocationInput['source'] = { mode: 'proportional' };

  it('edge_cases: a delta larger than the source total is a RangeError; exactly the source total empties the source', () => {
    const w = base();
    const t = { kind: 'pref', code: '01' } as const;
    expect(() => allocate(w.pop, w.pref, { target: t, deltaPeople: 16000.5, source: prop }, [hall])).toThrow(RangeError);
    const r = allocate(w.pop, w.pref, { target: t, deltaPeople: 16000, source: prop }, [hall]);
    expect(r.pop.get('A')).toBe(0);
    expect(r.pop.get('B')).toBe(0);
    expect(r.pop.get('T')! + r.pop.get('U')!).toBeCloseTo(20000, 9);
    // regions mode: the limit is the selected regions' total, not the national one
    expect(() => allocate(w.pop, w.pref, { target: t, deltaPeople: 6001, source: { mode: 'regions', prefCodes: ['02'] } }, [hall])).toThrow(RangeError);
  });

  it('edge_cases: a negative delta shrinks the target and grows the source, in proportion', () => {
    const w = base();
    const r = allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: -1000, source: prop }, [hall]);
    expect(r.pop.get('T')).toBeCloseTo(750, 9); // 1000 * 3000/4000
    expect(r.pop.get('U')).toBeCloseTo(2250, 9);
    expect(r.pop.get('A')).toBeCloseTo(6000 * (17000 / 16000), 9);
    expect(r.pop.get('B')).toBeCloseTo(10000 * (17000 / 16000), 9);
    expect(r.total).toBeCloseTo(20000, 9);
    // a negative delta cannot take more than the target has
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: -4000.5, source: prop }, [hall])).toThrow(RangeError);
    const empty = allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: -4000, source: prop }, [hall]);
    expect(empty.pop.get('T')).toBe(0);
    expect(empty.pop.get('U')).toBe(0);
  });

  it('edge_cases: deltaPeople 0 returns an unchanged copy with nothing listed', () => {
    const w = base();
    const before = new Map(w.pop);
    const r = allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 0, source: prop }, [hall]);
    expect(r.pop).toEqual(before);
    expect(r.pop).not.toBe(w.pop);
    expect(r.total).toBe(20000);
    expect(r.flips).toEqual([{ facilityId: 'hall', before: 2, after: 2, lost: [], gained: [] }]);
    // -0 is zero too
    expect(allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: -0, source: prop }, [hall]).pop).toEqual(before);
  });

  it('edge_cases: a delta that is not a finite number is a RangeError', () => {
    const w = base();
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: bad, source: prop }, [hall])).toThrow(RangeError);
    }
  });

  it('edge_cases: an unknown target code (empty target group) is a RangeError', () => {
    const w = base();
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'area', code: 'ZZ' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'pref', code: '99' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'pref', code: '99' }, deltaPeople: 0, source: prop }, [hall])).toThrow(RangeError);
  });

  it('edge_cases: a target that covers the whole country (nobody left to give or take) is a RangeError', () => {
    const w = world([
      ['T', '01', 1000],
      ['U', '01', 3000],
    ]);
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);
    const one = world([['T', '01', 1000]]);
    expect(() => allocate(one.pop, one.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 0, source: prop }, [hall])).toThrow(RangeError);
  });

  it('edge_cases: regions mode with no matching areas, or only the target itself, is a RangeError', () => {
    const w = base();
    const t = { kind: 'area', code: 'T' } as const;
    expect(() => allocate(w.pop, w.pref, { target: t, deltaPeople: 10, source: { mode: 'regions', prefCodes: [] } }, [hall])).toThrow(RangeError);
    expect(() => allocate(w.pop, w.pref, { target: t, deltaPeople: 10, source: { mode: 'regions', prefCodes: ['99'] } }, [hall])).toThrow(RangeError);
    // the target pref is excluded from the source, which here leaves nothing
    expect(() => allocate(w.pop, w.pref, { target: { kind: 'pref', code: '01' }, deltaPeople: 10, source: { mode: 'regions', prefCodes: ['01'] } }, [hall])).toThrow(RangeError);
  });

  it('edge_cases: regions that include the target prefecture exclude the target itself from the source', () => {
    const w = base();
    // target is area T; its prefecture 01 is in the list, so U (same prefecture) is a source, but T is not
    const r = allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 400, source: { mode: 'regions', prefCodes: ['01', '02'] } }, [hall]);
    expect(r.pop.get('T')).toBeCloseTo(1400, 9);
    const factor = 1 - 400 / 9000;
    expect(r.pop.get('U')).toBeCloseTo(3000 * factor, 9);
    expect(r.pop.get('A')).toBeCloseTo(6000 * factor, 9);
    expect(r.pop.get('B')).toBe(10000);
  });

  it('edge_cases: a target with no people cannot be scaled up, and an unknown prefecture or bad population is a RangeError', () => {
    const z = world([
      ['T', '01', 0],
      ['A', '02', 1000],
    ]);
    expect(() => allocate(z.pop, z.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);

    const w = base();
    const missingPref = new Map(w.pref);
    missingPref.delete('B');
    expect(() => allocate(w.pop, missingPref, { target: { kind: 'area', code: 'T' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);

    for (const bad of [NaN, -1, Infinity]) {
      const p = new Map(w.pop);
      p.set('B', bad);
      expect(() => allocate(p, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 10, source: prop }, [hall])).toThrow(RangeError);
    }
  });

  it('edge_cases: inputs are not mutated and the result is deterministic', () => {
    const w = base();
    const popCopy = new Map(w.pop);
    const prefCopy = new Map(w.pref);
    const input: AllocationInput = { target: { kind: 'pref', code: '01' }, deltaPeople: 700, source: { mode: 'regions', prefCodes: ['02', '03'] } };
    const frozen = JSON.stringify(input);
    const r1 = allocate(w.pop, w.pref, input, [hall]);
    const r2 = allocate(w.pop, w.pref, input, [hall]);
    expect(w.pop).toEqual(popCopy);
    expect(w.pref).toEqual(prefCopy);
    expect(JSON.stringify(input)).toBe(frozen);
    expect([...r1.pop]).toEqual([...r2.pop]);
    expect(r1).toEqual(r2);
    expect([...r1.pop.keys()]).toEqual([...w.pop.keys()]); // same order as the input
    expect(r1.pop).not.toBe(w.pop);
  });

  it('edge_cases: a facility list of any length is handled, including none', () => {
    const w = base();
    const r = allocate(w.pop, w.pref, { target: { kind: 'area', code: 'T' }, deltaPeople: 10, source: prop }, []);
    expect(r.flips).toEqual([]);
    expect(r.total).toBeCloseTo(20000, 9);
  });
});
