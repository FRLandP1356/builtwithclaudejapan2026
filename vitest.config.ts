import { defineConfig } from 'vitest/config';

// Node by default. A UI test opts into the DOM with a file-level comment:
//   // @vitest-environment jsdom
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
});
