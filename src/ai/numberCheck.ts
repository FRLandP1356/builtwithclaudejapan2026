// Check the numbers in a model answer against the numbers the tools actually returned.
//
// checkNumbers(answer, toolResults) returns the substrings of the answer (as written, e.g. "10万", "63.3%", "1.2倍",
// "９９万") that carry a number which is neither exempt nor present in the tool results. It is pure: no DOM, no network.
//
// WHAT COUNTS AS A NUMBER IN THE ANSWER
//   ASCII or full-width digits, thousands commas ("6,328"), decimals ("63.3"), then optionally
//   - a Japanese unit: 万 (1e4), 億 (1e8), 兆 (1e12), 千 (1e3), 千万 (1e7), 百万 (1e6), or a descending chain of them
//     ("1億2,000万", "3万5千", "3万5,000" = tail digits after the last unit). Spaces (ASCII, full-width, no-break)
//     may stand between a number and its unit: "4.2 万人" is 4.2万. Or
//   - "%" / "％" / "パーセント" (spaces allowed before it: "63.3 %"), or "倍" / "割" (a ratio). The returned substring
//     includes the unit, %, 倍 or 割 (and the spaces before a unit or %) but not counter words such as 人 or 円.
//   A number written as a range with the unit only at the end ("40〜50%", "4〜5万人") lends that unit/percent to the
//   first number.
//
// WHEN A NUMBER IS VERIFIED
//   Its value (after applying the unit) is within `tolerance` of a number found anywhere in the tool results, ignoring
//   signs. tolerance = max(half a unit of the last shown digit, 0.5% of the value): "4.2万" shows 0.1万, so it accepts
//   any value within 500 of 42,000 (42,311 passes); "42,000" shows units of 1, so only 0.5% (210) counts and 42,311
//   fails; "4万" accepts 35,000..45,000. Only values present in the results count: sums, differences, percentages
//   computed from shares (0.633 -> 63.3%) and any other arithmetic are NOT inferred.
//   Numbers in the results are: JSON numbers; numbers written inside string values (for example "15,000" in a
//   facility name, or "3万" in a note); strings that are JSON text are parsed first. All-digit strings of 2 or 5 digits
//   are codes (area/prefecture codes), never quantities: they are exempt in the answer (below) and never verify a quantity.
//   Values under the keys `year` and `requestedYear` are ignored: they are years, and must not verify "2,050人".
//
// EXEMPT (never returned), applied in this order to every number in the answer
//   E1  list numbering at the start of a line: "1. ", "2) ", "（3）", "12、" (also after "- ", "* ", "#"). "1.2倍" at the
//       start of a line is a number, not a list item.
//   E2  digits stuck to a letter before them ("p50", "M12", "COVID19", "H22").
//   E3  "第" before the number, and a plain integer followed by one of 年 歳 代 位 番 月 日 章 節 号 条 (so "2050年", "30年間",
//       "令和5年", "65歳以上", "20代", "第3位", "3番目", "11月5日"): years, durations, ages, ordinals, dates.
//   E4  a plain 4-digit integer 1900..2100 not followed by a counter (人 世帯 戸 円 件 軒 台): a year, with or without 年
//       ("2020〜2100", "2009〜2012年"). "2050人" and "2,050人" are quantities and are checked.
//   E5  a plain 2-digit or 5-digit integer equal to a code that appears in the results, not followed by a counter
//       (人 世帯 戸 円 件 軒 台). "田辺市（30206）" passes, "30206人" is checked.
//   E6  a plain integer 0..10: no comma, no decimal point, no unit, no % and no 倍/割 ("3つ", "3町", "10市町村", "7人").
//       "11町" is checked; "3倍", "3割", "5%" and "0.5" are checked.
//   E7  (checked second, after E1) any number inside a date written with / - or . ("2026/11/05", "2026-11-05", "2026.11.05"; three parts, the first
//       with 4 digits). "11/20" is not a date.
//   "Plain" means digits only. Kanji numerals (三万人) are not read.
//   A bad number that is written several times is returned once (first appearance order).

