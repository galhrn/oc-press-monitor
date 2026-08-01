/**
 * Offline end-to-end integration test (task P3.8, Phase 3 exit criteria).
 *
 * Runs the whole collection pipeline - query builder, providers, normalisation, dedupe,
 * pre-filter, caps, circuit breaker - against the committed registry and the fixture corpus,
 * with **no network access of any kind**. `globalThis.fetch` is replaced with a throwing stub
 * for the duration, so a regression that reintroduces a live call fails the suite rather than
 * quietly making the build depend on GDELT being up.
 *
 * Determinism is enforced the same way: a frozen clock, and fixture dates that are relative
 * to it. The same command produces the same output today and in six months.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProviderError } from '@oc/core';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  collectAll,
  collectForCompany,
  createCircuitBreaker,
  type NewsProvider,
  type PreFilterCompany,
} from '@oc/collector';

const REGISTRY: PreFilterCompany[] = JSON.parse(
  readFileSync(new URL('../../../data/companies.json', import.meta.url), 'utf8'),
) as PreFilterCompany[];

const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;
const from = new Date(NOW.getTime() - 90 * 86_400_000).toISOString();

const company = (name: string): PreFilterCompany => {
  const found = REGISTRY.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not in the committed registry`);
  return found;
};

const fixture = (): NewsProvider => FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now);

/**
 * A provider that ignores the query and returns everything in the window - which is how
 * Google News actually behaves (P3.3). The fixture provider honours boolean queries, so on
 * its own it would filter the collisions out before the pre-filter ever sees them and the
 * test would prove nothing about P3.6.
 */
