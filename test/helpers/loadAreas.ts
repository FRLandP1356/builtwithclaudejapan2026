// Test-only helpers that read area data from disk (the app itself loads it over HTTP).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Area } from '../../src/engine/types';
import { repoPath } from './paths';

const AREAS_DIR = repoPath('public/data/areas');
const SAMPLE_FILE = repoPath('test/fixtures/sample_areas.json');

/** All 1,884 areas from public/data/areas/<prefCode>.json, ordered by prefecture file then by file order. */
export function loadAllAreas(): Area[] {
  const files = readdirSync(AREAS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const areas: Area[] = [];
  for (const f of files) {
    areas.push(...(JSON.parse(readFileSync(join(AREAS_DIR, f), 'utf8')) as Area[]));
  }
  return areas;
}

/** The six-area fixture used for fast unit tests (two of them have assumptions === null). */
export function loadSampleAreas(): Area[] {
  return JSON.parse(readFileSync(SAMPLE_FILE, 'utf8')) as Area[];
}

/** Look an area up by its 5-digit code or fail loudly. */
export function byCode(areas: Area[], code: string): Area {
  const a = areas.find((x) => x.code === code);
  if (!a) throw new Error(`area ${code} not found`);
  return a;
}
