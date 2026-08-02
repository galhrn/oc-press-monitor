/**
 * The daily check (task P5.6, requirements R6, R7, assumption A5, decision AD-12).
 *
 * An idempotent function, not a scheduler. `node-cron` in P7 is a thin trigger around it, and
 * so is a GitHub Action or an OS cron entry - which is the point: what runs and what triggers
 * it are separate decisions, and only one of them is interesting.
 *
 * The sequence:
 *
 *   lock → collect a narrow window → classify inline → select new mentions → alert → watermark
 *
 * **Why "new" needs two conditions, not one.** A5 defines a new mention as a
 * `(company, article)` pair never persisted before **and** published inside
 * `ALERT_LOOKBACK_HOURS`. Dropping the second condition looks harmless until the first run
 * after any gap, when every article from the 90-day backfill is technically "never seen
 * before" and the job alerts on all 1,352 of them at once. An article first *seen* today but
 * published three weeks ago is not news.
 *
 * **Why the collection window is wider than the lookback.** Indexes lag. Collecting seven days
 * and alerting on 48 hours means a story indexed two days late is still found, and the
 * lookback - not the fetch - decides whether it is worth waking someone for.
 */
import { newRunId, toError, type Logger, type Repositories } from '@oc/core';
import type { NewsProvider } from '@oc/collector';
import type { ClassifyOptions } from '@oc/classifier';
import { dispatchAlerts, type Alert, type Alerter, type DispatchSummary } from '@oc/alerting';
import { runPipeline, type PipelineCompany, type RunSummary } from './run.js';

export const LOCK_KEY = 'daily.lock';
export const WATERMARK_KEY = 'daily.watermark';

export interface DailyOptions {
  companies: readonly PipelineCompany[];
  providers: readonly NewsProvider[];
  repositories: Repositories;
  classify: Omit<ClassifyOptions, 'logger'>;
  alerters: readonly Alerter[];
  /** A5. Articles older than this are stored but never alerted on. */
  lookbackHours?: number;
  /** How far back to *fetch*. Wider than the lookback on purpose - see the header. */
  windowDays?: number;
  maxItemsPerCompany?: number;
  /** How long a lock stays valid before it is treated as abandoned. */
  lockTtlMs?: number;
  /** Takes an expired or held lock anyway. For a stuck lock, or a deliberate re-run. */
  force?: boolean;
  dryRun?: boolean;
  logger?: Logger;
  now?: () => Date;
}

export interface DailySummary {
  runId: string | null;
  /** False when another run holds the lock; everything else is then zero. */
  acquiredLock: boolean;
  lockHeldBy?: string;
  run: RunSummary | null;
  /** New pairs found, before the lookback filter. */
  newMentions: number;
  /** New pairs that were also recent enough to be worth alerting on. */
  alertCandidates: number;
  dispatch: DispatchSummary | null;
  watermark: string | null;
}

interface LockValue {
  runId: string;
  acquiredAt: string;
}

const readLock = (repos: Repositories): LockValue | null => {
  const raw = repos.kv.get(LOCK_KEY);
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as LockValue;
  } catch {
    // A corrupt lock is not a reason to never run again.
    return null;
  }
};

/**
 * A lock with a TTL rather than a bare flag.
 *
 * A crashed run leaves its lock behind, and a lock nothing can clear turns one bad night into
 * a monitor that is silently dead until somebody notices. The TTL bounds that to one interval.
 */
export function isLockStale(lock: LockValue, now: Date, ttlMs: number): boolean {
  const acquired = Date.parse(lock.acquiredAt);
  return !Number.isFinite(acquired) || now.getTime() - acquired > ttlMs;
}

