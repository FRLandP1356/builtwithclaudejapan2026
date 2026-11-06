// @vitest-environment jsdom
// The 「分かれ目」 panel in the DOM, on the real data: what it shows for the country, a prefecture and a town, how it follows
// the store, and what it never says.
import { afterEach, describe, expect, test } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import { BOARD_GUIDE_NOTE, BOARD_NONE_ESSENTIAL, BOARD_ROWS } from './board';
import { mountBoardPanel } from './boardPanel';
import type { AppStoreInitial, PanelContext } from './state';

let mounted: { section: HTMLElement; teardown: () => void } | undefined;

function setup(initial: AppStoreInitial = {}) {
  const ctx: PanelContext = makeRealContext(initial);
  const section = document.createElement('section');
  section.className = 'panel';
  section.id = 'panel-board';
  section.innerHTML = '<h2 class="panel-title" id="panel-board-title">分かれ目</h2>';
  document.body.append(section);
  const teardown = mountBoardPanel(section, ctx);
  mounted = { section, teardown };
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => section.querySelector<T>(sel);
  const qa = <T extends HTMLElement = HTMLElement>(sel: string) => [...section.querySelectorAll<T>(sel)];
  /** 「2035年 試算 結婚式場業 美浜町 ほか1町」: the year (with its mark), the facility and the towns, joined by spaces. */
  const rowText = (li: Element) =>
    [...li.querySelectorAll('.board-row-year, .board-row-facility, .board-row-towns')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()).join(' ');
  const rows = (listSel = ':scope > .board > .board-list') => qa(`${listSel} > .board-row`).map(rowText);
  return { ctx, store: ctx.store, section, teardown, q, qa, rows, rowText };
}

afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

describe('what the panel shows', () => {
  test('the country (nothing selected): the heading, 16 bars, the six earliest rows, the rest folded, what is already below', () => {
    const { q, qa, rows } = setup({ year: 2050 });
    expect(q('.board-heading')!.textContent).toBe('日本全体で、人口の目安を下回っていく順番');
    expect(qa('.board-bars > .board-bar')).toHaveLength(16);
    expect(qa('.board-bar').map((b) => (b as HTMLElement).dataset.year)[0]).toBe('2025');
    expect(qa('.board-bar.is-estimate')).toHaveLength(10); // 2055 .. 2100
    expect(q('.board-years-lead')!.textContent).toBe('5年ごとに、新しく人口の目安を下回る町の数（主な8施設のいずれか）');
    expect(q('.board-years-summary')!.textContent).toBe('いちばん多いのは2070年（156町）。');
    expect(rows()).toHaveLength(BOARD_ROWS);
    expect(rows()[0]).toBe('2025年 飲食料品小売業 売木村（長野県） ほか2町');
    const more = q<HTMLDetailsElement>('.board-more')!;
    expect(more.hidden).toBe(false);
    expect(more.querySelector('summary')!.textContent).toBe('続きを見る（残り122件）');
    expect(more.querySelectorAll('.board-row')).toHaveLength(122);
    expect(q('.board-others')!.hasAttribute('hidden')).toBe(true);
    expect(q('.board-already')!.textContent).toBe('2020年の時点で、すでに主な8施設のいずれかの目安を下回る：470町');
    expect(q('.board-note')!.textContent).toBe(BOARD_GUIDE_NOTE);
    expect(q('.board-none')!.hidden).toBe(true);
  });

  test('a prefecture (和歌山県): the heading names it and the first row is 2025, 銀行, 美浜町 ほか1町', () => {
    const { q, rows } = setup({ selectedPref: '30' });
    expect(q('.board-heading')!.textContent).toBe('和歌山県で、人口の目安を下回っていく順番');
    expect(rows()[0]).toBe('2025年 銀行（中央銀行を除く） 美浜町 ほか1町');
    expect(rows()[2]).toBe('2025年 訪問介護事業 日高川町');
    expect(q('.board-already')!.textContent).toBe('2020年の時点で、すでに主な8施設のいずれかの目安を下回る：12町');
    expect(q('.board-essential-note')!.hidden).toBe(false);
  });

  test('a town (田辺市): no essential row, the others folded with their count, 11 already below, the strip counts facilities', () => {
    const { q, qa, rows, rowText } = setup({ selectedArea: '30206' });
    expect(q('.board-heading')!.textContent).toBe('田辺市で、人口の目安を下回る施設と、その年');
    expect(rows()).toEqual([]);
    expect(q('.board-none')!.hidden).toBe(false);
    expect(q('.board-none')!.textContent).toBe(BOARD_NONE_ESSENTIAL);
    const others = q<HTMLDetailsElement>('.board-others')!;
    expect(others.hidden).toBe(false);
    expect(others.querySelector('summary')!.textContent).toBe('その他の施設（18）');
    const otherRows = [...others.querySelectorAll('.board-row')].map(rowText);
    expect(otherRows.slice(0, 3)).toEqual(['2035年 結婚式場業', '2035年 博物館、美術館', '2035年 法律事務所']);
    expect(otherRows.at(-1)).toBe('2090年 試算 税理士事務所');
    expect(q('.board-more')!.hasAttribute('hidden')).toBe(true);
    expect(q('.board-already')!.textContent).toBe('2020年の時点で、すでに目安を下回る：11種類');
    expect(q('.board-years-lead')!.textContent).toBe('5年ごとに、新しく人口の目安を下回る施設の数');
    expect(qa('.board-bar').find((b) => (b as HTMLElement).dataset.year === '2065')!.querySelector('.board-bar-value')!.textContent).toBe('4');
    expect(q('.board-essential-note')!.hidden).toBe(true);
    // a row's data attributes name the year, the facility and the town, for the disclosure and for tests
    const first = others.querySelector<HTMLElement>('.board-row')!;
    expect(first.dataset).toMatchObject({ year: '2035', facility: 'wedding_hall', area: '30206' });
  });

  test('a row after 2050 carries the 試算 mark; one up to 2050 does not', () => {
    const { qa } = setup({ selectedPref: '30' });
    const all = qa<HTMLElement>('.board-row');
    const early = all.find((li) => li.dataset.year === '2025')!;
    const late = all.find((li) => Number(li.dataset.year) > 2050)!;
    expect(early.querySelector('.badge-estimate')).toBeNull();
    expect(late.querySelector('.badge-estimate')!.textContent).toBe('試算');
  });

  test('the strip\'s table lists every year with its number and unit, estimate rows marked', () => {
    const { qa } = setup({ selectedPref: '30' });
    const trs = qa<HTMLTableRowElement>('.board-years-table tbody tr');
    expect(trs).toHaveLength(16);
    expect(trs[0].textContent).toBe('2025年3町');
    expect(trs[0].classList.contains('is-estimate')).toBe(false);
    expect(trs[15].textContent).toBe('2100年3町');
    expect(trs[15].classList.contains('is-estimate')).toBe(true);
  });
});

