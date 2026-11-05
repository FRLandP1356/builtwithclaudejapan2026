// The three metropolitan areas (Ruling 10): Tokyo (11 Saitama, 12 Chiba, 13 Tokyo, 14 Kanagawa), Nagoya (21 Gifu,
// 23 Aichi, 24 Mie) and Osaka (26 Kyoto, 27 Osaka, 28 Hyogo, 29 Nara), whole prefectures. The MLIT facility table
// excludes them, so a town here is shown against the table only as a reference. Checked against the MLIT PDF
// (docs/sources.md): its note lists exactly these eleven prefectures as 三大都市圏, by prefecture with no exceptions.
// The PDF does not name the three areas separately; the split into Tokyo, Nagoya and Osaka is this app's own.

export const METRO_PREF_CODES: ReadonlySet<string> = new Set(['11', '12', '13', '14', '21', '23', '24', '26', '27', '28', '29']);

/** True when the two-digit prefecture code belongs to one of the three metropolitan areas. */
export function isMetroPref(prefCode: string): boolean {
  return METRO_PREF_CODES.has(prefCode);
}
