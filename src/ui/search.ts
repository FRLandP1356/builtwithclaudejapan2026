// Place search: a combobox over prefecture and area names with keyboard selection.
import { searchPlaces, type SearchEntry } from './nav';

export interface SearchOptions {
  index: ReadonlyArray<SearchEntry>;
  onPick(entry: SearchEntry): void;
  limit?: number;
}

export interface Search {
  destroy(): void;
}

let uid = 0;

/** True while a Japanese IME is composing: the key event belongs to the IME, not to the list. */
function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

export function mountSearch(el: HTMLElement, opts: SearchOptions): Search {
  const id = `place-search-${++uid}`;
  const limit = opts.limit ?? 8;
  el.className = 'search';
  el.innerHTML = `
    <label class="sr-only" for="${id}">町名や県名で探す</label>
    <input id="${id}" type="search" class="search-input" placeholder="町名・県名で探す" autocomplete="off"
      role="combobox" aria-expanded="false" aria-controls="${id}-list" aria-autocomplete="list" aria-haspopup="listbox"
      enterkeyhint="search" />
    <ul id="${id}-list" class="search-list" role="listbox" aria-label="候補" hidden></ul>
    <p class="search-empty" role="status" hidden></p>`;

  const input = el.querySelector<HTMLInputElement>('input')!;
  const list = el.querySelector<HTMLUListElement>('ul')!;
  const empty = el.querySelector<HTMLParagraphElement>('.search-empty')!;
  let results: SearchEntry[] = [];
  let active = -1;

  function close(): void {
    list.hidden = true;
    list.replaceChildren();
    empty.hidden = true;
    empty.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    results = [];
    active = -1;
  }

  function setActive(i: number): void {
    active = i;
    list.querySelectorAll<HTMLLIElement>('[role="option"]').forEach((li, idx) => {
      li.setAttribute('aria-selected', String(idx === i));
    });
    if (i >= 0) {
      input.setAttribute('aria-activedescendant', `${id}-opt-${i}`);
      list.children[i]?.scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  function pick(entry: SearchEntry): void {
    input.value = '';
    close();
    opts.onPick(entry);
  }

  function render(): void {
    const q = input.value;
    results = searchPlaces(q, opts.index, limit);
    if (!q.trim()) {
      close();
      return;
    }
    if (!results.length) {
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      empty.textContent = '見つかりませんでした';
      empty.hidden = false;
      active = -1;
      return;
    }
    empty.hidden = true;
    empty.textContent = '';
    list.replaceChildren(
      ...results.map((r, i) => {
        const li = document.createElement('li');
        li.className = 'search-item';
        li.id = `${id}-opt-${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.dataset.idx = String(i);
        const name = document.createElement('span');
        name.textContent = r.name;
        const where = document.createElement('span');
        where.className = 'search-item-where';
        where.textContent = r.kind === 'pref' ? '都道府県' : (r.prefName ?? '');
        li.append(name, where);
        return li;
      }),
    );
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }

  const ac = new AbortController();
  const sig = { signal: ac.signal };
  input.addEventListener('input', render, sig);
  input.addEventListener(
    'keydown',
    (e) => {
      if (isComposing(e)) return; // the IME owns Enter, arrows and Escape until the conversion is committed
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (list.hidden) render();
        if (!results.length) return;
        e.preventDefault();
        const n = results.length;
        setActive(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
      } else if (e.key === 'Enter') {
        if (!results.length) return;
        e.preventDefault();
        pick(results[active >= 0 ? active : 0]);
      } else if (e.key === 'Escape') {
        if (list.hidden) input.value = '';
        close();
      }
    },
    sig,
  );
  input.addEventListener('focus', () => input.value && render(), sig);
  list.addEventListener(
    'pointerdown',
    (e) => {
      // keep focus in the input so the list does not close before the click lands
      e.preventDefault();
    },
    sig,
  );
  list.addEventListener(
    'click',
    (e) => {
      const li = (e.target as Element).closest<HTMLLIElement>('[data-idx]');
      if (!li) return;
      const entry = results[Number(li.dataset.idx)];
      if (entry) pick(entry);
    },
    sig,
  );
  el.addEventListener(
    'focusout',
    (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      close();
    },
    sig,
  );

  return {
    destroy() {
      ac.abort();
      el.replaceChildren();
    },
  };
}
