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

/** Whether the overlay covers a place (every area of a prefecture or Japan is in a full overlay). */
export function overlayCovers(overlay: AllocationOverlay, areaCodes: readonly string[]): boolean {
  return areaCodes.some((c) => c in overlay.changePercent);
}

/** Lines added to a shape's tooltip and label: the change, and the focused facility's state there. */
export function allocationLines(v: AllocationView, kind: PlaceKind, code: string, year: number): string[] {
  const stale = v.overlay.year !== year ? `（${v.overlay.year}年の計算）` : '';
  const lines = [`割り振りによる変化 ${formatDeltaPct(changeOf(v, kind, code))}${stale}`];
  if (v.focus) {
    if (kind === 'pref') {
      const c = v.prefCounts.get(code);
      if (c) lines.push(`${v.focus.name}：目安を上回る町 +${c.gained}、下回る町 −${c.lost}`);
    } else if (v.gained.has(code)) lines.push(`${v.focus.name}が目安を上回る（増えた）`);
    else if (v.lost.has(code)) lines.push(`${v.focus.name}が目安を下回る（減った）`);
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
