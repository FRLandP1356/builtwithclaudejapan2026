// Pure helpers for the AI panel: how a tool call is named and shown, which places and which scenario an answer's tool
// calls point at. No DOM, no store; the panel (aiPanel.ts) turns these into buttons and text.
import type { TraceItem } from '../ai/client';
import { SCENARIO_LIMITS } from '../data/runner';
import { DEFAULT_SCENARIO } from '../engine/types';
import type { Scenario } from '../engine/types';
import { OFFICIAL_END_YEAR } from './sources';

// ---------------------------------------------------------------------------------------------------------------
// Tool names
// ---------------------------------------------------------------------------------------------------------------

/** What each tool is called on screen. A test checks every tool in src/ai/toolDefs.ts has one. */
export const TOOL_LABELS: Readonly<Record<string, string>> = {
  find_area: '地域をさがす',
  get_series: '人口の推移を取る',
  compare_sources: '公式と試算を比べる',
  run_projection: '前提を変えて計算する',
  facility_check: '施設の目安を調べる',
  run_allocation: '人口の割り振りを計算する',
  find_similar_now: '似た町をさがす',
  count_areas: '町の数を数える',
};

/** The Japanese label of a tool; a name that is not one of ours is shown as plain text inside a generic label. */
export function toolLabel(name: string): string {
  return Object.hasOwn(TOOL_LABELS, name) ? TOOL_LABELS[name]! : `道具（${name}）`;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON display
// ---------------------------------------------------------------------------------------------------------------

export const RESULT_DISPLAY_LIMIT = 4000;
const TRUNCATION_NOTE = '…（以下省略）';
const NOT_SHOWABLE = '（表示できません）';

/** `text` cut at `limit` characters (never inside a surrogate pair) with a note, or as it is when it is short enough. */
function cutForDisplay(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  let end = limit;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not leave half of a surrogate pair at the cut
  return { text: text.slice(0, end) + TRUNCATION_NOTE, truncated: true };
}

/** The value as JSON on one line, cut at `limit` characters like a result. Never throws. */
export function compactJson(value: unknown, limit: number = RESULT_DISPLAY_LIMIT): string {
  try {
    return cutForDisplay(JSON.stringify(value) ?? 'null', limit).text;
  } catch {
    return NOT_SHOWABLE;
  }
}

export interface JsonView {
  /** What to show: the pretty JSON, cut at `limit` characters with a note when longer. */
  text: string;
  /** The whole pretty JSON, for copying. */
  full: string;
  truncated: boolean;
}

export function prettyJsonView(value: unknown, limit: number = RESULT_DISPLAY_LIMIT): JsonView {
  let full: string;
  try {
    full = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    return { text: NOT_SHOWABLE, full: NOT_SHOWABLE, truncated: false };
  }
  const cut = cutForDisplay(full, limit);
  return { text: cut.text, full, truncated: cut.truncated };
}

// ---------------------------------------------------------------------------------------------------------------
// Length of a question: in code points, so an emoji or a rare kanji counts once
// ---------------------------------------------------------------------------------------------------------------

export function countCodePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/** The first `max` code points of `text` (a pair is never cut in half), and whether anything was cut. */
export function clipCodePoints(text: string, max: number): { text: string; cut: boolean } {
  const points = Array.from(text);
  return points.length > max ? { text: points.slice(0, max).join(''), cut: true } : { text, cut: false };
}

// ---------------------------------------------------------------------------------------------------------------
// Places named in the tool inputs
// ---------------------------------------------------------------------------------------------------------------

export interface PlaceNames {
  /** `ambiguous` is true when another area has the same name (then the label adds the prefecture). */
  area(code: string): { name: string; prefName: string; ambiguous: boolean } | undefined;
  pref(code: string): string | undefined;
}

export function makePlaceNames(
  areas: ReadonlyArray<{ code: string; name: string; prefName: string }>,
  prefNames: ReadonlyMap<string, string>,
): PlaceNames {
  const byCode = new Map(areas.map((a) => [a.code, a]));
  const count = new Map<string, number>();
  for (const a of areas) count.set(a.name, (count.get(a.name) ?? 0) + 1);
  return {
    area(code) {
      const a = byCode.get(code);
      return a ? { name: a.name, prefName: a.prefName, ambiguous: (count.get(a.name) ?? 0) > 1 } : undefined;
    },
    pref: (code) => prefNames.get(code),
  };
}

export interface MapTarget {
  kind: 'area' | 'pref';
  code: string;
  name: string;
  /** The button's place name: the name, with the prefecture added when two areas share it. */
  label: string;
}

export const MAX_MAP_LINKS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The code-like strings a tool input names, in a fixed order: areaCode, prefCode, target.code, prefCodes. */
function codesIn(input: unknown): string[] {
  if (!isRecord(input)) return [];
  const raw: unknown[] = [input.areaCode, input.prefCode];
  if (isRecord(input.target)) raw.push(input.target.code);
  if (Array.isArray(input.prefCodes)) raw.push(...input.prefCodes);
  return raw.filter((c): c is string => typeof c === 'string').map((c) => c.trim());
}

/**
 * Up to three distinct places (5-digit areas or 2-digit prefectures the app has) that the tool inputs point at, in
 * the order the model used them. Japan ("00"), designated-city codes and anything unknown are not offered.
 */
export function mapTargets(trace: TraceItem[], places: PlaceNames, max: number = MAX_MAP_LINKS): MapTarget[] {
  const out: MapTarget[] = [];
  const seen = new Set<string>();
  for (const traceItem of trace) {
    for (const code of codesIn(traceItem.input)) {
      if (out.length >= max) return out;
      if (seen.has(code)) continue;
      if (/^\d{5}$/.test(code)) {
        const area = places.area(code);
        if (!area) continue;
        seen.add(code);
        out.push({ kind: 'area', code, name: area.name, label: area.ambiguous ? `${area.name}（${area.prefName}）` : area.name });
      } else if (/^\d{2}$/.test(code)) {
        const name = places.pref(code);
        if (name === undefined) continue;
        seen.add(code);
        out.push({ kind: 'pref', code, name, label: name });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// The scenario an answer was computed under
// ---------------------------------------------------------------------------------------------------------------

const SCENARIO_TOOLS = new Set(['run_projection', 'get_series', 'compare_sources', 'facility_check', 'find_similar_now', 'count_areas', 'run_allocation']);
const SCENARIO_KEYS = ['cwrMult', 'migMode', 'migScale', 'infraStrength'] as const;
export const MAX_SCENARIO_OFFERS = 3;

/**
 * The distinct scenarios, at most three, that tool inputs in the trace carry and that differ from the default, in the
 * order the model used them, each as a full scenario (defaults filled in). Values are passed through unchecked:
 * applying one goes through sanitizeScenario, which refuses what is out of range (Ruling 21), so a rejected scenario
 * can be explained on screen.
 */
export function scenarioOffers(trace: TraceItem[], max: number = MAX_SCENARIO_OFFERS): Scenario[] {
  const out: Scenario[] = [];
  const seen = new Set<string>();
  for (const traceItem of trace) {
    if (out.length >= max) break;
    if (!SCENARIO_TOOLS.has(traceItem.tool) || !isRecord(traceItem.input) || !isRecord(traceItem.input.scenario)) continue;
    const raw = traceItem.input.scenario;
    const merged: Record<string, unknown> = { ...DEFAULT_SCENARIO };
    for (const key of SCENARIO_KEYS) {
      if (raw[key] !== undefined && raw[key] !== null) merged[key] = raw[key];
    }
    if (SCENARIO_KEYS.every((key) => Object.is(merged[key], DEFAULT_SCENARIO[key]))) continue;
    const id = JSON.stringify(SCENARIO_KEYS.map((key) => merged[key]));
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(merged as unknown as Scenario);
  }
  return out;
}

/** The longest a single value from the model is shown in a summary, in characters (the last one is 「…」 when it was cut). */
export const MAX_VALUE_CHARS = 24;
/** What stands in for a value that is not text or a number (an object, a list, a function): it is not read at all. */
const NOT_A_NUMBER = '（数ではない値）';

/** `text` as at most MAX_VALUE_CHARS code points, ending in 「…」 when it was cut. A pair is never cut in half. */
function clipValue(text: string): string {
  const points = Array.from(text);
  return points.length <= MAX_VALUE_CHARS ? text : `${points.slice(0, MAX_VALUE_CHARS - 1).join('')}…`;
}

/**
 * A value that came from the model, as short text that is safe to build a sentence from. Never throws: an object (or a
 * list, a function, a symbol) is not turned into text at all, so a missing or hostile toString, a huge array or a proxy
 * cannot get in the way; text and numbers longer than MAX_VALUE_CHARS are cut.
 */
function plain(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return clipValue(value);
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return clipValue(String(value));
    case 'object':
      return value === null ? 'null' : NOT_A_NUMBER;
    default:
      return NOT_A_NUMBER;
  }
}

/**
 * A number for the summary: four significant digits, unless rounding would change what it means, that is, make a
 * value that differs from the default read as the default, or an out-of-range value read as an allowed one. Then the
 * number is shown as it is. Anything that is not a finite number is shown as plain() shows it.
 */
function show(key: 'cwrMult' | 'migScale' | 'infraStrength', value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return plain(value);
  const rounded = Number(value.toPrecision(4));
  if (rounded === value || !Number.isFinite(rounded)) return plain(value); // rounding a huge number can overflow
  const [low, high] = SCENARIO_LIMITS[key];
  const inRange = (x: number): boolean => x >= low && x <= high;
  return plain(rounded === DEFAULT_SCENARIO[key] || inRange(rounded) !== inRange(value) ? value : rounded);
}

/** The scenario in plain words: only what differs from the default. A value from the model is shown at most MAX_VALUE_CHARS long. */
export function describeScenario(s: Scenario): string {
  const parts: string[] = [];
  if (!Object.is(s.cwrMult, DEFAULT_SCENARIO.cwrMult)) parts.push(`子どもの数の倍率 ${show('cwrMult', s.cwrMult)}`);
  if (!Object.is(s.migMode, DEFAULT_SCENARIO.migMode)) parts.push(s.migMode === 'fade' ? '人口の移動は少しずつ止まる' : `人口の移動 ${plain(s.migMode)}`);
  if (!Object.is(s.migScale, DEFAULT_SCENARIO.migScale)) parts.push(`移動の強さ ${show('migScale', s.migScale)}`);
  if (!Object.is(s.infraStrength, DEFAULT_SCENARIO.infraStrength)) parts.push(`施設の影響 ${show('infraStrength', s.infraStrength)}`);
  return parts.length === 0 ? '標準の前提' : parts.join('、');
}

// ---------------------------------------------------------------------------------------------------------------
// Estimate marker
// ---------------------------------------------------------------------------------------------------------------

const MAX_WALK_NODES = 50_000;

// ---------------------------------------------------------------------------------------------------------------
// Allocations an answer computed (offered for the map)
// ---------------------------------------------------------------------------------------------------------------

export const MAX_ALLOCATION_OFFERS = 3;

/**
 * The distinct inputs, at most three, of the run_allocation calls in the trace whose result is not an error, in the
 * order the model made them. Only the INPUT is returned: the map recomputes the allocation from it locally (and
 * validates it again), so nothing the model wrote reaches the screen except as text.
 */
export function allocationOffers(trace: TraceItem[], max: number = MAX_ALLOCATION_OFFERS): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const traceItem of trace) {
    if (out.length >= max) break;
    if (traceItem.tool !== 'run_allocation') continue;
    if (isRecord(traceItem.result) && 'error' in traceItem.result) continue;
    let id: string;
    try {
      id = JSON.stringify(traceItem.input) ?? '';
    } catch {
      continue; // not plain data: nothing to recompute from
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(traceItem.input);
  }
  return out;
}

/** True when a tool result is marked as this app's estimate (basis 'app_estimate') or reaches a year after 2050. */
export function traceUsesEstimate(trace: TraceItem[]): boolean {
  let budget = MAX_WALK_NODES;
  const stack: unknown[] = trace.map((t) => t.result);
  while (stack.length > 0 && budget-- > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (isRecord(node)) {
      if (node.basis === 'app_estimate') return true;
      for (const key of ['year', 'requestedYear']) {
        const y = node[key];
        if (typeof y === 'number' && y > OFFICIAL_END_YEAR) return true;
      }
      stack.push(...Object.values(node));
    }
  }
  return false;
}
