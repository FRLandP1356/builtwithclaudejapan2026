// Test-only helper that reads the facility thresholds from disk (the app itself loads them over HTTP).
import { readFileSync } from 'node:fs';
import type { Facility } from '../../src/engine/types';
import { repoPath } from './paths';

const FACILITIES_FILE = repoPath('public/data/facilities.json');

/** All 48 rows of public/data/facilities.json. */
export function loadFacilities(): Facility[] {
  return JSON.parse(readFileSync(FACILITIES_FILE, 'utf8')) as Facility[];
}

/** Look a facility up by id (never by Japanese name) or fail loudly. */
export function facilityById(facilities: Facility[], id: string): Facility {
  const f = facilities.find((x) => x.id === id);
  if (!f) throw new Error(`facility ${id} not found`);
  return f;
}
