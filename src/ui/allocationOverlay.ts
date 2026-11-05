// Turning an allocation into what the map draws (an AllocationOverlay), and rebuilding one from the input of an AI
// `run_allocation` tool call. Pure: no DOM. Used by the allocation panel and the AI panel.
import type { AppData } from '../data/loader';
import { isScenarioError, sanitizeScenario, type Runner } from '../data/runner';
import { allocate, type AllocationInput, type AllocationResult } from '../engine/allocation';
import type { Facility, Scenario } from '../engine/types';
import { allocationErrorMessage, populationAt, targetPeople, type PopulationAt } from './allocationPanel';
import { YEAR_MAX, YEAR_MIN, YEAR_STEP, type AllocationOverlay } from './state';

/** The change in percent per area: (after - before) / before * 100; an area with no one before stays at 0. */
export function changePercentOf(before: Map<string, number>, after: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, b] of before) {
    const a = after.get(code);
    out[code] = a === undefined || !(b > 0) ? 0 : ((a - b) / b) * 100;
  }
  return out;
}

export interface BuildOverlayInput {
  result: Pick<AllocationResult, 'pop' | 'flips'>;
  /** Populations before the allocation (the same map `allocate` was given). */
  before: Map<string, number>;
  facilities: readonly Facility[];
  year: number;
  label: string;
  focusFacilityId?: string;
}

/** The overlay for an allocation result: every area's change, and every facility whose count changed with ALL its towns. */
export function buildOverlay(input: BuildOverlayInput): AllocationOverlay {
  const nameOf = new Map(input.facilities.map((f) => [f.id, f.name]));
  const flips = input.result.flips
    .filter((f) => f.gained.length + f.lost.length > 0)
    .map((f) => ({ facilityId: f.facilityId, name: nameOf.get(f.facilityId) ?? f.facilityId, gained: [...f.gained], lost: [...f.lost] }));
  const out: AllocationOverlay = { year: input.year, label: input.label, changePercent: changePercentOf(input.before, input.result.pop), flips };
  if (input.focusFacilityId !== undefined && flips.some((f) => f.facilityId === input.focusFacilityId)) out.focusFacilityId = input.focusFacilityId;
  return out;
}

/** +10% / −3.5% / 約2.6万人 for the overlay label. */
export function deltaLabel(deltaPercent: number | undefined, deltaPeople: number): string {
  if (deltaPercent !== undefined) {
    const p = Math.round(deltaPercent * 10) / 10;
    return `${p < 0 ? '−' : '+'}${Math.abs(p)}%`;
  }
  const n = Math.round(Math.abs(deltaPeople));
  return `${deltaPeople < 0 ? '−' : '+'}${n.toLocaleString('ja-JP')}人`;
}

