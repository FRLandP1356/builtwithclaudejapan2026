import { describe, expect, test } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { SCENARIO_LIMITS } from '../data/runner';
import { total } from '../engine/aggregate';
import { projectAll } from '../engine/project';
import { DEFAULT_SCENARIO, type Scenario } from '../engine/types';
import {
  approxPeople,
  BAR_MARKS,
  birthBlock,
  infraBlock,
  INFRA_LABELS,
  type BarMark,
  marksIntro,
  MARKS_YEAR,
  migModeBlock,
  migrationBlock,
  MIG_MODE_LABELS,
  multiplierText,
  reachSentence,
} from './barMarks';
import { INFRA_STRENGTH } from './controls';

// -----------------------------------------------------------------------------------------------------------------
// The stored marks against the engine on the real data (1,884 areas, 48 facilities).
// -----------------------------------------------------------------------------------------------------------------
const areas = loadAllAreas();
const facilities = loadFacilities();

/** The national total in `year`: the sum over all areas of one scenario, in whole people (as the app sums it). */
function nationalPeople(s: Scenario, year: number): number {
  let sum = 0;
  for (const series of projectAll(areas, s, 2100, facilities).values()) sum += total(series[year]);
  return Math.round(sum);
}

describe('the stored marks are what the engine gives (real data)', () => {
  test('the totals of 2020 and 2050', () => {
    expect(nationalPeople(DEFAULT_SCENARIO, 2020)).toBe(BAR_MARKS.total2020);
    expect(nationalPeople(DEFAULT_SCENARIO, 2050)).toBe(BAR_MARKS.total2050);
  });

  test('2050 is the same under the most extreme scenario (the marks compare with one 2050 figure)', () => {
    const extreme: Scenario = { cwrMult: 1.4, migMode: 'fade', migScale: 1.5, infraStrength: 0.01 };
    expect(nationalPeople(extreme, 2050)).toBe(BAR_MARKS.total2050);
    expect(nationalPeople({ ...extreme, cwrMult: 0.6, migScale: 0 }, 2050)).toBe(BAR_MARKS.total2050);
  });

  test('the birth bar: each mark is the 2100 total at its cwrMult, everything else at the default', () => {
    for (const m of BAR_MARKS.birth) expect(nationalPeople({ ...DEFAULT_SCENARIO, cwrMult: m.value }, MARKS_YEAR), `x${m.value}`).toBe(m.people);
  });

  test('the migration bar: each mark is the 2100 total at its migScale (migration held)', () => {
    for (const m of BAR_MARKS.migration) expect(nationalPeople({ ...DEFAULT_SCENARIO, migScale: m.value }, MARKS_YEAR), `x${m.value}`).toBe(m.people);
  });

  test("the migration mode: 'fade' at the default strength", () => {
    expect(nationalPeople({ ...DEFAULT_SCENARIO, migMode: 'fade' }, MARKS_YEAR)).toBe(BAR_MARKS.migFade);
  });

  test('the three infrastructure presets, with the facility table and the strengths the buttons use', () => {
    for (const k of ['none', 'weak', 'strong'] as const) {
      expect(nationalPeople({ ...DEFAULT_SCENARIO, infraStrength: INFRA_STRENGTH[k] }, MARKS_YEAR), k).toBe(BAR_MARKS.infra[k]);
    }
  });

  test('the bars span exactly the slider limits and the middle mark is the default', () => {
    const first = (m: readonly BarMark[]) => m[0].value;
    const last = (m: readonly BarMark[]) => m[m.length - 1].value;
    expect(BAR_MARKS.birth).toHaveLength(3);
    expect(BAR_MARKS.migration).toHaveLength(3);
    expect([first(BAR_MARKS.birth), last(BAR_MARKS.birth)]).toEqual([...SCENARIO_LIMITS.cwrMult]);
    expect([first(BAR_MARKS.migration), last(BAR_MARKS.migration)]).toEqual([...SCENARIO_LIMITS.migScale]);
    expect(BAR_MARKS.birth[1].value).toBe(DEFAULT_SCENARIO.cwrMult);
    expect(BAR_MARKS.migration[1].value).toBe(DEFAULT_SCENARIO.migScale);
  });

  test('the default is one number everywhere it is shown: bar middles, "none" and the "continue" mode', () => {
    const base = nationalPeople(DEFAULT_SCENARIO, MARKS_YEAR);
    expect(BAR_MARKS.birth[1].people).toBe(base);
    expect(BAR_MARKS.migration[1].people).toBe(base);
    expect(BAR_MARKS.infra.none).toBe(base);
  });

  test('every mark lies on its slider (the step is 0.05 for the birth bar and 0.1 for migration)', () => {
    for (const m of BAR_MARKS.birth) expect(Math.abs((m.value - SCENARIO_LIMITS.cwrMult[0]) / 0.05 - Math.round((m.value - SCENARIO_LIMITS.cwrMult[0]) / 0.05))).toBeLessThan(1e-9);
    for (const m of BAR_MARKS.migration) expect(Math.abs(m.value / 0.1 - Math.round(m.value / 0.1))).toBeLessThan(1e-9);
  });

  test('the right end is the highest mark of each bar (so "even at the right end" is true), and the marks rise left to right', () => {
    for (const marks of [BAR_MARKS.birth, BAR_MARKS.migration]) {
      expect(marks.map((m) => m.people)).toEqual([...marks.map((m) => m.people)].sort((a, b) => a - b));
    }
  });

  test('what the sentences say about the real data: both bars end below 2050', () => {
    expect(BAR_MARKS.birth[2].people).toBeLessThan(BAR_MARKS.total2050);
    expect(BAR_MARKS.migration[2].people).toBeLessThan(BAR_MARKS.total2050);
    expect(birthBlock(DEFAULT_SCENARIO.cwrMult).fact).toBe('この範囲の右端（×1.4）でも、2100年の日本全体は2050年（1億469万人）に届きません。');
    expect(migrationBlock(DEFAULT_SCENARIO.migScale).fact).toBe('この範囲の右端（×1.5）でも、2100年の日本全体は2050年（1億469万人）に届きません。');
  });
});

