/**
 * Ollama throughput benchmark (task P4.0, decisions AD-17 / AD-18 / AD-19).
 *
 * Answers three questions that opinions cannot:
 *   1. Is inference actually running on the GPU, or silently on the CPU?
 *   2. What client concurrency is optimal on this hardware?
 *   3. Which model is the smallest one fast enough - and how much does a bigger one cost?
 *
 *   npm run bench
 *   npm run bench -- --models llama3.2:3b,qwen2.5:1.5b --concurrency 1,2,4,6
 *   npm run bench -- --runs 12 --profile classify
 *
 * Writes data/benchmark.json. The printed table goes straight into the README.
 *
 * Method notes that make the numbers trustworthy:
 *   - a warm-up call per model is discarded, so model-load time never pollutes a sample
 *   - tokens/sec comes from Ollama's own eval_count / eval_duration, not wall clock
 *   - the same fixed prompts are used for every configuration
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { getConfig, toError } from '@oc/core';
import { OllamaClient, createLimiter, createNullCache, type OllamaMetrics } from '@oc/ollama';

interface BenchProfile {
  numPredict: number;
  system: string;
  prompts: string[];
  schema: z.ZodType<unknown>;
  jsonSchema: Record<string, unknown>;
  user: (p: string) => string;
}

type ProfileName = 'enrich' | 'classify';

/** Two shapes with very different output sizes - output tokens dominate latency. */
const PROFILES: Record<ProfileName, BenchProfile> = {
  enrich: {
    numPredict: 256,
    system: 'You enrich a company list for news monitoring. Output JSON only. Never invent facts.',
    prompts: [
      'Company name: Hailo',
      'Company name: Innoviz',
      'Company name: Morphisec',
      'Company name: ZutaCore',
      'Company name: Lemonade',
      'Company name: Cyabra',
    ],
    schema: z.object({ sector: z.string(), ambiguity: z.string() }),
    jsonSchema: {
      type: 'object',
      properties: { sector: { type: 'string' }, ambiguity: { type: 'string' } },
      required: ['sector', 'ambiguity'],
    },
    user: (p: string) => `${p}\n\nReturn JSON: {"sector": string, "ambiguity": string}`,
  },
  classify: {
    numPredict: 96,
    system:
      'You classify press sentiment toward a company from an investor perspective. Output JSON only.',
    prompts: [
      'Company: Hailo | Headline: Hailo raises $120M Series C to expand edge AI chip production',
      'Company: Lemonade | Headline: Lemonade sued over claims-handling practices in three states',
      'Company: Innoviz | Headline: Innoviz appoints new chief financial officer',
      'Company: Morphisec | Headline: Morphisec named a leader in endpoint security report',
      'Company: Cyabra | Headline: Cyabra cuts 15% of staff amid funding slowdown',
      'Company: ZutaCore | Headline: ZutaCore partners with a major data centre operator',
    ],
    schema: z.object({ sentiment: z.string(), confidence: z.number() }),
    jsonSchema: {
      type: 'object',
      properties: { sentiment: { type: 'string' }, confidence: { type: 'number' } },
      required: ['sentiment', 'confidence'],
    },
    user: (p: string) => `${p}\n\nReturn JSON: {"sentiment": string, "confidence": number}`,
  },
};

interface Sample {
  wallMs: number;
  metrics?: OllamaMetrics;
}

interface Result {
  model: string;
  concurrency: number;
  profile: ProfileName;
  samples: number;
  failures: number;
  p50WallMs: number;
  p95WallMs: number;
  meanTokensPerSecond: number;
  meanOutputTokens: number;
  throughputPerMinute: number;
  projectedMinutesFor2000: number;
}

const percentile = (values: readonly number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
};

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

function parseArgs(argv: readonly string[]) {
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cfg = getConfig();
  return {
    models: (at('--models') ?? cfg.OLLAMA_MODEL)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    concurrencies: (at('--concurrency') ?? '1,3,6')
      .split(',')
      .map((c) => Number.parseInt(c.trim(), 10))
      .filter((c) => Number.isFinite(c) && c > 0),
    runs: Number.parseInt(at('--runs') ?? '9', 10),
    profile: (at('--profile') ?? 'classify') as ProfileName,
    out: at('--out') ?? fileURLToPath(new URL('../data/benchmark.json', import.meta.url)),
  };
}

