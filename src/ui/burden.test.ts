import { describe, expect, test } from 'vitest';
import { loadFinance } from '../../test/helpers/loadFinance';
import {
  BURDEN_TEXT,
  bandFor,
  bandLabel,
  bandParts,
  bandPopulation,
  barRows,
  formatThousandYen,
  leadText,
  nationalText,
  ownFigure,
  sourceText,
  yearParts,
} from './burden';

const finance = loadFinance();

describe('bandLabel', () => {
  test('the seven bands read 5千人未満 ... 20万人以上, the lower edge dropping its unit when the upper one has the same', () => {
    expect(finance.bands.map(bandLabel)).toEqual(['5千人未満', '5千〜1万人', '1〜3万人', '3〜5万人', '5〜10万人', '10〜20万人', '20万人以上']);
  });

  test('works from the edges, not from a fixed list', () => {
    expect(bandLabel({ min: 0, max: 1000 })).toBe('1千人未満');
    expect(bandLabel({ min: 20000, max: 40000 })).toBe('2〜4万人');
    expect(bandLabel({ min: 2000, max: 5000 })).toBe('2〜5千人');
    expect(bandLabel({ min: 300000, max: null })).toBe('30万人以上');
  });
});

describe('bandPopulation and bandFor: the band is chosen by the population the panel prints', () => {
  test('the projected population is rounded to a whole person, as formatPop prints it under 1万人', () => {
    expect(bandPopulation(4999.4)).toBe(4999);
    expect(bandPopulation(4999.5)).toBe(5000);
    expect(bandPopulation(0)).toBe(0);
    expect(bandPopulation(NaN)).toBeUndefined();
    expect(bandPopulation(-1)).toBeUndefined();
    expect(bandPopulation(Infinity)).toBeUndefined();
  });

  test('boundaries 4,999 / 5,000 / 10,000 / 200,000 pick the band above or below', () => {
    expect([4999, 4999.4, 4999.5, 5000].map((p) => bandFor(finance, p))).toEqual([0, 0, 1, 1]);
    expect([9999, 10000].map((p) => bandFor(finance, p))).toEqual([1, 2]);
    expect([199999, 200000].map((p) => bandFor(finance, p))).toEqual([5, 6]);
    expect(bandFor(finance, NaN)).toBeUndefined();
  });
});

describe('ownFigure', () => {
  test('a town with an entry: 「この町の令和6年度：1人あたり約680千円」', () => {
    expect(ownFigure(finance, '30206', 'city')).toEqual({ value: 680, text: 'この町の令和6年度：1人あたり約680千円' });
    expect(ownFigure(finance, '13402', 'town').text).toBe('この町の令和6年度：1人あたり約5,747千円');
  });

  test('a special ward has its own settlement', () => {
    expect(ownFigure(finance, '13101', 'ward').text).toBe('この町の令和6年度：1人あたり約958千円');
  });

  test('a ward of a designated city has none and says why', () => {
    const o = ownFigure(finance, '01101', 'ward');
    expect(o.value).toBeUndefined();
    expect(o.reason).toBe('ward');
    expect(o.text).toBe('この区は政令指定都市の一部で、区ごとの決算はありません。');
  });

  test('the 浜通り area has none and says why', () => {
    const o = ownFigure(finance, '07999', 'hamadori');
    expect(o.reason).toBe('hamadori');
    expect(o.text).toBe('この地域は複数の市町村をまとめたもので、地域としての決算はありません。');
  });

  test('any other code without an entry says the data has none', () => {
    const o = ownFigure(finance, '99999', 'town');
    expect(o.reason).toBe('missing');
    expect(o.text).toBe('この町の令和6年度の値は、このデータにありません。');
  });

  test('the fiscal year in the sentence comes from the data', () => {
    const f = { ...finance, fiscalYear: 2025 };
    expect(ownFigure(f, '30206', 'city').text).toContain('令和7年度');
  });
});

