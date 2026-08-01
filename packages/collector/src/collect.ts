/**
 * Collection orchestration (task P3.7, requirements R15, R26, assumption A4).
 *
 * Composes the pieces P3.1-P3.6 built into one call per company:
 *
 *   query builder -> every provider -> normalise + dedupe -> pre-filter -> cap
 *
 * Three properties are the point of this module, and each exists because of something
 * measured earlier in Phase 3:
 *
 *   **Partial-failure isolation (R26).** One provider failing must never cost a company its
 *   coverage, and one company failing must never abort a 258-company run. GDELT has been
 *   returning HTTP 429 since 2026-08-02 while Google News works fine; a collector that
 *   treated a provider error as fatal would currently return nothing at all.
 *
 *   **Circuit breaking.** Rediscovering a provider outage 258 times is the difference
 *   between a five-minute delay and an hour of retrying failures we already know about.
 *
 *   **Per-company caps (A4).** SpaceX is not ambiguous, it is loud (AD-22). Without a cap a
 *   handful of companies consume the entire downstream LLM budget.
 */
import { AppError, toError, type Logger } from '@oc/core';
import type { Article } from '@oc/core';
import { createCircuitBreaker, type CircuitBreaker } from './circuit-breaker.js';
import { normalizeAndDedupe, type DuplicatePair, type SkippedArticle } from './normalize.js';
import {
  preFilterAll,
  type PreFilterCompany,
  type PreFilterOptions,
  type RejectionReason,
} from './pre-filter.js';
import type { NewsProvider, RawArticle } from './provider.js';
import { buildSearchQuery, type QueryPlan, type QueryBuilderOptions } from './query-builder.js';

export interface ProviderOutcome {
  provider: string;
  status: 'ok' | 'failed' | 'skipped';
  items: number;
  /** Present when `status` is not `ok`. */
  detail?: string;
}

export interface CollectionResult {
  companyId: string;
  companyName: string;
  plan: QueryPlan;
  /** Deduped, pre-filtered, capped - the articles worth classifying. */
  articles: Article[];
  providers: ProviderOutcome[];
  rejected: Array<{ article: RawArticle; reason: RejectionReason; evidence: string | null }>;
  skipped: SkippedArticle[];
  duplicates: DuplicatePair[];
  stats: {
    fetched: number;
    normalized: number;
    deduped: number;
    kept: number;
    capped: number;
    providersOk: number;
    providersFailed: number;
    providersSkipped: number;
  };
}

export interface CollectOptions {
  providers: readonly NewsProvider[];
  /** Rolling window start (A1). ISO-8601. */
  from: string;
  to?: string;
  /** `MAX_ITEMS_PER_COMPANY` (A4). Applied after filtering, keeping the newest. */
  maxItems?: number;
  /** How many raw items to request per provider. Defaults to 2x the cap. */
  perProviderLimit?: number;
  breaker?: CircuitBreaker;
  logger?: Logger;
  signal?: AbortSignal;
  now?: () => Date;
  preFilter?: PreFilterOptions;
  queryBuilder?: QueryBuilderOptions;
}

