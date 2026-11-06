// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { loadFinance } from '../../test/helpers/loadFinance';
import { BURDEN_TEXT } from './burden';
import { mountBurdenPanel, type BurdenInput, type BurdenView } from './burdenPanel';

const finance = loadFinance();

let host: HTMLElement;
let view: BurdenView;

function mount(): { q: <T extends Element>(sel: string) => T; all: (sel: string) => Element[] } {
  host = document.createElement('div');
  document.body.append(host);
  view = mountBurdenPanel(host, finance);
  return { q: (sel) => host.querySelector(sel) as never, all: (sel) => [...host.querySelectorAll(sel)] };
}

afterEach(() => {
  view?.destroy();
  document.body.replaceChildren();
});

const tanabe = (year: number, population: number): BurdenInput => ({ code: '30206', kind: 'city', year, population });
const text = (e: Element | null | undefined) => {
  // what is rendered: a hidden element (the mark of another band) is not read
  const copy = e!.cloneNode(true) as Element;
  copy.querySelectorAll('[hidden]').forEach((h) => h.remove());
  return copy.textContent!.replace(/\s+/g, ' ').trim();
};

describe('the block before any update', () => {
  test('has the title, the lead, the strip with seven bars, the caption and the table disclosure, closed', () => {
    const { q, all } = mount();
    expect(text(q('h3.panel-section-title'))).toBe('いま、この規模の市町村は、1人あたりこれだけ使っています');
    expect(text(q('.burden-lead'))).toBe('令和6年度の決算（実績）です。市町村が1年に使ったお金（歳出総額）を、住民基本台帳の人口で割っています。');
    expect(all('.burden-bars > li')).toHaveLength(7);
    expect(text(q('.burden-limits'))).toBe(BURDEN_TEXT.limits);
    expect(text(q('.burden-source'))).toContain('出典：総務省「令和6年度 市町村別決算状況調」を加工して作成。');
    expect(q<HTMLDetailsElement>('details.burden-table').open).toBe(false);
    expect(text(q('details.burden-table > summary'))).toBe('数字を表で見る');
  });

  test('the title never carries the 試算 mark: the money is an actual', () => {
    const { q } = mount();
    view.update(tanabe(2100, 11_880));
    expect(q('h3.panel-section-title').querySelector('.badge-estimate')).toBeNull();
    expect(text(q('h3.panel-section-title'))).not.toContain('試算');
  });
});

