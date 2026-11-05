import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '../ai/toolDefs';
import type { TraceItem } from '../ai/client';
import {
  allocationOffers,
  compactJson,
  describeScenario,
  MAX_VALUE_CHARS,
  namesLaterYear,
  makePlaceNames,
  mapTargets,
  prettyJsonView,
  RESULT_DISPLAY_LIMIT,
  MAX_SCENARIO_OFFERS,
  MAX_ALLOCATION_OFFERS,
  clipAtCaret,
  clipCodePoints,
  countCodePoints,
  scenarioOffers,
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

  it('compactJson cuts a very long input at 4,000 characters and says so', () => {
    const big = { text: 'あ'.repeat(5000) };
    const full = JSON.stringify(big);
    expect(compactJson(big)).toBe(`${full.slice(0, 4000)}…（以下省略）`);
    expect(compactJson({ a: 1 })).toBe('{"a":1}');
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
    for (const pad of ['', 'a']) expect(lone.test(compactJson({ text: pad + '𠮷'.repeat(4000) }))).toBe(false);
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

describe('scenarioOffers', () => {
  it('is empty when no input carries a scenario that differs from the default', () => {
    expect(scenarioOffers([])).toEqual([]);
    expect(scenarioOffers([item('get_series', { areaCode: '13' })])).toEqual([]);
    expect(scenarioOffers([item('run_projection', { areaCode: '13', scenario: {} })])).toEqual([]);
    expect(scenarioOffers([item('run_projection', { areaCode: '13', scenario: { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 } })])).toEqual([]);
    expect(scenarioOffers([item('run_projection', { areaCode: '13', scenario: { cwrMult: null } })])).toEqual([]);
  });

  it('returns full scenarios (defaults filled in), in the order the model used them', () => {
    const trace = [
      item('get_series', { areaCode: '13', scenario: {} }),
      item('run_projection', { areaCode: '13', scenario: { cwrMult: 1.2 } }),
      item('facility_check', { areaCode: '30206', year: 2100, scenario: { migMode: 'fade' } }),
    ];
    expect(scenarioOffers(trace)).toEqual([
      { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 },
      { cwrMult: 1, migMode: 'fade', migScale: 1, infraStrength: 0 },
    ]);
  });

  it('lists each distinct scenario once, and at most three', () => {
    const same = [item('run_projection', { areaCode: '13', scenario: { cwrMult: 1.2 } }), item('get_series', { areaCode: '30', scenario: { cwrMult: 1.2, migScale: 1 } })];
    expect(scenarioOffers(same)).toHaveLength(1);
    const many = [0.7, 0.8, 0.9, 1.1, 1.2].map((cwrMult) => item('run_projection', { areaCode: '13', scenario: { cwrMult } }));
    expect(scenarioOffers(many).map((s) => s.cwrMult)).toEqual([0.7, 0.8, 0.9]);
    expect(MAX_SCENARIO_OFFERS).toBe(3);
  });

  it('looks at every tool that takes a scenario, and only those', () => {
    for (const tool of ['run_projection', 'get_series', 'compare_sources', 'facility_check', 'find_similar_now', 'count_areas', 'run_allocation']) {
      expect(scenarioOffers([item(tool, { scenario: { migScale: 0.5 } })]), tool).toEqual([{ cwrMult: 1, migMode: 'hold', migScale: 0.5, infraStrength: 0 }]);
    }
    expect(scenarioOffers([item('find_area', { query: 'x', scenario: { migScale: 0.5 } })])).toEqual([]);
  });

  it('passes an out-of-range value through, so that applying it can be refused with a message', () => {
    expect(scenarioOffers([item('run_projection', { areaCode: '13', scenario: { cwrMult: 9 } })])).toEqual([{ cwrMult: 9, migMode: 'hold', migScale: 1, infraStrength: 0 }]);
  });

  it('ignores unknown scenario keys', () => {
    expect(scenarioOffers([item('run_projection', { areaCode: '13', scenario: { evil: 1 } })])).toEqual([]);
  });
});

describe('describeScenario', () => {
  const base = { cwrMult: 1, migMode: 'hold', migScale: 1, infraStrength: 0 } as const;

  it('names only what differs, in plain words', () => {
    expect(describeScenario({ cwrMult: 1.2, migMode: 'fade', migScale: 0.5, infraStrength: 0.005 })).toBe(
      '子どもの数の倍率 1.2、人口の移動は少しずつ止まる、移動の強さ 0.5、施設の影響 0.005',
    );
    expect(describeScenario(base)).toBe('標準の前提');
  });

  it('shows an invalid value as it is instead of failing', () => {
    expect(describeScenario({ ...base, cwrMult: 9 })).toBe('子どもの数の倍率 9');
  });

  it('keeps small values readable: the infrastructure strength lives in [0, 0.01]', () => {
    expect(describeScenario({ ...base, infraStrength: 0.0025 })).toBe('施設の影響 0.0025');
    expect(describeScenario({ ...base, infraStrength: 0.0004 })).toBe('施設の影響 0.0004');
    expect(describeScenario({ ...base, infraStrength: 0.01 })).toBe('施設の影響 0.01');
  });

  it('never lets a value that differs from the default read as the default', () => {
    expect(describeScenario({ ...base, cwrMult: 1.00000001 })).toBe('子どもの数の倍率 1.00000001');
    expect(describeScenario({ ...base, migScale: 0.99999999 })).toBe('移動の強さ 0.99999999');
    expect(describeScenario({ ...base, infraStrength: 1e-9 })).toBe('施設の影響 1e-9');
  });

  it('never lets an out-of-range value read as an allowed one', () => {
    expect(describeScenario({ ...base, cwrMult: 1.4000001 })).toBe('子どもの数の倍率 1.4000001');
    expect(describeScenario({ ...base, migScale: 1.5000001 })).toBe('移動の強さ 1.5000001');
    expect(describeScenario({ ...base, infraStrength: 0.0100001 })).toBe('施設の影響 0.0100001');
    expect(describeScenario({ ...base, cwrMult: 0.5999999 })).toBe('子どもの数の倍率 0.5999999');
  });

  it('rounds only what is safe to round (four significant digits)', () => {
    expect(describeScenario({ ...base, cwrMult: 1.23456 })).toBe('子どもの数の倍率 1.235');
  });

  describe('values from the model are short and safe to show', () => {
    const hostile = (patch: Record<string, unknown>): string => describeScenario({ ...base, ...patch } as never);
    const NOT_A_NUMBER = '（数ではない値）';

    it('cuts a long value at 24 characters, the last being 「…」, and leaves a 24-character one whole', () => {
      expect(MAX_VALUE_CHARS).toBe(24);
      expect(hostile({ cwrMult: 'x'.repeat(24) })).toBe(`子どもの数の倍率 ${'x'.repeat(24)}`);
      expect(hostile({ cwrMult: 'x'.repeat(25) })).toBe(`子どもの数の倍率 ${'x'.repeat(23)}…`);
      expect(hostile({ migMode: 'あ'.repeat(500) })).toBe(`人口の移動 ${'あ'.repeat(23)}…`);
      expect(hostile({ migScale: 'y'.repeat(100_000) })).toBe(`移動の強さ ${'y'.repeat(23)}…`);
      expect(hostile({ infraStrength: 'z'.repeat(30) })).toBe(`施設の影響 ${'z'.repeat(23)}…`);
    });

    it('counts code points, so an emoji is never cut in half', () => {
      const text = hostile({ cwrMult: '😀'.repeat(40) });
      expect(text).toBe(`子どもの数の倍率 ${'😀'.repeat(23)}…`);
      expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)).toBe(false);
      expect(hostile({ cwrMult: '😀'.repeat(24) })).toBe(`子どもの数の倍率 ${'😀'.repeat(24)}`);
    });

    it('cuts an ordinary but very long number text too', () => {
      expect(hostile({ migScale: 10n ** 60n })).toBe(`移動の強さ ${'1' + '0'.repeat(22)}…`);
    });

    it('never throws on an object, and never calls its toString', () => {
      let called = 0;
      const spy = {
        toString() {
          called++;
          throw new Error('toString was called');
        },
        valueOf() {
          called++;
          throw new Error('valueOf was called');
        },
      };
      for (const value of [Object.create(null), { toString: 1 }, spy, { a: 1 }, [], [1, 2, 3], () => 1, new Date(0)]) {
        const text = hostile({ cwrMult: value, migMode: value, migScale: value, infraStrength: value });
        expect(text).toBe(`子どもの数の倍率 ${NOT_A_NUMBER}、人口の移動 ${NOT_A_NUMBER}、移動の強さ ${NOT_A_NUMBER}、施設の影響 ${NOT_A_NUMBER}`);
      }
      expect(called).toBe(0);
    });

    it('never throws on a symbol, a huge array or a proxy that throws on every touch', () => {
      const trap = new Proxy(
        {},
        new Proxy({}, { get: () => () => { throw new Error('touched'); } }),
      );
      const revoked = Proxy.revocable({}, {});
      revoked.revoke();
      const started = Date.now();
      for (const value of [Symbol('s'), Symbol('d'.repeat(10_000)), new Array(2_000_000).fill(1), trap, revoked.proxy]) {
        expect(hostile({ cwrMult: value })).toBe(`子どもの数の倍率 ${NOT_A_NUMBER}`);
      }
      expect(Date.now() - started).toBeLessThan(1000); // the 2-million-element array was not turned into text
    });

    it('shows null, undefined, booleans and non-finite numbers as short text', () => {
      expect(hostile({ cwrMult: null })).toBe('子どもの数の倍率 null');
      expect(hostile({ cwrMult: undefined })).toBe('子どもの数の倍率 undefined');
      expect(hostile({ migScale: true })).toBe('移動の強さ true');
      expect(hostile({ migScale: Number.NaN })).toBe('移動の強さ NaN');
      expect(hostile({ infraStrength: Number.NEGATIVE_INFINITY })).toBe('施設の影響 -Infinity');
      expect(hostile({ cwrMult: -Number.MAX_VALUE })).toBe('子どもの数の倍率 -1.7976931348623157e+308'); // exactly 24 characters
    });

    it('keeps the whole sentence bounded however hostile the four values are', () => {
      const long = 'q'.repeat(10_000);
      const text = hostile({ cwrMult: long, migMode: long, migScale: long, infraStrength: long });
      expect(text.length).toBeLessThan(150);
    });
  });
});

describe('code points', () => {
  it('counts an emoji or a rare kanji once', () => {
    expect(countCodePoints('あい')).toBe(2);
    expect(countCodePoints('😀𠮷')).toBe(2);
    expect(countCodePoints('')).toBe(0);
  });

  it('clips to a number of code points without cutting a pair in half', () => {
    expect(clipCodePoints('あいう', 2)).toEqual({ text: 'あい', cut: true });
    expect(clipCodePoints('あい', 2)).toEqual({ text: 'あい', cut: false });
    expect(clipCodePoints('😀😀😀', 2)).toEqual({ text: '😀😀', cut: true });
    expect(clipCodePoints('a𠮷b', 2)).toEqual({ text: 'a𠮷', cut: true });
  });
});

describe('clipAtCaret', () => {
  it('leaves text that fits alone, caret included', () => {
    expect(clipAtCaret('あいう', 1, 3)).toEqual({ text: 'あいう', caret: 1, cut: false });
    expect(clipAtCaret('', 0, 3)).toEqual({ text: '', caret: 0, cut: false });
  });

  it('typing at the end drops the typed characters, like cutting the end', () => {
    expect(clipAtCaret('あいうえ', 4, 3)).toEqual({ text: 'あいう', caret: 3, cut: true });
  });

  it('typing in the middle drops the typed excess, not the end, and keeps the caret there', () => {
    // 'あい' + typed 'X' + 'うえ', caret after the X
    expect(clipAtCaret('あいXうえ', 3, 4)).toEqual({ text: 'あいうえ', caret: 2, cut: true });
    // a paste of 3 into the middle with room for 1: the first of the pasted stays
    expect(clipAtCaret('あいXYZうえ', 5, 5)).toEqual({ text: 'あいXうえ', caret: 3, cut: true });
  });

  it('typing at the very start drops what was typed', () => {
    expect(clipAtCaret('Xあいう', 1, 3)).toEqual({ text: 'あいう', caret: 0, cut: true });
  });

  it('takes the rest from the end when fewer than the excess sit before the caret', () => {
    expect(clipAtCaret('Xあいうえお', 1, 3)).toEqual({ text: 'あいう', caret: 0, cut: true });
    expect(clipAtCaret('あいうえお', 0, 3)).toEqual({ text: 'あいう', caret: 0, cut: true });
  });

  it('counts code points and never cuts a pair in half; the caret is a UTF-16 offset', () => {
    // 😀😀 + typed 𠮷 + 😀 with room for 3: the typed one (2 units) goes, the caret is after the first two (4 units)
    expect(clipAtCaret('😀😀𠮷😀', 6, 3)).toEqual({ text: '😀😀😀', caret: 4, cut: true });
    const clipped = clipAtCaret('😀😀𠮷😀', 6, 3).text;
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(clipped)).toBe(false);
  });

  it('a caret outside the text is treated as the nearest end', () => {
    expect(clipAtCaret('あいうえ', 99, 3)).toEqual({ text: 'あいう', caret: 3, cut: true });
    expect(clipAtCaret('あいうえ', -1, 3)).toEqual({ text: 'あいう', caret: 0, cut: true });
  });
});

