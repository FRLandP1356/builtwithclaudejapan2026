// Keeps `tsc -p worker/tsconfig.json` valid before the Worker code exists (Task 12 adds the real files).
/// <reference types="@cloudflare/workers-types" />

// `?raw` imports (Vite and Vitest) give a file's text; worker/wranglerConfig.test.ts reads wrangler.jsonc this way
// without needing Node's types in the Worker's tsconfig.
declare module '*.jsonc?raw' {
  const text: string;
  export default text;
}
