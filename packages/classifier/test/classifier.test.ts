import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLASSIFICATION_JSON_SCHEMA,
  RepairError,
  DEFAULT_PROMPT_VERSION,
  buildUserPrompt,
  capWords,
  evaluate,
  loadClassifyPrompt,
  promptVersionTag,
  scoreRun,
  toClassification,
} from '@oc/classifier';

describe('toClassification (parse and repair, P4.3)', () => {
  const base = {
    relevant: true,
    sentiment: 'positive',
    confidence: 0.9,
    rationale: 'x',
    evidence: 'y',
  };

  it('passes a well-formed response straight through', () => {
    expect(toClassification(base)).toMatchObject({ relevant: true, sentiment: 'positive' });
  });

  it('repairs the casing and synonyms a small model actually emits', () => {
    expect(toClassification({ ...base, sentiment: 'Positive' }).sentiment).toBe('positive');
    expect(toClassification({ ...base, sentiment: 'MIXED' }).sentiment).toBe('neutral');
    expect(toClassification({ ...base, sentiment: 'neg' }).sentiment).toBe('negative');
  });

  it('rescales a confidence answered on a 0-100 scale', () => {
    expect(toClassification({ ...base, confidence: 95 }).confidence).toBe(0.95);
    expect(toClassification({ ...base, confidence: '0.4' }).confidence).toBe(0.4);
    expect(toClassification({ ...base, confidence: 250 }).confidence).toBe(1);
  });

  it('treats a missing confidence as no signal rather than certainty', () => {
    expect(toClassification({ ...base, confidence: undefined }).confidence).toBe(0.5);
  });

  it('coerces a stringified boolean', () => {
    expect(toClassification({ ...base, relevant: 'true' }).relevant).toBe(true);
    expect(
      toClassification({ ...base, relevant: 'no', sentiment: 'not_applicable' }).relevant,
    ).toBe(false);
  });

  it('caps the rationale at the word budget (AD-18)', () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    // 15 words; the ellipsis is appended to the last one rather than being its own token.
    expect(capWords(long).split(' ')).toHaveLength(15);
    expect(capWords(long).endsWith('…')).toBe(true);
    expect(toClassification({ ...base, rationale: long }).rationale.length).toBeLessThan(
      long.length,
    );
  });

  it('forces sentiment to null when the article is not about the company', () => {
    // The model contradicting itself is not a licence to record sentiment toward a company
    // the article is not about.
    const decoy = toClassification({ ...base, relevant: false, sentiment: 'positive' });
    expect(decoy).toMatchObject({ relevant: false, sentiment: null });
  });

  it('maps not_applicable to null', () => {
    expect(
      toClassification({ ...base, relevant: false, sentiment: 'not_applicable' }).sentiment,
    ).toBeNull();
  });

  it('refuses a relevant item with no sentiment', () => {
    expect(() => toClassification({ ...base, sentiment: 'not_applicable' })).toThrow(RepairError);
  });

  it('refuses a sentiment it cannot recognise, rather than guessing', () => {
    expect(() => toClassification({ ...base, sentiment: 'euphoric' })).toThrow(RepairError);
  });

  it('constrains the model to the four wire values', () => {
    const props = CLASSIFICATION_JSON_SCHEMA['properties'] as Record<string, { enum?: string[] }>;
    expect(props['sentiment']?.enum).toEqual(['positive', 'negative', 'neutral', 'not_applicable']);
  });
});

describe('prompt (P4.2, AD-16)', () => {
  it('loads the versioned prompt file and hashes it for provenance', () => {
    const { text, hash } = loadClassifyPrompt();
    expect(text).toMatch(/relevant/);
    expect(hash).toMatch(/^[a-f0-9]{12}$/);
    expect(promptVersionTag()).toBe(`${DEFAULT_PROMPT_VERSION}@${hash}`);
  });

  it('keeps every prompt version loadable and separately hashed', () => {
    // The tag is what lands on every row. If two versions shared a hash a stored label could
    // not be traced to the instructions that produced it, and an A/B would be meaningless.
    const v1 = loadClassifyPrompt('classify.v1');
    const v2 = loadClassifyPrompt('classify.v2');
    expect(v1.text).not.toBe(v2.text);
    expect(v1.hash).not.toBe(v2.hash);
    expect(promptVersionTag('classify.v1')).toMatch(/^classify\.v1@/);
  });

  it('states the EXCLUDE list as a hard rule, which v1 did not', () => {
    // The 2026-08-02 bake-off showed llama3.2:3b ignoring v1's "NOT this company" line.
    expect(loadClassifyPrompt('classify.v2').text).toMatch(/hard rule, not a hint/);
  });

  it('injects the disambiguation context the headline alone cannot supply', () => {
    const prompt = buildUserPrompt({
      company: 'Shield',
      title: 'Shield AI: $1.5 Billion Series G',
      sector: 'communications compliance',
      negativeKeywords: ['Shield AI', 'Green Shield FC', 'windshield', 'ignored'],
      aliases: ['Shield FC'],
    });
    expect(prompt).toContain('Company: Shield');
    expect(prompt).toContain('Sector: communications compliance');
    expect(prompt).toContain('EXCLUDE');
    expect(prompt).toContain('  - Shield AI');
    expect(prompt).toContain('  - Green Shield FC');
    expect(prompt).toContain('Headline: Shield AI: $1.5 Billion Series G');
  });

  it('omits context lines that the registry does not have', () => {
    const prompt = buildUserPrompt({ company: 'ZutaCore', title: 'ZutaCore raises $100M' });
    expect(prompt).not.toContain('Sector:');
    expect(prompt).not.toContain('EXCLUDE');
  });
});

