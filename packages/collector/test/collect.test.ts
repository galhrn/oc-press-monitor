import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@oc/core';
import {
  collectAll,
  collectForCompany,
  createCircuitBreaker,
  type NewsProvider,
  type PreFilterCompany,
  type RawArticle,
} from '@oc/collector';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;
const from = new Date(NOW.getTime() - 90 * 86_400_000).toISOString();

const hailo: PreFilterCompany = {
  id: 'hailo',
  name: 'Hailo',
  aliases: [],
  negativeKeywords: ['taxi'],
  query: '"Hailo"',
  querySource: 'human-approved',
};

const item = (over: Partial<RawArticle> = {}): RawArticle => ({
  url: 'https://techcrunch.com/hailo-series-d',
  title: 'Hailo raises $180M Series D',
  snippet: null,
  sourceName: 'techcrunch.com',
  publishedAt: '2026-07-28T00:00:00.000Z',
  language: 'en',
  provider: 'stub',
  raw: {},
  ...over,
});

const stubProvider = (name: string, items: RawArticle[]): NewsProvider => ({
  name,
  search: () => Promise.resolve(items),
});

const failingProvider = (name: string, message = 'boom'): NewsProvider => ({
  name,
  search: () => Promise.reject(new ProviderError(message, { retryable: true })),
});

describe('collectForCompany', () => {
  it('returns deduped, filtered articles from a healthy provider', async () => {
    const result = await collectForCompany(hailo, {
      providers: [
        stubProvider('a', [item(), item({ title: 'Hailo ships a chip', url: 'https://x.com/2' })]),
      ],
      from,
      now,
    });
    expect(result.articles).toHaveLength(2);
    expect(result.stats).toMatchObject({ fetched: 2, deduped: 2, kept: 2, providersOk: 1 });
  });

  /** The situation the project is actually in: GDELT 429s while Google News works. */
  it('keeps collecting when one provider fails', async () => {
    const result = await collectForCompany(hailo, {
      providers: [failingProvider('gdelt', 'HTTP 429'), stubProvider('googlenews', [item()])],
      from,
      now,
    });
    expect(result.articles).toHaveLength(1);
    expect(result.stats).toMatchObject({ providersOk: 1, providersFailed: 1 });
    expect(result.providers.find((p) => p.provider === 'gdelt')?.detail).toContain('429');
  });

  it('returns an empty result, not an error, when every provider fails', async () => {
    const result = await collectForCompany(hailo, {
      providers: [failingProvider('a'), failingProvider('b')],
      from,
      now,
    });
    expect(result.articles).toEqual([]);
    expect(result.stats.providersFailed).toBe(2);
  });

  it('collapses the same story arriving from two providers', async () => {
    const result = await collectForCompany(hailo, {
      providers: [
        stubProvider('gdelt', [item()]),
        stubProvider('googlenews', [
          item({
            url: 'https://news.google.com/rss/articles/CBMiX',
            provider: 'googlenews',
            publishedAt: '2026-07-29T00:00:00.000Z',
          }),
        ]),
      ],
      from,
      now,
    });
    expect(result.stats.fetched).toBe(2);
    expect(result.articles).toHaveLength(1);
    // The survivor must be the link a reader can open (R3, AD-28).
    expect(result.articles[0]?.url).toContain('techcrunch.com');
  });

  it('applies the pre-filter and records why items were dropped', async () => {
    const result = await collectForCompany(hailo, {
      providers: [
        stubProvider('a', [
          item(),
          item({ url: 'https://x.com/taxi', title: 'Hailo the taxi app shuts down' }),
          item({ url: 'https://x.com/other', title: 'Nvidia ships a GPU' }),
        ]),
      ],
      from,
      now,
    });
    expect(result.articles).toHaveLength(1);
    expect(result.rejected.map((r) => r.reason).sort()).toEqual([
      'negative-keyword',
      'no-name-match',
    ]);
  });

  it('caps a loud company at the budget, keeping the newest (A4)', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      item({
        url: `https://x.com/${i}`,
        title: `Hailo news ${i}`,
        publishedAt: new Date(NOW.getTime() - i * 86_400_000).toISOString(),
      }),
    );
    const result = await collectForCompany(hailo, {
      providers: [stubProvider('a', many)],
      from,
      maxItems: 3,
      now,
    });
    expect(result.articles).toHaveLength(3);
    expect(result.stats.capped).toBe(7);
    expect(result.articles[0]?.title).toBe('Hailo news 0');
  });

  it('propagates a caller-initiated abort rather than blaming the provider', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider: NewsProvider = {
      name: 'a',
      search: () => Promise.reject(new Error('aborted')),
    };
    await expect(
      collectForCompany(hailo, { providers: [provider], from, signal: controller.signal, now }),
    ).rejects.toThrow();
  });
});

