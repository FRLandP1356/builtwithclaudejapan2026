import { describe, expect, test } from 'vitest';
import { allocatedBasisNote, badgeFor } from './sources';

describe('allocatedBasisNote', () => {
  test('up to 2050 it says the figure is this app\'s calculation on the official estimate (the census in 2020)', () => {
    expect(allocatedBasisNote(2020)).toBe('国勢調査をもとにこのアプリが計算');
    expect(allocatedBasisNote(2025)).toBe('公式推計をもとにこのアプリが計算');
    expect(allocatedBasisNote(2050)).toBe('公式推計をもとにこのアプリが計算');
  });

  test('after 2050 there is none: the 試算 mark already says it', () => {
    expect(allocatedBasisNote(2055)).toBeUndefined();
    expect(allocatedBasisNote(2100)).toBeUndefined();
  });

  test('it never contains the word 予測, and badgeFor still draws the boundary at 2050', () => {
    for (const y of [2020, 2025, 2050]) expect(allocatedBasisNote(y)).not.toContain('予測');
    expect(badgeFor(2050)).toEqual({ text: '公式推計', estimate: false });
    expect(badgeFor(2055)).toEqual({ text: '試算', estimate: true });
    expect(badgeFor(2020)).toEqual({ text: '実績（国勢調査）', estimate: false });
  });
});