describe('following the store', () => {
  test('the year on screen marks its bar and shows its number; the tallest bars keep theirs', () => {
    const { store, qa } = setup({ selectedPref: '30', year: 2050 });
    const bar = (y: number) => qa<HTMLElement>('.board-bar').find((b) => b.dataset.year === String(y))!;
    expect(bar(2050).getAttribute('aria-current')).toBe('true');
    expect(bar(2050).querySelector('.board-bar-value')!.textContent).toBe('2');
    expect(bar(2045).querySelector('.board-bar-value')!.textContent).toBe('6'); // the maximum
    expect(bar(2030).querySelector('.board-bar-value')!.textContent).toBe('');
    const before = qa('.board-row');
    store.set({ year: 2030 });
    expect(bar(2050).hasAttribute('aria-current')).toBe(false);
    expect(bar(2050).querySelector('.board-bar-value')!.textContent).toBe('');
    expect(bar(2030).getAttribute('aria-current')).toBe('true');
    expect(bar(2030).querySelector('.board-bar-value')!.textContent).toBe('1');
    expect(qa('.board-row')).toEqual(before); // a year change does not rebuild the list
  });

  test('a new place rebuilds the list; going back to the country restores it', () => {
    const { store, q, rows } = setup({ year: 2050 });
    store.set({ selectedArea: '30206' });
    expect(q('.board-heading')!.textContent).toBe('田辺市で、人口の目安を下回る施設と、その年');
    store.set({ selectedPref: '39' });
    expect(q('.board-heading')!.textContent).toBe('高知県で、人口の目安を下回っていく順番');
    expect(rows()[0]).toBe('2025年 一般病院 中土佐町');
    store.set({ selectedPref: undefined });
    expect(q('.board-heading')!.textContent).toBe('日本全体で、人口の目安を下回っていく順番');
    expect(rows()[0]).toBe('2025年 飲食料品小売業 売木村（長野県） ほか2町');
  });

  test('a change of assumptions recomputes the rows (the same facilities cross in other years)', () => {
    const { store, q, qa, rowText } = setup({ selectedArea: '30206' });
    const before = qa('.board-others .board-row').map(rowText);
    expect(q('.board-others summary')!.textContent).toBe('その他の施設（18）');
    store.set({ scenario: { ...store.get().scenario, cwrMult: 1.4, migScale: 0 } });
    const after = qa('.board-others .board-row').map(rowText);
    expect(after).not.toEqual(before); // more births and no migration: the crossings move
    expect(q('.board-years-summary')!.textContent).not.toBe('');
  });

  test('teardown removes the panel\'s content and its subscription', () => {
    const { store, section, teardown } = setup();
    teardown();
    expect(section.querySelector('.board')).toBeNull();
    expect(section.querySelector('h2.panel-title')).not.toBeNull();
    expect(() => store.set({ year: 2100 })).not.toThrow();
    mounted = undefined;
  });

  test('mounting twice into the same element replaces the first panel', () => {
    const { ctx, section } = setup();
    const again = mountBoardPanel(section, ctx);
    expect(section.querySelectorAll('.board')).toHaveLength(1);
    again();
  });
});

describe('wording of everything the panel says', () => {
  test('for the country, 和歌山県, 四国 and 田辺市: never 残せない, 閉鎖, 撤退, 廃止 or 予測, no arrow, no circled number', () => {
    for (const initial of [{}, { selectedPref: '30' }, { selectedPref: '36' }, { selectedPref: '37' }, { selectedPref: '38' }, { selectedPref: '39' }, { selectedArea: '30206' }]) {
      const { section } = setup(initial);
      const text = section.textContent!;
      for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', '→', '①', '②']) expect(text, `${w} for ${JSON.stringify(initial)}`).not.toContain(w);
      expect(text).toContain('人口の目安を下回');
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });
});
