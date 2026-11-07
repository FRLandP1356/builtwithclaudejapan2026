// "いま、この規模の市町村は、1人あたりこれだけ使っています": a block of the town panel for a town (not a prefecture or
// Japan). It shows ACTUALS of 令和6年度 (municipal expenditure per resident), never a forecast: the town's own figure,
// the band of today's municipalities that is as large as this town is in the selected year (median and the middle half),
// a strip of the seven bands, and the numbers in a table. The year only chooses the band; the 試算 / 公式推計 mark sits on
// the population in the year line, never on the money.
//
// Built once; an update rewrites text and marks only (the table disclosure keeps its open or closed state, which is DOM
// state and not in the store).
import type { Finance } from '../data/finance';
import type { AreaKind } from '../engine/types';
import {
  BURDEN_TEXT,
  bandFor,
  bandLabel,
  bandParts,
  barRows,
  formatThousandYen,
  leadText,
  nationalText,
  ownFigure,
  sourceParts,
  TITLE_PARTS,
  yearParts,
} from './burden';
import { formatCount } from './format';
import { phraseNodes } from './phrases';
import { badgeFor } from './sources';

export interface BurdenInput {
  /** 5-digit area code. */
  code: string;
  kind: AreaKind;
  year: number;
  /** The projected population of the town in `year` (unrounded), the same number the facility table judges. */
  population: number;
}

