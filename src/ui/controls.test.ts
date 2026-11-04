// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeRealContext } from '../../test/helpers/realPanelContext';
import { DEFAULT_SCENARIO, type Scenario } from '../engine/types';
import { SCENARIO_LIMITS } from '../data/runner';
import { deriveTotals, yearIndex } from './derive';
import {
  checkScenario,
  compareNote,
  controlsFromScenario,
  DEFAULT_CONTROLS,
  describeScenario,
  mountControls,
  scenarioFromControls,
} from './controls';

describe('scenarioFromControls', () => {
  test('the default controls give exactly DEFAULT_SCENARIO', () => {
    expect(scenarioFromControls(DEFAULT_CONTROLS)).toEqual(DEFAULT_SCENARIO);
    expect(scenarioFromControls({ cwrMult: 1, migMode: 'hold', migScale: 1, infra: 'none' })).toEqual(DEFAULT_SCENARIO);
  });

  test('infra none / weak / strong map to 0 / 0.002 / 0.005', () => {
    const at = (infra: 'none' | 'weak' | 'strong') => scenarioFromControls({ ...DEFAULT_CONTROLS, infra }).infraStrength;
    expect(at('none')).toBe(0);
    expect(at('weak')).toBe(0.002);
    expect(at('strong')).toBe(0.005);
  });

  test('the other knobs pass through', () => {
    expect(scenarioFromControls({ cwrMult: 1.2, migMode: 'fade', migScale: 0.5, infra: 'weak' })).toEqual({
      cwrMult: 1.2,
      migMode: 'fade',
      migScale: 0.5,
      infraStrength: 0.002,
    });
  });

  test('a custom infra keeps the strength it was given (a scenario set by the AI is not rounded to a button)', () => {
    expect(scenarioFromControls({ ...DEFAULT_CONTROLS, infra: 'custom', infraStrength: 0.003 }).infraStrength).toBe(0.003);
    expect(scenarioFromControls({ ...DEFAULT_CONTROLS, infra: 'custom' }).infraStrength).toBe(0);
  });
});

describe('controlsFromScenario', () => {
  test('the default scenario shows the default controls', () => {
    expect(controlsFromScenario(DEFAULT_SCENARIO)).toEqual(DEFAULT_CONTROLS);
  });

  test('round trips every button combination', () => {
    for (const infra of ['none', 'weak', 'strong'] as const) {
      for (const migMode of ['hold', 'fade'] as const) {
        const v = { cwrMult: 0.85, migMode, migScale: 0.7, infra };
        const s = scenarioFromControls(v);
        expect(controlsFromScenario(s)).toEqual(v);
        expect(scenarioFromControls(controlsFromScenario(s))).toEqual(s);
      }
    }
  });

  test('an infraStrength that is none of 0 / 0.002 / 0.005 is shown as custom, and kept', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, infraStrength: 0.003 };
    const c = controlsFromScenario(s);
    expect(c.infra).toBe('custom');
    expect(c.infraStrength).toBe(0.003);
    expect(scenarioFromControls(c)).toEqual(s);
  });
});

describe('describeScenario', () => {
  test('the default is described as the default', () => {
    expect(describeScenario(DEFAULT_SCENARIO)).toBe('初期値（2050年の前提を据え置き）');
  });

  test('lists only what differs, in plain words', () => {
    expect(describeScenario({ cwrMult: 1.2, migMode: 'fade', migScale: 1, infraStrength: 0.002 })).toBe(
      'いまの前提：子ども×1.2、移動は止まる、インフラ連動 弱い',
    );
    expect(describeScenario({ ...DEFAULT_SCENARIO, migScale: 0.5 })).toBe('いまの前提：移動の強さ×0.5');
    expect(describeScenario({ ...DEFAULT_SCENARIO, cwrMult: 0.85, infraStrength: 0.005 })).toBe('いまの前提：子ども×0.85、インフラ連動 強い');
  });

  test('a custom infra strength is named as such, not as a button', () => {
    expect(describeScenario({ ...DEFAULT_SCENARIO, infraStrength: 0.003 })).toBe('いまの前提：インフラ連動 0.003（独自の値）');
  });
});

