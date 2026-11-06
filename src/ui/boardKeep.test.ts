// @vitest-environment jsdom
// 「ここを残すには」 under a row of the board, on the real data: the two sides, the map button, one open at a time.
import { afterEach, describe, expect, test } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import { populationAt } from './allocationCore';
import { balanceSides, BOARD_KEEP_CHOICE, BOARD_KEEP_CHOICE_QUIET, BOARD_KEEP_SUMMARY, keepLead } from './boardKeep';
import { mountBoardPanel } from './boardPanel';
import { computeKeep, KEEP_APPLIED, KEEP_LIMITS, keepEffectLine } from './keepGuide';
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
  const rowAt = (i: number) => qa<HTMLLIElement>(':scope > .board > .board-list > .board-row')[i];
  const keepOf = (row: HTMLElement) => row.querySelector<HTMLDetailsElement>('details.board-keep')!;
  /** Open through the summary's click, as a mouse or Enter does. */
  const open = (details: HTMLDetailsElement) => {
    details.querySelector('summary')!.click();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
  };
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return { ctx, store: ctx.store, section, q, qa, rowAt, keepOf, open, text };
}

afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

describe('wording (pure)', () => {
  test('the lead names the town, the year, the facility and its guide', () => {
    expect(keepLead('田辺市', 2035, { name: '一般病院', p50: 5000 })).toBe('田辺市が、2035年に一般病院の人口の目安（5,000人）に届くには');
  });

  test('the two sides carry the same number of people, one in, one out', () => {
    const [keep, cost] = balanceSides('美浜町', 360);
    expect(keep).toEqual({ title: 'ここを残すには', amount: '+約360人', who: '美浜町に、ほかの町から移ってくる人' });
    expect(cost).toEqual({ title: '代わりに', amount: '−約360人', who: 'ほかの町から、人口に比例して減る人' });
    expect(keep.amount.slice(1)).toBe(cost.amount.slice(1));
  });

  test('the choice line names the trade and nothing else; no advice, no 残せない, no arrow', () => {
    expect(BOARD_KEEP_CHOICE).toBe('どこかを残すと、別のどこかが目安を下回ります。選ぶのはあなたです。');
    for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', '→', '①']) expect(BOARD_KEEP_CHOICE).not.toContain(w);
  });

  test('where nothing else falls below, the choice line says only what is always true (the total is fixed), and claims no loss', () => {
    expect(BOARD_KEEP_CHOICE_QUIET).toBe('人口の合計は変わらないので、ここを増やした分は、ほかの町で減ります。どこを増やすかは、あなたが選びます。');
    expect(BOARD_KEEP_CHOICE_QUIET).not.toContain('下回ります');
    for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', '→', '①']) expect(BOARD_KEEP_CHOICE_QUIET).not.toContain(w);
  });
});

describe('closed, nothing is built', () => {
  test('every row has the disclosure, closed, with the summary 「ここを残すには」 and the town and facility for a screen reader', () => {
    const { rowAt, keepOf, text } = setup({ selectedPref: '30' });
    const d = keepOf(rowAt(0));
    expect(d.open).toBe(false);
    expect(text(d.querySelector('summary'))).toBe(`${BOARD_KEEP_SUMMARY}（美浜町・銀行（中央銀行を除く））`);
    expect(d.querySelector('.board-keep-body')).toBeNull();
    expect(d.querySelector('button')).toBeNull();
  });
});

