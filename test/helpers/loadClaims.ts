// Test-only helper that reads the claims file from disk (the app itself loads it over HTTP, and runs without it).
import { readFileSync } from 'node:fs';
import { parseClaims, type Claim } from '../../src/data/claims';
import { repoPath } from './paths';

const CLAIMS_FILE = repoPath('public/data/claims.json');

/** The file as it is on disk, before any shape check. */
export function rawClaimsFile(): { version: number; note: string; items: unknown[] } {
  return JSON.parse(readFileSync(CLAIMS_FILE, 'utf8')) as { version: number; note: string; items: unknown[] };
}

/** public/data/claims.json, shape-checked like the loader does, kept to the prefectures `knownPref` accepts. */
export function loadClaims(knownPref: (code: string) => boolean): Claim[] {
  return parseClaims(rawClaimsFile(), knownPref);
}
