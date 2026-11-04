// Pure functions for the drill-down (日本 > 県 > 町): level, transitions, breadcrumbs and place search.
// The DOM code in app.ts only applies the patches these functions return.
import type { Area } from '../engine/types';

export type Level = 'japan' | 'pref' | 'area';

export interface Selection {
  selectedPref?: string;
  selectedArea?: string;
}

/** The prefecture an area belongs to is the first two digits of its code. */
export function prefOfArea(areaCode: string): string {
  return areaCode.slice(0, 2);
}

export function levelOf(s: Selection): Level {
  if (s.selectedArea) return 'area';
  if (s.selectedPref) return 'pref';
  return 'japan';
}

export function pickPref(prefCode: string): Selection {
  return { selectedPref: prefCode, selectedArea: undefined };
}

export function pickArea(area: { code: string; prefCode: string }): Selection {
  return { selectedPref: area.prefCode, selectedArea: area.code };
}

export function toJapan(): Selection {
  return { selectedPref: undefined, selectedArea: undefined };
}

/** One level up: area -> its prefecture, prefecture -> Japan, Japan -> no change. */
export function goUp(s: Selection): Selection {
  switch (levelOf(s)) {
    case 'area':
      return pickPref(s.selectedPref ?? prefOfArea(s.selectedArea!));
    case 'pref':
      return toJapan();
    default:
      return {};
  }
}

export interface Crumb {
  label: string;
  /** True for the last crumb (the current place). */
  current: boolean;
  /** Patch to apply when the crumb is activated; absent on the current crumb. */
  patch?: Selection;
}

export interface NameLookup {
  pref(code: string): string | undefined;
  area(code: string): string | undefined;
}

export function breadcrumbs(s: Selection, names: NameLookup): Crumb[] {
  const level = levelOf(s);
  const crumbs: Crumb[] = [{ label: '日本', current: level === 'japan', patch: level === 'japan' ? undefined : toJapan() }];
  if (level === 'japan') return crumbs;
  const pref = s.selectedPref ?? prefOfArea(s.selectedArea!);
  crumbs.push({
    label: names.pref(pref) ?? pref,
    current: level === 'pref',
    patch: level === 'pref' ? undefined : pickPref(pref),
  });
  if (level === 'area') {
    const area = s.selectedArea!;
    crumbs.push({ label: names.area(area) ?? area, current: true });
  }
  return crumbs;
}

export interface SearchEntry {
  kind: 'pref' | 'area';
  code: string;
  name: string;
  prefCode: string;
  /** For areas: the prefecture name shown next to the result. */
  prefName?: string;
}

/** Fold width, case and the small-ke/ka kana variants so 保土ヶ谷 finds 保土ケ谷. */
export function normalizeName(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/[ヶヵ]/g, (ch) => (ch === 'ヶ' ? 'ケ' : 'カ'));
}

export function buildSearchIndex(
  areas: ReadonlyArray<Pick<Area, 'code' | 'name' | 'prefCode' | 'prefName'>>,
  prefNames: ReadonlyMap<string, string>,
): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const [code, name] of [...prefNames.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out.push({ kind: 'pref', code, name, prefCode: code });
  }
  for (const a of areas) out.push({ kind: 'area', code: a.code, name: a.name, prefCode: a.prefCode, prefName: a.prefName });
  return out;
}

/**
 * Substring search over place names. Prefectures rank before areas, prefix matches before inner matches, then
 * shorter names first, then by code. Returns at most `limit` entries.
 */
export function searchPlaces(query: string, index: ReadonlyArray<SearchEntry>, limit = 8): SearchEntry[] {
  const q = normalizeName(query);
  if (!q) return [];
  const scored: Array<{ entry: SearchEntry; score: number }> = [];
  for (const entry of index) {
    const name = normalizeName(entry.name);
    const pos = name.indexOf(q);
    if (pos < 0) continue;
    const score = (entry.kind === 'pref' ? 0 : 1000) + (pos === 0 ? 0 : 100) + Math.min(name.length, 99);
    scored.push({ entry, score });
  }
  scored.sort((a, b) => a.score - b.score || a.entry.code.localeCompare(b.entry.code));
  return scored.slice(0, limit).map((x) => x.entry);
}
