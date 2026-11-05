// Test-only: resolve a path relative to the repository root. The root is found by walking up from THIS file's
// directory to the first directory whose package.json is this project's, so the result does not depend on the working
// directory (`vitest --root <repo>` started from anywhere still finds public/data). Deliberately not
// `new URL(..., import.meta.url)`: under the jsdom environment Vite's web transform rewrites that pattern into an asset
// lookup. `import.meta.dirname` is left alone and is a plain path in both the node and the jsdom environments.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE_NAME = 'town-2100';

/** The nearest directory at or above `start` that holds this project's package.json. Throws if there is none. */
export function findRepoRoot(start: string = import.meta.dirname): string {
  let dir = resolve(start);
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === PACKAGE_NAME) return dir;
      } catch {
        // not ours; keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`test helpers: no ${PACKAGE_NAME} package.json at or above ${start}`);
    dir = parent;
  }
}

let root: string | undefined;

/** The repository root (cached). */
export function repoRoot(): string {
  return (root ??= findRepoRoot());
}

/** Absolute path of `relFromRoot` (e.g. 'public/data/areas'). */
export function repoPath(relFromRoot: string): string {
  return resolve(repoRoot(), relFromRoot);
}
