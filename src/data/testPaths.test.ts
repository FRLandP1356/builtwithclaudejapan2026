// The test helpers find the fixtures from the repository root, wherever vitest was started.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { findRepoRoot } from '../../test/helpers/paths';

afterEach(() => vi.restoreAllMocks());

describe('findRepoRoot', () => {
  test('starts from the helper file, not from the working directory', () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/'); // as if vitest had been started far away with --root
    const root = findRepoRoot();
    expect((JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }).name).toBe('town-2100');
    expect(existsSync(join(root, 'public/data/facilities.json'))).toBe(true);
  });

  test('walks up from a subdirectory and fails loudly outside the project', () => {
    const root = findRepoRoot();
    expect(findRepoRoot(join(root, 'src/ui'))).toBe(root);
    expect(() => findRepoRoot('/')).toThrow(/no town-2100 package.json/);
  });
});
