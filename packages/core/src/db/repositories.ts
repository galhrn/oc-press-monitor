/**
 * Repositories - the only place raw SQL lives.
 *
 * Every write is an idempotent upsert keyed on a deterministic id, so the pipeline
 * can be interrupted and re-run without producing duplicates (A5).
 */
import { changesOf, rowAs, rowsAs, withTransaction, type Db } from './index.js';
import { StorageError } from '../errors.js';
import type {
  Article,
  Company,
  CompanyStatus,
  Mention,
  Run,
  RunStatus,
  RunType,
} from '../types.js';
import { bucketFor, daysSince } from '../status.js';

const now = (): string => new Date().toISOString();
const json = <T>(v: T): string => JSON.stringify(v);
const parse = <T>(v: string | null, fallback: T): T => {
  if (!v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/* ------------------------------------------------------------------ companies */

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  aliases: string;
  domain: string | null;
  sector: string | null;
  ambiguity: Company['ambiguity'];
  volume: Company['volume'];
  query_override: string | null;
  negative_keywords: string;
}

const toCompany = (r: CompanyRow): Company => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  aliases: parse<string[]>(r.aliases, []),
  domain: r.domain,
  sector: r.sector,
  ambiguity: r.ambiguity,
  volume: r.volume,
  queryOverride: r.query_override,
  negativeKeywords: parse<string[]>(r.negative_keywords, []),
});

export class CompanyRepository {
  constructor(private readonly db: Db) {}

  upsert(c: Company): void {
    try {
      this.db
        .prepare(
          `INSERT INTO companies
             (id, name, slug, aliases, domain, sector, ambiguity, volume,
              query_override, negative_keywords, created_at, updated_at)
           VALUES (@id, @name, @slug, @aliases, @domain, @sector, @ambiguity, @volume,
                   @queryOverride, @negativeKeywords, @ts, @ts)
           ON CONFLICT (id) DO UPDATE SET
             name = excluded.name, slug = excluded.slug, aliases = excluded.aliases,
             domain = excluded.domain, sector = excluded.sector,
             ambiguity = excluded.ambiguity, volume = excluded.volume,
             query_override = excluded.query_override,
             negative_keywords = excluded.negative_keywords, updated_at = excluded.updated_at`,
        )
        .run({
          id: c.id,
          name: c.name,
          slug: c.slug,
          aliases: json(c.aliases),
          domain: c.domain,
          sector: c.sector,
          ambiguity: c.ambiguity,
          volume: c.volume,
          queryOverride: c.queryOverride,
          negativeKeywords: json(c.negativeKeywords),
          ts: now(),
        });
    } catch (cause) {
      throw new StorageError(`Failed to upsert company ${c.name}`, {
        cause,
        context: { id: c.id },
      });
    }
  }

  upsertMany(companies: readonly Company[]): number {
    return withTransaction(this.db, () => {
      for (const c of companies) this.upsert(c);
      return companies.length;
    });
  }

  all(): Company[] {
    return rowsAs<CompanyRow>(this.db.prepare('SELECT * FROM companies ORDER BY name').all()).map(
      toCompany,
    );
  }

  bySlug(slug: string): Company | undefined {
    const row = this.db.prepare('SELECT * FROM companies WHERE slug = ?').get(slug) as
      CompanyRow | undefined;
    return row ? toCompany(row) : undefined;
  }

  count(): number {
    return (
      rowAs<{ n: number }>(this.db.prepare('SELECT COUNT(*) AS n FROM companies').get())?.n ?? 0
    );
  }
}

/* ------------------------------------------------------------------- articles */

export class ArticleRepository {
  constructor(private readonly db: Db) {}

  /** Returns true when the article was new to the database. */
  upsert(a: Article): boolean {
    const info = this.db
      .prepare(
        `INSERT INTO articles
           (id, url, canonical_url, source_name, title, snippet, published_at, provider, language, raw, fetched_at)
         VALUES (@id, @url, @canonicalUrl, @sourceName, @title, @snippet, @publishedAt, @provider, @language, @raw, @fetchedAt)
         ON CONFLICT (id) DO NOTHING`,
      )
      .run({
        id: a.id,
        url: a.url,
        canonicalUrl: a.canonicalUrl,
        sourceName: a.sourceName,
        title: a.title,
        snippet: a.snippet,
        publishedAt: a.publishedAt,
        provider: a.provider,
        language: a.language,
        raw: a.raw === undefined ? null : json(a.raw),
        fetchedAt: a.fetchedAt,
      });
    return changesOf(info) > 0;
  }