export async function collectForCompany(
  company: PreFilterCompany,
  options: CollectOptions,
): Promise<CollectionResult> {
  const maxItems = options.maxItems ?? 25;
  const perProviderLimit = options.perProviderLimit ?? maxItems * 2;
  const breaker = options.breaker ?? createCircuitBreaker();
  const plan = buildSearchQuery(company, options.queryBuilder);

  const raw: RawArticle[] = [];
  const providers: ProviderOutcome[] = [];

  for (const provider of options.providers) {
    if (!breaker.canAttempt(provider.name)) {
      providers.push({
        provider: provider.name,
        status: 'skipped',
        items: 0,
        detail: 'circuit open',
      });
      continue;
    }

    try {
      const items = await provider.search({
        query: plan.query,
        from: options.from,
        ...(options.to !== undefined ? { to: options.to } : {}),
        limit: perProviderLimit,
        ...(options.signal ? { signal: options.signal } : {}),
      });
      raw.push(...items);
      breaker.recordSuccess(provider.name);
      providers.push({ provider: provider.name, status: 'ok', items: items.length });
    } catch (thrown) {
      // An abort is the caller's decision, not a provider fault: do not blame the circuit.
      if (options.signal?.aborted) throw thrown;
      const error = toError(thrown);
      breaker.recordFailure(provider.name, { immediate: isRateLimited(thrown) });
      providers.push({
        provider: provider.name,
        status: 'failed',
        items: 0,
        detail: error.message,
      });
      options.logger?.warn(
        { provider: provider.name, company: company.name, err: error.message },
        'provider failed for this company; continuing with the others',
      );
    }
  }

  const normalized = normalizeAndDedupe(raw, {
    ...(options.now ? { now: options.now } : {}),
  });
  const filtered = preFilterAll(normalizedToRaw(normalized.articles), company, options.preFilter);

  // Keep the newest within the budget. Sorting before slicing matters: a provider that
  // returns relevance-ordered results (Google News does) would otherwise have the cap
  // decide by arbitrary position rather than by recency.
  const keptIds = new Set(filtered.kept.map((a) => a.url));
  const kept = normalized.articles
    .filter((a) => keptIds.has(a.url))
    .sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''));
  const capped = kept.slice(0, maxItems);

  return {
    companyId: company.id,
    companyName: company.name,
    plan,
    articles: capped,
    providers,
    rejected: filtered.rejected,
    skipped: normalized.skipped,
    duplicates: normalized.duplicates,
    stats: {
      fetched: raw.length,
      normalized: raw.length - normalized.skipped.length,
      deduped: normalized.articles.length,
      kept: kept.length,
      capped: kept.length - capped.length,
      providersOk: providers.filter((p) => p.status === 'ok').length,
      providersFailed: providers.filter((p) => p.status === 'failed').length,
      providersSkipped: providers.filter((p) => p.status === 'skipped').length,
    },
  };
}

/**
 * A 429 is an instruction, not a fault. One is enough to stop asking: continuing to poll a
 * rate-limited endpoint is what turns a short cooldown into a long block.
 */
function isRateLimited(thrown: unknown): boolean {
  return thrown instanceof AppError && thrown.context['status'] === 429;
}

/**
 * The pre-filter reads provider-shaped items while dedupe produces storage-shaped ones.
 * Rather than duplicate the filter, articles are presented back in the shape it expects;
 * `url` is the join key and is unique after dedupe.
 */
function normalizedToRaw(articles: readonly Article[]): RawArticle[] {
  return articles.map((a) => ({
    url: a.url,
    title: a.title,
    snippet: a.snippet,
    sourceName: a.sourceName,
    publishedAt: a.publishedAt,
    language: a.language,
    provider: a.provider,
    raw: a.raw,
  }));
}

export interface CollectRunResult {
  results: CollectionResult[];
  /** Companies whose collection threw outright. A run reports them; it does not die on them. */
  failures: Array<{ company: string; error: string }>;
  breaker: Record<string, { state: string; failures: number }>;
  stats: { companies: number; articles: number; withNoCoverage: number; failed: number };
}

/**
 * Runs every company sequentially, isolating failures. Sequential is deliberate: both
 * providers self-throttle (GDELT states one request per 5 seconds), so concurrency here
 * would only queue inside the throttle while making failures harder to attribute.
 */
export async function collectAll(
  companies: readonly PreFilterCompany[],
  options: CollectOptions,
): Promise<CollectRunResult> {
  const breaker = options.breaker ?? createCircuitBreaker();
  const results: CollectionResult[] = [];
  const failures: CollectRunResult['failures'] = [];

  for (const company of companies) {
    options.signal?.throwIfAborted();
    try {
      results.push(await collectForCompany(company, { ...options, breaker }));
    } catch (thrown) {
      if (options.signal?.aborted) throw thrown;
      const error = toError(thrown);
      failures.push({ company: company.name, error: error.message });
      options.logger?.error(
        { company: company.name, err: error.message },
        'company collection failed; the run continues',
      );
    }
  }

  return {
    results,
    failures,
    breaker: breaker.snapshot(),
    stats: {
      companies: companies.length,
      articles: results.reduce((sum, r) => sum + r.articles.length, 0),
      // "No coverage" is a first-class outcome, not a gap in the data (R5).
      withNoCoverage: results.filter((r) => r.articles.length === 0).length,
      failed: failures.length,
    },
  };
}
