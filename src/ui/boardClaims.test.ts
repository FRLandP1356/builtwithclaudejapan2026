// @vitest-environment jsdom
// The section 「公表資料に書かれていること」 inside the 分かれ目 card, on the real data and the real claims file: when it is shown
// (a prefecture with a quotation, and only then), what each item holds, the five and the fold, and what the card never says.
import { afterEach, describe, expect, test } from 'vitest';
import { OWN_WORDS_BANNED } from '../../test/helpers/ownWords';
import { rawClaimsFile } from '../../test/helpers/loadClaims';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import type { Claim } from '../data/claims';
import type { AppData } from '../data/loader';
import { mountBoardPanel } from './boardPanel';
import { CLAIMS_NOTE, CLAIMS_TAG_FACT, CLAIMS_TAG_POSSIBILITY, CLAIMS_TITLE, formatClaimDate } from './claims';
import { moreText } from './board';
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
  return {
    ctx,
    store: ctx.store,
    section,
    q,
    qa,
    claims: () => q('.claims')!,
    shown: () => qa<HTMLLIElement>('.claims > .claim-list > .claim'),
    folded: () => qa<HTMLLIElement>('.claims-more .claim'),
    all: () => qa<HTMLLIElement>('.claim'),
  };
}

/** The text a reader can see: the card without the parts that carry `hidden` (jsdom's textContent counts them). */
function visibleText(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll('[hidden]')) hidden.remove();
  return copy.textContent ?? '';
}

afterEach(() => {
  mounted?.teardown();
  mounted = undefined;
  document.body.replaceChildren();
});

const real = rawClaimsFile().items as Claim[];
const ofPref = (p: string) => real.filter((c) => c.prefCodes.includes(p));

describe('a prefecture with quotations (高知県)', () => {
  test('the title strip, the note under it, then eleven items: the first five, the other six behind 「続きを見る（残り6件）」', () => {
    const { claims, q, shown, folded, all } = setup({ selectedPref: '39' });
    expect(claims().hidden).toBe(false);
    expect(claims().firstElementChild!.tagName).toBe('H3');
    expect(claims().firstElementChild!.classList.contains('panel-section-title')).toBe(true);
    expect(claims().firstElementChild!.textContent).toBe(CLAIMS_TITLE);
    const note = claims().children[1];
    expect(note.className).toBe('note claims-note');
    expect(note.textContent).toBe(CLAIMS_NOTE);
    expect(all()).toHaveLength(11);
    expect(shown()).toHaveLength(5);
    expect(folded()).toHaveLength(6);
    const more = q<HTMLDetailsElement>('.claims-more')!;
    expect(more.hidden).toBe(false);
    expect(more.open).toBe(false);
    expect(more.querySelector('summary')!.textContent).toBe('続きを見る（残り6件）');
    expect(more.querySelector('summary')!.textContent).toBe(moreText(6));
  });

  test('the items are the file\'s, in the file\'s order, the first five before the fold', () => {
    const { all } = setup({ selectedPref: '39' });
    expect(all().map((li) => li.dataset.id)).toEqual(ofPref('39').map((c) => c.id));
  });

  test('the section sits after 「ここにある有名なもの」 and before the card\'s own notes', () => {
    const { q, claims } = setup({ selectedPref: '39' });
    expect(claims().previousElementSibling).toBe(q('.landmarks'));
    expect(claims().nextElementSibling).toBe(q('.board-already'));
  });

  test('an item: the subject, the tag, the quotation, the source with its date; and nothing else', () => {
    const { shown } = setup({ selectedPref: '39' });
    const first = shown()[0];
    const c = ofPref('39')[0];
    expect(first.dataset.stance).toBe(c.stance);
    expect([...first.children].map((el) => el.className)).toEqual(['claim-head', 'claim-quote', 'note claim-source']);
    expect(first.querySelector('.claim-head')!.firstElementChild!.className).toBe('claim-subject');
    expect(first.querySelector('.claim-subject')!.textContent).toBe(c.subject);
    expect(first.querySelector('.claim-quote')!.tagName).toBe('BLOCKQUOTE');
    expect(first.querySelector('.claim-quote')!.textContent).toBe(`「${c.quote}」`);
    expect(first.querySelector('.claim-source')!.textContent).toBe(`出典：${c.sourceLabel}（${formatClaimDate(c.date)}）`);
  });

  test('the source is a link to the document: https, a new tab, noopener noreferrer; the label is the link, the date is outside it', () => {
    const { all } = setup({ selectedPref: '39' });
    const data = ofPref('39');
    all().forEach((li, i) => {
      const a = li.querySelector<HTMLAnchorElement>('.claim-source a')!;
      expect(a.getAttribute('href'), data[i].id).toBe(data[i].source);
      expect(a.textContent).toBe(data[i].sourceLabel);
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(li.querySelector('.claim-source')!.lastChild!.textContent).toBe(`（${formatClaimDate(data[i].date)}）`);
    });
  });

  test('the tag is a word, and the one text of its stance: 現状の記述 for a fact, 見込み・懸念の記述 for a concern or an expectation; no class that could carry a colour', () => {
    const { all } = setup({ selectedPref: '39' });
    const data = ofPref('39');
    expect(data.some((c) => c.stance === 'fact') && data.some((c) => c.stance === 'possibility')).toBe(true);
    all().forEach((li, i) => {
      const tag = li.querySelector('.claim-stance')!;
      expect(tag.textContent, data[i].id).toBe(data[i].stance === 'fact' ? CLAIMS_TAG_FACT : CLAIMS_TAG_POSSIBILITY);
      expect([...tag.classList]).toEqual(['tag', 'claim-stance']);
    });
  });

  test('opening the fold shows the other six; closing it and moving to the same place again leaves it as the reader left it, and a new place closes it', () => {
    const { q, store } = setup({ selectedPref: '39' });
    const more = q<HTMLDetailsElement>('.claims-more')!;
    more.open = true;
    // a new scenario rebuilds the card but not the place: the fold stays open
    store.set({ scenario: { ...store.get().scenario, cwrMult: 1.4, migScale: 0 } });
    expect(q<HTMLDetailsElement>('.claims-more')!.open).toBe(true);
    expect(q('.claims')!.hidden).toBe(false);
    // another prefecture: a new list, the fold closed
    store.set({ selectedPref: '38' });
    expect(q<HTMLDetailsElement>('.claims-more')!.open).toBe(false);
  });
});

