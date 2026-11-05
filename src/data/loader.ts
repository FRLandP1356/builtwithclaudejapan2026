// Loads the static data files Vite serves from public/ (areas, groups, facilities, boundaries).
// All URLs are relative to import.meta.env.BASE_URL so the app works at any mount path.
import type { Topology } from 'topojson-specification';
import type { Area, Facility, Groups } from '../engine/types';

export interface AppData {
  /** All 1,884 areas, in prefecture-file order. */
  areas: Area[];
  groups: Groups;
  facilities: Facility[];
  /** 47 prefecture shapes, object name `prefectures`, properties { code, name }. */
  japanTopo: Topology;
  /** Prefecture code -> name, taken from the areas. */
  prefNames: Map<string, string>;
}

/** The 47 prefecture codes, "01".."47". */
export const PREF_CODES: readonly string[] = Array.from({ length: 47 }, (_, i) => String(i + 1).padStart(2, '0'));

export type LoadFailure = 'network' | 'timeout' | 'http' | 'parse' | 'shape';

/** A data file could not be fetched or parsed. `message` is Japanese and names the file. */
export class DataLoadError extends Error {
  readonly url: string;
  readonly status?: number;
  readonly reason: LoadFailure;
  constructor(url: string, reason: LoadFailure, status?: number, cause?: unknown, detail?: string) {
    const why =
      reason === 'timeout'
        ? `、${detail ?? '応答がありません'}`
        : reason === 'http'
          ? `、HTTP ${status}`
          : reason === 'parse' || reason === 'shape'
            ? '、内容を読めません'
            : '';
    super(`データを読み込めませんでした（${url}${why}）`, { cause });
    this.name = 'DataLoadError';
    this.url = url;
    this.status = status;
    this.reason = reason;
  }
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export interface LoadOptions {
  /** Injectable fetch (tests). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Base URL. Defaults to import.meta.env.BASE_URL. */
  base?: string;
  /** Per-request timeout; a request that takes longer fails with reason 'timeout'. */
  timeoutMs?: number;
}

/** Join the base URL and a data path: dataUrl('data/areas/01.json', '/town/') -> '/town/data/areas/01.json'. */
export function dataUrl(path: string, base: string = import.meta.env.BASE_URL): string {
  const b = base.endsWith('/') ? base : `${base}/`;
  return b + path.replace(/^\/+/, '');
}

/** Fetch and parse one JSON file. One timeout covers the whole exchange: headers AND body (a stalled body times out too). */
async function fetchJson<T>(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const timeoutError = (e: unknown) => new DataLoadError(url, 'timeout', undefined, e, `${Math.round(timeoutMs / 1000)}秒たっても応答がありません`);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) throw timeoutError(e);
      throw new DataLoadError(url, 'network', undefined, e);
    }
    if (!res.ok) throw new DataLoadError(url, 'http', res.status);
    try {
      return (await res.json()) as T;
    } catch (e) {
      if (ac.signal.aborted) throw timeoutError(e);
      throw new DataLoadError(url, 'parse', res.status, e);
    }
  } finally {
    clearTimeout(timer);
  }
}

function resolveFetch(opts: LoadOptions): typeof fetch {
  return opts.fetch ?? ((input, init) => fetch(input, init));
}

/** Load everything the app needs to start: 47 area files, groups, facilities and the national boundaries, in parallel. */
export async function loadAll(opts: LoadOptions = {}): Promise<AppData> {
  const f = resolveFetch(opts);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = (p: string) => (opts.base === undefined ? dataUrl(p) : dataUrl(p, opts.base));

  const areaFiles = PREF_CODES.map((pp) => fetchJson<Area[]>(url(`data/areas/${pp}.json`), f, timeoutMs));
  const [groups, facilities, japanTopo, ...areaLists] = await Promise.all([
    fetchJson<Groups>(url('data/groups.json'), f, timeoutMs),
    fetchJson<Facility[]>(url('data/facilities.json'), f, timeoutMs),
    fetchJson<Topology>(url('data/geo/japan.topo.json'), f, timeoutMs),
    ...areaFiles,
  ]);

  const areas: Area[] = [];
  const prefNames = new Map<string, string>();
  areaLists.forEach((list, i) => {
    if (!Array.isArray(list)) throw new DataLoadError(url(`data/areas/${PREF_CODES[i]}.json`), 'shape');
    for (const a of list) {
      areas.push(a);
      if (!prefNames.has(a.prefCode)) prefNames.set(a.prefCode, a.prefName);
    }
  });
  if (!japanTopo || typeof japanTopo !== 'object' || !('objects' in japanTopo)) {
    throw new DataLoadError(url('data/geo/japan.topo.json'), 'shape');
  }
  return { areas, groups, facilities, japanTopo, prefNames };
}

export interface PrefGeoOptions extends LoadOptions {
  /** Injectable cache (tests). Defaults to a module-level cache shared by the app. */
  cache?: Map<string, Promise<Topology>>;
}

const prefGeoCache = new Map<string, Promise<Topology>>();

/**
 * Load the municipality boundaries of one prefecture (object name `areas`, properties { code, name }).
 * Decoded once and cached; concurrent calls share one request; a failed load is not cached.
 */
export function loadPrefGeo(prefCode: string, opts: PrefGeoOptions = {}): Promise<Topology> {
  if (!PREF_CODES.includes(prefCode)) return Promise.reject(new RangeError(`loadPrefGeo: not a prefecture code: ${prefCode}`));
  const cache = opts.cache ?? prefGeoCache;
  const hit = cache.get(prefCode);
  if (hit) return hit;
  const path = `data/geo/pref/${prefCode}.topo.json`;
  const url = opts.base === undefined ? dataUrl(path) : dataUrl(path, opts.base);
  const p = fetchJson<Topology>(url, resolveFetch(opts), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS).catch((e: unknown) => {
    cache.delete(prefCode);
    throw e;
  });
  cache.set(prefCode, p);
  return p;
}
