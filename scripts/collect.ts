/**
 * Collection CLI (P3.7, milestone M3).
 *
 *   npm run collect -- --company Hailo
 *   npm run collect -- --limit 10 --providers fixture
 *   npm run collect -- --company Peak --json
 *
 * The M3 artifact: one command that turns a company name into deduped, normalised,
 * pre-filtered articles and shows exactly what was dropped and why. `--providers fixture`
 * runs the whole thing offline, which is how a reviewer without network access sees it work.
 */
import { readFileSync } from 'node:fs';
import { getConfig, childLogger, newRunId, toError } from '@oc/core';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  GdeltProvider,
  GoogleNewsProvider,
  collectAll,
  createCircuitBreaker,
  type NewsProvider,
  type PreFilterCompany,
} from '@oc/collector';

const argv = process.argv.slice(2);
const at = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const cfg = getConfig();
const runId = newRunId();
const log = childLogger({ runId, stage: 'collect' });

const registry = JSON.parse(
  readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'),
) as PreFilterCompany[];

const requested = at('--company');
const limitRaw = at('--limit');
const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

const companies = requested
  ? registry.filter((c) => c.name.toLowerCase() === requested.toLowerCase())
  : registry.slice(0, limit ?? 5);

if (companies.length === 0) {
  console.error(`\n  No company named "${requested ?? ''}" in data/companies.json.\n`);
  process.exitCode = 1;
} else {
  const names = (at('--providers') ?? cfg.NEWS_PROVIDERS.join(',')).split(',').map((s) => s.trim());
  const providers: NewsProvider[] = [];
  for (const name of names) {
    if (name === 'fixture') providers.push(FixtureProvider.fromFile(DEFAULT_CORPUS_PATH));
    else if (name === 'gdelt') providers.push(new GdeltProvider({ logger: log }));
    else if (name === 'googlenews') providers.push(new GoogleNewsProvider({ logger: log }));
    else log.warn({ provider: name }, 'unknown provider in NEWS_PROVIDERS; ignoring');
  }

  const from = new Date(Date.now() - cfg.QUARTER_WINDOW_DAYS * 86_400_000).toISOString();
  log.info(
    { companies: companies.length, providers: providers.map((p) => p.name), from },
    'collecting',
  );

  try {
    const run = await collectAll(companies, {
      providers,
      from,
      maxItems: cfg.MAX_ITEMS_PER_COMPANY,
      breaker: createCircuitBreaker(),
      logger: log,
    });

    if (argv.includes('--json')) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      for (const result of run.results) {
        const dropped = result.rejected.length;
        console.error(
          `\n  ${result.companyName}  [${result.plan.strategy}]  ` +
            `fetched ${result.stats.fetched} → kept ${result.articles.length}` +
            (dropped > 0 ? `  (${dropped} filtered)` : '') +
            (result.duplicates.length > 0 ? `  (${result.duplicates.length} duplicate)` : ''),
        );
        for (const p of result.providers.filter((x) => x.status !== 'ok')) {
          console.error(`     ! ${p.provider}: ${p.status} - ${p.detail ?? ''}`);
        }
        if (result.articles.length === 0) {
          console.error('     NO COVERAGE in the window');
        }
        for (const a of result.articles.slice(0, 5)) {
          console.error(
            `     ${a.publishedAt?.slice(0, 10)}  ${(a.sourceName ?? '?').padEnd(22)}  ${a.title.slice(0, 60)}`,
          );
        }
      }
      console.error(
        `\n  ${run.stats.companies} companies · ${run.stats.articles} articles · ` +
          `${run.stats.withNoCoverage} with no coverage · ${run.stats.failed} failed`,
      );
      console.error(`  circuit: ${JSON.stringify(run.breaker)}\n`);
    }
  } catch (thrown) {
    log.error({ err: toError(thrown).message }, 'collection run failed');
    process.exitCode = 1;
  }
}
