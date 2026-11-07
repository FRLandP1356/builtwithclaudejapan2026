// @vitest-environment jsdom
// The section 「ここにある有名なもの」 inside the 分かれ目 card, on the real data and the real landmarks file: what it lists for
// a prefecture and for a town, when it is hidden, what a row's disclosure adds, and what the card never says.
import { afterEach, describe, expect, test } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import type { AppData } from '../data/loader';
import type { Landmark } from '../data/landmarks';
import { mountBoardPanel } from './boardPanel';
import { LANDMARKS_NOTE, LANDMARKS_TITLE_AREA, LANDMARKS_TITLE_PREF } from './landmarks';
import type { AppStoreInitial, PanelContext } from './state';

let mounted: { teardown: () => void } | undefined;

function setup(initial: AppStoreInitial = {}, data?: Partial<AppData>) {
  const base = makeRealContext(initial);
  const ctx: PanelContext = data ? { ...base, data: { ...base.data, ...data } } : base;
  const section = document.createElement('section');
  section.className = 'panel';
  section.id = 'panel-board';
  section.innerHTML = '<h2 class="panel-title" id="panel-board-title">分かれ目</h2>';
  document.body.append(section);
  const teardown = mountBoardPanel(section, ctx);
  mounted = { teardown };
  const q = <T extends HTMLElement = HTMLElement>(sel: string) => section.querySelector<T>(sel);
  const qa = <T extends HTMLElement = HTMLElement>(sel: string) => [...section.querySelectorAll<T>(sel)];
  const items = () => qa<HTMLLIElement>('.landmark');
  const text = (li: Element, sel: string) => li.querySelector(sel)?.textContent ?? null;
  return { ctx, store: ctx.store, section, q, qa, items, text, landmarks: () => q('.landmarks')! };
}

afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

const WAKAYAMA_NAMES = ['和歌山城', '熊野本宮大社', '滝尻王子', '高野山 金剛峯寺', 'アドベンチャーワールド', '白浜温泉', '熊野那智大社', '那智の滝'];