  /** Needed by the resume path: a pending mention knows an article id, not its headline. */
  byId(id: string): Article | undefined {
    const row = rowAs<Record<string, unknown>>(
      this.db.prepare('SELECT * FROM articles WHERE id = ?').get(id),
    );
    if (row === undefined) return undefined;
    return {
      id: row['id'] as string,
      url: row['url'] as string,
      canonicalUrl: row['canonical_url'] as string,
      sourceName: (row['source_name'] as string | null) ?? null,
      title: row['title'] as string,
      snippet: (row['snippet'] as string | null) ?? null,
      publishedAt: (row['published_at'] as string | null) ?? null,
      provider: row['provider'] as string,
      language: (row['language'] as string | null) ?? null,
      raw: row['raw'] === null ? null : JSON.parse(row['raw'] as string),
      fetchedAt: row['fetched_at'] as string,
    };
  }

  /** All articles referenced by a mention, newest first. Used by the exporters (R24). */
  all(): Article[] {
    const rows = rowsAs<Record<string, unknown>>(
      this.db.prepare('SELECT * FROM articles ORDER BY published_at DESC').all(),
    );
    return rows
      .map((r) => this.byId(r['id'] as string))
      .filter((a): a is Article => a !== undefined);
  }

  count(): number {
    return (
      rowAs<{ n: number }>(this.db.prepare('SELECT COUNT(*) AS n FROM articles').get())?.n ?? 0
    );
  }
}

/* ------------------------------------------------------------------- mentions */

const toMention = (r: Record<string, unknown>): Mention => ({
  id: r['id'] as string,
  companyId: r['company_id'] as string,
  articleId: r['article_id'] as string,
  relevant: r['relevant'] === null ? null : r['relevant'] === 1,
  rejectionReason: r['rejection_reason'] as string | null,
  sentiment: r['sentiment'] as Mention['sentiment'],
  confidence: r['confidence'] as number | null,
  rationale: r['rationale'] as string | null,
  evidence: r['evidence'] as string | null,
  model: r['model'] as string | null,
  promptVersion: r['prompt_version'] as string | null,
  classifiedAt: r['classified_at'] as string | null,
  firstSeenAt: r['first_seen_at'] as string,
});

export class MentionRepository {
  constructor(private readonly db: Db) {}

  /**
   * Returns true when this (company, article) pair had never been seen before -
   * which is precisely the definition of "new mention" the daily alert uses (A5).
   */
  upsert(m: Mention): boolean {
    return withTransaction(this.db, (): boolean => {
      const existed =
        this.db.prepare('SELECT 1 FROM mentions WHERE id = ?').get(m.id) !== undefined;
      this.db
        .prepare(
          `INSERT INTO mentions
             (id, company_id, article_id, relevant, rejection_reason, sentiment, confidence,
              rationale, evidence, model, prompt_version, classified_at, first_seen_at)
           VALUES (@id, @companyId, @articleId, @relevant, @rejectionReason, @sentiment, @confidence,
                   @rationale, @evidence, @model, @promptVersion, @classifiedAt, @firstSeenAt)
           ON CONFLICT (id) DO UPDATE SET
             relevant = excluded.relevant, rejection_reason = excluded.rejection_reason,
             sentiment = excluded.sentiment, confidence = excluded.confidence,
             rationale = excluded.rationale, evidence = excluded.evidence,
             model = excluded.model, prompt_version = excluded.prompt_version,
             classified_at = excluded.classified_at`,
        )
        .run({
          id: m.id,
          companyId: m.companyId,
          articleId: m.articleId,
          relevant: m.relevant === null ? null : m.relevant ? 1 : 0,
          rejectionReason: m.rejectionReason,
          sentiment: m.sentiment,
          confidence: m.confidence,
          rationale: m.rationale,
          evidence: m.evidence,
          model: m.model,
          promptVersion: m.promptVersion,
          classifiedAt: m.classifiedAt,
          firstSeenAt: m.firstSeenAt,
        });
      return !existed;
    });
  }

