// What the screen shows while a reallocation is drawn on the map: pure functions over the store's overlay and the
// derived totals (no DOM). The shell (src/ui/app.ts: colours, headline, tooltips, labels, rings, markers) and the town
// panel (its note) use them, so both read the same numbers.
import type { MapMarker } from '../map/choropleth';
import { allocationScale } from '../map/colors';
import type { Groups } from '../engine/types';
import { allocatedTotals, ratioAt, yearIndex, type AllocatedTotals, type Totals } from './derive';
import { formatDeltaPct } from './format';
import { prefOfArea } from './nav';
import type { AllocationFlip, AllocationOverlay } from './state';

/** Japan, a prefecture (also a shape on the national map) or an area (a shape on a prefecture map). */
export type PlaceKind = 'japan' | 'pref' | 'area';

export interface AllocationView {
  overlay: AllocationOverlay;
  /** Half-width of the colour domain, in percent. */
  scale: number;
  /** Totals at the overlay's year once its change is applied (the national map's colours, the headline). */
  after: AllocatedTotals;
  /** The focused facility, if any. */
  focus?: AllocationFlip;
  /** Areas that rose to / fell below the focused facility's guide (every one of them). */
  gained: Set<string>;
  lost: Set<string>;
  /** Per prefecture: how many towns rose to / fell below the focused facility's guide. */
  prefCounts: Map<string, { gained: number; lost: number }>;
}

/** Everything the screen derives from one overlay under one set of totals. */
export function allocationView(overlay: AllocationOverlay, totals: Totals, groups: Groups): AllocationView {
  const focus = overlay.focusFacilityId ? overlay.flips.find((f) => f.facilityId === overlay.focusFacilityId) : undefined;
  const prefCounts = new Map<string, { gained: number; lost: number }>();
  const count = (codes: readonly string[], key: 'gained' | 'lost') => {
    for (const c of codes) {
      const pp = prefOfArea(c);
      const e = prefCounts.get(pp) ?? { gained: 0, lost: 0 };
      e[key]++;
      prefCounts.set(pp, e);
    }
  };
  if (focus) {
    count(focus.gained, 'gained');
    count(focus.lost, 'lost');
  }
  return {
    overlay,
    scale: allocationScale(Object.values(overlay.changePercent)),
    after: allocatedTotals(totals, groups, yearIndex(totals.years, overlay.year), overlay.changePercent),
    focus,
    gained: new Set(focus?.gained ?? []),
    lost: new Set(focus?.lost ?? []),
    prefCounts,
  };
}

/** The overlay's change for a shape, in percent: a prefecture's total on the national map, else the area's own. */
export function changeOf(v: AllocationView, kind: PlaceKind, code: string): number {
  if (kind === 'pref') return v.after.prefChange.get(code) ?? 0;
  if (kind === 'japan') return 0; // the country's total does not change
  return v.overlay.changePercent[code] ?? 0;
}

export interface PlaceNumbers {
  /** Population shown: after the allocation when `allocated`, else as projected. */
  pop: number;
  /** `pop` against 2020. */
  ratio: number;
  /** The numbers include the allocation (it was computed for the year shown). */
  allocated: boolean;
  /** The projected population without the allocation (equal to `pop` when not `allocated`). */
  popBefore: number;
}

/**
 * Population and ratio to 2020 of a place in `year`. While an allocation for that same year is drawn they are the
 * numbers after it (and `popBefore` keeps the number without it); an allocation for another year leaves them as they
 * are (the bar above the map says which year it was computed for).
 */
