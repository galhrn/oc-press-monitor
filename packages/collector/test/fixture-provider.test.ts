import { describe, expect, it } from 'vitest';
import { ProviderError } from '@oc/core';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  containsPhrase,
  parseQuery,
  matchesQuery,
  type NewsProvider,
} from '@oc/collector';

/** Frozen clock: relative fixture dates resolve against this, so results never drift. */
const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const provider = (): FixtureProvider => FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now);

const search = (
  query: string,
  overrides: Partial<{ from: string; to: string; limit: number }> = {},
) => provider().search({ query, from: daysAgo(90), limit: 25, ...overrides });

describe('parseQuery', () => {
  it('reads a bare exact phrase', () => {
    expect(parseQuery('"ZutaCore"')).toEqual({ required: ['ZutaCore'], groups: [] });
  });

  it('separates the required phrase from an OR-group qualifier', () => {
    expect(parseQuery('"Peak" AND ("decision intelligence" OR "supply chain")')).toEqual({
      required: ['Peak'],
      groups: [['decision intelligence', 'supply chain']],
    });
  });

  it('accepts unquoted alternatives inside a group', () => {
    expect(parseQuery('"Innoviz" AND (lidar OR sensor)')).toEqual({
      required: ['Innoviz'],
      groups: [['lidar', 'sensor']],
    });
  });
});

describe('containsPhrase', () => {
  it('matches whole words only', () => {
    expect(containsPhrase('Peak lands new funding', 'Peak')).toBe(true);
    // The single most important line in the pre-filter: substring matching would make
    // every "Peakhurst" and "speaker" a false positive for a CRITICAL-tier name.
    expect(containsPhrase('Peakhurst development approved', 'Peak')).toBe(false);
    expect(containsPhrase('the speaker said', 'Peak')).toBe(false);
  });

  it('is case-insensitive and survives punctuation at the boundary', () => {
    expect(containsPhrase('hailo, the chipmaker', 'Hailo')).toBe(true);
    expect(containsPhrase('"Lemonade" beat expectations', 'lemonade')).toBe(true);
  });

  it('does not treat a regex metacharacter in a company name as a pattern', () => {
    expect(containsPhrase('C.A.T. raised a round', 'C.A.T.')).toBe(true);
    expect(containsPhrase('CxAxTx raised a round', 'C.A.T.')).toBe(false);
  });

  it('requires every term of a multi-term query', () => {
    const parsed = parseQuery('"Peak" AND ("decision intelligence" OR "supply chain")');
    expect(matchesQuery('Peak lands funding for decision intelligence', parsed)).toBe(true);
    expect(matchesQuery('Record climbers reached the peak', parsed)).toBe(false);
  });
});

describe('FixtureProvider', () => {
  it('reports healthy with the corpus size', async () => {
    await expect(provider().health()).resolves.toEqual({
      ok: true,
      detail: expect.stringContaining('fixture items') as unknown as string,
    });
  });

  it('satisfies the NewsProvider contract', () => {
    const p: NewsProvider = provider();
    expect(p.name).toBe('fixture');
  });

  it('returns genuine coverage for a distinctive name', async () => {
    const items = await search('"ZutaCore"');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => /zutacore/i.test(i.title))).toBe(true);
    expect(items[0]?.provider).toBe('fixture');
  });

  it('returns newest first', async () => {
    const items = await search('"SpaceX"');
    const dates = items.map((i) => Date.parse(i.publishedAt ?? ''));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it('honours the per-company cap so a loud company cannot eat the budget (A4)', async () => {
    const all = await search('"SpaceX"');
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(await search('"SpaceX"', { limit: 2 })).toHaveLength(2);
  });

  it('excludes articles outside the rolling window (A1)', async () => {
    const inWindow = await search('"Morphisec"');
    expect(inWindow.some((i) => /Series B/.test(i.title))).toBe(false);

    const wide = await search('"Morphisec"', { from: daysAgo(365) });
    expect(wide.some((i) => /Series B/.test(i.title))).toBe(true);
  });

  it('drops undated items rather than guessing a date', async () => {
    const items = await search('"Cyabra"');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.publishedAt !== null)).toBe(true);
    expect(items.some((i) => /no publication date/.test(i.title))).toBe(false);
  });

  it('still returns the collisions a naive query attracts', async () => {
    // The corpus is only useful if it is honest about noise: this is what the
    // pre-filter (P3.6) and the LLM relevance gate (AD-06) are measured against.
    const naive = await search('"Peak"');
    expect(naive.some((i) => /decision intelligence/i.test(i.title))).toBe(true);
    expect(naive.some((i) => /climbers/i.test(i.title))).toBe(true);
    expect(naive.some((i) => /peak oil/i.test(i.title))).toBe(true);
  });

  it('lets a qualified query remove those collisions', async () => {
    const qualified = await search('"Peak" AND ("decision intelligence" OR "supply chain")');
    expect(qualified).toHaveLength(1);
    expect(qualified[0]?.title).toMatch(/decision intelligence/i);
  });

  it('never matches a name that only appears as a substring', async () => {
    const items = await search('"Peak"');
    expect(items.some((i) => /Peakhurst/.test(i.title))).toBe(false);
  });

  it('keeps the duplicate pair so dedupe has something to collapse in P3.5', async () => {
    const items = await search('"Hailo"');
    const dupes = items.filter((i) => /data centre operator/i.test(i.title));
    expect(dupes).toHaveLength(2);
    expect(new Set(dupes.map((d) => d.url)).size).toBe(2);
  });

  it('preserves language and the untouched provider payload', async () => {
    const items = await search('"ZutaCore"');
    expect(items.some((i) => i.language === 'he')).toBe(true);
    expect(items[0]?.raw).toBeTypeOf('object');
  });

  it('returns an empty array for a company with no coverage, which is not an error (R5)', async () => {
    await expect(search('"Kando"')).resolves.toEqual([]);
  });

  it('throws a typed, non-retryable ProviderError for a malformed corpus path', () => {
    expect(() => FixtureProvider.fromFile('does-not-exist.json')).toThrow(ProviderError);
    try {
      FixtureProvider.fromFile('does-not-exist.json');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).retryable).toBe(false);
    }
  });

  it('rejects an unparseable window instead of silently returning everything', () => {
    expect(() => provider().search({ query: '"Hailo"', from: 'not-a-date', limit: 10 })).toThrow(
      ProviderError,
    );
  });

  it('respects an abort signal', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      provider().search({
        query: '"Hailo"',
        from: daysAgo(90),
        limit: 10,
        signal: controller.signal,
      }),
    ).toThrow();
  });
});
