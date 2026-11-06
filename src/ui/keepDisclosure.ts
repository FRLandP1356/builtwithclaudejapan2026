// The disclosure 「この目安に届くには」 on its own table row under a facility that is below the guide (facilityPanel.ts
// builds one row per facility, shows it only while the town is below that facility's guide, and keeps one open at a
// time). Opened, it shows the people needed for the 50% and 80% guides, the what-if for the 50% guide (keepGuide.ts)
// and one button that hands the what-if to the map overlay the allocation panel already draws.
//
// The body is built the first time it is opened and then only has its text changed (a year step keeps the keyboard
// focus on the button). Nothing is computed while closed. All text comes from keepGuide.ts; this file is the DOM.
import type { Facility } from '../engine/types';
import type { PopulationAt } from './allocationCore';
import {
  computeKeep,
  KEEP_APPLIED,
  KEEP_BUTTON,
  KEEP_FAILED,
  KEEP_LIMITS,
  KEEP_SUMMARY,
  KEEP_TOO_LARGE,
  KEEP_TOP_LEAD,
  keepEffectLine,
  keepNeedLines,
  keepOverlay,
  keepPremise,
  keepTopText,
  type KeepComputation,
} from './keepGuide';
import { phraseNodes } from './phrases';
import { badgeFor } from './sources';
import type { AllocationOverlay } from './state';

/** What the disclosure needs about the town and the year on screen; supplied by the town panel on every update. */
export interface KeepContext {
  /** The town (5-digit area code). */
  areaCode: string;
  /** The selected year. */
  year: number;
  /** The town's name, for the label of the map overlay. */
  place: string;
  /** Every area's population in `year` under the current assumptions: the numbers the facility table is judged on. */
  populations(): PopulationAt;
  /** Hand the what-if to the map (the allocation overlay); true when the map took it. */
  reflect(overlay: AllocationOverlay): boolean;
}

export interface KeepRow {
  /** The table row (hidden unless the town is below this facility's guide). */
  row: HTMLTableRowElement;
  details: HTMLDetailsElement;
  /** Show the row with this context (the town is below the guide), or hide and close it (undefined). */
  sync(ctx: KeepContext | undefined): void;
}

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** On a phone the map is above the panels: after the button, bring it into view (as the AI panel does for its links). */
function revealMap(): void {
  const map = document.querySelector('.map-column');
  if (!map || typeof map.scrollIntoView !== 'function') return;
  if (map.getBoundingClientRect().top < 0) map.scrollIntoView({ block: 'start' });
}

interface Body {
  root: HTMLElement;
  year: HTMLElement;
  needs: HTMLElement;
  what: HTMLElement;
  premise: HTMLElement;
  effect: HTMLElement;
  topLead: HTMLElement;
  top: HTMLElement;
  actions: HTMLElement;
  button: HTMLButtonElement;
  status: HTMLElement;
  error: HTMLElement;
}

function buildBody(facility: Facility): Body {
  const root = h('div', 'facility-keep-body');
  const year = h('p', 'note facility-keep-year');
  const needs = h('dl', 'facility-keep-needs');
  const what = h('div', 'facility-keep-what');
  const premise = h('p', 'facility-keep-premise');
  const effect = h('p', 'facility-keep-effect');
  const topLead = h('p', 'note facility-keep-top-lead', KEEP_TOP_LEAD);
  topLead.id = `keep-top-${facility.id}`;
  const top = h('ul', 'facility-keep-top');
  top.setAttribute('aria-labelledby', topLead.id);
  const actions = h('div', 'actions facility-keep-actions');
  const button = h('button', 'btn facility-keep-reflect');
  button.type = 'button';
  // The visible words come first, so a voice command by the label works; the rest tells the 48 buttons apart.
  button.append(KEEP_BUTTON, h('span', 'sr-only', `（${facility.name}の目安に届いた場合の計算）`));
  const status = h('p', 'note facility-keep-status');
  status.setAttribute('role', 'status');
  actions.append(button, status);
  what.append(premise, effect, topLead, top, actions);
  const error = h('p', 'notice facility-keep-error', KEEP_TOO_LARGE);
  const limits = h('p', 'note facility-keep-limits');
  limits.replaceChildren(...phraseNodes(KEEP_LIMITS));
  root.append(year, needs, what, error, limits);
  return { root, year, needs, what, premise, effect, topLead, top, actions, button, status, error };
}

