import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  contentKey,
  dedupeArticles,
  isOpaqueUrl,
  normalizeAndDedupe,
  normalizeArticle,
  normalizeTitle,
  publisherDomain,
  type RawArticle,
} from '@oc/collector';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;

const raw = (over: Partial<RawArticle> = {}): RawArticle => ({
  url: 'https://www.techcrunch.com/2026/07/28/hailo-series-d/?utm_source=newsletter',
  title: 'Hailo raises $180M Series D',
  snippet: null,
  sourceName: 'techcrunch.com',
  publishedAt: '2026-07-28T12:00:00.000Z',
  language: 'en',
  provider: 'gdelt',
  raw: {},
  ...over,
});

const normalized = (over: Partial<RawArticle> = {}) => {
  const result = normalizeArticle(raw(over), { now });
  if ('skipped' in result) throw new Error(`unexpectedly skipped: ${result.skipped}`);
  return result.article;
};

describe('normalizeTitle', () => {
  it('reduces a title to its comparable core', () => {
    expect(normalizeTitle('Hailo Raises $180M — Series D!')).toBe('hailo raises 180m series d');
  });

  it('collapses the spacing distinction the pre-filter depends on', () => {
    // Deliberate: identity normalisation and filter matching are different jobs. This is
    // why normalizeTitle must never be reused by the pre-filter.
    expect(normalizeTitle('Launchpad')).toBe('launchpad');
    expect(normalizeTitle('launch pad')).toBe('launch pad');
  });
});

describe('publisherDomain', () => {
  it('prefers the provider-declared publisher over the URL host', () => {
    // The Google News case: the host is the redirect, the publisher is in <source url>.
    expect(
      publisherDomain({
        url: 'https://news.google.com/rss/articles/CBMi',
        sourceName: 'prnewswire.com',
      }),
    ).toBe('prnewswire.com');
  });

  it('falls back to the URL host when the source name is not a domain', () => {
    expect(publisherDomain({ url: 'https://www.Calcalist.co.il/x', sourceName: 'Calcalist' })).toBe(
      'calcalist.co.il',
    );
  });
});

describe('isOpaqueUrl', () => {
  it('recognises a Google News redirect as unusable for identity (AD-28)', () => {
    expect(isOpaqueUrl('https://news.google.com/rss/articles/CBMiABC?oc=5')).toBe(true);
    expect(isOpaqueUrl('https://techcrunch.com/a')).toBe(false);
  });
});

describe('normalizeArticle', () => {
  it('canonicalises the URL and derives a stable id from it', () => {
    const article = normalized();
    expect(article.canonicalUrl).toBe('https://techcrunch.com/2026/07/28/hailo-series-d');
    expect(article.id).toMatch(/^[a-f0-9]{64}$/);
    expect(article.fetchedAt).toBe(NOW.toISOString());
  });

  it('gives the same id to the same article seen with different tracking tails', () => {
    expect(normalized().id).toBe(
      normalized({ url: 'http://techcrunch.com/2026/07/28/hailo-series-d/?fbclid=xyz#top' }).id,
    );
  });

  it('refuses an undated article, since it cannot be placed in a quarter (R1, R4)', () => {
    expect(normalizeArticle(raw({ publishedAt: null }), { now })).toEqual({ skipped: 'no-date' });
  });

  it('refuses an unusable URL rather than storing a row nobody can click (R3)', () => {
    expect(normalizeArticle(raw({ url: 'not a url' }), { now })).toEqual({
      skipped: 'invalid-url',
    });
  });

  it('refuses a titleless article', () => {
    expect(normalizeArticle(raw({ title: '   ' }), { now })).toEqual({ skipped: 'no-title' });
  });
});

