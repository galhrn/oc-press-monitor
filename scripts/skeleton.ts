/**
 * Walking skeleton (task P1.8).
 *
 * Pushes ONE hardcoded company through every stage seam - collect, classify, persist,
 * aggregate - with the collector and classifier stubbed. It proves the interfaces fit
 * together before any of them is real. Integration risk found here costs minutes;
 * the same risk found in Phase 5 costs a day.
 *
 *   npm run skeleton
 */
import {
  articleId,
  bucketFor,
  canonicalizeUrl,
  childLogger,
  companyId,
  createRepositories,
  daysSince,
  describeStatus,
  initDatabase,
  mentionId,
  newRunId,
  slugify,
  toError,
  type Article,
  type Company,
  type Mention,
} from '@oc/core';

const DB_PATH = process.env['DB_PATH'] ?? './data/dev.sqlite';

/** Stub for packages/collector (P3). Returns what a NewsProvider will return. */
function stubCollect(company: Company): Article[] {
  const url = `https://example.com/news/${company.slug}-raises-series-b`;
  const canonical = canonicalizeUrl(url);
  return [
    {
      id: articleId(canonical),
      url,
      canonicalUrl: canonical,
      sourceName: 'Example Business Wire',
      title: `${company.name} raises $50M Series B to expand its platform`,
      snippet: `${company.name} announced a $50M round led by an unnamed investor.`,
      publishedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      provider: 'stub',
      language: 'en',
      raw: null,
      fetchedAt: new Date().toISOString(),
    },
  ];
}

/** Stub for packages/classifier (P4). Shape matches the real Ollama response contract. */
function stubClassify(company: Company, article: Article): Mention {
  return {
    id: mentionId(company.id, article.id),
    companyId: company.id,
    articleId: article.id,
    relevant: true,
    rejectionReason: null,
    sentiment: 'positive',
    confidence: 0.92,
    rationale: 'funding round announced',
    evidence: 'raises $50M Series B',
    model: 'stub',
    promptVersion: 'stub.v0',
    classifiedAt: new Date().toISOString(),
    firstSeenAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const runId = newRunId();
  const log = childLogger({ runId, stage: 'skeleton' });
  const db = initDatabase(DB_PATH);
  const repos = createRepositories(db);

  repos.runs.start(runId, 'skeleton');
  log.info({ db: DB_PATH }, 'walking skeleton started');

  try {
    const name = 'Hailo';
    const company: Company = {
      id: companyId(name),
      name,
      slug: slugify(name),
      aliases: ['Hailo Technologies'],
      domain: 'hailo.ai',
      sector: 'AI chips',
      ambiguity: 'medium',
      volume: 'normal',
      queryOverride: '"Hailo" AND ("AI chip" OR "edge AI" OR Israeli OR processor)',
      negativeKeywords: ['Hailo taxi', 'ladders'],
    };
    repos.companies.upsert(company);

    let newArticles = 0;
    let newMentions = 0;
    for (const article of stubCollect(company)) {
      if (repos.articles.upsert(article)) newArticles += 1;
      if (repos.mentions.upsert(stubClassify(company, article))) newMentions += 1;
    }

    const statuses = repos.statuses.all();
    for (const s of statuses) {
      const days = daysSince(s.lastMentionedAt);
      log.info(
        { company: s.name, bucket: bucketFor(days), mentions: s.mentionsInWindow },
        `${s.name}: ${describeStatus(days)}`,
      );
    }

    repos.runs.finish(runId, 'completed', {
      newArticles,
      newMentions,
      companies: repos.companies.count(),
    });
    log.info({ newArticles, newMentions }, 'walking skeleton completed - every seam holds');
  } catch (thrown) {
    const err = toError(thrown);
    repos.runs.finish(runId, 'failed', { error: err.message });
    log.error({ err }, 'walking skeleton failed');
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

await main();