// -----------------------------------------------------------------------------------------------------------------
// The wording.
// -----------------------------------------------------------------------------------------------------------------
describe('multiplierText', () => {
  test('one decimal on the steps, two off them', () => {
    expect(multiplierText(0.6)).toBe('×0.6');
    expect(multiplierText(1)).toBe('×1.0');
    expect(multiplierText(1.4)).toBe('×1.4');
    expect(multiplierText(0)).toBe('×0.0');
    expect(multiplierText(0.55)).toBe('×0.55');
    expect(multiplierText(1.25)).toBe('×1.25');
  });
});

describe('approxPeople', () => {
  test('marks a national total as approximate, in the app\'s own notation', () => {
    expect(approxPeople(63279524)).toBe('約6,328万人');
    expect(approxPeople(50094492)).toBe('約5,009万人');
    expect(approxPeople(104686401)).toBe('約1億469万人');
  });
});

describe('reachSentence', () => {
  const marks = (...people: number[]): BarMark[] => people.map((p, i) => ({ value: [0.6, 1, 1.4][i], people: p }));

  test('the right end below 2050: says it does not reach, with "even"', () => {
    expect(reachSentence(marks(50e6, 63e6, 79e6), 104686401)).toBe(
      'この範囲の右端（×1.4）でも、2100年の日本全体は2050年（1億469万人）に届きません。',
    );
  });

  test('the right end above 2050: says it reaches, without "even"', () => {
    expect(reachSentence(marks(50e6, 63e6, 120e6), 104686401)).toBe(
      'この範囲の右端（×1.4）では、2100年の日本全体は2050年（1億469万人）に届きます。',
    );
  });

  test('exactly the 2050 total counts as reaching; one person less does not (whole people, not the rounded 万人)', () => {
    expect(reachSentence(marks(50e6, 63e6, 104686401), 104686401)).toContain('に届きます');
    expect(reachSentence(marks(50e6, 63e6, 104686400), 104686401)).toContain('に届きません');
    // 104,686,400 and 104,686,401 both show as 1億469万人, yet the sentence tells them apart
    expect(reachSentence(marks(50e6, 63e6, 104686400), 104686401)).toContain('1億469万人');
  });

  test('"even" is written only when the right end is the bar\'s highest mark', () => {
    expect(reachSentence(marks(50e6, 80e6, 70e6), 104686401)).toBe(
      'この範囲の右端（×1.4）では、2100年の日本全体は2050年（1億469万人）に届きません。',
    );
    expect(reachSentence(marks(50e6, 70e6, 70e6), 104686401)).toContain('でも');
  });

  test('the figure and the end value come from the arguments, not from fixed text', () => {
    expect(reachSentence([{ value: 1.5, people: 1 }, { value: 2.25, people: 9e7 }], 95000000)).toBe(
      'この範囲の右端（×2.25）でも、2100年の日本全体は2050年（9,500万人）に届きません。',
    );
  });
});

