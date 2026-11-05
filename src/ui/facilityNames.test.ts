// Ruling 16: facilities are looked up by id, never by name, and their names are never typed into the UI code: the one
// name of each facility is the `name` in public/data/facilities.json. This scans the map and UI sources (not the AI
// panel, its trace or the allocation panel, which another stream owns) for a facility name written out as a literal.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { repoPath } from '../../test/helpers/paths';

const names = (JSON.parse(readFileSync(repoPath('public/data/facilities.json'), 'utf8')) as Array<{ name: string }>).map((f) => f.name);
const OWNED_ELSEWHERE = /^(aiPanel|aiTrace|allocationPanel)/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) && !OWNED_ELSEWHERE.test(e.name) ? [path] : [];
  });
}

describe('facility names in the UI code', () => {
  test('the data file has 48 distinct names (the scan below has something to look for)', () => {
    expect(names).toHaveLength(48);
    expect(new Set(names).size).toBe(48);
  });

  test('no source file under src/map or src/ui types a facility name', () => {
    const files = [...sources(repoPath('src/map')), ...sources(repoPath('src/ui'))];
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const n of names) if (text.includes(n)) hits.push(`${file}: ${n}`);
    }
    expect(hits).toEqual([]);
  });
});
