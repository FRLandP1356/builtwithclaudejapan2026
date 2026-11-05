import { describe, expect, test } from 'vitest';
import { byCode, loadAllAreas } from '../../test/helpers/loadAreas';
import { facilityById, loadFacilities } from '../../test/helpers/loadFacilities';
import { total } from '../engine/aggregate';
import { facilityStatus } from '../engine/facilities';
import { projectArea } from '../engine/project';
import { DEFAULT_SCENARIO, type Facility } from '../engine/types';
import {
  evaluateFacilities,
  facilityNotes,
  GUIDE_LEAD,
  guideText,
  INFRA_NOTE,
  METRO_NOTE,
  PERMANENT_NOTE,
  statusView,
  summaryLine,
  summaryParts,
} from './facilityPanel';

const areas = loadAllAreas();
const facilities = loadFacilities();
const tanabe = byCode(areas, '30206');
const chiyoda = byCode(areas, '13101');
const sapporoChuo = byCode(areas, '01101');
const tanabeSeries = projectArea(tanabe, DEFAULT_SCENARIO);

const fac = (over: Partial<Facility>): Facility => ({
  id: 'x',
  name: 'テスト施設',
  p50: 1500,
  p80: 2500,
  essential: false,
  excludesMetro: true,
  source: 's',
  ...over,
});

describe('statusView: the wording of the three states', () => {
  test('ok / edge / below read 人口の目安を上回る / 境目 / 人口の目安を下回る', () => {
    expect(statusView('ok')).toMatchObject({ label: '人口の目安を上回る', tagClass: 'tag tag-ok' });
    expect(statusView('edge')).toMatchObject({ label: '境目', tagClass: 'tag tag-edge' });
    expect(statusView('below')).toMatchObject({ label: '人口の目安を下回る', tagClass: 'tag tag-below' });
  });

  test('no wording says a facility cannot stay or will close', () => {
    for (const s of ['ok', 'edge', 'below'] as const) expect(statusView(s).label).not.toMatch(/残せない|閉鎖|閉店|撤退|廃止/);
  });
});

describe('guideText', () => {
  test('shows both thresholds in 人 with the shares', () => {
    expect(guideText(fac({ p50: 1500, p80: 2500 }))).toBe('目安：1,500人（50%）〜 2,500人（80%）');
    expect(guideText(fac({ p50: 375000, p80: 375000 + 1 }))).toBe('目安：375,000人（50%）〜 375,001人（80%）');
  });

  test('shows one number when p50 equals p80', () => {
    expect(guideText(facilityById(facilities, 'grocery'))).toBe('目安：500人');
  });
});

