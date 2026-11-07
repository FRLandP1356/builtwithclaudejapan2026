// The claims file: its shape check, the index by prefecture, and the real file against the real prefectures.
import { describe, expect, test } from 'vitest';
import { loadAllAreas } from '../../test/helpers/loadAreas';
import { loadClaims, rawClaimsFile } from '../../test/helpers/loadClaims';
import { claimsOfPref, indexClaims, parseClaims, type Claim } from './claims';

const known = new Set(['30', '36', '39']);
const isKnown = (c: string) => known.has(c);

const item = (over: Partial<Claim> = {}): Claim => ({
  id: 'jrs-all-common',
  subject: 'JR四国（四国全域の線区）',
  kind: '鉄道',
  prefCodes: ['36', '39'],
  quote: '四国全域で沿線人口の減少が加速度的に進んでおり',
  paraphrase: '総括的検証報告書は、沿線人口の減少が加速度的に進んでいると述べている。',
  stance: 'possibility',
  source: 'https://example.org/report.pdf',
  sourceLabel: '例の発行者「例の資料」',
  date: '2026-03',
  readOn: '2026-11-07',
  ...over,
});

describe('parseClaims', () => {
  test('keeps the items whose prefectures are all known, in the file order, copying the eleven fields', () => {
    const a = item();
    const b = item({ id: 'wak-kumano', prefCodes: ['30'], stance: 'fact' });
    expect(parseClaims({ version: 1, note: 'x', items: [a, b] }, isKnown)).toEqual([a, b]);
  });

  test('the quote is copied as written: no trimming, no normalising', () => {
    const quote = '  全角　スペースと  二重の空白を含む  ';
    expect(parseClaims({ version: 1, items: [item({ quote })] }, isKnown)[0].quote).toBe(quote);
  });

  test('an item that names a prefecture the app does not know is dropped whole, silently (it is not trimmed to the known ones)', () => {
    const out = parseClaims({ version: 1, items: [item({ id: 'a', prefCodes: ['36', '99'] }), item({ id: 'b', prefCodes: ['36'] })] }, isKnown);
    expect(out.map((c) => c.id)).toEqual(['b']);
  });

  test('a prefecture named twice in one item counts once', () => {
    expect(parseClaims({ version: 1, items: [item({ prefCodes: ['36', '36', '39'] })] }, isKnown)[0].prefCodes).toEqual(['36', '39']);
  });

  test('drops an item that is not in shape (a missing field, an empty string, a number, a wrong stance, no prefecture, not an object)', () => {
    const { sourceLabel: _dropped, ...noLabel } = item();
    const items = [
      noLabel,
      item({ quote: '' }),
      { ...item(), subject: 3 },
      { ...item(), stance: 'prediction' },
      { ...item(), prefCodes: [] },
      { ...item(), prefCodes: '36' },
      { ...item(), prefCodes: [36] },
      null,
      'text',
      7,
      item({ id: 'ok' }),
    ];
    expect(parseClaims({ version: 1, items }, isKnown).map((c) => c.id)).toEqual(['ok']);
  });

  test('a repeated id keeps the first item', () => {
    const out = parseClaims({ version: 1, items: [item({ subject: '一つ目' }), item({ subject: '二つ目' })] }, isKnown);
    expect(out.map((c) => c.subject)).toEqual(['一つ目']);
  });

  test('a file that is not { version: 1, items: [] } throws', () => {
    expect(() => parseClaims(null, isKnown)).toThrow(TypeError);
    expect(() => parseClaims('[]', isKnown)).toThrow(TypeError);
    expect(() => parseClaims({ version: 2, items: [] }, isKnown)).toThrow(/version/);
    expect(() => parseClaims({ version: 1, items: {} }, isKnown)).toThrow(/items/);
    expect(() => parseClaims({ items: [] }, isKnown)).toThrow(/version/);
  });

  test('an empty file is fine: no items', () => {
    expect(parseClaims({ version: 1, items: [] }, isKnown)).toEqual([]);
  });
});

describe('indexClaims / claimsOfPref', () => {
  const a = item({ id: 'a', prefCodes: ['36', '39'] });
  const b = item({ id: 'b', prefCodes: ['39'] });
  const c = item({ id: 'c', prefCodes: ['30'], stance: 'fact' });
  const index = indexClaims([a, b, c]);

  test('a claim that concerns several prefectures is in each of them, and each group keeps the file order', () => {
    expect([...index.byPref.keys()]).toEqual(['36', '39', '30']);
    expect(index.byPref.get('36')!.map((x) => x.id)).toEqual(['a']);
    expect(index.byPref.get('39')!.map((x) => x.id)).toEqual(['a', 'b']);
  });

  test('claimsOfPref: a prefecture; none for a prefecture without claims or an unknown key', () => {
    expect(claimsOfPref(index, '30').map((x) => x.id)).toEqual(['c']);
    expect(claimsOfPref(index, '13')).toEqual([]);
    expect(claimsOfPref(index, '99')).toEqual([]);
    expect(claimsOfPref(index, '')).toEqual([]);
  });
});

describe('public/data/claims.json against the real prefectures', () => {
  const prefs = new Set(loadAllAreas().map((a) => a.prefCode));
  const items = loadClaims((p) => prefs.has(p));
  const index = indexClaims(items);

  test('34 items, none dropped by the shape check, no id twice', () => {
    expect(rawClaimsFile().items).toHaveLength(34);
    expect(items).toHaveLength(34);
    expect(new Set(items.map((c) => c.id)).size).toBe(34);
  });

  test('every source is an https URL, every quote is at most 80 characters, every stance is one of the two', () => {
    for (const c of items) {
      expect(c.source, c.id).toMatch(/^https:\/\//);
      expect(c.quote.length, c.id).toBeLessThanOrEqual(80);
      expect(['possibility', 'fact'], c.id).toContain(c.stance);
      expect(c.date, c.id).toMatch(/^\d{4}(-\d{2}(-\d{2})?)?$/);
    }
  });

  test('the prefectures with claims: 15 of them; the four of 四国 have 11 each, 和歌山県 has 3 and 東京都 and 北海道 have none', () => {
    expect([...index.byPref.keys()].sort()).toEqual(['02', '03', '12', '15', '19', '20', '28', '30', '33', '34', '36', '37', '38', '39', '42']);
    for (const p of ['36', '37', '38', '39']) expect(claimsOfPref(index, p), p).toHaveLength(11);
    expect(claimsOfPref(index, '30').map((c) => c.id)).toEqual(['wak-kumano', 'wak-pref-transit', 'wak-koya-shops']);
    expect(claimsOfPref(index, '13')).toEqual([]);
    expect(claimsOfPref(index, '01')).toEqual([]);
  });
});