describe('circuit breaker', () => {
  it('opens after the threshold and skips the provider', async () => {
    const clock = NOW.getTime();
    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 60_000,
      now: () => clock,
    });
    const gdelt = failingProvider('gdelt');
    const search = vi.spyOn(gdelt, 'search');

    for (let i = 0; i < 4; i += 1) {
      await collectForCompany(hailo, { providers: [gdelt], from, breaker, now });
    }

    // Two attempts trip it; the remaining two are skipped without touching the network.
    expect(search).toHaveBeenCalledTimes(2);
    expect(breaker.state('gdelt')).toBe('open');
  });

  it('allows a probe once the cooldown has passed', async () => {
    let clock = NOW.getTime();
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 60_000,
      now: () => clock,
    });
    breaker.recordFailure('gdelt');
    expect(breaker.canAttempt('gdelt')).toBe(false);

    clock += 61_000;
    expect(breaker.state('gdelt')).toBe('half-open');
    expect(breaker.canAttempt('gdelt')).toBe(true);

    breaker.recordSuccess('gdelt');
    expect(breaker.state('gdelt')).toBe('closed');
  });

  it('is per provider - one being down says nothing about the other', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 });
    const result = await collectForCompany(hailo, {
      providers: [failingProvider('gdelt'), stubProvider('googlenews', [item()])],
      from,
      breaker,
      now,
    });
    expect(breaker.state('gdelt')).toBe('open');
    expect(breaker.state('googlenews')).toBe('closed');
    expect(result.articles).toHaveLength(1);
  });
});

describe('collectAll', () => {
  const companies: PreFilterCompany[] = [
    hailo,
    { id: 'zuta', name: 'ZutaCore', aliases: [], negativeKeywords: [], query: '"ZutaCore"' },
  ];

  it('reports a zero-coverage company as a first-class outcome (R5)', async () => {
    const run = await collectAll(companies, {
      providers: [stubProvider('a', [item()])],
      from,
      now,
    });
    expect(run.stats.companies).toBe(2);
    expect(run.stats.withNoCoverage).toBe(1);
    expect(run.results).toHaveLength(2);
  });

  it('does not let one company abort the run', async () => {
    const exploding: NewsProvider = {
      name: 'a',
      search: (request) =>
        request.query.includes('ZutaCore')
          ? Promise.reject(new Error('provider blew up'))
          : Promise.resolve([item()]),
    };
    // A provider error is caught per company, so the run still completes both.
    const run = await collectAll(companies, { providers: [exploding], from, now });
    expect(run.results).toHaveLength(2);
    expect(run.stats.articles).toBe(1);
  });

  it('exposes the breaker state for the run manifest', async () => {
    const run = await collectAll(companies, {
      providers: [failingProvider('gdelt')],
      from,
      breaker: createCircuitBreaker({ failureThreshold: 1 }),
      now,
    });
    expect(run.breaker.gdelt?.state).toBe('open');
  });
});
