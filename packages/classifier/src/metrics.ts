/**
 * Evaluation metrics (task P4.7, requirement R13).
 *
 * Relevance and sentiment are scored **separately and never averaged together**. They fail in
 * different ways and one of the failures is far more expensive: a model that reads sentiment
 * well but waves decoys through attributes a football club's match report to a portfolio
 * company, which is visibly wrong to anyone using the dashboard. A model that catches decoys
 * but mislabels a neutral as positive is merely imprecise. A blended score hides that.
 *
 * Sentiment is scored over the **relevant items only** - the ones that have a sentiment at
 * all - and using the gold set's own relevance, not the model's, so a relevance mistake is
 * not punished twice.
 *
 * Every per-class figure carries its **support**. With 7 negative items in the gold set a
 * single error moves that class by ~14 points, and a score printed without its denominator
 * invites exactly the over-reading the README warns about.
 */
import { SENTIMENTS, type Sentiment } from '@oc/core';

export interface ClassMetrics {
  label: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ConfusionMatrix {
  labels: string[];
  /** `counts[actual][predicted]` */
  counts: Record<string, Record<string, number>>;
}

export interface EvaluationReport {
  n: number;
  accuracy: number;
  macroF1: number;
  perClass: ClassMetrics[];
  confusion: ConfusionMatrix;
}

const div = (a: number, b: number): number => (b === 0 ? 0 : a / b);

/** Multi-class metrics from paired (actual, predicted) labels. */
export function evaluate(
  pairs: ReadonlyArray<{ actual: string; predicted: string }>,
  labels: readonly string[],
): EvaluationReport {
  const counts: Record<string, Record<string, number>> = {};
  for (const actual of labels) {
    counts[actual] = Object.fromEntries(labels.map((p) => [p, 0]));
  }
  let correct = 0;
  for (const { actual, predicted } of pairs) {
    const row = counts[actual];
    if (row && predicted in row) row[predicted] = (row[predicted] ?? 0) + 1;
    if (actual === predicted) correct += 1;
  }

  const perClass = labels.map((label) => {
    const support = pairs.filter((p) => p.actual === label).length;
    const tp = counts[label]?.[label] ?? 0;
    const predictedAs = pairs.filter((p) => p.predicted === label).length;
    const precision = div(tp, predictedAs);
    const recall = div(tp, support);
    return {
      label,
      support,
      precision,
      recall,
      f1: div(2 * precision * recall, precision + recall),
    };
  });

  return {
    n: pairs.length,
    accuracy: div(correct, pairs.length),
    // Macro, not weighted: every class counts equally, which is the whole point when the
    // rarest class is also the one an investor most wants to see.
    macroF1: div(
      perClass.reduce((sum, c) => sum + c.f1, 0),
      perClass.length,
    ),
    perClass,
    confusion: { labels: [...labels], counts },
  };
}

export interface GoldItemLabel {
  relevant: boolean;
  sentiment: Sentiment | null;
}

export interface PredictedLabel {
  relevant: boolean;
  sentiment: Sentiment | null;
}

export interface BakeOffResult {
  model: string;
  promptVersion: string;
  /** Items where the model produced no usable answer at all. */
  failures: number;
  jsonValidityRate: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  itemsPerMinute: number;
  projectedMinutesFor2500: number;
  relevance: EvaluationReport;
  sentiment: EvaluationReport;
}

export const RELEVANCE_LABELS = ['relevant', 'irrelevant'] as const;

export function scoreRun(input: {
  model: string;
  promptVersion: string;
  pairs: ReadonlyArray<{ gold: GoldItemLabel; predicted: PredictedLabel | null }>;
  latenciesMs: readonly number[];
  wallMs: number;
}): BakeOffResult {
  const answered = input.pairs.filter((p) => p.predicted !== null);
  const failures = input.pairs.length - answered.length;

  const relevance = evaluate(
    answered.map((p) => ({
      actual: p.gold.relevant ? 'relevant' : 'irrelevant',
      predicted: p.predicted?.relevant === true ? 'relevant' : 'irrelevant',
    })),
    RELEVANCE_LABELS,
  );

  // Gold relevance decides which items have a sentiment, so a relevance miss is not counted
  // twice. A model that answered `not_applicable` for a genuinely relevant item lands in the
  // confusion matrix as its own row rather than vanishing.
  const sentimentPairs = answered
    .filter((p) => p.gold.relevant && p.gold.sentiment !== null)
    .map((p) => ({
      actual: p.gold.sentiment as string,
      predicted: p.predicted?.sentiment ?? 'not_applicable',
    }));
  const sentiment = evaluate(sentimentPairs, [...SENTIMENTS, 'not_applicable']);

  const sorted = [...input.latenciesMs].sort((a, b) => a - b);
  const at = (q: number): number =>
    sorted.length === 0
      ? 0
      : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0);
  const itemsPerMinute = input.wallMs > 0 ? (input.pairs.length / input.wallMs) * 60_000 : 0;

  return {
    model: input.model,
    promptVersion: input.promptVersion,
    failures,
    jsonValidityRate: div(answered.length, input.pairs.length),
    p50LatencyMs: Math.round(at(0.5)),
    p95LatencyMs: Math.round(at(0.95)),
    itemsPerMinute: Number(itemsPerMinute.toFixed(1)),
    projectedMinutesFor2500: itemsPerMinute > 0 ? Number((2500 / itemsPerMinute).toFixed(1)) : 0,
    relevance,
    sentiment,
  };
}

/** Renders a confusion matrix as fixed-width text for the README. */
export function renderConfusion(m: ConfusionMatrix): string {
  const width = Math.max(12, ...m.labels.map((l) => l.length + 2));
  const header = ['actual \\ pred'.padEnd(width), ...m.labels.map((l) => l.padStart(width))];
  const rows = m.labels.map((actual) =>
    [
      actual.padEnd(width),
      ...m.labels.map((pred) => String(m.counts[actual]?.[pred] ?? 0).padStart(width)),
    ].join(''),
  );
  return [header.join(''), ...rows].join('\n');
}
