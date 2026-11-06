// Facility panel of the town panel: every service facility of the MLIT table (48 rows), judged against the town's
// projected population in the selected year. Wording is a fact about the population guide, never advice and never a
// forecast of closures: 「人口の目安を上回る」 / 「境目」 / 「人口の目安を下回る」.
//
// `evaluateFacilities` and friends are pure; `mountFacilityPanel` builds the DOM once and then only changes the tags,
// the summary line and the notes (so a year change never re-creates the 48 rows). Facilities are looked up by `id`
// only (Ruling 16), and the population given in is used unrounded (facilityStatus compares it as is).
//
// A facility that is below the guide gets a second row with the disclosure 「この目安に届くには」 (keepDisclosure.ts):
// not for a town in a metropolitan area, where the table is only a reference, and one open at a time.
import { facilityStatus, type Status } from '../engine/facilities';
import type { Facility } from '../engine/types';
import { createKeepRow, type KeepContext, type KeepRow } from './keepDisclosure';
import { isMetroPref } from './metro';
import { phraseNodes } from './phrases';
import { ESTIMATE_BADGE, ESTIMATE_NOTE } from './sources';

export const PERMANENT_NOTE = '国土交通省の表（2009〜2012年の統計、三大都市圏を除く）にもとづく人口の目安です。施設の閉鎖を予測するものではありません。';
export const METRO_NOTE = 'この町は三大都市圏にあるため、表の対象外です。参考として表示します。';
export const INFRA_NOTE = 'インフラ連動の過疎の加速（仮定）が有効です。施設が目安を下回ると転出が増える前提で計算しています。';
export const GUIDE_LEAD = '人口の目安は、その施設がある自治体の割合が50%、80%になる人口規模です。';

export interface StatusView {
  label: string;
  /** Class attribute of the tag (theme.css: .tag .tag-ok / .tag-edge / .tag-below). */
  tagClass: string;
}

const STATUS_VIEW: Record<Status, StatusView> = {
  ok: { label: '人口の目安を上回る', tagClass: 'tag tag-ok' },
  edge: { label: '境目', tagClass: 'tag tag-edge' },
  below: { label: '人口の目安を下回る', tagClass: 'tag tag-below' },
};

export function statusView(s: Status): StatusView {
  return STATUS_VIEW[s];
}

const people = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });

/** The guide in pieces that must not be split across lines: ["目安：1,500人（50%）", "〜 2,500人（80%）"]; one piece when p50 equals p80. */
export function guideParts(f: Pick<Facility, 'p50' | 'p80'>): string[] {
  if (f.p50 === f.p80) return [`目安：${people.format(f.p50)}人`];
  return [`目安：${people.format(f.p50)}人（50%）`, `〜 ${people.format(f.p80)}人（80%）`];
}

/** 「目安：1,500人（50%）〜 2,500人（80%）」; a single number when the two thresholds are equal. */
export function guideText(f: Pick<Facility, 'p50' | 'p80'>): string {
  return guideParts(f).join('');
}

export interface FacilityRow {
  id: string;
  name: string;
  essential: boolean;
  status: Status;
  guide: string;
  guideParts: string[];
}

export interface FacilityEvaluation {
  /** The facilities the app treats as essential (8), in data order. */
  essential: FacilityRow[];
  /** All the others (40), in data order. */
  others: FacilityRow[];
  total: number;
  okCount: number;
  edgeCount: number;
  belowCount: number;
}

/** Judge every facility against `pop` (the unrounded projected total) and split them into the two lists. */
export function evaluateFacilities(pop: number, facilities: readonly Facility[]): FacilityEvaluation {
  const essential: FacilityRow[] = [];
  const others: FacilityRow[] = [];
  let okCount = 0;
  let edgeCount = 0;
  let belowCount = 0;
  for (const f of facilities) {
    const status = facilityStatus(pop, f);
    if (status === 'ok') okCount++;
    else if (status === 'edge') edgeCount++;
    else belowCount++;
    (f.essential ? essential : others).push({ id: f.id, name: f.name, essential: f.essential, status, guide: guideText(f), guideParts: guideParts(f) });
  }
  return { essential, others, total: facilities.length, okCount, edgeCount, belowCount };
}

