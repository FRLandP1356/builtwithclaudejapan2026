import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { loadFinance } from '../../test/helpers/loadFinance';
import { repoPath } from '../../test/helpers/paths';
import type { Claim } from './claims';
import type { Landmark } from './landmarks';
import { ACTUAL_PATH, CHECKS_PATH, CLAIMS_PATH, DataLoadError, dataUrl, LANDMARKS_PATH, loadAll, loadPrefGeo, PREF_CODES } from './loader';

const sample = loadSampleAreas();
const facilities = loadFacilities();
const finance = loadFinance();
/** The real landmarks file as served: the loader keeps the items of the sample's six towns. */
const landmarksRaw = JSON.parse(readFileSync(repoPath('public/data/landmarks.json'), 'utf8')) as { items: Landmark[] };
/** The real claims file as served: the loader keeps the items whose prefectures are all in the sample. */
const claimsRaw = JSON.parse(readFileSync(repoPath('public/data/claims.json'), 'utf8')) as { items: Claim[] };
/** The real checks file as served: the loader keeps the towns of the sample. */
const checksRaw = JSON.parse(readFileSync(repoPath('public/data/checks.json'), 'utf8')) as unknown;
const actualRaw = JSON.parse(readFileSync(repoPath('public/data/actual2025.json'), 'utf8')) as unknown;
const topo = { type: 'Topology', objects: { prefectures: { type: 'GeometryCollection', geometries: [] } }, arcs: [] };
const prefTopo = { type: 'Topology', objects: { areas: { type: 'GeometryCollection', geometries: [] } }, arcs: [] };

/** A fetch stub that serves the data files from memory. */
function makeFetch(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetchStub = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url in overrides) {
      const v = overrides[url];
      if (v instanceof Error) throw v;
      if (typeof v === 'number') return new Response('', { status: v });
      return new Response(JSON.stringify(v), { status: 200 });
    }
    const m = url.match(/data\/areas\/(\d\d)\.json$/);
    if (m) {
      const areas = sample.filter((a) => a.prefCode === m[1]);
      return new Response(JSON.stringify(areas), { status: 200 });
    }
    if (url.endsWith('data/groups.json')) {
      const prefs: Record<string, string[]> = {};
      for (const a of sample) (prefs[a.prefCode] ??= []).push(a.code);
      return new Response(JSON.stringify({ cities: {}, prefs }), { status: 200 });
    }
    if (url.endsWith('data/facilities.json')) return new Response(JSON.stringify(facilities), { status: 200 });
    if (url.endsWith('data/finance.json')) return new Response(JSON.stringify(finance), { status: 200 });
    if (url.endsWith(LANDMARKS_PATH)) return new Response(JSON.stringify(landmarksRaw), { status: 200 });
    if (url.endsWith(CLAIMS_PATH)) return new Response(JSON.stringify(claimsRaw), { status: 200 });
    if (url.endsWith(CHECKS_PATH)) return new Response(JSON.stringify(checksRaw), { status: 200 });
    if (url.endsWith(ACTUAL_PATH)) return new Response(JSON.stringify(actualRaw), { status: 200 });
    if (url.endsWith('data/geo/japan.topo.json')) return new Response(JSON.stringify(topo), { status: 200 });
    if (/data\/geo\/pref\/\d\d\.topo\.json$/.test(url)) return new Response(JSON.stringify(prefTopo), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  return { fetchStub, calls };
}

describe('dataUrl', () => {
  test('joins the base and the data path without double slashes', () => {
    expect(dataUrl('data/areas/01.json', '/')).toBe('/data/areas/01.json');
    expect(dataUrl('data/areas/01.json', './')).toBe('./data/areas/01.json');
    expect(dataUrl('data/areas/01.json', '/town/')).toBe('/town/data/areas/01.json');
    expect(dataUrl('data/areas/01.json', '/town')).toBe('/town/data/areas/01.json');
  });
});

