// The wording of 「公表資料に書かれていること」 (pure) and the CSS rules that make the section's layout (jsdom does not lay out, so
// the test reads claims.css and boardPanel.css and keeps the rules in place).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { OWN_WORDS_BANNED } from '../../test/helpers/ownWords';
import { repoPath } from '../../test/helpers/paths';
import { indexClaims, type Claim } from '../data/claims';
import { moreText } from './board';
import {
  CLAIMS_NOTE,
  CLAIMS_SHOWN,
  CLAIMS_SOURCE,
  CLAIMS_TAG_FACT,
  CLAIMS_TAG_POSSIBILITY,
  CLAIMS_TITLE,
  claimsFor,
  formatClaimDate,
  quoted,
  splitClaims,
  stanceLabel,
} from './claims';

const item = (id: string, over: Partial<Claim> = {}): Claim => ({
  id,
  subject: `${id}の件`,
  kind: '鉄道',
  prefCodes: ['39'],
  quote: `${id}の原文。`,
  paraphrase: `${id}の言い換え。`,
  stance: 'possibility',
  source: 'https://example.org/',
  sourceLabel: '例の発行者「例の資料」',
  date: '2026-03',
  readOn: '2026-11-07',
  ...over,
});

describe('the wording the app itself writes', () => {
  test('the title and the note are the ones the author fixed', () => {
    expect(CLAIMS_TITLE).toBe('公表資料に書かれていること');
    expect(CLAIMS_NOTE).toBe('各資料の原文を引用しています。人口減少との関係を述べた文で、このアプリの予想ではなく、そうなると決まったという意味でもありません。');
    expect(CLAIMS_SOURCE).toBe('出典：');
  });

  test('the two tags are words, not colours', () => {
    expect(CLAIMS_TAG_FACT).toBe('現状の記述');
    expect(CLAIMS_TAG_POSSIBILITY).toBe('見込み・懸念の記述');
    expect(stanceLabel('fact')).toBe('現状の記述');
    expect(stanceLabel('possibility')).toBe('見込み・懸念の記述');
  });

  test('nothing the app writes predicts, judges or recommends', () => {
    const own = [CLAIMS_TITLE, CLAIMS_NOTE, CLAIMS_SOURCE, CLAIMS_TAG_FACT, CLAIMS_TAG_POSSIBILITY, moreText(6)];
    for (const text of own) for (const w of OWN_WORDS_BANNED) expect(text, `${w} in ${text}`).not.toContain(w);
  });
});

describe('quoted', () => {
  test('the quotation in 「」, the words between them untouched', () => {
    expect(quoted('沿線人口の減少が進む')).toBe('「沿線人口の減少が進む」');
    expect(quoted('  空白と<b>記号</b>・「入れ子」を含む  ')).toBe('「  空白と<b>記号</b>・「入れ子」を含む  」');
  });
});

describe('formatClaimDate', () => {
  test('a day, a month, a year', () => {
    expect(formatClaimDate('2026-06-25')).toBe('2026年6月25日');
    expect(formatClaimDate('2026-03')).toBe('2026年3月');
    expect(formatClaimDate('2026')).toBe('2026年');
  });

  test('anything else, and a month or a day that does not exist, is returned as written', () => {
    expect(formatClaimDate('令和8年3月')).toBe('令和8年3月');
    expect(formatClaimDate('2026-13')).toBe('2026-13');
    expect(formatClaimDate('2026-00')).toBe('2026-00');
    expect(formatClaimDate('2026-03-32')).toBe('2026-03-32');
    expect(formatClaimDate('2026-3')).toBe('2026-3');
  });
});

describe('splitClaims', () => {
  const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => item(id));

  test('five are shown first and the rest follow, in the file order', () => {
    expect(CLAIMS_SHOWN).toBe(5);
    const { shown, rest } = splitClaims(items);
    expect(shown.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(rest.map((c) => c.id)).toEqual(['f', 'g']);
  });

  test('five or fewer: nothing is left for the fold', () => {
    expect(splitClaims(items.slice(0, 5)).rest).toEqual([]);
    expect(splitClaims(items.slice(0, 2)).shown).toHaveLength(2);
    expect(splitClaims([])).toEqual({ shown: [], rest: [] });
  });
});