export function placeNumbers(totals: Totals, year: number, kind: PlaceKind, code: string, v?: AllocationView): PlaceNumbers | undefined {
  const i = yearIndex(totals.years, year);
  const row = kind === 'japan' ? totals.japan : kind === 'pref' ? totals.pref.get(code) : totals.area.get(code);
  if (!row || i < 0) return undefined;
  const before = row[i];
  if (!v || v.overlay.year !== year) return { pop: before, ratio: ratioAt(row, i), allocated: false, popBefore: before };
  const pop =
    kind === 'japan'
      ? v.after.japanAfter
      : kind === 'pref'
        ? (v.after.prefAfter.get(code) ?? before)
        : before * (1 + (v.overlay.changePercent[code] ?? 0) / 100);
  return { pop, ratio: row[0] > 0 ? pop / row[0] : NaN, allocated: true, popBefore: before };
}

/** Relative size below which a difference is arithmetic noise, not a change (the sum over 1,884 areas is exact to ~1e-13). */
const CHANGE_TOLERANCE = 1e-9;

/**
 * The allocation really changes this place's figure: its numbers include the allocation and differ from the projected
 * ones. The whole country (zero-sum, it cannot change) and a place with a 0 % change are not changed, so the figure
 * there is still the official one.
 */
export function figureChanged(n: PlaceNumbers): boolean {
  return n.allocated && Math.abs(n.pop - n.popBefore) > CHANGE_TOLERANCE * Math.max(1, Math.abs(n.popBefore));
}

/** Whether the overlay covers a place (every area of a prefecture or Japan is in a full overlay). */
export function overlayCovers(overlay: AllocationOverlay, areaCodes: readonly string[]): boolean {
  return areaCodes.some((c) => c in overlay.changePercent);
}

/**
 * 「人口の目安を下回らなくなる町 +1、下回る町 −1」: only the sides that have towns. A side with none is left out, so no "−0"
 * is printed (「人口の目安を下回らなくなる町 +1」 / 「人口の目安を下回る町 −2」); `undefined` when neither side has any.
 * The words are the town panel's status words: a town is 「人口の目安を下回る」 when facilityStatus says 'below' (pop < p50), and
 * one that gained is no longer below (pop >= p50: 'edge' or 'ok'). 「目安以上」 is not used: in this app 「目安」 would then mean the
 * p50 value here but the 50-80% band in the town panel.
 */
export function crossingCounts(c: { gained: number; lost: number }): string | undefined {
  if (c.gained > 0 && c.lost > 0) return `人口の目安を下回らなくなる町 +${c.gained}、下回る町 −${c.lost}`;
  if (c.gained > 0) return `人口の目安を下回らなくなる町 +${c.gained}`;
  if (c.lost > 0) return `人口の目安を下回る町 −${c.lost}`;
  return undefined;
}

/** Lines added to a shape's tooltip and label: the change, and the focused facility's state there. */
export function allocationLines(v: AllocationView, kind: PlaceKind, code: string, year: number): string[] {
  const stale = v.overlay.year !== year ? `（${v.overlay.year}年の計算）` : '';
  const lines = [`割り振りによる変化 ${formatDeltaPct(changeOf(v, kind, code))}${stale}`];
  if (v.focus) {
    if (kind === 'pref') {
      const c = v.prefCounts.get(code);
      if (c) {
        const counts = crossingCounts(c);
        if (counts) lines.push(`${v.focus.name}：${counts}`);
      }
    } else if (v.gained.has(code)) lines.push(`${v.focus.name}が人口の目安を下回らなくなる`);
    else if (v.lost.has(code)) lines.push(`${v.focus.name}が人口の目安を下回る`);
  }
  return lines;
}

/** The national view's count markers: one per prefecture with towns that crossed the focused facility's guide. */
export function countMarkers(v: AllocationView): MapMarker[] {
  const out: MapMarker[] = [];
  for (const [pp, c] of v.prefCounts) {
    const parts: string[] = [];
    if (c.gained) parts.push(`+${c.gained}`);
    if (c.lost) parts.push(`−${c.lost}`);
    out.push({ code: pp, text: parts.join(' '), kind: c.gained && c.lost ? 'mixed' : c.gained ? 'gain' : 'loss' });
  }
  return out;
}