const UNITS: ReadonlyArray<readonly [string, number]> = [
  ['千万', 1e7],
  ['百万', 1e6],
  ['兆', 1e12],
  ['億', 1e8],
  ['万', 1e4],
  ['千', 1e3],
];
const NUM_AT = /(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?/y;
const RANGE_SEPARATOR = /^(?:〜|～|~|-|–|—|−|から)$/;
const COUNTERS = new Set(['人', '世', '戸', '円', '件', '軒', '台']); // 世 = start of 世帯
const LABELS_AFTER = new Set(['年', '歳', '代', '位', '番', '月', '日', '章', '節', '号', '条']);
const TOLERANCE_RELATIVE = 0.005;
const SLACK = 1e-9;
const YEAR_KEYS = new Set(['year', 'requestedYear']);
const MAX_NODES = 200_000;
const MAX_DEPTH = 64;

interface Token {
  start: number;
  end: number;
  mantissa: number; // of the first number, before any unit
  decimals: number; // decimals of the first number
  digits: string; // the first number as written, without its unit
  plain: boolean; // digits only: no comma, decimal point, unit, %, 倍 or 割
  hasUnit: boolean;
  firstMult: number; // multiplier of the first unit, 1 without one
  percent: boolean;
  ratio: boolean;
  value: number; // with units applied (a range can lend its unit later)
  halfUnit: number; // half of the last shown digit, in people (or percent)
  prev: string;
  next: string;
}

/** Map full-width digits, comma, point and percent onto ASCII one code unit at a time, so indices stay aligned. */
function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xff10 && c <= 0xff19) out += String.fromCharCode(c - 0xff10 + 0x30);
    else if (c === 0xff0c) out += ',';
    else if (c === 0xff0e) out += '.';
    else if (c === 0xff05) out += '%';
    else out += s[i];
  }
  return out;
}

interface NumberText {
  text: string;
  value: number;
  decimals: number;
}

function numberAt(t: string, pos: number): NumberText | undefined {
  NUM_AT.lastIndex = pos;
  const m = NUM_AT.exec(t);
  if (!m) return undefined;
  const dot = m[0].indexOf('.');
  return { text: m[0], value: parseFloat(m[0].replace(/,/g, '')), decimals: dot < 0 ? 0 : m[0].length - dot - 1 };
}

function unitAt(t: string, pos: number): readonly [string, number] | undefined {
  for (const u of UNITS) if (t.startsWith(u[0], pos)) return u;
  return undefined;
}

const SPACES = new Set([' ', '\u3000', '\u00a0']);

function skipSpaces(t: string, pos: number): number {
  let p = pos;
  while (SPACES.has(t[p])) p++;
  return p;
}

/** A unit after the number, with optional spaces in between ("4.2 万人"): the unit and the position where it starts. */
function unitAfter(t: string, pos: number): { unit: readonly [string, number]; at: number } | undefined {
  const at = skipSpaces(t, pos);
  const unit = unitAt(t, at);
  return unit ? { unit, at } : undefined;
}

const halfOf = (decimals: number, multiplier: number): number => 0.5 * Math.pow(10, -decimals) * multiplier;

