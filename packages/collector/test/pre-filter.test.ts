import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_CORPUS_PATH,
  FixtureProvider,
  articleDomain,
  preFilter,
  preFilterAll,
  type PreFilterCompany,
  type RawArticle,
} from '@oc/collector';

/** The committed registry is the real input this filter will see in production. */
const REGISTRY: PreFilterCompany[] = JSON.parse(
  readFileSync(new URL('../../../data/companies.json', import.meta.url), 'utf8'),
) as PreFilterCompany[];

const company = (name: string): PreFilterCompany => {
  const found = REGISTRY.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not in the committed registry`);
  return found;
};

const NOW = new Date('2026-08-01T12:00:00.000Z');
const provider = FixtureProvider.fromFile(DEFAULT_CORPUS_PATH, () => NOW);
const corpusFor = (query: string): Promise<RawArticle[]> =>
  provider.search({
    query,
    from: new Date(NOW.getTime() - 90 * 86_400_000).toISOString(),
    limit: 50,
  });

const article = (over: Partial<RawArticle> = {}): RawArticle => ({
  url: 'https://techcrunch.com/a',
  title: 'Hailo raises $180M Series D to scale edge AI processors',
  snippet: null,
  sourceName: 'techcrunch.com',
  publishedAt: '2026-07-28T00:00:00.000Z',
  language: 'en',
  provider: 'gdelt',
  raw: {},
  ...over,
});

describe('articleDomain', () => {
  it('reads the host and drops the www prefix', () => {
    expect(articleDomain(article({ url: 'https://www.Reuters.com/x' }))).toBe('reuters.com');
  });

  it('falls back to the provider-reported source when the url is unusable', () => {
    expect(articleDomain(article({ url: 'not a url', sourceName: 'WWW.Calcalist.co.il' }))).toBe(
      'calcalist.co.il',
    );
  });
});

describe('preFilter', () => {
  it('keeps a genuine article and reports which name matched', () => {
    const verdict = preFilter(article(), company('Hailo'));
    expect(verdict).toMatchObject({ keep: true, reason: null, evidence: 'Hailo' });
  });

  it('rejects an article that never names the company', () => {
    const verdict = preFilter(article({ title: 'Nvidia announces a new GPU' }), company('Hailo'));
    expect(verdict).toMatchObject({ keep: false, reason: 'no-name-match' });
  });

  it('requires a whole word, so a substring near-miss is rejected', () => {
    // The single most important line in the filter for a CRITICAL-tier name.
    const verdict = preFilter(
      article({ title: 'Peakhurst mixed-use development wins approval' }),
      company('Peak'),
    );
    expect(verdict).toMatchObject({ keep: false, reason: 'no-name-match' });
  });

  it('rejects on a human-approved negative keyword and names the term', () => {
    const verdict = preFilter(
      article({ title: 'Harvey Keitel joins the cast', url: 'https://variety.com/x' }),
      company('Harvey'),
    );
    expect(verdict).toMatchObject({ keep: false, reason: 'negative-keyword' });
    expect(verdict.evidence).toBe('Harvey Keitel');
  });

  it('treats negative keywords as whitespace-sensitive, not squashed', () => {
    const launchpad = company('Launchpad');
    expect(launchpad.negativeKeywords).toContain('launch pad');

    // An article naming Launchpad that also says "launch pad" is rocket coverage that
    // happened to collide, and the human-approved negative must take it out.
    expect(
      preFilter(
        article({ title: 'Launchpad Space rolls its booster out to the launch pad' }),
        launchpad,
      ),
    ).toMatchObject({ keep: false, reason: 'negative-keyword', evidence: 'launch pad' });

    // An article that never names the company is rejected earlier and more cheaply.
    expect(
      preFilter(article({ title: 'SpaceX repairs the launch pad after a static fire' }), launchpad),
    ).toMatchObject({ keep: false, reason: 'no-name-match' });

    // ...while "Launchpad" (one word) is the company and must survive. Squashing whitespace
    // before matching would make this company reject 100% of its own coverage.
    expect(
      preFilter(article({ title: 'Launchpad raises a Series A for its platform' }), launchpad),
    ).toMatchObject({ keep: true });
  });

  it('rejects a blocked domain before doing any other work', () => {
    const verdict = preFilter(
      article({ url: 'https://finance.biggo.com/hailo-story' }),
      company('Hailo'),
    );
    expect(verdict).toMatchObject({ keep: false, reason: 'blocked-domain' });
  });

  it('matches a blocked domain on subdomains too', () => {
    expect(
      preFilter(article({ url: 'https://en.newswav.com/x' }), company('Hailo'), {
        blockedDomains: ['newswav.com'],
      }),
    ).toMatchObject({ keep: false, reason: 'blocked-domain' });
  });

  it('matches an alias the canonical name would miss', () => {
    // The spacing variant is the case that matters: "Together AI" does not whole-word
    // match "TogetherAI", so without the alias this real article would be dropped.
    const withAlias: PreFilterCompany = {
      id: 'x',
      name: 'Together AI',
      aliases: ['TogetherAI'],
      negativeKeywords: [],
      query: '"Together AI"',
    };
    expect(
      preFilter(article({ title: 'TogetherAI raises a new round for inference' }), withAlias),
    ).toMatchObject({ keep: true, evidence: 'TogetherAI' });

    // The canonical name still wins when both are present, since it is checked first.
    expect(
      preFilter(article({ title: 'Together AI raises a new round' }), withAlias),
    ).toMatchObject({ keep: true, evidence: 'Together AI' });
  });
});

/**
 * The reason this task was pulled ahead of P3.4: on 2026-08-02 a live Google News search for
 * this exact approved query returned five articles, none of them about Peak.
 */
describe('re-applying our own query semantics (the Google News finding)', () => {
  const peak = company('Peak');

  it('rejects an article that names the company but misses every qualifier', () => {
    const verdict = preFilter(
      article({ title: 'Record climbers reached the peak during a narrow weather window' }),
      peak,
    );
    expect(verdict.keep).toBe(false);
    // Either layer may catch it; what matters is that it does not survive.
    expect(['missing-qualifier', 'negative-keyword']).toContain(verdict.reason);
  });

  it('keeps an article that satisfies a qualifier group', () => {
    const qualified: PreFilterCompany = {
      id: 'p',
      name: 'Peak',
      aliases: [],
      negativeKeywords: [],
      query: '"Peak" AND ("decision intelligence" OR "supply chain")',
    };
    expect(
      preFilter(
        article({ title: 'Peak lands funding to push decision intelligence into planning' }),
        qualified,
      ),
    ).toMatchObject({ keep: true });

    expect(
      preFilter(article({ title: 'Peak season begins for retailers' }), qualified),
    ).toMatchObject({ keep: false, reason: 'missing-qualifier' });
  });

  it('leaves an unqualified query untouched - no groups means no extra requirement', () => {
    const plain: PreFilterCompany = {
      id: 'z',
      name: 'ZutaCore',
      aliases: [],
      negativeKeywords: [],
      query: '"ZutaCore"',
    };
    expect(preFilter(article({ title: 'ZutaCore expands cooling' }), plain)).toMatchObject({
      keep: true,
    });
  });
});

describe('preFilterAll against the fixture corpus', () => {
  it('removes the collisions a naive query attracts, and says why', async () => {
    const naive = await corpusFor('"Peak"');
    expect(naive.length).toBeGreaterThanOrEqual(3);

    const result = preFilterAll(naive, company('Peak'));
    expect(result.kept.every((a) => /decision intelligence/i.test(a.title))).toBe(true);
    expect(result.rejected.length).toBeGreaterThan(0);
    // Every rejection is explained; nothing disappears silently (section 4.3 layer 5).
    for (const r of result.rejected) {
      expect(r.reason).toBeTruthy();
    }
  });

  it('rejects the Hailo taxi-app collision while keeping the chipmaker', async () => {
    const items = await corpusFor('"Hailo"');
    const result = preFilterAll(items, {
      ...company('Hailo'),
      negativeKeywords: ['taxi', 'mytaxi'],
    });
    expect(result.kept.some((a) => /Series D/.test(a.title))).toBe(true);
    expect(result.kept.some((a) => /taxi/i.test(a.title))).toBe(false);
  });

  it('produces per-reason counts for the run manifest and the README (R9)', async () => {
    const items = await corpusFor('"Peak"');
    const { stats } = preFilterAll(items, company('Peak'));
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    expect(total).toBe(items.length);
    expect(stats.kept).toBeGreaterThanOrEqual(0);
  });

  it('keeps a zero-coverage company at zero without erroring (R5)', () => {
    const result = preFilterAll([], company('Hailo'));
    expect(result.kept).toEqual([]);
    expect(result.stats.kept).toBe(0);
  });
});

/**
 * Measured on live Google News data, 2026-08-02: enforcing model-invented qualifiers
 * against a headline-only text left Morphisec with 0 kept articles out of 10.
 */
describe('qualifier enforcement is gated on query provenance', () => {
  const withSource = (querySource: string): PreFilterCompany => ({
    id: 'm',
    name: 'Morphisec',
    aliases: [],
    negativeKeywords: [],
    query: '"Morphisec" AND ("Endpoint Security" OR "Threat Detection")',
    querySource,
  });

  const headline = article({ title: 'Morphisec named a leader in a security evaluation' });

  it('does not enforce qualifiers the model invented', () => {
    expect(preFilter(headline, withSource('llm-enriched'))).toMatchObject({ keep: true });
    expect(preFilter(headline, withSource('triage-default'))).toMatchObject({ keep: true });
  });

  it('does enforce qualifiers a human vetted', () => {
    expect(preFilter(headline, withSource('human-approved'))).toMatchObject({
      keep: false,
      reason: 'missing-qualifier',
    });
  });

  it('lets a caller override the policy explicitly', () => {
    expect(
      preFilter(headline, withSource('llm-enriched'), { enforceQualifiers: () => true }),
    ).toMatchObject({ keep: false, reason: 'missing-qualifier' });
  });

  it('still enforces qualifiers when provenance is unknown', () => {
    const noProvenance: PreFilterCompany = { ...withSource('llm-enriched') };
    delete noProvenance.querySource;
    expect(preFilter(headline, noProvenance)).toMatchObject({ reason: 'missing-qualifier' });
  });
});