describe('a prefecture (和歌山県)', () => {
  test('the title, the eight items in the file order, each with its town, its kind, its sentence and its source', () => {
    const { ctx, q, items, text } = setup({ selectedPref: '30' });
    expect(q('.landmarks')!.hidden).toBe(false);
    expect(q('.landmarks-title')!.textContent).toBe(LANDMARKS_TITLE_PREF);
    expect(q('.landmark-list')!.className).toBe('landmark-list is-pref');
    expect(items().map((li) => text(li, '.landmark-name'))).toEqual(WAKAYAMA_NAMES);
    expect(items().map((li) => li.querySelector('.landmark-town')!.firstChild!.textContent)).toEqual(['和歌山市', '田辺市', '田辺市', '高野町', '白浜町', '白浜町', '那智勝浦町', '那智勝浦町']);
    expect(items().map((li) => text(li, '.landmark-kind'))).toEqual(['城', '神社', '観光地', '寺院', 'テーマパーク', '温泉地', '神社', '自然']);
    const data = ctx.data.landmarks!.filter((l) => l.prefCode === '30');
    items().forEach((li, i) => {
      expect(li.dataset.id).toBe(data[i].id);
      expect(li.dataset.area).toBe(data[i].areaCode);
      expect(text(li, '.landmark-summary')).toBe(data[i].summary);
      expect(text(li, '.landmark-source')).toBe(`出典：${data[i].sourceLabel}`);
      const a = li.querySelector<HTMLAnchorElement>('.landmark-source a')!;
      expect(a.getAttribute('href')).toBe(data[i].source);
      expect(a.textContent).toBe(data[i].sourceLabel);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  test('the kind is text in the shared tag: no class of its own that could carry a colour', () => {
    const { items } = setup({ selectedPref: '30' });
    for (const li of items()) expect([...li.querySelector('.landmark-kind')!.classList]).toEqual(['tag', 'landmark-kind']);
  });

  test('the section sits after the rows (and their fold) and before the claims section, which comes before the card\'s notes; its own note is at the end', () => {
    const { q, landmarks } = setup({ selectedPref: '30' });
    expect(landmarks().previousElementSibling).toBe(q('.board-others'));
    expect(landmarks().nextElementSibling).toBe(q('.claims'));
    expect(q('.claims')!.nextElementSibling).toBe(q('.board-already'));
    expect(landmarks().lastElementChild!.className).toBe('note landmarks-note');
    expect(landmarks().lastElementChild!.textContent).toBe(LANDMARKS_NOTE);
    expect(landmarks().firstElementChild!.tagName).toBe('H3');
    expect(landmarks().firstElementChild!.classList.contains('panel-section-title')).toBe(true);
  });

  test('the town\'s button reads 「田辺市を選ぶ」 and selects the town: the store moves and the section becomes the town\'s', () => {
    const { store, q, items } = setup({ selectedPref: '30' });
    const btn = items()[1].querySelector<HTMLButtonElement>('.landmark-town')!;
    expect(btn.type).toBe('button');
    expect(btn.textContent).toBe('田辺市を選ぶ');
    btn.click();
    expect(store.get().selectedArea).toBe('30206');
    expect(store.get().selectedPref).toBe('30');
    expect(q('.landmarks-title')!.textContent).toBe(LANDMARKS_TITLE_AREA);
    expect(items().map((li) => li.querySelector('.landmark-name')!.textContent)).toEqual(['熊野本宮大社', '滝尻王子']);
    expect(q('.landmark-town')).toBeNull();
    expect(q('.board-heading')!.textContent).toBe('田辺市で、人口の目安を下回る施設と、その年');
  });

  test('高知県: the airport is listed as a thing that is there, like the rest', () => {
    const { items, text } = setup({ selectedPref: '39' });
    const names = items().map((li) => text(li, '.landmark-name'));
    expect(names).toContain('高知龍馬空港');
    const airport = items()[names.indexOf('高知龍馬空港')];
    expect(text(airport, '.landmark-kind')).toBe('空港・港・鉄道・橋（インフラ）');
    expect(airport.querySelector('.landmark-town')!.firstChild!.textContent).toBe('南国市');
  });
});

describe('a town', () => {
  test('田辺市: the town\'s title, its two items in the file order, no place column', () => {
    const { q, items, text } = setup({ selectedArea: '30206' });
    expect(q('.landmarks')!.hidden).toBe(false);
    expect(q('.landmarks-title')!.textContent).toBe(LANDMARKS_TITLE_AREA);
    expect(q('.landmark-list')!.className).toBe('landmark-list is-area');
    expect(items().map((li) => text(li, '.landmark-name'))).toEqual(['熊野本宮大社', '滝尻王子']);
    expect(q('.landmark-place')).toBeNull();
    expect(q('.landmark-town')).toBeNull();
  });

  test('大阪市此花区: the theme park, with its sentence as written', () => {
    const { items, text } = setup({ selectedArea: '27104' });
    expect(items().map((li) => text(li, '.landmark-name'))).toEqual(['ユニバーサル・スタジオ・ジャパン']);
    expect(text(items()[0], '.landmark-summary')).toBe('大阪市此花区にあるテーマパーク。');
  });

  test('a town with no item (北山村): the section is hidden and empty, nothing says 「ありません」; the board is unchanged', () => {
    const { q, items, section } = setup({ selectedArea: '30427' });
    expect(q('.landmarks')!.hidden).toBe(true);
    expect(items()).toEqual([]);
    expect(q('.board-heading')!.textContent).toBe('北山村で、人口の目安を下回る施設と、その年');
    expect(section.textContent).not.toContain('有名なもの');
  });
});

describe('hidden', () => {
  test('the whole country: hidden', () => {
    const { q } = setup({});
    expect(q('.landmarks')!.hidden).toBe(true);
    expect(q('.landmark')).toBeNull();
  });

  test('without the landmarks file (the load left it out): hidden for a prefecture and a town, and the rows are as before', () => {
    const { q, qa, store } = setup({ selectedPref: '30' }, { landmarks: undefined });
    expect(q('.landmarks')!.hidden).toBe(true);
    expect(qa('.board-row').length).toBeGreaterThan(0);
    store.set({ selectedArea: '30206' });
    expect(q('.landmarks')!.hidden).toBe(true);
    expect(q('.board-heading')!.textContent).toBe('田辺市で、人口の目安を下回る施設と、その年');
  });

  test('a new place shows or hides the section as the place has items or not', () => {
    const { q, store } = setup({ selectedArea: '30427' });
    expect(q('.landmarks')!.hidden).toBe(true);
    store.set({ selectedPref: '01' });
    expect(q('.landmarks')!.hidden).toBe(false);
    expect(q('.landmark-name')!.textContent).toBe('札幌市時計台');
    store.set({ selectedPref: undefined });
    expect(q('.landmarks')!.hidden).toBe(true);
  });
});

describe('the data is shown as text, as written', () => {
  const synthetic = (over: Partial<Landmark>): Landmark => ({
    id: 'synthetic',
    name: '合成の名前',
    kind: '観光地',
    prefCode: '30',
    areaCode: '30206',
    summary: '合成の1文。',
    source: 'https://example.org/',
    sourceLabel: '合成の出典',
    ...over,
  });

  test('a source that is not https is written, not linked', () => {
    const { q } = setup({ selectedArea: '30206' }, { landmarks: [synthetic({ source: 'http://example.org/' })] });
    expect(q('.landmark-source a')).toBeNull();
    expect(q('.landmark-source')!.textContent).toBe('出典：合成の出典');
  });

  test('markup in a name or a sentence stays literal (textContent, never innerHTML)', () => {
    const { q } = setup({ selectedArea: '30206' }, { landmarks: [synthetic({ name: '<b>太字</b>', summary: '<img src=x onerror=alert(1)>' })] });
    expect(q('.landmark-name')!.textContent).toBe('<b>太字</b>');
    expect(q('.landmark-name b')).toBeNull();
    expect(q('.landmark-summary img')).toBeNull();
  });
});

describe('the one line under a row\'s 「ここを残すには」', () => {
  test('田辺市, 結婚式場業 in 2035: after the body, 「この町にある有名なもの：熊野本宮大社、滝尻王子」, with no tie to the facility', () => {
    const { q } = setup({ selectedArea: '30206' });
    const row = q('.board-others .board-row[data-facility="wedding_hall"]')!;
    expect(row.dataset.year).toBe('2035');
    row.querySelector<HTMLElement>('.board-keep > summary')!.click();
    const body = row.querySelector('.board-keep-body')!;
    const line = body.querySelector('.board-keep-landmarks')!;
    expect(line.textContent).toBe('この町にある有名なもの：熊野本宮大社、滝尻王子');
    expect(line.classList.contains('note')).toBe(true);
    expect(body.lastElementChild).toBe(line);
    expect(line.textContent).not.toContain('結婚式場');
  });

  test('a row whose town has no item (和歌山県\'s first row, 美浜町) has no such line', () => {
    const { q } = setup({ selectedPref: '30' });
    const row = q('.board-list > .board-row')!;
    expect(row.querySelector('.board-row-towns')!.textContent).toContain('美浜町');
    row.querySelector<HTMLElement>('.board-keep > summary')!.click();
    expect(row.querySelector('.board-keep-body')).not.toBeNull();
    expect(row.querySelector('.board-keep-landmarks')).toBeNull();
  });

  test('without the landmarks file no row has the line', () => {
    const { q } = setup({ selectedArea: '30206' }, { landmarks: undefined });
    const row = q('.board-others .board-row[data-facility="wedding_hall"]')!;
    row.querySelector<HTMLElement>('.board-keep > summary')!.click();
    expect(row.querySelector('.board-keep-body')).not.toBeNull();
    expect(row.querySelector('.board-keep-landmarks')).toBeNull();
  });
});

describe('wording of the card with the section in it', () => {
  test('for 和歌山県, 大阪府, 高知県, 東京都, 北海道 and 田辺市: it lists and cites; it never predicts, judges or recommends', () => {
    for (const initial of [{ selectedPref: '30' }, { selectedPref: '27' }, { selectedPref: '39' }, { selectedPref: '13' }, { selectedPref: '01' }, { selectedArea: '30206' }]) {
      const { section, q } = setup(initial);
      expect(q('.landmarks')!.hidden, JSON.stringify(initial)).toBe(false);
      // The section itself: nothing that predicts, judges or recommends, in any form.
      const sectionText = q('.landmarks')!.textContent!;
      expect(sectionText).toContain('出典：');
      for (const w of ['残せない', '閉鎖', 'なくなる', '撤退', '廃止', '危機', '消える', '予測', '私', 'べき', 'おすすめ', '勧め', '→', '①', '②']) {
        expect(sectionText, `${w} for ${JSON.stringify(initial)}`).not.toContain(w);
      }
      // The whole card keeps the board's own rule (its guide note says, in the negative, that a facility is not decided to be gone).
      const cardText = section.textContent!;
      for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', 'おすすめ', '勧め', '→', '①', '②']) {
        expect(cardText, `${w} for ${JSON.stringify(initial)}`).not.toContain(w);
      }
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });
});
