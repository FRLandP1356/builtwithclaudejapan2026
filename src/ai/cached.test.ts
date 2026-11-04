import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { findCached, loadCachedAnswers, normalizeQuestion, SAMPLE_QUESTIONS } from './cached';
import type { CachedAnswer, CachedAnswers } from './cached';

const JSON_FILE = fileURLToPath(new URL('../../public/data/cached_answers.json', import.meta.url));

function entry(overrides: Partial<CachedAnswer> = {}): CachedAnswer {
  return {
    id: 'q1',
    question: '日本の人口が減り出してから、東京はどうなっていますか？',
    answer: '東京都の人口は…',
    trace: [],
    status: 'verified',
    ...overrides,
  };
}

function cacheOf(...answers: CachedAnswer[]): CachedAnswers {
  return { version: 1, answers };
}

describe('normalizeQuestion', () => {
  it('normalizes_full_width_question_mark: ？ and ? are the same', () => {
    expect(normalizeQuestion('東京はどうなっていますか？')).toBe(normalizeQuestion('東京はどうなっていますか?'));
    expect(normalizeQuestion('東京はどうなっていますか？')).toBe('東京はどうなっていますか');
  });

  it('strips_trailing_punctuation: ？ ? 。 ！ . and repeated marks, but keeps a trailing percent sign', () => {
    expect(normalizeQuestion('東京の人口は。')).toBe('東京の人口は');
    expect(normalizeQuestion('東京の人口は？？')).toBe('東京の人口は');
    expect(normalizeQuestion('東京の人口は！')).toBe('東京の人口は');
    expect(normalizeQuestion('How many people?')).toBe('how many people');
    expect(normalizeQuestion('人口を10%')).toBe('人口を10%');
    expect(normalizeQuestion('人口を10％')).toBe('人口を10%');
  });

  it('trims_and_collapses_spaces: ASCII, full-width and no-break spaces become one space', () => {
    expect(normalizeQuestion('  東京の　人口は   どう？  ')).toBe('東京の 人口は どう');
    expect(normalizeQuestion('東京の  人口')).toBe('東京の 人口');
    expect(normalizeQuestion('\n東京の人口\n')).toBe('東京の人口');
  });

  it('applies_nfkc_and_lower_cases_ascii_only: full-width digits and letters fold, Japanese is untouched', () => {
    expect(normalizeQuestion('３，０００人を下回る町は？')).toBe('3,000人を下回る町は');
    expect(normalizeQuestion('ＡＩ Tokyo')).toBe('ai tokyo');
    expect(normalizeQuestion('ｱｲｳ')).toBe('アイウ');
  });

  it('returns_empty_for_blank_or_punctuation_only_input', () => {
    expect(normalizeQuestion('')).toBe('');
    expect(normalizeQuestion('  ？ ')).toBe('');
  });
});

describe('findCached', () => {
  it('matches_exact_question_after_normalization', () => {
    const cache = cacheOf(entry());
    expect(findCached(cache, '日本の人口が減り出してから、東京はどうなっていますか?')?.id).toBe('q1');
    expect(findCached(cache, ' 日本の人口が減り出してから、東京はどうなっていますか。 ')?.id).toBe('q1');
  });

  it('is_exact_not_fuzzy: a different question does not match', () => {
    const cache = cacheOf(entry());
    expect(findCached(cache, '東京はどうなっていますか？')).toBeNull();
    expect(findCached(cache, '日本の人口が減り出してから、大阪はどうなっていますか？')).toBeNull();
  });

  it('ignores_pending: only verified entries are returned', () => {
    const cache = cacheOf(entry({ status: 'pending', answer: '' }));
    expect(findCached(cache, entry().question)).toBeNull();
  });

  it('skips_a_pending_entry_and_finds_a_later_verified_one_with_the_same_question', () => {
    const cache = cacheOf(entry({ id: 'a', status: 'pending', answer: '' }), entry({ id: 'b' }));
    expect(findCached(cache, entry().question)?.id).toBe('b');
  });

  it('ignores_a_verified_entry_with_an_empty_answer', () => {
    expect(findCached(cacheOf(entry({ answer: '  ' })), entry().question)).toBeNull();
  });

  it('returns_null_for_a_missing_cache_or_a_blank_question', () => {
    expect(findCached(null, entry().question)).toBeNull();
    expect(findCached(cacheOf(entry({ question: '' })), '')).toBeNull();
    expect(findCached(cacheOf(entry()), '？')).toBeNull();
  });
});

