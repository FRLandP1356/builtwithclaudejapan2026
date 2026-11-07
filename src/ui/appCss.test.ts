// CSS rules that nothing else exercises (jsdom does not lay out): the tests read src/ui/app.css and check that the
// rules which make behaviour visible are still there, so a deleted or emptied rule does not go unnoticed.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';

const css = readFileSync(repoPath('src/ui/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

describe('app.css: the rules that behaviour depends on', () => {
  test('the footer disclaimer wraps at phrases where the browser knows them (word-break: auto-phrase on the source text)', () => {
    expect(declarations('.app-foot .src-text')).toMatch(/word-break:\s*auto-phrase/);
    expect(declarations('.app-foot dd')).toMatch(/overflow-wrap:\s*anywhere/); // the URLs may break anywhere: no horizontal scroll
  });

  test('the header question has a row of its own under the title, and from 1024px it runs on one line (the band keeps its height)', () => {
    expect(declarations('.app-problem')).toMatch(/flex:\s*1 0 100%/);
    expect(declarations('.app-problem')).toMatch(/max-width:\s*44em/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*?\.app-problem \{\s*max-width:\s*none;\s*\}/);
    expect(css).not.toMatch(/\.app-lead\b/); // the one-line description left the band on 2026-11-06 (it is in the sources card)
  });

  test('the band runs edge to edge in its own field; its content and the page under it keep to the page width', () => {
    expect(declarations('.app-head')).toMatch(/background:\s*var\(--band\)/);
    expect(declarations('.app')).not.toMatch(/max-width/); // the wrappers carry it, so the band can reach the window's edges
    for (const wrapper of ['.app-inner', '.app-head-inner']) {
      expect(declarations(wrapper), wrapper).toMatch(/max-width:\s*var\(--page\)/);
      expect(declarations(wrapper), wrapper).toMatch(/margin:\s*0 auto/);
    }
  });

  test('the menu in the band is gone: nothing sticks to the top of the window and nothing scrolls sideways', () => {
    expect(css).not.toMatch(/\.app-nav\b|\.app-nav-/);
    expect(css).not.toMatch(/position:\s*sticky[^}]*top:\s*calc\(-1/);
    expect(declarations('.app-more-list')).not.toMatch(/overflow-x/);
  });

  test('the lower layer stacks its closed cards as rows under 「くわしく見る」: a rule under the last one, a breath around an open card, no link row (2026-11-07)', () => {
    expect(declarations('.app-more')).toMatch(/display:\s*grid/);
    expect(declarations('.app-more-list')).toMatch(/display:\s*grid/);
    expect(declarations('.app-more-list > .panel.is-collapsed:last-child')).toMatch(/border-bottom:\s*1px solid var\(--line-2\)/);
    expect(declarations('.app-more-list > .panel:not(.is-collapsed)')).toMatch(/margin-block:\s*var\(--sp-3\)/);
    expect(css).not.toMatch(/\.app-more-item\b|\.app-more-card\b/);
    expect(declarations('.app-foot')).not.toMatch(/margin-top/); // the sources are a row in the stack, not a footer under the page
  });

  test('both colour maps draw their borders and coast in translucent ink (their palest class is white), and the legend bar keeps an edge', () => {
    for (const mode of ['ratio', 'support']) {
      expect(declarations(`.map-column:has(.legend[data-mode='${mode}']) .mesh`), mode).toMatch(/stroke:\s*var\(--map-line-pale\)/);
      expect(declarations(`.map-column:has(.legend[data-mode='${mode}']) .coast`), mode).toMatch(/stroke:\s*var\(--map-line-pale\)/);
    }
    expect(declarations('.legend-bar')).toMatch(/box-shadow:\s*0 0 0 1px var\(--line-2\)/);
  });

  test('a jump from the row lands a breath under the top of the window, on every width (nothing sticks above it any more)', () => {
    expect(declarations('.panel')).toMatch(/scroll-margin-top:\s*var\(--sp-3\)/);
    expect(css).not.toMatch(/scroll-margin-top:\s*64px/);
  });

  test('the footer is a folded card: no rule of its own above it (the card has an edge), and its lead is the quiet description', () => {
    expect(declarations('.app-foot')).not.toMatch(/border-top|padding-top/);
    expect(declarations('.app-foot-lead')).toMatch(/max-width:\s*44em/);
  });

  test('the skip link is hidden until it has focus, and hidden by clipping (never display:none, which would make it unfocusable)', () => {
    const hidden = declarations('.skip-link:not(:focus)');
    expect(hidden).toMatch(/width:\s*1px/);
    expect(hidden).toMatch(/height:\s*1px/);
    expect(hidden).toMatch(/overflow:\s*hidden/);
    expect(hidden).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(hidden).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    const shown = declarations('.skip-link');
    expect(shown).toMatch(/position:\s*absolute/); // over the map, no layout shift
    expect(shown).toMatch(/min-height:\s*var\(--touch\)/);
  });

  test('the legend tick box is tall enough for the end label that drops a row', () => {
    const box = Number(/(?:^|;|\s)height:\s*(\d+)px/.exec(declarations('.legend-ticks'))?.[1]);
    const line = Number(/height:\s*(\d+)px/.exec(declarations(".legend-tick[data-row='2']::before"))?.[1]);
    expect(line).toBe(26);
    expect(box).toBe(52);
    expect(box).toBeGreaterThanOrEqual(line + 2 + 21); // tick line, its margin and one 21px text line
  });

  test('the map colour choice really goes away while an allocation is drawn (the hidden attribute is not overridden)', () => {
    expect(declarations('.map-mode[hidden]')).toMatch(/display:\s*none/);
    expect(declarations('.map-mode')).not.toMatch(/display:/);
  });

  test('on a desktop the map leaves room for everything else of the first view, the band and the colour choice included (395px since the menu left the band)', () => {
    expect(declarations('.map-svg')).toMatch(/max-height:\s*max\(360px, calc\(100vh - 395px\)\)/);
  });
});
