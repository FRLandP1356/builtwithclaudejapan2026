// Japanese number formatting for the UI. Pure functions; strings here are UI text.

const jp = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 0 });
const DASH = '－';

/** Population: 8,340人 / 4.2万人 / 68.5万人 / 1,190万人 / 1億2,615万人. */
export function formatPop(n: number): string {
  if (!Number.isFinite(n)) return DASH;
  if (n >= 1e8) {
    const oku = Math.floor(n / 1e8);
    const man = Math.round((n - oku * 1e8) / 1e4);
    return man > 0 ? `${oku}億${jp.format(man)}万人` : `${oku}億人`;
  }
  if (n >= 1e6) return `${jp.format(Math.round(n / 1e4))}万人`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万人`;
  return `${jp.format(Math.round(n))}人`;
}

/** Change versus 2020 from a ratio: 0.685 -> −31.5%, 1.025 -> +2.5%, 1 -> ±0.0%. */
export function formatPct(ratio: number): string {
  if (!Number.isFinite(ratio)) return DASH;
  const pct = (ratio - 1) * 100;
  const text = Math.abs(pct).toFixed(1);
  if (text === '0.0') return '±0.0%';
  return `${pct < 0 ? '−' : '+'}${text}%`;
}

export function formatYear(year: number): string {
  return `${year}年`;
}
