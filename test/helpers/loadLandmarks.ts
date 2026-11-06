// Test-only helper that reads the landmarks file from disk (the app itself loads it over HTTP, and runs without it).
import { readFileSync } from 'node:fs';
import { parseLandmarks, type Landmark } from '../../src/data/landmarks';
import { repoPath } from './paths';

const LANDMARKS_FILE = repoPath('public/data/landmarks.json');

/** public/data/landmarks.json, shape-checked like the loader does, kept to the towns `knownArea` accepts. */
export function loadLandmarks(knownArea: (code: string) => boolean): Landmark[] {
  return parseLandmarks(JSON.parse(readFileSync(LANDMARKS_FILE, 'utf8')), knownArea);
}
