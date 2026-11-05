// Pure helpers for the AI panel: how a tool call is named and shown, which places and which scenario an answer's tool
// calls point at. No DOM, no store; the panel (aiPanel.ts) turns these into buttons and text.
import type { TraceItem } from '../ai/client';
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

/** The value as JSON on one line. Never throws. */
export function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
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
  if (full.length <= limit) return { text: full, full, truncated: false };
  let end = limit;
  const last = full.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not leave half of a surrogate pair at the cut
  return { text: full.slice(0, end) + TRUNCATION_NOTE, full, truncated: true };
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

/**
 * The scenario of the first tool call in the trace whose input carries one that differs from the default, as a full
 * scenario (defaults filled in), or null. Values are passed through unchecked: applying it goes through
 * sanitizeScenario, which refuses what is out of range (Ruling 21), so a rejected scenario can be explained on screen.
 */
export function scenarioOffer(trace: TraceItem[]): Scenario | null {
  for (const traceItem of trace) {
    if (!SCENARIO_TOOLS.has(traceItem.tool) || !isRecord(traceItem.input) || !isRecord(traceItem.input.scenario)) continue;
    const raw = traceItem.input.scenario;
    const merged: Record<string, unknown> = { ...DEFAULT_SCENARIO };
    for (const key of SCENARIO_KEYS) {
      if (raw[key] !== undefined && raw[key] !== null) merged[key] = raw[key];
    }
    if (SCENARIO_KEYS.some((key) => !Object.is(merged[key], DEFAULT_SCENARIO[key]))) return merged as unknown as Scenario;
  }
  return null;
}

/** 1.2 -> "1.2", 0.85 -> "0.85", 1 -> "1". A value that is not a number is shown as it is. */
function show(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Number(v.toFixed(3))) : String(v);
}

/** The scenario in plain words: only what differs from the default. */
export function describeScenario(s: Scenario): string {
  const parts: string[] = [];
  if (!Object.is(s.cwrMult, DEFAULT_SCENARIO.cwrMult)) parts.push(`子どもの数の倍率 ${show(s.cwrMult)}`);
  if (!Object.is(s.migMode, DEFAULT_SCENARIO.migMode)) parts.push(s.migMode === 'fade' ? '人口の移動は少しずつ止まる' : `人口の移動 ${show(s.migMode)}`);
  if (!Object.is(s.migScale, DEFAULT_SCENARIO.migScale)) parts.push(`移動の強さ ${show(s.migScale)}`);
  if (!Object.is(s.infraStrength, DEFAULT_SCENARIO.infraStrength)) parts.push(`施設の影響 ${show(s.infraStrength)}`);
  return parts.length === 0 ? '標準の前提' : parts.join('、');
}

// ---------------------------------------------------------------------------------------------------------------
// Estimate marker
// ---------------------------------------------------------------------------------------------------------------

const MAX_WALK_NODES = 50_000;

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