describe('claimsFor: only a prefecture gets the section', () => {
  const index = indexClaims([item('a', { prefCodes: ['39', '38'] }), item('b', { prefCodes: ['39'] })]);

  test('a prefecture: its claims; the whole country and a town: none, whatever the key', () => {
    expect(claimsFor(index, 'pref', '39').map((c) => c.id)).toEqual(['a', 'b']);
    expect(claimsFor(index, 'pref', '38').map((c) => c.id)).toEqual(['a']);
    expect(claimsFor(index, 'pref', '13')).toEqual([]);
    expect(claimsFor(index, 'japan', 'japan')).toEqual([]);
    expect(claimsFor(index, 'japan', '39')).toEqual([]);
    expect(claimsFor(index, 'area', '39')).toEqual([]);
    expect(claimsFor(index, 'area', '39201')).toEqual([]);
  });
});

describe('claims.css: tokens only, a ruled list, one column, a quotation set apart, long text wraps', () => {
  const css = readFileSync(repoPath('src/ui/claims.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  /** The declarations of every rule whose selector list contains `selector` (exact, whitespace-normalised), joined. */
  function declarations(source: string, selector: string): string {
    const want = selector.replace(/\s+/g, ' ');
    const found: string[] = [];
    for (const m of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
      if (selectors.includes(want)) found.push(m[2]);
    }
    return found.join(';').replace(/\s+/g, ' ');
  }
  const d = (selector: string) => declarations(css, selector);

  test('no colour of its own: every colour is a token (no hex, no rgb) and the stance tag has no colour rule', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/rgba?\(/);
    expect(d('.claim-stance')).not.toMatch(/color|background/);
  });

  test('every length is a token or zero, except the 3px rule of the quotation and the 1px rules (no new size, no new space)', () => {
    const lengths = [...css.matchAll(/:\s*([^;{}]*\d(?:px|rem|em)\b[^;{}]*)/g)].map((m) => m[1].trim());
    expect(lengths).toHaveLength(3); // the list's top rule, an item's bottom rule and the quotation's left rule: nothing else has a size of its own
    for (const v of lengths) {
      const bare = v.replace(/var\(--[a-z0-9-]+\)/g, '');
      expect(bare, v).toMatch(/^[\s\d]*(?:(?:1px|3px) solid)?[\s]*$/);
    }
  });

  test('the list is ruled like the landmarks\' list: no bullets, a --line-2 rule above, a --line rule under each item', () => {
    const list = d('.claim-list');
    expect(list).toMatch(/list-style:\s*none/);
    expect(list).toMatch(/border-top:\s*1px solid var\(--line-2\)/);
    const li = d('.claim');
    expect(li).toMatch(/display:\s*grid/);
    expect(li).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(li).toMatch(/min-width:\s*0/);
  });

  test('one column at every width: no media query and no column template', () => {
    expect(css).not.toMatch(/@media/);
    expect(css).not.toMatch(/grid-template-columns/);
  });

  test('the quotation is set apart by a rule on its left in the line colour (the accent belongs to the title strip and the links) and the user agent\'s margins are cleared', () => {
    const q = d('.claim-quote');
    expect(q).toMatch(/margin:\s*0(;|$)/);
    expect(q).toMatch(/border-left:\s*3px solid var\(--line-2\)/);
    expect(q).toMatch(/color:\s*var\(--ink\)/);
    expect(q).not.toMatch(/--accent/);
  });

  test('a long subject, quotation or source label wraps inside the card: no horizontal scroll on a phone', () => {
    expect(d('.claim-subject')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(d('.claim-quote')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(d('.claim-source')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(d('.claim-head')).toMatch(/flex-wrap:\s*wrap/);
    expect(d('.claim')).toMatch(/min-width:\s*0/);
  });

  test('the section keeps the card\'s own notes apart, and its note sits close under the title strip', () => {
    expect(d('.claims')).toMatch(/margin-bottom:\s*var\(--sp-5\)/);
    expect(d('.claims-note')).toMatch(/margin:\s*0 0 var\(--sp-3\)/);
  });

  test('boardPanel.css: the fold is the board\'s own 「続きを見る」 (a 44px summary in the accent with the drawn mark that turns when open)', () => {
    const board = readFileSync(repoPath('src/ui/boardPanel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const b = (selector: string) => declarations(board, selector);
    const summary = b('.claims-more > summary');
    expect(summary).toMatch(/min-height:\s*var\(--touch\)/);
    expect(summary).toMatch(/color:\s*var\(--accent\)/);
    expect(summary).toMatch(/cursor:\s*pointer/);
    expect(b('.claims-more > summary::before')).toMatch(/border-right:\s*2px solid currentColor/);
    expect(b('.claims-more[open] > summary::before')).toMatch(/rotate\(45deg\)/);
    expect(b('.claims-more > summary::-webkit-details-marker')).toMatch(/display:\s*none/);
    expect(b('.claims-more > .claim-list')).toMatch(/margin-top:\s*0/);
  });
});
