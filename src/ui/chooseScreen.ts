// The third screen, 「どこかに人を残すと、別のどこかが残せなくなります。」: the choice made visible, once, for the earliest row of the
// board of the place on screen. Left, the people the town would need to reach its guide (「ここを残すには ＋約93人」); right,
// the same number of people leaving the other towns (「代わりに、ほかの町から −約93人」); under them, the one line that the two
// are one number (the country's population does not change), what that costs elsewhere, and the button that hands the
// what-if to the map. The numbers are the board's own (`computeKeep`, the same as 「ここを残すには」 under a row); nothing
// here is typed in. It states the trade and never says which side to choose.
//
// Where the place has no row of its own (a prefecture or a town with nothing newly below a guide), the earliest row of the
// whole country is the example, and the screen says so in small type. Built once; a new place or new assumptions redraw it.
import type { Facility } from '../engine/types';
import { populationAt, type PopulationAt } from './allocationCore';
import { BOARD_NONE, type BoardRow } from './board';
import { balanceSides, BOARD_KEEP_NOT_BELOW, keepLead, revealMap } from './boardKeep';
import { deriveTotals } from './derive';
import { computeKeep, KEEP_APPLIED, KEEP_BUTTON, KEEP_FAILED, KEEP_TOO_LARGE, keepEffectLine, keepOverlay, type KeepComputation } from './keepGuide';
import { phraseNodes } from './phrases';
import { boardFirstRow, CHOOSE_COST_TITLE, CHOOSE_EXAMPLE, CHOOSE_KEEP_TITLE, CHOOSE_SAME, japanScope } from './screens';
import { badgeFor } from './sources';
import type { AppState, PanelContext } from './state';
import { resolveScope } from './townPanel';

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const mounted = new WeakMap<HTMLElement, () => void>();

/** Fill `el` (the card of the third screen) and keep it in step with the place and the assumptions. Returns the teardown. */
export function mountChooseScreen(el: HTMLElement, ctx: PanelContext): () => void {
  mounted.get(el)?.();
  const { store, data } = ctx;
  const areaByCode = new Map(data.areas.map((a) => [a.code, a] as const));
  const names = { area: (c: string) => areaByCode.get(c)?.name, prefOfArea: (c: string) => areaByCode.get(c)?.prefName };

  const root = h('div', 'choose');
  const example = h('p', 'note choose-example', CHOOSE_EXAMPLE);
  const lead = h('p', 'choose-lead');
  const figure = h('div', 'choose-figure');
  const sides = [CHOOSE_KEEP_TITLE, CHOOSE_COST_TITLE].map((title, i) => {
    const side = h('div', `choose-side ${i === 0 ? 'is-keep' : 'is-cost'}`);
    const amount = h('p', 'choose-amount');
    const bar = h('span', `choose-bar ${i === 0 ? 'is-gain' : 'is-loss'}`);
    bar.setAttribute('aria-hidden', 'true');
    const who = h('p', 'choose-who');
    side.append(h('p', 'choose-side-title', title), amount, bar, who);
    return { side, amount, who };
  });
  figure.append(sides[0].side, sides[1].side);
  const same = h('p', 'choose-same', CHOOSE_SAME);
  const effect = h('p', 'choose-effect');
  const actions = h('div', 'actions choose-actions');
  const button = h('button', 'btn btn-primary choose-reflect', KEEP_BUTTON);
  button.type = 'button';
  const status = h('p', 'note choose-status');
  status.setAttribute('role', 'status');
  actions.append(button, status);
  const message = h('p', 'notice choose-message');
  message.hidden = true;
  root.append(example, lead, figure, same, effect, actions, message);
  el.append(root);

  let current: { row: BoardRow; facility: Facility; town: string; at: PopulationAt; computation: KeepComputation } | undefined;

  function showMessage(text: string): void {
    current = undefined;
    for (const n of [lead, figure, same, effect, actions]) n.hidden = true;
    message.textContent = text;
    message.hidden = false;
  }

  function render(s: AppState): void {
    const totals = deriveTotals(s.series, data.groups);
    const scope = resolveScope(data, s, areaByCode);
    let first = boardFirstRow(data, totals, s.series, scope, names);
    let isExample = scope.level === 'japan';
    if (!first.row && scope.level !== 'japan') {
      first = boardFirstRow(data, totals, s.series, japanScope(data, areaByCode), names);
      isExample = true;
    }
    example.hidden = !isExample;
    status.textContent = '';
    const row = first.row;
    const facility = row ? data.facilities.find((f) => f.id === row.facilityId) : undefined;
    if (!row || !facility) return showMessage(BOARD_NONE);
    const town = areaByCode.get(row.leadCode)?.name ?? row.leadName;
    const at = populationAt(data, s.series, row.year);
    const computation = computeKeep(at, data.facilities, facility, row.leadCode);
    if (!computation) return showMessage(BOARD_KEEP_NOT_BELOW);
    if (computation.outcome.kind !== 'ok') return showMessage(KEEP_TOO_LARGE);
    const outcome = computation.outcome;
    current = { row, facility, town, at, computation };
    message.hidden = true;
    for (const n of [lead, figure, same, effect, actions]) n.hidden = false;
    lead.replaceChildren(...phraseNodes(keepLead(row.leadName, row.year, facility)));
    const b = badgeFor(row.year);
    if (b.estimate) lead.append(' ', h('span', 'badge-estimate', b.text));
    balanceSides(row.leadName, outcome.people).forEach((side, i) => {
      sides[i].amount.textContent = side.amount;
      sides[i].who.textContent = side.who;
    });
    effect.replaceChildren(...phraseNodes(keepEffectLine(outcome.effects)));
  }

  button.addEventListener('click', () => {
    const c = current;
    if (!c || c.computation.outcome.kind !== 'ok') return;
    // The map shows the what-if for the row's year: the year moves there with the overlay, in one patch.
    const overlay = keepOverlay(c.computation.outcome, c.at, data.facilities, c.row.year, c.town, c.facility.id);
    const done = store.set({ year: c.row.year, allocation: overlay });
    status.textContent = done ? KEEP_APPLIED : KEEP_FAILED;
    if (done) revealMap();
  });

  render(store.get());
  const unsubscribe = store.subscribe((s, prev) => {
    if (s.selectedArea !== prev.selectedArea || s.selectedPref !== prev.selectedPref || s.series !== prev.series) render(s);
  });

  const teardown = () => {
    if (mounted.get(el) === teardown) mounted.delete(el);
    unsubscribe();
    root.remove();
  };
  mounted.set(el, teardown);
  return teardown;
}
