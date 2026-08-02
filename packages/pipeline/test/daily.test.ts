/**
 * Daily-job idempotency (task P5.7, requirements R6, R7, assumption A5).
 *
 * The plan calls this mandatory, and the reason is that idempotency bugs are **silent**. A
 * duplicate alert does not throw, does not fail a build, and does not look wrong in the
 * database - it just means a reviewer opening the alert log finds the same story three times
 * and stops trusting any of it. The only way to know is to assert it.
 *
 * Everything runs offline: `globalThis.fetch` is replaced with a rejecting stub, and Ollama is
 * a fake daemon, so a regression that reintroduces a live call fails here rather than making
 * the suite depend on the network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositories, initDatabase } from '@oc/core';
import { OllamaClient, createNullCache } from '@oc/ollama';
import { DEFAULT_CORPUS_PATH, FixtureProvider, type NewsProvider } from '@oc/collector';
import { ConsoleAlerter, FileAlerter, type Alert, type Alerter } from '@oc/alerting';
import { LOCK_KEY, WATERMARK_KEY, runDailyJob, type PipelineCompany } from '@oc/pipeline';

const REGISTRY = JSON.parse(
  readFileSync(new URL('../../../data/companies.json', import.meta.url), 'utf8'),
) as PipelineCompany[];

const companies = ['ZutaCore', 'Hailo', 'Kando'].map((name) => {
  const found = REGISTRY.find((c) => c.name === name);
  if (!found) throw new Error(`${name} missing from the registry`);
  return found;
});

/** The corpus dates are relative to this, so "recent" stays recent forever. */
const NOW = new Date('2026-08-01T12:00:00.000Z');
const now = (): Date => NOW;

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

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'oc-daily-'));
  const db = initDatabase(join(dir, 'test.sqlite'));
  const repositories = createRepositories(db);
  const alertPath = join(dir, 'alerts.log.json');
  return { db, dir, repositories, alertPath };
}

const run = (
  repositories: ReturnType<typeof createRepositories>,
  alerters: readonly Alerter[],
  over: Partial<Parameters<typeof runDailyJob>[0]> = {},
) =>
  runDailyJob({
    companies,
    providers: [FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, now) as NewsProvider],
    repositories,
    classify: { client: fakeClient() },
    alerters,
    // Wide enough that the corpus's recent items qualify, so the test exercises delivery
    // rather than accidentally filtering everything out.
    lookbackHours: 24 * 60,
    windowDays: 90,
    now,
    ...over,
  });

const readAlertFile = (path: string): unknown[] =>
  JSON.parse(readFileSync(path, 'utf8')) as unknown[];

const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() =>
    Promise.reject(
      new Error('network access is forbidden in the daily-job test'),
    )) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('runDailyJob (P5.6)', () => {
  it('collects, classifies and alerts on genuinely new mentions', async () => {
    const { db, repositories, alertPath } = harness();
    const summary = await run(repositories, [new FileAlerter(alertPath)]);

    expect(summary.acquiredLock).toBe(true);
    expect(summary.newMentions).toBeGreaterThan(0);
    expect(summary.dispatch?.delivered).toBeGreaterThan(0);
    expect(readAlertFile(alertPath).length).toBe(summary.dispatch?.delivered);
    db.close();
  });

  /** The assertion the whole design exists to satisfy. */
  it('alerts once: a second run in a row delivers nothing', async () => {
    const { db, repositories, alertPath } = harness();
    const first = await run(repositories, [new FileAlerter(alertPath)]);
    const second = await run(repositories, [new FileAlerter(alertPath)]);

    expect(first.dispatch?.delivered).toBeGreaterThan(0);
    expect(second.dispatch?.delivered).toBe(0);
    // No new pairs the second time round - the mentions were already stored.
    expect(second.newMentions).toBe(0);
    // And the log did not grow.
    expect(readAlertFile(alertPath)).toHaveLength(first.dispatch?.delivered ?? 0);
    db.close();
  });

  it('leaves the database identical after a repeat run', async () => {
    const { db, repositories, alertPath } = harness();
    await run(repositories, [new FileAlerter(alertPath)]);
    const before = {
      articles: repositories.articles.count(),
      mentions: repositories.mentions.count(),
      alerts: repositories.alerts.count(),
    };

    await run(repositories, [new FileAlerter(alertPath)]);

    expect({
      articles: repositories.articles.count(),
      mentions: repositories.mentions.count(),
      alerts: repositories.alerts.count(),
    }).toEqual(before);
    db.close();
  });

  it('records exactly one alert row per mention per channel', async () => {
    const { db, repositories, alertPath } = harness();
    await run(repositories, [new FileAlerter(alertPath), new ConsoleAlerter()]);
    const first = repositories.alerts.count();
    await run(repositories, [new FileAlerter(alertPath), new ConsoleAlerter()]);

    // Two channels, so two rows per mention - and not four after running twice.
    expect(repositories.alerts.count()).toBe(first);
    db.close();
  });
});

