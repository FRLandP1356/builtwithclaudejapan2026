import { describe, expect, test, vi } from 'vitest';
import { loadSampleAreas } from '../../test/helpers/loadAreas';
import { loadFacilities } from '../../test/helpers/loadFacilities';
import { loadFinance } from '../../test/helpers/loadFinance';
import { DataLoadError, dataUrl, loadAll, loadPrefGeo, PREF_CODES } from './loader';

const sample = loadSampleAreas();
const facilities = loadFacilities();
const finance = loadFinance();
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
