// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { phraseNodes, phrases } from './phrases';

describe('phrases', () => {
  test('cut after 。 and 、 and before （, and join back to the same text', () => {
    const text = '国土交通省の表（2009〜2012年の統計、三大都市圏を除く）にもとづく人口の目安です。施設の閉鎖を予測するものではありません。';
    const parts = phrases(text);
    expect(parts).toEqual(['国土交通省の表', '（2009〜2012年の統計、', '三大都市圏を除く）にもとづく人口の目安です。', '施設の閉鎖を予測するものではありません。']);
    expect(parts.join('')).toBe(text);
  });

  test('a text without cut points stays whole and an empty text gives no phrase', () => {
    expect(phrases('境目')).toEqual(['境目']);
    expect(phrases('')).toEqual([]);
  });
});

describe('phraseNodes', () => {
  test('one no-break .keep span per phrase of a sentence, the same text in the same order', () => {
    const text = '2050年より後は、このアプリの試算です（予測ではありません）';
    const nodes = phraseNodes(text);
    expect(nodes.map((n) => n.textContent)).toEqual(['2050年より後は、', 'このアプリの試算です', '（予測ではありません）']);
    expect(nodes.every((n) => n.tagName === 'SPAN' && n.className === 'keep')).toBe(true);
    expect(nodes.map((n) => n.textContent).join('')).toBe(text);
  });

  test('a list of parts is used as given, without splitting them again', () => {
    expect(phraseNodes(['目安：1,500人（50%）', '〜 2,500人（80%）']).map((n) => n.textContent)).toEqual(['目安：1,500人（50%）', '〜 2,500人（80%）']);
    expect(phraseNodes([])).toEqual([]);
  });
});
