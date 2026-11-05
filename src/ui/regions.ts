// Regions of Japan as groups of prefecture codes, for the allocation panel's "take the people from these regions".
// Every prefecture 01..47 belongs to exactly one region (tested). The grouping is a display convenience, not data.

export type RegionId = 'hokkaido' | 'tohoku' | 'kanto' | 'chubu' | 'kinki' | 'chugoku' | 'shikoku' | 'kyushu';

/** North to south, the order the checkboxes are shown in. */
export const REGION_IDS: readonly RegionId[] = ['hokkaido', 'tohoku', 'kanto', 'chubu', 'kinki', 'chugoku', 'shikoku', 'kyushu'];

export const REGION_NAMES: Readonly<Record<RegionId, string>> = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  chubu: '中部',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州・沖縄',
};

function codes(from: number, to: number): readonly string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(2, '0'));
}

export const REGION_PREFS: Readonly<Record<RegionId, readonly string[]>> = {
  hokkaido: codes(1, 1),
  tohoku: codes(2, 7),
  kanto: codes(8, 14),
  chubu: codes(15, 23),
  kinki: codes(24, 30),
  chugoku: codes(31, 35),
  shikoku: codes(36, 39),
  kyushu: codes(40, 47),
};

/** The prefecture codes of the given regions, sorted, without duplicates. */
export function prefCodesOf(ids: Iterable<RegionId>): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const code of REGION_PREFS[id] ?? []) out.add(code);
  return [...out].sort();
}
