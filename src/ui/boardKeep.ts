// 「ここを残すには」 under a row of the board (boardPanel.ts): the choice made visible. For the row's town, facility and
// year it shows, side by side, what the town would need to reach the guide (people moving in) and what that costs
// elsewhere (the same number of people leaving every other town in proportion, and the towns that then fall below
// some facility's guide). The two sides are the same length because the country's population does not change: one
// side cannot grow without the other shrinking. One button hands the what-if to the map, as the town panel's
// disclosure does (keepGuide.ts does the computing and most of the wording; this file adds the two-sided figure).
//
// It states the trade; it never says which side to choose: 「どこかを残すと、別のどこかが目安を下回ります。選ぶのはあなたです。」
import type { AppData } from '../data/loader';
import type { Facility } from '../engine/types';
import { populationAt, type PopulationAt } from './allocationCore';
import type { BoardRow } from './board';
import { approxPeople, formatPeople } from './format';
import { computeKeep, KEEP_APPLIED, KEEP_BUTTON, KEEP_FAILED, KEEP_LIMITS, KEEP_TOO_LARGE, keepEffectLine, keepOverlay, keepTopText, type KeepComputation } from './keepGuide';
import { phraseNodes } from './phrases';
import { badgeFor } from './sources';
import type { Store } from './state';

// ---------------------------------------------------------------------------------------------------------------
// Wording (pure)
// ---------------------------------------------------------------------------------------------------------------

export const BOARD_KEEP_SUMMARY = 'ここを残すには';
export const BOARD_KEEP_SIDE_KEEP = 'ここを残すには';
export const BOARD_KEEP_SIDE_COST = '代わりに';
/** The one line that names the trade and leaves the choice to the reader. */
export const BOARD_KEEP_CHOICE = 'どこかを残すと、別のどこかが目安を下回ります。選ぶのはあなたです。';
/**
 * Said instead when the moved people push no other town below a guide (most rows: a few hundred people are small next to
 * the other towns' populations). The sentence must stay true there too: the total does not change, so what one town gains
 * another loses; it does not claim that something falls below.
 */
export const BOARD_KEEP_CHOICE_QUIET = '人口の合計は変わらないので、ここを増やした分は、ほかの町で減ります。どこを増やすかは、あなたが選びます。';
export const BOARD_KEEP_TOP_LEAD = '下回る町がいちばん多い施設';
/** Said when, in the row's year, the town is not below the guide after all (a changed calculation): nothing to show. */
export const BOARD_KEEP_NOT_BELOW = 'この年の人口では、この施設の目安を下回っていません。';

/** 「田辺市が、2035年に（施設の名前）の人口の目安（5,000人）に届くには」 */
export function keepLead(town: string, year: number, f: Pick<Facility, 'name' | 'p50'>): string {
  return `${town}が、${year}年に${f.name}の人口の目安（${formatPeople(f.p50)}）に届くには`;
}

export interface BalanceSide {
  title: string;
  /** 「+約360人」 / 「−約360人」 */
  amount: string;
  /** Who the people are. */
  who: string;
}