describe('the blocks printed under the controls', () => {
  test('birth bar', () => {
    expect(birthBlock(1)).toEqual({
      id: 'ctl-cwr-marks',
      title: 'ほかの前提が初期値のときの、2100年の日本全体',
      rows: [
        { at: '×0.6', people: '約5,009万人' },
        { at: '×1.0（初期値）', people: '約6,328万人' },
        { at: '×1.4', people: '約7,931万人' },
      ],
      fact: 'この範囲の右端（×1.4）でも、2100年の日本全体は2050年（1億469万人）に届きません。',
    });
  });

  test('migration strength bar', () => {
    expect(migrationBlock(1)).toEqual({
      id: 'ctl-migscale-marks',
      title: 'ほかの前提が初期値のときの、2100年の日本全体',
      rows: [
        { at: '×0.0', people: '約5,407万人' },
        { at: '×1.0（初期値）', people: '約6,328万人' },
        { at: '×1.5', people: '約6,935万人' },
      ],
      fact: 'この範囲の右端（×1.5）でも、2100年の日本全体は2050年（1億469万人）に届きません。',
    });
  });

  test('the "default" tag follows the default value passed in, not the position', () => {
    expect(birthBlock(1.4).rows.map((r) => r.at)).toEqual(['×0.6', '×1.0', '×1.4（初期値）']);
    expect(migrationBlock(0).rows.map((r) => r.at)).toEqual(['×0.0（初期値）', '×1.0', '×1.5']);
  });

  test('migration mode buttons', () => {
    expect(migModeBlock()).toEqual({
      id: 'ctl-migmode-marks',
      title: 'ほかの前提が初期値のときの、2100年の日本全体',
      rows: [
        { at: '2050年ごろの傾向を続ける', people: '約6,328万人' },
        { at: '2100年に向けて少しずつ止まる', people: '約5,852万人' },
      ],
    });
    expect(MIG_MODE_LABELS).toEqual({ hold: '2050年ごろの傾向を続ける', fade: '2100年に向けて少しずつ止まる' });
  });

  test('infrastructure presets: the assumption\'s own arithmetic, said so, with no measured effect claimed', () => {
    const b = infraBlock();
    expect(b).toEqual({
      id: 'ctl-infra-marks',
      title: '仮定どおりに計算した、2100年の日本全体（ほかの前提は初期値）',
      rows: [
        { at: 'なし', people: '約6,328万人' },
        { at: '弱い', people: '約6,320万人' },
        { at: '強い', people: '約6,308万人' },
      ],
    });
    expect(b.fact).toBeUndefined();
    expect(INFRA_LABELS).toEqual({ none: 'なし', weak: '弱い', strong: '強い' });
  });

  test('the intro names the two fixed points and the estimate', () => {
    expect(marksIntro()).toBe(
      'どのつまみやボタンの下にも、その位置にしたときの2100年の日本全体の人口（このアプリの試算）を載せています。' +
        '参考：2020年は1億2,615万人（国勢調査）、2050年は1億469万人（公式推計）です。',
    );
  });

  test('no wording says 予測, 残せない or 閉鎖, gives advice, or judges a value; no arrow or circled number', () => {
    const all = [birthBlock(1), migrationBlock(1), migModeBlock(), infraBlock()]
      .flatMap((b) => [b.title, b.fact ?? '', ...b.rows.flatMap((r) => [r.at, r.people])])
      .concat(marksIntro())
      .join('\n');
    for (const w of ['予測', '残せない', '閉鎖', 'すべき', 'おすすめ', 'お勧め', '良い', '悪い', '十分', '不十分', '→', '▲', '▼']) expect(all).not.toContain(w);
    expect(all).not.toMatch(/[①-⑳]/);
  });
});
