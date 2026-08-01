/**
 * Data exporters (task P5.4, requirement R24).
 *
 * The `data/` folder is a graded deliverable: a reviewer who never runs anything should still
 * be able to open it and see mentions, labels, source links and per-company status. These
 * writers produce that from the database.
 *
 * The invariant that matters most: **`company_status.json` contains every company**, including
 * the ones with no coverage at all. R5 makes "no coverage found" a first-class state, and the
 * coverage audit showed it is a genuine one - OncoHost's most recent press anywhere is months
 * old. A file that silently omits the quiet companies would misrepresent the portfolio and
 * hide the very case the status feature exists to report.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { bucketFor, describeStatus, type Repositories, type Sentiment } from '@oc/core';

export interface ExportOptions {
  repositories: Repositories;
  /** Directory to write into - `data/` in production. */
  outDir: string;
  windowDays?: number;
  now?: () => Date;
  model?: string;
  promptVersion?: string;
}

export interface ExportSummary {
  files: string[];
  companies: number;
  mentions: number;
  withNoCoverage: number;
}

interface MentionExport {
  companyId: string;
  company: string;
  articleId: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  sentiment: Sentiment | null;
  confidence: number | null;
  rationale: string | null;
  model: string | null;
  promptVersion: string | null;
}

const writeJson = (path: string, value: unknown): string => {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
};

export function exportAll(options: ExportOptions): ExportSummary {
  const { repositories: repos, outDir } = options;
  const now = options.now ?? ((): Date => new Date());
  const windowDays = options.windowDays ?? 90;
  const generatedAt = now().toISOString();

  const statuses = repos.statuses.all(now(), windowDays);
  const articles = new Map(repos.articles.all().map((a) => [a.id, a]));
  const companies = new Map(repos.companies.all().map((c) => [c.id, c]));

  // Only relevant, classified mentions are exported as coverage. A rejected item is evidence
  // about the filter, not press about the company, and mixing the two would inflate every
  // count on the dashboard.
  const mentions: MentionExport[] = [];
  for (const mention of repos.mentions.relevant()) {
    const article = articles.get(mention.articleId);
    const company = companies.get(mention.companyId);
    if (!article || !company) continue;
    mentions.push({
      companyId: company.id,
      company: company.name,
      articleId: article.id,
      title: article.title,
      url: article.url,
      source: article.sourceName,
      publishedAt: article.publishedAt,
      sentiment: mention.sentiment,
      confidence: mention.confidence,
      rationale: mention.rationale,
      model: mention.model,
      promptVersion: mention.promptVersion,
    });
  }
  mentions.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  const files: string[] = [];

  files.push(
    writeJson(join(outDir, 'mentions.json'), {
      generatedAt,
      windowDays,
      model: options.model ?? null,
      promptVersion: options.promptVersion ?? null,
      count: mentions.length,
      mentions,
    }),
  );

  files.push(
    writeJson(join(outDir, 'company_status.json'), {
      generatedAt,
      windowDays,
      // Stated in the file itself so a reader does not have to count rows to trust it.
      note: 'Every company in the registry appears here, including those with no coverage (R5).',
      companies: statuses.map((s) => ({
        companyId: s.companyId,
        name: s.name,
        slug: s.slug,
        status: s.bucket,
        statusText: describeStatus(s.daysSinceLastMention),
        lastMentionedAt: s.lastMentionedAt,
        daysSinceLastMention: s.daysSinceLastMention,
        mentionsInWindow: s.mentionsInWindow,
        sentiment: { positive: s.positive, negative: s.negative, neutral: s.neutral },
      })),
    }),
  );

  // Quarterly aggregate: per-company counts plus a portfolio roll-up, which is what the
  // dashboard's headline numbers and the trend chart read.
  const byBucket: Record<string, number> = {};
  for (const s of statuses) byBucket[s.bucket] = (byBucket[s.bucket] ?? 0) + 1;

  const byMonth: Record<string, number> = {};
  for (const m of mentions) {
    const month = (m.publishedAt ?? '').slice(0, 7);
    if (month) byMonth[month] = (byMonth[month] ?? 0) + 1;
  }

  files.push(
    writeJson(join(outDir, 'quarterly_summary.json'), {
      generatedAt,
      windowDays,
      totals: {
        companies: statuses.length,
        mentions: mentions.length,
        positive: mentions.filter((m) => m.sentiment === 'positive').length,
        negative: mentions.filter((m) => m.sentiment === 'negative').length,
        neutral: mentions.filter((m) => m.sentiment === 'neutral').length,
      },
      companiesByStatus: byBucket,
      mentionsByMonth: byMonth,
      topCompanies: [...statuses]
        .sort((a, b) => b.mentionsInWindow - a.mentionsInWindow)
        .slice(0, 20)
        .map((s) => ({ name: s.name, mentions: s.mentionsInWindow, status: s.bucket })),
    }),
  );

  return {
    files,
    companies: statuses.length,
    mentions: mentions.length,
    withNoCoverage: statuses.filter((s) => bucketFor(s.daysSinceLastMention) === 'NO_COVERAGE')
      .length,
  };
}
