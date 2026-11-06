// The panels are four separate cards, and the sections inside them are marked by strips: the owner could not tell where one
// ended and the next began when they were a hairline and whitespace (2026-11-06). jsdom does not lay out, so the tests read
// the CSS and keep the rules that make the boundaries visible.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const theme = strip(readFileSync(repoPath('src/ui/theme.css'), 'utf8'));
const app = strip(readFileSync(repoPath('src/ui/app.css'), 'utf8'));
const town = strip(readFileSync(repoPath('src/ui/townPanel.css'), 'utf8'));

/** The declarations of every rule whose selector list contains `selector` (exact, whitespace-normalised), joined. */
function declarations(css: string, selector: string): string {
  const want = selector.replace(/\s+/g, ' ');
  const found: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (selectors.includes(want)) found.push(m[2]);
  }
  return found.join(';').replace(/\s+/g, ' ');
}

describe('the right column: four cards, each with a title band', () => {
  test('a panel is a card: its own surface, an edge, rounded corners; the column keeps a gap between cards', () => {
    const panel = declarations(theme, '.panel');
    expect(panel).toMatch(/background:\s*var\(--card\)/);
    expect(panel).toMatch(/border:\s*1px solid var\(--line-2\)/);
    expect(panel).toMatch(/border-radius:\s*var\(--radius\)/);
    expect(theme).toMatch(/--card:\s*#ffffff/);
    const column = declarations(app, '.panel-column');
    expect(column).toMatch(/display:\s*grid/);
    expect(column).toMatch(/gap:\s*var\(--sp-6\)/);
  });

  test('the title is a solid indigo band across the top of the card, flush with its edges, light text on it', () => {
    const title = declarations(theme, '.panel > .panel-title');
    expect(title).toMatch(/background:\s*var\(--accent\)/);
    expect(title).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(title).toMatch(/margin:\s*0(;|$)/); // no outer margin: the band touches the card's edges
    // the 試算 mark in the band is light, or it would vanish on the indigo
    const badge = declarations(theme, '.panel-title .badge-estimate');
    expect(badge).toMatch(/color:\s*var\(--accent-ink\)/);
    expect(badge).toMatch(/border-color:\s*var\(--accent-ink\)/);
  });

  test('the body is inset from the card\'s edge, less on a phone, and no old hairline between panels remains', () => {
    expect(declarations(theme, '.panel')).toMatch(/--panel-inset:\s*var\(--sp-4\)/);
    expect(declarations(theme, '.panel > *')).toMatch(/margin-inline:\s*var\(--panel-inset\)/);
    expect(app).toMatch(/@media \(max-width: 1023\.98px\) \{\s*\.panel \{\s*--panel-inset:\s*var\(--sp-3\);\s*\}/);
    expect(declarations(theme, '.panel')).not.toMatch(/border-top/);
    expect(app).not.toMatch(/\.panel-column \.panel:first-child/);
  });
});

describe('the sections inside a card', () => {
  test('every section title is a tinted strip with an indigo bar on its left, with room above it', () => {
    const section = declarations(theme, '.panel-section-title');
    expect(section).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(section).toMatch(/border-left:\s*4px solid var\(--accent\)/);
    expect(section).toMatch(/margin:\s*var\(--sp-6\) 0 var\(--sp-3\)/);
    expect(section).toMatch(/font-weight:\s*700/);
    // the first one of a group that starts a block has no room above it
    expect(declarations(theme, '.panel-section > .panel-section-title:first-child')).toMatch(/margin-top:\s*0/);
  });

  test('a sub-group of the facility table has a ruled title', () => {
    expect(declarations(town, '.facility-group-title')).toMatch(/border-bottom:\s*1px solid var\(--line-2\)/);
  });
});
