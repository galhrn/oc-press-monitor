/**
 * Gold-set evaluation and model bake-off (tasks P4.7, P4.8, decision AD-17).
 *
 *   npm run eval                                   # the full ladder
 *   npm run eval -- --models llama3.2:3b           # one model
 *   npm run eval -- --no-cache                     # ignore the content-hash cache
 *
 * Climbs the section 6.4 ladder from the smallest model up and reports, per model, macro-F1
 * for relevance and sentiment separately, per-class precision/recall **with support**, JSON
 * validity, latency and a projected full-run wall clock. Writes `data/bakeoff.json`; the
 * printed table is the README artifact.
 *
 * The ship rule is AD-17: the smallest model within 2 points of macro-F1 of the best. That is
 * applied here in code rather than by eye, so the decision is reproducible.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, childLogger, newRunId, toError, type Sentiment } from '@oc/core';
import { OllamaClient, createFileCache, createLimiter, createNullCache } from '@oc/ollama';
import {
  classifyArticle,
  promptVersionTag,
  renderConfusion,
  scoreRun,
  type BakeOffResult,
  type PredictedLabel,
} from '@oc/classifier';

interface GoldItem {
  id: string;
  company: string;
  title: string;
  stratum: string;
  label: { relevant: boolean; sentiment: Sentiment | null; note: string };
}

interface GoldSet {
  labelling: { status: string };
  items: GoldItem[];
}

const argv = process.argv.slice(2);
const at = (flag: string): string | undefined => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LADDER = ['qwen2.5:1.5b-instruct', 'llama3.2:3b', 'qwen2.5:3b-instruct'];
const models = (at('--models') ?? LADDER.join(','))
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const cfg = getConfig();
const runId = newRunId();
const log = childLogger({ runId, stage: 'eval' });
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

const gold = JSON.parse(
  readFileSync(here('../packages/classifier/eval/gold-set.json'), 'utf8'),
) as GoldSet;

if (!gold.labelling.status.startsWith('APPROVED')) {
  console.error(
    `\n  Gold set is not approved (status: ${gold.labelling.status}). Refusing to run.\n`,
  );
  process.exitCode = 1;
} else {
  // The registry supplies the disambiguation context the prompt injects (sector, aliases,
  // negatives). Without it "Shield AI: $1.5B Series G" is unanswerable from a headline.
  const registry = JSON.parse(readFileSync(here('../data/companies.json'), 'utf8')) as Array<{
    name: string;
    sector: string | null;
    aliases: string[];
    negativeKeywords: string[];
  }>;
  const contextFor = (company: string) => registry.find((c) => c.name === company);

  const results: BakeOffResult[] = [];

  for (const model of models) {
    const client = new OllamaClient({
      host: cfg.OLLAMA_HOST,
      model,
      numCtx: cfg.OLLAMA_NUM_CTX,
      numPredict: cfg.OLLAMA_NUM_PREDICT,
      keepAlive: cfg.OLLAMA_KEEP_ALIVE,
      timeoutMs: cfg.OLLAMA_TIMEOUT_MS,
      cache: argv.includes('--no-cache')
        ? createNullCache()
        : createFileCache(here('../.cache/eval')),
      logger: log,
    });

    const health = await client.health();
    if (!health.ok) {
      console.error(`\n  Ollama not ready for ${model}: ${health.detail}\n`);
      continue;
    }

    console.error(`\n  ${model} - ${gold.items.length} items`);
    const limit = createLimiter(cfg.OLLAMA_CONCURRENCY);
    const latencies: number[] = [];
    const pairs: Array<{ gold: GoldItem['label']; predicted: PredictedLabel | null }> = new Array(
      gold.items.length,
    );

    const startedAt = Date.now();
    await Promise.all(
      gold.items.map((item, index) =>
        limit(async () => {
          const context = contextFor(item.company);
          const t0 = Date.now();
          try {
            const result = await classifyArticle(
              {
                company: item.company,
                title: item.title,
                sector: context?.sector ?? null,
                aliases: context?.aliases ?? [],
                negativeKeywords: context?.negativeKeywords ?? [],
              },
              { client, logger: log },
            );
            if (!result.cached) latencies.push(Date.now() - t0);
            pairs[index] = {
              gold: item.label,
              predicted: {
                relevant: result.classification.relevant,
                sentiment: result.classification.sentiment,
              },
            };
          } catch (thrown) {
            log.warn({ item: item.id, err: toError(thrown).message }, 'classification failed');
            pairs[index] = { gold: item.label, predicted: null };
          }
        }),
      ),
    );
    const wallMs = Date.now() - startedAt;

    results.push(
      scoreRun({
        model,
        promptVersion: promptVersionTag(),
        pairs,
        latenciesMs: latencies,
        wallMs,
      }),
    );
  }

  const line = (r: BakeOffResult): string =>
    `  ${r.model.padEnd(24)}  ${r.relevance.macroF1.toFixed(3).padStart(9)}  ` +
    `${r.sentiment.macroF1.toFixed(3).padStart(9)}  ${(r.jsonValidityRate * 100).toFixed(0).padStart(6)}%  ` +
    `${`${(r.p50LatencyMs / 1000).toFixed(1)}s`.padStart(7)}  ${String(r.itemsPerMinute).padStart(9)}  ` +
    `${`${r.projectedMinutesFor2500} min`.padStart(11)}`;

  console.error(
    `\n  model                     relevanceF1  sentimentF1   valid      p50  items/min   2500 items`,
  );
  console.error(`  ${'-'.repeat(94)}`);
  for (const r of results) console.error(line(r));

  for (const r of results) {
    console.error(`\n  === ${r.model}`);
    console.error(
      `  relevance  (n=${r.relevance.n}, accuracy ${(r.relevance.accuracy * 100).toFixed(1)}%)`,
    );
    for (const c of r.relevance.perClass) {
      console.error(
        `    ${c.label.padEnd(16)} P ${c.precision.toFixed(2)}  R ${c.recall.toFixed(2)}  F1 ${c.f1.toFixed(2)}  (support ${c.support})`,
      );
    }
    console.error(`  sentiment  (n=${r.sentiment.n})`);
    for (const c of r.sentiment.perClass) {
      if (c.support === 0 && c.label === 'not_applicable') continue;
      console.error(
        `    ${c.label.padEnd(16)} P ${c.precision.toFixed(2)}  R ${c.recall.toFixed(2)}  F1 ${c.f1.toFixed(2)}  (support ${c.support})`,
      );
    }
    console.error(renderConfusion(r.sentiment.confusion).replace(/^/gm, '    '));
  }

  // AD-17 applied in code: combined score is the mean of the two macro-F1s, and the smallest
  // model within 2 points of the best wins. Ladder order is size order.
  const combined = (r: BakeOffResult): number => (r.relevance.macroF1 + r.sentiment.macroF1) / 2;
  const best = results.reduce(
    (a, b) => (combined(b) > combined(a) ? b : a),
    results[0] as BakeOffResult,
  );
  const ship = results.find((r) => combined(r) >= combined(best) - 0.02) ?? best;
  console.error(
    `\n  best: ${best?.model} (${combined(best).toFixed(3)})\n` +
      `  AD-17 ship rule -> ${ship.model} (${combined(ship).toFixed(3)}), ` +
      `the smallest model within 2 points of the best\n`,
  );

  const out = here('../data/bakeoff.json');
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ runId, promptVersion: promptVersionTag(), goldItems: gold.items.length, results, ship: ship.model }, null, 2)}\n`,
    'utf8',
  );
  console.error(`  written -> ${out}\n`);
}
