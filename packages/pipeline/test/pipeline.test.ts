import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositories, initDatabase } from '@oc/core';
import { OllamaClient, createNullCache } from '@oc/ollama';
import { DEFAULT_CORPUS_PATH, FixtureProvider } from '@oc/collector';
import { exportAll, runPipeline, type PipelineCompany } from '@oc/pipeline';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;

const REGISTRY = JSON.parse(
  readFileSync(new URL('../../../data/companies.json', import.meta.url), 'utf8'),
) as PipelineCompany[];

const companies = ['ZutaCore', 'Hailo', 'Kando', 'Peak'].map((name) => {
  const found = REGISTRY.find((c) => c.name === name);
  if (!found) throw new Error(`${name} missing from the registry`);
  return found;
});

/** A fake Ollama daemon. No network, no model, deterministic answers. */
const fakeClient = (): OllamaClient =>
  new OllamaClient({
    host: 'http://fake',
    model: 'test-model',
    numCtx: 1024,
    numPredict: 96,
    keepAlive: '1m',
    timeoutMs: 1000,
    cache: createNullCache(),
    retry: { attempts: 1 },
    fetchImpl: (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            message: {
              content: JSON.stringify({
                relevant: true,
                sentiment: 'positive',
                confidence: 0.9,
                rationale: 'funding',
                evidence: 'raises',
              }),
            },
          }),
      })) as unknown as typeof fetch,
  });

const freshDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'oc-pipeline-'));
  const db = initDatabase(join(dir, 'test.sqlite'));
  return { db, dir, repositories: createRepositories(db) };
};

const run = (repositories: ReturnType<typeof createRepositories>) =>
  runPipeline({
    companies,
    providers: [FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now)],
    repositories,
    classify: { client: fakeClient() },
    windowDays: 90,
    now,
  });

describe('runPipeline (P5.1)', () => {
  it('collects, persists and classifies end to end with no network', async () => {
    const { db, repositories } = freshDb();
    const summary = await run(repositories);

    expect(summary.companies).toBe(4);
    expect(summary.articlesStored).toBeGreaterThan(0);
    expect(summary.classified).toBe(summary.relevant + summary.irrelevant);
    expect(repositories.companies.count()).toBe(4);
    db.close();
  });

  /**
   * The guarantee the whole design rests on. Re-running must be an upsert, not a duplicate -
   * otherwise the quarterly chart double-counts and the daily job alerts twice on one article.
   */
  it('is idempotent - a second identical run adds nothing', async () => {
    const { db, repositories } = freshDb();
    const first = await run(repositories);
    const articlesAfterFirst = repositories.articles.count();
    const mentionsAfterFirst = repositories.mentions.count();

    const second = await run(repositories);

    expect(first.mentionsNew).toBeGreaterThan(0);
    // Every (company, article) pair was already known, so nothing counts as new.
    expect(second.mentionsNew).toBe(0);
    expect(repositories.articles.count()).toBe(articlesAfterFirst);
    expect(repositories.mentions.count()).toBe(mentionsAfterFirst);
    db.close();
  });

  it('leaves nothing unclassified when the model answers', async () => {
    const { db, repositories } = freshDb();
    await run(repositories);
    expect(repositories.mentions.unclassified()).toHaveLength(0);
    db.close();
  });

  /** The resume path: collect first, classify later, without losing the collection. */
  it('persists articles before classification, so a killed run can resume', async () => {
    const { db, repositories } = freshDb();
    const collected = await runPipeline({
      companies,
      providers: [FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now)],
      repositories,
      classify: { client: fakeClient() },
      collectOnly: true,
      now,
    });

    expect(collected.classified).toBe(0);
    // The articles survived even though not one token was spent on them.
    expect(repositories.articles.count()).toBeGreaterThan(0);
    expect(repositories.mentions.unclassified().length).toBeGreaterThan(0);
    db.close();
  });

  it('records a run manifest', async () => {
    const { db, repositories } = freshDb();
    const summary = await run(repositories);
    const latest = repositories.runs.latest();
    expect(latest?.id).toBe(summary.runId);
    expect(latest?.status).toBe('completed');
    db.close();
  });
});

describe('exportAll (P5.4, R24)', () => {
  it('writes every company, including those with no coverage (R5)', async () => {
    const { db, dir, repositories } = freshDb();
    await run(repositories);

    const summary = exportAll({ repositories, outDir: dir, windowDays: 90, now });
    expect(summary.files).toHaveLength(3);

    const status = JSON.parse(readFileSync(join(dir, 'company_status.json'), 'utf8')) as {
      companies: Array<{ name: string; status: string; statusText: string }>;
    };
    // Four companies in, four companies out - a quiet company is not an omitted one.
    expect(status.companies).toHaveLength(4);
    expect(status.companies.map((c) => c.name).sort()).toEqual([
      'Hailo',
      'Kando',
      'Peak',
      'ZutaCore',
    ]);

    const kando = status.companies.find((c) => c.name === 'Kando');
    expect(kando?.status).toBe('NO_COVERAGE');
    expect(kando?.statusText).toBe('no coverage found');

    const zuta = status.companies.find((c) => c.name === 'ZutaCore');
    expect(zuta?.status).not.toBe('NO_COVERAGE');
    expect(zuta?.statusText).toMatch(/mentioned/);
    db.close();
  });

  it('exports mentions with a working source link (R3)', async () => {
    const { db, dir, repositories } = freshDb();
    await run(repositories);
    exportAll({ repositories, outDir: dir, windowDays: 90, now });

    const mentions = JSON.parse(readFileSync(join(dir, 'mentions.json'), 'utf8')) as {
      mentions: Array<{ url: string; title: string; sentiment: string | null }>;
    };
    expect(mentions.mentions.length).toBeGreaterThan(0);
    for (const m of mentions.mentions) {
      expect(m.url).toMatch(/^https?:\/\//);
      expect(m.title.length).toBeGreaterThan(0);
    }
    db.close();
  });

  it('summarises the quarter for the dashboard', async () => {
    const { db, dir, repositories } = freshDb();
    await run(repositories);
    exportAll({ repositories, outDir: dir, windowDays: 90, now });

    const summary = JSON.parse(readFileSync(join(dir, 'quarterly_summary.json'), 'utf8')) as {
      totals: { companies: number; mentions: number };
      companiesByStatus: Record<string, number>;
    };
    expect(summary.totals.companies).toBe(4);
    expect(summary.companiesByStatus['NO_COVERAGE']).toBeGreaterThanOrEqual(1);
    db.close();
  });
});
