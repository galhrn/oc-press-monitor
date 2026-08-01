/**
 * Normalisation and cross-provider deduplication (task P3.5, requirement R15).
 *
 * Turns provider-shaped `RawArticle`s into the storage-shaped `Article` (section 6.3) and
 * collapses the same story reported by more than one provider into a single row. Without
 * this, a company that appears in both GDELT and Google News is counted twice in the
 * quarterly chart (R1) and alerted on twice (R7).
 *
 * **Why the URL hash alone is not enough.** `article_id = sha256(canonical_url)` is the
 * primary key and works whenever both providers hand us the publisher's URL. Google News
 * does not: AD-28 records that its links are opaque `news.google.com/rss/articles/CBMi…`
 * redirects that cannot be resolved. So the same article arrives as two different URLs and
 * two different hashes, and a URL-only dedupe would never collapse them.
 *
 * The second key is therefore content-based: **(normalised title, publisher domain)**,
 * compared within a date tolerance.
 *
 * **Why a tolerance rather than an exact date**, which is where this refines AD-28's
 * "(title, domain, date)" wording: P3.2 established that GDELT reports `seendate` - when its
 * crawler *saw* the article - while Google News reports the publisher's `pubDate`. Those
 * routinely differ by a day or more for the same story. Requiring equal dates would fail to
 * dedupe precisely the cross-provider case this exists for, so dates must agree *within a
 * window* rather than exactly.
 *
 * Nothing is discarded silently: skipped and duplicate items are returned with a reason.
 */
import { articleId, canonicalizeUrl, type Article } from '@oc/core';
import type { RawArticle } from './provider.js';

/** Hosts whose URLs identify a redirect rather than the article itself (AD-28). */
const OPAQUE_HOSTS = new Set(['news.google.com']);

