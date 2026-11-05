// The three metropolitan areas (Ruling 10): Tokyo (11 Saitama, 12 Chiba, 13 Tokyo, 14 Kanagawa), Nagoya (21 Gifu,
// 23 Aichi, 24 Mie) and Osaka (26 Kyoto, 27 Osaka, 28 Hyogo, 29 Nara), whole prefectures. The MLIT facility table
// excludes them, so a town here is shown against the table only as a reference. Provisional until the wording of the
// MLIT PDF is checked (docs/sources.md).

export const METRO_PREF_CODES: ReadonlySet<string> = new Set(['11', '12', '13', '14', '21', '23', '24', '26', '27', '28', '29']);

/** True when the two-digit prefecture code belongs to one of the three metropolitan areas. */
export function isMetroPref(prefCode: string): boolean {
  return METRO_PREF_CODES.has(prefCode);
}
