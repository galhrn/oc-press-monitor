import { beforeEach, describe, expect, it } from 'vitest';
import {
  articleId,
  canonicalizeUrl,
  companyId,
  createRepositories,
  initDatabase,
  mentionId,
  slugify,
  type Article,
  type Company,
  type Mention,
  type Repositories,
} from '@oc/core';

let repos: Repositories;

const makeCompany = (name: string, over: Partial<Company> = {}): Company => ({
  id: companyId(name),
  name,
  slug: slugify(name),
  aliases: [],
  domain: null,
  sector: null,
  ambiguity: 'low',
  volume: 'normal',
  queryOverride: null,
  negativeKeywords: [],
  ...over,
});

const makeArticle = (url: string, title = 'Headline'): Article => {
  const canonical = canonicalizeUrl(url);
  return {
    id: articleId(canonical),
    url,
    canonicalUrl: canonical,
    sourceName: 'Example News',
    title,
    snippet: 'Snippet',
    publishedAt: '2026-07-20T00:00:00.000Z',
    provider: 'fixture',
    language: 'en',
    raw: null,
    fetchedAt: new Date().toISOString(),
  };
};

const makeMention = (c: Company, a: Article, over: Partial<Mention> = {}): Mention => ({
  id: mentionId(c.id, a.id),
  companyId: c.id,
  articleId: a.id,
  relevant: true,
  rejectionReason: null,
  sentiment: 'positive',
  confidence: 0.9,
  rationale: 'raised a round',
  evidence: 'raises $50M',
  model: 'llama3.2:3b',
  promptVersion: 'classify.v1',
  classifiedAt: new Date().toISOString(),
  firstSeenAt: new Date().toISOString(),
  ...over,
});

beforeEach(() => {
  repos = createRepositories(initDatabase(':memory:'));
});

describe('CompanyRepository', () => {
  it('upserts idempotently', () => {
    const c = makeCompany('Hailo');
    repos.companies.upsert(c);
    repos.companies.upsert({ ...c, sector: 'AI chips' });
    expect(repos.companies.count()).toBe(1);
    expect(repos.companies.bySlug('hailo')?.sector).toBe('AI chips');
  });

  it('round-trips JSON columns', () => {
    repos.companies.upsert(
      makeCompany('Peak', { ambiguity: 'critical', negativeKeywords: ['peak season', 'peak oil'] }),
    );
    const peak = repos.companies.bySlug('peak');
    expect(peak?.ambiguity).toBe('critical');
    expect(peak?.negativeKeywords).toEqual(['peak season', 'peak oil']);
  });

  it('writes many companies in one transaction', () => {
    expect(repos.companies.upsertMany([makeCompany('A'), makeCompany('B'), makeCompany('C')])).toBe(
      3,
    );
    expect(repos.companies.count()).toBe(3);
  });
});

describe('ArticleRepository', () => {
  it('deduplicates two providers linking the same article', () => {
    expect(repos.articles.upsert(makeArticle('https://www.example.com/a?utm_source=gdelt'))).toBe(
      true,
    );
    expect(repos.articles.upsert(makeArticle('http://example.com/a/'))).toBe(false);
    expect(repos.articles.count()).toBe(1);
  });
});

describe('MentionRepository', () => {
  it('reports a genuinely new mention exactly once - the daily alert depends on this (A5)', () => {
    const c = makeCompany('Hailo');
    const a = makeArticle('https://example.com/hailo-raises');
    repos.companies.upsert(c);
    repos.articles.upsert(a);

    expect(repos.mentions.upsert(makeMention(c, a))).toBe(true);
    expect(repos.mentions.upsert(makeMention(c, a, { sentiment: 'neutral' }))).toBe(false);
    expect(repos.mentions.count()).toBe(1);
  });

  it('lists unclassified mentions', () => {
    const c = makeCompany('Hailo');
    const a = makeArticle('https://example.com/x');
    repos.companies.upsert(c);
    repos.articles.upsert(a);
    repos.mentions.upsert(
      makeMention(c, a, { classifiedAt: null, sentiment: null, relevant: null }),
    );
    expect(repos.mentions.unclassified()).toHaveLength(1);
  });
});

describe('StatusRepository', () => {
  it('returns companies with no coverage rather than omitting them (R5)', () => {
    repos.companies.upsert(makeCompany('Silent Corp'));
    const [status] = repos.statuses.all();
    expect(status?.bucket).toBe('NO_COVERAGE');
    expect(status?.lastMentionedAt).toBeNull();
    expect(status?.mentionsInWindow).toBe(0);
  });

  it('aggregates sentiment counts for a covered company', () => {
    const c = makeCompany('Hailo');
    repos.companies.upsert(c);
    const recent = new Date(Date.now() - 3 * 86_400_000).toISOString();
    for (const [i, sentiment] of (['positive', 'positive', 'negative'] as const).entries()) {
      const a = { ...makeArticle(`https://example.com/n${i}`), publishedAt: recent };
      repos.articles.upsert(a);
      repos.mentions.upsert(makeMention(c, a, { sentiment }));
    }
    const [status] = repos.statuses.all();
    expect(status?.mentionsInWindow).toBe(3);
    expect(status?.positive).toBe(2);
    expect(status?.negative).toBe(1);
    expect(status?.bucket).toBe('FRESH');
  });

  it('excludes irrelevant mentions from the counts', () => {
    const c = makeCompany('Peak');
    const a = makeArticle('https://example.com/mountaineering');
    repos.companies.upsert(c);
    repos.articles.upsert(a);
    repos.mentions.upsert(
      makeMention(c, a, { relevant: false, rejectionReason: 'entity_mismatch', sentiment: null }),
    );
    const [status] = repos.statuses.all();
    expect(status?.mentionsInWindow).toBe(0);
    expect(status?.bucket).toBe('NO_COVERAGE');
  });
});

describe('RunRepository', () => {
  it('records a run lifecycle', () => {
    repos.runs.start('run-1', 'skeleton');
    repos.runs.finish('run-1', 'completed', { articles: 3 });
    const latest = repos.runs.latest();
    expect(latest?.status).toBe('completed');
    expect(latest?.stats).toEqual({ articles: 3 });
    expect(latest?.finishedAt).not.toBeNull();
  });
});

describe('KeyValueRepository', () => {
  it('stores and overwrites watermarks', () => {
    repos.kv.set('daily:last_run_at', '2026-07-30T08:00:00.000Z');
    repos.kv.set('daily:last_run_at', '2026-07-31T08:00:00.000Z');
    expect(repos.kv.get('daily:last_run_at')).toBe('2026-07-31T08:00:00.000Z');
    expect(repos.kv.get('missing')).toBeUndefined();
  });
});
