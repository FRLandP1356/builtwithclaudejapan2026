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
  '田辺市の2100年の子どもの数は、何人くらいですか？',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps only the fields we know, so a hand-edited or stale file cannot put anything else into the page. */
function readEntry(raw: unknown): CachedAnswer | null {
  if (!isRecord(raw)) return null;
  const { id, question, answer, trace, status, generatedAt, note } = raw;
  if (typeof id !== 'string' || typeof question !== 'string' || typeof answer !== 'string') return null;
  if (!Array.isArray(trace) || (status !== 'pending' && status !== 'verified')) return null;
  const entry: CachedAnswer = { id, question, answer, trace: trace as TraceItem[], status };
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
