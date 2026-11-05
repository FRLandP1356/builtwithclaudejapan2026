import { describe, expect, test } from 'vitest';
import { ARROW_DIRECTIONS, isNavigationKey, nearestInDirection, SIDEWAYS_WEIGHT, tabStopFor, targetForKey, type Anchor } from './keyboard';

const at = (code: string, x: number, y: number, inset = false): Anchor => ({ code, x, y, ...(inset ? { inset } : {}) });

// A 3x3 grid, 10 apart, y growing downwards like the screen:
//   a b c
//   d e f
//   g h i
const grid: Anchor[] = [
  at('a', 0, 0), at('b', 10, 0), at('c', 20, 0),
  at('d', 0, 10), at('e', 10, 10), at('f', 20, 10),
  at('g', 0, 20), at('h', 10, 20), at('i', 20, 20),
];
const e = grid[4];

describe('nearestInDirection', () => {
  test('moves to the straight neighbour in each of the four directions', () => {
    expect(nearestInDirection(e, 'right', grid)).toBe('f');
    expect(nearestInDirection(e, 'left', grid)).toBe('d');
    expect(nearestInDirection(e, 'down', grid)).toBe('h');
    expect(nearestInDirection(e, 'up', grid)).toBe('b');
  });

  test('returns undefined at an edge, in every direction', () => {
    expect(nearestInDirection(grid[0], 'left', grid)).toBeUndefined();
    expect(nearestInDirection(grid[0], 'up', grid)).toBeUndefined();
    expect(nearestInDirection(grid[8], 'right', grid)).toBeUndefined();
    expect(nearestInDirection(grid[8], 'down', grid)).toBeUndefined();
    expect(nearestInDirection(at('solo', 5, 5), 'right', [at('solo', 5, 5)])).toBeUndefined();
  });

  test('an exact tie goes to the candidate that comes first in Tab order', () => {
    // Two candidates equally far to the right of the centre, one a little above and one a little below.
    const centre = at('c', 0, 0);
    const above = at('p', 10, -4);
    const below = at('q', 10, 4);
    expect(nearestInDirection(centre, 'right', [centre, above, below])).toBe('p');
    expect(nearestInDirection(centre, 'right', [centre, below, above])).toBe('q');
  });

  test('scores that differ only by floating-point noise count as a tie: the earlier candidate wins even if the later one is a hair closer', () => {
    const from = at('o', 0, 0);
    const first = at('first', 10, -3);
    const hairCloser = at('second', 10, 3 - 1e-13); // score smaller by about 2e-12, far below the tolerance
    expect(nearestInDirection(from, 'right', [from, first, hairCloser])).toBe('first');
    expect(nearestInDirection(from, 'right', [from, hairCloser, first])).toBe('second');
    // a real difference (well above the tolerance) still wins
    expect(nearestInDirection(from, 'right', [from, first, at('closer', 10, 2.9)])).toBe('closer');
  });

  test('a candidate exactly level with the area is not "to the right" or "to the left"', () => {
    const from = at('f', 0, 0);
    expect(nearestInDirection(from, 'right', [from, at('same', 0, 7)])).toBeUndefined();
    expect(nearestInDirection(from, 'down', [from, at('same', 7, 0)])).toBeUndefined();
  });

  test('a sideways offset counts more than the same distance along the arrow', () => {
    const from = at('o', 0, 0);
    const straightFar = at('far', 12, 0); // 12 along, 0 sideways
    const nearOff = at('off', 8, 8); // 8 along, 8 sideways: 64 + (2*8)^2 = 320 > 144
    expect(SIDEWAYS_WEIGHT).toBe(2);
    expect(nearestInDirection(from, 'right', [from, nearOff, straightFar])).toBe('far');
    // ...but a modest offset still beats a distant straight one
    const nearSlight = at('slight', 8, 2); // 64 + 16 = 80 < 144
    expect(nearestInDirection(from, 'right', [from, nearSlight, straightFar])).toBe('slight');
  });

  test('never picks itself, and ignores a duplicate of itself', () => {
    expect(nearestInDirection(e, 'right', [e, e])).toBeUndefined();
    expect(nearestInDirection(e, 'right', [at('e', 99, 10)])).toBeUndefined(); // the same code at another position is still itself
  });

  test('a diagonal neighbour is reachable when nothing is straight', () => {
    const from = at('o', 0, 0);
    expect(nearestInDirection(from, 'down', [from, at('sw', -3, 5)])).toBe('sw');
    expect(nearestInDirection(from, 'up', [from, at('sw', -3, 5)])).toBeUndefined();
    expect(nearestInDirection(from, 'left', [from, at('sw', -3, 5)])).toBe('sw');
    expect(nearestInDirection(from, 'right', [from, at('sw', -3, 5)])).toBeUndefined();
  });

  test('ignores a candidate without a position', () => {
    const from = at('o', 0, 0);
    expect(nearestInDirection(from, 'right', [from, at('bad', Number.NaN, Number.NaN), at('ok', 5, 0)])).toBe('ok');
  });

  test('walking right along a ragged row visits every area once, in screen order', () => {
    const row = [at('r1', 0, 0), at('r2', 7, 3), at('r3', 15, -2), at('r4', 21, 1)];
    const walked: string[] = [row[0].code];
    for (let cur: string | undefined = row[0].code; ; ) {
      cur = nearestInDirection(row.find((a) => a.code === cur)!, 'right', row);
      if (!cur) break;
      walked.push(cur);
    }
    expect(walked).toEqual(['r1', 'r2', 'r3', 'r4']);
  });
});