describe('the other prefectures that have quotations', () => {
  test('愛媛県: all of its quotations; the same four-prefecture sentences as 高知県 come first, so the common sentence is in each', () => {
    const { all } = setup({ selectedPref: '38' });
    expect(all()).toHaveLength(ofPref('38').length);
    expect(all().map((li) => li.dataset.id)).toEqual(ofPref('38').map((c) => c.id));
    expect(all().map((li) => li.dataset.id)).toContain('jrs-all-common');
  });

  test('和歌山県: the first five shown, the rest folded; the card\'s own notes follow this section', () => {
    const { claims, q, shown, folded } = setup({ selectedPref: '30' });
    const want = ofPref('30');
    expect(claims().hidden).toBe(false);
    expect(shown().map((li) => li.dataset.id)).toEqual(want.slice(0, 5).map((c) => c.id));
    expect(shown().map((li) => li.dataset.id).slice(0, 3)).toEqual(['wak-kumano', 'wak-pref-transit', 'wak-koya-shops']);
    expect(folded()).toHaveLength(want.length - 5);
    expect(q('.claims-more')!.hidden).toBe(false);
    // the card's own notes start under the rule only after the last section shown (CSS): here that is this one
    expect(claims().nextElementSibling).toBe(q('.board-already'));
  });

  test('千葉県: the three, the theme park among them, with the company that runs it as the data names it', () => {
    const { shown, text } = (() => {
      const s = setup({ selectedPref: '12' });
      return { ...s, text: s.section.textContent! };
    })();
    expect(shown()).toHaveLength(3);
    expect(shown().map((li) => li.querySelector('.claim-subject')!.textContent)).toContain('東京ディズニーリゾート（運営：株式会社オリエンタルランド）');
    expect(text).toContain('出典：');
  });
});

