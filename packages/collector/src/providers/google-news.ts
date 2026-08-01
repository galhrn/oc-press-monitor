/**
 * Google News RSS provider (task P3.3, requirement R15, decision AD-05).
 *
 * AD-05 casts this as the *daily delta* source next to GDELT's backfill. With GDELT
 * currently rate-limiting us (see the 0.8.4 changelog), it is also the only source we have
 * verified against live traffic - which is precisely the reason AD-05 asked for two.
 *
 * Everything below was checked against a real feed on 2026-08-02, not inferred:
 *
 *   <title>       "Headline - Publisher". The publisher suffix is stripped when it matches
 *                 <source>, and left alone when it does not - a headline may legitimately
 *                 contain " - ".
 *   <link>        A news.google.com/rss/articles/CBMi... redirect. It is NOT resolvable:
 *                 the guid is an opaque AU_yqL... token rather than the old protobuf that
 *                 carried the URL, and following the link returns HTTP 200 with a ~580 KB
 *                 JavaScript interstitial, not a redirect. We keep the Google URL - it does
 *                 open the article - and record the publisher domain separately so P3.5 can
 *                 dedupe on (title, domain, date) where the URL cannot be canonicalised.
 *   <pubDate>     RFC-822. Genuinely the publication date, unlike GDELT's `seendate`.
 *   <description> NOT a snippet. It is an anchor tag plus the publisher name in a <font>.
 *                 Neither provider returns usable body text, so classification is
 *                 headline-only until A6's opt-in body extraction is built.
 *   <source url>  The publisher's home page. Reliable, and the best dedupe key available.
 *
 * Other limitations for the README (R9): results are relevance-ordered rather than
 * chronological, the feed is capped at ~100 items with no pagination, and the window
 * operator is advisory - so the window is enforced client-side.
 */
import { ProviderError, withRetry, type Logger, type RetryOptions } from '@oc/core';
import { XMLParser } from 'fast-xml-parser';
import type { NewsProvider, ProviderHealth, RawArticle, SearchRequest } from '../provider.js';
import { createThrottle, type Throttle } from '../throttle.js';

export const GOOGLE_NEWS_PROVIDER_NAME = 'googlenews';

const DEFAULT_ENDPOINT = 'https://news.google.com/rss/search';

/**
 * Google publishes no rate limit for the RSS endpoint. 2s is a deliberately conservative
 * guess rather than a measured value - unlike GDELT's 5s, which the API states itself.
 */
export const GOOGLE_NEWS_MIN_INTERVAL_MS = 2_000;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

interface RssItem {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  source?: unknown;
}

export interface GoogleNewsProviderOptions {
  endpoint?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  /** Feed locale. Drives which edition of Google News answers. */
  hl?: string;
  gl?: string;
  ceid?: string;
  retry?: RetryOptions;
  logger?: Logger;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Titles routinely contain &amp; and &#39;; entity handling is the reason this is a real
  // parser rather than a regex. `processEntities` alone covers the five XML entities but
  // leaves numeric references like &#39; intact, and Google emits those constantly.
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

/** `<source url="https://www.prnewswire.com">PR Newswire</source>` -> `prnewswire.com`. */
export function publisherDomain(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Google appends " - Publisher" to every headline. It is stripped only when the suffix
 * matches the item's own <source>, because a headline may legitimately contain " - " and
 * blindly cutting at the last one would truncate real titles.
 */
export function stripPublisherSuffix(title: string, publisher: string | null): string {
  if (!publisher) return title.trim();
  const suffix = ` - ${publisher.trim()}`;
  return title.trim().endsWith(suffix)
    ? title.trim().slice(0, -suffix.length).trim()
    : title.trim();
}

/** RFC-822 (`Wed, 29 Apr 2026 07:00:00 GMT`) -> ISO, or null when unusable. */
export function parsePubDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  // fast-xml-parser represents an element with attributes as an object whose text is #text.
  if (value && typeof value === 'object' && '#text' in value) {
    const inner = (value as Record<string, unknown>)['#text'];
    return typeof inner === 'string' ? inner : undefined;
  }
  return undefined;
};

export class GoogleNewsProvider implements NewsProvider {
  readonly name = GOOGLE_NEWS_PROVIDER_NAME;
  readonly #options: Required<
    Pick<
      GoogleNewsProviderOptions,
      'endpoint' | 'timeoutMs' | 'minIntervalMs' | 'hl' | 'gl' | 'ceid'
    >
  > &
    GoogleNewsProviderOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #throttle: Throttle;