export async function runDailyJob(options: DailyOptions): Promise<DailySummary> {
  const {
    repositories: repos,
    alerters,
    logger,
    lookbackHours = 48,
    windowDays = 7,
    lockTtlMs = 30 * 60_000,
  } = options;
  const now = options.now ?? ((): Date => new Date());
  const startedAt = now().toISOString();

  const existing = readLock(repos);
  if (existing !== null && !isLockStale(existing, now(), lockTtlMs) && options.force !== true) {
    logger?.warn(
      { heldBy: existing.runId, since: existing.acquiredAt },
      'daily job already running',
    );
    return {
      runId: null,
      acquiredLock: false,
      lockHeldBy: existing.runId,
      run: null,
      newMentions: 0,
      alertCandidates: 0,
      dispatch: null,
      watermark: repos.kv.get(WATERMARK_KEY) ?? null,
    };
  }
  if (existing !== null) {
    logger?.warn(
      { heldBy: existing.runId, forced: options.force === true },
      'taking over a stale lock',
    );
  }

  // Claimed *before* any work starts. Writing the lock after collection would mean two
  // concurrent runs both pass the check above and both start fetching - which is the exact
  // thing the lock exists to prevent.
  const lockId = newRunId();
  repos.kv.set(LOCK_KEY, JSON.stringify({ runId: lockId, acquiredAt: startedAt }));

  let summary: DailySummary = {
    runId: null,
    acquiredLock: true,
    run: null,
    newMentions: 0,
    alertCandidates: 0,
    dispatch: null,
    watermark: repos.kv.get(WATERMARK_KEY) ?? null,
  };

  try {
    const run = await runPipeline({
      companies: options.companies,
      providers: options.providers,
      repositories: repos,
      classify: options.classify,
      type: 'daily',
      windowDays,
      ...(options.maxItemsPerCompany !== undefined
        ? { maxItemsPerCompany: options.maxItemsPerCompany }
        : {}),
      ...(logger ? { logger } : {}),
      now,
    });
    summary = { ...summary, runId: run.runId, run };

    // Condition 1: the pair had never been persisted before. Taken from the upsert's own
    // return value rather than from a timestamp comparison - see `newMentionIds`.
    const created = new Set(run.newMentionIds);
    const fresh = repos.mentions.relevant().filter((m) => created.has(m.id));
    summary.newMentions = fresh.length;

    // Condition 2: and the article is recent enough to be worth waking someone for.
    const cutoff = new Date(now().getTime() - lookbackHours * 3_600_000).toISOString();
    const articles = new Map(repos.articles.all().map((a) => [a.id, a]));
    const companies = new Map(repos.companies.all().map((c) => [c.id, c]));

    const alerts: Alert[] = [];
    for (const mention of fresh) {
      const article = articles.get(mention.articleId);
      const company = companies.get(mention.companyId);
      if (!article || !company) continue;
      if (article.publishedAt === null || article.publishedAt < cutoff) continue;
      alerts.push({
        mentionId: mention.id,
        company: company.name,
        companySlug: company.slug,
        title: article.title,
        url: article.url,
        source: article.sourceName,
        publishedAt: article.publishedAt,
        sentiment: mention.sentiment,
        confidence: mention.confidence,
        rationale: mention.rationale,
        model: mention.model,
        detectedAt: startedAt,
      });
    }
    summary.alertCandidates = alerts.length;

    summary.dispatch = await dispatchAlerts({
      alerts,
      sinks: alerters,
      repositories: repos,
      runId: run.runId,
      ...(logger ? { logger } : {}),
      ...(options.dryRun === true ? { dryRun: true } : {}),
    });

    // The watermark advances only on a completed run, and never during a dry run - it is a
    // record of work done, not of work attempted.
    if (options.dryRun !== true) {
      repos.kv.set(WATERMARK_KEY, startedAt);
      summary.watermark = startedAt;
    }

    return summary;
  } catch (thrown) {
    logger?.error({ err: toError(thrown).message }, 'daily job failed');
    throw thrown;
  } finally {
    // Released even on failure. A lock that outlives its run is the failure mode the TTL
    // exists to bound, not one to rely on.
    repos.kv.delete(LOCK_KEY);
  }
}
