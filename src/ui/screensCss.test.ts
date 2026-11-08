// The six screens' stylesheet (src/ui/screens.css): jsdom does not lay out, so these tests read the CSS and keep the rules that
// make a screen a screen (as tall as the window, one heading, its body in the room under it) and the rule of the design
// (tokens only: no colour, face, shadow or radius of its own).
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';

const css = readFileSync(repoPath('src/ui/screens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector: string): string {
  const want = selector.replace(/\s+/g, ' ');
  const found: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim().replace(/\s+/g, ' ')).includes(want)) found.push(m[2]);
  }
  return found.join(';').replace(/\s+/g, ' ');
}

describe('screens.css', () => {
  test('a screen is as tall as the window (small viewport units, so a phone\'s address bar does not cut it) and grows when its content is taller', () => {
    const screen = declarations('.screen');
    expect(screen).toMatch(/min-height:\s*100svh/);
    expect(screen).toMatch(/display:\s*flex/);
    expect(screen).toMatch(/flex-direction:\s*column/);
    expect(screen).not.toMatch(/(^|[^-])height:\s*100/); // never a fixed height: nothing is clipped
    expect(screen).not.toMatch(/overflow:\s*hidden/);
  });

  test('the heading is the mincho at 26px on a phone, 32px from 600px and 44px from 1024px (the owner: 26-30px on a phone, 36-48px on a desktop)', () => {
    expect(declarations('.screen-title')).toMatch(/font-size:\s*var\(--fs-26\)/);
    expect(css).toMatch(/@media \(min-width: 600px\) \{\s*\.screen-title \{\s*font-size:\s*var\(--fs-32\)/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{\s*\.screen-title \{\s*font-size:\s*var\(--fs-44\)/);
    expect(declarations('.screen-title')).toMatch(/word-break:\s*auto-phrase/);
  });

  test('the body takes the room under the heading and centres in it, never wider than a reading column', () => {
    const body = declarations('.screen-body');
    expect(body).toMatch(/margin:\s*auto/);
    expect(body).toMatch(/max-width:\s*56rem/);
  });

  test('tokens only: no colour literal, no shadow, no gradient, no font family and no radius of its own', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toMatch(/box-shadow|text-shadow|gradient/);
    expect(css).not.toMatch(/font-family:\s*(?!var\()\S/);
    expect(css).not.toMatch(/border-radius:\s*(?!var\(|0;|2px;)\S/); // the tokens (or the legend bar's own 2px, as app.css has it)
  });

  test('the phone rules come last, so they win over the base rules above them', () => {
    const phone = css.lastIndexOf('@media (max-width: 599.98px)');
    expect(phone).toBeGreaterThan(css.lastIndexOf('.town-card-row'));
    expect(phone).toBeGreaterThan(css.lastIndexOf('.screen-card {'));
    expect(declarations('.screen-card')).toMatch(/padding:\s*var\(--sp-4\)/);
    expect(css.slice(phone)).toMatch(/\.screen-card,\s*\.board-card \{\s*padding:\s*var\(--sp-3\)/);
  });

  test('the AI\'s two small section titles leave the eye but not a screen reader (clipped, never display: none)', () => {
    const hidden = declarations('.screen-ai .ai-panel .panel-section-title');
    expect(hidden).toMatch(/clip:\s*rect\(0 0 0 0\)/);
    expect(hidden).not.toMatch(/display:\s*none/);
  });
});
