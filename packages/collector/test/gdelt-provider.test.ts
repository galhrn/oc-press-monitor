import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@oc/core';
import {
  GdeltProvider,
  GDELT_MIN_INTERVAL_MS,
  parseSeenDate,
  toGdeltStamp,
  toLanguageCode,
  type NewsProvider,
} from '@oc/collector';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');
const now = (): number => NOW;
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString();

const article = (over: Record<string, unknown> = {}) => ({
  url: 'https://techcrunch.com/hailo-series-d',
  title: 'Hailo raises $180M Series D',
  seendate: '20260728T123000Z',
  domain: 'techcrunch.com',
  language: 'English',
  sourcecountry: 'US',
  ...over,
});

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  }) as unknown as Response;

/** No test in this file may touch the network; every one injects its own fetch. */
const provider = (fetchImpl: typeof fetch, options: Record<string, unknown> = {}): GdeltProvider =>
  new GdeltProvider({
    fetchImpl,
    now,
    minIntervalMs: 0,
    sleep: () => Promise.resolve(),
    retry: { attempts: 3, baseDelayMs: 0, sleep: () => Promise.resolve(), random: () => 0 },
    ...options,
  });

const search = (p: GdeltProvider, over: Record<string, unknown> = {}) =>
  p.search({ query: '"Hailo"', from: daysAgo(90), limit: 25, ...over });

describe('date and language mapping', () => {
  it('formats a window bound the way GDELT expects', () => {
    expect(toGdeltStamp('2026-08-01T12:00:00.000Z')).toBe('20260801120000');
  });

  it('rejects an unparseable window bound instead of sending garbage upstream', () => {
    expect(() => toGdeltStamp('not-a-date')).toThrow(ProviderError);
  });

  it('parses the compact seendate format', () => {
    expect(parseSeenDate('20260728T123000Z')).toBe('2026-07-28T12:30:00.000Z');
    expect(parseSeenDate('20260728123000')).toBe('2026-07-28T12:30:00.000Z');
  });

  it('returns null for a missing or unparseable date rather than throwing', () => {
    // One bad date must cost one item, never the whole company's collection.
    expect(parseSeenDate(undefined)).toBeNull();
    expect(parseSeenDate('banana')).toBeNull();
  });

  it('maps language names to codes and passes unknown ones through untouched', () => {
    expect(toLanguageCode('English')).toBe('en');
    expect(toLanguageCode('hebrew')).toBe('he');
    // A wrong code is worse than an honest unknown.
    expect(toLanguageCode('Klingon')).toBe('Klingon');
    expect(toLanguageCode(undefined)).toBeNull();
  });
});

describe('GdeltProvider.buildUrl', () => {
  it('sends the query verbatim, with the window and the cap', () => {
    const url = new URL(
      provider(vi.fn()).buildUrl({
        query: '"Peak" AND ("decision intelligence" OR "AI")',
        from: daysAgo(90),
        limit: 25,
      }),
    );
    expect(url.searchParams.get('query')).toBe('"Peak" AND ("decision intelligence" OR "AI")');
    expect(url.searchParams.get('mode')).toBe('ArtList');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('maxrecords')).toBe('25');
    expect(url.searchParams.get('startdatetime')).toBe('20260503120000');
    expect(url.searchParams.get('enddatetime')).toBe('20260801120000');
  });

  it('clamps maxrecords to the documented GDELT ceiling of 250', () => {
    const url = new URL(
      provider(vi.fn()).buildUrl({ query: '"x"', from: daysAgo(90), limit: 9999 }),
    );
    expect(url.searchParams.get('maxrecords')).toBe('250');
  });
});