describe('hidden, and without a word saying so', () => {
  test('visibleText sees the section when it is shown (so the checks below are not vacuous)', () => {
    const { section } = setup({ selectedPref: '39' });
    expect(visibleText(section)).toContain(CLAIMS_TITLE);
    expect(visibleText(section)).toContain(CLAIMS_NOTE);
  });

  test('a prefecture without a quotation (東京都, 神奈川県, 沖縄県): the section is hidden and empty, nothing says 「ありません」', () => {
    for (const p of ['13', '14', '47']) {
      const { claims, all, section } = setup({ selectedPref: p });
      expect(claims().hidden, p).toBe(true);
      expect(all(), p).toEqual([]);
      expect(visibleText(section), p).not.toContain(CLAIMS_TITLE);
      expect(visibleText(section), p).not.toContain(CLAIMS_NOTE);
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });

  test('the whole country: hidden', () => {
    const { claims, all, section } = setup({});
    expect(claims().hidden).toBe(true);
    expect(all()).toEqual([]);
    expect(visibleText(section)).not.toContain(CLAIMS_TITLE);
    expect(visibleText(section)).not.toContain(CLAIMS_NOTE);
  });

  test('a town (田辺市, in 和歌山県 which has quotations): hidden, the prefecture\'s are not lent to the town', () => {
    const { claims, all, store } = setup({ selectedArea: '30206' });
    expect(claims().hidden).toBe(true);
    expect(all()).toEqual([]);
    // a town of 高知県 too
    store.set({ selectedArea: '39201' });
    expect(claims().hidden).toBe(true);
    expect(all()).toEqual([]);
  });

  test('without the claims file (the load left it out): hidden for a prefecture that would have had them, and the rest of the card is as before', () => {
    const { claims, q, qa, store } = setup({ selectedPref: '39' }, { claims: undefined });
    expect(claims().hidden).toBe(true);
    expect(qa('.claim')).toEqual([]);
    expect(qa('.board-row').length).toBeGreaterThan(0);
    expect(q('.landmarks')!.hidden).toBe(false);
    store.set({ selectedArea: '39201' });
    expect(claims().hidden).toBe(true);
    expect(q('.board-heading')!.textContent).toContain('で、人口の目安を下回る施設と、その年');
  });

  test('an empty claims file: hidden', () => {
    const { claims } = setup({ selectedPref: '39' }, { claims: [] });
    expect(claims().hidden).toBe(true);
  });

  test('a new place shows or hides the section as the place has a quotation or not, and a town hides it', () => {
    const { claims, store, all } = setup({ selectedPref: '39' });
    expect(claims().hidden).toBe(false);
    store.set({ selectedPref: '13' });
    expect(claims().hidden).toBe(true);
    expect(all()).toEqual([]);
    store.set({ selectedPref: '30' });
    expect(claims().hidden).toBe(false);
    expect(all()).toHaveLength(ofPref('30').length);
    store.set({ selectedArea: '30206' });
    expect(claims().hidden).toBe(true);
    store.set({ selectedPref: undefined });
    expect(claims().hidden).toBe(true);
  });
});

describe('the data is shown as written', () => {
  const synthetic = (over: Partial<Claim>): Claim => ({
    id: 'synthetic',
    subject: '合成の主語',
    kind: '鉄道',
    prefCodes: ['39'],
    quote: '合成の原文。',
    paraphrase: '合成の言い換え。',
    stance: 'possibility',
    source: 'https://example.org/',
    sourceLabel: '合成の出典',
    date: '2026-03',
    readOn: '2026-11-07',
    ...over,
  });

  test('every quotation of the real file appears word for word, between 「」, in each prefecture it names', () => {
    const prefs = new Set(real.flatMap((c) => c.prefCodes));
    expect(prefs.size).toBe(22);
    for (const p of [...prefs].sort()) {
      const { all } = setup({ selectedPref: p });
      const want = ofPref(p);
      expect(all().map((li) => li.querySelector('.claim-quote')!.textContent), p).toEqual(want.map((c) => `「${c.quote}」`));
      expect(all().map((li) => li.querySelector('.claim-subject')!.textContent), p).toEqual(want.map((c) => c.subject));
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });

  test('a source that is not https is written, not linked (http, javascript:, a bare word)', () => {
    for (const source of ['http://example.org/', 'javascript:alert(1)', 'example.org']) {
      const { q } = setup({ selectedPref: '39' }, { claims: [synthetic({ source })] });
      expect(q('.claim-source a'), source).toBeNull();
      expect(q('.claim-source')!.textContent, source).toBe('出典：合成の出典（2026年3月）');
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });

  test('markup in a subject, a quotation or a label stays literal (textContent, never innerHTML)', () => {
    const { q } = setup(
      { selectedPref: '39' },
      { claims: [synthetic({ subject: '<b>太字</b>', quote: '<img src=x onerror=alert(1)>', sourceLabel: '<i>斜体</i>' })] },
    );
    expect(q('.claim-subject')!.textContent).toBe('<b>太字</b>');
    expect(q('.claim-subject b')).toBeNull();
    expect(q('.claim-quote')!.textContent).toBe('「<img src=x onerror=alert(1)>」');
    expect(q('.claim-quote img')).toBeNull();
    expect(q('.claim-source-link i')).toBeNull();
    expect(q('.claim-source-link')!.textContent).toBe('<i>斜体</i>');
  });

  test('a date the app does not know how to read is written as it is', () => {
    const { q } = setup({ selectedPref: '39' }, { claims: [synthetic({ date: '令和8年3月' })] });
    expect(q('.claim-source')!.textContent).toBe('出典：合成の出典（令和8年3月）');
  });
});

describe('wording of the card with the section in it', () => {
  test('what the app itself writes there (the quotations taken out) never predicts, judges or recommends, in every prefecture that has the section', () => {
    const prefs = [...new Set(real.flatMap((c) => c.prefCodes))].sort();
    for (const p of prefs) {
      const { section, claims, all } = setup({ selectedPref: p });
      expect(claims().hidden, p).toBe(false);
      expect(all().length, p).toBeGreaterThan(0);
      // the section itself, the quotations (the publishers' own words) and the subjects (names from the file) removed
      const own = claims().cloneNode(true) as HTMLElement;
      for (const el of own.querySelectorAll('.claim-quote, .claim-subject')) el.remove();
      for (const w of OWN_WORDS_BANNED) expect(own.textContent, `${w} in the section for ${p}`).not.toContain(w);
      // the whole card, the same way
      const card = section.cloneNode(true) as HTMLElement;
      // the data of the other sections is text written by others too: the claims' quotations and subjects, the places' names and sentences
      for (const el of card.querySelectorAll('.claim-quote, .claim-subject, .landmark-list')) el.remove();
      for (const w of ['残せない', '閉鎖', '撤退', '廃止', '予測', '私', 'べき', 'おすすめ', '勧め', '→', '①', '②']) {
        expect(card.textContent, `${w} in the card for ${p}`).not.toContain(w);
      }
      mounted?.teardown();
      mounted = undefined;
      document.body.replaceChildren();
    }
  });
});
