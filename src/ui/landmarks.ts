// 「ここにある有名なもの」: the famous places and things of the prefecture or the town on screen, a section inside the
// 「分かれ目」 card after its rows (boardPanel.ts mounts it). Each item is a name, where it is, its kind, one sentence of
// fact and its source, all as written in public/data/landmarks.json. The list says what is there; it never says what
// becomes of it, and it is tied to no row and no guide: the note under it says so.
//
// For a prefecture the town's name is a button that selects the town (the same store patch as the search and the map).
// For a town the place is left out: the title already names it. For the whole country, and for a town without items,
// the section is hidden. The file is optional, so an empty index simply keeps the section hidden.
//
// Pure part first (the titles, the one line a board row shows, the link rule); `createLandmarkSection` is the DOM.
import { landmarksOf, type Landmark, type LandmarkIndex } from '../data/landmarks';
import { formatCount } from './format';
import type { Level } from './nav';
import { phraseNodes } from './phrases';
import './landmarks.css';

// ---------------------------------------------------------------------------------------------------------------
// Wording (pure)
// ---------------------------------------------------------------------------------------------------------------

export const LANDMARKS_TITLE_PREF = 'この県にある有名なものの例';
export const LANDMARKS_TITLE_AREA = 'この町にある有名なものの例';
/** Under the list: what the list is and what it is not. */
export const LANDMARKS_NOTE = '完全な一覧ではありません。人口の目安を下回るかどうかとは関係なく、そこにあるものを示しています。';
export const LANDMARKS_SOURCE = '出典：';
/** Read-aloud suffix of the town's button: 「田辺市を選ぶ」. */
export const LANDMARKS_SELECT = 'を選ぶ';
/** The one line under a board row's disclosure, for the row's town. */
export const LANDMARKS_ROW_LEAD = 'この町にある有名なもの：';
export const LANDMARKS_ROW_MAX = 3;

/** The section's title for the place on screen; none for the whole country. */
export function landmarksTitle(level: Level): string | undefined {
  if (level === 'pref') return LANDMARKS_TITLE_PREF;
  if (level === 'area') return LANDMARKS_TITLE_AREA;
  return undefined;
}

/**
 * 「この町にある有名なもの：熊野本宮大社、滝尻王子」; more than `max` items: 「…：A、B、C ほか2件」; no items: undefined.
 * Names as written, in the file's order. It lists; it draws no line from the row's facility to any of them.
 */
export function rowLandmarksText(items: readonly Landmark[], max: number = LANDMARKS_ROW_MAX): string | undefined {
  if (items.length === 0) return undefined;
  const shown = items.slice(0, max).map((l) => l.name).join('、');
  const rest = items.length - Math.min(items.length, max);
  return `${LANDMARKS_ROW_LEAD}${shown}${rest > 0 ? ` ほか${formatCount(rest)}件` : ''}`;
}

/** Only an https URL becomes a link; anything else is shown as text. */
export function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

export interface LandmarkSectionContext {
  index: LandmarkIndex;
  /** The plain name of a town. */
  areaName(code: string): string | undefined;
  /** Select the item's town (a prefecture's list). */
  select(landmark: Landmark): void;
}

export interface LandmarkSection {
  /** `div.panel-section.landmarks`, hidden while there is nothing to list. */
  root: HTMLElement;
  /** Fill the section for the place on screen. */
  render(level: Level, key: string): void;
}

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildItem(l: Landmark, level: Level, ctx: LandmarkSectionContext): HTMLLIElement {
  const li = h('li', 'landmark');
  li.dataset.id = l.id;
  li.dataset.area = l.areaCode;
  if (level === 'pref') {
    const place = h('div', 'landmark-place');
    const town = h('button', 'landmark-town');
    town.type = 'button';
    town.append(ctx.areaName(l.areaCode) ?? l.areaCode, h('span', 'sr-only', LANDMARKS_SELECT));
    town.addEventListener('click', () => ctx.select(l));
    place.append(town);
    li.append(place);
  }
  const body = h('div', 'landmark-body');
  const head = h('div', 'landmark-head');
  head.append(h('span', 'landmark-name', l.name), h('span', 'tag landmark-kind', l.kind));
  const summary = h('p', 'landmark-summary', l.summary);
  const source = h('p', 'note landmark-source');
  source.append(LANDMARKS_SOURCE);
  if (isHttpsUrl(l.source)) {
    const a = h('a', 'landmark-source-link', l.sourceLabel);
    a.href = l.source;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    source.append(a);
  } else {
    source.append(l.sourceLabel);
  }
  body.append(head, summary, source);
  li.append(body);
  return li;
}

/** The section: a tinted title strip, the ruled list and the note. `render` hides it when there is nothing to list. */
export function createLandmarkSection(ctx: LandmarkSectionContext): LandmarkSection {
  const root = h('div', 'panel-section landmarks');
  root.hidden = true;
  const title = h('h3', 'panel-section-title landmarks-title');
  const list = h('ul', 'landmark-list');
  const note = h('p', 'note landmarks-note');
  note.replaceChildren(...phraseNodes(LANDMARKS_NOTE));
  root.append(title, list, note);

  function render(level: Level, key: string): void {
    const heading = landmarksTitle(level);
    const items = heading === undefined ? [] : landmarksOf(ctx.index, level, key);
    if (heading === undefined || items.length === 0) {
      root.hidden = true;
      list.replaceChildren();
      return;
    }
    root.hidden = false;
    title.textContent = heading;
    list.className = `landmark-list ${level === 'pref' ? 'is-pref' : 'is-area'}`;
    list.replaceChildren(...items.map((l) => buildItem(l, level, ctx)));
  }

  return { root, render };
}
