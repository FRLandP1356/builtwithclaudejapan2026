import { describe, expect, it } from 'vitest';
import { checkNumbers } from './numberCheck';

const unverified = (answer: string, results: unknown[]): string[] => checkNumbers(answer, results).unverified;

const TANABE_RESULT = {
  area: { code: '30206', name: '田辺市', prefName: '和歌山県' },
  rows: [
    { year: 2050, population: 42311, ages65Share: 45.5, basis: 'official' },
    { year: 2100, population: 11880, ages65Share: 47.2, basis: 'app_estimate' },
  ],
};

describe('verified numbers (shown as in the tool results, scaled and rounded)', () => {
  it('accepts_tool_numbers: 42311 in the results makes "約4.2万人" and "42,311人" verified', () => {
    const results = [{ population: 42311 }];
    expect(unverified('田辺市の人口は約4.2万人です。', results)).toEqual([]);
    expect(unverified('田辺市の人口は42,311人です。', results)).toEqual([]);
    expect(unverified('田辺市の人口は42311人です。', results)).toEqual([]);
    expect(unverified('約4.2万人（42,311人）', results)).toEqual([]);
  });

  it('flags_invented_number: "約10万人" is not in the results, so it is returned as written', () => {
    expect(unverified('田辺市の人口は約10万人です。', [{ population: 42311 }])).toEqual(['10万']);
  });

  it('percent: matches the value shown in the results; a share stored as a fraction is NOT converted', () => {
    expect(unverified('65歳以上の割合は45.5%です。', [TANABE_RESULT])).toEqual([]);
    expect(unverified('65歳以上の割合は45.5パーセント', [TANABE_RESULT])).toEqual([]);
    expect(unverified('割合は45.6%', [TANABE_RESULT])).toEqual([]); // within the 0.5% relative tolerance
    expect(unverified('割合は60.2%', [TANABE_RESULT])).toEqual(['60.2%']);
    expect(unverified('割合は63.3%', [{ share: 0.633 }])).toEqual(['63.3%']);
    expect(unverified('割合は０．６％', [{ share: 0.6 }])).toEqual([]); // full-width percent and decimals
  });

  it('万 and 億: units scale the number; commas, decimals and compound forms work', () => {
    const results = [{ japan: 63280000, other: 120000000, small: 35000, tiny: 3000 }];
    expect(unverified('日本は6,328万人', results)).toEqual([]);
    expect(unverified('日本は6328万人', results)).toEqual([]);
    expect(unverified('日本は約0.63億人', results)).toEqual([]);
    expect(unverified('1億2,000万人', results)).toEqual([]);
    expect(unverified('1.2億人', results)).toEqual([]);
    expect(unverified('3万5千人', results)).toEqual([]);
    expect(unverified('3万5,000人', results)).toEqual([]);
    expect(unverified('3千人', results)).toEqual([]);
    expect(unverified('日本は7,000万人', results)).toEqual(['7,000万']);
    expect(unverified('日本は約6.3億人', results)).toEqual(['6.3億']);
    expect(unverified('2億3,456万人', results)).toEqual(['2億3,456万']);
  });

  it('tolerance: half a unit of the last shown digit or 0.5% relative, whichever is larger', () => {
    const results = [{ population: 42311 }];
    expect(unverified('42,400人', results)).toEqual([]); // 89 away, 0.5% is 211
    expect(unverified('43,000人', results)).toEqual(['43,000']);
    expect(unverified('4.3万人', results)).toEqual(['4.3万']); // 689 away, half of 0.1万 is 500
    expect(unverified('4.2万人', results)).toEqual([]); // 311 away
    expect(unverified('4万人', results)).toEqual([]); // 4万 shows no decimals: half unit is 5,000
    expect(unverified('約42,000人', results)).toEqual(['42,000']); // 311 away, 0.5% of 42,000 is 210: not accepted
  });

  it('full-width digits, commas and decimal points are read; the original text is returned', () => {
    expect(unverified('人口は４２，３１１人', [{ p: 42311 }])).toEqual([]);
    expect(unverified('人口は約９９万人', [{ p: 42311 }])).toEqual(['９９万']);
    expect(unverified('人口は１２，３４５人', [{ p: 42311 }])).toEqual(['１２，３４５']);
  });

  it('values are found anywhere in the results: nested objects, arrays, JSON strings and numbers inside text', () => {
    const results = [
      { a: { b: [{ c: 7777 }] } },
      JSON.stringify({ population: 51234 }),
      { name: 'ショッピングセンター（売場面積15,000㎡以上）' },
      'plain text with 8,888 in it',
    ];
    expect(unverified('7,777人と51,234人と15,000と8,888', results)).toEqual([]);
    expect(unverified('7,778人と9,999人', results)).toEqual(['9,999']);
  });

  it('sign is ignored: a drop of 30,000 matches -30000 in the results, but sums and differences are not inferred', () => {
    const results = [{ difference: -30000, a: 100000, b: 70000 }];
    expect(unverified('約3万人減ります', results)).toEqual([]);
    expect(unverified('差は2万人', results)).toEqual(['2万']);
    expect(unverified('合計17万人', results)).toEqual(['17万']);
  });

  it('ranges share the unit written at the end ("40〜50%", "4〜5万人")', () => {
    expect(unverified('40〜50%', [{ x: 40.2, y: 50.1 }])).toEqual([]);
    expect(unverified('40〜50%', [{ x: 12, y: 50.1 }])).toEqual(['40']);
    expect(unverified('4〜5万人', [{ x: 41000, y: 52000 }])).toEqual([]);
    expect(unverified('4万〜9万人', [{ x: 41000 }])).toEqual(['9万']);
  });

  it('a ratio with 倍 is checked against the value in the results', () => {
    expect(unverified('1.2倍です', [{ cwrMult: 1.2 }])).toEqual([]);
    expect(unverified('1.2倍です', [{ cwrMult: 1.4 }])).toEqual(['1.2倍']);
    expect(unverified('3倍です', [{ x: 1 }])).toEqual(['3倍']); // a small integer with 倍 is a claim, not a count
    expect(unverified('3割です', [{ x: 1 }])).toEqual(['3割']);
  });
});