describe('loadCachedAnswers', () => {
  const GOOD = cacheOf(entry());

  function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
    return vi.fn<typeof fetch>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), init));
  }

  it('fetches_the_file_under_the_base_url_and_returns_the_parsed_cache', async () => {
    const fetchFn = respond(GOOD);
    const loaded = await loadCachedAnswers(fetchFn);
    expect(loaded).toEqual(GOOD);
    const url = vi.mocked(fetchFn).mock.calls[0]![0];
    expect(String(url)).toBe(`${import.meta.env.BASE_URL}data/cached_answers.json`);
  });

  it('uses_a_custom_url', async () => {
    const fetchFn = respond(GOOD);
    await loadCachedAnswers(fetchFn, '/elsewhere/cached.json');
    expect(String(vi.mocked(fetchFn).mock.calls[0]![0])).toBe('/elsewhere/cached.json');
  });

  it('returns_null_when_fetch_rejects', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await loadCachedAnswers(fetchFn)).toBeNull();
  });

  it('returns_null_on_a_non_ok_status', async () => {
    expect(await loadCachedAnswers(respond('not found', { status: 404 }))).toBeNull();
  });

  it('returns_null_on_invalid_json_or_a_wrong_shape', async () => {
    expect(await loadCachedAnswers(respond('<html>spa fallback</html>'))).toBeNull();
    expect(await loadCachedAnswers(respond({ version: 2, answers: [] }))).toBeNull();
    expect(await loadCachedAnswers(respond({ version: 1 }))).toBeNull();
    expect(await loadCachedAnswers(respond([]))).toBeNull();
    expect(await loadCachedAnswers(respond(null))).toBeNull();
  });

  it('drops_malformed_entries_and_keeps_the_good_ones', async () => {
    const loaded = await loadCachedAnswers(
      respond({ version: 1, answers: [entry(), { id: 5 }, null, entry({ id: 'q2', status: 'weird' as never })] }),
    );
    expect(loaded?.answers.map((a) => a.id)).toEqual(['q1']);
  });
});

describe('SAMPLE_QUESTIONS and public/data/cached_answers.json', () => {
  const file = JSON.parse(readFileSync(JSON_FILE, 'utf8')) as CachedAnswers;

  it('has_exactly_the_five_sample_questions_in_order', () => {
    expect(SAMPLE_QUESTIONS).toEqual([
      '日本の人口が減り出してから、東京はどうなっていますか？',
      '田辺市の2100年の子どもの数は、何人くらいですか？',
      '和歌山県の人口を10%増やすと、ほかの地域はどうなりますか？',
      '人口が3,000人を下回る町は、2100年に何町ありますか？',
      '公式の推計と、このアプリの試算は、どう違いますか？',
    ]);
  });

  it('json_has_one_entry_per_sample_question_with_ids_q1_to_q5', () => {
    expect(file.version).toBe(1);
    expect(file.answers).toHaveLength(SAMPLE_QUESTIONS.length);
    file.answers.forEach((a, i) => {
      expect(a.id).toBe(`q${i + 1}`);
      expect(a.question).toBe(SAMPLE_QUESTIONS[i]);
    });
  });

  it('json_entries_are_placeholders_until_real_answers_are_generated', () => {
    for (const a of file.answers) {
      expect(a.answer).toBe('');
      expect(a.trace).toEqual([]);
      expect(a.status).toBe('pending');
      expect(a.note).toBe('Generated from real Claude answers after the API credit is granted; see docs');
    }
    // A pending placeholder must never be served.
    for (const q of SAMPLE_QUESTIONS) expect(findCached(file, q)).toBeNull();
  });

  it('loads_the_real_file_through_loadCachedAnswers', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(readFileSync(JSON_FILE, 'utf8')));
    const loaded = await loadCachedAnswers(fetchFn);
    expect(loaded?.answers.map((a) => a.id)).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });
});

describe('loadCachedAnswers: trace items', () => {
  const respond = (body: unknown): typeof fetch => vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));

  it('keeps_a_well_formed_trace', async () => {
    const trace = [{ tool: 'get_series', input: { areaCode: '13' }, result: { rows: [{ year: 2020 }] } }];
    const loaded = await loadCachedAnswers(respond({ version: 1, answers: [entry({ trace })] }));
    expect(loaded?.answers[0]?.trace).toEqual(trace);
  });

  it('drops_an_entry_whose_trace_has_a_malformed_item', async () => {
    const answers = [
      entry({ id: 'a', trace: [{ tool: 'get_series', input: {}, result: {} }] }),
      entry({ id: 'b', trace: [{ tool: 5, input: {}, result: {} }] as never }),
      entry({ id: 'c', trace: [{ input: {}, result: {} }] as never }),
      entry({ id: 'd', trace: [{ tool: 'x', result: {} }] as never }),
      entry({ id: 'e', trace: [{ tool: 'x', input: {} }] as never }),
      entry({ id: 'f', trace: ['get_series'] as never }),
      entry({ id: 'g', trace: [null] as never }),
    ];
    const loaded = await loadCachedAnswers(respond({ version: 1, answers }));
    expect(loaded?.answers.map((a) => a.id)).toEqual(['a']);
  });

  it('accepts_null_input_and_result_values', async () => {
    const trace = [{ tool: 'count_areas', input: null, result: null }];
    const loaded = await loadCachedAnswers(respond({ version: 1, answers: [entry({ trace })] }));
    expect(loaded?.answers[0]?.trace).toEqual(trace);
  });
});