export const SKIP_REASONS = ['invalid-url', 'no-date', 'no-title'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export const DUPLICATE_REASONS = ['same-url', 'same-content'] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

/** True when the URL points at an unresolvable redirect rather than the publisher. */
export function isOpaqueUrl(url: string): boolean {
  try {
    return OPAQUE_HOSTS.has(new URL(url).hostname.replace(/^www\./, '').toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The publisher's domain, which is *not* always the URL's host - for a Google News item the
 * host is news.google.com and the real publisher arrives separately in `<source url>`.
 */
export function publisherDomain(article: Pick<RawArticle, 'url' | 'sourceName'>): string | null {
  const declared = article.sourceName
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (declared && declared.includes('.') && !declared.includes(' ')) return declared;
  try {
    return new URL(article.url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return declared ?? null;
  }
}

/**
 * Title reduced to its comparable core: case, accents, punctuation and spacing removed.
 *
 * This normalisation is for *identity only*. It must never be reused for the pre-filter,
 * which depends on whitespace surviving - "launch pad" and "Launchpad" are the same string
 * here and deliberately different strings there.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Content identity for an article whose URL cannot be trusted to be unique. */
export function contentKey(title: string, domain: string | null): string {
  return `${normalizeTitle(title)}|${domain ?? ''}`;
}

export interface NormalizeOptions {
  now?: () => Date;
}

export interface SkippedArticle {
  article: RawArticle;
  reason: SkipReason;
}

/**
 * Maps one raw item onto the storage shape, or explains why it cannot be stored.
 *
 * An undated item is rejected here as well as in the providers. The providers drop it as a
 * courtesy; this is the boundary that actually guarantees it, because an article with no
 * date cannot be placed in a quarter (R1) or drive last-mentioned (R4).
 */
export function normalizeArticle(
  raw: RawArticle,
  options: NormalizeOptions = {},
): { article: Article } | { skipped: SkipReason } {
  if (!raw.title.trim()) return { skipped: 'no-title' };
  if (raw.publishedAt === null) return { skipped: 'no-date' };

  let canonical: string;
  try {
    canonical = canonicalizeUrl(raw.url);
  } catch {
    return { skipped: 'invalid-url' };
  }

  const now = options.now ?? ((): Date => new Date());
  return {
    article: {
      id: articleId(canonical),
      url: raw.url,
      canonicalUrl: canonical,
      sourceName: publisherDomain(raw),
      title: raw.title.trim(),
      snippet: raw.snippet,
      publishedAt: raw.publishedAt,
      provider: raw.provider,
      language: raw.language,
      raw: raw.raw,
      fetchedAt: now().toISOString(),
    },
  };
}

export interface DuplicatePair {
  kept: Article;
  dropped: Article;
  reason: DuplicateReason;
}

export interface DedupeOptions {
  /**
   * How far apart two reports of the same story may be dated and still be one story.
   * Default 7 days, because GDELT's `seendate` lags a publisher's `pubDate` (see header).
   */
  toleranceDays?: number;
}

/** Prefers the record a reader can actually use: a real publisher link beats a redirect. */
function preferred(a: Article, b: Article): { winner: Article; loser: Article } {
  const aOpaque = isOpaqueUrl(a.url);
  const bOpaque = isOpaqueUrl(b.url);
  if (aOpaque !== bOpaque) {
    return aOpaque ? { winner: b, loser: a } : { winner: a, loser: b };
  }
  // Otherwise the earlier report wins: it is closer to actual publication, which is what
  // "last mentioned" is supposed to measure.
  const at = Date.parse(a.publishedAt ?? '');
  const bt = Date.parse(b.publishedAt ?? '');
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
    return at <= bt ? { winner: a, loser: b } : { winner: b, loser: a };
  }
  return { winner: a, loser: b };
}

export interface DedupeResult {
  unique: Article[];
  duplicates: DuplicatePair[];
}

export function dedupeArticles(
  articles: readonly Article[],
  options: DedupeOptions = {},
): DedupeResult {
  const toleranceMs = (options.toleranceDays ?? 7) * 86_400_000;
  const byId = new Map<string, number>();
  const byContent = new Map<string, number[]>();
  const unique: Article[] = [];
  const duplicates: DuplicatePair[] = [];

  const replace = (index: number, incoming: Article, reason: DuplicateReason): void => {
    const existing = unique[index];
    if (existing === undefined) return;
    const { winner, loser } = preferred(existing, incoming);
    unique[index] = winner;
    duplicates.push({ kept: winner, dropped: loser, reason });
    // The winner's identity may now differ, so both keys must point at this slot.
    byId.set(winner.id, index);
    const key = contentKey(winner.title, winner.sourceName);
    const slots = byContent.get(key) ?? [];
    if (!slots.includes(index)) byContent.set(key, [...slots, index]);
  };

  for (const article of articles) {
    const sameId = byId.get(article.id);
    if (sameId !== undefined) {
      replace(sameId, article, 'same-url');
      continue;
    }

    const key = contentKey(article.title, article.sourceName);
    const candidates = byContent.get(key) ?? [];
    const incomingMs = Date.parse(article.publishedAt ?? '');
    const match = candidates.find((i) => {
      const other = unique[i];
      if (other === undefined) return false;
      const otherMs = Date.parse(other.publishedAt ?? '');
      if (!Number.isFinite(incomingMs) || !Number.isFinite(otherMs)) return true;
      return Math.abs(incomingMs - otherMs) <= toleranceMs;
    });

    if (match !== undefined) {
      replace(match, article, 'same-content');
      continue;
    }

    const index = unique.push(article) - 1;
    byId.set(article.id, index);
    byContent.set(key, [...candidates, index]);
  }

  return { unique, duplicates };
}

export interface NormalizeAllResult {
  articles: Article[];
  skipped: SkippedArticle[];
  duplicates: DuplicatePair[];
  stats: { received: number; stored: number; skipped: number; duplicates: number };
}

/** Normalise then dedupe, reporting everything that did not make it through and why. */
export function normalizeAndDedupe(
  raws: readonly RawArticle[],
  options: NormalizeOptions & DedupeOptions = {},
): NormalizeAllResult {
  const normalized: Article[] = [];
  const skipped: SkippedArticle[] = [];

  for (const raw of raws) {
    const result = normalizeArticle(raw, options);
    if ('skipped' in result) skipped.push({ article: raw, reason: result.skipped });
    else normalized.push(result.article);
  }

  const { unique, duplicates } = dedupeArticles(normalized, options);
  return {
    articles: unique,
    skipped,
    duplicates,
    stats: {
      received: raws.length,
      stored: unique.length,
      skipped: skipped.length,
      duplicates: duplicates.length,
    },
  };
}
