// Guidance marks for the assumption controls: "with the bar here, Japan's 2100 population is about ...".
//
// The marks are DATA computed once with the app's own engine (all 1,884 areas under one scenario, the other
// assumptions at their defaults, the 48-row facility table for the infrastructure presets) and stored here, so the
// panel never runs the engine just to print a guide. barMarks.test.ts recomputes every number with the engine and
// fails if a bar limit, a default, a preset strength or the engine itself changes: a stale mark cannot ship.
//
// Nothing here is measured outside the app. Every number is the app's 試算 for 2100, and the infrastructure
// presets are shown as what the stated assumption calculates, not as an observed effect.
import { formatPop } from './format';

/** The year every mark describes. */
export const MARKS_YEAR = 2100;

/** One position of a bar and the national total (people, rounded to a whole person) the engine gives there. */
export interface BarMark {
  readonly value: number;
  readonly people: number;
}

export const BAR_MARKS = {
  /** Sum over all areas in 2020 (the census base) and in 2050 (the last official year). Every scenario shares 2050. */
  total2020: 126146099,
  total2050: 104686401,
  /** `cwrMult` at the bar's minimum, the default and the maximum (left to right). */
  birth: [
    { value: 0.6, people: 50094492 },
    { value: 1, people: 63279524 },
    { value: 1.4, people: 79311417 },
  ],
  /** `migScale` at the bar's minimum, the default and the maximum (left to right), migration held. */
  migration: [
    { value: 0, people: 54069025 },
    { value: 1, people: 63279524 },
    { value: 1.5, people: 69348835 },
  ],
  /** `migMode` 'fade' at the default strength; 'hold' is the default and equals `migration[1]`. */
  migFade: 58516111,
  /** The three infrastructure presets (strengths are INFRA_STRENGTH in controls.ts). */
  infra: { none: 63279524, weak: 63195651, strong: 63076550 },
} as const satisfies {
  total2020: number;
  total2050: number;
  birth: readonly BarMark[];
  migration: readonly BarMark[];
  migFade: number;
  infra: { none: number; weak: number; strong: number };
};

/** Labels of the migration mode buttons (the same text the buttons carry; controls.test.ts checks they agree). */
export const MIG_MODE_LABELS = {
  hold: '2050年ごろの傾向を続ける',
  fade: '2100年に向けて少しずつ止まる',
} as const;

/** Labels of the infrastructure preset buttons. */
export const INFRA_LABELS = { none: 'なし', weak: '弱い', strong: '強い' } as const;

/** "×0.6" / "×1.0" / "×0.0"; one decimal on the bars' steps, two when a value is off them. */
export function multiplierText(v: number): string {
  const onTenth = Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
  return `×${onTenth ? v.toFixed(1) : v.toFixed(2)}`;
}

/** "約6,328万人": a national total as the rest of the app writes it, marked as approximate. */
export function approxPeople(n: number): string {
  return `約${formatPop(n)}`;
}

/**
 * The one derived fact of a bar, built from its numbers (never a fixed sentence): whether the bar's right end reaches
 * the 2050 total. "でも" (even at the right end) is only written when the right end really is the bar's highest mark.
 * Compares whole people, not the rounded 万人 shown.
 */
export function reachSentence(marks: readonly BarMark[], total2050: number): string {
  const end = marks[marks.length - 1];
  const highest = marks.every((m) => end.people >= m.people);
  const reaches = end.people >= total2050;
  const head = `この範囲の右端（${multiplierText(end.value)}）${highest && !reaches ? 'でも' : 'では'}`;
  return `${head}、${MARKS_YEAR}年の日本全体は2050年（${formatPop(total2050)}）に${reaches ? '届きます' : '届きません'}。`;
}

/** What the panel prints under a control. `rows` read left to right in the order of the bar or the buttons. */
export interface MarksBlock {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly { readonly at: string; readonly people: string }[];
  readonly fact?: string;
}

const TITLE = `ほかの前提が初期値のときの、${MARKS_YEAR}年の日本全体`;
const INFRA_TITLE = `仮定どおりに計算した、${MARKS_YEAR}年の日本全体（ほかの前提は初期値）`;

function barRows(marks: readonly BarMark[], defaultValue: number): MarksBlock['rows'] {
  return marks.map((m) => ({
    at: m.value === defaultValue ? `${multiplierText(m.value)}（初期値）` : multiplierText(m.value),
    people: approxPeople(m.people),
  }));
}

/** The birth bar. `defaultValue` is the bar's default (DEFAULT_SCENARIO.cwrMult). */
export function birthBlock(defaultValue: number): MarksBlock {
  return {
    id: 'ctl-cwr-marks',
    title: TITLE,
    rows: barRows(BAR_MARKS.birth, defaultValue),
    fact: reachSentence(BAR_MARKS.birth, BAR_MARKS.total2050),
  };
}

/** The migration strength bar. `defaultValue` is DEFAULT_SCENARIO.migScale. */
export function migrationBlock(defaultValue: number): MarksBlock {
  return {
    id: 'ctl-migscale-marks',
    title: TITLE,
    rows: barRows(BAR_MARKS.migration, defaultValue),
    fact: reachSentence(BAR_MARKS.migration, BAR_MARKS.total2050),
  };
}

/** The two migration mode buttons (strength at its default). */
export function migModeBlock(): MarksBlock {
  return {
    id: 'ctl-migmode-marks',
    title: TITLE,
    rows: [
      { at: MIG_MODE_LABELS.hold, people: approxPeople(BAR_MARKS.migration[1].people) },
      { at: MIG_MODE_LABELS.fade, people: approxPeople(BAR_MARKS.migFade) },
    ],
  };
}

/** The three infrastructure presets: what the assumption calculates, not a measured effect. */
export function infraBlock(): MarksBlock {
  return {
    id: 'ctl-infra-marks',
    title: INFRA_TITLE,
    rows: (['none', 'weak', 'strong'] as const).map((k) => ({ at: INFRA_LABELS[k], people: approxPeople(BAR_MARKS.infra[k]) })),
  };
}

/** The line above the three groups: what the numbers under the controls are, and two fixed points to read them by. */
export function marksIntro(): string {
  return (
    `どのつまみやボタンの下にも、その位置にしたときの${MARKS_YEAR}年の日本全体の人口（このアプリの試算）を載せています。` +
    `参考：2020年は${formatPop(BAR_MARKS.total2020)}（国勢調査）、2050年は${formatPop(BAR_MARKS.total2050)}（公式推計）です。`
  );
}
