import { describe, expect, test } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import { DEFAULT_SCENARIO } from '../engine/types';
import { makeEngineContext } from '../../test/helpers/engineContext';
import { runTool } from '../ai/tools';
import { buildOverlay, changePercentOf, deltaLabel, overlayFromToolInput } from './allocationOverlay';
import { computeAllocation, populationAt } from './allocationPanel';
import { allocatedTotals, deriveTotals, yearIndex } from './derive';
import { formatDeltaPct } from './format';

const ctx = makeRealContext({ year: 2100 });
const { data, runner } = ctx;
const series = runner.run(DEFAULT_SCENARIO);
const wakayama = data.areas.filter((a) => a.prefCode === '30').map((a) => a.code);

describe('changePercentOf', () => {
  test('percent change per area, 0 when nobody was there before', () => {
    const before = new Map([
      ['a', 100],
      ['b', 0],
      ['c', 50],
    ]);
    const after = new Map([
      ['a', 110],
      ['b', 5],
      ['c', 49],
    ]);
    expect(changePercentOf(before, after)).toEqual({ a: 10, b: 0, c: -2 });
  });
});

describe('buildOverlay on real data: 和歌山県 +10% in 2100', () => {
  const at = populationAt(data, series, 2100);
  const c = computeAllocation(data, series, 2100, { target: { kind: 'pref', code: '30' }, percent: 10, sourceMode: 'proportional', regionIds: [] }, at);
  const overlay = buildOverlay({ result: c.result, before: at.popByArea, facilities: data.facilities, year: 2100, label: '和歌山県 +10%' });

  test('every area has a change; Wakayama areas are at +10.0%, the rest at about −0.04%', () => {
    expect(Object.keys(overlay.changePercent)).toHaveLength(1884);
    for (const code of wakayama) expect(overlay.changePercent[code]).toBeCloseTo(10, 6);
    const others = data.areas.filter((a) => a.prefCode !== '30').map((a) => overlay.changePercent[a.code]);
    expect(Math.min(...others)).toBeGreaterThan(-0.1);
    expect(Math.max(...others)).toBeLessThan(0);
    expect(others[0]).toBeCloseTo(-0.04, 1);
  });

  test('flips carry every gained and lost town; 高野町 (30344) rises to the p50 = 500 guides', () => {
    expect(overlay.flips.length).toBeGreaterThan(0);
    for (const f of overlay.flips) expect(f.gained.length + f.lost.length).toBeGreaterThan(0);
    const grocery = overlay.flips.find((f) => f.facilityId === 'grocery');
    expect(grocery?.name).toBe('飲食料品小売業');
    expect(grocery?.gained).toContain('30344');
    expect(grocery?.lost).toEqual([]);
    // the panel's table rows and the overlay agree on the counts
    for (const row of c.summary.rows) {
      const f = overlay.flips.find((x) => x.facilityId === row.facilityId)!;
      expect(f.gained).toHaveLength(row.gained.count);
      expect(f.lost).toHaveLength(row.lost.count);
    }
  });

  test('national view: 和歌山県 changes by +10.0%, every other prefecture by the same small loss (about −0.04%)', () => {
    const totals = deriveTotals(series, data.groups);
    const i = yearIndex(totals.years, 2100);
    const { prefChange } = allocatedTotals(totals, data.groups, i, overlay.changePercent);
    // Independent expectation: proportional mode takes the 10% of Wakayama from everyone else at the same rate.
    const pw = totals.pref.get('30')![i];
    const expectedOthers = (-(0.1 * pw) / (totals.japan[i] - pw)) * 100;
    expect(expectedOthers).toBeGreaterThan(-0.05);
    expect(expectedOthers).toBeLessThan(-0.03);
    expect(prefChange.get('30')).toBeCloseTo(10, 6);
    expect(formatDeltaPct(prefChange.get('30')!)).toBe('+10.0%');
    expect(prefChange.size).toBe(47);
    for (const [pp, v] of prefChange) {
      if (pp === '30') continue;
      expect(v).toBeCloseTo(expectedOthers, 6);
      expect(formatDeltaPct(v)).toBe('−0.04%');
    }
  });

  test('高野町 (30344) rises to the guide of every p50 = 500 facility, and only those among the ones it crosses', () => {
    const p500 = data.facilities.filter((f) => f.p50 === 500).map((f) => f.id);
    expect(p500).toHaveLength(8);
    const withKoya = overlay.flips.filter((f) => f.gained.includes('30344')).map((f) => f.facilityId);
    expect(withKoya.sort()).toEqual([...p500].sort());
    // Independent check of the threshold crossing: below 500 before, at or above after.
    expect(at.popByArea.get('30344')!).toBeLessThan(500);
    expect(at.popByArea.get('30344')! * 1.1).toBeGreaterThanOrEqual(500);
  });

  test('a focus is kept only when it names a flip', () => {
    expect(buildOverlay({ result: c.result, before: at.popByArea, facilities: data.facilities, year: 2100, label: 'x', focusFacilityId: 'grocery' }).focusFacilityId).toBe('grocery');
    expect(buildOverlay({ result: c.result, before: at.popByArea, facilities: data.facilities, year: 2100, label: 'x', focusFacilityId: 'nope' }).focusFacilityId).toBeUndefined();
  });
});

