// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeRealContext, realAppData } from '../../test/helpers/realPanelContext';
import type { FacilityFlip } from '../engine/allocation';
import type { Area, Facility } from '../engine/types';
import {
  allocationErrorMessage,
  AllocationFormError,
  approxPeople,
  buildAllocationInput,
  computeAllocation,
  describeAllocation,
  mountAllocation,
  signedCount,
  summarizeAllocation,
  type AllocationForm,
  VISIBLE_ROW_CAP,
} from './allocationPanel';

const FORBIDDEN = ['予測', '残せない', '閉鎖', 'すべき', 'おすすめ', 'お勧め', '→', '▲', '▼'];

const form = (patch: Partial<AllocationForm> = {}): AllocationForm => ({
  target: { kind: 'pref', code: '30' },
  percent: 10,
  sourceMode: 'proportional',
  regionIds: ['kanto'],
  ...patch,
});

describe('buildAllocationInput', () => {
  test('turns a percent of the target group into people', () => {
    expect(buildAllocationInput(form(), 262_000)).toEqual({
      target: { kind: 'pref', code: '30' },
      deltaPeople: 26_200,
      source: { mode: 'proportional' },
    });
    expect(buildAllocationInput(form({ percent: -30 }), 1000).deltaPeople).toBeCloseTo(-300, 9);
    expect(buildAllocationInput(form({ percent: 0 }), 1000).deltaPeople).toBe(0);
  });

  test('regions mode lists the prefectures of the chosen regions', () => {
    const input = buildAllocationInput(form({ sourceMode: 'regions', regionIds: ['shikoku', 'hokkaido'] }), 1000);
    expect(input.source).toEqual({ mode: 'regions', prefCodes: ['01', '36', '37', '38', '39'] });
  });

  test('an area target passes through', () => {
    expect(buildAllocationInput(form({ target: { kind: 'area', code: '30206' } }), 1000).target).toEqual({ kind: 'area', code: '30206' });
  });

  test('regions mode with no region, or a percent that is not a number, is a form error with a Japanese message', () => {
    const noRegion = () => buildAllocationInput(form({ sourceMode: 'regions', regionIds: [] }), 1000);
    expect(noRegion).toThrow(AllocationFormError);
    expect(allocationErrorMessage(catchError(noRegion))).toBe('人口を動かす元の地域を、1つ以上選んでください。');
    const nan = () => buildAllocationInput(form({ percent: Number.NaN }), 1000);
    expect(nan).toThrow(AllocationFormError);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected a throw');
}

describe('allocationErrorMessage', () => {
  test('engine RangeErrors become plain Japanese', () => {
    expect(allocationErrorMessage(new RangeError("allocate: delta -5 takes more than the target group's population 3"))).toBe(
      'そこまで減らせる人口がありません。',
    );
    expect(allocationErrorMessage(new RangeError("allocate: delta 5 is larger than the source group's population 3"))).toBe(
      '人口を動かす元の地域に、それだけの人口がありません。',
    );
    expect(allocationErrorMessage(new RangeError('allocate: no area is left to give or take people (source group is empty)'))).toBe(
      '人口を動かす元になる地域がありません。',
    );
    expect(allocationErrorMessage(new RangeError('allocate: no area matches target pref 99'))).toBe('選んだ地域が見つかりません。');
  });

  test('anything else gets a generic message and never leaks English', () => {
    expect(allocationErrorMessage(new RangeError('allocate: something new'))).toBe('この条件では計算できませんでした。');
    expect(allocationErrorMessage(new TypeError('x is undefined'))).toBe('この条件では計算できませんでした。');
    expect(allocationErrorMessage('boom')).toBe('この条件では計算できませんでした。');
  });
});

describe('number helpers', () => {
  test('signedCount uses the true minus and ±0', () => {
    expect(signedCount(3)).toBe('+3');
    expect(signedCount(-12)).toBe('−12');
    expect(signedCount(0)).toBe('±0');
    expect(signedCount(1234)).toBe('+1,234');
  });
  test('approxPeople is 約 plus the usual population format, always positive', () => {
    expect(approxPeople(26_198.7)).toBe('約2.6万人');
    expect(approxPeople(-26_198.7)).toBe('約2.6万人');
    expect(approxPeople(8_340)).toBe('約8,340人');
    expect(approxPeople(12_000_000)).toBe('約1,200万人');
  });
});

describe('describeAllocation', () => {
  const base = { year: 2100, targetName: '和歌山県', percent: 10, people: 26_198.7, sourceNames: undefined };
  test('increase from the rest of the country', () => {
    expect(describeAllocation(base)).toBe('2100年に和歌山県の人口を10%（約2.6万人）増やすと、全国の合計は変わらず、ほかの地域が合わせて約2.6万人減ります。');
  });
  test('decrease', () => {
    expect(describeAllocation({ ...base, percent: -20, people: -52_397.4 })).toBe(
      '2100年に和歌山県の人口を20%（約5.2万人）減らすと、全国の合計は変わらず、ほかの地域が合わせて約5.2万人増えます。',
    );
  });
  test('from chosen regions', () => {
    expect(describeAllocation({ ...base, sourceNames: ['関東', '近畿'] })).toBe(
      '2100年に和歌山県の人口を10%（約2.6万人）増やすと、全国の合計は変わらず、選んだ地域（関東・近畿）が合わせて約2.6万人減ります。',
    );
  });
  test('zero', () => {
    expect(describeAllocation({ ...base, percent: 0, people: 0 })).toBe('割合が0%なので、2100年の和歌山県の人口は動きません。');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// summarizeAllocation on hand-made data: ordering, the cap, examples, ambiguous names.
// ---------------------------------------------------------------------------------------------------------------
function fac(id: string, essential: boolean, p50 = 500): Facility {
  return { id, name: `施設${id}`, p50, p80: p50 * 2, essential, excludesMetro: true, source: 'test' };
}
function area(code: string, name: string, prefCode: string, prefName: string): Area {
  return { code, name, prefCode, prefName, kind: 'city', base: { M: [], F: [] }, official: {}, assumptions: null };
}
function flip(id: string, gained: string[], lost: string[], before = 100): FacilityFlip {
  return { facilityId: id, before, after: before + gained.length - lost.length, gained, lost };
}

describe('summarizeAllocation', () => {
  const areas = [
    area('01101', '中央区', '01', '北海道'),
    area('13102', '中央区', '13', '東京都'),
    area('30344', '高野町', '30', '和歌山県'),
    area('30341', '串本町', '30', '和歌山県'),
    area('30342', '那智勝浦町', '30', '和歌山県'),
    area('30343', '太地町', '30', '和歌山県'),
    area('30345', '古座川町', '30', '和歌山県'),
  ];
  const pop = new Map(areas.map((a, i) => [a.code, 400 + i * 20]));
  const data = (facilities: Facility[]) => ({ areas, facilities });
  const result = (flips: FacilityFlip[]) => ({ total: 0, pop, flips });

  test('unchanged facilities are left out; essential ones come first, each group by the number of towns that crossed', () => {
    const facilities = [fac('a', false), fac('b', true), fac('c', false), fac('d', true), fac('e', false)];
    const s = summarizeAllocation(
      result([
        flip('a', ['30344'], []), // 1 town
        flip('b', ['30344'], ['30341']), // 2 towns
        flip('c', [], []), // unchanged
        flip('d', ['30344', '30341', '30342'], []), // 3 towns
        flip('e', ['30344'], ['30341', '30342']), // 3 towns
      ]),
      data(facilities),
      2100,
    );
    expect(s.rows.map((r) => r.facilityId)).toEqual(['d', 'b', 'e', 'a']);
    expect(s.rows.map((r) => r.essential)).toEqual([true, true, false, false]);
    expect(s.nothingFlips).toBe(false);
    expect(s.year).toBe(2100);
  });

  test('before, after and the signed difference come from the engine row', () => {
    const [row] = summarizeAllocation(result([flip('a', ['30344', '30341'], ['30342'], 1627)]), data([fac('a', true)]), 2100).rows;
    expect([row.before, row.after, row.diff]).toEqual([1627, 1628, 1]);
    expect([row.gained.count, row.lost.count]).toEqual([2, 1]);
    expect(row.name).toBe('施設a');
  });

  test('a row where as many towns gain as lose is still a change', () => {
    const s = summarizeAllocation(result([flip('a', ['30344'], ['30341'])]), data([fac('a', false)]), 2100);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].diff).toBe(0);
  });

  test('at most 3 examples, the towns closest to the line first; the count still says how many', () => {
    // population after the move (see `pop`): 01101=400, 13102=420, 30344=440, 30341=460, 30342=480, 30343=500, 30345=520
    const gained = ['30345', '30343', '30341', '30342']; // all at or above a guide of 450
    const [row] = summarizeAllocation(result([flip('a', gained, [])]), data([fac('a', false, 450)]), 2100).rows;
    expect(row.gained.count).toBe(4);
    expect(row.gained.examples).toEqual(['串本町', '那智勝浦町', '太地町']); // 460, 480, 500
    const lost = ['30344', '30341', '30342', '01101', '13102']; // all below a guide of 500
    const [low] = summarizeAllocation(result([flip('a', [], lost)]), data([fac('a', false, 500)]), 2100).rows;
    expect(low.lost.count).toBe(5);
    expect(low.lost.examples).toEqual(['那智勝浦町', '串本町', '高野町']); // 480, 460, 440
  });

  test('a name shared by two areas carries its prefecture, others do not', () => {
    const [row] = summarizeAllocation(result([flip('a', ['01101', '13102', '30344'], [])]), data([fac('a', false, 1)]), 2100).rows;
    expect(row.gained.examples.sort()).toEqual(['中央区（北海道）', '中央区（東京都）', '高野町'].sort());
  });

  test('the visible list is capped at 10 rows and the rest are listed apart', () => {
    const facilities = [fac('e1', true), fac('e2', true), ...Array.from({ length: 12 }, (_, i) => fac(`o${i}`, false))];
    const flips = facilities.map((f) => flip(f.id, ['30344'], []));
    const s = summarizeAllocation(result(flips), data(facilities), 2100);
    expect(VISIBLE_ROW_CAP).toBe(10);
    expect(s.rows).toHaveLength(14);
    expect(s.visible).toHaveLength(10);
    expect(s.hidden).toHaveLength(4);
    expect(s.visible.slice(0, 2).map((r) => r.essential)).toEqual([true, true]);
    expect([...s.visible, ...s.hidden]).toEqual(s.rows);
  });

  test('essential rows are never hidden, even when there are more than the cap', () => {
    const facilities = [...Array.from({ length: 12 }, (_, i) => fac(`e${i}`, true)), fac('o', false)];
    const s = summarizeAllocation(result(facilities.map((f) => flip(f.id, ['30344'], []))), data(facilities), 2100);
    expect(s.visible).toHaveLength(12);
    expect(s.hidden.map((r) => r.facilityId)).toEqual(['o']);
  });

  test('nothing crossing is reported as such', () => {
    const s = summarizeAllocation(result([flip('a', [], [])]), data([fac('a', true)]), 2100);
    expect(s.rows).toEqual([]);
    expect(s.nothingFlips).toBe(true);
  });

  test('facilities are looked up by id, not by position or name', () => {
    const s = summarizeAllocation(result([flip('b', ['30344'], [])]), data([fac('a', false), fac('b', true)]), 2100);
    expect(s.rows[0]).toMatchObject({ facilityId: 'b', name: '施設b', essential: true });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The whole computation on the real data.
// ---------------------------------------------------------------------------------------------------------------
describe('computeAllocation with the real data', () => {
  test('Wakayama +10% in 2100, proportional: 高野町 gains every facility whose guide is 500 people; essential rows come first', () => {
    const ctx = makeRealContext();
    const { input, result, summary } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form());
    expect(input.deltaPeople).toBeGreaterThan(26_000);
    expect(input.deltaPeople).toBeLessThan(26_400);
    expect(result.total).toBeCloseTo([...result.pop.values()].reduce((a, b) => a + b, 0), 3);
    expect(summary.nothingFlips).toBe(false);

    const guide500 = summary.rows.filter((r) => ctx.data.facilities.find((f) => f.id === r.facilityId)!.p50 === 500 && r.gained.count > 0);
    expect(guide500.length).toBeGreaterThanOrEqual(5);
    for (const r of guide500) expect(r.gained.examples).toContain('高野町');

    // essential changed rows form a prefix of the list, and every essential facility that changed is in it
    const essentialIds = ctx.data.facilities.filter((f) => f.essential).map((f) => f.id);
    const changedEssential = result.flips.filter((f) => essentialIds.includes(f.facilityId) && f.gained.length + f.lost.length > 0).map((f) => f.facilityId);
    expect(changedEssential.length).toBeGreaterThan(0);
    const firstOther = summary.rows.findIndex((r) => !r.essential);
    expect(summary.rows.slice(0, firstOther).map((r) => r.facilityId).sort()).toEqual([...changedEssential].sort());
    expect(summary.rows.slice(firstOther).every((r) => !r.essential)).toBe(true);
  });

  test('regions mode with Kanto as the source: only Kanto and the target change', () => {
    const ctx = makeRealContext();
    const popBefore = computeAllocation(ctx.data, ctx.store.get().series, 2100, form({ percent: 0 })).result.pop;
    const { result } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form({ sourceMode: 'regions', regionIds: ['kanto'] }));
    const prefOf = new Map(ctx.data.areas.map((a) => [a.code, a.prefCode]));
    const kanto = new Set(['08', '09', '10', '11', '12', '13', '14']);
    let changedOutside = 0;
    let shrunkInKanto = 0;
    for (const [code, p] of result.pop) {
      const was = popBefore.get(code)!;
      const pp = prefOf.get(code)!;
      if (pp === '30') expect(p).toBeGreaterThan(was);
      else if (kanto.has(pp)) {
        if (p < was) shrunkInKanto++;
      } else if (p !== was) changedOutside++;
    }
    expect(changedOutside).toBe(0);
    expect(shrunkInKanto).toBeGreaterThan(100);
  });

  test('moving more people than the chosen source holds is an engine RangeError that has a Japanese message', () => {
    const ctx = makeRealContext();
    const bad = form({ target: { kind: 'pref', code: '13' }, percent: 50, sourceMode: 'regions', regionIds: ['shikoku'] });
    const e = catchError(() => computeAllocation(ctx.data, ctx.store.get().series, 2100, bad));
    expect(e).toBeInstanceOf(RangeError);
    expect(allocationErrorMessage(e)).toBe('人口を動かす元の地域に、それだけの人口がありません。');
  });

  test('uses all 1,884 areas (Ruling 20)', () => {
    const ctx = makeRealContext();
    const { result } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form());
    expect(result.pop.size).toBe(1884);
    expect(realAppData().areas).toHaveLength(1884);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The mounted panel.
// ---------------------------------------------------------------------------------------------------------------
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function mount(initial = {}) {
  const ctx = makeRealContext(initial);
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = 'panel-allocation';
  el.innerHTML = '<h2 class="panel-title" id="panel-allocation-title">人口の割り振り</h2><p class="panel-empty">placeholder</p>';
  document.body.append(el);
  mountAllocation(el, ctx);
  const q = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
  const text = (sel: string) => q(sel).textContent!;
  const choose = (select: HTMLSelectElement, value: string) => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const slide = async (value: number) => {
    const input = q<HTMLInputElement>('#alloc-percent');
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await raf();
  };
  const rows = () => [...el.querySelectorAll('#alloc-result table.alloc-table-visible tbody tr:not(.alloc-group)')].map((tr) => ({
    name: tr.querySelector('.alloc-name')!.textContent!,
    cells: [...tr.querySelectorAll('td.num')].map((td) => td.textContent!),
    text: tr.textContent!,
  }));
  return { ctx, el, q, text, choose, slide, rows, store: ctx.store };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountAllocation', () => {
  test('keeps the heading, replaces the placeholder, flags the year as an estimate', () => {
    const { el, q } = mount();
    expect(el.querySelectorAll('.panel-title')).toHaveLength(1);
    expect(el.querySelector('.panel-empty')).toBeNull();
    expect(q('.panel-lead').textContent).toBe('全国の人口は変えずに、ある県や町の人口を増やすと、ほかの地域がどうなるかを見ます。');
    expect(q('.panel-title .badge-estimate').textContent).toBe('試算');
    expect(q('#alloc-year').textContent).toContain('2100年の人口で計算');
  });

  test('defaults: Wakayama, +10%, from the rest of the country; the 47 prefectures are the choices', () => {
    const { q } = mount();
    const select = q<HTMLSelectElement>('#alloc-target');
    expect(select.value).toBe('pref:30');
    expect([...select.options].filter((o) => o.value.startsWith('pref:'))).toHaveLength(47);
    expect(select.querySelector('option[value="pref:30"]')!.textContent).toBe('和歌山県');
    expect(q<HTMLInputElement>('#alloc-percent').value).toBe('10');
    expect(q('#alloc-percent').getAttribute('min')).toBe('-30');
    expect(q('#alloc-percent').getAttribute('max')).toBe('50');
    expect(q('#alloc-percent-value').textContent).toBe('+10%（約2.6万人）');
    expect(q('[data-source="proportional"]').getAttribute('aria-pressed')).toBe('true');
    expect(q<HTMLElement>('#alloc-regions').hidden).toBe(true);
  });

  test('the default target follows the store: a selected prefecture, and a selected town as an extra choice', () => {
    const a = mount({ selectedPref: '13' });
    expect(a.q<HTMLSelectElement>('#alloc-target').value).toBe('pref:13');
    document.body.replaceChildren();
    const b = mount({ selectedArea: '30206' });
    const select = b.q<HTMLSelectElement>('#alloc-target');
    expect(select.value).toBe('pref:30');
    const townOption = select.querySelector<HTMLOptionElement>('option[value="area:30206"]')!;
    expect(townOption.textContent).toBe('選んだ町：田辺市');
    b.choose(select, 'area:30206');
    expect(b.q('#alloc-summary').textContent).toContain('2100年に田辺市の人口を10%');
  });

  test('Wakayama +10% in 2100 reads as one sentence and lists the facilities whose line it crosses', () => {
    const { ctx, q, text, rows } = mount();
    expect(text('#alloc-summary')).toBe('2100年に和歌山県の人口を10%（約2.6万人）増やすと、全国の合計は変わらず、ほかの地域が合わせて約2.6万人減ります。');
    expect(text('#alloc-result .panel-section-title')).toBe('施設の人口の目安をまたぐ町の数');
    const r = rows();
    expect(r.length).toBeGreaterThan(5);
    // the essential group comes first and carries its own heading
    const headings = [...q('#alloc-result').querySelectorAll('tr.alloc-group')].map((h) => h.textContent);
    expect(headings[0]).toBe('くらしの基本の施設');
    expect(r[0].text).toContain('人口の目安以上になる町');
    expect(r.some((x) => x.text.includes('高野町'))).toBe(true);
    // a row reads: name, before, after, signed difference
    const grocery = r.find((x) => x.name === '飲食料品小売業')!;
    expect(grocery.cells).toEqual(['1,627', '1,628', '+1']);
    // visible rows are capped at 10, the rest sit in a collapsed details
    const { summary } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form());
    expect(r).toHaveLength(Math.min(10, summary.rows.length));
    const more = q<HTMLDetailsElement>('details.alloc-more');
    expect(more.open).toBe(false);
    expect(more.querySelectorAll('tbody tr')).toHaveLength(summary.rows.length - 10);
    expect(more.querySelector('summary')!.textContent).toBe(`その他の施設を、さらに${summary.rows.length - 10}件見る`);
  });

  test('the permanent notes are always there, and no forbidden word is rendered', () => {
    const { el, text } = mount();
    const notes = text('.alloc-notes');
    expect(notes).toContain('人口の差は全国で見ると小さいので、人口の目安をまたぐ町の数で示しています。');
    expect(notes).toContain('三大都市圏の町は、表の対象外ですが、参考として数えています。');
    for (const w of FORBIDDEN) expect(el.textContent).not.toContain(w);
    // the wording the brief asks for
    expect(el.textContent).toContain('人口の目安以上');
  });

  test('moving the amount to a cut re-words the sentence and the label', async () => {
    const { text, slide, q } = mount();
    await slide(-30);
    expect(text('#alloc-percent-value')).toMatch(/^−30%（約7\.\d万人）$/);
    expect(text('#alloc-summary')).toMatch(/^2100年に和歌山県の人口を30%（約7\.\d万人）減らすと、全国の合計は変わらず、ほかの地域が合わせて約7\.\d万人増えます。$/);
    expect(q('#alloc-result').textContent).toContain('人口の目安を下回る町');
  });

  test('0% moves nobody and says so', async () => {
    const { text, slide, q } = mount();
    await slide(0);
    expect(text('#alloc-summary')).toBe('割合が0%なので、2100年の和歌山県の人口は動きません。');
    expect(text('#alloc-result')).toContain('この割り振りでは、人口の目安をまたぐ町はありませんでした。');
    expect(q('#alloc-result table')).toBeNull();
  });

  test('the slider year drives the calculation and the estimate badge', () => {
    const { store, text, q } = mount();
    store.set({ year: 2050 });
    expect(text('#alloc-summary')).toMatch(/^2050年に和歌山県の人口を10%/);
    expect(q('#alloc-year').textContent).toContain('2050年の人口で計算');
    expect(q('.panel-title .badge-estimate')).toBeNull();
    store.set({ year: 2085 });
    expect(q('.panel-title .badge-estimate')).not.toBeNull();
  });

  test('a new scenario recomputes from the new series', () => {
    const { store, text } = mount();
    const before = text('#alloc-summary');
    store.set({ scenario: { cwrMult: 1.4, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    expect(text('#alloc-summary')).not.toBe(before);
  });

  test('from chosen regions: the checkboxes appear, Kanto is ticked, and the sentence names the regions', () => {
    const { q, text } = mount();
    q<HTMLButtonElement>('[data-source="regions"]').click();
    expect(q<HTMLElement>('#alloc-regions').hidden).toBe(false);
    expect(q('[data-source="regions"]').getAttribute('aria-pressed')).toBe('true');
    const boxes = [...q('#alloc-regions').querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((b) => b.closest('label')!.textContent)).toEqual(['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄']);
    expect(boxes.filter((b) => b.checked).map((b) => b.dataset.region)).toEqual(['kanto']);
    expect(text('#alloc-summary')).toContain('選んだ地域（関東）が合わせて約2.6万人減ります');
    const kinki = boxes.find((b) => b.dataset.region === 'kinki')!;
    kinki.checked = true;
    kinki.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text('#alloc-summary')).toContain('選んだ地域（関東・近畿）');
  });

  test('regions mode with nothing ticked asks for a region instead of calculating', () => {
    const { q } = mount();
    q<HTMLButtonElement>('[data-source="regions"]').click();
    const kanto = q<HTMLInputElement>('input[data-region="kanto"]');
    kanto.checked = false;
    kanto.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q<HTMLElement>('#alloc-error').hidden).toBe(false);
    expect(q('#alloc-error').textContent).toBe('人口を動かす元の地域を、1つ以上選んでください。');
    expect(q('#alloc-result table')).toBeNull();
    expect(q('#alloc-summary').textContent).toBe('');
  });

  test('a calculation the engine refuses shows its Japanese message and no stale table', () => {
    const { q, choose } = mount();
    choose(q<HTMLSelectElement>('#alloc-target'), 'pref:13');
    q<HTMLButtonElement>('[data-source="regions"]').click();
    const kanto = q<HTMLInputElement>('input[data-region="kanto"]');
    kanto.checked = false;
    kanto.dispatchEvent(new Event('change', { bubbles: true }));
    const shikoku = q<HTMLInputElement>('input[data-region="shikoku"]');
    shikoku.checked = true;
    shikoku.dispatchEvent(new Event('change', { bubbles: true }));
    const input = q<HTMLInputElement>('#alloc-percent');
    input.value = '50';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return raf().then(() => {
      expect(q<HTMLElement>('#alloc-error').hidden).toBe(false);
      expect(q('#alloc-error').textContent).toBe('人口を動かす元の地域に、それだけの人口がありません。');
      expect(q('#alloc-result table')).toBeNull();
      // and it recovers
      shikoku.checked = false;
      shikoku.dispatchEvent(new Event('change', { bubbles: true }));
      kanto.checked = true;
      kanto.dispatchEvent(new Event('change', { bubbles: true }));
      return raf().then(() => {
        expect(q<HTMLElement>('#alloc-error').hidden).toBe(true);
      });
    });
  });

  test('the panel never writes to the store', async () => {
    const { store, slide, choose, q } = mount();
    const spy = vi.spyOn(store, 'set');
    await slide(25);
    choose(q<HTMLSelectElement>('#alloc-target'), 'pref:01');
    q<HTMLButtonElement>('[data-source="regions"]').click();
    expect(spy).not.toHaveBeenCalled();
  });

  test('following the map: moving to another prefecture retargets, and a town can be picked from the list', () => {
    const { store, q } = mount();
    store.set({ selectedPref: '13' });
    expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:13');
    store.set({ selectedArea: '13101' });
    const select = q<HTMLSelectElement>('#alloc-target');
    expect(select.value).toBe('pref:13'); // the choice stays; the town is offered
    expect(select.querySelector('option[value="area:13101"]')!.textContent).toMatch(/^選んだ町：/);
    store.set({ selectedPref: undefined });
    expect(select.querySelector('option[value^="area:"]')).toBeNull();
  });

  test('keyboard and labels: every control has a visible label, real buttons, a spoken slider value', () => {
    const { el, q } = mount();
    expect(el.querySelector('label[for="alloc-target"]')).not.toBeNull();
    expect(el.querySelector('label[for="alloc-percent"]')).not.toBeNull();
    expect(q('#alloc-percent').getAttribute('aria-valuetext')).toBe('プラス10%、約2.6万人');
    q<HTMLButtonElement>('[data-source="regions"]').click();
    expect(q('#alloc-regions').tagName).toBe('FIELDSET');
    expect(q('#alloc-regions legend')).not.toBeNull();
    for (const b of el.querySelectorAll('button')) expect(b.type).toBe('button');
    const ids = [...el.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the number of towns shown for a facility matches the engine', () => {
    const { ctx, rows } = mount();
    const { result } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form());
    const grocery = result.flips.find((f) => f.facilityId === 'grocery')!;
    const row = rows().find((x) => x.name === '飲食料品小売業')!;
    expect(row.cells).toEqual([grocery.before.toLocaleString('ja-JP'), grocery.after.toLocaleString('ja-JP'), signedCount(grocery.after - grocery.before)]);
  });
});