describe('dedupeArticles', () => {
  it('collapses the same canonical URL from two providers', () => {
    const { unique, duplicates } = dedupeArticles([
      normalized(),
      normalized({
        url: 'https://techcrunch.com/2026/07/28/hailo-series-d',
        provider: 'googlenews',
      }),
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates[0]?.reason).toBe('same-url');
  });

  /** The case the URL hash cannot solve, and the reason this task needed a second key. */
  it('collapses the same story arriving as a Google redirect and a publisher URL', () => {
    const fromGdelt = normalized();
    const fromGoogle = normalized({
      url: 'https://news.google.com/rss/articles/CBMiOPAQUE?oc=5',
      sourceName: 'techcrunch.com',
      provider: 'googlenews',
      publishedAt: '2026-07-29T06:00:00.000Z',
    });
    expect(fromGdelt.id).not.toBe(fromGoogle.id);

    const { unique, duplicates } = dedupeArticles([fromGoogle, fromGdelt]);
    expect(unique).toHaveLength(1);
    expect(duplicates[0]?.reason).toBe('same-content');
    // The survivor must be the one a reader can actually open (R3).
    expect(unique[0]?.url).toContain('techcrunch.com');
    expect(isOpaqueUrl(unique[0]?.url ?? '')).toBe(false);
  });

  it('tolerates the seendate/pubDate lag between providers', () => {
    // GDELT reports when it saw the article, Google reports when it was published; the
    // same story routinely carries dates a day or more apart (P3.2 finding).
    const { unique } = dedupeArticles([
      normalized({ publishedAt: '2026-07-28T00:00:00.000Z' }),
      normalized({
        url: 'https://news.google.com/rss/articles/CBMiX',
        sourceName: 'techcrunch.com',
        publishedAt: '2026-07-31T00:00:00.000Z',
      }),
    ]);
    expect(unique).toHaveLength(1);
  });

  it('does not merge the same headline republished months apart', () => {
    const { unique } = dedupeArticles([
      normalized({ publishedAt: '2026-07-28T00:00:00.000Z' }),
      normalized({
        url: 'https://news.google.com/rss/articles/CBMiY',
        sourceName: 'techcrunch.com',
        publishedAt: '2026-02-01T00:00:00.000Z',
      }),
    ]);
    expect(unique).toHaveLength(2);
  });

  it('keeps the same headline from two different publishers as two stories', () => {
    // Wire copy legitimately appears at several outlets; each is its own mention with its
    // own source link, and collapsing them would understate coverage.
    const { unique } = dedupeArticles([
      normalized({ sourceName: 'techcrunch.com' }),
      normalized({ url: 'https://reuters.com/a', sourceName: 'reuters.com' }),
    ]);
    expect(unique).toHaveLength(2);
  });

  it('prefers the earlier report when neither URL is opaque', () => {
    const { unique } = dedupeArticles([
      normalized({ url: 'https://techcrunch.com/b', publishedAt: '2026-07-30T00:00:00.000Z' }),
      normalized({ url: 'https://techcrunch.com/a', publishedAt: '2026-07-28T00:00:00.000Z' }),
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0]?.publishedAt).toBe('2026-07-28T00:00:00.000Z');
  });

  it('builds a content key from the title and the publisher', () => {
    expect(contentKey('Hailo Raises $180M', 'techcrunch.com')).toBe(
      'hailo raises 180m|techcrunch.com',
    );
  });
});

describe('normalizeAndDedupe against the fixture corpus', () => {
  it('collapses the duplicate pair the corpus carries for exactly this purpose', async () => {
    const provider = FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, () => NOW);
    const items = await provider.search({
      query: '"Hailo"',
      from: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
      limit: 50,
    });

    const dupes = items.filter((i) => /data centre operator/i.test(i.title));
    expect(dupes).toHaveLength(2);

    const result = normalizeAndDedupe(items, { now });
    const survivors = result.articles.filter((a) => /data centre operator/i.test(a.title));
    expect(survivors).toHaveLength(1);
    expect(result.stats.received).toBe(items.length);
    expect(result.stats.stored + result.stats.skipped + result.stats.duplicates).toBe(items.length);
  });

  it('reports skipped and duplicate items rather than dropping them silently', () => {
    const result = normalizeAndDedupe(
      [raw(), raw({ publishedAt: null }), raw({ url: 'nope' }), raw()],
      { now },
    );
    expect(result.stats).toMatchObject({ received: 4, stored: 1, skipped: 2, duplicates: 1 });
    expect(result.skipped.map((s) => s.reason).sort()).toEqual(['invalid-url', 'no-date']);
  });

  it('is idempotent - re-running over its own output changes nothing', () => {
    const first = normalizeAndDedupe([raw(), raw()], { now });
    const again = dedupeArticles(first.articles);
    expect(again.unique).toHaveLength(first.articles.length);
    expect(again.duplicates).toHaveLength(0);
  });
});