describe('overlayFromToolInput (AI run_allocation input)', () => {
  test('reproduces the panel allocation from the tool input alone', () => {
    const r = overlayFromToolInput({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 }, data, runner);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.scenario).toEqual(DEFAULT_SCENARIO);
    const o = r.overlay;
    expect(o.year).toBe(2100);
    expect(o.label).toBe('和歌山県 +10%');
    expect(o.changePercent['30206']).toBeCloseTo(10, 3); // whole people, as the tool moves them
    expect(o.flips.find((f) => f.facilityId === 'grocery')?.gained).toContain('30344');
  });

  // The AI tool itself, run on its own engine context: the overlay must describe the very allocation it reported.
  const engine = makeEngineContext();
  const sameAsTool = (input: Record<string, unknown>) => {
    const tool = runTool('run_allocation', input, engine) as {
      year: number;
      deltaPeople: number;
      flippedFacilityCount: number;
      essentialFlips: Array<{ facilityId: string; gainedCount: number; lostCount: number }>;
      facilityFlips: Array<{ facilityId: string; gainedCount: number; lostCount: number }>;
      top: Array<{ code: string; before: number; after: number }>;
    };
    const r = overlayFromToolInput(input, data, runner);
    if ('error' in r) throw new Error(r.error);
    const o = r.overlay;
    expect(o.year).toBe(tool.year);
    expect(o.flips).toHaveLength(tool.flippedFacilityCount);
    for (const f of [...tool.essentialFlips, ...tool.facilityFlips]) {
      const mine = o.flips.find((x) => x.facilityId === f.facilityId)!;
      expect([mine.gained.length, mine.lost.length]).toEqual([f.gainedCount, f.lostCount]);
    }
    expect(tool.top.length).toBeGreaterThan(0);
    for (const t of tool.top) expect(Math.abs(t.before * (1 + o.changePercent[t.code] / 100) - t.after)).toBeLessThanOrEqual(1);
    return { o, tool };
  };

  test('matches what the run_allocation tool reported: 和歌山県 +10% in 2100', () => {
    sameAsTool({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 });
  });

  test('matches the tool on a town, a fractional number of people, regions, a year off the grid and a partial scenario', () => {
    const { o, tool } = sameAsTool({
      target: { kind: 'area', code: '30206' },
      deltaPeople: 5000.4,
      sourceMode: 'regions',
      prefCodes: ['13', '27'],
      year: 2052,
      scenario: { cwrMult: 1.2, migScale: null },
    });
    expect(o.year).toBe(2050); // the tool computed 2052 as 2050
    expect(tool.deltaPeople).toBe(5000);
    expect(o.label).toBe('田辺市 +5,000人');
    // exactly 5,000 people more in 田辺市 (whole people, not 5,000.4), under cwrMult 1.2 in 2050
    const before = populationAt(data, runner.run({ ...DEFAULT_SCENARIO, cwrMult: 1.2 }), 2050).popByArea.get('30206')!;
    expect((before * o.changePercent['30206']) / 100).toBeCloseTo(5000, 6);
  });

  test('deltaPeople, a town target, regions and a scenario are honoured', () => {
    const r = overlayFromToolInput(
      { target: { kind: 'area', code: '30206' }, deltaPeople: 5000, sourceMode: 'regions', prefCodes: ['13', '27'], year: 2050, scenario: { cwrMult: 1.2 } },
      data,
      runner,
    );
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.scenario).toEqual({ ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    const o = r.overlay;
    expect(o.label).toBe('田辺市 +5,000人');
    expect(o.changePercent['30206']).toBeGreaterThan(0);
    expect(o.changePercent['13101']).toBeLessThan(0);
    expect(o.changePercent['30201']).toBe(0); // not in the source regions, not the target
  });

  test('refuses bad inputs with a Japanese message and never throws', () => {
    const err = (raw: unknown) => {
      const o = overlayFromToolInput(raw, data, runner);
      expect('error' in o).toBe(true);
      return 'error' in o ? o.error : '';
    };
    expect(err(null)).toMatch(/地図に反映できません/);
    expect(err({ target: { kind: 'pref', code: '99' }, deltaPercent: 10, year: 2100 })).toContain('99');
    expect(err({ target: { kind: 'area', code: '99999' }, deltaPercent: 10, year: 2100 })).toContain('99999');
    expect(err({ target: { kind: 'pref', code: '30' }, year: 2100 })).toMatch(/増やす・減らす/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 1, deltaPeople: 1, year: 2100 })).toMatch(/増やす・減らす/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2101 })).toMatch(/年/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario: { cwrMult: 9 } })).toMatch(/前提/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, sourceMode: 'regions' })).toMatch(/県/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, sourceMode: 'regions', prefCodes: ['xx'] })).toContain('xx');
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: -200, year: 2100 })).toMatch(/人口/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, sourceMode: 'nope' })).toMatch(/元/);
    expect(err({ target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100, scenario: 'fade' })).toMatch(/前提/);
    // a long code from the model is clipped in the message
    const long = err({ target: { kind: 'pref', code: `<b>${'9'.repeat(500)}` }, deltaPercent: 10, year: 2100 });
    expect(long).toContain('<b>999999999…');
    expect(long.length).toBeLessThan(60);
  });

  test('deltaLabel', () => {
    expect(deltaLabel(10, 123)).toBe('+10%');
    expect(deltaLabel(-2.56, 0)).toBe('−2.6%');
    expect(deltaLabel(undefined, 26200.4)).toBe('+26,200人');
    expect(deltaLabel(undefined, -300)).toBe('−300人');
  });
});