describe('inset areas are a separate group for the arrows', () => {
  // Main map: a, b (b right of a). Inset box drawn above them: x1 (above a), x2 (right of x1).
  const layout = [at('a', 10, 50), at('b', 30, 50), at('x1', 10, 5, true), at('x2', 25, 5, true)];

  test('from a main area an arrow never lands in an inset, however close it is on screen', () => {
    expect(nearestInDirection(layout[0], 'up', layout)).toBeUndefined();
    expect(nearestInDirection(layout[1], 'up', layout)).toBeUndefined();
    expect(nearestInDirection(layout[0], 'right', layout)).toBe('b');
  });

  test('from an inset area an arrow moves among the inset areas only', () => {
    expect(nearestInDirection(layout[2], 'down', layout)).toBeUndefined(); // the main map lies below, but is not a target
    expect(nearestInDirection(layout[2], 'right', layout)).toBe('x2');
    expect(nearestInDirection(layout[3], 'left', layout)).toBe('x1');
  });

  test('the inset stays reachable in Tab order: PageDown from the last main area, End, PageUp back', () => {
    expect(targetForKey('PageDown', 'b', layout)).toBe('x1');
    expect(targetForKey('End', 'a', layout)).toBe('x2');
    expect(targetForKey('PageUp', 'x1', layout)).toBe('b');
    expect(targetForKey('ArrowUp', 'a', layout)).toBeUndefined();
  });
});

describe('targetForKey', () => {
  test('PageDown and PageUp walk the Tab order one area at a time, without wrapping', () => {
    expect(targetForKey('PageDown', 'a', grid)).toBe('b');
    expect(targetForKey('PageDown', 'c', grid)).toBe('d'); // across the end of a screen row
    expect(targetForKey('PageUp', 'e', grid)).toBe('d');
    expect(targetForKey('PageUp', 'a', grid)).toBeUndefined();
    expect(targetForKey('PageDown', 'i', grid)).toBeUndefined();
    expect(targetForKey('PageDown', 'nope', grid)).toBeUndefined();
    expect(targetForKey('PageUp', 'e', [])).toBeUndefined();
    const scrambled = [at('z', 50, 50), at('y', 0, 0), at('x', 99, 1)];
    expect(targetForKey('PageDown', 'z', scrambled)).toBe('y'); // Tab order, not screen order
    expect(targetForKey('PageUp', 'x', scrambled)).toBe('y');
  });

  test('inherited object property names are not keys (a plain object would say "constructor" in it)', () => {
    for (const k of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
      expect(targetForKey(k, 'e', grid), k).toBeUndefined();
      expect(isNavigationKey(k), k).toBe(false);
      expect(ARROW_DIRECTIONS.has(k)).toBe(false);
    }
  });


  test('arrows use the direction rule; Home and End use the Tab order, not the screen', () => {
    expect(targetForKey('ArrowRight', 'e', grid)).toBe('f');
    expect(targetForKey('ArrowLeft', 'e', grid)).toBe('d');
    expect(targetForKey('ArrowUp', 'e', grid)).toBe('b');
    expect(targetForKey('ArrowDown', 'e', grid)).toBe('h');
    expect(targetForKey('Home', 'e', grid)).toBe('a');
    expect(targetForKey('End', 'e', grid)).toBe('i');
    const scrambled = [at('z', 50, 50), at('y', 0, 0), at('x', 99, 1)];
    expect(targetForKey('Home', 'y', scrambled)).toBe('z');
    expect(targetForKey('End', 'y', scrambled)).toBe('x');
  });

  test('other keys, an unknown current area and an empty map give nothing', () => {
    expect(targetForKey('Tab', 'e', grid)).toBeUndefined();
    expect(targetForKey('a', 'e', grid)).toBeUndefined();
    expect(targetForKey('ArrowRight', 'nope', grid)).toBeUndefined();
    expect(targetForKey('Home', 'e', [])).toBeUndefined();
    expect(targetForKey('End', 'e', [])).toBeUndefined();
    expect(targetForKey('ArrowLeft', 'a', grid)).toBeUndefined(); // edge
  });
});

describe('tabStopFor', () => {
  test('the selected area when it is on the map, else the first', () => {
    const codes = ['01', '02', '03'];
    expect(tabStopFor('02', codes)).toBe('02');
    expect(tabStopFor(undefined, codes)).toBe('01');
    expect(tabStopFor('99', codes)).toBe('01');
    expect(tabStopFor('02', [])).toBeUndefined();
  });
});

describe('isNavigationKey', () => {
  test('arrows, Home, End, PageUp and PageDown only', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']) expect(isNavigationKey(k), k).toBe(true);
    for (const k of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Up', 'arrowup', '']) expect(isNavigationKey(k), k).toBe(false);
  });
});
