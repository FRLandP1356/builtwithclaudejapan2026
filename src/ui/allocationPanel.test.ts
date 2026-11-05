// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { repoPath } from '../../test/helpers/paths';
import { makeRealContext, realAppData } from '../../test/helpers/realPanelContext';
import type { FacilityFlip } from '../engine/allocation';
import { crossingCounts } from './allocationView';
import { deriveTotals, yearIndex } from './derive';
import type { Listener, Store } from './state';
import type { Area, Facility } from '../engine/types';
import {
  allocationErrorMessage,
  AllocationFormError,
  announceAllocation,
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

/** A store wrapper that tracks which subscribers are still attached. */
function tracked(store: Store, active: Set<Listener>): Store {
  return {
    ...store,
    subscribe(fn) {
      active.add(fn);
      const off = store.subscribe(fn);
      return () => {
        active.delete(fn);
        off();
      };
    },
  };
}

function mount(initial = {}, wrap?: (store: Store) => Store) {
  const base = makeRealContext(initial);
  const ctx = wrap ? { ...base, store: wrap(base.store) } : base;
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = 'panel-allocation';
  el.innerHTML = '<h2 class="panel-title" id="panel-allocation-title">人口の割り振り</h2><p class="panel-empty">placeholder</p>';
  document.body.append(el);
  const teardown = mountAllocation(el, ctx);
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
  return { ctx: base, el, q, text, choose, slide, rows, store: base.store, teardown };
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
    expect(q('#alloc-percent').getAttribute('step')).toBe('5');
    expect(q('#alloc-error').getAttribute('role')).toBe('alert');
    // The visible summary follows the year, so it is not a live region; the announcement next to it is.
    expect(q('#alloc-summary').getAttribute('role')).toBeNull();
    expect(q('#alloc-summary').closest('[role="status"], [role="alert"], [aria-live]')).toBeNull();
    expect(q('#alloc-announce').getAttribute('role')).toBe('status');
    expect(q('#alloc-announce').classList.contains('sr-only')).toBe(true);
    expect(q('#alloc-announce').textContent).toBe(''); // nothing is announced for the first drawing
    // It must be speakable: a hidden or aria-hidden element (or one inside such) is never read, and a live region that
    // is display:none is dropped by screen readers. Hiding is done with the clip pattern of .sr-only instead.
    const announce = q<HTMLElement>('#alloc-announce');
    expect(announce.closest('[hidden], [aria-hidden="true"], [inert]')).toBeNull();
    expect(announce.hasAttribute('hidden')).toBe(false);
    expect(announce.getAttribute('style') ?? '').not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(['polite', null]).toContain(announce.getAttribute('aria-live')); // role=status is polite already
    const srOnly = /\.sr-only\s*\{([^}]*)\}/.exec(readFileSync(repoPath('src/ui/theme.css'), 'utf8'))?.[1] ?? '';
    expect(srOnly).toContain('position: absolute');
    expect(srOnly).toContain('clip: rect(0 0 0 0)');
    expect(srOnly).not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
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
    expect(r[0].text).toContain('人口の目安を下回らなくなる町');
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
    expect(notes).toContain('国土交通省の目安は三大都市圏を除く統計ですが、ここでは三大都市圏の町も同じ目安で数えています。');
    expect(notes).not.toContain('表の対象外');
    for (const w of FORBIDDEN) expect(el.textContent).not.toContain(w);
    // the wording the brief asks for: the map's words (a town that is no longer below the guide), never 「目安以上」
    expect(el.textContent).toContain('人口の目安を下回らなくなる');
    expect(el.textContent).not.toContain('目安以上');
  });

  test('the words for a town crossing are the map\'s words (crossingCounts), in the table, its headings and its notes', async () => {
    const { el, q, slide, text } = mount();
    // the same two phrases the map's tooltip and markers use
    const gained = (crossingCounts({ gained: 1, lost: 0 }) ?? '').replace(/ \+1$/, '');
    const lost = (crossingCounts({ gained: 0, lost: 2 }) ?? '').replace(/ −2$/, '');
    expect(gained).toBe('人口の目安を下回らなくなる町');
    expect(lost).toBe('人口の目安を下回る町');
    expect(el.querySelector('.alloc-example')!.textContent).toContain(gained);
    await slide(-30);
    expect([...el.querySelectorAll('.alloc-example')].some((line) => line.textContent!.startsWith(lost))).toBe(true);
    // the column headings say what the counts are, in those words
    const spoken = [...el.querySelectorAll('#alloc-result table.alloc-table-visible thead th .sr-only')].map((n) => n.textContent);
    expect(spoken).toEqual(['割り振る前の、人口の目安を下回らない町の数', '割り振った後の、人口の目安を下回らない町の数', '町の数の増減']);
    expect(text('#alloc-detail .panel-section-title + .note')).toBe(
      '各施設について、人口の目安を下回らない町の数を、割り振る前と後で並べています。施設名を押すと、またいだ町を地図に示します。',
    );
    expect(text('.alloc-notes')).toContain(
      '「人口の目安」は、国土交通省の統計で、その施設がある確率が50%になる人口の大きさです。町の人口がその大きさより少ないことを「人口の目安を下回る」、割り振りでその大きさ以上になることを「人口の目安を下回らなくなる」と書いています。',
    );
    // the heading and the pressed-name label keep the words the rest of the app uses for a crossing
    expect(text('#alloc-result .panel-section-title')).toBe('施設の人口の目安をまたぐ町の数');
    expect(q('.alloc-name').getAttribute('aria-label')).toMatch(/。目安をまたいだ町を地図に示す$/);
    expect(el.textContent).not.toContain('目安以上');
    expect(el.textContent).not.toContain('人口の目安以上');
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

  test('the slider year changes the numbers, not only the label: 2060 is computed from the 2060 population', () => {
    const { ctx, store, text, rows } = mount();
    store.set({ year: 2060 });
    const series = store.get().series;
    const at2060 = computeAllocation(ctx.data, series, 2060, form());
    const at2100 = computeAllocation(ctx.data, series, 2100, form());
    expect(Math.abs(at2060.input.deltaPeople - at2100.input.deltaPeople)).toBeGreaterThan(10_000); // the two years really differ
    expect(text('#alloc-summary')).toBe(
      describeAllocation({ year: 2060, targetName: '和歌山県', percent: 10, people: at2060.input.deltaPeople, sourceNames: undefined }),
    );
    expect(text('#alloc-summary')).toContain('約5.4万人');
    expect(text('#alloc-percent-value')).toBe('+10%（約5.4万人）');
    // and the table is the 2060 table
    const shown = rows().map((r) => ({ name: r.name, cells: r.cells }));
    const expected = at2060.summary.visible.map((r) => ({
      name: r.name,
      cells: [r.before.toLocaleString('ja-JP'), r.after.toLocaleString('ja-JP'), signedCount(r.diff)],
    }));
    expect(shown).toEqual(expected);
    // back to 2100: the 2100 numbers return
    store.set({ year: 2100 });
    expect(text('#alloc-summary')).toContain('約2.6万人');
  });

  test('a town target moves a share of that town, not of its prefecture', async () => {
    const { ctx, choose, slide, text, q } = mount({ selectedArea: '30206' });
    choose(q<HTMLSelectElement>('#alloc-target'), 'area:30206');
    await slide(20);
    const totals = deriveTotals(ctx.store.get().series, ctx.data.groups);
    const i = yearIndex(totals.years, 2100);
    const tanabe = totals.area.get('30206')![i];
    expect(tanabe * 0.2).toBeLessThan(totals.pref.get('30')![i] * 0.2 / 10); // the town is far smaller than 20% of Wakayama
    expect(text('#alloc-percent-value')).toBe(`+20%（${approxPeople(tanabe * 0.2)}）`);
    expect(text('#alloc-percent-value')).toBe('+20%（約2,376人）');
    expect(text('#alloc-summary')).toBe(
      describeAllocation({ year: 2100, targetName: '田辺市', percent: 20, people: tanabe * 0.2, sourceNames: undefined }),
    );
    expect(text('#alloc-summary')).toMatch(/^2100年に田辺市の人口を20%（約2,376人）増やすと/);
    expect(q('#alloc-percent').getAttribute('aria-valuetext')).toBe('プラス20%、約2,376人');
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

  test('the summary and the error are rewritten only when their text changes', () => {
    const { q, store } = mount();
    const watch = (obs: MutationObserver, id: string) =>
      obs.observe(q(id), { childList: true, characterData: true, subtree: true, attributes: true });
    const obs = new MutationObserver(() => {});
    watch(obs, '#alloc-summary');
    watch(obs, '#alloc-error');
    store.set({ selectedArea: '30206' }); // the town is offered, the target stays Wakayama: the same sentence
    expect(obs.takeRecords()).toHaveLength(0);
    store.set({ selectedPref: '13' }); // retargets: the sentence changes
    expect(obs.takeRecords().length).toBeGreaterThan(0);
    // an error that stays the same is not announced again
    q<HTMLButtonElement>('[data-source="regions"]').click();
    const kanto = q<HTMLInputElement>('input[data-region="kanto"]');
    kanto.checked = false;
    kanto.dispatchEvent(new Event('change', { bubbles: true }));
    expect(q<HTMLElement>('#alloc-error').hidden).toBe(false);
    obs.takeRecords();
    store.set({ year: 2050 });
    store.set({ selectedPref: '30' });
    expect(obs.takeRecords()).toHaveLength(0);
    obs.disconnect();
  });

  describe('the live region speaks about the visitor\'s changes only', () => {
    const YEARS = Array.from({ length: 17 }, (_, i) => 2020 + i * 5);
    const liveRegions = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[role="status"], [role="alert"], [aria-live]')];
    /** Records every write to a live region; `drain()` returns what was written since the last call (also across an await). */
    function watchLive(el: HTMLElement, only?: Element) {
      const delivered: MutationRecord[] = [];
      const obs = new MutationObserver((records) => delivered.push(...records));
      for (const node of only ? [only] : liveRegions(el)) obs.observe(node, { childList: true, characterData: true, subtree: true, attributes: true });
      return {
        drain: (): MutationRecord[] => {
          delivered.push(...obs.takeRecords());
          return delivered.splice(0);
        },
        stop: () => obs.disconnect(),
      };
    }

    test('a sweep of year steps writes to no live region, though the visible summary follows the year', () => {
      const { el, store, text } = mount();
      const live = liveRegions(el);
      expect(live.length).toBeGreaterThan(0);
      expect(live).toContain(el.querySelector('#alloc-announce'));
      const obs = watchLive(el);
      const seen: string[] = [];
      for (const year of YEARS) {
        store.set({ year });
        seen.push(text('#alloc-summary'));
      }
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
      // the visible text did change at every step
      expect(new Set(seen).size).toBe(17);
      expect(seen[0]).toMatch(/^2020年に和歌山県/);
      expect(seen[16]).toMatch(/^2100年に和歌山県/);
    });

    test('a play tick (the year advancing by one step, many times) is silent too', () => {
      const { el, store } = mount({ year: 2050 });
      const obs = watchLive(el);
      for (let i = 0; i < 10; i++) store.set({ year: 2050 + ((i % 8) + 1) * 5 });
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
    });

    test('a change of assumptions or of the selection on the map is silent as well', () => {
      const { el, store, q } = mount();
      const obs = watchLive(el);
      store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
      store.set({ selectedPref: '13' }); // the map retargets the form
      store.set({ selectedArea: '13101' });
      expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:13'); // it did follow
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
    });

    test('each kind of form change writes exactly once, into the announcement, and says what the form asks', async () => {
      const { el, q, choose, slide } = mount();
      const announce = q('#alloc-announce');
      const obs = watchLive(el);
      const once = (expected: string) => {
        const records = obs.drain();
        expect(records).toHaveLength(1);
        expect(records[0]!.target === announce || announce.contains(records[0]!.target)).toBe(true);
        expect(announce.textContent).toBe(expected);
      };

      await slide(20);
      once('割り振りを更新しました。和歌山県の人口を20%増やす場合です。人口を動かす元は、全国のほかの地域です。');

      choose(q<HTMLSelectElement>('#alloc-target'), 'pref:13');
      once('割り振りを更新しました。東京都の人口を20%増やす場合です。人口を動かす元は、全国のほかの地域です。');

      q<HTMLButtonElement>('[data-source="regions"]').click();
      once('割り振りを更新しました。東京都の人口を20%増やす場合です。人口を動かす元は、選んだ地域（関東）です。');

      const kinki = q<HTMLInputElement>('input[data-region="kinki"]');
      kinki.checked = true;
      kinki.dispatchEvent(new Event('change', { bubbles: true }));
      once('割り振りを更新しました。東京都の人口を20%増やす場合です。人口を動かす元は、選んだ地域（関東・近畿）です。');

      await slide(-15);
      once('割り振りを更新しました。東京都の人口を15%減らす場合です。人口を動かす元は、選んだ地域（関東・近畿）です。');

      await slide(0);
      once('割り振りの割合を0%にしました。東京都の人口は動きません。');
      obs.stop();
    });

    test('a form change that leaves the announcement as it was writes nothing', async () => {
      const { el, q, choose, slide } = mount();
      await slide(20);
      const obs = watchLive(el);
      await slide(20); // the same percent again
      choose(q<HTMLSelectElement>('#alloc-target'), 'pref:30'); // the same target again
      q<HTMLButtonElement>('[data-source="proportional"]').click(); // the same source again
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
    });

    test('the announcement stays as it was across year steps (it names no year), so it is never stale', async () => {
      const { el, q, store, slide, text } = mount();
      await slide(25);
      const said = text('#alloc-announce');
      expect(said).not.toMatch(/\d{4}年/);
      store.set({ year: 2060 });
      store.set({ year: 2030 });
      expect(text('#alloc-announce')).toBe(said);
      expect(text('#alloc-summary')).toMatch(/^2030年に和歌山県の人口を25%/);
      // and the next form change after the sweep is announced exactly once again
      const obs = watchLive(el, q('#alloc-announce'));
      await slide(30);
      expect(obs.drain()).toHaveLength(1);
      obs.stop();
    });

    test('a form error is told by the alert, not by the announcement', () => {
      const { el, q } = mount();
      q<HTMLButtonElement>('[data-source="regions"]').click();
      const obs = watchLive(el, q('#alloc-announce'));
      const kanto = q<HTMLInputElement>('input[data-region="kanto"]');
      kanto.checked = false;
      kanto.dispatchEvent(new Event('change', { bubbles: true }));
      expect(q<HTMLElement>('#alloc-error').hidden).toBe(false);
      expect(q('#alloc-error').textContent).toBe('人口を動かす元の地域を、1つ以上選んでください。');
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
      expect(el.querySelector('#alloc-summary')!.textContent).toBe('');
    });

    test('when the map retargets the form, the old announcement is emptied (not spoken) so it never describes another form', async () => {
      const { el, q, store, slide, text } = mount();
      await slide(20);
      expect(text('#alloc-announce')).toContain('和歌山県の人口を20%');
      const obs = watchLive(el);
      store.set({ selectedPref: '13' }); // the visitor clicks Tokyo on the map; the form follows
      expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:13');
      const records = obs.drain();
      expect(records).toHaveLength(1);
      expect(q('#alloc-announce').contains(records[0]!.target) || records[0]!.target === q('#alloc-announce')).toBe(true);
      expect(text('#alloc-announce')).toBe('');
      expect(text('#alloc-summary')).toMatch(/^2100年に東京都の人口を20%/); // the visible sentence did follow
      store.set({ year: 2060 });
      store.set({ selectedPref: '27' });
      expect(obs.drain()).toHaveLength(0); // nothing left to empty, nothing to say
      obs.stop();
    });

    test('a retarget that leaves the form as it was keeps the announcement, and one before any form change writes nothing', async () => {
      const { el, store, text, slide } = mount();
      const obs = watchLive(el);
      store.set({ selectedPref: '13' }); // nothing was announced yet
      expect(obs.drain()).toHaveLength(0);
      await slide(25);
      obs.drain();
      const said = text('#alloc-announce');
      store.set({ selectedArea: '13101' }); // a town is offered; the target is still Tokyo
      expect(text('#alloc-announce')).toBe(said);
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
    });

    test('while the allocation is on the map the target does not move, so the announcement stays', async () => {
      const { el, q, store, slide, text } = mount();
      await slide(20);
      q<HTMLButtonElement>('#alloc-map-toggle').click();
      const said = text('#alloc-announce');
      const obs = watchLive(el, q('#alloc-announce'));
      store.set({ selectedPref: '13' });
      expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:30');
      expect(text('#alloc-announce')).toBe(said);
      expect(obs.drain()).toHaveLength(0);
      obs.stop();
      expect(el.contains(q('#alloc-announce'))).toBe(true);
    });

    test('announceAllocation: what the form asks, with no year and none of the words the app never uses', () => {
      const base = { targetName: '和歌山県', percent: 10, sourceNames: undefined };
      expect(announceAllocation(base)).toBe('割り振りを更新しました。和歌山県の人口を10%増やす場合です。人口を動かす元は、全国のほかの地域です。');
      expect(announceAllocation({ ...base, percent: -30 })).toBe('割り振りを更新しました。和歌山県の人口を30%減らす場合です。人口を動かす元は、全国のほかの地域です。');
      expect(announceAllocation({ ...base, percent: 0 })).toBe('割り振りの割合を0%にしました。和歌山県の人口は動きません。');
      expect(announceAllocation({ ...base, sourceNames: ['関東', '近畿'] })).toBe(
        '割り振りを更新しました。和歌山県の人口を10%増やす場合です。人口を動かす元は、選んだ地域（関東・近畿）です。',
      );
      for (const text of [announceAllocation(base), announceAllocation({ ...base, percent: -5 }), announceAllocation({ ...base, percent: 0 })]) {
        expect(text).not.toMatch(/\d{4}/);
        for (const w of FORBIDDEN) expect(text).not.toContain(w);
      }
    });
  });

  test('the teardown stops listening to the store and cancels a pending update', () => {
    const active = new Set<Listener>();
    const { q, store, teardown, text } = mount({}, (s) => tracked(s, active));
    expect(active.size).toBe(1);
    const before = text('#alloc-summary');
    const input = q<HTMLInputElement>('#alloc-percent');
    input.value = '30';
    input.dispatchEvent(new Event('input', { bubbles: true })); // an update is now pending
    teardown();
    expect(active.size).toBe(0);
    return raf().then(() => {
      expect(text('#alloc-summary')).toBe(before); // the pending update never ran
      store.set({ year: 2060 });
      expect(text('#alloc-summary')).toBe(before); // nothing listens any more
      q<HTMLButtonElement>('[data-source="regions"]').click(); // and the dead panel ignores clicks
      expect(q('[data-source="regions"]').getAttribute('aria-pressed')).toBe('false');
      teardown(); // twice is fine
    });
  });

  test('mounting twice into the same element ends the first mount and keeps one heading badge', () => {
    const active = new Set<Listener>();
    const ctx = makeRealContext();
    const store = tracked(ctx.store, active);
    const el = document.createElement('section');
    el.innerHTML = '<h2 class="panel-title">人口の割り振り</h2>';
    document.body.append(el);
    const first = mountAllocation(el, { ...ctx, store });
    const second = mountAllocation(el, { ...ctx, store });
    expect(active.size).toBe(1);
    expect(el.querySelectorAll('.panel-title .badge-estimate')).toHaveLength(1); // 2100 is an estimate year
    expect(el.querySelector('.panel-title')!.textContent).toBe('人口の割り振り 試算');
    expect(el.querySelectorAll('#alloc-target')).toHaveLength(1);
    first();
    expect(active.size).toBe(1);
    ctx.store.set({ year: 2050 });
    expect(el.querySelectorAll('.panel-title .badge-estimate')).toHaveLength(0);
    second();
    expect(active.size).toBe(0);
  });

  test('the number of towns shown for a facility matches the engine', () => {
    const { ctx, rows } = mount();
    const { result } = computeAllocation(ctx.data, ctx.store.get().series, 2100, form());
    const grocery = result.flips.find((f) => f.facilityId === 'grocery')!;
    const row = rows().find((x) => x.name === '飲食料品小売業')!;
    expect(row.cells).toEqual([grocery.before.toLocaleString('ja-JP'), grocery.after.toLocaleString('ja-JP'), signedCount(grocery.after - grocery.before)]);
  });
});

describe('地図に反映する (the map overlay)', () => {
  test('the toggle draws the current result on the map and takes it off again', () => {
    const { q, store, ctx } = mount();
    const toggle = q<HTMLButtonElement>('#alloc-map-toggle');
    expect(toggle.textContent).toBe('地図に反映する');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(store.get().allocation).toBeUndefined();

    toggle.click();
    expect(toggle.textContent).toBe('地図に反映中');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const a = store.get().allocation!;
    expect(a.year).toBe(2100);
    expect(a.label).toBe('和歌山県 +10%');
    expect(a.changePercent['30206']).toBeCloseTo(10, 6);
    expect(Object.keys(a.changePercent)).toHaveLength(ctx.data.areas.length);
    const grocery = a.flips.find((f) => f.facilityId === 'grocery')!;
    expect(grocery.gained).toContain('30344');
    expect(q('#alloc-map-status').textContent).toContain('地図の色は');

    toggle.click();
    expect(store.get().allocation).toBeUndefined();
    expect(toggle.textContent).toBe('地図に反映する');
    expect(q('#alloc-map-status').textContent).toBe('');
  });

  test('pressing a facility name focuses that facility on the map (and turns the map on); pressing again unfocuses', () => {
    const { el, store } = mount();
    const name = [...el.querySelectorAll<HTMLButtonElement>('.alloc-focus')].find((b) => b.textContent === '飲食料品小売業')!;
    expect(name.getAttribute('aria-pressed')).toBe('false');
    name.click();
    expect(store.get().allocation?.focusFacilityId).toBe('grocery');
    expect(el.querySelector<HTMLButtonElement>('#alloc-map-toggle')!.getAttribute('aria-pressed')).toBe('true');
    const pressed = [...el.querySelectorAll<HTMLButtonElement>('.alloc-focus')].find((b) => b.textContent === '飲食料品小売業')!;
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    pressed.click();
    expect(store.get().allocation).toBeDefined();
    expect(store.get().allocation?.focusFacilityId).toBeUndefined();
  });

  test('while on, a year change, a form change and a scenario change redraw the overlay', async () => {
    const { q, store, slide, choose } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    const first = store.get().allocation!;
    store.set({ year: 2080 });
    const second = store.get().allocation!;
    expect(second).not.toBe(first);
    expect(second.year).toBe(2080);
    await slide(20);
    expect(store.get().allocation?.label).toBe('和歌山県 +20%');
    choose(q<HTMLSelectElement>('#alloc-target'), 'pref:13');
    expect(store.get().allocation?.label).toBe('東京都 +20%');
    store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 } });
    const after = store.get().allocation!;
    expect(after).toBeDefined(); // the store cleared it, the panel drew it again under the new series
    expect(after.label).toBe('東京都 +20%');
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('true');
  });

  test('when the overlay is removed from outside, the toggle turns off', () => {
    const { q, store } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    store.set({ allocation: undefined });
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(q('#alloc-map-toggle').textContent).toBe('地図に反映する');
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    const own = store.get().allocation!;
    store.set({ allocation: { ...own, label: 'someone else', changePercent: {}, flips: [] } }); // the AI panel took the map
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(store.get().allocation?.label).toBe('someone else');
  });

  test('a form that cannot be computed turns the map off; teardown clears the overlay', () => {
    const { q, store, choose, teardown } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    expect(store.get().allocation).toBeDefined();
    choose(q<HTMLSelectElement>('#alloc-target'), 'pref:13');
    [...q<HTMLElement>('.choice-stack').querySelectorAll<HTMLButtonElement>('button')].find((b) => b.dataset.source === 'regions')!.click();
    for (const box of q<HTMLElement>('#alloc-regions').querySelectorAll<HTMLInputElement>('input')) {
      if (box.checked) box.click(); // no region left: a form error
    }
    expect(q<HTMLElement>('#alloc-error').hidden).toBe(false);
    expect(store.get().allocation).toBeUndefined();
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('false');

    q<HTMLElement>('#alloc-regions').querySelector<HTMLInputElement>('input')!.click();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    expect(store.get().allocation).toBeDefined();
    teardown();
    expect(store.get().allocation).toBeUndefined();
  });

  test('pressing a facility name in the collapsed group keeps keyboard focus on it and the group open', () => {
    const { q, store } = mount();
    const more = q<HTMLDetailsElement>('details.alloc-more');
    more.open = true;
    const name = more.querySelector<HTMLButtonElement>('.alloc-focus')!;
    const id = name.dataset.facility!;
    expect(id).toBeTruthy();
    name.focus();
    name.click();
    expect(store.get().allocation?.focusFacilityId).toBe(id);
    expect(document.activeElement).toBe(name); // the same button, not a rebuilt one
    expect(name.isConnected).toBe(true);
    expect(name.getAttribute('aria-pressed')).toBe('true');
    expect(more.open).toBe(true);
    // the toggle off clears every pressed name, again in place
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    expect(name.isConnected).toBe(true);
    expect(name.getAttribute('aria-pressed')).toBe('false');
    expect(more.open).toBe(true);
  });

  describe('keyboard focus survives a year or scenario step', () => {
    /** The facility name buttons on screen, by facility id (visible and collapsed tables). */
    const buttonFor = (el: HTMLElement, id: string) => [...el.querySelectorAll<HTMLButtonElement>('.alloc-focus')].find((b) => b.dataset.facility === id);
    const HEADING = '施設の人口の目安をまたぐ町の数';

    test('the focused facility keeps focus when the year steps and the facility is still listed', () => {
      const { el, store } = mount(); // 2100
      const before = buttonFor(el, 'grocery')!;
      before.focus();
      expect(document.activeElement).toBe(before);
      store.set({ year: 2095 }); // grocery is listed in 2095 as well
      const after = buttonFor(el, 'grocery')!;
      expect(after).toBeDefined();
      expect(after).not.toBe(before); // the list was rebuilt
      expect(before.isConnected).toBe(false);
      expect(document.activeElement).toBe(after);
      expect(after.isConnected).toBe(true);
      expect(after.textContent).toBe('飲食料品小売業');
    });

    test('and when the scenario steps', () => {
      const assumptions = { cwrMult: 1.2, migMode: 'hold' as const, migScale: 1, infraStrength: 0 };
      const listed = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.alloc-focus')].map((b) => b.dataset.facility!);
      // First learn which facilities are listed under the new assumptions, so the test follows one that stays and one that goes.
      const probe = mount();
      const atFirst = listed(probe.el);
      probe.store.set({ scenario: assumptions });
      const afterwards = listed(probe.el);
      document.body.replaceChildren();
      const stays = atFirst.find((id) => afterwards.includes(id))!;
      const goes = atFirst.find((id) => !afterwards.includes(id))!;
      expect(stays, 'a facility listed before and after').toBeDefined();
      expect(goes, 'a facility listed only before').toBeDefined();

      const { el, store } = mount();
      const before = buttonFor(el, stays)!;
      before.focus();
      store.set({ scenario: assumptions });
      const after = buttonFor(el, stays)!;
      expect(before.isConnected).toBe(false);
      expect(document.activeElement).toBe(after);

      document.body.replaceChildren();
      const second = mount();
      buttonFor(second.el, goes)!.focus();
      second.store.set({ scenario: assumptions });
      expect(buttonFor(second.el, goes)).toBeUndefined();
      expect(document.activeElement).toBe(second.el.querySelector('#alloc-detail .panel-section-title'));
    });

    test('a facility that is no longer listed gives focus to the list heading', () => {
      const { el, store } = mount();
      buttonFor(el, 'grocery')!.focus();
      store.set({ year: 2090 }); // nothing crosses grocery's guide in 2090
      expect(buttonFor(el, 'grocery')).toBeUndefined();
      const heading = el.querySelector<HTMLElement>('#alloc-detail .panel-section-title')!;
      expect(heading.textContent).toBe(HEADING);
      expect(document.activeElement).toBe(heading);
      expect(heading.getAttribute('tabindex')).toBe('-1'); // takes focus from a script, is not another Tab stop
    });

    test('a facility that moves into the collapsed group keeps focus, with the group opened for it', () => {
      const { el, store } = mount();
      const before = buttonFor(el, 'restaurant')!;
      expect(before.closest('details')).toBeNull(); // listed in the open table in 2100
      before.focus();
      store.set({ year: 2095 }); // in 2095 it sits in the collapsed group
      const after = buttonFor(el, 'restaurant')!;
      const group = after.closest('details.alloc-more') as HTMLDetailsElement;
      expect(group).not.toBeNull();
      expect(group.open).toBe(true);
      expect(document.activeElement).toBe(after);
    });

    test('a facility inside the collapsed group keeps focus across a step, and the group stays open', () => {
      const { el, store } = mount();
      const group = el.querySelector<HTMLDetailsElement>('details.alloc-more')!;
      group.open = true;
      const before = buttonFor(el, 'hotel')!;
      expect(before.closest('details')).toBe(group); // in the collapsed group in 2100
      before.focus();
      expect(document.activeElement).toBe(before);
      store.set({ year: 2095 }); // and in 2095
      const after = buttonFor(el, 'hotel')!;
      expect(after).not.toBe(before);
      expect((after.closest('details') as HTMLDetailsElement).open).toBe(true);
      expect(document.activeElement).toBe(after);
    });

    test('a facility inside the collapsed group that is no longer listed gives focus to the heading', () => {
      const { el, store } = mount();
      el.querySelector<HTMLDetailsElement>('details.alloc-more')!.open = true;
      buttonFor(el, 'hotel')!.focus();
      store.set({ year: 2090 });
      expect(buttonFor(el, 'hotel')).toBeUndefined();
      expect(document.activeElement).toBe(el.querySelector('#alloc-detail .panel-section-title'));
    });

    test('a step of the form keeps focus too (the list is rebuilt for it as well)', () => {
      const { el, q, choose } = mount();
      const before = buttonFor(el, 'grocery')!;
      before.focus();
      choose(q<HTMLSelectElement>('#alloc-target'), 'pref:13'); // the visitor changes the target by script while focus is on the list
      expect(before.isConnected).toBe(false);
      expect(el.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(document.body);
    });

    test('putting focus back never scrolls the page: the focus call asks for preventScroll, for the button and for the heading', () => {
      const { el, store } = mount();
      const focusCalls = vi.spyOn(HTMLElement.prototype, 'focus');
      buttonFor(el, 'grocery')!.focus();
      focusCalls.mockClear();

      store.set({ year: 2095 }); // grocery is still listed: focus goes to its new button
      expect(focusCalls).toHaveBeenCalledTimes(1);
      expect(focusCalls.mock.contexts[0]).toBe(buttonFor(el, 'grocery'));
      expect(focusCalls.mock.calls[0]).toEqual([{ preventScroll: true }]);

      focusCalls.mockClear();
      store.set({ year: 2090 }); // grocery is gone: focus goes to the heading
      expect(focusCalls).toHaveBeenCalledTimes(1);
      expect(focusCalls.mock.contexts[0]).toBe(el.querySelector('#alloc-detail .panel-section-title'));
      expect(focusCalls.mock.calls[0]).toEqual([{ preventScroll: true }]);
    });

    test('focus that is not in the list is left alone, and nothing steals it when nothing has focus', () => {
      const { el, q, store } = mount();
      const slider = q<HTMLInputElement>('#alloc-percent');
      slider.focus();
      store.set({ year: 2095 });
      expect(document.activeElement).toBe(slider);
      (document.activeElement as HTMLElement).blur();
      store.set({ year: 2090 });
      expect(document.activeElement).toBe(document.body);
      expect(el.querySelector('#alloc-detail .panel-section-title')!.hasAttribute('tabindex')).toBe(false); // not made focusable unless needed
    });

    test('the facility button still works after focus was handed to the rebuilt list', () => {
      const { el, store } = mount();
      buttonFor(el, 'grocery')!.focus();
      store.set({ year: 2095 });
      (document.activeElement as HTMLButtonElement).click();
      expect(store.get().allocation?.focusFacilityId).toBe('grocery');
      expect(buttonFor(el, 'grocery')!.getAttribute('aria-pressed')).toBe('true');
    });
  });

  test('an overlay put on the map from elsewhere together with a new year turns the toggle off and still recomputes the year', () => {
    const { q, store } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    const own = store.get().allocation!;
    store.set({ year: 2060, allocation: { ...own, year: 2060, label: 'AI', flips: [], focusFacilityId: undefined } });
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(store.get().allocation?.label).toBe('AI');
    expect(q('#alloc-year').textContent).toContain('2060年の人口で計算');
  });

  test('an overlay put on the map from elsewhere together with new assumptions also turns the toggle off and stays', () => {
    const { q, store } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    const own = store.get().allocation!;
    store.set({ scenario: { cwrMult: 1.2, migMode: 'hold', migScale: 1, infraStrength: 0 }, allocation: { ...own, label: 'AI', flips: [], focusFacilityId: undefined } });
    expect(q<HTMLButtonElement>('#alloc-map-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(store.get().allocation?.label).toBe('AI'); // the panel did not draw its own over it
  });

  test('while the map shows the allocation, moving around the map neither retargets nor redraws it', () => {
    const { q, el, store } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    [...el.querySelectorAll<HTMLButtonElement>('.alloc-focus')].find((b) => b.dataset.facility === 'cafe')!.click();
    const shown = store.get().allocation!;
    expect(shown.label).toBe('和歌山県 +10%');
    expect(shown.flips.find((f) => f.facilityId === 'cafe')!.lost).toContain('20521'); // 坂城町, in 長野県
    store.set({ selectedPref: '20' }); // the visitor follows the −1 marker on 長野県
    expect(store.get().allocation).toBe(shown);
    expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:30');
    store.set({ selectedArea: '20521' });
    expect(store.get().allocation).toBe(shown);
    expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:30');
    expect(q('#alloc-summary').textContent).toContain('和歌山県');
    // with the map off again, the map drives the target as before
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    store.set({ selectedPref: '13' });
    expect(q<HTMLSelectElement>('#alloc-target').value).toBe('pref:13');
  });

  test('a town target is kept (and still offered) while the map shows it and the selection moves away', () => {
    const { q, store, choose } = mount();
    store.set({ selectedArea: '30206' });
    choose(q<HTMLSelectElement>('#alloc-target'), 'area:30206');
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    const shown = store.get().allocation!;
    expect(shown.label).toBe('田辺市 +10%');
    store.set({ selectedPref: '13' });
    expect(store.get().allocation).toBe(shown);
    const select = q<HTMLSelectElement>('#alloc-target');
    expect(select.value).toBe('area:30206');
    expect([...select.options].find((o) => o.value === 'area:30206')?.textContent).toBe('選んだ町：田辺市');
  });

  test('the panel never says the forbidden words, with the map on', () => {
    const { el, q } = mount();
    q<HTMLButtonElement>('#alloc-map-toggle').click();
    for (const w of FORBIDDEN) expect(el.textContent).not.toContain(w);
  });
});
