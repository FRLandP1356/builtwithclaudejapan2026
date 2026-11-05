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
});
