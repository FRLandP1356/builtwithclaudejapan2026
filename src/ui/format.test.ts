import { describe, expect, test } from 'vitest';
import { formatDeltaPct, formatPct, formatPop, formatYear } from './format';

describe('formatDeltaPct', () => {
  test('one decimal normally, two below 0.1, ±0 near zero', () => {
    expect(formatDeltaPct(10)).toBe('+10.0%');
    expect(formatDeltaPct(-3.46)).toBe('−3.5%');
    expect(formatDeltaPct(-0.04)).toBe('−0.04%');
    expect(formatDeltaPct(0.001)).toBe('±0%');
    expect(formatDeltaPct(Number.NaN)).toBe('－');
  });
});

describe('formatPop', () => {
  test('under 10,000 shows people with separators', () => {
    expect(formatPop(8340)).toBe('8,340人');
    expect(formatPop(999.6)).toBe('1,000人');
    expect(formatPop(0)).toBe('0人');
  });
  test('10,000 to under 1,000,000 shows 万 with one decimal', () => {
    expect(formatPop(42311)).toBe('4.2万人');
    expect(formatPop(685000)).toBe('68.5万人');
    expect(formatPop(10000)).toBe('1.0万人');
  });
  test('1,000,000 and above shows whole 万 with separators', () => {
    expect(formatPop(11_900_000)).toBe('1,190万人');
    expect(formatPop(2_800_227)).toBe('280万人');
  });
  test('100,000,000 and above shows 億 and 万', () => {
    expect(formatPop(126_146_099)).toBe('1億2,615万人');
    expect(formatPop(100_000_000)).toBe('1億人');
  });
  test('non-finite input shows a dash', () => {
    expect(formatPop(NaN)).toBe('－');
  });
});

describe('formatPct', () => {
  test('signed change versus 2020 with a true minus sign', () => {
    expect(formatPct(0.685)).toBe('−31.5%');
    expect(formatPct(1.025)).toBe('+2.5%');
    expect(formatPct(1)).toBe('±0.0%');
    expect(formatPct(0.0625)).toBe('−93.8%');
  });
  test('non-finite input shows a dash', () => {
    expect(formatPct(NaN)).toBe('－');
    expect(formatPct(Infinity)).toBe('－');
  });
});

describe('formatYear', () => {
  test('appends 年', () => {
    expect(formatYear(2050)).toBe('2050年');
  });
});