describe('loadAll', () => {
  test('fetches the 47 area files, groups, facilities and the national topology in parallel', async () => {
    const { fetchStub, calls } = makeFetch();
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(PREF_CODES).toHaveLength(47);
    expect(calls.filter((u) => /data\/areas\/\d\d\.json$/.test(u))).toHaveLength(47);
    expect(calls).toContain('/data/groups.json');
    expect(calls).toContain('/data/facilities.json');
    expect(calls).toContain('/data/finance.json');
    expect(calls).toContain('/data/landmarks.json');
    expect(calls).toContain('/data/claims.json');
    expect(calls).toContain('/data/checks.json');
    expect(calls).toContain('/data/actual2025.json');
    expect(calls).toContain('/data/geo/japan.topo.json');
    expect(data.areas.length).toBe(sample.length);
    expect(data.facilities.length).toBe(facilities.length);
    expect(data.finance).toEqual(finance);
    expect(data.japanTopo.objects.prefectures).toBeDefined();
    expect(data.groups.prefs).toBeDefined();
    // prefecture names come from the areas
    const any = sample[0];
    expect(data.prefNames.get(any.prefCode)).toBe(any.prefName);
  });

  test('a failing file rejects with a Japanese DataLoadError naming the file', async () => {
    const { fetchStub } = makeFetch({ '/data/areas/30.json': 500 });
    await expect(loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' })).rejects.toBeInstanceOf(DataLoadError);
    try {
      await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    } catch (e) {
      const err = e as DataLoadError;
      expect(err.message).toMatch(/読み込/);
      expect(err.url).toBe('/data/areas/30.json');
      expect(err.status).toBe(500);
      expect(err.reason).toBe('http');
    }
  });

  test('a finance.json that is not in the expected shape rejects with a shape error naming the file', async () => {
    const { fetchStub } = makeFetch({ '/data/finance.json': { ...finance, bands: [] } });
    await expect(loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' })).rejects.toMatchObject({
      name: 'DataLoadError',
      reason: 'shape',
      url: '/data/finance.json',
    });
  });

  test('a missing finance.json fails the load like any other data file', async () => {
    const { fetchStub } = makeFetch({ '/data/finance.json': 404 });
    await expect(loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' })).rejects.toMatchObject({ reason: 'http', status: 404, url: '/data/finance.json' });
  });

  describe('landmarks.json is the one optional file', () => {
    afterEach(() => vi.restoreAllMocks());
    const load = (overrides: Record<string, unknown> = {}) => loadAll({ fetch: makeFetch(overrides).fetchStub as unknown as typeof fetch, base: '/' });

    test('when it loads, data.landmarks holds the items of the known towns, in the file order', async () => {
      const data = await load();
      const codes = new Set(sample.map((a) => a.code));
      expect(data.landmarks).toEqual(landmarksRaw.items.filter((l) => codes.has(l.areaCode)));
      for (const l of data.landmarks!) expect(codes.has(l.areaCode), l.id).toBe(true);
    });

    test('a 404 leaves it out: the load succeeds, data has no landmarks, one warning names the file', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = await load({ '/data/landmarks.json': 404 });
      expect(data.areas.length).toBe(sample.length);
      expect('landmarks' in data).toBe(false);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('data/landmarks.json');
    });

    test('a network error on it does not fail the load', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = await load({ '/data/landmarks.json': new TypeError('Failed to fetch') });
      expect(data.landmarks).toBeUndefined();
      expect(data.finance).toEqual(finance);
    });

    test('a file that is not in shape is left out with a warning (another version, a bare string, items that are not a list)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const body of [{ version: 2, items: [] }, 'text', { version: 1, items: {} }]) {
        const data = await load({ '/data/landmarks.json': body });
        expect(data.landmarks, JSON.stringify(body)).toBeUndefined();
      }
      expect(warn).toHaveBeenCalledTimes(3);
    });

    test('an item of an unknown town is dropped without a warning', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const known = landmarksRaw.items.find((l) => sample.some((a) => a.code === l.areaCode));
      const stranger = { ...landmarksRaw.items[0], id: 'stranger', prefCode: '99', areaCode: '99999' };
      const data = await load({ '/data/landmarks.json': { version: 1, items: [stranger, ...(known ? [known] : [])] } });
      expect(data.landmarks).toEqual(known ? [known] : []);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('claims.json is the other optional file', () => {
    afterEach(() => vi.restoreAllMocks());
    const load = (overrides: Record<string, unknown> = {}) => loadAll({ fetch: makeFetch(overrides).fetchStub as unknown as typeof fetch, base: '/' });
    const prefs = new Set(sample.map((a) => a.prefCode));
    const item = (over: Partial<Claim> = {}): Claim => ({ ...claimsRaw.items[0], id: 'synthetic', prefCodes: [sample[0].prefCode], ...over });

    test('when it loads, data.claims holds the items whose prefectures are all known, in the file order', async () => {
      const data = await load();
      const want = claimsRaw.items.filter((c) => c.prefCodes.every((p) => prefs.has(p)));
      expect(data.claims).toEqual(want);
      for (const c of data.claims!) for (const p of c.prefCodes) expect(prefs.has(p), c.id).toBe(true);
    });

    test('a 404 leaves it out: the load succeeds, data has no claims, one warning names the file', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = await load({ '/data/claims.json': 404 });
      expect(data.areas.length).toBe(sample.length);
      expect('claims' in data).toBe(false);
      expect(data.landmarks).toBeDefined(); // the other optional file is not touched
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('data/claims.json');
    });

    test('a network error on it does not fail the load', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = await load({ '/data/claims.json': new TypeError('Failed to fetch') });
      expect(data.claims).toBeUndefined();
      expect(data.finance).toEqual(finance);
    });

    test('a file that is not in shape is left out with a warning (another version, a bare string, items that are not a list)', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      for (const body of [{ version: 2, items: [] }, 'text', { version: 1, items: {} }]) {
        const data = await load({ '/data/claims.json': body });
        expect(data.claims, JSON.stringify(body)).toBeUndefined();
      }
      expect(warn).toHaveBeenCalledTimes(3);
    });

    test('an item of an unknown prefecture is dropped without a warning; an item in shape is kept', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const data = await load({ '/data/claims.json': { version: 1, items: [item({ id: 'stranger', prefCodes: ['99'] }), item({ id: 'known' })] } });
      expect(data.claims!.map((c) => c.id)).toEqual(['known']);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  test('a network error is wrapped the same way', async () => {
    const { fetchStub } = makeFetch({ '/data/groups.json': new TypeError('Failed to fetch') });
    await expect(loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' })).rejects.toMatchObject({
      name: 'DataLoadError',
      reason: 'network',
    });
  });

  test('a request that never answers fails after the timeout with a clear message', async () => {
    const hanging = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    const p = loadAll({ fetch: hanging, base: '/', timeoutMs: 20 });
    await expect(p).rejects.toMatchObject({ name: 'DataLoadError', reason: 'timeout' });
    await p.catch((e: DataLoadError) => expect(e.message).toMatch(/応答がありません/));
  });

  test('a body that stalls after the headers also fails after the timeout', async () => {
    const stalledBody = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise<never>((_, reject) => {
              init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(loadAll({ fetch: stalledBody, base: '/', timeoutMs: 20 })).rejects.toMatchObject({ name: 'DataLoadError', reason: 'timeout' });
  });

  test('requests are sent with an abort signal', async () => {
    const { fetchStub } = makeFetch();
    await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    const init = fetchStub.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test('invalid JSON is reported as a load error too', async () => {
    const fetchStub = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(loadAll({ fetch: fetchStub, base: '/' })).rejects.toBeInstanceOf(DataLoadError);
  });
});

describe('loadPrefGeo', () => {
  test('loads a prefecture topology once and caches it', async () => {
    const { fetchStub, calls } = makeFetch();
    const opts = { fetch: fetchStub as unknown as typeof fetch, base: '/', cache: new Map() };
    const a = await loadPrefGeo('30', opts);
    const b = await loadPrefGeo('30', opts);
    expect(b).toBe(a);
    expect(calls.filter((u) => u.endsWith('data/geo/pref/30.topo.json'))).toHaveLength(1);
    expect(a.objects.areas).toBeDefined();
  });

  test('concurrent calls share one request', async () => {
    const { fetchStub, calls } = makeFetch();
    const opts = { fetch: fetchStub as unknown as typeof fetch, base: '/', cache: new Map() };
    const [a, b] = await Promise.all([loadPrefGeo('13', opts), loadPrefGeo('13', opts)]);
    expect(b).toBe(a);
    expect(calls.filter((u) => u.endsWith('data/geo/pref/13.topo.json'))).toHaveLength(1);
  });

  test('a failed load is not cached, so a retry fetches again', async () => {
    const { fetchStub, calls } = makeFetch({ '/data/geo/pref/47.topo.json': 404 });
    const opts = { fetch: fetchStub as unknown as typeof fetch, base: '/', cache: new Map() };
    await expect(loadPrefGeo('47', opts)).rejects.toBeInstanceOf(DataLoadError);
    await expect(loadPrefGeo('47', opts)).rejects.toBeInstanceOf(DataLoadError);
    expect(calls.filter((u) => u.endsWith('data/geo/pref/47.topo.json'))).toHaveLength(2);
  });

  test('rejects a code that is not a prefecture', async () => {
    const { fetchStub } = makeFetch();
    await expect(loadPrefGeo('99', { fetch: fetchStub as unknown as typeof fetch, base: '/', cache: new Map() })).rejects.toThrow();
  });
});

describe('loadAll: checks.json is optional', () => {
  test('keeps the towns of the areas it was given', async () => {
    const { fetchStub } = makeFetch();
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(data.checks).toBeDefined();
    expect(data.checks!.towns.map((t) => t.code).sort()).toEqual(sample.map((a) => a.code).sort());
    expect(data.checks!.census.national).toBe(122972528);
  });

  test('a missing file is left out with a warning; the rest still loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchStub } = makeFetch({ '/data/checks.json': 404 });
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(data.checks).toBeUndefined();
    expect(data.areas.length).toBe(sample.length);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('data/checks.json');
    warn.mockRestore();
  });

  test('a file out of shape is left out with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchStub } = makeFetch({ '/data/checks.json': { version: 1 } });
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(data.checks).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('loadAll: actual2025.json is optional', () => {
  test('attaches the 2025 census count to the areas it has', async () => {
    const { fetchStub } = makeFetch();
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    const withCount = data.areas.filter((a) => a.actual);
    expect(withCount.length).toBe(sample.length); // the six sample towns all have a count
    const tanabe = data.areas.find((a) => a.code === '30206');
    if (tanabe) expect([...tanabe.actual!.M, ...tanabe.actual!.F].reduce((x, y) => x + y, 0)).toBe(64288);
  });

  test('a missing file is left out with a warning; the rest still loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchStub } = makeFetch({ '/data/actual2025.json': 404 });
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(data.areas.every((a) => a.actual === undefined)).toBe(true);
    expect(data.areas.length).toBe(sample.length);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('data/actual2025.json');
    warn.mockRestore();
  });

  test('a file out of shape is left out with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetchStub } = makeFetch({ '/data/actual2025.json': { version: 1, areas: { '30206': { M: [1], F: [1] } } } });
    const data = await loadAll({ fetch: fetchStub as unknown as typeof fetch, base: '/' });
    expect(data.areas.every((a) => a.actual === undefined)).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
