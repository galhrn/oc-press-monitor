/**
 * GDELT DOC 2.0 provider (task P3.2, requirement R15, decision AD-05).
 *
 * Chosen as the primary source for one decisive reason: it needs no API key, so a
 * reviewer can clone the repo and get real data without signing up for anything. It also
 * indexes a rolling window measured in months, which is exactly the shape of A1.
 *
 * Known limitations, which belong in the README under R9 rather than being discovered by
 * a reviewer:
 *   - `seendate` is when GDELT *saw* the article, not when the publisher dated it. For a
 *     freshness product that is usually within hours, but it is not a publication date and
 *     we must not label it as one.
 *   - `maxrecords` is capped at 250 per request, and there is no cursor. Beyond that the
 *     window has to be split. Our per-company cap (A4) is 25, so this never binds in
 *     practice - but it would silently truncate a wider query.
 *   - Coverage skews to online news that GDELT's crawler reaches. Paywalled and
 *     subscription-only outlets are under-represented.
 *   - The rate limit is one request every 5 seconds, stated nowhere except inside the 429
 *     body itself. We self-throttle to it rather than discover it mid-run. At 258
 *     companies that puts a floor of ~22 minutes on a full collection pass.
 *   - `language` is reported as an English name ("Spanish"), not a code.
 */
import { ProviderError, withRetry, type Logger, type RetryOptions } from '@oc/core';
import { z } from 'zod';
import type { NewsProvider, ProviderHealth, RawArticle, SearchRequest } from '../provider.js';
import { createThrottle, type Throttle } from '../throttle.js';

export const GDELT_PROVIDER_NAME = 'gdelt';

const DEFAULT_ENDPOINT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** GDELT accepts at most 250 records per request and offers no pagination cursor. */
const MAX_RECORDS = 250;

/**
 * GDELT states its own rate limit only inside the 429 body: "Please limit requests to one
 * every 5 seconds". At 258 companies that is ~22 minutes for a full collection pass, which
 * is a scheduling fact for P8.1, not an implementation detail.
 */
export const GDELT_MIN_INTERVAL_MS = 5_000;

/**
 * HTTP statuses where the same request could plausibly succeed later.
 *
 * **429 is deliberately absent.** It is not a flaky failure, it is the server saying we are
 * over quota, and retrying it twice more only spends requests deepening the block. Measured
 * 2026-08-02: retrying through 429s turned a burst into an outage lasting hours. The
 * collector trips the circuit on it instead (P3.7).
 */
const RETRYABLE_STATUS = new Set([408, 425, 500, 502, 503, 504]);

/**
 * GDELT reports a language name, not a code. Only the languages we can actually expect in
 * this portfolio are mapped; anything else is preserved verbatim rather than guessed at,
 * because a wrong code is worse than an honest unknown.
 */
const LANGUAGE_CODES: Record<string, string> = {
  english: 'en',
  hebrew: 'he',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  portuguese: 'pt',
  italian: 'it',
  dutch: 'nl',
  russian: 'ru',
  chinese: 'zh',
  japanese: 'ja',
  korean: 'ko',
  arabic: 'ar',
};

const GdeltArticleSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  seendate: z.string().optional(),
  domain: z.string().optional(),
  language: z.string().optional(),
  sourcecountry: z.string().optional(),
  socialimage: z.string().optional(),
});

/**
 * A GDELT response with no matches omits `articles` entirely rather than sending `[]`,
 * so the field is optional and an absent one means "no coverage", not "malformed".
 */
const GdeltResponseSchema = z.object({
  articles: z.array(GdeltArticleSchema).optional(),
});

export type GdeltArticle = z.infer<typeof GdeltArticleSchema>;

export interface GdeltProviderOptions {
  endpoint?: string;
  /** Per-request timeout. Independent of the retry budget. */
  timeoutMs?: number;
  /**
   * Minimum spacing between requests. Not a guess: GDELT's own 429 body says
   * "Please limit requests to one every 5 seconds", which is the only place the limit is
   * stated at all. Measured against the live API on 2026-08-02.
   */
  minIntervalMs?: number;
  retry?: RetryOptions;
  logger?: Logger;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock, so throttle behaviour is testable without real waiting. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** `2026-08-01T12:00:00.000Z` -> `20260801120000`, the format GDELT's window params use. */
export function toGdeltStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new ProviderError('GDELT received an unparseable window bound', {
      retryable: false,
      context: { value: iso },
    });
  }
  // GDELT wants YYYYMMDDHHMMSS - no separators and, importantly, no `T`.
  return new Date(ms)
    .toISOString()
    .replace(/[-:T]/g, '')
    .replace(/\.\d{3}Z$/, '');
}

/**
 * `20260728T123000Z` -> ISO-8601. Returns null rather than throwing: one unparseable date
 * in a batch of 25 should cost that item, not the whole company's collection.
 */
