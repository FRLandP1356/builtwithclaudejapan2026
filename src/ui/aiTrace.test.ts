import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../ai/toolDefs';
import type { TraceItem } from '../ai/client';
import {
  compactJson,
  describeScenario,
  makePlaceNames,
  mapTargets,
  prettyJsonView,
  RESULT_DISPLAY_LIMIT,
  scenarioOffer,
  toolLabel,
  TOOL_LABELS,
  traceUsesEstimate,
} from './aiTrace';

const places = makePlaceNames(
  [
    { code: '30206', name: '田辺市', prefName: '和歌山県' },
    { code: '13101', name: '千代田区', prefName: '東京都' },
    { code: '01101', name: '中央区', prefName: '北海道' },
    { code: '13102', name: '中央区', prefName: '東京都' },
  ],
  new Map([
    ['30', '和歌山県'],
    ['13', '東京都'],
    ['01', '北海道'],
  ]),
);

const item = (tool: string, input: unknown, result: unknown = {}): TraceItem => ({ tool, input, result });

describe('toolLabel', () => {
  it('has a Japanese label for every tool the model can call', () => {
    for (const name of TOOL_NAMES) expect(TOOL_LABELS[name], name).toBeTruthy();
    expect(Object.keys(TOOL_LABELS).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it('uses the agreed wording', () => {
    expect(toolLabel('find_area')).toBe('地域をさがす');
    expect(toolLabel('get_series')).toBe('人口の推移を取る');
    expect(toolLabel('compare_sources')).toBe('公式と試算を比べる');
    expect(toolLabel('run_projection')).toBe('前提を変えて計算する');
    expect(toolLabel('facility_check')).toBe('施設の目安を調べる');
    expect(toolLabel('run_allocation')).toBe('人口の割り振りを計算する');
    expect(toolLabel('find_similar_now')).toBe('似た町をさがす');
    expect(toolLabel('count_areas')).toBe('町の数を数える');
  });

  it('falls back to a plain label for a name it does not know, keeping the name as text', () => {
    expect(toolLabel('launch_missiles')).toBe('道具（launch_missiles）');
  });
});

describe('JSON display', () => {
  it('compactJson is the JSON on one line and never throws', () => {
    expect(compactJson({ areaCode: '13', years: [2050] })).toBe('{"areaCode":"13","years":[2050]}');
    expect(compactJson(undefined)).toBe('null');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(compactJson(loop)).toBe('（表示できません）');
  });

  it('prettyJsonView keeps a short result whole', () => {
    const view = prettyJsonView({ a: 1, b: [2] });
    expect(view.truncated).toBe(false);
    expect(view.text).toBe(JSON.stringify({ a: 1, b: [2] }, null, 2));
    expect(view.full).toBe(view.text);
  });

  it('prettyJsonView cuts the display at 4,000 characters and says so, but keeps the full text for copying', () => {
    const big = { text: 'あ'.repeat(5000) };
    const view = prettyJsonView(big);
    const full = JSON.stringify(big, null, 2);
    expect(RESULT_DISPLAY_LIMIT).toBe(4000);
    expect(view.truncated).toBe(true);
    expect(view.full).toBe(full);
    expect(view.text).toBe(`${full.slice(0, 4000)}…（以下省略）`);
  });

  it('prettyJsonView does not cut a surrogate pair in half', () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    for (const pad of ['', 'a']) {
      const view = prettyJsonView({ text: pad + '𠮷'.repeat(4000) });
      expect(view.truncated).toBe(true);
      expect(lone.test(view.text)).toBe(false);
    }
  });

  it('prettyJsonView never throws', () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(prettyJsonView(loop)).toEqual({ text: '（表示できません）', full: '（表示できません）', truncated: false });
    expect(prettyJsonView(undefined).text).toBe('null');
  });
});

describe('mapTargets', () => {
  it('finds area and prefecture codes in the inputs, in order, without repeats', () => {
    const trace = [
      item('get_series', { areaCode: '30206' }),
      item('compare_sources', { areaCode: '30206' }),
      item('count_areas', { year: 2100, below: 3000, prefCode: '13' }),
    ];
    expect(mapTargets(trace, places)).toEqual([
      { kind: 'area', code: '30206', name: '田辺市', label: '田辺市' },
      { kind: 'pref', code: '13', name: '東京都', label: '東京都' },
    ]);
  });

  it('reads the allocation target and the source prefectures too', () => {
    const trace = [item('run_allocation', { target: { kind: 'pref', code: '30' }, year: 2050, deltaPercent: 10, prefCodes: ['13', '01'] })];
    expect(mapTargets(trace, places).map((t) => t.code)).toEqual(['30', '13', '01']);
  });

  it('stops at three', () => {
    const trace = [item('get_series', { areaCode: '30206' }), item('get_series', { areaCode: '13101' }), item('get_series', { areaCode: '13' }), item('get_series', { areaCode: '30' })];
    expect(mapTargets(trace, places)).toHaveLength(3);
  });

  it('ignores codes the app does not have, Japan ("00"), designated-city codes, non-strings and malformed input', () => {
    const trace = [
      item('get_series', { areaCode: '99999' }),
      item('get_series', { areaCode: '00' }),
      item('get_series', { areaCode: 30206 }),
      item('get_series', { areaCode: '3020' }),
      item('get_series', { areaCode: ' 30206 ' }),
      item('find_area', { query: '田辺' }),
      item('get_series', null),
      item('get_series', 'x'),
    ];
    expect(mapTargets(trace, places).map((t) => t.code)).toEqual(['30206']);
  });

  it('adds the prefecture to the label when two areas share a name', () => {
    const trace = [item('get_series', { areaCode: '13102' }), item('get_series', { areaCode: '01101' })];
    expect(mapTargets(trace, places).map((t) => t.label)).toEqual(['中央区（東京都）', '中央区（北海道）']);
  });
});

describe('scenarioOffer', () => {
  it('is null when no input carries a scenario that differs from the default', () => {
    expect(scenarioOffer([])).toBeNull();
    expect(scenarioOffer([item('get_series', { areaCode: '13' })])).toBeNull();
    expect(scenarioOffer([item('run_projection', { areaCode: '13', scenario: {} })])).toBeNull();
    expect(scenarioOffer([item('run_projection', { areaCode: '13', scenario: { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 } })])).toBeNull();
    expect(scenarioOffer([item('run_projection', { areaCode: '13', scenario: { cwrMult: null } })])).toBeNull();
  });

  it('returns the full scenario (defaults filled in) from the first input that differs', () => {
    const trace = [
      item('get_series', { areaCode: '13', scenario: {} }),
      item('run_projection', { areaCode: '13', scenario: { cwrMult: 1.2 } }),
      item('facility_check', { areaCode: '30206', year: 2100, scenario: { migMode: 'fade' } }),
    ];
    expect(scenarioOffer(trace)).toEqual({ cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 });
  });

  it('looks at every tool that takes a scenario, and only those', () => {
    for (const tool of ['run_projection', 'get_series', 'compare_sources', 'facility_check', 'find_similar_now', 'count_areas', 'run_allocation']) {
      expect(scenarioOffer([item(tool, { scenario: { migScale: 0.5 } })]), tool).toEqual({ cwrMult: 1, migMode: 'hold', migScale: 0.5, infraStrength: 0 });
    }
    expect(scenarioOffer([item('find_area', { query: 'x', scenario: { migScale: 0.5 } })])).toBeNull();
  });

  it('passes an out-of-range value through, so that applying it can be refused with a message', () => {
    expect(scenarioOffer([item('run_projection', { areaCode: '13', scenario: { cwrMult: 9 } })])).toEqual({ cwrMult: 9, migMode: 'hold', migScale: 1, infraStrength: 0 });
  });

  it('ignores unknown scenario keys', () => {
    expect(scenarioOffer([item('run_projection', { areaCode: '13', scenario: { evil: 1 } })])).toBeNull();
  });
});

describe('describeScenario', () => {
  it('names only what differs, in plain words', () => {
    expect(describeScenario({ cwrMult: 1.2, migMode: 'fade', migScale: 0.5, infraStrength: 0.005 })).toBe(
      '子どもの数の倍率 1.2、人口の移動は少しずつ止まる、移動の強さ 0.5、施設の影響 0.005',
    );
    expect(describeScenario({ cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 })).toBe('標準の前提');
  });

  it('shows an invalid value as it is instead of failing', () => {
    expect(describeScenario({ cwrMult: 9, migMode: 'hold', migScale: 1, infraStrength: 0 })).toBe('子どもの数の倍率 9');
  });
});

describe('traceUsesEstimate', () => {
  it('is true when a result is marked as this app\'s estimate or reaches past 2050', () => {
    expect(traceUsesEstimate([item('get_series', {}, { rows: [{ year: 2100, basis: 'app_estimate' }] })])).toBe(true);
    expect(traceUsesEstimate([item('count_areas', {}, { year: 2100, count: 3 })])).toBe(true);
    expect(traceUsesEstimate([item('compare_sources', {}, { appEstimate: [{ year: 2060, basis: 'app_estimate' }] })])).toBe(true);
  });

  it('is false for official years only, or an empty trace', () => {
    expect(traceUsesEstimate([])).toBe(false);
    expect(traceUsesEstimate([item('get_series', {}, { rows: [{ year: 2050, basis: 'official' }, { year: 2020, basis: 'official' }] })])).toBe(false);
  });
});
