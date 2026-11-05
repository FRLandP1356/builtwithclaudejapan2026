// Keyboard order of the map areas: one Tab stop for the whole map (a roving tabindex), arrow keys that move to the
// neighbouring area on screen, Home/End to the first and last area and PageUp/PageDown to the previous and next area
// in Tab order (which reaches every area, also those no arrow reaches). Pure functions over area anchors (the centroid
// of an area's largest polygon, in the map's viewBox coordinates), so the choice of the next area is testable without a DOM.

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Anchor {
  code: string;
  x: number;
  y: number;
  /** The area is drawn in an inset box (Okinawa, far islands), whose position says nothing about where it lies. */
  inset?: boolean;
}

/** The arrow keys the map answers to. */
export const ARROW_DIRECTIONS: ReadonlyMap<string, Direction> = new Map<string, Direction>([
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
]);

/** Home, End, PageUp and PageDown walk the Tab order. */
const SEQUENCE_KEYS: ReadonlySet<string> = new Set(['Home', 'End', 'PageUp', 'PageDown']);

/** Whether the map answers to `key` (it then keeps the key from scrolling the page, even at an edge). */
export function isNavigationKey(key: string): boolean {
  return ARROW_DIRECTIONS.has(key) || SEQUENCE_KEYS.has(key);
}

/** An offset sideways counts this many times as much as the same offset along the arrow (a straight neighbour wins over a diagonal one). */
export const SIDEWAYS_WEIGHT = 2;
/** Offsets along the arrow of at most this many viewBox units do not count as "in that direction" (floating-point noise). */
const EPS = 1e-9;

/**
 * The area to move to from `from` when `direction` is pressed: among the candidates whose centroid lies strictly in
 * that direction (y grows downwards on screen), the one with the smallest `along² + (SIDEWAYS_WEIGHT · sideways)²`.
 * An exact tie goes to the candidate that comes first in `candidates` (the Tab order), so the result never depends on
 * floating-point luck. `undefined` at an edge: nothing lies in that direction. The area itself is never a candidate.
 * An inset box is a separate group: from the main map an arrow never lands in an inset (ArrowUp from 北海道 must not
 * reach 沖縄県 just because its box is drawn above), and from an inset area it moves among the inset's areas only.
 * Those areas are reached with PageUp/PageDown, Home/End or the search box.
 */
export function nearestInDirection(from: Anchor, direction: Direction, candidates: readonly Anchor[]): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const c of candidates) {
    if (c.code === from.code || Boolean(c.inset) !== Boolean(from.inset)) continue;
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    if (!(along > EPS)) continue;
    const sideways = direction === 'left' || direction === 'right' ? dy : dx;
    const score = along * along + (SIDEWAYS_WEIGHT * sideways) ** 2;
    if (score < bestScore - EPS) {
      bestScore = score;
      best = c.code;
    }
  }
  return best;
}

/**
 * The area a key moves to: an arrow key by `nearestInDirection`, Home and End to the first and last area of the Tab
 * order, PageUp and PageDown to the previous and next one (no wrap). `undefined` for any other key, and at an edge.
 * `anchors` is in Tab order.
 */
export function targetForKey(key: string, currentCode: string, anchors: readonly Anchor[]): string | undefined {
  if (key === 'Home') return anchors[0]?.code;
  if (key === 'End') return anchors[anchors.length - 1]?.code;
  const index = anchors.findIndex((a) => a.code === currentCode);
  if (index < 0) return undefined;
  if (key === 'PageUp') return anchors[index - 1]?.code;
  if (key === 'PageDown') return anchors[index + 1]?.code;
  const direction = ARROW_DIRECTIONS.get(key);
  return direction ? nearestInDirection(anchors[index], direction, anchors) : undefined;
}

/**
 * The one area that is a Tab stop: the selected area when it exists, else the first. (While the keyboard roves, the
 * map keeps its own current area and only falls back to this when the selection changes.)
 */
export function tabStopFor(selected: string | undefined, codes: readonly string[]): string | undefined {
  return selected !== undefined && codes.includes(selected) ? selected : codes[0];
}