describe('exempt numbers', () => {
  it('years 2020..2100 are exempt, with or without 年; other years followed by 年 and durations too', () => {
    expect(unverified('2020年から2100年まで。2050年と2075年。', [])).toEqual([]);
    expect(unverified('2020〜2100', [])).toEqual([]);
    expect(unverified('2009年から2012年の統計。令和5年推計。30年間で。50年後。', [])).toEqual([]);
    expect(unverified('2009〜2012年の統計', [])).toEqual([]);
    // but a count written like a year is still a count
    expect(unverified('2050人です', [])).toEqual(['2050']);
    expect(unverified('2,050人です', [])).toEqual(['2,050']);
  });

  it('list numbering at the start of a line is exempt, but "1.2倍" at the start of a line is a number', () => {
    expect(unverified('1. 田辺市\n2. 新宮市\n3) 御坊市\n（13）白浜町\n12. 串本町', [])).toEqual([]);
    expect(unverified('- 1. 田辺市\n  2.新宮市', [])).toEqual([]);
    expect(unverified('1.2倍です', [{ x: 1.2 }])).toEqual([]);
    expect(unverified('1.2倍です', [{ x: 5 }])).toEqual(['1.2倍']);
    expect(unverified('結果:\n1. 人口は99,999人', [])).toEqual(['99,999']);
  });

  it('integers 0..10 without a unit or % are exempt, including with counter words; 11 and up are checked', () => {
    expect(unverified('3つの町と3町、0件、10市町村、5施設、7人', [])).toEqual([]);
    expect(unverified('11町', [])).toEqual(['11']);
    expect(unverified('11町', [{ count: 11 }])).toEqual([]);
    expect(unverified('5%', [])).toEqual(['5%']);
    expect(unverified('5万人', [])).toEqual(['5万']);
    expect(unverified('0.5人', [])).toEqual(['0.5']);
    expect(unverified('1,000人', [])).toEqual(['1,000']);
  });

  it('ages, ordinals, dates and other labels are not data', () => {
    expect(unverified('65歳以上と75歳以上、0〜14歳。20代。', [])).toEqual([]);
    expect(unverified('第3位、2位、第12章、3番目、11月5日', [])).toEqual([]);
  });

  it('digits inside identifiers are exempt: letters stuck to the digits, and 2/5-digit codes that appear in the results', () => {
    expect(unverified('p50は500人、p80は2500人', [{ p50: 500, p80: 2500 }])).toEqual([]);
    expect(unverified('M12とH22とCOVID19', [])).toEqual([]);
    const results = [{ code: '30206', prefCode: '30', name: '田辺市' }];
    expect(unverified('田辺市（30206）は和歌山県（30）にあります。', results)).toEqual([]);
    expect(unverified('コードは30206です', results)).toEqual([]);
    // the same digits used as a quantity are not exempt
    expect(unverified('30206人', results)).toEqual(['30206']);
    expect(unverified('30,206人', results)).toEqual(['30,206']);
    expect(unverified('30%', results)).toEqual(['30%']);
    // and a code that is not in the results is just a number
    expect(unverified('コードは13103です', results)).toEqual(['13103']);
    // a code string never verifies a quantity
    expect(unverified('30,206人', [{ code: '30206' }])).toEqual(['30,206']);
    expect(unverified('32人', [{ prefCode: '32' }])).toEqual(['32']);
    expect(unverified('32万人', [{ prefCode: '32' }])).toEqual(['32万']);
  });

});