describe('a town in the selected year', () => {
  test('田辺市 in 2100 (11,880 people): own figure, the 1〜3万人 band, and the 試算 mark on the population', () => {
    const { q, all } = mount();
    view.update(tanabe(2100, 11_880));
    expect(text(q('.burden-own'))).toBe('この町の令和6年度：1人あたり約680千円');
    expect(text(q('.burden-year'))).toBe('規模は、2100年の人口 1.2万人で選んでいます。 試算');
    expect(text(q('.burden-year .badge-estimate'))).toBe('試算');
    expect(text(q('.burden-band'))).toBe('いま、人口が1〜3万人の市町村（447団体）：中央値 約724千円、真ん中の半数が561〜883千円。');
    const current = all('.burden-bar.is-current');
    expect(current).toHaveLength(1);
    expect(text(current[0])).toContain('1〜3万人');
    expect(text(current[0])).toContain('この町の規模');
  });

  test('田辺市 in 2050 (official) and in 2020 (census) mark the population with the official marks, not 試算', () => {
    const { q } = mount();
    view.update(tanabe(2050, 42_311));
    expect(text(q('.burden-year'))).toBe('規模は、2050年の人口 4.2万人で選んでいます。 公式推計');
    expect(q('.burden-year .badge-official')).not.toBeNull();
    expect(q('.burden-year .badge-estimate')).toBeNull();
    expect(text(q('.burden-band'))).toContain('人口が3〜5万人の市町村（237団体）');
    view.update(tanabe(2020, 69_870));
    expect(text(q('.burden-year'))).toBe('規模は、2020年の人口 7.0万人で選んでいます。 実績（国勢調査）');
    expect(q('.burden-year .badge-official')).not.toBeNull();
    expect(text(q('.burden-band'))).toContain('人口が5〜10万人の市町村（237団体）');
    // the money is the same actual whatever the year
    expect(text(q('.burden-own'))).toBe('この町の令和6年度：1人あたり約680千円');
  });

  test('only the band of the selected year is marked, in the strip and in the table, and the mark moves with the year', () => {
    const { all, q } = mount();
    const marked = () => ({
      bar: all('.burden-bar').findIndex((e) => e.classList.contains('is-current')),
      ariaBar: all('.burden-bar').map((e) => e.getAttribute('aria-current')),
      row: all('.burden-band-table tbody tr').findIndex((e) => e.classList.contains('is-current')),
      hereVisible: all('.burden-here').filter((e) => !(e as HTMLElement).hidden).length,
    });
    expect(marked().bar).toBe(-1);
    expect(marked().hereVisible).toBe(0);
    view.update(tanabe(2100, 11_880));
    expect(marked()).toMatchObject({ bar: 2, row: 2, hereVisible: 2 });
    expect(marked().ariaBar).toEqual([null, null, 'true', null, null, null, null]);
    view.update(tanabe(2050, 42_311));
    expect(marked()).toMatchObject({ bar: 3, row: 3, hereVisible: 2 });
    expect(marked().ariaBar).toEqual([null, null, null, 'true', null, null, null]);
    expect(q('.burden-band-table tbody tr.is-current').getAttribute('aria-current')).toBe('true');
    expect(all('.burden-band-table tbody tr[aria-current]')).toHaveLength(1);
  });

  test('the band follows the population at the boundaries: 4,999 / 5,000 / 9,999 / 10,000 / 199,999 / 200,000', () => {
    const { all } = mount();
    const index = () => all('.burden-bar').findIndex((e) => e.classList.contains('is-current'));
    const at = (p: number) => {
      view.update(tanabe(2100, p));
      return index();
    };
    expect([4999, 5000, 9999, 10000, 199999, 200000].map(at)).toEqual([0, 1, 1, 2, 5, 6]);
    expect([0, 4999.4, 4999.5].map(at)).toEqual([0, 0, 1]);
  });

  test('the strip: a bar per band, its length is the median over the longest median, the town band is the accent bar', () => {
    const { all } = mount();
    view.update(tanabe(2100, 11_880));
    const bars = all('.burden-bar') as HTMLElement[];
    expect(bars.map((b) => b.querySelector('.burden-label')!.firstChild!.textContent)).toEqual(['5千人未満', '5千〜1万人', '1〜3万人', '3〜5万人', '5〜10万人', '10〜20万人', '20万人以上']);
    expect(bars.map((b) => b.querySelector('.burden-value')!.textContent)).toEqual(['1,733', '1,001', '724', '584', '502', '473', '477']);
    expect(bars.map((b) => b.style.getPropertyValue('--burden-w'))).toEqual(['100.00%', '57.76%', '41.78%', '33.70%', '28.97%', '27.29%', '27.52%']);
    expect(bars.every((b) => b.querySelector('.burden-track')!.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(bars.filter((b) => b.classList.contains('is-current'))).toHaveLength(1);
    expect(host.querySelector('.burden-bars')!.getAttribute('aria-label')).toContain('この町の規模に印が付いています');
  });

  test('the table lists the seven bands with count, median and the middle half, and marks the town band in words', () => {
    const { all } = mount();
    view.update(tanabe(2100, 11_880));
    const rows = all('.burden-band-table tbody tr').map((tr) => [...tr.children].map((c) => text(c)));
    expect(rows).toEqual([
      ['5千人未満', '302', '1,733', '1,390〜2,353'],
      ['5千〜1万人', '241', '1,001', '783〜1,332'],
      ['1〜3万人 この町の規模', '447', '724', '561〜883'],
      ['3〜5万人', '237', '584', '473〜690'],
      ['5〜10万人', '237', '502', '436〜599'],
      ['10〜20万人', '145', '473', '428〜556'],
      ['20万人以上', '132', '477', '428〜530'],
    ]);
    expect(all('.burden-band-table thead th').map(text)).toEqual(['人口の規模', '団体数', '中央値（千円）', '真ん中の半数（千円）']);
  });

  test('the published values are apart, labelled 令和5年度 and 団体区分, not population bands', () => {
    const { all, q } = mount();
    expect(text(q('.burden-table h4'))).toBe('公表されている区分別の値（令和5年度）');
    expect(all('.burden-published-table thead th').map(text)).toEqual(['団体区分', '1人あたりの歳出（千円）']);
    expect(all('.burden-published-table tbody tr').map((tr) => [...tr.children].map(text))).toEqual([
      ['中都市', '454'],
      ['小都市', '567'],
      ['町村（人口1万人以上）', '581'],
      ['町村（人口1万人未満）', '1,237'],
    ]);
    expect(text(q('.burden-published-note'))).toBe(
      '総務省「令和7年版 地方財政白書」第39表の値です。上の表（令和6年度、人口の規模）とは、年度も、分け方（人口の規模でなく団体区分）も違います。',
    );
    // the published rows are only inside the disclosure
    expect(q('.burden-published-table').closest('details.burden-table')).not.toBeNull();
    expect(text(q('.burden-national'))).toBe('全国の1,741団体の合計では、1人あたり約556千円です（歳出総額の合計 ÷ 住民基本台帳人口の合計）。');
  });
});

describe('a place without a settlement of its own', () => {
  test('a ward of a designated city: says there is no ward settlement and still shows the band for its size', () => {
    const { q, all } = mount();
    view.update({ code: '01101', kind: 'ward', year: 2100, population: 150_000 });
    expect(text(q('.burden-own'))).toBe('この区は政令指定都市の一部で、区ごとの決算はありません。');
    expect(text(q('.burden-band'))).toContain('人口が10〜20万人の市町村（145団体）');
    expect(all('.burden-bar.is-current')).toHaveLength(1);
  });

  test('the 浜通り area: says it is several municipalities and still shows the band', () => {
    const { q } = mount();
    view.update({ code: '07999', kind: 'hamadori', year: 2020, population: 560_000 });
    expect(text(q('.burden-own'))).toBe('この地域は複数の市町村をまとめたもので、地域としての決算はありません。');
    expect(text(q('.burden-band'))).toContain('人口が20万人以上の市町村（132団体）');
  });

  test('a special ward has its own figure', () => {
    const { q } = mount();
    view.update({ code: '13101', kind: 'ward', year: 2020, population: 66_680 });
    expect(text(q('.burden-own'))).toBe('この町の令和6年度：1人あたり約958千円');
  });

  test('a village of 160 people: the smallest band and a large figure of its own', () => {
    const { q } = mount();
    view.update({ code: '13402', kind: 'town', year: 2020, population: 169 });
    expect(text(q('.burden-own'))).toBe('この町の令和6年度：1人あたり約5,747千円');
    expect(text(q('.burden-band'))).toContain('人口が5千人未満の市町村（302団体）');
  });

  test('a population that is not a number picks no band and hides the year line and the band sentence, keeping the own figure', () => {
    const { q, all } = mount();
    view.update(tanabe(2100, 11_880));
    view.update(tanabe(2100, NaN));
    expect(q<HTMLElement>('.burden-year').hidden).toBe(true);
    expect(q<HTMLElement>('.burden-band').hidden).toBe(true);
    expect(q('.burden-year').textContent).toBe('');
    expect(all('.burden-bar.is-current')).toHaveLength(0);
    expect(all('.burden-here').filter((e) => !(e as HTMLElement).hidden)).toHaveLength(0);
    expect(text(q('.burden-own'))).toBe('この町の令和6年度：1人あたり約680千円');
    view.update(tanabe(2100, 11_880));
    expect(q<HTMLElement>('.burden-year').hidden).toBe(false);
    expect(q<HTMLElement>('.burden-band').hidden).toBe(false);
  });
});

describe('updates', () => {
  test('the table disclosure keeps its open state across updates (DOM state, not in the store)', () => {
    const { q } = mount();
    view.update(tanabe(2100, 11_880));
    const details = q<HTMLDetailsElement>('details.burden-table');
    details.open = true;
    view.update(tanabe(2050, 42_311));
    view.update({ code: '13402', kind: 'town', year: 2050, population: 160 });
    expect(q<HTMLDetailsElement>('details.burden-table')).toBe(details);
    expect(details.open).toBe(true);
  });

  test('an update with the same inputs rewrites nothing; a different input does', () => {
    const { q } = mount();
    view.update(tanabe(2100, 11_880));
    const firstBand = q('.burden-band').firstChild;
    view.update(tanabe(2100, 11_880.2)); // same whole person
    expect(q('.burden-band').firstChild).toBe(firstBand);
    view.update(tanabe(2100, 11_881));
    expect(q('.burden-band').firstChild).not.toBe(firstBand);
  });

  test('the year line is rewritten when only the year changes', () => {
    const { q } = mount();
    view.update(tanabe(2100, 11_880));
    view.update(tanabe(2095, 11_880));
    expect(text(q('.burden-year'))).toContain('2095年の人口');
  });

  test('one badge only, never two, after many updates', () => {
    const { all } = mount();
    for (const y of [2100, 2050, 2020, 2100, 2055]) view.update(tanabe(y, 11_880));
    expect(all('.burden-year .badge-estimate, .burden-year .badge-official')).toHaveLength(1);
  });

  test('destroy empties the host', () => {
    mount();
    view.update(tanabe(2100, 11_880));
    view.destroy();
    expect(host.childElementCount).toBe(0);
  });
});

describe('wording', () => {
  test('whatever is shown, there is no advice, no forecast word (only its denial), no word that judges the money, no arrow or circled number', () => {
    const { q } = mount();
    const seen: string[] = [];
    for (const input of [tanabe(2100, 11_880), tanabe(2050, 42_311), tanabe(2020, 69_870), { code: '01101', kind: 'ward' as const, year: 2100, population: 150_000 }, { code: '07999', kind: 'hamadori' as const, year: 2020, population: 560_000 }]) {
      view.update(input);
      seen.push(host.textContent!);
    }
    const all = seen.join('\n');
    expect(all.replace(/予測ではありません/g, '')).not.toContain('予測');
    for (const w of ['残せない', '閉鎖', 'すべき', 'おすすめ', 'お勧め', '良い', '悪い', '高すぎ', 'かかりすぎ', '節約', '集約', '削減', '守る', '残す', '残さ', '維持']) expect(all, w).not.toContain(w);
    expect(all).not.toMatch(/[←-⇿▲▶▼①-⑳]/);
    expect(text(q('.burden-limits'))).toContain('この町が将来これだけ使うという予測ではありません');
    expect(text(q('.burden-limits'))).toContain('災害復旧や大きな事業の年は値が跳ねます');
    expect(text(q('.burden-limits'))).toContain('町村や特別区は、都道府県が担う事務が市と違います');
  });

  test('the sentences are laid out as no-break phrases, so a number and its unit are never split', () => {
    const { all } = mount();
    view.update(tanabe(2100, 11_880));
    const phrases = all('.burden-band .keep').map((e) => e.textContent);
    expect(phrases).toEqual(['いま、', '人口が1〜3万人の市町村（447団体）：', '中央値 約724千円、', '真ん中の半数が561〜883千円。']);
  });
});
