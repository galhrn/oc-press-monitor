import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildQueryFromEnrichment,
  buildRegistry,
  parseSeedList,
  sanitizeEnrichment,
  summarise,
  CompanyRegistrySchema,
  TriageFileSchema,
  type Enrichment,
  type TriageEntry,
} from '@oc/registry';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const triage: TriageEntry[] = TriageFileSchema.parse(
  JSON.parse(readFileSync(here('../data/query-triage.json'), 'utf8')),
);
const seedText = readFileSync(here('../data/ourcrowd_companies.txt'), 'utf8');

describe('parseSeedList', () => {
  it('reads all 258 companies from the supplied list', () => {
    expect(parseSeedList(seedText)).toHaveLength(258);
  });

  it('strips leading line numbers', () => {
    expect(parseSeedList('1\tZutaCore\n2\tMaolac')).toEqual([
      { index: 1, name: 'ZutaCore' },
      { index: 2, name: 'Maolac' },
    ]);
  });

  it('ignores blank lines, comments and duplicates', () => {
    expect(parseSeedList('Hailo\n\n# comment\n  hailo  \nInnoviz')).toEqual([
      { index: 1, name: 'Hailo' },
      { index: 2, name: 'Innoviz' },
    ]);
  });
});

describe('the committed triage', () => {
  it('covers every seeded company exactly once', () => {
    const seeded = new Set(parseSeedList(seedText).map((c) => c.name.toLowerCase()));
    const triaged = triage.map((t) => t.name.toLowerCase());
    expect(new Set(triaged).size).toBe(triaged.length);
    for (const name of triaged) expect(seeded.has(name)).toBe(true);
    expect(triaged).toHaveLength(seeded.size);
  });

  it('flags 57 names as needing a human-approved query', () => {
    expect(triage.filter((t) => t.tier === 'CRITICAL' || t.tier === 'HIGH')).toHaveLength(57);
  });

  it('treats news volume as an axis separate from ambiguity (AD-22)', () => {
    const loudButUnambiguous = triage.filter((t) => t.volume === 'HIGH');
    expect(loudButUnambiguous.length).toBeGreaterThan(0);
    // SpaceX is not ambiguous; it is merely loud. Its query stays a bare exact phrase.
    const spacex = triage.find((t) => t.name === 'SpaceX');
    expect(spacex?.volume).toBe('HIGH');
    expect(spacex?.query).toBe('"SpaceX"');
  });

  it('gives every critical name both context terms and negatives', () => {
    for (const t of triage.filter((x) => x.tier === 'CRITICAL')) {
      expect(t.query.length, `${t.name} query`).toBeGreaterThan(t.name.length + 2);
      expect(t.reason.length, `${t.name} reason`).toBeGreaterThan(10);
    }
  });
});

describe('buildQueryFromEnrichment', () => {
  const base: Enrichment = {
    known: true,
    sector: 'AI chips',
    aliases: [],
    domain: null,
    ambiguity: 'medium',
    contextTerms: ['edge AI', 'processor'],
    negativeKeywords: [],
  };

  it('adds context terms for an ambiguous name', () => {
    expect(buildQueryFromEnrichment('Hailo', base)).toBe('"Hailo" AND ("edge AI" OR "processor")');
  });

  it('leaves a distinctive name as a bare exact phrase', () => {
    expect(buildQueryFromEnrichment('ZutaCore', { ...base, ambiguity: 'low' })).toBe('"ZutaCore"');
  });

  it('falls back to the bare phrase when the model supplies no context', () => {
    expect(buildQueryFromEnrichment('Kando', { ...base, contextTerms: [] })).toBe('"Kando"');
  });
});

/**
 * Every case below is a verbatim `llama3.2:3b` response captured during the P2.3 pass.
 * They are regression tests for hallucinations we actually observed, not hypotheticals.
 */
describe('sanitizeEnrichment', () => {
  const base: Enrichment = {
    known: true,
    sector: 'Fintech',
    aliases: [],
    domain: null,
    ambiguity: 'low',
    contextTerms: [],
    negativeKeywords: [],
  };

  it('discards the whole record when the model admits it does not know the company', () => {
    // Observed: Maolac (Israeli colostrum-protein foodtech) -> "Vietnam, banking, finance".
    const raw: Enrichment = {
      ...base,
      known: false,
      sector: 'null',
      aliases: ['Mao Lac'],
      contextTerms: ['Vietnam', 'banking'],
      negativeKeywords: ['Vietnamese bank'],
    };
    expect(sanitizeEnrichment('Maolac', raw)).toBeNull();
  });

  it('drops an alias that names a different entity', () => {
    // Observed: Stripe -> aliases ["PayPal", "Online Payment Processor"].
    const clean = sanitizeEnrichment('Stripe', {
      ...base,
      aliases: ['PayPal', 'Online Payment Processor'],
    });
    expect(clean?.aliases).toEqual([]);
  });

  it('keeps a genuine spelling variant of the same name', () => {
    const clean = sanitizeEnrichment('Cerebras', { ...base, aliases: ['Cerebras Systems'] });
    expect(clean?.aliases).toEqual(['Cerebras Systems']);
  });

  it('drops an alias that merely repeats the company name', () => {
    expect(sanitizeEnrichment('ZutaCore', { ...base, aliases: ['ZutaCore'] })?.aliases).toEqual([]);
  });

  it('drops a negative keyword that would filter the company out of its own coverage', () => {
    // Observed: OncoHost -> negativeKeywords ["oncohost"]; Together AI -> ["together"].
    expect(
      sanitizeEnrichment('OncoHost', { ...base, negativeKeywords: ['oncohost'] })?.negativeKeywords,
    ).toEqual([]);
    expect(
      sanitizeEnrichment('Together AI', { ...base, negativeKeywords: ['together', 'team'] })
        ?.negativeKeywords,
    ).toEqual(['team']);
  });

  it('keeps a negative keyword that merely starts with the company name', () => {
    // The check is one-directional on purpose: "Peak District" is exactly the collision
    // a negative keyword is for, and must survive.
    const clean = sanitizeEnrichment('Peak', {
      ...base,
      negativeKeywords: ['Peak District', 'peak season'],
    });
    expect(clean?.negativeKeywords).toEqual(['Peak District', 'peak season']);
  });

  it('drops a domain that does not resemble the company name', () => {
    // Observed: OpenEvidence -> "opeven.com".
    expect(
      sanitizeEnrichment('OpenEvidence', { ...base, domain: 'opeven.com' })?.domain,
    ).toBeNull();
    expect(sanitizeEnrichment('Stripe', { ...base, domain: 'stripe.com' })?.domain).toBe(
      'stripe.com',
    );
  });

  it('treats the literal string "null" as an absent sector', () => {
    expect(sanitizeEnrichment('ZutaCore', { ...base, sector: 'null' })?.sector).toBe('');
    expect(sanitizeEnrichment('ZutaCore', { ...base, sector: '  Unknown ' })?.sector).toBe('');
  });
});

