// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { phraseNodes, phrases, withTail } from './phrases';

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

describe('withTail', () => {
  test('puts the mark at the end of the last phrase, inside it, so a long last phrase never leaves the mark on a line of its own', () => {
    const spans = phraseNodes('和歌山県は、2100年に約26万人。銀行（中央銀行を除く）が人口の目安を下回るのは2025年。');
    const mark = document.createElement('span');
    mark.className = 'badge-estimate';
    const out = withTail(spans, ' ', mark);
    expect(out).toBe(spans);
    expect(spans.at(-1)!.lastElementChild).toBe(mark);
    expect(spans.map((x) => x.textContent).join('').endsWith('2025年。 ')).toBe(true);
    expect(spans.slice(0, -1).every((x) => x.querySelector('.badge-estimate') === null)).toBe(true);
  });
  test('with no phrase there is nothing to attach to: the mark follows', () => {
    const mark = document.createElement('span');
    expect(withTail([], mark)).toEqual([mark]);
  });
});
