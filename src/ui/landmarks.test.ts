// The wording of 「ここにある有名なもの」 (pure) and the CSS rules that make the section's layout (jsdom does not lay out,
// so the test reads landmarks.css and keeps the rules in place).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import type { Landmark } from '../data/landmarks';
import { isHttpsUrl, LANDMARKS_NOTE, LANDMARKS_ROW_LEAD, LANDMARKS_TITLE_AREA, LANDMARKS_TITLE_PREF, landmarksTitle, rowLandmarksText } from './landmarks';

const item = (name: string, over: Partial<Landmark> = {}): Landmark => ({
  id: name,
  name,
  kind: '神社',
  prefCode: '30',
  areaCode: '30206',
  summary: `${name}についての1文。`,
  source: 'https://example.org/',
  sourceLabel: '例の出典',
  ...over,
});

describe('titles', () => {
  test('a prefecture, a town; nothing for the whole country', () => {
    expect(landmarksTitle('pref')).toBe(LANDMARKS_TITLE_PREF);
    expect(landmarksTitle('area')).toBe(LANDMARKS_TITLE_AREA);
    expect(landmarksTitle('japan')).toBeUndefined();
    expect(LANDMARKS_TITLE_PREF).toBe('この都道府県にある有名なものの例');
    expect(LANDMARKS_TITLE_AREA).toBe('この町にある有名なものの例');
  });

  test('the note says what the list is and what it is not, and nothing about what comes next', () => {
    expect(LANDMARKS_NOTE).toBe(
      '完全な一覧ではありません。人口の目安を下回るかどうかとは関係なく、そこにあるものを示しています。各施設や団体の計画・意向とは関係なく、協力や公認を受けたものでもありません。',
    );
  });
});

describe('rowLandmarksText: the one line under a board row', () => {
  test('no items: no line', () => {
    expect(rowLandmarksText([])).toBeUndefined();
  });

  test('up to three names as written, joined by 、, in the given order', () => {
    expect(rowLandmarksText([item('熊野本宮大社'), item('滝尻王子')])).toBe('この町にある有名なもの：熊野本宮大社、滝尻王子');
    expect(rowLandmarksText([item('道後温泉'), item('松山空港'), item('松山城')])).toBe(`${LANDMARKS_ROW_LEAD}道後温泉、松山空港、松山城`);
  });

  test('more than three: the first three and 「ほか N件」', () => {
    const five = ['一', '二', '三', '四', '五'].map((n) => item(n));
    expect(rowLandmarksText(five)).toBe('この町にある有名なもの：一、二、三 ほか2件');
    expect(rowLandmarksText(five, 1)).toBe('この町にある有名なもの：一 ほか4件');
    expect(rowLandmarksText(five, 5)).toBe('この町にある有名なもの：一、二、三、四、五');
  });

  test('the line only lists: no verb about the future, no tie to a facility', () => {
    const text = rowLandmarksText([item('A'), item('B'), item('C'), item('D')])!;
    for (const w of ['残せない', '閉鎖', 'なくなる', '撤退', '廃止', '危機', '消える', '予測', '施設']) expect(text).not.toContain(w);
  });
});

describe('isHttpsUrl: only https becomes a link', () => {
  test.each([
    ['https://example.org/x', true],
    ['https://kunishitei.bunka.go.jp/heritage/detail/401/7', true],
    ['http://example.org/', false],
    ['javascript:alert(1)', false],
    ['ftp://example.org/', false],
    ['example.org', false],
    ['', false],
  ])('%s -> %s', (url, want) => {
    expect(isHttpsUrl(url)).toBe(want);
  });
});

describe('landmarks.css: tokens only, a ruled list, a left column from 600px, long text wraps', () => {
  const css = readFileSync(repoPath('src/ui/landmarks.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  /** The declarations of every rule whose selector list contains `selector` (exact, whitespace-normalised), joined. */
  function declarations(selector: string): string {
    const want = selector.replace(/\s+/g, ' ');
    const found: string[] = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
      if (selectors.includes(want)) found.push(m[2]);
    }
    return found.join(';').replace(/\s+/g, ' ');
  }

  test('no colour of its own: every colour is a token (no hex, no rgb) and the kind has no colour rule', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(declarations('.landmark-kind')).not.toMatch(/color|background/);
  });

  test('the list is ruled like the board rows: no bullets, a --line-2 rule above, a --line rule under each item', () => {
    const list = declarations('.landmark-list');
    expect(list).toMatch(/list-style:\s*none/);
    expect(list).toMatch(/border-top:\s*1px solid var\(--line-2\)/);
    const li = declarations('.landmark');
    expect(li).toMatch(/display:\s*grid/);
    expect(li).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(li).toMatch(/min-width:\s*0/);
  });

  test('a prefecture list from 600px: the town in a 6.5em left column (as the year in the rows); below that one column', () => {
    expect(css).toMatch(/@media \(min-width: 600px\) \{\s*\.landmark-list\.is-pref \.landmark \{[^}]*grid-template-columns:\s*6\.5em minmax\(0, 1fr\)/);
    expect(declarations('.landmark')).not.toMatch(/grid-template-columns/);
  });

  test('the town is a text button in the accent, underlined, with a pointer; it keeps the breadcrumbs\' vocabulary', () => {
    const town = declarations('.landmark-town');
    expect(town).toMatch(/color:\s*var\(--accent\)/);
    expect(town).toMatch(/text-decoration:\s*underline/);
    expect(town).toMatch(/cursor:\s*pointer/);
    expect(town).toMatch(/background:\s*transparent/);
    expect(declarations('.landmark-town:hover')).toMatch(/background:\s*var\(--paper-2\)/);
  });

  test('a long name or source label wraps inside the card: no horizontal scroll on a phone', () => {
    expect(declarations('.landmark-name')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(declarations('.landmark-source')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(declarations('.landmark-body')).toMatch(/min-width:\s*0/);
    expect(declarations('.landmark-head')).toMatch(/flex-wrap:\s*wrap/);
  });

  test('the section keeps the card\'s own notes apart from its note', () => {
    expect(declarations('.landmarks')).toMatch(/margin-bottom:\s*var\(--sp-5\)/);
    expect(declarations('.landmarks-note')).toMatch(/margin-top:\s*var\(--sp-3\)/);
  });

  test('boardPanel.css: after a shown section, the card\'s first note starts under a rule, so it reads as the card\'s and not the list\'s', () => {
    const board = readFileSync(repoPath('src/ui/boardPanel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const m = board.match(/\.landmarks:not\(\[hidden\]\) \+ \.board-already \{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/border-top:\s*1px solid var\(--line-2\)/);
    expect(m![1]).toMatch(/padding-top:\s*var\(--sp-4\)/);
  });
});
