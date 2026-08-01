/**
 * Pipeline orchestration (task P5.1, requirement R26).
 *
 * Composes collection and classification into one resumable, idempotent run:
 *
 *   collect → normalise/dedupe → pre-filter → PERSIST → classify → PERSIST
 *
 * **The persist step happens twice, and the first one is the important one.** Articles and
 * mentions are written *before* classification, with `classified_at` null. A production pass
 * takes about four hours; a run that only writes at the end loses everything to one
 * interruption. Writing first means a killed run resumes from `mentions.unclassified()` and
 * re-does only the inference it never finished - and inference is the expensive part.
 *
 * Everything is keyed on deterministic ids (`sha256(canonical_url)`,
 * `sha256(company_id:article_id)`), so re-running is an upsert, not a duplicate. That is what
 * makes the daily job safe to run twice (P5.7) and what makes a resumed run converge on the
 * same state as an uninterrupted one.
 *
 * Failure is isolated at both levels: one provider failing does not cost a company its
 * coverage, and one company failing does not abort the run. Both are recorded in the `runs`
 * manifest rather than being swallowed.
 */
import {
  mentionId,
  newRunId,
  toError,
  type Article,
  type Company,
  type Logger,
  type Mention,
  type RunType,
} from '@oc/core';
import type { Repositories } from '@oc/core';
import {
  collectForCompany,
  createCircuitBreaker,
  normalizeArticle,
  type CollectOptions,
} from '@oc/collector';
import type { NewsProvider, PreFilterCompany } from '@oc/collector';
import { classifyArticle, type ClassifyOptions } from '@oc/classifier';

export interface PipelineCompany extends PreFilterCompany {
  slug: string;
  domain: string | null;
  sector: string | null;
  ambiguity: Company['ambiguity'];
  volume: Company['volume'];
}

export interface RunOptions {
  companies: readonly PipelineCompany[];
  providers: readonly NewsProvider[];
  repositories: Repositories;
  classify: Omit<ClassifyOptions, 'logger'>;
  type?: RunType;
  windowDays?: number;
  maxItemsPerCompany?: number;
  logger?: Logger;
  signal?: AbortSignal;
  now?: () => Date;
  /** Skip inference entirely - used to persist a collection pass and classify later. */
  collectOnly?: boolean;
  onProgress?: (done: number, total: number, company: string) => void;
}

export interface RunSummary {
  runId: string;
  companies: number;
  articlesSeen: number;
  articlesStored: number;
  mentionsNew: number;
  classified: number;
  classificationFailures: number;
  relevant: number;
  irrelevant: number;
  rejectedByPreFilter: number;
  companiesWithNoCoverage: number;
  companyFailures: Array<{ company: string; error: string }>;
  durationMs: number;
}

const toCompanyRow = (c: PipelineCompany): Company => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  aliases: [...c.aliases],
  domain: c.domain,
  sector: c.sector,
  ambiguity: c.ambiguity,
  volume: c.volume,
  queryOverride: c.querySource === 'human-approved' ? c.query : null,
  negativeKeywords: [...c.negativeKeywords],
});

/**
 * Runs the whole pipeline. Sequential over companies by design: both providers self-throttle
 * (GDELT states one request per five seconds), so concurrency here would queue inside the
 * throttle while making a failure harder to attribute to the company that caused it.
 * Concurrency lives where it pays - inside the classification step.
 */