/** Parse the number (with its unit chain, %, 倍 or 割) that starts at `start`; undefined when no number starts there. */
function parseToken(t: string, start: number): Token | undefined {
  const first = numberAt(t, start);
  if (!first) return undefined;
  let pos = start + first.text.length;
  let value = first.value;
  let halfUnit = halfOf(first.decimals, 1);
  let firstMult = 1;
  const firstFound = unitAfter(t, pos);
  const firstUnit = firstFound?.unit;
  if (firstFound && firstUnit) {
    // A chain of "number unit" pieces with falling units, optionally ending in plain tail digits ("3万5,000").
    firstMult = firstUnit[1];
    value = first.value * firstUnit[1];
    halfUnit = halfOf(first.decimals, firstUnit[1]);
    let lastMult = firstUnit[1];
    pos = firstFound.at + firstUnit[0].length;
    for (;;) {
      const piece = numberAt(t, pos);
      if (!piece) break;
      const afterPiece = pos + piece.text.length;
      const found = unitAfter(t, afterPiece);
      const unit = found?.unit;
      if (found && unit && unit[1] < lastMult) {
        value += piece.value * unit[1];
        halfUnit = halfOf(piece.decimals, unit[1]);
        lastMult = unit[1];
        pos = found.at + unit[0].length;
        continue;
      }
      if (!unit) {
        value += piece.value;
        halfUnit = halfOf(piece.decimals, 1);
        pos = afterPiece;
      }
      break;
    }
  }

  let percent = false;
  let ratio = false;
  const sign = skipSpaces(t, pos);
  if (t[sign] === '%') {
    percent = true;
    pos = sign + 1;
  } else if (t.startsWith('パーセント', sign)) {
    percent = true;
    pos = sign + 'パーセント'.length;
  } else if (t[pos] === '倍' || t[pos] === '割') {
    ratio = true;
    pos += 1;
  }
  return {
    start,
    end: pos,
    mantissa: first.value,
    decimals: first.decimals,
    digits: first.text.replace(/,/g, ''),
    plain: !/[,.]/.test(first.text) && !firstUnit && !percent && !ratio,
    hasUnit: firstUnit !== undefined,
    firstMult,
    percent,
    ratio,
    value,
    halfUnit,
    prev: start > 0 ? t[start - 1] : '',
    next: t[skipSpaces(t, pos)] ?? '',
  };
}

/** Every number expression in the folded text, in order. A range's trailing unit or % is lent to its first number. */
function tokenize(t: string): Token[] {
  const tokens: Token[] = [];
  const digit = /\d/g;
  let from = 0;
  for (;;) {
    digit.lastIndex = from;
    const hit = digit.exec(t);
    if (!hit) break;
    const tok = parseToken(t, hit.index);
    if (!tok) {
      from = hit.index + 1;
      continue;
    }
    tokens.push(tok);
    from = Math.max(tok.end, hit.index + 1);
  }
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a.hasUnit || a.percent || a.ratio) continue;
    if (!b.hasUnit && !b.percent) continue;
    if (!RANGE_SEPARATOR.test(t.slice(a.end, b.start))) continue;
    if (b.hasUnit) {
      a.hasUnit = true;
      a.firstMult = b.firstMult;
      a.value = a.mantissa * b.firstMult;
      a.halfUnit = halfOf(a.decimals, b.firstMult);
    }
    if (b.percent) a.percent = true;
    a.plain = false;
  }
  return tokens;
}