  constructor(options: GoogleNewsProviderOptions = {}) {
    this.#options = {
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      timeoutMs: options.timeoutMs ?? 20_000,
      minIntervalMs: options.minIntervalMs ?? GOOGLE_NEWS_MIN_INTERVAL_MS,
      hl: options.hl ?? 'en-US',
      gl: options.gl ?? 'US',
      ceid: options.ceid ?? 'US:en',
      ...options,
    };
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#throttle = createThrottle({
      minIntervalMs: this.#options.minIntervalMs,
      now: this.#now,
      ...(options.sleep ? { sleep: options.sleep } : {}),
    });
  }

  buildUrl(request: SearchRequest): string {
    const url = new URL(this.#options.endpoint);
    const toMs = request.to === undefined ? this.#now() : Date.parse(request.to);
    const fromMs = Date.parse(request.from);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new ProviderError('Google News received an unparseable window', {
        retryable: false,
        context: { from: request.from, to: request.to },
      });
    }

    // `when:` is advisory - Google honours it loosely and orders by relevance regardless.
    // It narrows the result set usefully; the window is still enforced client-side.
    const days = Math.max(1, Math.ceil((toMs - fromMs) / 86_400_000));
    url.searchParams.set('q', `${request.query} when:${days}d`);
    url.searchParams.set('hl', this.#options.hl);
    url.searchParams.set('gl', this.#options.gl);
    url.searchParams.set('ceid', this.#options.ceid);
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

    const xml = await withRetry(() => this.#throttle(() => this.#fetchOnce(url, request.signal)), {
      attempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      ...this.#options.retry,
      onRetry: (attempt, delayMs, error) =>
        this.#options.logger?.warn(
          { attempt, delayMs, err: error.message, provider: GOOGLE_NEWS_PROVIDER_NAME },
          'retrying Google News request',
        ),
    });

    return this.#toRawArticles(xml, request);
  }

  async #fetchOnce(url: string, signal?: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let res: Response;
    try {
      res = await this.#fetch(url, {
        signal: composed,
        headers: { accept: 'application/rss+xml, application/xml', 'user-agent': 'Mozilla/5.0' },
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new ProviderError('Google News request failed', {
        cause,
        retryable: true,
        context: { provider: GOOGLE_NEWS_PROVIDER_NAME, url },
      });
    }

    if (!res.ok) {
      throw new ProviderError(`Google News returned HTTP ${res.status}`, {
        retryable: RETRYABLE_STATUS.has(res.status),
        context: { provider: GOOGLE_NEWS_PROVIDER_NAME, status: res.status, url },
      });
    }
    return res.text();
  }

  #toRawArticles(xml: string, request: SearchRequest): RawArticle[] {
    let items: RssItem[];
    try {
      const feed = parser.parse(xml) as { rss?: { channel?: { item?: RssItem | RssItem[] } } };
      const raw = feed.rss?.channel?.item;
      // A feed with a single result is an object, not an array. A feed with none omits the
      // element entirely - that is "no coverage" (R5), not a parse failure.
      items = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    } catch (cause) {
      throw new ProviderError('Google News returned unparseable XML', {
        cause,
        retryable: false,
        context: { provider: GOOGLE_NEWS_PROVIDER_NAME, sample: xml.slice(0, 200) },
      });
    }

    const fromMs = Date.parse(request.from);
    const toMs = request.to === undefined ? this.#now() : Date.parse(request.to);
    const out: RawArticle[] = [];

    for (const item of items) {
      const rawTitle = asText(item.title);
      const link = asText(item.link);
      if (!rawTitle || !link) continue;

      const publishedAt = parsePubDate(asText(item.pubDate));
      // Same rule as both sibling providers: undated means unplaceable in a quarter.
      if (publishedAt === null) continue;

      const ms = Date.parse(publishedAt);
      if (ms < fromMs || ms > toMs) continue;

      const sourceRecord = item.source as Record<string, unknown> | string | undefined;
      const publisher =
        typeof sourceRecord === 'string' ? sourceRecord : (asText(sourceRecord) ?? null);
      const domain = publisherDomain(
        typeof sourceRecord === 'object' && sourceRecord !== null
          ? (sourceRecord['@_url'] as string | undefined)
          : undefined,
      );

      out.push({
        url: link,
        title: stripPublisherSuffix(rawTitle, publisher),
        // <description> carries no article text - see the header comment.
        snippet: null,
        sourceName: domain ?? publisher,
        publishedAt,
        // The feed reports no per-item language; the edition is chosen by `ceid`.
        language: null,
        provider: GOOGLE_NEWS_PROVIDER_NAME,
        raw: { ...item, publisherDomain: domain },
      });
    }

    out.sort((a, b) => Date.parse(b.publishedAt ?? '') - Date.parse(a.publishedAt ?? ''));
    return out.slice(0, Math.max(0, request.limit));
  }
}