/** The summary in two phrases: ["全48種類のうち", "29種類が目安を下回ります"]. */
export function summaryParts(belowCount: number, total: number): string[] {
  if (belowCount === 0) return [`全${total}種類のうち、`, '目安を下回るものはありません'];
  return [`全${total}種類のうち`, `${belowCount}種類が目安を下回ります`];
}

export function summaryLine(belowCount: number, total: number): string {
  return summaryParts(belowCount, total).join('');
}

export interface FacilityNotes {
  /** The town is in a metropolitan area, which the MLIT table excludes. */
  metro: boolean;
  /** The scenario speeds up depopulation when facilities fall below the guide. */
  infra: boolean;
}

export function facilityNotes(opts: { prefCode: string; infraStrength: number }): FacilityNotes {
  return { metro: isMetroPref(opts.prefCode), infra: opts.infraStrength > 0 };
}

// ---------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------

export interface FacilityPanelInput {
  /** Unrounded projected population of the town in `year`. */
  pop: number;
  year: number;
  prefCode: string;
  infraStrength: number;
  /** The year is after 2050: the figures are this app's estimate. */
  estimate: boolean;
  /** Used in the accessible names: 「田辺市」. */
  place: string;
  /**
   * What the disclosure under each below-the-guide facility needs (the town, its populations, the map). Without it,
   * and for a town in a metropolitan area, no disclosure is offered.
   */
  keep?: KeepContext;
}

export interface FacilityPanelView {
  update(input: FacilityPanelInput): void;
  destroy(): void;
}

interface Table {
  wrap: HTMLDivElement;
  caption: HTMLTableCaptionElement;
}

interface RowEls {
  tr: HTMLTableRowElement;
  tag: HTMLSpanElement;
  status: Status | undefined;
  keep: KeepRow;
}

