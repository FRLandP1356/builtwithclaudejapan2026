// Test-only helper that reads the facility thresholds from disk (the app itself loads them over HTTP).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Facility } from '../../src/engine/types';

const FACILITIES_FILE = fileURLToPath(new URL('../../public/data/facilities.json', import.meta.url));

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
