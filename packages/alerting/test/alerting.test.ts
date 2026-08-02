import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRepositories, initDatabase, mentionId } from '@oc/core';
import {
  ConsoleAlerter,
  FileAlerter,
  dispatchAlerts,
  formatAlertLine,
  type Alert,
  type Alerter,
} from '@oc/alerting';

const alert = (over: Partial<Alert> = {}): Alert => ({
  mentionId: mentionId('company-1', 'article-1'),
  company: 'Hailo',
  companySlug: 'hailo',
  title: 'Hailo raises $180M Series D',
  url: 'https://techcrunch.com/hailo',
  source: 'techcrunch.com',
  publishedAt: '2026-07-28T00:00:00.000Z',
  sentiment: 'positive',
  confidence: 0.9,
  rationale: 'funding round',
  model: 'llama3.2:3b',
  detectedAt: '2026-08-03T08:00:00.000Z',
  ...over,
});

/** A database with the one company/article/mention the alerts reference. */
function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'oc-alerts-'));
  const db = initDatabase(join(dir, 'test.sqlite'));
  const repositories = createRepositories(db);
  repositories.companies.upsert({
    id: 'company-1',
    name: 'Hailo',
    slug: 'hailo',
    aliases: [],
    domain: null,
    sector: null,
    ambiguity: 'low',
    volume: 'normal',
    queryOverride: null,
    negativeKeywords: [],
  });
  repositories.articles.upsert({
    id: 'article-1',
    url: 'https://techcrunch.com/hailo',
    canonicalUrl: 'https://techcrunch.com/hailo',
    sourceName: 'techcrunch.com',
    title: 'Hailo raises $180M Series D',
    snippet: null,
    publishedAt: '2026-07-28T00:00:00.000Z',
    provider: 'test',
    language: 'en',
    raw: {},
    fetchedAt: '2026-08-03T08:00:00.000Z',
  });
  repositories.mentions.upsert({
    id: mentionId('company-1', 'article-1'),
    companyId: 'company-1',
    articleId: 'article-1',
    relevant: true,
    rejectionReason: null,
    sentiment: 'positive',
    confidence: 0.9,
    rationale: 'funding round',
    evidence: 'raises',
    model: 'llama3.2:3b',
    promptVersion: 'classify.v1',
    classifiedAt: '2026-08-03T08:00:00.000Z',
    firstSeenAt: '2026-08-03T08:00:00.000Z',
  });
  repositories.runs.start('run-1', 'daily');
  return { db, dir, repositories };
}

describe('FileAlerter', () => {
  it('writes a readable JSON array with the full payload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-alertfile-'));
    const path = join(dir, 'alerts.log.json');
    const outcome = await new FileAlerter(path).send([alert()]);

    expect(outcome).toMatchObject({ channel: 'file', delivered: 1, failed: 0 });
    const written = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, unknown>>;
    expect(written).toHaveLength(1);
    // The rationale and confidence are the point: an alert a reader cannot triage is ignored.
    expect(written[0]).toMatchObject({
      company: 'Hailo',
      sentiment: 'positive',
      rationale: 'funding round',
      confidence: 0.9,
      channel: 'file',
    });
  });

  it('appends across runs rather than overwriting history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-alertfile-'));
    const path = join(dir, 'alerts.log.json');
    const sink = new FileAlerter(path);
    await sink.send([alert()]);
    await sink.send([alert({ mentionId: 'm2', title: 'Second story' })]);

    const written = JSON.parse(readFileSync(path, 'utf8')) as unknown[];
    expect(written).toHaveLength(2);
  });

  it('recovers from a corrupt log instead of refusing to deliver', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-alertfile-'));
    const path = join(dir, 'alerts.log.json');
    writeFileSync(path, 'not json at all', 'utf8');

    const outcome = await new FileAlerter(path).send([alert()]);
    expect(outcome.delivered).toBe(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveLength(1);
  });

  it('does nothing for an empty batch', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-alertfile-'));
    const outcome = await new FileAlerter(join(dir, 'alerts.log.json')).send([]);
    expect(outcome).toMatchObject({ delivered: 0, failed: 0 });
  });
});

describe('ConsoleAlerter', () => {
  it('renders one line per alert with the source link', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await new ConsoleAlerter().send([alert()]);
    const output = spy.mock.calls.flat().join('\n');
    spy.mockRestore();

    expect(output).toContain('Hailo raises $180M Series D');
    expect(output).toContain('https://techcrunch.com/hailo');
    expect(output).toContain('funding round');
  });
});

