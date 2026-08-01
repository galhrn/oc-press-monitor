import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProviderError } from '@oc/core';
import {
  GOOGLE_NEWS_MIN_INTERVAL_MS,
  GOOGLE_NEWS_SAMPLE_PATH,
  GoogleNewsProvider,
  parsePubDate,
  publisherDomain,
  stripPublisherSuffix,
  type NewsProvider,
} from '@oc/collector';

/** A real feed captured from Google News on 2026-08-02. */
const REAL_FEED = readFileSync(GOOGLE_NEWS_SAMPLE_PATH, 'utf8');

const NOW = Date.parse('2026-08-02T12:00:00.000Z');
const now = (): number => NOW;
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString();

const xmlResponse = (body: string, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  }) as unknown as Response;

const feed = (items: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title>${items}</channel></rss>`;

const item = (over: Partial<Record<string, string>> = {}): string => `<item>
  <title>${over.title ?? 'Hailo raises $180M Series D - TechCrunch'}</title>
  <link>${over.link ?? 'https://news.google.com/rss/articles/CBMiABC?oc=5'}</link>
  <guid isPermaLink="false">CBMiABC</guid>
  <pubDate>${over.pubDate ?? 'Wed, 29 Jul 2026 07:00:00 GMT'}</pubDate>
  <description>&lt;a href="https://news.google.com/x"&gt;Hailo&lt;/a&gt;</description>
  <source url="${over.sourceUrl ?? 'https://www.techcrunch.com'}">${over.source ?? 'TechCrunch'}</source>
</item>`;

const provider = (fetchImpl: typeof fetch, options: Record<string, unknown> = {}) =>
  new GoogleNewsProvider({
    fetchImpl,
    now,
    minIntervalMs: 0,
    sleep: () => Promise.resolve(),
    retry: { attempts: 3, baseDelayMs: 0, sleep: () => Promise.resolve(), random: () => 0 },
    ...options,
  });

const search = (p: GoogleNewsProvider, over: Record<string, unknown> = {}) =>
  p.search({ query: '"Hailo"', from: daysAgo(90), limit: 25, ...over });

describe('field helpers', () => {
  it('extracts a publisher domain from the source element', () => {
    expect(publisherDomain('https://www.prnewswire.com')).toBe('prnewswire.com');
    expect(publisherDomain('not a url')).toBeNull();
    expect(publisherDomain(undefined)).toBeNull();
  });

  it('strips the publisher suffix Google appends to every headline', () => {
    expect(stripPublisherSuffix('Hailo raises $180M - TechCrunch', 'TechCrunch')).toBe(
      'Hailo raises $180M',
    );
  });

  it('leaves a headline alone when its dash is not the publisher suffix', () => {
    // Blindly cutting at the last " - " would truncate this real-world shape.
    expect(stripPublisherSuffix('Q3 results - what analysts missed', 'Reuters')).toBe(
      'Q3 results - what analysts missed',
    );
    expect(stripPublisherSuffix('No publisher known', null)).toBe('No publisher known');
  });

  it('parses RFC-822 dates and rejects unusable ones', () => {
    expect(parsePubDate('Wed, 29 Apr 2026 07:00:00 GMT')).toBe('2026-04-29T07:00:00.000Z');
    expect(parsePubDate('banana')).toBeNull();
    expect(parsePubDate(undefined)).toBeNull();
  });
});

describe('GoogleNewsProvider.buildUrl', () => {
  it('sends the query with a window hint and the feed locale', () => {
    const url = new URL(
      provider(vi.fn()).buildUrl({
        query: '"Hailo" AND ("edge AI")',
        from: daysAgo(90),
        limit: 25,
      }),
    );
    expect(url.searchParams.get('q')).toBe('"Hailo" AND ("edge AI") when:90d');
    expect(url.searchParams.get('hl')).toBe('en-US');
    expect(url.searchParams.get('ceid')).toBe('US:en');
  });

  it('rejects an unparseable window instead of asking for everything', () => {
    expect(() => provider(vi.fn()).buildUrl({ query: '"x"', from: 'nope', limit: 5 })).toThrow(
      ProviderError,
    );
  });
});

describe('GoogleNewsProvider against a real captured feed', () => {
  it('parses the live-captured sample into RawArticles', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(REAL_FEED)));
    // The capture is months old relative to NOW, so the window is opened deliberately wide.
    const items = await search(provider(fetchImpl as unknown as typeof fetch), {
      from: daysAgo(3650),
      limit: 50,
    });

    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.provider).toBe('googlenews');
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Every real headline should have had its " - Publisher" tail removed.
      if (i.sourceName) expect(i.title.endsWith(` - ${i.sourceName}`)).toBe(false);
      // Neither provider returns body text; pretending otherwise would mislead A6.
      expect(i.snippet).toBeNull();
    }
  });

  it('records the publisher domain, the only usable dedupe key for P3.5', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(REAL_FEED)));
    const items = await search(provider(fetchImpl as unknown as typeof fetch), {
      from: daysAgo(3650),
      limit: 50,
    });
    expect(items.some((i) => typeof i.sourceName === 'string' && i.sourceName.includes('.'))).toBe(
      true,
    );
  });
});

describe('GoogleNewsProvider.search', () => {
  it('satisfies the NewsProvider contract', () => {
    const p: NewsProvider = provider(vi.fn());
    expect(p.name).toBe('googlenews');
  });

  it('maps an item onto RawArticle', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(feed(item()))));
    const [got] = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(got).toMatchObject({
      title: 'Hailo raises $180M Series D',
      sourceName: 'techcrunch.com',
      publishedAt: '2026-07-29T07:00:00.000Z',
      provider: 'googlenews',
      language: null,
      snippet: null,
    });
    expect(got?.url).toContain('news.google.com');
  });

  it('treats a feed with no items as no coverage, not an error (R5)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(feed(''))));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toEqual([]);
  });

  it('handles a single-item feed, which RSS renders as an object not an array', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(feed(item()))));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toHaveLength(1);
  });

  it('decodes XML entities in a headline', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        Promise.resolve(xmlResponse(feed(item({ title: 'Ben &amp; Jerry&#39;s - Reuters' })))),
      ),
    );
    const [got] = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(got?.title).toBe("Ben & Jerry's - Reuters");
  });

  it('drops undated items and enforces the window client-side', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        xmlResponse(
          feed(
            item() +
              item({ link: 'https://news.google.com/b', pubDate: 'nonsense' }) +
              item({ link: 'https://news.google.com/c', pubDate: 'Mon, 01 Jan 2024 00:00:00 GMT' }),
          ),
        ),
      ),
    );
    const items = await search(provider(fetchImpl as unknown as typeof fetch));
    expect(items).toHaveLength(1);
  });

  it('returns newest first and honours the per-company cap (A4)', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        xmlResponse(
          feed(
            item({ link: 'https://news.google.com/1', pubDate: 'Wed, 15 Jul 2026 00:00:00 GMT' }) +
              item({
                link: 'https://news.google.com/2',
                pubDate: 'Wed, 29 Jul 2026 00:00:00 GMT',
              }) +
              item({ link: 'https://news.google.com/3', pubDate: 'Wed, 22 Jul 2026 00:00:00 GMT' }),
          ),
        ),
      ),
    );
    const items = await search(provider(fetchImpl as unknown as typeof fetch), { limit: 2 });
    expect(items.map((i) => i.url)).toEqual([
      'https://news.google.com/2',
      'https://news.google.com/3',
    ]);
  });
});

describe('GoogleNewsProvider error handling (R26)', () => {
  it('retries a 429 and succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(xmlResponse('slow down', 429))
      .mockResolvedValueOnce(xmlResponse(feed(item())));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse('gone', 404)));
    await expect(search(provider(fetchImpl as unknown as typeof fetch))).rejects.toThrow(
      ProviderError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry a caller-initiated abort', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(feed(''))));
    await expect(
      search(provider(fetchImpl as unknown as typeof fetch), { signal: controller.signal }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports unhealthy rather than throwing when the feed is down', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse('down', 503)));
    await expect(provider(fetchImpl as unknown as typeof fetch).health()).resolves.toMatchObject({
      ok: false,
    });
  });

  it('spaces requests, defaulting to a conservative interval', async () => {
    const slept: number[] = [];
    let clock = NOW;
    const fetchImpl = vi.fn(() => Promise.resolve(xmlResponse(feed(''))));
    const p = new GoogleNewsProvider({
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
    expect(slept).toEqual([GOOGLE_NEWS_MIN_INTERVAL_MS]);
  });
});
