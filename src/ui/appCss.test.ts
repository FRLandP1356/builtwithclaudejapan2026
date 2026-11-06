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

  test('the header question has a row of its own, and from 1024px the lead and the question each run on one line (the band keeps its height)', () => {
    expect(declarations('.app-problem')).toMatch(/flex:\s*1 0 100%/);
    expect(declarations('.app-problem')).toMatch(/max-width:\s*44em/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*?\.app-lead,\s*\.app-problem \{\s*max-width:\s*none;\s*\}/);
  });

  test('the band runs edge to edge in its own field; its content and the page under it keep to the page width', () => {
    expect(declarations('.app-head')).toMatch(/background:\s*var\(--band\)/);
    expect(declarations('.app-nav')).toMatch(/background:\s*var\(--band\)/);
    expect(declarations('.app')).not.toMatch(/max-width/); // the wrappers carry it, so the band can reach the window's edges
    for (const wrapper of ['.app-inner', '.app-head-inner', '.app-nav-inner']) {
      expect(declarations(wrapper), wrapper).toMatch(/max-width:\s*var\(--page\)/);
      expect(declarations(wrapper), wrapper).toMatch(/margin:\s*0 auto/);
    }
  });

  test('on a phone the menu\'s names stick to the top of the window while the heading\'s row scrolls away; on a desktop it is not sticky', () => {
    const nav = declarations('.app-nav');
    expect(nav).toMatch(/position:\s*sticky/);
    expect(nav).toMatch(/top:\s*calc\(-1 \* var\(--nav-title-h\)\)/); // minus the heading's row: only the names stay
    expect(nav).toMatch(/--nav-title-h:\s*28px/);
    expect(declarations('.app-nav-title')).toMatch(/height:\s*var\(--nav-title-h\)/); // the row is exactly that tall
    expect(declarations('.app-nav-list')).toMatch(/overflow-x:\s*auto/); // four names do not fit a 390px strip: it scrolls sideways
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*?\.app-nav \{\s*position:\s*static;\s*\}/);
  });

  test('on a phone the descriptions are clipped, not display:none (a screen reader still reads them as the links\' descriptions)', () => {
    const phone = /@media \(max-width: 1023\.98px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    const desc = /\.app-nav-desc \{([^}]*)\}/.exec(phone)?.[1] ?? '';
    expect(desc).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(desc).toMatch(/width:\s*1px/);
    expect(desc).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    expect(/\.app-nav-summary \{([^}]*)\}/.exec(css)![1]).not.toMatch(/display:\s*none/); // the base rule draws it on a phone...
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*?\.app-nav-summary \{\s*display:\s*none;\s*\}/); // ...and not on a desktop
  });

  test('the whole card is the link on a desktop, a focused item shows a ring, and every name keeps a 44px touch row on a phone', () => {
    expect(css).toMatch(/\.app-nav-item::after \{[^}]*content:\s*''[^}]*position:\s*absolute[^}]*inset:/);
    expect(declarations('.app-nav-card')).toMatch(/position:\s*relative/);
    expect(declarations('.app-nav-item')).toMatch(/min-height:\s*var\(--touch\)/);
    expect(css).toMatch(/\.app-nav-item:focus-visible \.app-nav-name \{[^}]*outline:\s*var\(--focus-ring\)/);
    expect(css).toMatch(/\.app-nav-item:focus-visible::after \{[^}]*outline:\s*var\(--focus-ring\)/);
  });

  test('a jump from the menu lands under the phone\'s sticky strip (64px) and at the top of a desktop window', () => {
    expect(declarations('.panel')).toMatch(/scroll-margin-top:\s*64px/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.panel \{\s*scroll-margin-top:\s*var\(--sp-4\);\s*\}/);
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

  test('on a desktop the map leaves room for everything else of the first view, the band and the colour choice included (485px)', () => {
    expect(declarations('.map-svg')).toMatch(/max-height:\s*max\(360px, calc\(100vh - 485px\)\)/);
  });
});