describe('GdeltProvider.search', () => {
  it('satisfies the NewsProvider contract', () => {
    const p: NewsProvider = provider(vi.fn());
    expect(p.name).toBe('gdelt');
  });

  it('maps a response onto RawArticle', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ articles: [article()] })));
    const [item] = await search(provider(fetchImpl as unknown as typeof fetch));

    expect(item).toMatchObject({
      url: 'https://techcrunch.com/hailo-series-d',
      title: 'Hailo raises $180M Series D',
      sourceName: 'techcrunch.com',
      publishedAt: '2026-07-28T12:30:00.000Z',
      language: 'en',
      provider: 'gdelt',
    });
    // DOC 2.0 ArtList carries no snippet; pretending otherwise would mislead A6.
    expect(item?.snippet).toBeNull();
    expect(item?.raw).toMatchObject({ domain: 'techcrunch.com' });
  });

  it('treats an absent articles field as no coverage, not as an error (R5)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({})));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toEqual([]);
  });

  it('drops undated items instead of guessing, like the fixture provider', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          articles: [article(), article({ url: 'https://x.com/a', seendate: 'oops' })],
        }),
      ),
    );
    const items = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(items).toHaveLength(1);
  });

  it('skips items missing a url or title rather than persisting a half-row', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ articles: [article({ title: undefined })] })),
    );
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toEqual([]);
  });

  it('enforces the window itself rather than trusting the remote end', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          articles: [
            article(),
            article({ url: 'https://old.com/a', seendate: '20250101T000000Z' }),
          ],
        }),
      ),
    );
    const items = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(items).toHaveLength(1);
    expect(items[0]?.url).not.toContain('old.com');
  });

  it('returns newest first and honours the per-company cap (A4)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          articles: [
            article({ url: 'https://a.com/1', seendate: '20260710T000000Z' }),
            article({ url: 'https://a.com/2', seendate: '20260730T000000Z' }),
            article({ url: 'https://a.com/3', seendate: '20260720T000000Z' }),
          ],
        }),
      ),
    );
    const items = await search(provider(fetchImpl as unknown as typeof fetch), { limit: 2 });
    expect(items.map((i) => i.url)).toEqual(['https://a.com/2', 'https://a.com/3']);
  });
});

describe('GdeltProvider error handling (R26)', () => {
  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse('rate limited', 429))
      .mockResolvedValueOnce(jsonResponse({ articles: [article()] }));
    const items = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
  });

  it('retries a transport failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(jsonResponse({ articles: [article()] }));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 400 - the same malformed query fails identically', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('bad query', 400)));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).rejects.toThrow(
      ProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-JSON body - GDELT answers a rejected query with HTTP 200 text', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('Your query was too short.')));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).rejects.toThrow(
      /non-JSON/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured attempts and reports a retryable error', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('boom', 503)));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).rejects.toMatchObject({
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('rejects a response whose shape is wrong, without retrying', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ articles: 'not-an-array' })));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).rejects.toThrow(
      /expected shape/,
    );
  });

  it('does not retry a caller-initiated abort - that is a decision, not a fault', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ articles: [] })));
    await expect(
      search(provider(fetchImpl as unknown as typeof fetch), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports unhealthy instead of throwing when the API is down', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse('down', 503)));
    const health = await provider(fetchImpl as unknown as typeof fetch).health();
    expect(health.ok).toBe(false);
  });
});

describe('GdeltProvider throttling', () => {
  it('spaces consecutive requests by minIntervalMs against a keyless API', async () => {
    const slept: number[] = [];
    let clock = NOW;
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ articles: [] })));
    const p = new GdeltProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      minIntervalMs: 1_500,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    await search(p);
    await search(p);
    await search(p);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // The first request goes immediately; each later one waits out the interval.
    expect(slept).toEqual([1_500, 1_500]);
  });

  it('keeps serving later requests after one fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(jsonResponse({ articles: [article()] }));
    const p = provider(fetchImpl as unknown as typeof fetch);

    await expect(search(p)).rejects.toThrow(ProviderError);
    // A broken queue would strand every subsequent company behind the failed one.
    await expect(search(p)).resolves.toHaveLength(1);
  });
});

describe('GdeltProvider defaults', () => {
  it('defaults to the 5s spacing GDELT states in its own 429 body', async () => {
    const slept: number[] = [];
    let clock = NOW;
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({ articles: [] })));
    const p = new GdeltProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });
    await search(p);
    await search(p);
    expect(slept).toEqual([GDELT_MIN_INTERVAL_MS]);
    expect(GDELT_MIN_INTERVAL_MS).toBe(5_000);
  });
});
