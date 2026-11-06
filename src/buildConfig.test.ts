// Pins the build and test settings that are easy to change by accident.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../test/helpers/paths';
import viteConfig from '../vite.config';
import vitestConfig from '../vitest.config';

describe('vite build', () => {
  test('publishes no sourcemap, keeps the relative base and the dist folder', () => {
    expect(viteConfig.build?.sourcemap).toBe(false);
    expect(viteConfig.build?.outDir).toBe('dist');
    expect(viteConfig.base).toBe('./');
  });
});

describe('vitest', () => {
  test('a test has 15 s, not the 5 s default (the engine tests run all 1,884 areas)', () => {
    expect(vitestConfig.test?.testTimeout).toBe(15000);
    expect(vitestConfig.test?.include).toEqual(['src/**/*.test.ts', 'worker/**/*.test.ts', 'functions/**/*.test.ts']);
  });
});

describe('index.html', () => {
  const html = readFileSync(repoPath('index.html'), 'utf8');
  const meta = (attr: 'name' | 'property', key: string) =>
    new RegExp(`<meta\\s+${attr}="${key}"\\s+content="([^"]*)"`, 's').exec(html)?.[1];

  test('has a description and a title for link previews, the same text as the page, with no image and no 予測', () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    expect(title).toBe('2100年の日本');
    expect(meta('name', 'description')).toContain('2100年までの人口');
    expect(meta('property', 'og:title')).toBe(title);
    expect(meta('property', 'og:description')).toBe(meta('name', 'description'));
    expect(meta('property', 'og:type')).toBe('website');
    expect(html).not.toContain('og:image');
    expect(meta('name', 'description')).not.toContain('予測');
  });
});
