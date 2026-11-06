// Famous places and things, one short fact each, listed by town (public/data/landmarks.json). The file is optional:
// the app runs without it. An item says what is in a town and where, with its source; it never says what becomes of it.
// Pure: the shape check the loader applies, and the indexes by prefecture and by town that the board's section reads.

export interface Landmark {
  id: string;
  /** The name as written in the file (shown as is). */
  name: string;
  /** One of the file's kinds, e.g. 神社, 城, 世界遺産. Shown as text, never as a colour. */
  kind: string;
  /** Prefecture code, the first two digits of `areaCode`. */
  prefCode: string;
  /** Area code of the town; a ward for a designated city and for Tokyo. */
  areaCode: string;
  /** One sentence, as written in the file (shown as is). */
  summary: string;
  /** Where the fact comes from. Linked only when it is an https URL. */
  source: string;
  sourceLabel: string;
}

export interface LandmarkIndex {
  /** Prefecture code -> its items, in the file's order. */
  byPref: ReadonlyMap<string, readonly Landmark[]>;
  /** Area code -> its items, in the file's order. */
  byArea: ReadonlyMap<string, readonly Landmark[]>;
}

export const LANDMARKS_VERSION = 1;

const FIELDS = ['id', 'name', 'kind', 'prefCode', 'areaCode', 'summary', 'source', 'sourceLabel'] as const;

function isItem(v: unknown): v is Landmark {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return FIELDS.every((k) => typeof o[k] === 'string' && (o[k] as string).length > 0);
}

/**
 * The items of a landmarks file whose town the app knows, in the file's order. Throws a TypeError when the file is not
 * `{ version: 1, items: [...] }`. An item that is not in shape, whose prefCode is not the head of its areaCode, or whose
 * areaCode names no known area is dropped silently; a repeated id keeps its first item.
 */
export function parseLandmarks(raw: unknown, knownArea: (code: string) => boolean): Landmark[] {
  if (typeof raw !== 'object' || raw === null) throw new TypeError('landmarks: not an object');
  const o = raw as Record<string, unknown>;
  if (o.version !== LANDMARKS_VERSION) throw new TypeError(`landmarks: version must be ${LANDMARKS_VERSION}, got ${String(o.version)}`);
  if (!Array.isArray(o.items)) throw new TypeError('landmarks: items must be an array');
  const out: Landmark[] = [];
  const seen = new Set<string>();
  for (const v of o.items as unknown[]) {
    if (!isItem(v)) continue;
    if (v.areaCode.slice(0, 2) !== v.prefCode || !knownArea(v.areaCode)) continue;
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push({
      id: v.id,
      name: v.name,
      kind: v.kind,
      prefCode: v.prefCode,
      areaCode: v.areaCode,
      summary: v.summary,
      source: v.source,
      sourceLabel: v.sourceLabel,
    });
  }
  return out;
}

function push(map: Map<string, Landmark[]>, key: string, item: Landmark): void {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
}

/** The items grouped by prefecture and by town, each group in the file's order. */
export function indexLandmarks(items: readonly Landmark[]): LandmarkIndex {
  const byPref = new Map<string, Landmark[]>();
  const byArea = new Map<string, Landmark[]>();
  for (const l of items) {
    push(byPref, l.prefCode, l);
    push(byArea, l.areaCode, l);
  }
  return { byPref, byArea };
}

/** The items of a prefecture or a town; none for the whole country or an unknown key. */
export function landmarksOf(index: LandmarkIndex, level: 'japan' | 'pref' | 'area', key: string): readonly Landmark[] {
  if (level === 'pref') return index.byPref.get(key) ?? [];
  if (level === 'area') return index.byArea.get(key) ?? [];
  return [];
}
