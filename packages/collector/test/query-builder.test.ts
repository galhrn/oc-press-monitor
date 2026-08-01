import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildSearchQuery,
  planQueries,
  preFilter,
  shouldEnforceQualifiers,
  type PreFilterCompany,
  type RawArticle,
} from '@oc/collector';

const REGISTRY: PreFilterCompany[] = JSON.parse(
  readFileSync(new URL('../../../data/companies.json', import.meta.url), 'utf8'),
) as PreFilterCompany[];

const company = (name: string): PreFilterCompany => {
  const found = REGISTRY.find((c) => c.name === name);
  if (!found) throw new Error(`${name} is not in the committed registry`);
  return found;
};

describe('buildSearchQuery', () => {
  it('sends a human-approved qualified query unchanged', () => {
    const plan = buildSearchQuery(company('Peak'));
    expect(plan.query).toBe(company('Peak').query);
    expect(plan).toMatchObject({ qualified: true, strategy: 'override' });
  });

  it('drops model-generated qualifiers and sends the exact phrase instead', () => {
    // Measured: sending these fetched 10 items of which 1 survived; the bare phrase
    // fetched 25 of which 3 survived.
    const plan = buildSearchQuery(company('Morphisec'));
    expect(plan.query).toBe('"Morphisec"');
    expect(plan).toMatchObject({ qualified: false, strategy: 'exact-phrase' });
    expect(plan.rationale).toMatch(/model-generated/);
  });

  it('leaves a distinctive name as a bare exact phrase', () => {
    const plan = buildSearchQuery(company('ZutaCore'));
    expect(plan.query).toBe('"ZutaCore"');
    expect(plan.qualified).toBe(false);
  });

  it('labels a human-approved bare phrase as exact-phrase, not an override', () => {
    // SpaceX is loud but not ambiguous (AD-22): its approved query is the bare name.
    const plan = buildSearchQuery(company('SpaceX'));
    expect(plan.query).toBe('"SpaceX"');
    expect(plan.strategy).toBe('exact-phrase');
  });

  it('never invents a qualifier the registry did not contain', () => {
    for (const c of REGISTRY.slice(0, 60)) {
      const plan = buildSearchQuery(c);
      const emitted = plan.query.toLowerCase();
      if (plan.qualified) expect(emitted).toBe(c.query.toLowerCase());
      else expect(emitted).toBe(`"${c.name.toLowerCase()}"`);
    }
  });

  it('honours an explicit policy override', () => {
    const plan = buildSearchQuery(company('Morphisec'), { enforceQualifiers: () => true });
    expect(plan.qualified).toBe(true);
    expect(plan.query).toBe(company('Morphisec').query);
  });
});

/**
 * The property that actually matters. Measured 2026-08-02: asymmetry between the query and
 * the filter cost Peak and Shield 100% of their results, and Kando and Morphisec most of
 * theirs. Both sides ask the same predicate, so this can only break deliberately.
 */
describe('the query and the pre-filter agree, by construction', () => {
  const article = (title: string): RawArticle => ({
    url: 'https://example.com/a',
    title,
    snippet: null,
    sourceName: 'example.com',
    publishedAt: '2026-07-28T00:00:00.000Z',
    language: 'en',
    provider: 'googlenews',
    raw: {},
  });

  it('sends qualifiers exactly when the filter will enforce them', () => {
    for (const c of REGISTRY) {
      const plan = buildSearchQuery(c);
      const enforced = shouldEnforceQualifiers(c);
      const registryHasQualifiers = /\(.*\bOR\b.*\)/i.test(c.query);
      if (registryHasQualifiers) expect(plan.qualified).toBe(enforced);
    }
  });

  it('does not reject on a qualifier it never asked for', () => {
    // Morphisec's qualifiers are model-generated: not sent, and not enforced.
    const morphisec = company('Morphisec');
    expect(buildSearchQuery(morphisec).qualified).toBe(false);
    expect(preFilter(article('Morphisec launches AI usage control'), morphisec)).toMatchObject({
      keep: true,
    });
  });
});

describe('planQueries', () => {
  it('plans every company in the committed registry', () => {
    const { plans, summary } = planQueries(REGISTRY);
    expect(plans).toHaveLength(258);
    expect(summary.total).toBe(258);
    const counted =
      summary.byStrategy.override +
      summary.byStrategy.qualified +
      summary.byStrategy['exact-phrase'];
    expect(counted).toBe(258);
  });

  it('qualifies only companies whose queries a human approved', () => {
    const { plans } = planQueries(REGISTRY);
    for (const plan of plans.filter((p) => p.qualified)) {
      const c = REGISTRY.find((x) => x.id === plan.companyId);
      expect(c?.querySource).toBe('human-approved');
    }
  });

  it('gives every plan a rationale, so a surprising result set can be explained', () => {
    for (const plan of planQueries(REGISTRY).plans) {
      expect(plan.rationale.length).toBeGreaterThan(10);
    }
  });
});
