// Test-only: a PanelContext built from the real 1,884 areas, the 48 facilities and the groups on disk, so panel tests
// run against real numbers. The boundary shapes are not needed by panels and are left empty.
import { readFileSync } from 'node:fs';
import type { Topology } from 'topojson-specification';
import type { AppData } from '../../src/data/loader';
import { createRunner } from '../../src/data/runner';
import type { Groups } from '../../src/engine/types';
import { createAppStore, type AppStoreInitial, type PanelContext } from '../../src/ui/state';
import { loadAllAreas } from './loadAreas';
import { loadFacilities } from './loadFacilities';
import { loadFinance } from './loadFinance';
import { loadLandmarks } from './loadLandmarks';
import { repoPath } from './paths';

let cached: AppData | undefined;

/** The real data, read once per test file (the landmarks included, as the loader would have them). */
export function realAppData(): AppData {
  if (cached) return cached;
  const areas = loadAllAreas();
  const prefNames = new Map<string, string>();
  for (const a of areas) if (!prefNames.has(a.prefCode)) prefNames.set(a.prefCode, a.prefName);
  const groups = JSON.parse(readFileSync(repoPath('public/data/groups.json'), 'utf8')) as Groups;
  const codes = new Set(areas.map((a) => a.code));
  cached = {
    areas,
    groups,
    facilities: loadFacilities(),
    finance: loadFinance(),
    japanTopo: { type: 'Topology', objects: {}, arcs: [] } as unknown as Topology,
    prefNames,
    landmarks: loadLandmarks((c) => codes.has(c)),
  };
  return cached;
}

/** A fresh runner and store over the real data. */
export function makeRealContext(initial: AppStoreInitial = {}): PanelContext {
  const data = realAppData();
  const runner = createRunner(data);
  const store = createAppStore(runner, data, { year: 2100, ...initial });
  return { store, data, runner };
}