export function mountFacilityPanel(host: HTMLElement, facilities: readonly Facility[]): FacilityPanelView {
  const title = document.createElement('h3');
  title.className = 'panel-section-title';
  const titleText = document.createTextNode('施設の目安');
  const badge = document.createElement('span');
  badge.className = 'badge-estimate';
  badge.textContent = ESTIMATE_BADGE;
  title.append(titleText);

  const summary = document.createElement('p');
  summary.className = 'facility-summary';
  const notices = document.createElement('div');
  notices.className = 'facility-notices';
  const lead = document.createElement('p');
  lead.className = 'note';
  lead.replaceChildren(...phraseNodes(GUIDE_LEAD));

  const metroNotice = notice('notice', METRO_NOTE);
  const infraNotice = notice('notice notice-estimate', INFRA_NOTE);
  const estimateNotice = notice('notice notice-estimate', ESTIMATE_NOTE);

  const rows = new Map<string, RowEls>();
  const facilityList = [...facilities];
  const facilityById = new Map(facilityList.map((f) => [f.id, f] as const));
  let keepTown: string | undefined; // the town the open disclosures belong to
  const ev0 = evaluateFacilities(0, facilities);
  const essentialTable = buildTable(ev0.essential, '日々の暮らしに関わる主な施設');
  const othersTable = buildTable(ev0.others, 'その他の施設');

  const essentialTitle = document.createElement('h4');
  essentialTitle.className = 'facility-group-title';
  essentialTitle.textContent = `日々の暮らしに関わる主な施設（${ev0.essential.length}種類）`;
  const others = document.createElement('details');
  others.className = 'facility-others';
  const othersSummary = document.createElement('summary');
  othersSummary.textContent = `その他の施設（${ev0.others.length}）`;
  others.append(othersSummary, othersTable.wrap);

  const permanent = document.createElement('p');
  permanent.className = 'note facility-note';
  permanent.replaceChildren(...phraseNodes(PERMANENT_NOTE));

  host.append(title, summary, notices, lead, essentialTitle, essentialTable.wrap, others, permanent);

  function notice(cls: string, text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    d.replaceChildren(...phraseNodes(text));
    return d;
  }

  function buildTable(list: FacilityRow[], captionText: string): Table {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const table = document.createElement('table');
    table.className = 'data-table facility-table';
    const cap = document.createElement('caption');
    cap.className = 'sr-only';
    cap.textContent = captionText;
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th scope="col">施設</th><th scope="col">人口の目安との比較</th></tr>';
    const body = document.createElement('tbody');
    for (const r of list) {
      const tr = document.createElement('tr');
      tr.dataset.facilityId = r.id;
      const th = document.createElement('th');
      th.scope = 'row';
      const name = document.createElement('span');
      name.className = 'facility-name';
      name.textContent = r.name;
      const guide = document.createElement('span');
      guide.className = 'note facility-guide';
      guide.replaceChildren(...phraseNodes(r.guideParts));
      th.append(name, guide);
      const td = document.createElement('td');
      const tag = document.createElement('span');
      td.append(tag);
      tr.append(th, td);
      const keep = createKeepRow(facilityById.get(r.id)!, facilityList);
      // One disclosure open at a time: opening another closes the rest.
      keep.details.addEventListener('toggle', () => {
        if (!keep.details.open) return;
        for (const other of rows.values()) if (other.keep !== keep && other.keep.details.open) other.keep.details.open = false;
      });
      body.append(tr, keep.row);
      rows.set(r.id, { tr, tag, status: undefined, keep });
    }
    table.append(cap, head, body);
    wrap.append(table);
    return { wrap, caption: cap };
  }

  function setTag(id: string, status: Status, keep: KeepContext | undefined): void {
    const el = rows.get(id);
    if (!el) return;
    if (el.status !== status) {
      const v = statusView(status);
      el.tag.className = v.tagClass;
      el.tag.textContent = v.label;
      el.status = status;
    }
    // The disclosure follows the status: only a facility below the guide has one.
    const offered = status === 'below' ? keep : undefined;
    el.keep.sync(offered);
    el.tr.classList.toggle('has-keep', offered !== undefined);
  }

  return {
    update(input) {
      const ev = evaluateFacilities(input.pop, facilities);
      const notes = facilityNotes({ prefCode: input.prefCode, infraStrength: input.infraStrength });
      // The guide comes from towns outside the three metropolitan areas: there the table is a reference, with no
      // "how many more people" beside it.
      const keep = notes.metro ? undefined : input.keep;
      if (keep?.areaCode !== keepTown) {
        // Another town: nothing stays open from the last one.
        for (const el of rows.values()) if (el.keep.details.open) el.keep.details.open = false;
        keepTown = keep?.areaCode;
      }
      for (const r of ev.essential) setTag(r.id, r.status, keep);
      for (const r of ev.others) setTag(r.id, r.status, keep);
      summary.replaceChildren(...phraseNodes(summaryParts(ev.belowCount, ev.total)));
      notices.replaceChildren(...[notes.metro && metroNotice, input.estimate && estimateNotice, notes.infra && infraNotice].filter((n): n is HTMLDivElement => n !== false));
      if (input.estimate && !badge.isConnected) title.append(' ', badge);
      if (!input.estimate && badge.isConnected) {
        badge.previousSibling?.remove();
        badge.remove();
      }
      essentialTable.caption.textContent = `${input.place}の${input.year}年、日々の暮らしに関わる主な施設`;
      othersTable.caption.textContent = `${input.place}の${input.year}年、その他の施設`;
    },
    destroy() {
      host.replaceChildren();
    },
  };
}
