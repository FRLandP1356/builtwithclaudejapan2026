// Test-only: resolve a path relative to the repository root (vitest's working directory). Deliberately not
// `new URL(..., import.meta.url)`: under the jsdom environment Vite's web transform rewrites that pattern into an
// asset lookup, and import.meta.url is not a file URL there.
import { resolve } from 'node:path';

/** Absolute path of `relFromRoot` (e.g. 'public/data/areas/'). */
export function repoPath(relFromRoot: string): string {
  return resolve(process.cwd(), relFromRoot);
}