describe('what is returned', () => {
  it('a multi-number sentence with one bad number lists only the bad one, once', () => {
    const answer = '田辺市の人口は2050年に42,311人、65歳以上は45.5%ですが、2100年は約8,000人になります。8,000人は目安です。';
    expect(unverified(answer, [TANABE_RESULT])).toEqual(['8,000']);
  });

  it('several bad numbers come back in order of appearance', () => {
    expect(unverified('約10万人、63.3%、1.2倍', [{ x: 1 }])).toEqual(['10万', '63.3%', '1.2倍']);
  });

  it('an answer without numbers, an empty answer and missing results are fine', () => {
    expect(unverified('人口は減ります。', [])).toEqual([]);
    expect(unverified('', [{ a: 1 }])).toEqual([]);
    expect(unverified('約10万人', [])).toEqual(['10万']);
  });

  it('never throws on odd input', () => {
    const cyc: Record<string, unknown> = { n: 1 };
    cyc.self = cyc;
    for (const results of [undefined, null, 'x', 5, [undefined, null, cyc, () => 1, Symbol('s'), 10n]] as unknown[]) {
      expect(() => checkNumbers('約10万人', results as unknown[])).not.toThrow();
    }
    expect(() => checkNumbers(undefined as unknown as string, [])).not.toThrow();
    expect(checkNumbers(undefined as unknown as string, []).unverified).toEqual([]);
    let deep: unknown = { v: 777777 };
    for (let i = 0; i < 5000; i++) deep = { next: deep };
    expect(() => checkNumbers('777,777人', [deep])).not.toThrow();
  });

  it('is fast enough for a long answer and large results', () => {
    const big = Array.from({ length: 5000 }, (_, i) => ({ population: i * 7 + 11 }));
    const answer = Array.from({ length: 200 }, (_, i) => `${i * 7 + 11}人`).join('、');
    const t0 = Date.now();
    expect(unverified(answer, [big])).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