describe('opened: 美浜町, 銀行, 2025 (the first row of 和歌山県)', () => {
  test('the two sides, the effect elsewhere and the facilities with the most towns, from computeKeep on the row\'s year', () => {
    const { ctx, store, rowAt, keepOf, open, text } = setup({ selectedPref: '30', year: 2050 });
    const row = rowAt(0);
    expect(row.dataset).toMatchObject({ year: '2025', facility: 'bank', area: '30381' });
    const d = keepOf(row);
    open(d);
    const facility = ctx.data.facilities.find((f) => f.id === 'bank')!;
    const at = populationAt(ctx.data, store.get().series, 2025);
    const c = computeKeep(at, ctx.data.facilities, facility, '30381')!;
    expect(c.outcome.kind).toBe('ok');
    if (c.outcome.kind !== 'ok') return;
    expect(text(d.querySelector('.board-keep-lead'))).toBe(`美浜町が、2025年に銀行（中央銀行を除く）の人口の目安（${facility.p50.toLocaleString('ja-JP')}人）に届くには`);
    expect(d.querySelector('.board-keep-lead .badge-estimate')).toBeNull(); // 2025 is official
    const amounts = [...d.querySelectorAll('.board-balance-amount')].map((e) => e.textContent);
    const n = `約${Math.abs(c.outcome.people).toLocaleString('ja-JP')}人`;
    expect(amounts).toEqual([`+${n}`, `−${n}`]);
    expect(text(d.querySelector('.board-keep-effect'))).toBe(keepEffectLine(c.outcome.effects));
    expect([...d.querySelectorAll('.board-keep-top-item')].map((li) => li.textContent)).toEqual(c.outcome.effects.top.map((l) => `${l.name}（${l.count}町）`));
    expect(d.querySelector<HTMLElement>('.board-keep-top')!.hidden).toBe(c.outcome.effects.top.length === 0);
    // the choice line follows the effect line: it never says something falls below where the line above says nothing does
    expect(text(d.querySelector('.board-keep-choice'))).toBe(c.outcome.effects.areaCount > 0 ? BOARD_KEEP_CHOICE : BOARD_KEEP_CHOICE_QUIET);
    expect(text(d.querySelector('.board-keep-limits'))).toBe(KEEP_LIMITS);
    expect(d.querySelector<HTMLElement>('.board-keep-message')!.hidden).toBe(true);
    // the bars: one gain, one loss, both decorative
    expect([...d.querySelectorAll('.board-balance-bar')].map((b) => b.className)).toEqual(['board-balance-bar is-gain', 'board-balance-bar is-loss']);
    expect([...d.querySelectorAll('.board-balance-bar')].every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  test('a row whose what-if makes other towns fall below lists the facilities with the most towns (the whole country, 2025)', () => {
    const { ctx, store, qa, keepOf, open, text } = setup({ year: 2050 });
    // the first row whose moved people push some other town below a guide
    for (const row of qa<HTMLLIElement>('.board-row')) {
      const facility = ctx.data.facilities.find((f) => f.id === row.dataset.facility)!;
      const at = populationAt(ctx.data, store.get().series, Number(row.dataset.year));
      const c = computeKeep(at, ctx.data.facilities, facility, row.dataset.area!)!;
      if (c.outcome.kind !== 'ok' || c.outcome.effects.top.length === 0) continue;
      const d = keepOf(row);
      open(d);
      expect(text(d.querySelector('.board-keep-effect'))).toBe(`このとき、ほかの${c.outcome.effects.areaCount.toLocaleString('ja-JP')}町が、いずれかの施設の人口の目安を下回ります。`);
      expect(d.querySelector<HTMLElement>('.board-keep-top')!.hidden).toBe(false);
      expect([...d.querySelectorAll('.board-keep-top-item')].map((li) => li.textContent)).toEqual(c.outcome.effects.top.map((l) => `${l.name}（${l.count}町）`));
      expect(text(d.querySelector('.board-keep-choice'))).toBe(BOARD_KEEP_CHOICE);
      return;
    }
    throw new Error('no row with an effect elsewhere');
  });

  test('a row after 2050 marks its lead 試算', () => {
    const { qa, keepOf, open } = setup({ selectedPref: '30' });
    const late = qa<HTMLLIElement>('.board-row').find((li) => Number(li.dataset.year) > 2050)!;
    const d = keepOf(late);
    open(d);
    expect(d.querySelector('.board-keep-lead .badge-estimate')!.textContent).toBe('試算');
  });

  test('the button hands the what-if to the map for the row\'s year, with this facility in focus; the status says so', () => {
    const { store, rowAt, keepOf, open } = setup({ selectedPref: '30', year: 2050 });
    const d = keepOf(rowAt(0));
    open(d);
    d.querySelector<HTMLButtonElement>('.board-keep-reflect')!.click();
    const a = store.get().allocation!;
    expect(a).toBeDefined();
    expect(a.year).toBe(2025);
    expect(store.get().year).toBe(2025); // the year moved to the what-if's year in the same patch
    expect(a.focusFacilityId).toBe('bank');
    expect(a.label).toMatch(/^美浜町 \+/);
    expect(d.querySelector('.board-keep-status')!.textContent).toBe(KEEP_APPLIED);
    expect(a.changePercent['30381']).toBeGreaterThan(0);
    // the row's own open state and the list stay
    expect(d.open).toBe(true);
    expect(store.get().selectedPref).toBe('30');
  });
});

describe('one open at a time', () => {
  test('opening a second one closes the first; another place rebuilds the rows with all closed', () => {
    const { store, rowAt, keepOf, open, qa } = setup({ selectedPref: '30' });
    const first = keepOf(rowAt(0));
    const second = keepOf(rowAt(1));
    open(first);
    expect(first.open).toBe(true);
    open(second);
    expect(second.open).toBe(true);
    expect(first.open).toBe(false);
    store.set({ selectedPref: '39' });
    expect(qa<HTMLDetailsElement>('details.board-keep').every((d) => !d.open)).toBe(true);
    expect(qa('.board-keep-body')).toHaveLength(0);
  });

  test('a town\'s own rows (田辺市, the others) have the disclosure too, for the town itself', () => {
    const { q, open, text } = setup({ selectedArea: '30206' });
    const d = q<HTMLDetailsElement>('.board-others details.board-keep')!;
    expect(text(d.querySelector('summary'))).toBe(`${BOARD_KEEP_SUMMARY}（田辺市・結婚式場業）`);
    open(d);
    expect(text(d.querySelector('.board-keep-lead'))).toMatch(/^田辺市が、2035年に結婚式場業の人口の目安（/);
    expect([...d.querySelectorAll('.board-balance-who')].map((e) => e.textContent)).toEqual(['田辺市に、ほかの町から移ってくる人', 'ほかの町から、人口に比例して減る人']);
  });
});

describe('wording of everything a disclosure says', () => {
  test('the first three rows of 和歌山県 and 高知県, opened: never 残せない, 閉鎖, 撤退, 廃止, 予測 or 私; the choice stays with the reader', () => {
    for (const pp of ['30', '39']) {
      const { qa, keepOf, open, section } = setup({ selectedPref: pp });
      for (const row of qa<HTMLLIElement>(':scope > .board > .board-list > .board-row').slice(0, 3)) open(keepOf(row));
      const all = section.textContent!.replace(/予測ではありません/g, '');
      for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', 'おすすめ', '→', '①']) expect(all, `${w} in ${pp}`).not.toContain(w);
      expect(all).toMatch(/選ぶのはあなたです|あなたが選びます/); // the line with a loss, or the quiet line: either way the choice is the reader's
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });
});