describe('formatAlertLine', () => {
  it('shows the date, sentiment and company', () => {
    expect(formatAlertLine(alert())).toContain('2026-07-28');
    expect(formatAlertLine(alert())).toContain('POSITIVE');
  });

  it('says so when a mention was never classified', () => {
    expect(formatAlertLine(alert({ sentiment: null }))).toContain('UNCLASSIFIED');
  });
});

describe('dispatchAlerts', () => {
  it('delivers to every configured sink and records each one', async () => {
    const { db, dir, repositories } = freshDb();
    const summary = await dispatchAlerts({
      alerts: [alert()],
      sinks: [new FileAlerter(join(dir, 'alerts.log.json'))],
      repositories,
      runId: 'run-1',
    });

    expect(summary).toMatchObject({ candidates: 1, delivered: 1, skipped: 0, failed: 0 });
    expect(repositories.alerts.count()).toBe(1);
    db.close();
  });

  /** The guarantee the daily job rests on. */
  it('never sends the same mention twice on the same channel', async () => {
    const { db, dir, repositories } = freshDb();
    const sink = new FileAlerter(join(dir, 'alerts.log.json'));

    const first = await dispatchAlerts({
      alerts: [alert()],
      sinks: [sink],
      repositories,
      runId: 'run-1',
    });
    const second = await dispatchAlerts({
      alerts: [alert()],
      sinks: [sink],
      repositories,
      runId: 'run-1',
    });

    expect(first.delivered).toBe(1);
    expect(second.delivered).toBe(0);
    expect(second.skipped).toBe(1);
    // One row, and one entry in the file - the second run wrote nothing at all.
    expect(repositories.alerts.count()).toBe(1);
    expect(JSON.parse(readFileSync(join(dir, 'alerts.log.json'), 'utf8'))).toHaveLength(1);
    db.close();
  });

  it('treats channels independently', async () => {
    const { db, dir, repositories } = freshDb();
    await dispatchAlerts({
      alerts: [alert()],
      sinks: [new FileAlerter(join(dir, 'alerts.log.json'))],
      repositories,
      runId: 'run-1',
    });
    // The same mention has not been sent to the console yet, so it still should be.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const summary = await dispatchAlerts({
      alerts: [alert()],
      sinks: [new ConsoleAlerter()],
      repositories,
      runId: 'run-1',
    });
    spy.mockRestore();

    expect(summary.delivered).toBe(1);
    expect(repositories.alerts.count()).toBe(2);
    db.close();
  });

  /**
   * At-least-once, chosen deliberately. Nothing is recorded when a sink fails, so the next
   * run retries - a repeated alert is recoverable, a silently dropped one is not.
   */
  it('records nothing when a sink throws, so the next run retries', async () => {
    const { db, repositories } = freshDb();
    const broken: Alerter = {
      name: 'broken',
      send: () => Promise.reject(new Error('webhook down')),
    };

    const summary = await dispatchAlerts({
      alerts: [alert()],
      sinks: [broken],
      repositories,
      runId: 'run-1',
    });

    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(0);
    expect(repositories.alerts.count()).toBe(0);
    expect(repositories.alerts.wasSent(alert().mentionId, 'broken')).toBe(false);
    db.close();
  });

  it('does not let one broken sink stop a working one', async () => {
    const { db, dir, repositories } = freshDb();
    const broken: Alerter = { name: 'broken', send: () => Promise.reject(new Error('down')) };
    const working = new FileAlerter(join(dir, 'alerts.log.json'));

    const summary = await dispatchAlerts({
      alerts: [alert()],
      sinks: [broken, working],
      repositories,
      runId: 'run-1',
    });

    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(1);
    db.close();
  });

  it('sends and records nothing in a dry run', async () => {
    const { db, dir, repositories } = freshDb();
    const summary = await dispatchAlerts({
      alerts: [alert()],
      sinks: [new FileAlerter(join(dir, 'alerts.log.json'))],
      repositories,
      runId: 'run-1',
      dryRun: true,
    });

    expect(summary.candidates).toBe(1);
    expect(summary.delivered).toBe(0);
    expect(repositories.alerts.count()).toBe(0);
    db.close();
  });
});
