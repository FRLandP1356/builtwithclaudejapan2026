import { describe, expect, test } from 'vitest';
import { allocatedBasisNote, APP_PROBLEM, badgeFor, NAV_DESCRIPTIONS, NAV_TITLE, SOURCES } from './sources';

describe('APP_PROBLEM: the question the app starts from', () => {
  test('it is the sentence the owner chose, with the first person in hiragana', () => {
    expect(APP_PROBLEM).toBe(
      'いま、何を残したいかを決めておかなければ、あとから選べなくなるかもしれません。わたしたちは何を残すのか。2100年の数字から考えます。',
    );
  });

  test('it never uses the kanji 私, claims that something cannot be kept, advises, or says 予測', () => {
    for (const word of ['私', '残せない', '閉鎖', '予測', 'べき', 'すべき', 'ください']) expect(APP_PROBLEM).not.toContain(word);
  });
});

describe('the row 「くわしく見る」: the way into the folded parts', () => {
  // the menu 「この地図でできること」 became this row on 2026-11-06 (the first screen reduced to what matters most)
  const PANEL_IDS = ['panel-town', 'panel-controls', 'panel-allocation', 'panel-ai', 'panel-sources'];
  const all = [NAV_TITLE, ...Object.values(NAV_DESCRIPTIONS)];

  test('the heading and one line (for a screen reader) for each of the five folded parts, no more and no fewer', () => {
    expect(NAV_TITLE).toBe('くわしく見る');
    expect(Object.keys(NAV_DESCRIPTIONS)).toEqual(PANEL_IDS);
    for (const id of PANEL_IDS) expect(NAV_DESCRIPTIONS[id].length, id).toBeGreaterThan(10);
  });

  test('they describe what the app does and never advise what to keep, claim something cannot be kept, or say 予測 or 私', () => {
    for (const text of all) {
      for (const word of ['私', '予測', '残せない', '閉鎖', 'べき', 'すべき', 'ください', '推奨', 'おすすめ', '守る', '切り捨て']) {
        expect(text, `${word} in ${text}`).not.toContain(word);
      }
    }
  });
});

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

describe('SOURCES: the footer attributions', () => {
  test('the five sources, exactly as attributed (processing stated, page URL, retrieval date from docs/sources.md)', () => {
    expect(SOURCES).toEqual([
      {
        label: '人口',
        text: '国立社会保障・人口問題研究所「日本の地域別将来推計人口（令和5年推計）」を加工して作成（公共データ利用規約 第1.0版（PDL1.0））。国立社会保障・人口問題研究所がこのアプリの内容を保証するものではありません',
        url: 'https://www.ipss.go.jp/pp-shicyoson/j/shicyoson23/t-page.asp',
        retrieved: '2026年11月5日',
      },
      {
        label: '境界',
        text: '国土交通省「国土数値情報（行政区域データ）」（2021年版）を加工して作成（簡略化と国立社会保障・人口問題研究所の地域に合わせた結合。国が作成した地図ではありません）',
        url: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-2021.html',
        retrieved: '2026年11月5日',
        approval: '測量法に基づく国土地理院長承認（複製）R2JHf 450',
      },
      {
        label: '施設の目安',
        text: '国土交通省国土政策局「サービス施設の立地する確率が50%・80%となる自治体の人口規模（三大都市圏を除く）」（2009〜2012年の統計）を加工して作成（図の数値を施設ごとの人口の目安として転記）',
        url: 'https://www.mlit.go.jp/common/001042019.pdf',
        retrieved: '2026年11月5日',
      },
      {
        label: '市町村の歳出',
        text: '総務省「令和6年度 市町村別決算状況調」（都市別・町村別の概況）を加工して作成（歳出総額を住民基本台帳人口（令和7年1月1日）で割り、人口の規模ごとに中央値と四分位を計算。令和6年度の決算の実績で、国が作成した数字ではありません）',
        url: 'https://www.soumu.go.jp/iken/zaisei/r06_shichouson.html',
        retrieved: '2026年11月6日',
      },
      {
        label: '歳出の公表値',
        text: '総務省「令和7年版 地方財政白書」第39表（令和5年度）を加工して作成（団体区分別の1人あたりの歳出の4つの値を転記）',
        url: 'https://www.soumu.go.jp/menu_seisaku/hakusyo/chihou/r07data/2025data/r07czb01-10.html',
        retrieved: '2026年11月6日',
      },
    ]);
  });

  test('every source says it was processed, names its statistics period where it has one, and never says 予測', () => {
    for (const s of SOURCES) {
      expect(s.text, s.label).toContain('を加工して作成');
      expect(s.text).not.toContain('予測');
      expect(s.url).toMatch(/^https:\/\/[a-z.]+\/\S+$/);
    }
    expect(SOURCES[2].text).toContain('（2009〜2012年の統計）');
    // the spending sources name their fiscal year and say the figure is an actual of a past year (not a forecast)
    expect(SOURCES[3].text).toContain('令和6年度');
    expect(SOURCES[3].text).toContain('実績');
    expect(SOURCES[4].text).toContain('令和5年度');
    // docs/sources.md ("画面と README の出典の書き方"): the IPSS line says the institute does not vouch for this app
    expect(SOURCES[0].text.endsWith('。国立社会保障・人口問題研究所がこのアプリの内容を保証するものではありません')).toBe(true);
  });
});
