/**
 * Classification schema and the parse-and-repair path (tasks P4.3, AD-06, AD-08).
 *
 * One call returns relevance *and* sentiment, which halves inference cost versus two passes.
 *
 * **Why `sentiment` is a four-value string rather than a nullable enum.** The domain type is
 * `Sentiment | null` - an article that is not about the company has no sentiment toward it.
 * But expressing that to Ollama needs `type: ['string', 'null']`, and support for union types
 * in the `format` parameter is inconsistent across versions and models. A model that cannot
 * emit `null` under a constrained grammar will emit something else, and we would be debugging
 * a schema violation instead of measuring accuracy. So the wire format uses an explicit
 * `not_applicable` member and `toClassification` maps it to `null` at the boundary. The
 * domain never sees the wire value.
 *
 * **Why there is a repair step at all.** Constrained generation makes malformed JSON rare, not
 * impossible, and a 1.5B model under a grammar still produces `"Positive"`, `confidence: 95`
 * or a rationale three sentences long. Repairing those deterministically is honest - it
 * changes representation, never meaning - and it keeps a formatting slip from being scored as
 * a wrong answer. Anything that cannot be repaired is a genuine failure and is counted as one.
 */
import { z } from 'zod';
import { SENTIMENTS, type Sentiment } from '@oc/core';

/** Maximum rationale length, in words (AD-18: output tokens dominate latency). */
export const RATIONALE_MAX_WORDS = 15;

export const WIRE_SENTIMENTS = [...SENTIMENTS, 'not_applicable'] as const;
export type WireSentiment = (typeof WIRE_SENTIMENTS)[number];

/**
 * What the model is asked to produce. Deliberately lenient: the strict shape is applied after
 * repair, so a recoverable formatting slip does not read as a schema violation.
 */
export const RawClassificationSchema = z.object({
  relevant: z.union([z.boolean(), z.string(), z.number()]),
  sentiment: z.string().nullable().optional(),
  confidence: z.union([z.number(), z.string()]).optional(),
  rationale: z.string().optional(),
  evidence: z.string().optional(),
});
export type RawClassification = z.infer<typeof RawClassificationSchema>;

/** The domain shape. `sentiment` is null exactly when `relevant` is false. */
export interface Classification {
  relevant: boolean;
  sentiment: Sentiment | null;
  confidence: number;
  rationale: string;
  evidence: string;
}

/** JSON Schema handed to Ollama's `format`, written out so what constrains the model is reviewable. */
export const CLASSIFICATION_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    sentiment: { type: 'string', enum: [...WIRE_SENTIMENTS] },
    confidence: { type: 'number' },
    rationale: { type: 'string' },
    evidence: { type: 'string' },
  },
  required: ['relevant', 'sentiment', 'confidence', 'rationale', 'evidence'],
};

const SENTIMENT_ALIASES: Record<string, Sentiment | null> = {
  positive: 'positive',
  pos: 'positive',
  good: 'positive',
  favourable: 'positive',
  favorable: 'positive',
  negative: 'negative',
  neg: 'negative',
  bad: 'negative',
  unfavourable: 'negative',
  unfavorable: 'negative',
  neutral: 'neutral',
  neu: 'neutral',
  mixed: 'neutral',
  balanced: 'neutral',
  none: null,
  null: null,
  na: null,
  n_a: null,
  not_applicable: null,
  notapplicable: null,
  irrelevant: null,
};

const toBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return /^(true|yes|y|1|relevant)$/i.test(value.trim());
  return false;
};

const toConfidence = (value: unknown): number => {
  const n = typeof value === 'string' ? Number.parseFloat(value) : (value as number);
  if (!Number.isFinite(n)) return 0.5; // absent confidence is treated as "no signal"
  // Models routinely answer on a 0-100 scale despite being asked for 0-1.
  const scaled = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, scaled));
};

const toSentiment = (value: unknown): Sentiment | null | undefined => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  if (key === '') return null;
  return key in SENTIMENT_ALIASES ? SENTIMENT_ALIASES[key] : undefined;
};

/** Trims to the word budget without cutting mid-word. */
export const capWords = (text: string, max = RATIONALE_MAX_WORDS): string => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}…`;
};

export class RepairError extends Error {}

/**
 * Normalises a raw model response into the domain shape, or throws when it cannot be
 * repaired honestly.
 *
 * The one rule that is enforced rather than repaired-around: an irrelevant article has no
 * sentiment. A model that says "not about this company, sentiment positive" is contradicting
 * itself, and `relevant` is the field we trust - it is the question asked first and the one
 * the decoys are designed to probe.
 */
export function toClassification(raw: RawClassification): Classification {
  const relevant = toBoolean(raw.relevant);
  const sentiment = toSentiment(raw.sentiment);

  if (sentiment === undefined) {
    throw new RepairError(`unrecognised sentiment: ${JSON.stringify(raw.sentiment)}`);
  }
  if (relevant && sentiment === null) {
    throw new RepairError('relevant article returned no sentiment');
  }

  return {
    relevant,
    // Not a repair of convenience: a decoy cannot carry sentiment toward a company the
    // article is not about.
    sentiment: relevant ? sentiment : null,
    confidence: toConfidence(raw.confidence),
    rationale: capWords(raw.rationale ?? ''),
    evidence: capWords(raw.evidence ?? '', 20),
  };
}