  /** Classified, relevant mentions - what the dashboard and the exports call "coverage". */
  relevant(): Mention[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM mentions WHERE relevant = 1 AND classified_at IS NOT NULL ORDER BY classified_at DESC',
      )
      .all() as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => toMention(r));
  }

  unclassified(limit = 500): Mention[] {
    const rows = this.db
      .prepare('SELECT * FROM mentions WHERE classified_at IS NULL LIMIT ?')
      .all(limit) as unknown as Array<Record<string, unknown>>;
    return rows.map((r) => toMention(r));
  }

  count(): number {
    return (
      rowAs<{ n: number }>(this.db.prepare('SELECT COUNT(*) AS n FROM mentions').get())?.n ?? 0
    );
  }
}

interface RunRow {
  id: string;
  type: RunType;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  stats: string;
}

interface StatusRow {
  company_id: string;
  name: string;
  slug: string;
  last_mentioned_at: string | null;
  mentions_in_window: number;
  positive: number;
  negative: number;
  neutral: number;
}

/* ----------------------------------------------------------------------- runs */

export class RunRepository {
  constructor(private readonly db: Db) {}

  start(id: string, type: RunType): Run {
    const run: Run = { id, type, startedAt: now(), finishedAt: null, status: 'running', stats: {} };
    this.db
      .prepare(
        'INSERT INTO runs (id, type, started_at, finished_at, status, stats) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(run.id, run.type, run.startedAt, null, run.status, json(run.stats));
    return run;
  }

  finish(id: string, status: RunStatus, stats: Record<string, unknown>): void {
    this.db
      .prepare('UPDATE runs SET finished_at = ?, status = ?, stats = ? WHERE id = ?')
      .run(now(), status, json(stats), id);
  }

  latest(): Run | undefined {
    const r = rowAs<RunRow>(
      this.db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').get(),
    );
    return r
      ? {
          id: r.id,
          type: r.type,
          startedAt: r.started_at,
          finishedAt: r.finished_at,
          status: r.status,
          stats: parse(r.stats, {}),
        }
      : undefined;
  }
}

/* ------------------------------------------------------------------------- kv */

export class KeyValueRepository {
  constructor(private readonly db: Db) {}

  get(key: string): string | undefined {
    return (
      this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as
        { value: string } | undefined
    )?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now());
  }
}

/* ------------------------------------------------------------------- statuses */

export class StatusRepository {
  constructor(private readonly db: Db) {}

  /**
   * Every company is returned, including those with no coverage at all (R5).
   *
   * The window is a **parameter, not a literal**. `v_company_status` hardcodes 90 days for
   * convenience at the sqlite prompt, but A1 made the window configurable via
   * `QUARTER_WINDOW_DAYS` - and a view that ignores the setting would silently report
   * 90-day counts under a 30-day configuration, with nothing in the UI to reveal it.
   */
  all(now_: Date = new Date(), windowDays = 90): CompanyStatus[] {
    const rows = rowsAs<StatusRow>(
      this.db
        .prepare(
          `SELECT
             c.id AS company_id, c.name AS name, c.slug AS slug,
             MAX(CASE WHEN m.relevant = 1 THEN a.published_at END) AS last_mentioned_at,
             COUNT(CASE WHEN m.relevant = 1 AND a.published_at >= @from THEN 1 END) AS mentions_in_window,
             COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'positive' AND a.published_at >= @from THEN 1 END) AS positive,
             COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'negative' AND a.published_at >= @from THEN 1 END) AS negative,
             COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'neutral'  AND a.published_at >= @from THEN 1 END) AS neutral
           FROM companies c
           LEFT JOIN mentions m ON m.company_id = c.id
           LEFT JOIN articles a ON a.id = m.article_id
           GROUP BY c.id, c.name, c.slug
           ORDER BY c.name`,
        )
        .all({ from: new Date(now_.getTime() - windowDays * 86_400_000).toISOString() }),
    );
    return rows.map((r) => {
      const days = daysSince(r.last_mentioned_at, now_);
      return {
        companyId: r.company_id,
        name: r.name,
        slug: r.slug,
        lastMentionedAt: r.last_mentioned_at,
        daysSinceLastMention: days,
        bucket: bucketFor(days),
        mentionsInWindow: r.mentions_in_window,
        positive: r.positive,
        negative: r.negative,
        neutral: r.neutral,
      };
    });
  }
}

/** Convenience bundle so callers construct one object, not six. */
export function createRepositories(db: Db) {
  return {
    companies: new CompanyRepository(db),
    articles: new ArticleRepository(db),
    mentions: new MentionRepository(db),
    runs: new RunRepository(db),
    kv: new KeyValueRepository(db),
    statuses: new StatusRepository(db),
  };
}

export type Repositories = ReturnType<typeof createRepositories>;