async function measure(
  model: string,
  concurrency: number,
  profileName: ProfileName,
  runs: number,
): Promise<Result> {
  const cfg = getConfig();
  const profile = PROFILES[profileName];

  const client = new OllamaClient({
    host: cfg.OLLAMA_HOST,
    model,
    numCtx: cfg.OLLAMA_NUM_CTX,
    numPredict: profile.numPredict,
    keepAlive: cfg.OLLAMA_KEEP_ALIVE,
    timeoutMs: cfg.OLLAMA_TIMEOUT_MS,
    // Caching a benchmark would measure the filesystem, not the model.
    cache: createNullCache(),
    retry: { attempts: 1 },
  });

  const call = (prompt: string, salt: number) =>
    client.generate({
      promptVersion: `bench.${profileName}.${salt}`,
      system: profile.system,
      prompt: profile.user(prompt),
      schema: profile.schema,
      jsonSchema: profile.jsonSchema,
    });

  // Warm-up: absorbs model load so it never lands in a sample.
  await call(profile.prompts[0] ?? 'warm up', -1).catch(() => undefined);

  const limit = createLimiter(concurrency);
  const samples: Sample[] = [];
  let failures = 0;

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: runs }, (_, i) =>
      limit(async () => {
        const prompt = profile.prompts[i % profile.prompts.length] ?? 'benchmark';
        const t0 = Date.now();
        try {
          const result = await call(prompt, i);
          samples.push({
            wallMs: Date.now() - t0,
            ...(result.metrics ? { metrics: result.metrics } : {}),
          });
        } catch (thrown) {
          failures += 1;
          console.error(`    ! ${model} c=${concurrency}: ${toError(thrown).message}`);
        }
      }),
    ),
  );
  const elapsedMs = Date.now() - startedAt;

  const walls = samples.map((s) => s.wallMs);
  const tps = samples.map((s) => s.metrics?.evalTokensPerSecond ?? 0).filter((v) => v > 0);
  const outTokens = samples.map((s) => s.metrics?.evalCount ?? 0).filter((v) => v > 0);
  const throughputPerMinute = elapsedMs > 0 ? (samples.length / elapsedMs) * 60_000 : 0;

  return {
    model,
    concurrency,
    profile: profileName,
    samples: samples.length,
    failures,
    p50WallMs: Math.round(percentile(walls, 50)),
    p95WallMs: Math.round(percentile(walls, 95)),
    meanTokensPerSecond: Number(mean(tps).toFixed(1)),
    meanOutputTokens: Math.round(mean(outTokens)),
    throughputPerMinute: Number(throughputPerMinute.toFixed(1)),
    projectedMinutesFor2000:
      throughputPerMinute > 0 ? Number((2000 / throughputPerMinute).toFixed(1)) : 0,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getConfig();

  const probe = new OllamaClient({
    host: cfg.OLLAMA_HOST,
    model: args.models[0] ?? cfg.OLLAMA_MODEL,
    numCtx: cfg.OLLAMA_NUM_CTX,
    numPredict: 32,
    keepAlive: cfg.OLLAMA_KEEP_ALIVE,
    timeoutMs: cfg.OLLAMA_TIMEOUT_MS,
  });
  const health = await probe.health();
  if (!health.ok) {
    console.error(`\nOllama is not ready: ${health.detail}\n`);
    process.exitCode = 1;
    return;
  }

  console.error(
    `\n  benchmark: profile=${args.profile} runs=${args.runs} ` +
      `models=[${args.models.join(', ')}] concurrency=[${args.concurrencies.join(', ')}]\n` +
      `  (each configuration warms up first; tokens/sec come from Ollama's own timings)\n`,
  );

  const results: Result[] = [];
  for (const model of args.models) {
    for (const concurrency of args.concurrencies) {
      console.error(`  running ${model} @ concurrency ${concurrency} ...`);
      results.push(await measure(model, concurrency, args.profile, args.runs));
    }
  }

  const header =
    '\n  model                     conc   p50      p95     tok/s   out tok   items/min   2000 items';
  const rows = results.map(
    (r) =>
      `  ${r.model.padEnd(24)}  ${String(r.concurrency).padStart(4)}  ` +
      `${`${(r.p50WallMs / 1000).toFixed(1)}s`.padStart(6)}  ${`${(r.p95WallMs / 1000).toFixed(1)}s`.padStart(6)}  ` +
      `${String(r.meanTokensPerSecond).padStart(6)}  ${String(r.meanOutputTokens).padStart(7)}  ` +
      `${String(r.throughputPerMinute).padStart(9)}  ${`${r.projectedMinutesFor2000} min`.padStart(11)}` +
      (r.failures > 0 ? `   (${r.failures} failed)` : ''),
  );

  const best = [...results].sort((a, b) => b.throughputPerMinute - a.throughputPerMinute)[0];
  console.error([header, '  ' + '-'.repeat(88), ...rows, ''].join('\n'));
  if (best) {
    console.error(
      `  fastest: ${best.model} at concurrency ${best.concurrency} ` +
        `(${best.throughputPerMinute} items/min, ~${best.projectedMinutesFor2000} min for a 2,000-item run)\n`,
    );
  }

  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  writeFileSync(
    args.out,
    `${JSON.stringify(
      {
        profile: args.profile,
        runs: args.runs,
        host: cfg.OLLAMA_HOST,
        numCtx: cfg.OLLAMA_NUM_CTX,
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.error(`  written -> ${args.out}\n`);
}

await main();
