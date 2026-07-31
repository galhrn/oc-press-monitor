/**
 * Company registry builder (task P2.3, decision AD-21).
 *
 *   npm run enrich                 # enrich via local Ollama, then write data/companies.json
 *   npm run enrich -- --offline    # skip Ollama, use the approved triage + fallbacks
 *   npm run enrich -- --limit 20   # short dev loop
 *   npm run enrich -- --no-cache   # ignore cached enrichments
 *   npm run enrich -- --seed path  # use a different company list
 *
 * Why both an Ollama path and committed output: task section 4.1 requires that any text
 * understanding step run on a local model, and the reviewers may substitute their own
 * company list. The script satisfies both. For the 57 names a human triaged as
 * CRITICAL or HIGH, the approved query always wins over anything the model says.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, childLogger, newRunId, toError } from '@oc/core';
import { OllamaClient, createFileCache, createLimiter, createNullCache } from '@oc/ollama';
import {
  buildRegistry,
  parseSeedList,
  summarise,
  EnrichmentSchema,
  ENRICHMENT_JSON_SCHEMA,
  TriageFileSchema,
  type Enrichment,
} from '@oc/registry';
import { parseArgs } from './args.js';

const PROMPT_VERSION = 'enrich-company.v1';

const SYSTEM_PROMPT = `You enrich a venture-capital portfolio company list for news monitoring.

Given only a company name, you infer what is needed to search for news about that
specific company and not about other things that share its name.

Rules:
- Output JSON only. No prose, no markdown, no explanation.
- If you do not recognise the company, say so with "known": false and still supply your
  best guess for the remaining fields. Never invent a funding history, a founder, or a
  headquarters.
- "ambiguity" describes the NAME, not the company: how likely is a plain news search for
  this name to return articles about something else entirely?
    critical - the name is an ordinary word or a very short token ("Peak", "Ro", "Wave")
    high     - a large, well-known other entity shares the name ("Astra", "Lemonade")
    medium   - a real but manageable collision ("Kodiak Robotics", "Alloy Therapeutics")
    low      - the name is distinctive ("ZutaCore", "Morphisec")
- "contextTerms" are words that co-occur with genuine coverage of this company. Prefer
  its industry and product category over generic words like "startup" or "company".
- "negativeKeywords" are the things a naive search would wrongly return. Be specific:
  "Honda motorcycle" is useful, "other" is not.
- Keep every list to at most 5 entries, ordered most useful first.`;

const userPrompt = (name: string): string =>
  `Company name: ${name}

Return JSON matching this shape:
{
  "known": boolean,
  "sector": string,
  "aliases": string[],
  "domain": string | null,
  "ambiguity": "critical" | "high" | "medium" | "low",
  "contextTerms": string[],
  "negativeKeywords": string[]
}`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = getConfig();
  const runId = newRunId();
  const log = childLogger({ runId, stage: 'enrich' });

  const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
  const seed = parseSeedList(readFileSync(args.seedPath, 'utf8'));
  const triage = TriageFileSchema.parse(
    JSON.parse(readFileSync(here('../packages/registry/data/query-triage.json'), 'utf8')),
  );

  const targets = args.limit ? seed.slice(0, args.limit) : seed;
  log.info({ companies: targets.length, offline: args.offline }, 'building company registry');

  if (args.redirected) {
    log.warn({ out: args.outPath }, 'partial run - not writing the committed registry');
    console.error(
      `\n  --limit ${args.limit} is a partial run, so it will NOT overwrite data/companies.json.\n` +
        `  Writing to ${args.outPath} instead. Pass --out to choose a different path.\n`,
    );
  }

  const enrichments = new Map<string, Enrichment>();
  let failures = 0;

  if (!args.offline) {
    const client = new OllamaClient({
      host: cfg.OLLAMA_HOST,
      model: cfg.OLLAMA_MODEL,
      numCtx: cfg.OLLAMA_NUM_CTX,
      numPredict: 256, // enrichment returns more fields than a classification does
      keepAlive: cfg.OLLAMA_KEEP_ALIVE,
      timeoutMs: cfg.OLLAMA_TIMEOUT_MS,
      cache: args.noCache ? createNullCache() : createFileCache(here('../.cache/enrich')),
      logger: log,
    });

    const health = await client.health();
    if (!health.ok) {
      log.error({ detail: health.detail }, 'Ollama is not ready');
      console.error(
        `\nOllama is not ready: ${health.detail}\n` +
          `Start it with \`ollama serve\` and \`ollama pull ${cfg.OLLAMA_MODEL}\`,\n` +
          `or run \`npm run enrich -- --offline\` to build from the approved triage alone.\n`,
      );
      process.exitCode = 1;
      return;
    }

    const limit = createLimiter(cfg.OLLAMA_CONCURRENCY);
    let done = 0;
    await Promise.all(
      targets.map((company) =>
        limit(async () => {
          try {
            const result = await client.generate({
              promptVersion: PROMPT_VERSION,
              system: SYSTEM_PROMPT,
              prompt: userPrompt(company.name),
              schema: EnrichmentSchema,
              jsonSchema: ENRICHMENT_JSON_SCHEMA,
            });
            enrichments.set(company.name, result.value);
          } catch (thrown) {
            // One company failing must never abort a 258-company run (R26).
            failures += 1;
            log.warn({ company: company.name, err: toError(thrown).message }, 'enrichment failed');
          } finally {
            done += 1;
            if (done % 25 === 0) log.info({ done, of: targets.length }, 'progress');
          }
        }),
      ),
    );
    log.info({ ...client.cacheStats, failures }, 'enrichment complete');
  }

  const records = buildRegistry({
    seed: targets,
    triage,
    enrichments,
    model: args.offline ? 'offline' : cfg.OLLAMA_MODEL,
  });

  mkdirSync(dirname(resolve(args.outPath)), { recursive: true });
  writeFileSync(args.outPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');

  const summary = summarise(records);
  log.info(summary, 'registry written');
  console.error(
    [
      '',
      `  registry -> ${args.outPath}`,
      `  companies          ${summary.total}`,
      `  human-approved     ${summary.bySource['human-approved']}  (the 57 triaged names)`,
      `  llm-enriched       ${summary.bySource['llm-enriched']}`,
      `  triage-default     ${summary.bySource['triage-default']}  (unreviewed medium/low names)`,
      `  fallback           ${summary.bySource.fallback}`,
      `  critical / high    ${summary.byAmbiguity.critical} / ${summary.byAmbiguity.high}`,
      `  high news volume   ${summary.highVolume}  (capped by MAX_ITEMS_PER_COMPANY)`,
      `  with a sector      ${summary.withSector}`,
      failures > 0 ? `  enrichment failures ${failures}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

await main();
