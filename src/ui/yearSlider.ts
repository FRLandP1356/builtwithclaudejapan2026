// The year control: a large mincho year, the official/estimate note, a range input over a two-part track
// (solid to 2050, dashed after) and a play button that steps through the years.
import { ESTIMATE_BADGE, ESTIMATE_NOTE, OFFICIAL_END_YEAR, OFFICIAL_NOTE } from './sources';

export interface YearSliderOptions {
  year: number;
  min?: number;
  max?: number;
  step?: number;
  /** Interval between automatic steps while playing, in ms. */
  intervalMs?: number;
  onChange(year: number): void;
}

export interface YearSlider {
  /** Reflect a year chosen elsewhere (store). */
  update(year: number): void;
  /** Stop playing, if playing. */
  stop(): void;
  destroy(): void;
}

const PLAY_PATH = 'M4 2l10 6-10 6z';
const PAUSE_PATH = 'M3 2h4v12H3zM9 2h4v12H9z';

export function mountYearSlider(el: HTMLElement, opts: YearSliderOptions): YearSlider {
  const min = opts.min ?? 2020;
  const max = opts.max ?? 2100;
  const step = opts.step ?? 5;
  const intervalMs = opts.intervalMs ?? 800;
  const split = ((OFFICIAL_END_YEAR - min) / (max - min)) * 100;

  el.className = 'year';
  el.innerHTML = `
    <output class="year-value" id="year-value" for="year-range"><span class="year-num">${opts.year}</span><span class="unit">年</span></output>
    <p class="year-note" id="year-note" aria-live="polite"></p>
    <div class="year-controls">
      <button type="button" class="btn btn-icon year-play" aria-pressed="false" aria-label="年を自動で進める">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="${PLAY_PATH}"></path></svg>
      </button>
      <div class="year-range-wrap" style="--split: ${split.toFixed(3)}%">
        <div class="year-track" aria-hidden="true"></div>
        <div class="year-ticks" aria-hidden="true">
          <span class="year-tick" data-edge="start" style="left:0%">${min}</span>
          <span class="year-tick" style="left:${split.toFixed(3)}%">${OFFICIAL_END_YEAR}</span>
          <span class="year-tick" data-edge="end" style="left:100%">${max}</span>
        </div>
        <input type="range" class="year-range" id="year-range" min="${min}" max="${max}" step="${step}" value="${opts.year}"
          aria-label="年" aria-describedby="year-note" />
      </div>
    </div>`;

  const num = el.querySelector<HTMLSpanElement>('.year-num')!;
  const note = el.querySelector<HTMLParagraphElement>('.year-note')!;
  const input = el.querySelector<HTMLInputElement>('.year-range')!;
  const playBtn = el.querySelector<HTMLButtonElement>('.year-play')!;
  const icon = playBtn.querySelector<SVGPathElement>('path')!;

  let current = opts.year;
  let timer: number | undefined;
  let playing = false;

  function render(year: number): void {
    current = year;
    input.value = String(year);
    num.textContent = String(year);
    input.setAttribute('aria-valuetext', `${year}年`);
    if (year > OFFICIAL_END_YEAR) {
      note.dataset.estimate = 'true';
      const badge = document.createElement('span');
      badge.className = 'badge-estimate';
      badge.textContent = ESTIMATE_BADGE;
      note.replaceChildren(badge, document.createTextNode(ESTIMATE_NOTE));
    } else {
      note.dataset.estimate = 'false';
      note.textContent = OFFICIAL_NOTE;
    }
  }

  function stop(): void {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    playing = false;
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.setAttribute('aria-label', '年を自動で進める');
    icon.setAttribute('d', PLAY_PATH);
  }

  function tick(): void {
    timer = window.setTimeout(() => {
      const next = current + step;
      if (next > max) {
        stop();
        return;
      }
      opts.onChange(next);
      tick();
    }, intervalMs);
  }

  function play(): void {
    playing = true;
    playBtn.setAttribute('aria-pressed', 'true');
    playBtn.setAttribute('aria-label', '自動で進めるのを止める');
    icon.setAttribute('d', PAUSE_PATH);
    tick();
  }

  const ac = new AbortController();
  input.addEventListener(
    'input',
    () => {
      if (playing) stop();
      opts.onChange(Number(input.value));
    },
    { signal: ac.signal },
  );
  playBtn.addEventListener(
    'click',
    () => {
      if (playing) {
        stop();
        return;
      }
      if (current >= max) opts.onChange(min);
      play();
    },
    { signal: ac.signal },
  );

  render(opts.year);

  return {
    update: render,
    stop,
    destroy() {
      stop();
      ac.abort();
      el.replaceChildren();
    },
  };
}