/** Start indices of numbers that are list numbering ("1. ", "2) ", "（3）") at the beginning of a line. */
function listNumberStarts(t: string): Set<number> {
  const starts = new Set<number>();
  const re = /^[ \t]*(?:[-*•・][ \t]+)?(?:#+[ \t]+)?(?:(\d{1,3})(?=[.)）、](?!\d))|[（(](\d{1,3})(?=[）)]))/gmd;
  for (const m of t.matchAll(re)) {
    const span = m.indices?.[1] ?? m.indices?.[2];
    if (span) starts.add(span[0]);
  }
  return starts;
}

/** [start, end) ranges of dates written like 2026/11/05, 2026-11-05 or 2026.11.05. */
function dateRanges(t: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of t.matchAll(/(?<!\d)\d{4}[/.-]\d{1,2}[/.-]\d{1,2}(?!\d)/g)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

interface Known {
  values: number[];
  codes: Set<string>;
}

/** All numbers in the tool results (absolute values) and all 2/5-digit code strings. */
function collectKnown(toolResults: unknown): Known {
  const known: Known = { values: [], codes: new Set() };
  const seen = new WeakSet<object>();
  const stack: Array<[unknown, number]> = [];
  if (Array.isArray(toolResults)) for (const r of toolResults) stack.push([r, 0]);
  else if (toolResults !== undefined && toolResults !== null) stack.push([toolResults, 0]);
  let nodes = 0;
  while (stack.length > 0 && nodes < MAX_NODES) {
    const [node, depth] = stack.pop()!;
    nodes++;
    switch (typeof node) {
      case 'number':
        if (Number.isFinite(node)) known.values.push(Math.abs(node));
        break;
      case 'bigint':
        known.values.push(Math.abs(Number(node)));
        break;
      case 'string': {
        const s = node.trim();
        if (/^(?:\d{2}|\d{5})$/.test(s)) {
          known.codes.add(s);
        } else if (/^[[{]/.test(s) && depth < MAX_DEPTH) {
          let parsed: unknown;
          let ok = false;
          try {
            parsed = JSON.parse(s);
            ok = true;
          } catch {
            ok = false;
          }
          if (ok) stack.push([parsed, depth + 1]);
          else for (const tk of tokenize(fold(node))) known.values.push(Math.abs(tk.value));
        } else {
          for (const tk of tokenize(fold(node))) known.values.push(Math.abs(tk.value));
        }
        break;
      }
      case 'object': {
        if (node === null || seen.has(node) || depth >= MAX_DEPTH) break;
        seen.add(node);
        // Fields named year / requestedYear hold years, which must never verify a quantity such as "2,050人".
        const children = Array.isArray(node)
          ? node
          : Object.entries(node as Record<string, unknown>).filter(([k]) => !YEAR_KEYS.has(k)).map(([, v]) => v);
        for (const c of children) stack.push([c, depth + 1]);
        break;
      }
      default:
        break;
    }
  }
  return known;
}

function isExempt(tok: Token, listStarts: Set<number>, dates: Array<[number, number]>, codes: Set<string>): boolean {
  // E1 list numbering
  if (listStarts.has(tok.start)) return true;
  // E7 part of a date written with / - or .
  if (dates.some(([from, to]) => tok.start >= from && tok.start < to)) return true;
  // E2 stuck to a letter before the digits
  if (/[A-Za-z_]/.test(tok.prev)) return true;
  // E3 ordinals, years, durations, ages, dates
  if (tok.prev === '第') return true;
  const integer = tok.decimals === 0 && !tok.hasUnit && !tok.percent && !tok.ratio;
  if (integer && LABELS_AFTER.has(tok.next)) return true;
  if (!tok.plain) return false;
  // E4 a year written as 4 plain digits
  if (tok.digits.length === 4 && tok.mantissa >= 1900 && tok.mantissa <= 2100 && !COUNTERS.has(tok.next)) return true;
  // E5 a code that appears in the results
  if ((tok.digits.length === 2 || tok.digits.length === 5) && codes.has(tok.digits) && !COUNTERS.has(tok.next)) return true;
  // E6 a small plain integer
  return tok.mantissa >= 0 && tok.mantissa <= 10;
}

function isVerified(tok: Token, values: number[]): boolean {
  const tolerance = Math.max(tok.halfUnit, TOLERANCE_RELATIVE * Math.abs(tok.value));
  const limit = tolerance + SLACK * Math.max(1, Math.abs(tok.value));
  for (const v of values) if (Math.abs(v - tok.value) <= limit) return true;
  return false;
}

export function checkNumbers(answer: string, toolResults: unknown[]): { unverified: string[] } {
  const text = typeof answer === 'string' ? answer : '';
  if (text.length === 0) return { unverified: [] };
  const t = fold(text);
  const tokens = tokenize(t);
  if (tokens.length === 0) return { unverified: [] };
  const known = collectKnown(toolResults);
  const listStarts = listNumberStarts(t);
  const dates = dateRanges(t);
  const bad: string[] = [];
  const reported = new Set<string>();
  for (const tok of tokens) {
    if (isExempt(tok, listStarts, dates, known.codes)) continue;
    if (isVerified(tok, known.values)) continue;
    const written = text.slice(tok.start, tok.end);
    if (!reported.has(written)) {
      reported.add(written);
      bad.push(written);
    }
  }
  return { unverified: bad };
}
