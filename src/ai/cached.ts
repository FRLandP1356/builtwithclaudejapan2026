// Saved answers: the five sample questions, answered once with the real model, checked by a person, and shipped as a
// static file. They are shown when the AI cannot be reached (limit reached, outage, offline) and when a visitor taps
// a sample question. A "pending" entry is a placeholder and is never served.
import type { TraceItem } from './client';

export interface CachedAnswer {
  id: string;
  question: string;
  answer: string;
  trace: TraceItem[];
  status: 'pending' | 'verified';
  generatedAt?: string;
  note?: string;
}

export interface CachedAnswers {
  version: 1;
  answers: CachedAnswer[];
}

/** The sample questions, in the order the panel lists them. Ids q1..q5 in cached_answers.json follow this order. */
export const SAMPLE_QUESTIONS: string[] = [
  '日本の人口が減り出してから、東京はどうなっていますか？',
  '田辺市の2100年の人口は何人くらいで、65歳以上は何割ですか？',
  '和歌山県の人口を10%増やすと、ほかの地域はどうなりますか？',
  '人口が3,000人を下回る町は、2100年に何町ありますか？',
  '公式の推計と、このアプリの試算は、どう違いますか？',
];

// What may trail a question without changing what it asks: spaces, ? ! . , ; : (full-width forms are folded by NFKC
// first), the Japanese full stop and comma, ellipses, middle dot and tildes. A percent sign or a closing bracket is
// part of the question and stays.
const TRAILING_MARKS = /[\s?!.,;:。、…‥・~〜]+$/u;

/**
 * The key two questions are compared by: NFKC, spaces collapsed to one, trailing question marks / full stops and
 * similar removed, ASCII letters lower-cased. Japanese text is otherwise left alone (no fuzzy matching).
 */
export function normalizeQuestion(q: string): string {
  const folded = q.normalize('NFKC').replace(/\s+/gu, ' ').trim().replace(TRAILING_MARKS, '');
  return folded.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** A verified answer to exactly this question (after normalizing both), or null. Pending placeholders never match. */
export function findCached(cache: CachedAnswers | null, question: string): CachedAnswer | null {
  if (!cache) return null;
  const key = normalizeQuestion(question);
  if (key === '') return null;
  for (const entry of cache.answers) {
    if (entry.status !== 'verified' || entry.answer.trim() === '') continue;
    if (normalizeQuestion(entry.question) === key) return entry;
  }
  return null;
}

/**
 * The sample questions that have a verified saved answer, in the order they are listed. While every saved answer is
 * still a placeholder this is empty, and nothing may offer or mention saved questions.
 */
export function verifiedSampleQuestions(cache: CachedAnswers | null): string[] {
  return SAMPLE_QUESTIONS.filter((question) => findCached(cache, question) !== null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A trace item is `{ tool: string, input, result }`; input and result may be any JSON (null included) but must be there. */
function readTrace(raw: unknown): TraceItem[] | null {
  if (!Array.isArray(raw)) return null;
  const items: TraceItem[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.tool !== 'string' || !('input' in item) || !('result' in item)) return null;
    items.push({ tool: item.tool, input: item.input, result: item.result });
  }
  return items;
}

/** Keeps only the fields we know, so a hand-edited or stale file cannot put anything else into the page. */
function readEntry(raw: unknown): CachedAnswer | null {
  if (!isRecord(raw)) return null;
  const { id, question, answer, trace: rawTrace, status, generatedAt, note } = raw;
  if (typeof id !== 'string' || typeof question !== 'string' || typeof answer !== 'string') return null;
  const trace = readTrace(rawTrace);
  if (trace === null || (status !== 'pending' && status !== 'verified')) return null;
  const entry: CachedAnswer = { id, question, answer, trace, status };
  if (typeof generatedAt === 'string') entry.generatedAt = generatedAt;
  if (typeof note === 'string') entry.note = note;
  return entry;
}

/**
 * Loads `data/cached_answers.json` from the site's base path. Any failure (offline, 404, a server that answers every
 * path with its index page, an unknown version) gives null: the panel simply has no saved answers.
 */
export async function loadCachedAnswers(
  fetchFn?: typeof fetch,
  url: string = `${import.meta.env.BASE_URL}data/cached_answers.json`,
): Promise<CachedAnswers | null> {
  try {
    const response = await (fetchFn ?? ((input, init) => fetch(input, init)))(url);
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.answers)) return null;
    const answers: CachedAnswer[] = [];
    for (const raw of data.answers) {
      const entry = readEntry(raw);
      if (entry) answers.push(entry);
    }
    return { version: 1, answers };
  } catch {
    return null;
  }
}
