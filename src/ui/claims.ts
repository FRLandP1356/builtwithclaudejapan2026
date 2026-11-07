// 「公表資料に書かれていること」: what published documents say about population decline, for the prefecture on screen, a section
// inside the 「分かれ目」 card after 「ここにある有名なもの」 (boardPanel.ts mounts it). Each item is a subject, the document's
// own sentence in quotation marks, and where it comes from, all as written in public/data/claims.json. The app quotes; it
// does not forecast, and it never turns a quotation into a statement of its own. The note under the title says so.
//
// Only a prefecture gets the section: the whole country and a town show nothing (a town does not borrow its prefecture's
// quotations). A prefecture without a quotation shows nothing either, and nothing says 「ありません」. The file is optional,
// so an empty index simply keeps the section hidden.
//
// Pure part first (the wording, the date, the split); `createClaimSection` is the DOM.
import { claimsOfPref, type Claim, type ClaimIndex } from '../data/claims';
import { moreText } from './board';
import type { Level } from './nav';
import { isHttpsUrl } from './landmarks';
import './claims.css';

// ---------------------------------------------------------------------------------------------------------------
// Wording (pure)
// ---------------------------------------------------------------------------------------------------------------

export const CLAIMS_TITLE = '公表資料に書かれていること';
/** Under the title: what these are and what they are not. */
export const CLAIMS_NOTE =
  '各資料の原文を引用しています。人口減少との関係を述べた文で、このアプリの予想ではなく、そうなると決まったという意味でもありません。';
export const CLAIMS_SOURCE = '出典：';
/** The tag of a sentence that states a present fact, and of one that states a concern or an expectation. Words, not colours. */
export const CLAIMS_TAG_FACT = '現状の記述';
export const CLAIMS_TAG_POSSIBILITY = '見込み・懸念の記述';
/** How many are shown before the 「続きを見る」 fold. */
export const CLAIMS_SHOWN = 5;

export function stanceLabel(stance: Claim['stance']): string {
  return stance === 'fact' ? CLAIMS_TAG_FACT : CLAIMS_TAG_POSSIBILITY;
}

/** The quotation in Japanese quotation marks, the publisher's words untouched between them. */
export function quoted(quote: string): string {
  return `「${quote}」`;
}

/**
 * The document's date as it is read in Japanese: "2026-03-12" -> 2026年3月12日, "2026-03" -> 2026年3月, "2026" -> 2026年.
 * Anything else (or a month or a day that does not exist) is returned as written.
 */
export function formatClaimDate(date: string): string {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!m) return date;
  const [, y, mo, d] = m;
  if (mo === undefined) return `${y}年`;
  const month = Number(mo);
  if (month < 1 || month > 12) return date;
  if (d === undefined) return `${y}年${month}月`;
  const day = Number(d);
  if (day < 1 || day > 31) return date;
  return `${y}年${month}月${day}日`;
}

/** The first `max` claims and the rest, in the file's order. */
export function splitClaims(items: readonly Claim[], max: number = CLAIMS_SHOWN): { shown: readonly Claim[]; rest: readonly Claim[] } {
  return { shown: items.slice(0, max), rest: items.slice(max) };
}

/** The section's claims for the place on screen: the prefecture's, and nothing for the whole country or a town. */
export function claimsFor(index: ClaimIndex, level: Level, key: string): readonly Claim[] {
  return level === 'pref' ? claimsOfPref(index, key) : [];
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

export interface ClaimSectionContext {
  index: ClaimIndex;
}

export interface ClaimSection {
  /** `div.panel-section.claims`, hidden while there is nothing to list. */
  root: HTMLElement;
  /** Fill the section for the place on screen. The same place again leaves the fold as the reader left it. */
  render(level: Level, key: string): void;
}

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildItem(c: Claim): HTMLLIElement {
  const li = h('li', 'claim');
  li.dataset.id = c.id;
  li.dataset.stance = c.stance;
  const head = h('div', 'claim-head');
  head.append(h('span', 'claim-subject', c.subject), h('span', 'tag claim-stance', stanceLabel(c.stance)));
  const quote = h('blockquote', 'claim-quote', quoted(c.quote));
  const source = h('p', 'note claim-source');
  source.append(CLAIMS_SOURCE);
  if (isHttpsUrl(c.source)) {
    const a = h('a', 'claim-source-link', c.sourceLabel);
    a.href = c.source;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    source.append(a);
  } else {
    source.append(c.sourceLabel);
  }
  source.append(`（${formatClaimDate(c.date)}）`);
  li.append(head, quote, source);
  return li;
}

/** The section: a tinted title strip, the note, the first few quotations and a fold for the rest. `render` hides it when there is nothing to list. */
export function createClaimSection(ctx: ClaimSectionContext): ClaimSection {
  const root = h('div', 'panel-section claims');
  root.hidden = true;
  const title = h('h3', 'panel-section-title claims-title', CLAIMS_TITLE);
  const note = h('p', 'note claims-note', CLAIMS_NOTE);
  const list = h('ul', 'claim-list');
  const more = h('details', 'claims-more');
  const moreSummary = h('summary');
  const moreList = h('ul', 'claim-list');
  more.append(moreSummary, moreList);
  more.hidden = true;
  root.append(title, note, list, more);

  let shownFor: string | undefined;

  function render(level: Level, key: string): void {
    const items = claimsFor(ctx.index, level, key);
    if (items.length === 0) {
      root.hidden = true;
      shownFor = undefined;
      list.replaceChildren();
      moreList.replaceChildren();
      more.open = false;
      return;
    }
    root.hidden = false;
    const place = `${level}:${key}`;
    if (place === shownFor) return; // the same place again (a new scenario): keep the list and the fold as they are
    shownFor = place;
    const { shown, rest } = splitClaims(items);
    list.replaceChildren(...shown.map(buildItem));
    moreList.replaceChildren(...rest.map(buildItem));
    more.hidden = rest.length === 0;
    more.open = false;
    moreSummary.textContent = rest.length > 0 ? moreText(rest.length) : '';
  }

  return { root, render };
}