describe('buildRegistry precedence', () => {
  const seed = parseSeedList(seedText);

  it('lets the human-approved query win over the model for a flagged name', () => {
    const enrichments = new Map<string, Enrichment>([
      [
        'Peak',
        {
          known: true,
          sector: 'Nonsense',
          aliases: [],
          domain: null,
          ambiguity: 'low',
          contextTerms: ['mountain'],
          negativeKeywords: [],
        },
      ],
    ]);
    const peak = buildRegistry({ seed, triage, enrichments }).find((r) => r.name === 'Peak');
    expect(peak?.querySource).toBe('human-approved');
    expect(peak?.query).toContain('decision intelligence');
    expect(peak?.ambiguity).toBe('critical');
  });

  it('uses the model for an unflagged name', () => {
    const enrichments = new Map<string, Enrichment>([
      [
        'Innoviz',
        {
          known: true,
          sector: 'Lidar',
          aliases: ['Innoviz Technologies'],
          domain: 'innoviz.tech',
          ambiguity: 'medium',
          contextTerms: ['lidar', 'autonomous'],
          negativeKeywords: ['innovation'],
        },
      ],
    ]);
    const innoviz = buildRegistry({ seed, triage, enrichments }).find((r) => r.name === 'Innoviz');
    expect(innoviz?.querySource).toBe('llm-enriched');
    expect(innoviz?.sector).toBe('Lidar');
    expect(innoviz?.aliases).toContain('Innoviz Technologies');
  });

  it('demotes an unrecognised company to the reviewed triage instead of trusting the model', () => {
    const enrichments = new Map<string, Enrichment>([
      [
        'OncoHost',
        {
          known: false,
          sector: 'Biotechnology',
          aliases: ['Oncohost'],
          domain: null,
          ambiguity: 'critical',
          contextTerms: ['cancer'],
          negativeKeywords: ['oncohost'],
        },
      ],
    ]);
    const row = buildRegistry({ seed, triage, enrichments }).find((r) => r.name === 'OncoHost');
    expect(row?.querySource).toBe('triage-default');
    expect(row?.negativeKeywords).not.toContain('oncohost');
    expect(row?.enrichedBy).toBeNull();
  });

  it('never lets model output negate a human-approved negative keyword', () => {
    const enrichments = new Map<string, Enrichment>([
      [
        'Stripe',
        {
          known: true,
          sector: 'Fintech',
          aliases: ['PayPal'],
          domain: 'stripe.com',
          ambiguity: 'low',
          contextTerms: ['payments'],
          negativeKeywords: ['stripe'],
        },
      ],
    ]);
    const row = buildRegistry({ seed, triage, enrichments }).find((r) => r.name === 'Stripe');
    expect(row?.querySource).toBe('human-approved');
    expect(row?.aliases).toEqual([]);
    expect(row?.negativeKeywords).toContain('pinstripe'); // from the human triage
    expect(row?.negativeKeywords).not.toContain('stripe');
  });

  it('produces a usable registry with no model at all (offline mode)', () => {
    const records = buildRegistry({ seed, triage });
    expect(records).toHaveLength(258);
    expect(CompanyRegistrySchema.safeParse(records).success).toBe(true);
    for (const r of records) expect(r.query.trim().length).toBeGreaterThan(0);
  });

  it('assigns unique ids and slugs across all 258 companies', () => {
    const records = buildRegistry({ seed, triage });
    expect(new Set(records.map((r) => r.id)).size).toBe(258);
    expect(new Set(records.map((r) => r.slug)).size).toBe(258);
  });

  it('labels only the 57 reviewed names as human-approved, never the whole file', () => {
    const summary = summarise(buildRegistry({ seed, triage }));
    expect(summary.bySource['human-approved']).toBe(57);
    expect(summary.bySource['triage-default']).toBe(201);
    expect(summary.bySource['llm-enriched']).toBe(0);
  });

  it('summarises provenance so query origin stays auditable', () => {
    const summary = summarise(buildRegistry({ seed, triage }));
    expect(summary.total).toBe(258);
    expect(summary.byAmbiguity.critical).toBe(25);
    expect(summary.byAmbiguity.high).toBe(32);
    expect(summary.highVolume).toBe(19);
  });
});