/** The two sides of the figure: the same number of people, into the town and out of every other town. */
export function balanceSides(town: string, people: number): [BalanceSide, BalanceSide] {
  const n = approxPeople(people);
  return [
    { title: BOARD_KEEP_SIDE_KEEP, amount: `+${n}`, who: `${town}に、ほかの町から移ってくる人` },
    { title: BOARD_KEEP_SIDE_COST, amount: `−${n}`, who: 'ほかの町から、人口に比例して減る人' },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------------

/** What every disclosure of the board shares. */
export interface BoardKeepContext {
  data: Pick<AppData, 'areas' | 'groups'>;
  facilities: Facility[];
  store: Store;
  /** The plain name of a town (the row's name may carry its prefecture). */
  areaName(code: string): string | undefined;
  /** Close every other open disclosure of the board. */
  closeOthers(except: BoardKeep): void;
  /**
   * The one line 「この町にある有名なもの：…」 for the row's town (landmarks.ts), or undefined when it has none. Listed after
   * the body as a fact about the town; it is not tied to the row's facility.
   */
  landmarkLine?(code: string): string | undefined;
}

export interface BoardKeep {
  details: HTMLDetailsElement;
  destroy(): void;
}

type Tag = keyof HTMLElementTagNameMap;
function h<K extends Tag>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** On a phone the map is above the panels: after the button, bring it into view (as the town panel's disclosure does). */
function revealMap(): void {
  const map = document.querySelector('.map-column');
  if (!map || typeof map.scrollIntoView !== 'function') return;
  if (map.getBoundingClientRect().top < 0) map.scrollIntoView({ block: 'start' });
}

interface Body {
  root: HTMLElement;
  lead: HTMLElement;
  figure: HTMLElement;
  sides: Array<{ amount: HTMLElement; who: HTMLElement }>;
  effect: HTMLElement;
  topLead: HTMLElement;
  top: HTMLElement;
  choice: HTMLElement;
  actions: HTMLElement;
  button: HTMLButtonElement;
  status: HTMLElement;
  message: HTMLElement;
}

function buildBody(row: BoardRow, landmarkLine: string | undefined): Body {
  const root = h('div', 'board-keep-body');
  const lead = h('p', 'board-keep-lead');
  const figure = h('div', 'board-balance');
  const sides = [BOARD_KEEP_SIDE_KEEP, BOARD_KEEP_SIDE_COST].map((title, i) => {
    const side = h('div', `board-balance-side ${i === 0 ? 'is-keep' : 'is-cost'}`);
    const titleEl = h('h4', 'board-balance-title', title);
    const amount = h('p', 'board-balance-amount');
    const bar = h('span', `board-balance-bar ${i === 0 ? 'is-gain' : 'is-loss'}`);
    bar.setAttribute('aria-hidden', 'true');
    const who = h('p', 'board-balance-who');
    side.append(titleEl, amount, bar, who);
    return { side, amount, who };
  });
  figure.append(...sides.map((s) => s.side));
  const effect = h('p', 'board-keep-effect');
  const topLead = h('p', 'note board-keep-top-lead', BOARD_KEEP_TOP_LEAD);
  topLead.id = `board-keep-top-${row.year}-${row.facilityId}-${row.leadCode}`;
  const top = h('ul', 'board-keep-top');
  top.setAttribute('aria-labelledby', topLead.id);
  const choice = h('p', 'board-keep-choice');
  choice.replaceChildren(...phraseNodes(BOARD_KEEP_CHOICE));
  const actions = h('div', 'actions board-keep-actions');
  const button = h('button', 'btn board-keep-reflect');
  button.type = 'button';
  button.append(KEEP_BUTTON, h('span', 'sr-only', `（${row.leadName}が${row.facilityName}の目安に届いた場合の計算）`));
  const status = h('p', 'note board-keep-status');
  status.setAttribute('role', 'status');
  actions.append(button, status);
  const message = h('p', 'notice board-keep-message');
  message.hidden = true;
  const limits = h('p', 'note board-keep-limits');
  limits.replaceChildren(...phraseNodes(KEEP_LIMITS));
  root.append(lead, figure, effect, topLead, top, choice, actions, message, limits);
  if (landmarkLine !== undefined) {
    const landmarks = h('p', 'note board-keep-landmarks');
    landmarks.replaceChildren(...phraseNodes(landmarkLine));
    root.append(landmarks);
  }
  return { root, lead, figure, sides, effect, topLead, top, choice, actions, button, status, message };
}

/**
 * The disclosure for one row. The body is built the first time it is opened and the numbers are computed then, for the
 * row's year under the assumptions on screen (the panel rebuilds its rows, and so these, when the assumptions change).
 */
export function createBoardKeep(row: BoardRow, ctx: BoardKeepContext): BoardKeep {
  const facility = ctx.facilities.find((f) => f.id === row.facilityId);
  const details = h('details', 'board-keep');
  const summary = h('summary');
  summary.append(BOARD_KEEP_SUMMARY, h('span', 'sr-only', `（${row.leadName}・${row.facilityName}）`));
  details.append(summary);
  const town = ctx.areaName(row.leadCode) ?? row.leadName;

  let body: Body | undefined;
  let current: { at: PopulationAt; computation: KeepComputation } | undefined;

  function paint(): void {
    if (!body || !facility) return;
    const b = body;
    const at = populationAt(ctx.data, ctx.store.get().series, row.year);
    const computation = computeKeep(at, ctx.facilities, facility, row.leadCode);
    const badge = badgeFor(row.year);
    b.lead.replaceChildren(...phraseNodes(keepLead(town, row.year, facility)));
    if (badge.estimate) b.lead.append(' ', h('span', 'badge-estimate', badge.text));
    const show = (figure: boolean, message: string | undefined) => {
      b.figure.hidden = !figure;
      b.effect.hidden = !figure;
      b.choice.hidden = !figure;
      b.actions.hidden = !figure;
      b.message.hidden = message === undefined;
      b.message.textContent = message ?? '';
      if (!figure) {
        b.topLead.hidden = true;
        b.top.hidden = true;
      }
    };
    if (!computation) {
      current = undefined;
      show(false, BOARD_KEEP_NOT_BELOW);
      return;
    }
    current = { at, computation };
    const outcome = computation.outcome;
    if (outcome.kind === 'too-large') {
      show(false, KEEP_TOO_LARGE);
      return;
    }
    show(true, undefined);
    const sides = balanceSides(town, outcome.people);
    sides.forEach((s, i) => {
      b.sides[i].amount.textContent = s.amount;
      b.sides[i].who.textContent = s.who;
    });
    b.effect.replaceChildren(...phraseNodes(keepEffectLine(outcome.effects)));
    b.choice.replaceChildren(...phraseNodes(outcome.effects.areaCount > 0 ? BOARD_KEEP_CHOICE : BOARD_KEEP_CHOICE_QUIET));
    const hasTop = outcome.effects.top.length > 0;
    b.topLead.hidden = !hasTop;
    b.top.hidden = !hasTop;
    b.top.replaceChildren(
      ...outcome.effects.top.map((loss) => {
        const li = h('li', 'board-keep-top-item');
        li.append(h('span', 'keep', keepTopText(loss)));
        return li;
      }),
    );
    if (b.status.textContent !== '') b.status.textContent = '';
  }

  function opened(): void {
    if (!body) {
      body = buildBody(row, ctx.landmarkLine?.(row.leadCode));
      body.button.addEventListener('click', () => {
        if (!current || !facility || current.computation.outcome.kind !== 'ok') return;
        // The map shows the what-if for the row's year: the year moves there with the overlay, in one patch.
        const overlay = keepOverlay(current.computation.outcome, current.at, ctx.facilities, row.year, town, facility.id);
        const done = ctx.store.set({ year: row.year, allocation: overlay });
        body!.status.textContent = done ? KEEP_APPLIED : KEEP_FAILED;
        if (done) revealMap();
      });
      details.append(body.root);
      paint();
    }
  }

  summary.addEventListener('click', () => {
    if (!details.open) opened();
  });
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    opened();
    ctx.closeOthers(keep);
  });

  const keep: BoardKeep = {
    details,
    destroy() {
      details.remove();
    },
  };
  return keep;
}
