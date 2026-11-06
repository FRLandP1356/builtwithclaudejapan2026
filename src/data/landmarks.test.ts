// The landmarks file: its shape check, the indexes, and the real file against the real areas.
import { describe, expect, test } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadLandmarks } from '../../test/helpers/loadLandmarks';
import { indexLandmarks, landmarksOf, parseLandmarks, type Landmark } from './landmarks';

const known = new Set(['30206', '30344', '27104']);
const isKnown = (c: string) => known.has(c);

const item = (over: Partial<Landmark> = {}): Landmark => ({
  id: 'kumano-hongu',
  name: '熊野本宮大社',
  kind: '神社',
  prefCode: '30',
  areaCode: '30206',
  summary: '田辺市本宮町にある神社。',
  source: 'https://example.org/hongu',
  sourceLabel: '例の出典',
  ...over,
});

describe('parseLandmarks', () => {
  test('keeps the items whose town is known, in the file order, copying the eight fields', () => {
    const a = item();
    const b = item({ id: 'koyasan', name: '高野山 金剛峯寺', kind: '寺院', areaCode: '30344' });
    expect(parseLandmarks({ version: 1, note: 'x', items: [a, b] }, isKnown)).toEqual([a, b]);
  });

  test('drops an item whose areaCode the app does not know, silently', () => {
    const out = parseLandmarks({ version: 1, items: [item(), item({ id: 'nowhere', areaCode: '30999' })] }, isKnown);
    expect(out.map((l) => l.id)).toEqual(['kumano-hongu']);
  });

  test('drops an item whose prefCode is not the head of its areaCode', () => {
    const out = parseLandmarks({ version: 1, items: [item({ prefCode: '27' })] }, isKnown);
    expect(out).toEqual([]);
  });

  test('drops an item that is not in shape (a missing field, an empty string, a number, not an object)', () => {
    const { sourceLabel: _dropped, ...noLabel } = item();
    const items = [noLabel, item({ name: '' }), { ...item(), kind: 3 }, null, 'text', 7, item({ id: 'ok' })];
    expect(parseLandmarks({ version: 1, items }, isKnown).map((l) => l.id)).toEqual(['ok']);
  });

  test('a repeated id keeps the first item', () => {
    const out = parseLandmarks({ version: 1, items: [item({ name: '一つ目' }), item({ name: '二つ目' })] }, isKnown);
    expect(out.map((l) => l.name)).toEqual(['一つ目']);
  });

  test('a file that is not { version: 1, items: [] } throws', () => {
    expect(() => parseLandmarks(null, isKnown)).toThrow(TypeError);
    expect(() => parseLandmarks('[]', isKnown)).toThrow(TypeError);
    expect(() => parseLandmarks({ version: 2, items: [] }, isKnown)).toThrow(/version/);
    expect(() => parseLandmarks({ version: 1, items: {} }, isKnown)).toThrow(/items/);
    expect(() => parseLandmarks({ items: [] }, isKnown)).toThrow(/version/);
  });

  test('an empty file is fine: no items', () => {
    expect(parseLandmarks({ version: 1, items: [] }, isKnown)).toEqual([]);
  });
});

describe('indexLandmarks / landmarksOf', () => {
  const a = item();
  const b = item({ id: 'takijiri', name: '滝尻王子', kind: '観光地' });
  const c = item({ id: 'koyasan', name: '高野山 金剛峯寺', kind: '寺院', areaCode: '30344' });
  const d = item({ id: 'usj', name: 'ユニバーサル・スタジオ・ジャパン', kind: 'テーマパーク', prefCode: '27', areaCode: '27104' });
  const index = indexLandmarks([a, b, c, d]);

  test('groups by prefecture and by town, keeping the file order inside a group', () => {
    expect([...index.byPref.keys()]).toEqual(['30', '27']);
    expect(index.byPref.get('30')!.map((l) => l.id)).toEqual(['kumano-hongu', 'takijiri', 'koyasan']);
    expect(index.byArea.get('30206')!.map((l) => l.id)).toEqual(['kumano-hongu', 'takijiri']);
    expect(index.byArea.get('30344')!.map((l) => l.id)).toEqual(['koyasan']);
  });

  test('landmarksOf: a prefecture, a town, nothing for the country or an unknown key', () => {
    expect(landmarksOf(index, 'pref', '27').map((l) => l.id)).toEqual(['usj']);
    expect(landmarksOf(index, 'area', '27104').map((l) => l.id)).toEqual(['usj']);
    expect(landmarksOf(index, 'area', '30201')).toEqual([]);
    expect(landmarksOf(index, 'pref', '99')).toEqual([]);
    expect(landmarksOf(index, 'japan', 'japan')).toEqual([]);
  });
});

describe('public/data/landmarks.json against the real areas', () => {
  const areas = loadAllAreas();
  const codes = new Set(areas.map((a) => a.code));
  const items = loadLandmarks((c) => codes.has(c));
  const index = indexLandmarks(items);

  test('220 items, every one in a known town, no id twice', () => {
    expect(items).toHaveLength(220);
    expect(new Set(items.map((l) => l.id)).size).toBe(220);
    for (const l of items) expect(codes.has(l.areaCode), l.id).toBe(true);
  });

  test('every prefecture has at least three items; 和歌山県 has eight and 田辺市 two', () => {
    expect(index.byPref.size).toBe(47);
    for (const [pp, list] of index.byPref) expect(list.length, pp).toBeGreaterThanOrEqual(3);
    expect(index.byPref.get('30')!.map((l) => l.name)).toEqual(['和歌山城', '熊野本宮大社', '滝尻王子', '高野山 金剛峯寺', 'アドベンチャーワールド', '白浜温泉', '熊野那智大社', '那智の滝']);
    expect(index.byArea.get('30206')!.map((l) => l.name)).toEqual(['熊野本宮大社', '滝尻王子']);
  });

  test('a summary is one sentence of at most 45 characters and every source is an https URL', () => {
    for (const l of items) {
      expect(l.summary.length, l.id).toBeLessThanOrEqual(45);
      expect(l.source, l.id).toMatch(/^https:\/\//);
    }
  });

  test('no item says what becomes of a place: the words that would predict or judge are absent from the names and summaries', () => {
    const forbidden = ['残せない', '閉鎖', 'なくなる', '撤退', '廃止', '危機', '消える', '予測', 'おすすめ', 'べき'];
    for (const l of items) {
      for (const w of forbidden) {
        expect(l.name.includes(w), `${l.id} name ${w}`).toBe(false);
        expect(l.summary.includes(w), `${l.id} summary ${w}`).toBe(false);
      }
    }
  });
});
