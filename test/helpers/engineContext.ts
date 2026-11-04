// Test-only helper that builds a real EngineContext (all 1,884 areas, 48 facilities, groups) from the data on disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EngineContext } from '../../src/ai/tools';
import { projectAll } from '../../src/engine/project';
import type { Groups, Scenario, Series } from '../../src/engine/types';
import { loadAllAreas } from './loadAreas';
import { loadFacilities } from './loadFacilities';

const GROUPS_FILE = fileURLToPath(new URL('../../public/data/groups.json', import.meta.url));

/** The designated-city and prefecture groups from public/data/groups.json. */
export function loadGroups(): Groups {
  return JSON.parse(readFileSync(GROUPS_FILE, 'utf8')) as Groups;
}

/**
 * A real context. `run` projects ALL areas (Ruling 20) with the facility list (needed when infraStrength > 0) and is
 * memoised by scenario, the way the app's caller is expected to do it.
 */
export function makeEngineContext(): EngineContext {
  const areas = loadAllAreas();
  const facilities = loadFacilities();
  const groups = loadGroups();
  const cache = new Map<string, Map<string, Series>>();
  const run = (s: Scenario): Map<string, Series> => {
    const key = JSON.stringify([s.cwrMult, s.migMode, s.migScale, s.infraStrength]);
    let hit = cache.get(key);
    if (!hit) {
      hit = projectAll(areas, s, 2100, facilities);
      cache.set(key, hit);
    }
    return hit;
  };
  return { areas, facilities, groups, run };
}
