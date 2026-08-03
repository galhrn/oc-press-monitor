/**
 * Long-running scheduler process (P7.1).
 *
 *   npm run scheduler                 # run on CRON_SCHEDULE in CRON_TIMEZONE
 *   npm run scheduler -- --catch-up   # also run once immediately on boot
 *
 * For production, `npm run daily` under OS cron or a GitHub Action is the simpler deployment -
 * see .github/workflows/daily.yml. This process exists so the scheduled path can be
 * demonstrated without waiting for a real cron tick.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { childLogger, createRepositories, getConfig, initDatabase, newRunId } from '@oc/core';
import { OllamaClient, createFileCache } from '@oc/ollama';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  GdeltProvider,
  GoogleNewsProvider,
  type NewsProvider,
} from '@oc/collector';
import { ConsoleAlerter, FileAlerter, type Alerter } from '@oc/alerting';
import { startScheduler } from '@oc/scheduler';
import type { PipelineCompany } from '@oc/pipeline';

const cfg = getConfig();
const log = childLogger({ runId: newRunId(), stage: 'scheduler' });
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const companies = JSON.parse(
  readFileSync(here('../data/companies.json'), 'utf8'),
) as PipelineCompany[];
/**
 * Fixture runs must never write into the production database.
 *
 * The fixture corpus is hand-authored: realistic headlines invented for testing. A fixture run
 * against `data/press.sqlite` silently inserts fabricated articles into a committed
 * deliverable, where the dashboard cannot distinguish them from real coverage. That happened
 * during P7 and was caught by the fresh-clone rehearsal rather than by a test, so the guard
 * lives in code. An explicit `DB_PATH` still wins; this only changes the default.
 */
const usingFixtures = cfg.NEWS_PROVIDERS.includes('fixture');
const dbPath =
  usingFixtures && process.env['DB_PATH'] === undefined ? './data/dev.sqlite' : cfg.DB_PATH;

const db = initDatabase(dbPath);
const repositories = createRepositories(db);

const providers: NewsProvider[] = [];
for (const name of cfg.NEWS_PROVIDERS) {
  if (name === 'fixture') providers.push(FixtureProvider.fromFile(DEFAULT_CORPUS_PATH));
  else if (name === 'gdelt') providers.push(new GdeltProvider({ logger: log }));
  else if (name === 'googlenews') providers.push(new GoogleNewsProvider({ logger: log }));
}

const alerters: Alerter[] = [];
for (const channel of cfg.ALERT_CHANNELS) {
  if (channel === 'console') alerters.push(new ConsoleAlerter(log));
  else if (channel === 'file') alerters.push(new FileAlerter(cfg.ALERT_FILE_PATH, log));
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

const handle = startScheduler({
  schedule: cfg.CRON_SCHEDULE,
  timezone: cfg.CRON_TIMEZONE,
  catchUpOnBoot: process.argv.includes('--catch-up'),
  logger: log,
  job: () => ({
    companies,
    providers,
    repositories,
    classify: { client },
    alerters,
    lookbackHours: cfg.ALERT_LOOKBACK_HOURS,
    maxItemsPerCompany: cfg.MAX_ITEMS_PER_COMPANY,
    logger: log,
  }),
});

console.error(
  `\n  scheduler running: ${cfg.CRON_SCHEDULE} (${cfg.CRON_TIMEZONE}). Ctrl-C to stop.\n`,
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    handle.stop();
    db.close();
    process.exit(0);
  });
}