const looseProvider = (): NewsProvider => ({
  name: 'loose',
  search: (request) =>
    FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now).search({
      ...request,
      query: '',
    }),
});

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(
      new Error('network access is forbidden in the offline integration test'),
    )) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('offline pipeline (P3.8)', () => {
  it('proves the network is genuinely unavailable', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/forbidden/);
  });

  it('runs end to end for a distinctive company', async () => {
    const result = await collectForCompany(company('ZutaCore'), {
      providers: [fixture()],
      from,
      now,
    });

    expect(result.articles.length).toBeGreaterThan(0);
    for (const article of result.articles) {
      expect(article.id).toMatch(/^[a-f0-9]{64}$/);
      expect(article.canonicalUrl).toMatch(/^https:\/\//);
      expect(article.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(article.title).toMatch(/ZutaCore/i);
    }
  });

  it('collapses the corpus duplicate pair exactly once', async () => {
    const result = await collectForCompany(company('Hailo'), {
      providers: [fixture()],
      from,
      now,
    });
    const partnership = result.articles.filter((a) => /data centre operator/i.test(a.title));
    expect(partnership).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it('rejects the ambiguous-name collisions and explains each one', async () => {
    const result = await collectForCompany(company('Peak'), {
      providers: [looseProvider()],
      from,
      now,
    });
    // A loose provider hands over the mountain, peak oil and Peakhurst items too.
    expect(result.stats.fetched).toBeGreaterThan(5);
    expect(result.articles.every((a) => /decision intelligence/i.test(a.title))).toBe(true);
    expect(result.rejected.length).toBeGreaterThan(0);
    for (const rejection of result.rejected) {
      expect(rejection.reason).toBeTruthy();
    }
    // Substring near-misses must die at the name check, not survive into the LLM budget.
    expect(result.articles.some((a) => /Peakhurst/.test(a.title))).toBe(false);
  });

  it('filters a loose provider down for every ambiguous name in the corpus', async () => {
    for (const name of ['Hailo', 'Lemonade', 'Peak']) {
      const result = await collectForCompany(company(name), {
        providers: [looseProvider()],
        from,
        now,
      });
      expect(result.stats.fetched).toBeGreaterThan(result.articles.length);
      // Title *or* snippet: the corpus's "named only in passing" round-up mentions Hailo in
      // its snippet alone, and the pre-filter is right to keep it. Judging whether a passing
      // mention is really about the company is the LLM gate's job (AD-06, section 6.2).
      expect(
        result.articles.every((a) => new RegExp(name, 'i').test(`${a.title} ${a.snippet ?? ''}`)),
      ).toBe(true);
    }
  });

  it('is deterministic - two identical runs produce identical output', async () => {
    const options = { providers: [fixture()], from, now };
    const first = await collectForCompany(company('Hailo'), options);
    const second = await collectForCompany(company('Hailo'), options);
    expect(second.articles.map((a) => a.id)).toEqual(first.articles.map((a) => a.id));
    expect(second.stats).toEqual(first.stats);
  });

  it('treats a company with no coverage as a first-class outcome (R5)', async () => {
    const result = await collectForCompany(company('Kando'), {
      providers: [fixture()],
      from,
      now,
    });
    expect(result.articles).toEqual([]);
    expect(result.stats.providersOk).toBe(1); // the provider worked; there was simply nothing
  });

  it('completes a multi-company run and reports per-company outcomes', async () => {
    const run = await collectAll(
      [company('ZutaCore'), company('Kando'), company('Hailo'), company('Peak')],
      { providers: [fixture()], from, now },
    );
    expect(run.stats.companies).toBe(4);
    expect(run.stats.failed).toBe(0);
    expect(run.stats.withNoCoverage).toBeGreaterThanOrEqual(1);
    expect(run.results).toHaveLength(4);
  });

  it('survives a dead provider alongside a healthy one', async () => {
    const dead: NewsProvider = {
      name: 'gdelt',
      search: () =>
        Promise.reject(new ProviderError('GDELT returned HTTP 429', { context: { status: 429 } })),
    };
    const run = await collectAll([company('ZutaCore'), company('Hailo')], {
      providers: [dead, fixture()],
      from,
      breaker: createCircuitBreaker({ now: () => NOW.getTime() }),
      now,
    });

    expect(run.stats.articles).toBeGreaterThan(0);
    // A 429 trips the circuit on the first company, so the second one never asks again.
    expect(run.breaker.gdelt?.state).toBe('open');
    expect(run.results[1]?.providers.find((p) => p.provider === 'gdelt')?.status).toBe('skipped');
  });
});

describe('rate-limit handling (P3.7 hardening)', () => {
  it('stops asking after a single 429 rather than retrying into a deeper block', async () => {
    let calls = 0;
    const limited: NewsProvider = {
      name: 'gdelt',
      search: () => {
        calls += 1;
        return Promise.reject(
          new ProviderError('GDELT returned HTTP 429', { context: { status: 429 } }),
        );
      },
    };
    const breaker = createCircuitBreaker({ now: () => NOW.getTime() });

    await collectAll([company('ZutaCore'), company('Hailo'), company('Peak')], {
      providers: [limited],
      from,
      breaker,
      now,
    });

    // One request total across three companies: the 429 is an instruction, not a fault.
    expect(calls).toBe(1);
    expect(breaker.state('gdelt')).toBe('open');
  });

  it('still needs repeated failures to trip on an ordinary error', async () => {
    let calls = 0;
    const flaky: NewsProvider = {
      name: 'gdelt',
      search: () => {
        calls += 1;
        return Promise.reject(new ProviderError('connection reset', { retryable: true }));
      },
    };
    const breaker = createCircuitBreaker({ failureThreshold: 3, now: () => NOW.getTime() });

    await collectAll([company('ZutaCore'), company('Hailo'), company('Peak'), company('Kando')], {
      providers: [flaky],
      from,
      breaker,
      now,
    });

    expect(calls).toBe(3);
    expect(breaker.state('gdelt')).toBe('open');
  });

  it('re-probes once the cooldown expires, which is how GDELT recovers by itself', async () => {
    let clock = NOW.getTime();
    let calls = 0;
    let healthy = false;
    const recovering: NewsProvider = {
      name: 'gdelt',
      search: () => {
        calls += 1;
        return healthy
          ? Promise.resolve([])
          : Promise.reject(
              new ProviderError('GDELT returned HTTP 429', { context: { status: 429 } }),
            );
      },
    };
    const breaker = createCircuitBreaker({ cooldownMs: 300_000, now: () => clock });

    await collectForCompany(company('ZutaCore'), { providers: [recovering], from, breaker, now });
    expect(breaker.state('gdelt')).toBe('open');

    // Still inside the cooldown: no further requests are spent.
    await collectForCompany(company('Hailo'), { providers: [recovering], from, breaker, now });
    expect(calls).toBe(1);

    clock += 300_001;
    healthy = true;
    await collectForCompany(company('Peak'), { providers: [recovering], from, breaker, now });
    expect(calls).toBe(2);
    expect(breaker.state('gdelt')).toBe('closed');
  });
});