export interface BurdenView {
  update(input: BurdenInput): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function textCell(tag: 'th' | 'td', text: string, className?: string): HTMLTableCellElement {
  const c = el(tag, className, text);
  if (tag === 'th') c.scope = 'col';
  return c;
}

/** The "この町の規模" mark, shown in the row of the town's band (text, so the mark does not rest on colour alone). */
function hereMark(): HTMLSpanElement {
  const s = el('span', 'burden-here', BURDEN_TEXT.here);
  s.hidden = true;
  return s;
}

/** `titleHost`: where the h3 goes (the summary of the folded section in the town panel); the rest goes into `host`. */
export function mountBurdenPanel(host: HTMLElement, finance: Finance, titleHost: HTMLElement = host): BurdenView {
  const title = el('h3', 'panel-section-title');
  title.replaceChildren(...phraseNodes(TITLE_PARTS));
  const lead = el('p', 'note burden-lead');
  lead.replaceChildren(...phraseNodes(leadText(finance)));

  const own = el('p', 'burden-own');
  const year = el('p', 'note burden-year');
  const badge = el('span');
  const band = el('p', 'burden-band');

  // The strip: one row per band, bar length = the median, the town's band marked in the accent colour and in words.
  const figure = el('figure', 'chart-figure burden-figure');
  const stripTitle = el('p', 'note burden-strip-title', BURDEN_TEXT.stripTitle);
  const bars = el('ul', 'burden-bars');
  bars.setAttribute('aria-label', BURDEN_TEXT.stripName);
  const rows = barRows(finance);
  const barItems = rows.map((r) => {
    const li = el('li', 'burden-bar');
    li.style.setProperty('--burden-w', `${r.widthPct.toFixed(2)}%`);
    const label = el('span', 'burden-label', r.label);
    const here = hereMark();
    label.append(' ', here);
    const track = el('span', 'burden-track');
    track.setAttribute('aria-hidden', 'true');
    track.append(el('span', 'burden-fill'));
    li.append(label, track, el('span', 'burden-value', formatThousandYen(r.median)));
    bars.append(li);
    return { li, here };
  });
  figure.append(stripTitle, bars);

  const limits = el('p', 'note burden-limits');
  limits.replaceChildren(...phraseNodes(BURDEN_TEXT.limits));
  const source = el('p', 'note burden-source');
  source.replaceChildren(...phraseNodes(sourceParts(finance)));

  // The numbers in a table, and the published table of another year and another classification.
  const details = el('details', 'chart-table burden-table');
  details.append(el('summary', undefined, BURDEN_TEXT.tableSummary));
  const tableUnit = el('p', 'note burden-table-unit', BURDEN_TEXT.tableUnit);
  const bandWrap = el('div', 'table-wrap');
  const bandTable = el('table', 'data-table burden-band-table');
  bandTable.append(el('caption', 'sr-only', BURDEN_TEXT.tableCaption));
  const head = el('thead');
  const headRow = el('tr');
  BURDEN_TEXT.tableHeads.forEach((h, i) => headRow.append(textCell('th', h, i === 0 ? undefined : 'num')));
  head.append(headRow);
  const body = el('tbody');
  const tableRows = finance.bands.map((b) => {
    const tr = el('tr');
    const th = el('th', undefined, bandLabel(b));
    th.scope = 'row';
    const here = hereMark();
    th.append(' ', here);
    tr.append(
      th,
      el('td', 'num', formatCount(b.n)),
      el('td', 'num', formatThousandYen(b.median)),
      el('td', 'num', `${formatThousandYen(b.p25)}〜${formatThousandYen(b.p75)}`),
    );
    body.append(tr);
    return { tr, here };
  });
  bandTable.append(head, body);
  bandWrap.append(bandTable);
  const national = el('p', 'note burden-national');
  national.replaceChildren(...phraseNodes(nationalText(finance)));

  const pubTitle = el('h4', 'facility-group-title', BURDEN_TEXT.publishedTitle);
  const pubWrap = el('div', 'table-wrap');
  const pubTable = el('table', 'data-table burden-published-table');
  pubTable.append(el('caption', 'sr-only', BURDEN_TEXT.publishedCaption));
  const pubHead = el('thead');
  const pubHeadRow = el('tr');
  BURDEN_TEXT.publishedHeads.forEach((h, i) => pubHeadRow.append(textCell('th', h, i === 0 ? undefined : 'num')));
  pubHead.append(pubHeadRow);
  const pubBody = el('tbody');
  for (const r of finance.published.rows) {
    const tr = el('tr');
    const th = el('th', undefined, r.label);
    th.scope = 'row';
    tr.append(th, el('td', 'num', formatThousandYen(r.perCapita)));
    pubBody.append(tr);
  }
  pubTable.append(pubHead, pubBody);
  pubWrap.append(pubTable);
  const pubNote = el('p', 'note burden-published-note');
  pubNote.replaceChildren(...phraseNodes(BURDEN_TEXT.publishedNote));
  details.append(tableUnit, bandWrap, national, pubTitle, pubWrap, pubNote);

  titleHost.prepend(title);
  host.append(lead, own, year, band, figure, limits, source, details);

  let shown: string | undefined;

  function mark(index: number | undefined): void {
    barItems.forEach((it, i) => {
      const on = i === index;
      it.li.classList.toggle('is-current', on);
      if (on) it.li.setAttribute('aria-current', 'true');
      else it.li.removeAttribute('aria-current');
      it.here.hidden = !on;
    });
    tableRows.forEach((it, i) => {
      const on = i === index;
      it.tr.classList.toggle('is-current', on);
      if (on) it.tr.setAttribute('aria-current', 'true');
      else it.tr.removeAttribute('aria-current');
      it.here.hidden = !on;
    });
  }

  return {
    update(input) {
      const key = `${input.code}|${input.kind}|${input.year}|${Number.isFinite(input.population) ? Math.round(input.population) : 'x'}`;
      if (key === shown) return;
      shown = key;

      const figure = ownFigure(finance, input.code, input.kind);
      own.replaceChildren(...phraseNodes(figure.parts));
      // A sentence saying there is no figure is not a figure: plain text, not the large serif line.
      own.classList.toggle('is-none', figure.value === undefined);

      const index = bandFor(finance, input.population);
      year.hidden = band.hidden = index === undefined;
      if (index === undefined) {
        year.replaceChildren();
        band.replaceChildren();
      } else {
        const b = badgeFor(input.year);
        badge.className = b.estimate ? 'badge-estimate' : 'badge-official';
        badge.textContent = b.text;
        // The mark follows the sentence after a full-width space, as in the other panels (「2100年の人口で計算　試算」).
        year.replaceChildren(...phraseNodes(yearParts(input.year, input.population)), '　', badge);
        band.replaceChildren(...phraseNodes(bandParts(finance.bands[index])));
      }
      mark(index);
    },
    destroy() {
      title.remove();
      host.replaceChildren();
    },
  };
}
