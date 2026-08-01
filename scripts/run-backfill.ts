/**
 * Full historical run (tasks P5.1, P8.1, requirement R24).
 *
 *   npm run backfill                      # all 258 companies, live providers
 *   npm run backfill -- --limit 5         # a short loop
 *   npm run backfill -- --providers fixture
 *   npm run backfill -- --resume          # classify what a killed run left pending
 *   npm run backfill -- --export-only     # rewrite data/*.json from the database
 *
 * Writes into `data/press.sqlite` and then regenerates the committed `data/*.json` artifacts.
 * Safe to interrupt: articles and mentions are persisted before classification, so `--resume`
 * picks up only the inference that never finished.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  getConfig,
  childLogger,
  createRepositories,
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
import { DEFAULT_PROMPT_VERSION, promptVersionTag } from '@oc/classifier';
import { classifyPending, exportAll, runPipeline, type PipelineCompany } from '@oc/pipeline';

const argv = process.argv.slice(2);
const at = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cfg = getConfig();
const runId = newRunId();
const log = childLogger({ runId, stage: 'backfill' });
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const registry = JSON.parse(
  readFileSync(here('../data/companies.json'), 'utf8'),
) as PipelineCompany[];
const limitRaw = at('--limit');
const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
const companies = limit ? registry.slice(0, limit) : registry;

const db = initDatabase(cfg.DB_PATH);
const repositories = createRepositories(db);

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

const providerNames = (at('--providers') ?? cfg.NEWS_PROVIDERS.join(','))
  .split(',')
  .map((s) => s.trim());
const providers: NewsProvider[] = [];
for (const name of providerNames) {
  if (name === 'fixture') providers.push(FixtureProvider.fromFile(DEFAULT_CORPUS_PATH));
  else if (name === 'gdelt') providers.push(new GdeltProvider({ logger: log }));
  else if (name === 'googlenews') providers.push(new GoogleNewsProvider({ logger: log }));
}

const exportArtifacts = (): void => {
  const summary = exportAll({
    repositories,
    outDir: here('../data'),
    windowDays: cfg.QUARTER_WINDOW_DAYS,
    model: cfg.OLLAMA_MODEL,
    promptVersion: promptVersionTag(DEFAULT_PROMPT_VERSION),
  });
  console.error(
    `\n  exported ${summary.companies} companies · ${summary.mentions} mentions · ` +
      `${summary.withNoCoverage} with no coverage`,
  );
  for (const file of summary.files) console.error(`    ${file}`);
};

try {
  if (argv.includes('--export-only')) {
    exportArtifacts();
  } else if (argv.includes('--resume')) {
    const health = await client.health();
    if (!health.ok) throw new Error(`Ollama not ready: ${health.detail}`);
    log.info({ pending: repositories.mentions.unclassified(100000).length }, 'resuming');
    const result = await classifyPending({
      repositories,
      companies: registry,
      classify: { client },
      logger: log,
      onProgress: (done, total) => {
        if (done % 25 === 0) console.error(`    classified ${done}/${total}`);
      },
    });
    console.error(`\n  resumed: ${result.classified} classified, ${result.failures} failed`);
    exportArtifacts();
  } else {
    const health = await client.health();
    if (!health.ok) throw new Error(`Ollama not ready: ${health.detail}`);
    log.info(
      {
        companies: companies.length,
        providers: providers.map((p) => p.name),
        model: cfg.OLLAMA_MODEL,
        promptVersion: promptVersionTag(DEFAULT_PROMPT_VERSION),
        windowDays: cfg.QUARTER_WINDOW_DAYS,
        maxItems: cfg.MAX_ITEMS_PER_COMPANY,
      },
      'starting backfill',
    );

    const startedAt = Date.now();
    const summary = await runPipeline({
      companies,
      providers,
      repositories,
      classify: { client },
      type: 'backfill',
      windowDays: cfg.QUARTER_WINDOW_DAYS,
      maxItemsPerCompany: cfg.MAX_ITEMS_PER_COMPANY,
      logger: log,
      onProgress: (done, total, company) => {
        const elapsed = (Date.now() - startedAt) / 60_000;
        const eta = done > 0 ? (elapsed / done) * (total - done) : 0;
        console.error(
          `  [${String(done).padStart(3)}/${total}] ${company.padEnd(26)} ` +
            `${elapsed.toFixed(1)}m elapsed, ~${eta.toFixed(0)}m left`,
        );
      },
    });

    console.error(
      `\n  run ${summary.runId}\n` +
        `  companies ${summary.companies} · articles seen ${summary.articlesSeen} · stored ${summary.articlesStored}\n` +
        `  classified ${summary.classified} (relevant ${summary.relevant}, irrelevant ${summary.irrelevant})\n` +
        `  pre-filter rejections ${summary.rejectedByPreFilter} · classification failures ${summary.classificationFailures}\n` +
        `  no coverage ${summary.companiesWithNoCoverage} · company failures ${summary.companyFailures.length}\n` +
        `  duration ${(summary.durationMs / 60_000).toFixed(1)} min`,
    );
    exportArtifacts();
  }
} catch (thrown) {
  log.error({ err: toError(thrown).message }, 'backfill failed');
  process.exitCode = 1;
} finally {
  db.close();
}