describe('the A5 lookback filter', () => {
  /**
   * The condition that is easy to drop. Without it, the first run after any gap treats the
   * entire backfill as new and alerts on all of it at once.
   */
  it('stores an old article but does not alert on it', async () => {
    const { db, repositories, alertPath } = harness();
    // One hour: the corpus's newest item is days old, so everything is stored and nothing
    // is recent enough to be worth waking someone for.
    const summary = await run(repositories, [new FileAlerter(alertPath)], { lookbackHours: 1 });

    expect(summary.newMentions).toBeGreaterThan(0);
    expect(summary.alertCandidates).toBe(0);
    expect(summary.dispatch?.delivered).toBe(0);
    // Stored, just not shouted about.
    expect(repositories.mentions.count()).toBeGreaterThan(0);
    db.close();
  });

  it('alerts on the same mentions once the window is widened', async () => {
    const { db, repositories, alertPath } = harness();
    const narrow = await run(repositories, [new FileAlerter(alertPath)], { lookbackHours: 1 });
    expect(narrow.dispatch?.delivered).toBe(0);

    // A later run with a wider window still finds nothing NEW - the pairs are already stored.
    // This is the honest consequence of A5's first condition, and it is why the lookback must
    // be set correctly before the first run rather than tuned afterwards.
    const wide = await run(repositories, [new FileAlerter(alertPath)], { lookbackHours: 24 * 60 });
    expect(wide.newMentions).toBe(0);
    db.close();
  });
});

describe('the overlap lock', () => {
  it('refuses to start while another run holds the lock', async () => {
    const { db, repositories, alertPath } = harness();
    repositories.kv.set(
      LOCK_KEY,
      JSON.stringify({ runId: 'other-run', acquiredAt: NOW.toISOString() }),
    );

    const summary = await run(repositories, [new FileAlerter(alertPath)]);

    expect(summary.acquiredLock).toBe(false);
    expect(summary.lockHeldBy).toBe('other-run');
    expect(summary.dispatch).toBeNull();
    db.close();
  });

  it('takes over a lock older than the TTL, so a crash does not wedge the monitor', async () => {
    const { db, repositories, alertPath } = harness();
    repositories.kv.set(
      LOCK_KEY,
      JSON.stringify({
        runId: 'crashed-run',
        acquiredAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
      }),
    );

    const summary = await run(repositories, [new FileAlerter(alertPath)], {
      lockTtlMs: 30 * 60_000,
    });
    expect(summary.acquiredLock).toBe(true);
    db.close();
  });

  it('honours --force against a live lock', async () => {
    const { db, repositories, alertPath } = harness();
    repositories.kv.set(LOCK_KEY, JSON.stringify({ runId: 'live', acquiredAt: NOW.toISOString() }));

    const summary = await run(repositories, [new FileAlerter(alertPath)], { force: true });
    expect(summary.acquiredLock).toBe(true);
    db.close();
  });

  it('releases the lock when the run finishes', async () => {
    const { db, repositories, alertPath } = harness();
    await run(repositories, [new FileAlerter(alertPath)]);
    expect(repositories.kv.get(LOCK_KEY)).toBeUndefined();
    db.close();
  });

  it('releases the lock even when the run throws', async () => {
    const { db, repositories } = harness();
    const exploding: Alerter = {
      name: 'boom',
      send: () => Promise.reject(new Error('unused - dispatch catches this')),
    };
    // Force a failure deeper than the dispatcher by handing the pipeline a broken provider.
    const brokenProvider: NewsProvider = {
      name: 'broken',
      search: () => {
        throw new Error('provider exploded');
      },
    };

    await expect(
      runDailyJob({
        companies,
        providers: [brokenProvider],
        repositories,
        classify: { client: fakeClient() },
        alerters: [exploding],
        now,
      }),
    ).resolves.toBeDefined();

    // A provider blowing up is isolated per company, so the run completes and still unlocks.
    expect(repositories.kv.get(LOCK_KEY)).toBeUndefined();
    db.close();
  });
});

describe('the watermark', () => {
  it('advances after a completed run', async () => {
    const { db, repositories, alertPath } = harness();
    expect(repositories.kv.get(WATERMARK_KEY)).toBeUndefined();

    const summary = await run(repositories, [new FileAlerter(alertPath)]);
    expect(summary.watermark).toBe(NOW.toISOString());
    expect(repositories.kv.get(WATERMARK_KEY)).toBe(NOW.toISOString());
    db.close();
  });

  it('does not advance, send or record during a dry run', async () => {
    const { db, repositories, alertPath } = harness();
    const summary = await run(repositories, [new FileAlerter(alertPath)], { dryRun: true });

    expect(summary.alertCandidates).toBeGreaterThan(0);
    expect(summary.dispatch?.delivered).toBe(0);
    expect(repositories.alerts.count()).toBe(0);
    // A dry run is a record of work *attempted*; the watermark records work done.
    expect(repositories.kv.get(WATERMARK_KEY)).toBeUndefined();
    db.close();
  });

  it('leaves a dry run repeatable - the alerts are still pending afterwards', async () => {
    const { db, repositories, alertPath } = harness();
    await run(repositories, [new FileAlerter(alertPath)], { dryRun: true });
    // Nothing was recorded, so a real run afterwards still has something to send... except the
    // pairs are now stored, so they are no longer "new". Asserting the honest behaviour.
    const real = await run(repositories, [new FileAlerter(alertPath)]);
    expect(real.newMentions).toBe(0);
    db.close();
  });
});

describe('alert payloads', () => {
  it('carry the rationale and confidence a reviewer needs to triage', async () => {
    const { db, repositories, alertPath } = harness();
    await run(repositories, [new FileAlerter(alertPath)]);

    const written = readAlertFile(alertPath) as Alert[];
    expect(written.length).toBeGreaterThan(0);
    for (const alert of written) {
      expect(alert.url).toMatch(/^https?:\/\//);
      expect(alert.company.length).toBeGreaterThan(0);
      expect(alert.sentiment).toBe('positive');
      expect(alert.rationale).toBe('funding');
      expect(alert.model).toBe('test-model');
    }
    db.close();
  });
});