describe('checkScenario', () => {
  test('passes a valid scenario through', () => {
    expect(checkScenario({ ...DEFAULT_SCENARIO, cwrMult: 1.4 })).toEqual({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.4 } });
  });

  test('turns each rejected knob into a short Japanese message naming the allowed range', () => {
    const msg = (s: Partial<Scenario>) => {
      const r = checkScenario({ ...DEFAULT_SCENARIO, ...s });
      if ('scenario' in r) throw new Error('expected a rejection');
      return r.message;
    };
    expect(msg({ cwrMult: 2 })).toContain('子どもの生まれやすさ');
    expect(msg({ cwrMult: 2 })).toContain('0.6');
    expect(msg({ cwrMult: 2 })).toContain('1.4');
    expect(msg({ migScale: -1 })).toContain('移動の強さ');
    expect(msg({ infraStrength: 0.5 })).toContain('インフラ連動');
    expect(msg({ cwrMult: Number.NaN })).toContain('子どもの生まれやすさ');
    expect(msg({ migMode: 'sideways' as Scenario['migMode'] })).toContain('人口の移動');
    for (const s of [{ cwrMult: 2 }, { migScale: 9 }, { infraStrength: 1 }]) expect(msg(s)).toContain('前の値のまま');
  });
});

describe('compareNote', () => {
  test('same value', () => {
    expect(compareNote(63279524, 63279524)).toBe('初期値と同じ（6,328万人）');
  });
  test('a difference in 万人 with a percent', () => {
    expect(compareNote(70930000, 63280000)).toBe('初期値（6,328万人）より +765万人（+12.1%）');
    expect(compareNote(56340000, 63280000)).toBe('初期値（6,328万人）より −694万人（−11.0%）');
  });
  test('a small place: people, not 万人', () => {
    expect(compareNote(9500, 10000)).toBe('初期値（1.0万人）より −500人（−5.0%）');
    expect(compareNote(1210, 1000)).toBe('初期値（1,000人）より +210人（+21.0%）');
  });
  test('no percent when the baseline is zero', () => {
    expect(compareNote(120, 0)).toBe('初期値（0人）より +120人');
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The mounted panel, on the real data.
// ---------------------------------------------------------------------------------------------------------------
const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function mount(initial = {}) {
  const ctx = makeRealContext(initial);
  const el = document.createElement('section');
  el.className = 'panel';
  el.id = 'panel-controls';
  el.innerHTML = '<h2 class="panel-title" id="panel-controls-title">前提を変える</h2><p class="panel-empty">placeholder</p>';
  document.body.append(el);
  mountControls(el, ctx);
  const q = <T extends Element>(sel: string) => el.querySelector<T>(sel)!;
  const type = async (input: HTMLInputElement, value: number) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const tiles = () => [...el.querySelectorAll('#ctl-tiles .kpi')].map((k) => ({
    label: k.querySelector('.kpi-label')!.textContent!,
    value: k.querySelector('.kpi-value')!.textContent!,
    note: k.querySelector('.kpi-note')!.textContent!,
  }));
  return { ctx, el, q, type, tiles, store: ctx.store };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountControls', () => {
  test('replaces the placeholder, keeps the heading, and says what the panel changes', () => {
    const { el, q } = mount();
    expect(el.querySelectorAll('.panel-title')).toHaveLength(1);
    expect(el.querySelector('.panel-empty')).toBeNull();
    expect(q('.panel-title').textContent).toContain('前提を変える');
    expect(q('.panel-title .badge-estimate').textContent).toBe('試算');
    expect(q('.panel-lead').textContent).toBe(
      '2050年までの数字は、社人研の公式推計のまま変わりません。ここで変えるのは、2050年より後の計算に使う前提です。',
    );
  });

  test('shows the three groups in plain Japanese; the infra group is flagged as an assumption', () => {
    const { el } = mount();
    const text = el.textContent!;
    for (const s of ['子どもの生まれやすさ', '2050年の水準を1.0とした倍率です（子ども女性比）。', '人口の移動', '2050年ごろの傾向を続ける', '2100年に向けて少しずつ止まる', '移動の強さ']) {
      expect(text).toContain(s);
    }
    const infra = el.querySelector('[data-group="infra"]')!;
    expect(infra.textContent).toContain('インフラ連動の過疎の加速');
    expect(infra.querySelector('.tag')!.textContent).toBe('仮定');
    expect(infra.textContent).toContain('公式の方法にはない要素');
    expect(infra.textContent).toContain('幅を見るための仮定です');
    expect(infra.textContent).toContain('どれだけ増えるかを測った根拠は手元にありません');
  });

  test('starts at the defaults and writes the default status', () => {
    const { q } = mount();
    expect(q<HTMLInputElement>('#ctl-cwr').value).toBe('1');
    expect(q('#ctl-cwr-value').textContent).toBe('×1.00');
    expect(q('#ctl-status').textContent).toBe('初期値（2050年の前提を据え置き）');
    expect(q('[data-mig="hold"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-infra="none"]').getAttribute('aria-pressed')).toBe('true');
  });

  test('moving the birth slider updates the scenario after one animation frame, and the effect tile', async () => {
    const { q, type, store, tiles } = mount();
    expect(tiles()[0].note).toBe('初期値と同じ（6,328万人）');
    await type(q<HTMLInputElement>('#ctl-cwr'), 1.2);
    expect(q('#ctl-cwr-value').textContent).toBe('×1.20'); // the label follows the thumb at once
    expect(store.get().scenario.cwrMult).toBe(1); // the engine runs once per frame, not per input event
    await raf();
    expect(store.get().scenario).toEqual({ ...DEFAULT_SCENARIO, cwrMult: 1.2 });
    expect(q('#ctl-status').textContent).toBe('いまの前提：子ども×1.2');
    const [japan] = tiles();
    expect(japan.label).toBe('2100年の日本全体の人口');
    expect(japan.value).toBe('7,093万人');
    expect(japan.note).toMatch(/^初期値（6,328万人）より \+76\d万人（\+12\.\d%）$/);
  });

  test('rapid input events in one frame make one store update', async () => {
    const { q, type, store } = mount();
    const spy = vi.spyOn(store, 'set');
    for (const v of [1.05, 1.1, 1.15, 1.2]) await type(q<HTMLInputElement>('#ctl-cwr'), v);
    await raf();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.get().scenario.cwrMult).toBe(1.2);
  });

  test('the migration choice and strength, and the infra choice, write their values', async () => {
    const { q, type, store } = mount();
    q<HTMLButtonElement>('[data-mig="fade"]').click();
    expect(store.get().scenario.migMode).toBe('fade');
    expect(q('[data-mig="fade"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-mig="hold"]').getAttribute('aria-pressed')).toBe('false');
    await type(q<HTMLInputElement>('#ctl-migscale'), 0.5);
    await raf();
    expect(store.get().scenario.migScale).toBe(0.5);
    q<HTMLButtonElement>('[data-infra="weak"]').click();
    expect(store.get().scenario.infraStrength).toBe(0.002);
    q<HTMLButtonElement>('[data-infra="strong"]').click();
    expect(store.get().scenario.infraStrength).toBe(0.005);
    expect(q('#ctl-status').textContent).toBe('いまの前提：移動は止まる、移動の強さ×0.5、インフラ連動 強い');
  });

  test('the reset button restores DEFAULT_SCENARIO and the controls', async () => {
    const { q, type, store } = mount();
    await type(q<HTMLInputElement>('#ctl-cwr'), 0.8);
    await raf();
    q<HTMLButtonElement>('[data-infra="strong"]').click();
    q<HTMLButtonElement>('[data-mig="fade"]').click();
    expect(store.get().scenario).not.toEqual(DEFAULT_SCENARIO);
    q<HTMLButtonElement>('#ctl-reset').click();
    expect(store.get().scenario).toEqual(DEFAULT_SCENARIO);
    expect(q<HTMLInputElement>('#ctl-cwr').value).toBe('1');
    expect(q('#ctl-cwr-value').textContent).toBe('×1.00');
    expect(q('[data-mig="hold"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('[data-infra="none"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('#ctl-status').textContent).toBe('初期値（2050年の前提を据え置き）');
  });

  test('a scenario set from elsewhere (the AI) updates the controls without the panel writing back', async () => {
    const { q, store, tiles } = mount();
    const spy = vi.spyOn(store, 'set');
    expect(store.set({ scenario: { cwrMult: 0.8, migMode: 'fade', migScale: 0.5, infraStrength: 0.003 } })).toBe(true);
    await raf();
    expect(spy).toHaveBeenCalledTimes(1); // only the call above; the panel did not answer with its own set
    expect(q<HTMLInputElement>('#ctl-cwr').value).toBe('0.8');
    expect(q('#ctl-cwr-value').textContent).toBe('×0.80');
    expect(q<HTMLInputElement>('#ctl-migscale').value).toBe('0.5');
    expect(q('[data-mig="fade"]').getAttribute('aria-pressed')).toBe('true');
    // 0.003 is none of the buttons: no button is pressed and the custom value is named
    for (const k of ['none', 'weak', 'strong']) expect(q(`[data-infra="${k}"]`).getAttribute('aria-pressed')).toBe('false');
    expect(q('[data-group="infra"]').textContent).toContain('独自の値（0.003）');
    expect(q('#ctl-status').textContent).toBe('いまの前提：子ども×0.8、移動は止まる、移動の強さ×0.5、インフラ連動 0.003（独自の値）');
    expect(tiles()[0].note).toMatch(/^初期値（6,328万人）より −/);
  });

  test('moving another slider while the AI set a custom infra strength keeps that strength', async () => {
    const { q, type, store } = mount({ scenario: { infraStrength: 0.003 } });
    await type(q<HTMLInputElement>('#ctl-cwr'), 1.1);
    await raf();
    expect(store.get().scenario).toEqual({ ...DEFAULT_SCENARIO, cwrMult: 1.1, infraStrength: 0.003 });
  });

  test('moving one slider leaves the other knobs exactly as the store has them (even off the slider steps)', async () => {
    const { q, type, store } = mount({ scenario: { cwrMult: 1.234, migScale: 0.77 } });
    await type(q<HTMLInputElement>('#ctl-migscale'), 0.9);
    await raf();
    expect(store.get().scenario).toEqual({ ...DEFAULT_SCENARIO, cwrMult: 1.234, migScale: 0.9 });
    await type(q<HTMLInputElement>('#ctl-cwr'), 1.1);
    await raf();
    expect(store.get().scenario).toEqual({ ...DEFAULT_SCENARIO, cwrMult: 1.1, migScale: 0.9 });
  });

  test('a rejected value shows a short message, leaves the store alone and puts the slider back', async () => {
    const { q, type, store } = mount();
    const slider = q<HTMLInputElement>('#ctl-cwr');
    slider.max = '5'; // the browser would clamp; here we force a value outside the engine's range
    const before = store.get().scenario;
    const spy = vi.spyOn(store, 'set');
    await type(slider, 3);
    await raf();
    expect(spy).not.toHaveBeenCalled();
    expect(store.get().scenario).toBe(before);
    const err = q<HTMLElement>('#ctl-error');
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain('子どもの生まれやすさ');
    expect(err.textContent).toContain('前の値のまま');
    expect(Number(slider.value)).toBe(1);
    expect(q('#ctl-cwr-value').textContent).toBe('×1.00');
    // the next valid change clears the message
    slider.max = String(SCENARIO_LIMITS.cwrMult[1]);
    await type(slider, 1.1);
    await raf();
    expect(q<HTMLElement>('#ctl-error').hidden).toBe(true);
    expect(store.get().scenario.cwrMult).toBe(1.1);
  });

  test('effect tiles: the country, and the selected place when there is one', () => {
    const { ctx, store, tiles } = mount();
    expect(tiles()).toHaveLength(1);
    store.set({ selectedArea: '30206' });
    expect(tiles()).toHaveLength(2);
    const totals = deriveTotals(store.get().series, ctx.data.groups);
    const i = yearIndex(totals.years, 2100);
    const tanabe = totals.area.get('30206')![i];
    const [, place] = tiles();
    expect(place.label).toBe('和歌山県 田辺市の2100年の人口');
    expect(place.value).toMatch(/万人$|人$/);
    expect(place.note).toBe('初期値と同じ（' + place.value + '）');
    expect(tanabe).toBeGreaterThan(0);
    store.set({ scenario: { ...DEFAULT_SCENARIO, cwrMult: 1.4 } });
    expect(tiles()[1].note).toMatch(/^初期値（.+）より \+/);
    store.set({ selectedArea: undefined, selectedPref: '30' });
    expect(tiles()[1].label).toBe('和歌山県の2100年の人口');
    store.set({ selectedPref: undefined });
    expect(tiles()).toHaveLength(1);
  });

  test('keyboard and screen reader basics: labelled ranges with a spoken value, real buttons, no negative tabindex', async () => {
    const { el, q, type } = mount();
    for (const input of el.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      expect(input.id).not.toBe('');
      expect(el.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
      expect(input.getAttribute('aria-valuetext')).toBeTruthy();
    }
    expect(q('#ctl-cwr').getAttribute('aria-valuetext')).toBe('2050年の水準の1.00倍');
    await type(q<HTMLInputElement>('#ctl-cwr'), 1.25);
    expect(q('#ctl-cwr').getAttribute('aria-valuetext')).toBe('2050年の水準の1.25倍');
    expect(q('#ctl-migscale').getAttribute('aria-valuetext')).toBe('標準の1.0倍');
    for (const b of el.querySelectorAll('button')) {
      expect(b.type).toBe('button');
      expect(b.tabIndex).toBeGreaterThanOrEqual(0);
    }
    for (const group of el.querySelectorAll('.choice')) expect(group.getAttribute('role')).toBe('group');
    for (const group of el.querySelectorAll('.choice')) expect(group.getAttribute('aria-label') ?? group.getAttribute('aria-labelledby')).toBeTruthy();
    const ids = [...el.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the range limits come from SCENARIO_LIMITS, not copies', () => {
    const { q } = mount();
    expect(Number(q<HTMLInputElement>('#ctl-cwr').min)).toBe(SCENARIO_LIMITS.cwrMult[0]);
    expect(Number(q<HTMLInputElement>('#ctl-cwr').max)).toBe(SCENARIO_LIMITS.cwrMult[1]);
    expect(Number(q<HTMLInputElement>('#ctl-migscale').min)).toBe(SCENARIO_LIMITS.migScale[0]);
    expect(Number(q<HTMLInputElement>('#ctl-migscale').max)).toBe(SCENARIO_LIMITS.migScale[1]);
  });

  test('never says 予測, 残せない or 閉鎖 and gives no advice', async () => {
    const { el, q, type } = mount({ selectedArea: '30206' });
    q<HTMLButtonElement>('[data-infra="strong"]').click();
    await type(q<HTMLInputElement>('#ctl-cwr'), 0.7);
    await raf();
    const text = el.textContent!;
    for (const w of ['予測', '残せない', '閉鎖', 'すべき', 'おすすめ', 'お勧め']) expect(text).not.toContain(w);
  });
});

describe('checkScenario and the store agree', () => {
  test('whatever checkScenario accepts the store accepts', () => {
    const { store } = mount();
    const r = checkScenario({ ...DEFAULT_SCENARIO, cwrMult: 0.6, migScale: 1.5, infraStrength: 0.01 });
    expect('scenario' in r).toBe(true);
    if ('scenario' in r) expect(store.set({ scenario: r.scenario })).toBe(true);
  });
});
