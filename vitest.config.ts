import { defineConfig } from 'vitest/config';

// Node by default. A UI test opts into the DOM with a file-level comment:
//   // @vitest-environment jsdom
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    // The default 5 s was hit once by the engine tests that run all 1,884 areas (about 1 s alone, several times that under load).
    testTimeout: 15000,
  },
});