describe('metrics (P4.7)', () => {
  it('computes per-class precision, recall and support', () => {
    const report = evaluate(
      [
        { actual: 'positive', predicted: 'positive' },
        { actual: 'positive', predicted: 'neutral' },
        { actual: 'negative', predicted: 'negative' },
        { actual: 'neutral', predicted: 'neutral' },
      ],
      ['positive', 'negative', 'neutral'],
    );
    expect(report.n).toBe(4);
    expect(report.accuracy).toBe(0.75);
    const positive = report.perClass.find((c) => c.label === 'positive');
    expect(positive).toMatchObject({ support: 2, precision: 1, recall: 0.5 });
    const neutral = report.perClass.find((c) => c.label === 'neutral');
    expect(neutral?.precision).toBe(0.5);
  });

  it('reports macro-F1, weighting a rare class as heavily as a common one', () => {
    const report = evaluate(
      [
        ...Array.from({ length: 9 }, () => ({ actual: 'positive', predicted: 'positive' })),
        { actual: 'negative', predicted: 'positive' },
      ],
      ['positive', 'negative'],
    );
    // Accuracy flatters this at 90%; macro-F1 does not, which is the point.
    expect(report.accuracy).toBe(0.9);
    expect(report.macroF1).toBeLessThan(0.5);
  });

  it('scores relevance and sentiment separately, and never blends them', () => {
    const result = scoreRun({
      model: 'test',
      promptVersion: 'v',
      pairs: [
        {
          gold: { relevant: true, sentiment: 'positive' },
          predicted: { relevant: true, sentiment: 'positive' },
        },
        {
          gold: { relevant: false, sentiment: null },
          predicted: { relevant: false, sentiment: null },
        },
        {
          gold: { relevant: true, sentiment: 'negative' },
          predicted: { relevant: true, sentiment: 'neutral' },
        },
      ],
      latenciesMs: [1000, 2000, 3000],
      wallMs: 6000,
    });
    expect(result.relevance.n).toBe(3);
    // Sentiment is scored only over items the gold set says are relevant.
    expect(result.sentiment.n).toBe(2);
    expect(result.jsonValidityRate).toBe(1);
  });

  it('counts an unanswerable item as a failure rather than dropping it', () => {
    const result = scoreRun({
      model: 'test',
      promptVersion: 'v',
      pairs: [
        {
          gold: { relevant: true, sentiment: 'positive' },
          predicted: { relevant: true, sentiment: 'positive' },
        },
        { gold: { relevant: true, sentiment: 'positive' }, predicted: null },
      ],
      latenciesMs: [1000],
      wallMs: 2000,
    });
    expect(result.failures).toBe(1);
    expect(result.jsonValidityRate).toBe(0.5);
    expect(result.relevance.n).toBe(1);
  });

  it('does not punish a relevance miss twice in the sentiment score', () => {
    // Gold says relevant/positive; the model said irrelevant. That is one relevance error,
    // and it appears in the sentiment matrix as not_applicable - not as a second wrong class.
    const result = scoreRun({
      model: 'test',
      promptVersion: 'v',
      pairs: [
        {
          gold: { relevant: true, sentiment: 'positive' },
          predicted: { relevant: false, sentiment: null },
        },
      ],
      latenciesMs: [1],
      wallMs: 1,
    });
    expect(result.relevance.perClass.find((c) => c.label === 'relevant')?.recall).toBe(0);
    expect(result.sentiment.confusion.counts['positive']?.['not_applicable']).toBe(1);
  });
});

describe('the approved gold set', () => {
  const gold = JSON.parse(
    readFileSync(new URL('../eval/gold-set.json', import.meta.url), 'utf8'),
  ) as {
    labelling: { status: string };
    items: Array<{ label: { relevant: boolean | null; sentiment: string | null } }>;
  };

  it('is approved and fully labelled', () => {
    expect(gold.labelling.status).toMatch(/^APPROVED/);
    expect(gold.items).toHaveLength(60);
    expect(gold.items.every((i) => typeof i.label.relevant === 'boolean')).toBe(true);
  });

  it('never carries a sentiment on an irrelevant item', () => {
    for (const item of gold.items) {
      if (!item.label.relevant) expect(item.label.sentiment).toBeNull();
      else expect(['positive', 'negative', 'neutral']).toContain(item.label.sentiment);
    }
  });

  it('contains enough decoys to measure the relevance gate at all', () => {
    expect(gold.items.filter((i) => !i.label.relevant).length).toBeGreaterThanOrEqual(15);
  });
});
