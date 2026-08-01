/**
 * Offline news provider (task P3.1, requirement R15).
 *
 * Two jobs, and the second one is the reason it is built first rather than as an
 * afterthought (see project_context.md section 8.2):
 *
 *   1. Let the entire suite run with the network disabled, deterministically.
 *   2. Let a reviewer run the full pipeline end-to-end without an API key, without
 *      GDELT being up, and without waiting on live HTTP. `NEWS_PROVIDERS=fixture`.
 *
 * It behaves like a small, honest search engine: it applies the same boolean query the
 * live providers receive, the same date window, and the same per-company cap. What it
 * does not do is pretend to be relevant - the corpus deliberately contains collisions
 * ("Peak" the mountain, "Hailo" the taxi app) so that the disambiguation layers in
 * section 4.3 have something real to fail against.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { ProviderError } from '@oc/core';
import type { NewsProvider, ProviderHealth, RawArticle, SearchRequest } from '../provider.js';
import { matchesQuery, parseQuery } from '../query-match.js';

export const PROVIDER_NAME = 'fixture';

/**
 * `publishedAt` accepts an ISO timestamp or a relative offset in days (`-3d`).
 * Relative dates keep the corpus from expiring: a fixture pinned to an absolute date in
 * 2026 silently falls out of a rolling 90-day window (A1) and the demo quietly returns
 * nothing six months from now.
 */
const RELATIVE_DAYS = /^(-?\d+)d$/;

const CorpusItemSchema = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  snippet: z.string().nullable().default(null),
  sourceName: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  language: z.string().nullable().default(null),
  /** Why this item is in the corpus. Documentation for the next reader, never matched on. */
  note: z.string().optional(),
});

export const CorpusSchema = z.object({
  _provenance: z.string().optional(),
  items: z.array(CorpusItemSchema),
});

export type CorpusItem = z.infer<typeof CorpusItemSchema>;
export type Corpus = z.infer<typeof CorpusSchema>;

export interface FixtureProviderOptions {
  corpus: Corpus;
  /** Injectable clock: resolves relative dates and makes tests independent of today. */
  now?: () => Date;
}

const resolvePublishedAt = (value: string | null, now: Date): string | null => {
  if (value === null) return null;
  const relative = RELATIVE_DAYS.exec(value.trim());
  if (relative?.[1] !== undefined) {
    const days = Number.parseInt(relative[1], 10);
    return new Date(now.getTime() + days * 86_400_000).toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export class FixtureProvider implements NewsProvider {
  readonly name = PROVIDER_NAME;
  readonly #corpus: Corpus;
  readonly #now: () => Date;

  constructor(options: FixtureProviderOptions) {
    this.#corpus = options.corpus;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /** Loads and validates a corpus file. Throws `ProviderError` rather than a raw zod error. */
  static fromFile(path: string, now?: () => Date): FixtureProvider {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8'));
    } catch (cause) {
      throw new ProviderError(`fixture corpus could not be read: ${path}`, {
        retryable: false,
        context: { path },
        cause,
      });
    }
    const result = CorpusSchema.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError(`fixture corpus is malformed: ${path}`, {
        retryable: false,
        context: { path, issues: result.error.issues.slice(0, 5) },
      });
    }
    return new FixtureProvider({ corpus: result.data, ...(now ? { now } : {}) });
  }

  health(): Promise<ProviderHealth> {
    return Promise.resolve({ ok: true, detail: `${this.#corpus.items.length} fixture items` });
  }

  search(request: SearchRequest): Promise<RawArticle[]> {
    request.signal?.throwIfAborted();

    const now = this.#now();
    const parsed = parseQuery(request.query);
    const fromMs = Date.parse(request.from);
    const toMs = request.to === undefined ? now.getTime() : Date.parse(request.to);

    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new ProviderError('fixture provider received an unparseable window', {
        retryable: false,
        context: { from: request.from, to: request.to },
      });
    }

    const matched: Array<{ item: CorpusItem; publishedAt: string; ms: number }> = [];
    for (const item of this.#corpus.items) {
      if (!matchesQuery(`${item.title} ${item.snippet ?? ''}`, parsed)) continue;

      const publishedAt = resolvePublishedAt(item.publishedAt, now);
      // An undated item cannot be proved to be inside the window, cannot be placed in a
      // quarter (R1) and cannot drive "last mentioned" (R4). Dropping it here is the
      // honest choice, and it is what the live providers will do in P3.5.
      if (publishedAt === null) continue;

      const ms = Date.parse(publishedAt);
      if (ms < fromMs || ms >= toMs) continue;
      matched.push({ item, publishedAt, ms });
    }

    matched.sort((a, b) => b.ms - a.ms);

    return Promise.resolve(
      matched.slice(0, Math.max(0, request.limit)).map(({ item, publishedAt }) => ({
        url: item.url,
        title: item.title,
        snippet: item.snippet,
        sourceName: item.sourceName,
        publishedAt,
        language: item.language,
        provider: PROVIDER_NAME,
        raw: item,
      })),
    );
  }
}
