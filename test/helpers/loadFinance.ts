// Test-only helper that reads the spending-per-resident data from disk (the app itself loads it over HTTP).
import { readFileSync } from 'node:fs';
import { parseFinance, type Finance } from '../../src/data/finance';
import { repoPath } from './paths';

const FINANCE_FILE = repoPath('public/data/finance.json');

/** public/data/finance.json, shape-checked like the loader does. */
export function loadFinance(): Finance {
  return parseFinance(JSON.parse(readFileSync(FINANCE_FILE, 'utf8')));
}
