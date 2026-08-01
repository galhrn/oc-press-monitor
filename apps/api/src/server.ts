/**
 * Read API for the dashboard (tasks P6.1, P6.2, requirements R1, R3, R4, R18).
 *
 * Deliberately read-only and thin. Every number the dashboard shows already exists in the
 * database or in `@oc/core`; re-deriving any of it here would create a second definition of
 * "last mentioned" that could disagree with the exporters and the CLI.
 *
 * Two things the routes do rather than leave to the browser:
 *   - `statusText` is rendered server-side by `describeStatus`, so "last mentioned 3 days ago"
 *     has exactly one implementation across the CLI, the JSON exports and the UI.
 *   - Only *relevant, classified* mentions are returned. A pre-filter rejection is evidence
 *     about the filter, not press about the company, and surfacing it would inflate every
 *     count on the dashboard.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import {
  createRepositories,
  describeStatus,
  openDatabase,
  toError,
  type Logger,
  type Repositories,
} from '@oc/core';
import {
  CompaniesResponseSchema,
  CompanyDetailResponseSchema,
  HealthResponseSchema,
  SummaryResponseSchema,
  type CompanySummary,
  type Mention,
} from './contract.js';

export interface ApiOptions {
  repositories: Repositories;
  windowDays: number;
  logger?: Logger;
  /** Built SPA to serve, so `npm start` is one command in production (P6.8). */
  webDist?: string;
}

const notFound = (res: Response, message: string): void => {
  res.status(404).json({ error: { code: 'E_NOT_FOUND', message } });
};

export function createApi(options: ApiOptions): Express {
  const { repositories: repos, windowDays } = options;
  const app = express();
  app.disable('x-powered-by');

  const companySummaries = (): CompanySummary[] => {
    const companies = new Map(repos.companies.all().map((c) => [c.id, c]));
    return repos.statuses.all(new Date(), windowDays).map((s) => {
      const company = companies.get(s.companyId);
      return {
        id: s.companyId,
        name: s.name,
        slug: s.slug,
        sector: company?.sector ?? null,
        ambiguity: company?.ambiguity ?? 'low',
        status: s.bucket,
        statusText: describeStatus(s.daysSinceLastMention),
        lastMentionedAt: s.lastMentionedAt,
        daysSinceLastMention: s.daysSinceLastMention,
        mentionsInWindow: s.mentionsInWindow,
        sentiment: { positive: s.positive, negative: s.negative, neutral: s.neutral },
      };
    });
  };

  app.get('/health', (_req, res) => {
    const latest = repos.runs.latest();
    res.json(
      HealthResponseSchema.parse({
        ok: true,
        companies: repos.companies.count(),
        mentions: repos.mentions.count(),
        // Lets the UI say "data is still loading in" instead of implying a finished picture.
        runInProgress: latest !== undefined && latest.finishedAt === null,
      }),
    );
  });

  app.get('/api/companies', (_req, res) => {
    const companies = companySummaries();
    res.json(
      CompaniesResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        windowDays,
        total: companies.length,
        companies,
      }),
    );
  });

  app.get('/api/companies/:slug', (req, res) => {
    const slug = req.params.slug;
    const company = companySummaries().find((c) => c.slug === slug);
    if (!company) return notFound(res, `No company with slug "${slug}"`);

    const articles = new Map(repos.articles.all().map((a) => [a.id, a]));
    const mentions: Mention[] = repos.mentions
      .relevant()
      .filter((m) => m.companyId === company.id)
      .flatMap((m) => {
        const article = articles.get(m.articleId);
        if (!article) return [];
        return [
          {
            id: m.id,
            articleId: article.id,
            title: article.title,
            url: article.url,
            source: article.sourceName,
            publishedAt: article.publishedAt,
            sentiment: m.sentiment,
            confidence: m.confidence,
            rationale: m.rationale,
            model: m.model,
            promptVersion: m.promptVersion,
          },
        ];
      })
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

    return res.json(CompanyDetailResponseSchema.parse({ company, mentions }));
  });

  app.get('/api/summary', (_req, res) => {
    const companies = companySummaries();
    const byStatus: Record<string, number> = {};
    for (const c of companies) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

    const byMonth = new Map<string, number>();
    const articles = repos.articles.all();
    const relevantArticleIds = new Set(repos.mentions.relevant().map((m) => m.articleId));
    for (const article of articles) {
      if (!relevantArticleIds.has(article.id)) continue;
      const month = (article.publishedAt ?? '').slice(0, 7);
      if (month) byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
    }

    const latest = repos.runs.latest();
    res.json(
      SummaryResponseSchema.parse({
        generatedAt: new Date().toISOString(),
        windowDays,
        totals: {
          companies: companies.length,
          mentions: companies.reduce((sum, c) => sum + c.mentionsInWindow, 0),
          withCoverage: companies.filter((c) => c.status !== 'NO_COVERAGE').length,
          // Surfaced as a headline number, not hidden: "no coverage" is a first-class
          // product state (R5) and the audit showed it is often genuinely true.
          withoutCoverage: companies.filter((c) => c.status === 'NO_COVERAGE').length,
        },
        sentiment: {
          positive: companies.reduce((s, c) => s + c.sentiment.positive, 0),
          negative: companies.reduce((s, c) => s + c.sentiment.negative, 0),
          neutral: companies.reduce((s, c) => s + c.sentiment.neutral, 0),
        },
        companiesByStatus: byStatus,
        mentionsByMonth: [...byMonth.entries()]
          .map(([month, count]) => ({ month, count }))
          .sort((a, b) => a.month.localeCompare(b.month)),
        lastRun: latest
          ? {
              id: latest.id,
              startedAt: latest.startedAt,
              finishedAt: latest.finishedAt,
              status: latest.status,
            }
          : null,
      }),
    );
  });

  if (options.webDist && existsSync(options.webDist)) {
    app.use(express.static(options.webDist));
    // SPA fallback: any non-API path returns index.html so client routing works on reload.
    app.get(/^\/(?!api|health).*/, (_req, res) => {
      res.sendFile('index.html', { root: options.webDist });
    });
  }

  app.use((_req, res) => notFound(res, 'Unknown route'));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = toError(err);
    options.logger?.error({ err: error.message }, 'unhandled API error');
    res.status(500).json({ error: { code: 'E_INTERNAL', message: error.message } });
  });

  return app;
}

/** Opens the database read-only: the dashboard must never be able to mutate a run's output. */
export function createApiFromPath(
  dbPath: string,
  options: Omit<ApiOptions, 'repositories'>,
): Express {
  const db = openDatabase({ path: dbPath, readonly: true });
  return createApi({ ...options, repositories: createRepositories(db) });
}
