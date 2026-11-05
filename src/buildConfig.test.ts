// Pins the build and test settings that are easy to change by accident.
import { describe, expect, test } from 'vitest';
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
    expect(vitestConfig.test?.include).toEqual(['src/**/*.test.ts', 'worker/**/*.test.ts']);
  });
});