export interface ToolOverlayError {
  error: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const ECHO_MAX = 12;

/** A code the model wrote, for a message: short, and shown as plain text by the caller. */
function echo(v: unknown): string {
  if (typeof v !== 'string' || v.trim() === '') return '（なし）';
  const chars = [...v.trim()];
  return chars.length > ECHO_MAX ? `${chars.slice(0, ECHO_MAX).join('')}…` : chars.join('');
}

/** An allocation rebuilt from a tool input: the overlay, and the assumptions it was computed under. */
export interface ToolAllocation {
  overlay: AllocationOverlay;
  scenario: Scenario;
}

/**
 * Recompute the allocation an AI `run_allocation` call described, from its INPUT only (target, deltaPercent or
 * deltaPeople, sourceMode, prefCodes, year, scenario), through the same engine the panel uses, reading the input the
 * way the tool does, and return the overlay with the scenario it used. Anything the model wrote that is not a valid
 * input is refused with a Japanese message; the scenario goes through sanitizeScenario (Ruling 21). Nothing from
 * the tool RESULT is used.
 */
export function overlayFromToolInput(
  raw: unknown,
  data: Pick<AppData, 'areas' | 'groups' | 'facilities' | 'prefNames'>,
  runner: Runner,
): ToolAllocation | ToolOverlayError {
  if (!isRecord(raw) || !isRecord(raw.target)) return { error: 'この割り振りの対象が読めないため、地図に反映できません。' };
  const kind = raw.target.kind;
  const code = typeof raw.target.code === 'string' ? raw.target.code.trim() : '';
  const areaByCode = new Map(data.areas.map((a) => [a.code, a]));
  let target: AllocationInput['target'];
  let targetName: string;
  if (kind === 'pref') {
    const name = data.prefNames.get(code);
    if (name === undefined) return { error: `都道府県コード ${echo(code)} が見つからないため、地図に反映できません。` };
    target = { kind: 'pref', code };
    targetName = name;
  } else if (kind === 'area') {
    const a = areaByCode.get(code);
    if (!a) return { error: `市区町村コード ${echo(code)} が見つからないため、地図に反映できません。` };
    target = { kind: 'area', code };
    targetName = a.name;
  } else {
    return { error: 'この割り振りの対象の種類が読めないため、地図に反映できません。' };
  }

  const hasPercent = typeof raw.deltaPercent === 'number';
  const hasPeople = typeof raw.deltaPeople === 'number';
  if (hasPercent === hasPeople) return { error: '増やす・減らす量の指定が読めないため、地図に反映できません。' };
  const deltaPercent = hasPercent ? (raw.deltaPercent as number) : undefined;
  const deltaPeopleIn = hasPeople ? (raw.deltaPeople as number) : undefined;
  if ((deltaPercent !== undefined && !Number.isFinite(deltaPercent)) || (deltaPeopleIn !== undefined && !Number.isFinite(deltaPeopleIn))) {
    return { error: '増やす・減らす量が数として読めないため、地図に反映できません。' };
  }

  let source: AllocationInput['source'] = { mode: 'proportional' };
  const codesGiven = Array.isArray(raw.prefCodes) && raw.prefCodes.length > 0;
  const mode = raw.sourceMode ?? (codesGiven ? 'regions' : 'proportional');
  if (mode === 'regions') {
    if (!codesGiven) return { error: '人口を動かす元の県が指定されていないため、地図に反映できません。' };
    const prefCodes: string[] = [];
    for (const c of raw.prefCodes as unknown[]) {
      if (typeof c !== 'string' || !data.prefNames.has(c.trim())) return { error: `人口を動かす元の県コード ${echo(c)} が見つからないため、地図に反映できません。` };
      if (!prefCodes.includes(c.trim())) prefCodes.push(c.trim());
    }
    source = { mode: 'regions', prefCodes };
  } else if (mode !== 'proportional') {
    return { error: '人口を動かす元の指定が読めないため、地図に反映できません。' };
  }

  // The year as the tool read it: 2020..2100, snapped down to the 5-year grid (2052 was computed as 2050).
  if (typeof raw.year !== 'number' || !Number.isFinite(raw.year) || raw.year < YEAR_MIN || raw.year > YEAR_MAX) {
    return { error: '年が2020〜2100年の範囲にないため、地図に反映できません。' };
  }
  const year = Math.floor(raw.year / YEAR_STEP) * YEAR_STEP;
  // The scenario as the tool read it: missing or null entries take the default; the rest goes through
  // sanitizeScenario (Ruling 21), which refuses anything out of range.
  if (raw.scenario !== undefined && raw.scenario !== null && !isRecord(raw.scenario)) {
    return { error: 'この割り振りの前提が読めないため、地図に反映できません。' };
  }
  const given: Partial<Record<keyof Scenario, unknown>> = {};
  if (isRecord(raw.scenario)) {
    for (const key of ['cwrMult', 'migMode', 'migScale', 'infraStrength'] as const) {
      if (raw.scenario[key] !== undefined && raw.scenario[key] !== null) given[key] = raw.scenario[key];
    }
  }
  const scenario = sanitizeScenario(given as Partial<Scenario>);
  if (isScenarioError(scenario)) return { error: 'この割り振りの前提が範囲外の値を含むため、地図に反映できません。' };

  let at: PopulationAt;
  try {
    at = populationAt(data, runner.run(scenario), year);
  } catch {
    return { error: 'この年の人口が計算できないため、地図に反映できません。' };
  }
  const before = targetPeople(target, at);
  // Whole people, as the tool computed them.
  const deltaPeople = Math.round(deltaPercent !== undefined ? (before * deltaPercent) / 100 : deltaPeopleIn!);
  try {
    const result = allocate(at.popByArea, at.areaPref, { target, deltaPeople, source }, [...data.facilities]);
    const overlay = buildOverlay({
      result,
      before: at.popByArea,
      facilities: data.facilities,
      year,
      label: `${targetName} ${deltaLabel(deltaPercent, deltaPeople)}`,
    });
    return { overlay, scenario };
  } catch (e) {
    return { error: allocationErrorMessage(e) };
  }
}