export async function runPipeline(options: RunOptions): Promise<RunSummary> {
  const {
    companies,
    providers,
    repositories: repos,
    logger,
    windowDays = 90,
    maxItemsPerCompany = 25,
  } = options;
  const now = options.now ?? ((): Date => new Date());
  const runId = newRunId();
  const startedAt = Date.now();

  repos.runs.start(runId, options.type ?? 'backfill');
  const breaker = createCircuitBreaker();
  const from = new Date(now().getTime() - windowDays * 86_400_000).toISOString();

  const summary: RunSummary = {
    runId,
    companies: companies.length,
    articlesSeen: 0,
    articlesStored: 0,
    mentionsNew: 0,
    classified: 0,
    classificationFailures: 0,
    relevant: 0,
    irrelevant: 0,
    rejectedByPreFilter: 0,
    companiesWithNoCoverage: 0,
    companyFailures: [],
    durationMs: 0,
  };

  // The registry is the source of truth for the company list (R8); writing it every run keeps
  // the database honest when a company is added or its triage changes.
  repos.companies.upsertMany(companies.map(toCompanyRow));

  let done = 0;
  for (const company of companies) {
    options.signal?.throwIfAborted();
    try {
      const collectOptions: CollectOptions = {
        providers,
        from,
        maxItems: maxItemsPerCompany,
        breaker,
        ...(logger ? { logger } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        now,
      };
      const collected = await collectForCompany(company, collectOptions);

      summary.articlesSeen += collected.stats.fetched;
      summary.rejectedByPreFilter += collected.rejected.length;
      if (collected.articles.length === 0) summary.companiesWithNoCoverage += 1;

      // --- first persist: everything we found, before a single token is spent ---
      const pending: Array<{ article: Article; mention: Mention }> = [];
      for (const article of collected.articles) {
        if (repos.articles.upsert(article)) summary.articlesStored += 1;
        const mention: Mention = {
          id: mentionId(company.id, article.id),
          companyId: company.id,
          articleId: article.id,
          relevant: null,
          rejectionReason: null,
          sentiment: null,
          confidence: null,
          rationale: null,
          evidence: null,
          model: null,
          promptVersion: null,
          classifiedAt: null,
          firstSeenAt: now().toISOString(),
        };
        // `upsert` returns true only the first time this pair is seen, which is exactly the
        // definition of a new mention the daily alert uses (A5).
        if (repos.mentions.upsert(mention)) summary.mentionsNew += 1;
        pending.push({ article, mention });
      }

      // Rejections are persisted too, with their reason, so precision can be measured later
      // rather than asserted (section 4.3 layer 5).
      //
      // The article row goes in first. `mentions.article_id` has a foreign key to
      // `articles(id)`, so recording a rejection against a URL that was never stored would
      // either violate the constraint or leave a dangling row pointing at nothing - and a
      // rejection you cannot join back to its headline is not an audit trail.
      for (const rejection of collected.rejected) {
        const normalised = normalizeArticle(rejection.article, { now });
        if ('skipped' in normalised) continue;
        const article = normalised.article;
        repos.articles.upsert(article);
        repos.mentions.upsert({
          id: mentionId(company.id, article.id),
          companyId: company.id,
          articleId: article.id,
          relevant: false,
          rejectionReason: rejection.reason,
          sentiment: null,
          confidence: null,
          rationale: rejection.evidence,
          evidence: null,
          model: null,
          // Marks the layer that decided, so a rejection is never mistaken for an LLM verdict.
          promptVersion: 'pre-filter',
          classifiedAt: now().toISOString(),
          firstSeenAt: now().toISOString(),
        });
      }

      // --- classification, then the second persist, one item at a time ---
      if (!options.collectOnly) {
        for (const { article, mention } of pending) {
          options.signal?.throwIfAborted();
          try {
            const result = await classifyArticle(
              {
                company: company.name,
                title: article.title,
                sector: company.sector,
                aliases: company.aliases,
                negativeKeywords: company.negativeKeywords,
              },
              { ...options.classify, ...(logger ? { logger } : {}) },
            );
            const c = result.classification;
            repos.mentions.upsert({
              ...mention,
              relevant: c.relevant,
              rejectionReason: c.relevant ? null : 'llm-irrelevant',
              sentiment: c.sentiment,
              confidence: c.confidence,
              rationale: c.rationale,
              evidence: c.evidence,
              model: result.model,
              promptVersion: result.promptVersion,
              classifiedAt: now().toISOString(),
            });
            summary.classified += 1;
            if (c.relevant) summary.relevant += 1;
            else summary.irrelevant += 1;
          } catch (thrown) {
            // The mention stays unclassified, so a later run picks it up rather than the
            // article being lost.
            summary.classificationFailures += 1;
            logger?.warn(
              { company: company.name, article: article.id, err: toError(thrown).message },
              'classification failed; mention left unclassified for a later run',
            );
          }
        }
      }
    } catch (thrown) {
      if (options.signal?.aborted) throw thrown;
      const error = toError(thrown);
      summary.companyFailures.push({ company: company.name, error: error.message });
      logger?.error({ company: company.name, err: error.message }, 'company failed; run continues');
    }

    done += 1;
    options.onProgress?.(done, companies.length, company.name);
  }

  summary.durationMs = Date.now() - startedAt;
  repos.runs.finish(
    runId,
    summary.companyFailures.length === companies.length ? 'failed' : 'completed',
    summary as unknown as Record<string, unknown>,
  );
  return summary;
}

/**
 * Classifies mentions a previous run persisted but never labelled. This is the resume path,
 * and it is why the first persist exists: an interrupted four-hour run costs the inference it
 * had not done yet, not the four hours it had.
 */
export async function classifyPending(options: {
  repositories: Repositories;
  companies: readonly PipelineCompany[];
  classify: Omit<ClassifyOptions, 'logger'>;
  limit?: number;
  logger?: Logger;
  now?: () => Date;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ classified: number; failures: number }> {
  const now = options.now ?? ((): Date => new Date());
  const pending = options.repositories.mentions.unclassified(options.limit ?? 5000);
  const byId = new Map(options.companies.map((c) => [c.id, c]));
  let classified = 0;
  let failures = 0;

  for (const [index, mention] of pending.entries()) {
    const company = byId.get(mention.companyId);
    const article = options.repositories.articles.byId(mention.articleId);
    if (!company || !article) {
      failures += 1;
      continue;
    }
    try {
      const result = await classifyArticle(
        {
          company: company.name,
          title: article.title,
          sector: company.sector,
          aliases: company.aliases,
          negativeKeywords: company.negativeKeywords,
        },
        { ...options.classify, ...(options.logger ? { logger: options.logger } : {}) },
      );
      const c = result.classification;
      options.repositories.mentions.upsert({
        ...mention,
        relevant: c.relevant,
        rejectionReason: c.relevant ? null : 'llm-irrelevant',
        sentiment: c.sentiment,
        confidence: c.confidence,
        rationale: c.rationale,
        evidence: c.evidence,
        model: result.model,
        promptVersion: result.promptVersion,
        classifiedAt: now().toISOString(),
      });
      classified += 1;
    } catch {
      failures += 1;
    }
    options.onProgress?.(index + 1, pending.length);
  }

  return { classified, failures };
}