export function parseSeenDate(value: string | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(value.trim());
  if (!m) {
    const direct = Date.parse(value);
    return Number.isNaN(direct) ? null : new Date(direct).toISOString();
  }
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export const toLanguageCode = (name: string | undefined): string | null => {
  if (!name) return null;
  return LANGUAGE_CODES[name.trim().toLowerCase()] ?? name.trim();
};

export class GdeltProvider implements NewsProvider {
  readonly name = GDELT_PROVIDER_NAME;
  readonly #options: Required<
    Pick<GdeltProviderOptions, 'endpoint' | 'timeoutMs' | 'minIntervalMs'>
  > &
    GdeltProviderOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #throttle: Throttle;

  constructor(options: GdeltProviderOptions = {}) {
    this.#options = {
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      timeoutMs: options.timeoutMs ?? 20_000,
      minIntervalMs: options.minIntervalMs ?? GDELT_MIN_INTERVAL_MS,
      ...options,
    };
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#throttle = createThrottle({
      minIntervalMs: this.#options.minIntervalMs,
      now: this.#now,
      sleep: this.#sleep,
    });
  }

  /** Builds the request URL. Exported behaviour is covered directly by unit tests. */
  buildUrl(request: SearchRequest): string {
    const url = new URL(this.#options.endpoint);
    url.searchParams.set('query', request.query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('sort', 'DateDesc');
    url.searchParams.set('maxrecords', String(Math.min(MAX_RECORDS, Math.max(1, request.limit))));
    url.searchParams.set('startdatetime', toGdeltStamp(request.from));
    url.searchParams.set(
      'enddatetime',
      toGdeltStamp(request.to ?? new Date(this.#now()).toISOString()),
    );
    return url.toString();
  }

  async health(): Promise<ProviderHealth> {
    try {
      const items = await this.search({
        query: '"OurCrowd"',
        from: new Date(this.#now() - 7 * 86_400_000).toISOString(),
        limit: 1,
      });
      return { ok: true, detail: `reachable, ${items.length} item(s) for a probe query` };
    } catch (thrown) {
      return { ok: false, detail: thrown instanceof Error ? thrown.message : String(thrown) };
    }
  }

  async search(request: SearchRequest): Promise<RawArticle[]> {
    request.signal?.throwIfAborted();
    const url = this.buildUrl(request);

    const body = await withRetry(() => this.#throttle(() => this.#fetchOnce(url, request.signal)), {
      attempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      sleep: this.#options.sleep ?? this.#sleep,
      ...this.#options.retry,
      onRetry: (attempt, delayMs, error) =>
        this.#options.logger?.warn(
          { attempt, delayMs, err: error.message, provider: GDELT_PROVIDER_NAME },
          'retrying GDELT request',
        ),
    });

    return this.#toRawArticles(body, request);
  }

  async #fetchOnce(url: string, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await this.#fetch(url, {
        signal: composed,
        headers: { accept: 'application/json', 'user-agent': 'oc-press-monitor/0.1 (research)' },
      });
    } catch (cause) {
      // A caller-initiated abort is a decision, not a fault: never retry it.
      if (signal?.aborted) throw cause;
      throw new ProviderError('GDELT request failed', {
        cause,
        retryable: true,
        context: { provider: GDELT_PROVIDER_NAME, url },
      });
    }

    if (!res.ok) {
      throw new ProviderError(`GDELT returned HTTP ${res.status}`, {
        retryable: RETRYABLE_STATUS.has(res.status),
        context: { provider: GDELT_PROVIDER_NAME, status: res.status, url },
      });
    }

    // GDELT answers a malformed query with HTTP 200 and a plain-text error, so the
    // status line alone is not evidence of success.
    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch (cause) {
      throw new ProviderError('GDELT returned a non-JSON body', {
        cause,
        // Almost always a rejected query, which will be rejected identically next time.
        retryable: false,
        context: { provider: GDELT_PROVIDER_NAME, sample: text.slice(0, 200), url },
      });
    }
  }

  #toRawArticles(body: unknown, request: SearchRequest): RawArticle[] {
    const parsed = GdeltResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError('GDELT response did not match the expected shape', {
        retryable: false,
        context: { provider: GDELT_PROVIDER_NAME, issues: parsed.error.issues.slice(0, 3) },
      });
    }

    const fromMs = Date.parse(request.from);
    const toMs = request.to === undefined ? this.#now() : Date.parse(request.to);
    const out: RawArticle[] = [];

    for (const article of parsed.data.articles ?? []) {
      if (!article.url || !article.title) continue;

      const publishedAt = parseSeenDate(article.seendate);
      // Same rule as the fixture provider: an item that cannot be placed in time cannot
      // drive a quarterly count (R1) or last-mentioned (R4).
      if (publishedAt === null) continue;

      // GDELT honours the window server-side, but a provider that trusts the remote end
      // to enforce our invariants has outsourced its own correctness.
      const ms = Date.parse(publishedAt);
      if (ms < fromMs || ms > toMs) continue;

      out.push({
        url: article.url,
        title: article.title,
        snippet: null, // DOC 2.0 ArtList returns no snippet; A6 then relies on the title.
        sourceName: article.domain ?? null,
        publishedAt,
        language: toLanguageCode(article.language),
        provider: GDELT_PROVIDER_NAME,
        raw: article,
      });
    }

    out.sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''));
    return out.slice(0, Math.max(0, request.limit));
  }
}