describe('evaluateFacilities', () => {
  test('lists all 48 rows, the 8 essential ones first, the other 40 after, in data order', () => {
    const ev = evaluateFacilities(10_000, facilities);
    expect(ev.total).toBe(48);
    expect(ev.essential).toHaveLength(8);
    expect(ev.others).toHaveLength(40);
    expect(ev.essential.every((r) => r.essential)).toBe(true);
    expect(ev.others.every((r) => !r.essential)).toBe(true);
    expect(ev.essential.map((r) => r.id)).toEqual(facilities.filter((f) => f.essential).map((f) => f.id));
    expect(ev.others.map((r) => r.id)).toEqual(facilities.filter((f) => !f.essential).map((f) => f.id));
    expect(new Set([...ev.essential, ...ev.others].map((r) => r.id)).size).toBe(48);
  });

  test('rows carry the name as printed in the data and are found by id', () => {
    const ev = evaluateFacilities(10_000, facilities);
    const grocery = ev.essential.find((r) => r.id === 'grocery')!;
    expect(grocery.name).toBe(facilityById(facilities, 'grocery').name);
    expect(grocery.name).toBe('飲食料品小売業');
  });

  test('status follows facilityStatus on the unrounded population, including the boundaries', () => {
    const f = fac({ id: 'a', p50: 1500, p80: 2500 });
    const at = (pop: number) => evaluateFacilities(pop, [f]).others[0].status;
    expect(at(1499.9)).toBe('below');
    expect(at(1500)).toBe('edge');
    expect(at(2499.9)).toBe('edge');
    expect(at(2500)).toBe('ok');
  });

  test('a facility with p50 == p80 has no edge band', () => {
    const f = fac({ id: 'b', p50: 500, p80: 500, essential: true });
    const at = (pop: number) => evaluateFacilities(pop, [f]).essential[0].status;
    expect(at(499.99)).toBe('below');
    expect(at(500)).toBe('ok');
  });

  test('counts below, edge and ok that add up to the total', () => {
    const ev = evaluateFacilities(total(tanabeSeries[2050]), facilities);
    expect(ev.belowCount + ev.edgeCount + ev.okCount).toBe(48);
    const oracle = facilities.filter((f) => facilityStatus(total(tanabeSeries[2050]), f) === 'below').length;
    expect(ev.belowCount).toBe(oracle);
  });

  test('田辺市 in 2100 is below the guide for many facilities, and more than in 2020', () => {
    const p2020 = total(tanabe.base);
    const p2100 = total(tanabeSeries[2100]);
    expect(p2100).toBeLessThan(p2020 / 3);
    const now = evaluateFacilities(p2020, facilities);
    const later = evaluateFacilities(p2100, facilities);
    expect(later.belowCount).toBeGreaterThan(now.belowCount);
    expect(later.belowCount).toBe(29); // 11,880 people: 全48種類のうち29種類が目安を下回ります
    expect(summaryLine(later.belowCount, later.total)).toBe('全48種類のうち29種類が目安を下回ります');
    expect(later.essential.some((r) => r.status === 'edge')).toBe(true); // 一般病院 and 訪問介護事業 are between the two thresholds
  });

  test('千代田区 and 札幌市中央区 today are above the guide for almost everything', () => {
    for (const a of [chiyoda, sapporoChuo]) {
      const ev = evaluateFacilities(total(a.base), facilities);
      expect(ev.essential.every((r) => r.status === 'ok')).toBe(true);
      expect(ev.belowCount).toBeLessThan(20);
    }
  });
});

describe('summaryLine', () => {
  test('says how many of the 48 are below the guide', () => {
    expect(summaryLine(29, 48)).toBe('全48種類のうち29種類が目安を下回ります');
    expect(summaryLine(1, 48)).toBe('全48種類のうち1種類が目安を下回ります');
  });

  test('comes in two phrases that join to the sentence', () => {
    expect(summaryParts(29, 48)).toEqual(['全48種類のうち', '29種類が目安を下回ります']);
    expect(summaryParts(0, 48).join('')).toBe(summaryLine(0, 48));
  });

  test('says so plainly when none is below', () => {
    expect(summaryLine(0, 48)).toBe('全48種類のうち、目安を下回るものはありません');
  });
});

describe('facilityNotes', () => {
  test('the metro note applies to the eleven metropolitan prefectures only', () => {
    expect(facilityNotes({ prefCode: chiyoda.prefCode, infraStrength: 0 }).metro).toBe(true);
    expect(facilityNotes({ prefCode: tanabe.prefCode, infraStrength: 0 }).metro).toBe(false);
    expect(facilityNotes({ prefCode: sapporoChuo.prefCode, infraStrength: 0 }).metro).toBe(false);
  });

  test('the infrastructure note applies only when infraStrength is above 0', () => {
    expect(facilityNotes({ prefCode: '30', infraStrength: 0 }).infra).toBe(false);
    expect(facilityNotes({ prefCode: '30', infraStrength: 0.005 }).infra).toBe(true);
  });
});

describe('fixed sentences', () => {
  test('are the agreed wording', () => {
    expect(PERMANENT_NOTE).toBe('国土交通省の表（2009〜2012年の統計、三大都市圏を除く）にもとづく人口の目安です。施設の閉鎖を予測するものではありません。');
    expect(GUIDE_LEAD).toBe('人口の目安は、その施設がある自治体の割合が50%、80%になる人口規模です。');
    expect(METRO_NOTE).toBe('この町は三大都市圏にあるため、表の対象外です。参考として表示します。');
    expect(INFRA_NOTE).toBe('インフラ連動の過疎の加速（仮定）が有効です。施設が目安を下回ると転出が増える前提で計算しています。');
  });
});