describe('the sentences', () => {
  test('year line: the year and the population, in three pieces (the mark goes between the 2nd and the 3rd)', () => {
    expect(yearParts(2100, 11_880.4)).toEqual(['規模は、', '2100年の人口 1.2万人', 'で選んでいます。']);
    expect(yearParts(2020, 69_870)).toEqual(['規模は、', '2020年の人口 7.0万人', 'で選んでいます。']);
    expect(yearParts(2100, 4999.6)).toEqual(['規模は、', '2100年の人口 5,000人', 'で選んでいます。']);
  });

  test('band sentence: size, number of municipalities, median and the middle half', () => {
    expect(bandParts(finance.bands[2]).join('')).toBe('いま、人口が1〜3万人の市町村（447団体）：中央値 約724千円、真ん中の半数が561〜883千円。');
    expect(bandParts(finance.bands[0]).join('')).toBe('いま、人口が5千人未満の市町村（302団体）：中央値 約1,733千円、真ん中の半数が1,390〜2,353千円。');
    expect(bandParts(finance.bands[6]).join('')).toBe('いま、人口が20万人以上の市町村（132団体）：中央値 約477千円、真ん中の半数が428〜530千円。');
  });

  test('lead, source and national sentences', () => {
    expect(leadText(finance)).toBe('令和6年度の決算（実績）です。市町村が1年に使ったお金（歳出総額）を、住民基本台帳の人口で割っています。');
    expect(sourceText(finance)).toBe(
      '出典：総務省「令和6年度 市町村別決算状況調」を加工して作成。歳出総額 ÷ 住民基本台帳人口（令和7年1月1日）を市町村ごとに計算し、人口の規模ごとに中央値と、小さい方から25%・75%の値を求めました。1,741団体（特別区を含み、政令指定都市の区は数えていません）。',
    );
    expect(nationalText(finance)).toBe('全国の1,741団体の合計では、1人あたり約556千円です（歳出総額の合計 ÷ 住民基本台帳人口の合計）。');
  });

  test('fixed texts', () => {
    expect(BURDEN_TEXT.title).toBe('いま、この規模の市町村は、1人あたりこれだけ使っています');
    expect(BURDEN_TEXT.limits).toBe(
      '同じ時点の市町村どうしの比較で、この町が将来これだけ使うという予測ではありません。災害復旧や大きな事業の年は値が跳ねます。町村や特別区は、都道府県が担う事務が市と違います。',
    );
    expect(BURDEN_TEXT.publishedTitle).toBe('公表されている区分別の値（令和5年度）');
  });

  test('no advice, no judgement of a value, no forecast word (only the denial), no arrows or circled numbers', () => {
    const all = [
      ...Object.values(BURDEN_TEXT),
      leadText(finance),
      sourceText(finance),
      nationalText(finance),
      ...finance.bands.flatMap((b) => bandParts(b)),
      ...Object.values({ a: ownFigure(finance, '01101', 'ward').text, b: ownFigure(finance, '07999', 'hamadori').text, c: ownFigure(finance, '99999', 'town').text }),
      ...yearParts(2100, 11_880),
    ].join('\n');
    expect(all.replace(/予測ではありません/g, '')).not.toContain('予測');
    for (const w of ['残せない', '閉鎖', 'すべき', 'おすすめ', 'お勧め', '良い', '悪い', '高すぎ', 'かかりすぎ', '節約', '集約', '削減', '守る', '残す', '維持']) expect(all, w).not.toContain(w);
    expect(all).not.toMatch(/[←-⇿▲▶▼①-⑳]/);
  });
});

describe('barRows', () => {
  test('one bar per band, the longest median is full length and the others are in proportion', () => {
    const rows = barRows(finance);
    expect(rows.map((r) => r.label)).toEqual(finance.bands.map(bandLabel));
    expect(rows.map((r) => r.median)).toEqual([1733, 1001, 724, 584, 502, 473, 477]);
    expect(rows[0].widthPct).toBe(100);
    expect(rows[2].widthPct).toBeCloseTo((724 / 1733) * 100, 9);
    expect(rows[6].widthPct).toBeCloseTo((477 / 1733) * 100, 9);
  });
});

describe('formatThousandYen', () => {
  test('whole thousand yen with separators', () => {
    expect(formatThousandYen(680)).toBe('680');
    expect(formatThousandYen(1733)).toBe('1,733');
    expect(formatThousandYen(5747)).toBe('5,747');
  });
});
