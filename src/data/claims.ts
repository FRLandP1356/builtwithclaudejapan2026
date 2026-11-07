// What published documents say about population decline, quoted word for word, listed by prefecture (public/data/claims.json).
// The file is optional: the app runs without it. A claim is a sentence the document's own publisher wrote, with the document
// it comes from; it is not this app's forecast and it never says that something is decided.
// Pure: the shape check the loader applies, and the index by prefecture that the card's section reads.

/** Whether the quoted sentence states a present fact (numbers, the current state) or a concern or an expectation. */
export type ClaimStance = 'possibility' | 'fact';

export interface Claim {
  id: string;
  /** What the sentence is about, as written in the file (shown as is). */
  subject: string;
  /** One of the file's kinds, e.g. 鉄道, 観光. */
  kind: string;
  /** Prefectures the sentence concerns (two digits each), at least one, in the file's order. */
  prefCodes: string[];
  /** The publisher's sentence, word for word (shown as is, never reworded). */
  quote: string;
  /** A restatement for reading aloud; the screen does not show it. */
  paraphrase: string;
  stance: ClaimStance;
  /** The document the sentence is taken from. Linked only when it is an https URL. */
  source: string;
  /** The publisher and the title of the document. */
  sourceLabel: string;
  /** The document's date: "2026-03-12", "2026-03" or "2026". */
  date: string;
  /** The day the quotation was checked against the document. */
  readOn: string;
}

export interface ClaimIndex {
  /** Prefecture code -> its claims, in the file's order. A claim that concerns several prefectures is in each of them. */
  byPref: ReadonlyMap<string, readonly Claim[]>;
}

export const CLAIMS_VERSION = 1;

const TEXT_FIELDS = ['id', 'subject', 'kind', 'quote', 'paraphrase', 'source', 'sourceLabel', 'date', 'readOn'] as const;

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isItem(v: unknown): v is Claim {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!TEXT_FIELDS.every((k) => isText(o[k]))) return false;
  if (o.stance !== 'possibility' && o.stance !== 'fact') return false;
  return Array.isArray(o.prefCodes) && o.prefCodes.length > 0 && o.prefCodes.every(isText);
}

/**
 * The claims of a claims file whose prefectures the app knows, in the file's order. Throws a TypeError when the file is not
 * `{ version: 1, items: [...] }`. An item that is not in shape, or that names a prefecture the app does not know, is dropped
 * silently (the item is not trimmed to the prefectures that are known: a sentence is shown with all the places it concerns or
 * not at all); a repeated id keeps its first item. A prefecture named twice in one item counts once.
 */
export function parseClaims(raw: unknown, knownPref: (code: string) => boolean): Claim[] {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('claims: not an object');
  const o = raw as Record<string, unknown>;
  if (o.version !== CLAIMS_VERSION) throw new TypeError(`claims: version must be ${CLAIMS_VERSION}, got ${String(o.version)}`);
  if (!Array.isArray(o.items)) throw new TypeError('claims: items must be an array');
  const out: Claim[] = [];
  const seen = new Set<string>();
  for (const v of o.items as unknown[]) {
    if (!isItem(v)) continue;
    if (!v.prefCodes.every(knownPref)) continue;
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({
      id: v.id,
      subject: v.subject,
      kind: v.kind,
      prefCodes: [...new Set(v.prefCodes)],
      quote: v.quote,
      paraphrase: v.paraphrase,
      stance: v.stance,
      source: v.source,
      sourceLabel: v.sourceLabel,
      date: v.date,
      readOn: v.readOn,
    });
  }
  return out;
}

/** The claims grouped by prefecture, each group in the file's order. */
export function indexClaims(items: readonly Claim[]): ClaimIndex {
  const byPref = new Map<string, Claim[]>();
  for (const c of items) {
    for (const p of c.prefCodes) {
      const list = byPref.get(p);
      if (list) list.push(c);
      else byPref.set(p, [c]);
    }
  }
  return { byPref };
}

/** The claims of a prefecture; none for an unknown or empty key. */
export function claimsOfPref(index: ClaimIndex, prefCode: string): readonly Claim[] {
  return index.byPref.get(prefCode) ?? [];
}