describe('namesLaterYear', () => {
  it.each([
    '2051年には',
    '2100年には、日本の人口は約5,432万人になります。',
    '2060年と2100年を比べます。',
    '2051-2100',
    '2040〜2100年',
    '2100/1/1',
    '2100-12-31',
    '西暦2075',
    'In 2100, the population falls.',
    '2100，日本の人口は減ります。',
    '2020,2100の二つの年',
    '2051、2060、2100',
  ])('names a year after 2050: %s', (text) => {
    expect(namesLaterYear(text)).toBe(true);
  });

  it.each([
    ['2100年代', '2100年代 is a decade of the 2100s'],
    ['2060年代', '2060年代'],
    ['2050年代', '2050年代 is 2050 to 2059, and 2051 to 2059 are estimates'],
    ['２１００年', 'full-width digits'],
    ['２０５１年', 'full-width digits'],
    ['2150年ごろ', 'beyond the app, with 年 after it'],
    ['2999年', 'the largest year read as one'],
    ['2100人', 'a count that looks like a year is labelled too: one extra label is the cost of never missing a year'],
    ['2100.5万人', 'a decimal that starts like a year'],
    ['2100%', 'a percent that looks like a year'],
    ['約2100', 'a bare four-digit number in range'],
    ['1,2100', 'a comma before four digits is not a thousands group, so it may be a list of years'],
    ['2100,50', 'a comma with fewer than three digits after it is not a thousands group'],
  ])('labels when in doubt: %s (%s)', (text) => {
    expect(namesLaterYear(text)).toBe(true);
  });

  it.each([
    ['2050年', '2050 is official'],
    ['2020年と2050年', 'official years'],
    ['2040年には、約5,432万人です。', 'before 2051'],
    ['1900年から2025年', 'the past'],
    ['12100人', 'the digits of a longer number'],
    ['12,100人', 'a number with a thousands comma'],
    ['2,100人', 'a number with a thousands comma'],
    ['3.2100', 'the decimals of a number'],
    ['2100,000人', 'a comma with three digits after it is a thousands group'],
    ['2100，000人', 'the same with a full-width comma'],
    ['２１００，０００人', 'the same, full-width digits too'],
    ['１２１００', 'a longer full-width number'],
    ['21000', 'five digits'],
    ['2101', 'beyond 2100 and no 年: more likely a count'],
    ['3000人', 'a count'],
    ['', 'nothing'],
    ['人口は減ります。', 'no digits'],
  ])('does not name one: %s (%s)', (text) => {
    expect(namesLaterYear(text)).toBe(false);
  });

  it('finds a later year anywhere in a text that also has earlier ones and longer numbers', () => {
    expect(namesLaterYear('2020年は12,100人、2050年は12100人、2100年は9,000人です。')).toBe(true);
    expect(namesLaterYear('2020年は12,100人、2050年は12100人です。')).toBe(false);
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

describe('allocationOffers', () => {
  const wakayama = { target: { kind: 'pref', code: '30' }, deltaPercent: 10, year: 2100 };
  it('lists the inputs of run_allocation calls that returned a result, in order, each once, at most three', () => {
    expect(allocationOffers([])).toEqual([]);
    expect(allocationOffers([item('run_projection', wakayama)])).toEqual([]);
    const tokyo = { target: { kind: 'pref', code: '13' }, deltaPercent: -5, year: 2100 };
    expect(allocationOffers([item('run_allocation', wakayama, { ok: 1 }), item('run_allocation', tokyo, { ok: 1 })])).toEqual([wakayama, tokyo]);
    expect(allocationOffers([item('run_allocation', wakayama), item('run_allocation', { ...wakayama })])).toEqual([wakayama]);
    const many = [1, 2, 3, 4, 5].map((deltaPercent) => item('run_allocation', { ...wakayama, deltaPercent }));
    expect(allocationOffers(many).map((i) => (i as { deltaPercent: number }).deltaPercent)).toEqual([1, 2, 3]);
    expect(MAX_ALLOCATION_OFFERS).toBe(3);
  });

  it('skips calls the tool refused (their result carries an error), since there is nothing to draw', () => {
    const refused = item('run_allocation', { ...wakayama, deltaPercent: -200 }, { error: 'allocation_not_possible', message: 'x' });
    expect(allocationOffers([refused])).toEqual([]);
    expect(allocationOffers([refused, item('run_allocation', wakayama)])).toEqual([wakayama]);
  });
});
