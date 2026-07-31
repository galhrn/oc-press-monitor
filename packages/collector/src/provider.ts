/**
 * The data-collection seam (task P3.1, requirement R15, decision AD-05).
 *
 * Everything downstream of this interface is provider-agnostic. That is what lets GDELT,
 * Google News RSS and the offline fixture corpus be swapped without the pipeline noticing,
 * and it is what lets the whole test suite run with the network disabled.
 *
 * A provider's single job is to turn a query into raw items. It deliberately does NOT:
 *   - canonicalise URLs or assign article ids   -> normalise.ts (P3.5)
 *   - decide whether an item is about the company -> pre-filter (P3.6) and the LLM (AD-06)
 *   - retry, rate-limit or trip a circuit breaker -> the collector wraps it (P3.7)
 * Keeping providers dumb is what makes them cheap to add and trivial to fake.
 */

/** One item exactly as a provider returned it, before normalisation. */
export interface RawArticle {
  url: string;
  title: string;
  snippet: string | null;
  sourceName: string | null;
  /** ISO-8601 when the provider supplied a parseable date, otherwise null. */
  publishedAt: string | null;
  /** ISO-639-1 where known. GDELT reports it; RSS usually does not. */
  language: string | null;
  /** Which provider produced this item. Recorded on the article row for auditability. */
  provider: string;
  /** The untouched provider payload, so a surprising result can always be explained. */
  raw: unknown;
}

export interface SearchRequest {
  /**
   * A provider-agnostic query string built by the query builder (P3.4), e.g.
   * `"Peak" AND ("decision intelligence" OR "AI")`. Providers translate it to their own
   * syntax; they never construct it.
   */
  query: string;
  /** Inclusive lower bound of the rolling window (A1, `QUARTER_WINDOW_DAYS`). ISO-8601. */
  from: string;
  /** Exclusive upper bound. Defaults to "now" when omitted. ISO-8601. */
  to?: string;
  /** Hard cap on items returned. The budget lever from A4 (`MAX_ITEMS_PER_COMPANY`). */
  limit: number;
  /** Lets a slow provider be abandoned without abandoning the run. */
  signal?: AbortSignal;
}

export interface ProviderHealth {
  ok: boolean;
  detail?: string;
}

export interface NewsProvider {
  /** Stable identifier stored on every article row. Must match the `NEWS_PROVIDERS` env value. */
  readonly name: string;

  /**
   * Returns at most `request.limit` items, newest first.
   *
   * Throws `ProviderError` on transport or protocol failure, with `retryable` set so the
   * caller can branch on it without parsing messages. Returning an empty array is a
   * legitimate, non-exceptional answer: "no coverage" is a first-class state here (R5).
   */
  search(request: SearchRequest): Promise<RawArticle[]>;

  /** Optional cheap reachability probe, used by the CLI before a long run. */
  health?(): Promise<ProviderHealth>;
}