/**
 * The row for one facility. `facilities` is the whole list: the what-if reads every facility's flips, not only this
 * one's. The row starts hidden and closed.
 */
export function createKeepRow(facility: Facility, facilities: Facility[]): KeepRow {
  const row = h('tr', 'facility-keep-row');
  row.hidden = true;
  row.dataset.keepFor = facility.id;
  const cell = h('td', 'facility-keep-cell');
  cell.colSpan = 2;
  const details = h('details', 'facility-keep');
  const summary = h('summary');
  // The words on the screen are 「この目安に届くには」; the facility's name follows for a screen reader only.
  summary.append(KEEP_SUMMARY, h('span', 'sr-only', `（${facility.name}）`));
  details.append(summary);
  cell.append(details);
  row.append(cell);

  let ctx: KeepContext | undefined;
  let body: Body | undefined;
  let current: { at: PopulationAt; computation: KeepComputation } | undefined;
  let version = 0; // counts the contexts received; a body painted for an older one is stale
  let painted = -1;

  function paint(): void {
    if (!ctx || !body) return;
    painted = version;
    const at = ctx.populations();
    const computation = computeKeep(at, facilities, facility, ctx.areaCode);
    if (!computation) {
      current = undefined;
      return;
    }
    current = { at, computation };
    const b = body;
    const badge = badgeFor(ctx.year);
    const mark = h('span', badge.estimate ? 'badge-estimate' : 'badge-official', badge.text);
    b.year.replaceChildren(`${ctx.year}年の人口で計算　`, mark);
    b.needs.replaceChildren(
      ...keepNeedLines(facility, computation.needs).map((line) => {
        const item = h('div', 'facility-keep-need');
        item.append(h('dt', undefined, line.label), h('dd', undefined, line.value));
        return item;
      }),
    );
    // A new calculation: what the button said last time is no longer about these numbers.
    if (b.status.textContent !== '') b.status.textContent = '';
    const outcome = computation.outcome;
    if (outcome.kind === 'too-large') {
      // Focus on the button that is about to go away would be lost: keep it on the summary.
      if (b.what.contains(document.activeElement)) summary.focus({ preventScroll: true });
      b.what.hidden = true;
      b.error.hidden = false;
      return;
    }
    b.error.hidden = true;
    b.what.hidden = false;
    b.premise.replaceChildren(...phraseNodes(keepPremise(facility, outcome.people)));
    b.effect.replaceChildren(...phraseNodes(keepEffectLine(outcome.effects)));
    const hasTop = outcome.effects.top.length > 0;
    b.topLead.hidden = !hasTop;
    b.top.hidden = !hasTop;
    b.top.replaceChildren(
      ...outcome.effects.top.map((loss) => {
        const li = h('li', 'facility-keep-top-item');
        li.append(h('span', 'keep', keepTopText(loss)));
        return li;
      }),
    );
  }

  function opened(): void {
    if (!ctx) return;
    if (!body) {
      body = buildBody(facility);
      body.button.addEventListener('click', () => {
        if (!ctx || !current || current.computation.outcome.kind !== 'ok') return;
        const overlay = keepOverlay(current.computation.outcome, current.at, facilities, ctx.year, ctx.place, facility.id);
        const done = ctx.reflect(overlay);
        body!.status.textContent = done ? KEEP_APPLIED : KEEP_FAILED;
        if (done) revealMap();
      });
      details.append(body.root);
    }
    if (painted !== version) paint();
  }

  // A mouse or the keyboard opens through the summary's click (the body is ready before it shows); a script, or a
  // browser opening the details itself, only fires `toggle`.
  summary.addEventListener('click', () => {
    if (!details.open) opened();
  });
  details.addEventListener('toggle', () => {
    if (details.open) opened();
  });

  return {
    row,
    details,
    sync(next) {
      ctx = next;
      if (!next) {
        row.hidden = true;
        if (details.open) details.open = false;
        return;
      }
      row.hidden = false;
      version++;
      if (details.open) opened();
    },
  };
}
