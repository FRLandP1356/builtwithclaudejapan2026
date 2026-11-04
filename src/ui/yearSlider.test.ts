// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ESTIMATE_NOTE, OFFICIAL_NOTE } from './sources';
import { mountYearSlider } from './yearSlider';

function setup(year = 2050) {
  const el = document.createElement('div');
  document.body.append(el);
  const onChange = vi.fn();
  const slider = mountYearSlider(el, { year, onChange, intervalMs: 100 });
  return {
    el,
    slider,
    onChange,
    output: el.querySelector<HTMLOutputElement>('.year-value')!,
    note: el.querySelector<HTMLParagraphElement>('.year-note')!,
    input: el.querySelector<HTMLInputElement>('.year-range')!,
    play: el.querySelector<HTMLButtonElement>('.year-play')!,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('mountYearSlider', () => {
  test('the year is announced through aria-valuetext; the numeral is not a live region', () => {
    const { output, input, note } = setup();
    expect(output.getAttribute('aria-live')).toBe('off');
    expect(input.getAttribute('aria-valuetext')).toBe('2050年');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe(OFFICIAL_NOTE);
  });

  test('the note is rewritten only when the year crosses 2050', () => {
    const { slider, note, input } = setup();
    const official = note.firstChild;
    slider.update(2045);
    expect(note.firstChild).toBe(official); // same side of 2050: untouched
    slider.update(2055);
    expect(note.dataset.estimate).toBe('true');
    expect(note.querySelector('.badge-estimate')?.textContent).toBe('試算');
    expect(note.textContent).toContain(ESTIMATE_NOTE);
    const estimateBadge = note.firstChild;
    slider.update(2060);
    slider.update(2100);
    expect(note.firstChild).toBe(estimateBadge); // still the same nodes
    expect(input.getAttribute('aria-valuetext')).toBe('2100年');
    slider.update(2050);
    expect(note.textContent).toBe(OFFICIAL_NOTE);
  });

  test('moving the range reports the year', () => {
    const { input, onChange } = setup();
    input.value = '2075';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(onChange).toHaveBeenCalledWith(2075);
  });

  test('play steps every interval, stops at 2100, and a second press pauses', () => {
    vi.useFakeTimers();
    const { slider, play, onChange } = setup(2090);
    play.click();
    expect(play.getAttribute('aria-pressed')).toBe('true');
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith(2095);
    slider.update(2095);
    vi.advanceTimersByTime(100);
    expect(onChange).toHaveBeenLastCalledWith(2100);
    slider.update(2100);
    vi.advanceTimersByTime(100);
    expect(play.getAttribute('aria-pressed')).toBe('false'); // reached the end
    play.click(); // restarts from the beginning
    expect(onChange).toHaveBeenLastCalledWith(2020);
    play.click();
    expect(play.getAttribute('aria-pressed')).toBe('false');
  });
});
