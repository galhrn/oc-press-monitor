/**
 * The daily check, as a CLI (tasks P5.6, P7.5, requirements R6, R7).
 *
 *   npm run daily                        # collect, classify, alert on genuinely new mentions
 *   npm run daily -- --dry-run           # report what would be sent, send and record nothing
 *   npm run daily -- --force             # take a stuck lock
 *   npm run daily -- --lookback-hours 6  # narrow the alert window
 *   npm run daily -- --limit 20          # short loop against a subset
 *
 * Idempotent by construction: running it twice in a row alerts once. That is asserted in
 * `packages/pipeline/test/daily.test.ts`, not left to trust.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  childLogger,
  createRepositories,
  getConfig,
  initDatabase,
  newRunId,
  toError,
} from '@oc/core';
import { OllamaClient, createFileCache } from '@oc/ollama';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  GdeltProvider,
  GoogleNewsProvider,
  type NewsProvider,
} from '@oc/collector';
import { ConsoleAlerter, FileAlerter, type Alerter } from '@oc/alerting';
import { runDailyJob, type PipelineCompany } from '@oc/pipeline';

const argv = process.argv.slice(2);
const at = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const num = (flag: string): number | undefined => {
  const raw = at(flag);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const cfg = getConfig();
const log = childLogger({ runId: newRunId(), stage: 'daily' });
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const registry = JSON.parse(
  readFileSync(here('../data/companies.json'), 'utf8'),
) as PipelineCompany[];
const limit = num('--limit');
const companies = limit === undefined ? registry : registry.slice(0, limit);

const db = initDatabase(cfg.DB_PATH);
const repositories = createRepositories(db);

const providerNames = (at('--providers') ?? cfg.NEWS_PROVIDERS.join(','))
  .split(',')
  .map((s) => s.trim());
const providers: NewsProvider[] = [];
for (const name of providerNames) {
  if (name === 'fixture') providers.push(FixtureProvider.fromFile(DEFAULT_CORPUS_PATH));
  else if (name === 'gdelt') providers.push(new GdeltProvider({ logger: log }));
  else if (name === 'googlenews') providers.push(new GoogleNewsProvider({ logger: log }));
}

// Channels come from ALERT_CHANNELS, so adding a sink is configuration, not a code change.
const alerters: Alerter[] = [];
for (const channel of cfg.ALERT_CHANNELS) {
  if (channel === 'console') alerters.push(new ConsoleAlerter(log));
  else if (channel === 'file') alerters.push(new FileAlerter(cfg.ALERT_FILE_PATH, log));
  else log.warn({ channel }, 'unknown alert channel; ignoring');
}

const client = new OllamaClient({
  host: cfg.OLLAMA_HOST,
  model: cfg.OLLAMA_MODEL,
  numCtx: cfg.OLLAMA_NUM_CTX,
  numPredict: cfg.OLLAMA_NUM_PREDICT,
  keepAlive: cfg.OLLAMA_KEEP_ALIVE,
  timeoutMs: cfg.OLLAMA_TIMEOUT_MS,
  cache: createFileCache(here('../.cache/classify')),
  logger: log,
});

try {
  const health = await client.health();
  if (!health.ok) throw new Error(`Ollama not ready: ${health.detail}`);

  const summary = await runDailyJob({
    companies,
    providers,
    repositories,
    classify: { client },
    alerters,
    lookbackHours: num('--lookback-hours') ?? cfg.ALERT_LOOKBACK_HOURS,
    ...(num('--window-days') !== undefined ? { windowDays: num('--window-days') as number } : {}),
    maxItemsPerCompany: cfg.MAX_ITEMS_PER_COMPANY,
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    logger: log,
  });

  if (!summary.acquiredLock) {
    console.error(
      `\n  Another daily run holds the lock (${summary.lockHeldBy}). Use --force to override.\n`,
    );
    process.exitCode = 1;
  } else {
    console.error(
      `\n  run ${summary.runId}\n` +
        `  companies ${summary.run?.companies ?? 0} · articles seen ${summary.run?.articlesSeen ?? 0}\n` +
        `  new mentions ${summary.newMentions} · within lookback ${summary.alertCandidates}\n` +
        `  delivered ${summary.dispatch?.delivered ?? 0} · already sent ${summary.dispatch?.skipped ?? 0} · failed ${summary.dispatch?.failed ?? 0}` +
        (argv.includes('--dry-run') ? '   (dry run - nothing sent)' : '') +
        `\n  watermark ${summary.watermark ?? 'not set'}\n`,
    );
  }
} catch (thrown) {
  log.error({ err: toError(thrown).message }, 'daily job failed');
  process.exitCode = 1;
} finally {
  db.close();
}
