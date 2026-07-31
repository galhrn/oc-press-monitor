/** Domain vocabulary. These names are the ones used in the README, the UI and the DB. */

export const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

/** Ambiguity tier from the P2.4 query triage. Drives query construction, not filtering. */
export const AMBIGUITY_TIERS = ['critical', 'high', 'medium', 'low'] as const;
export type AmbiguityTier = (typeof AMBIGUITY_TIERS)[number];

/**
 * News volume tier (AD-22). Deliberately a separate axis from ambiguity:
 * SpaceX is not ambiguous, it is merely loud. Loud is fixed by capping, not by rewriting.
 */
export const VOLUME_TIERS = ['high', 'normal'] as const;
export type VolumeTier = (typeof VOLUME_TIERS)[number];

/** Freshness of a company's most recent relevant mention (R4, R5). */
export const STATUS_BUCKETS = ['FRESH', 'RECENT', 'STALE', 'DORMANT', 'NO_COVERAGE'] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export interface Company {
  id: string;
  name: string;
  slug: string;
  aliases: string[];
  domain: string | null;
  sector: string | null;
  ambiguity: AmbiguityTier;
  volume: VolumeTier;
  /** Human-approved query that overrides anything the enrichment step generated (P2.7). */
  queryOverride: string | null;
  negativeKeywords: string[];
}

export interface Article {
  /** sha256 of the canonical URL - stable across providers, which is what makes dedupe work. */
  id: string;
  url: string;
  canonicalUrl: string;
  sourceName: string | null;
  title: string;
  snippet: string | null;
  publishedAt: string | null;
  provider: string;
  language: string | null;
  raw: unknown;
  fetchedAt: string;
}

export interface Mention {
  /** sha256 of `${companyId}:${articleId}` - makes upserts idempotent (A5). */
  id: string;
  companyId: string;
  articleId: string;
  /** null until classified; false means the pre-filter or the LLM rejected it. */
  relevant: boolean | null;
  rejectionReason: string | null;
  sentiment: Sentiment | null;
  confidence: number | null;
  rationale: string | null;
  evidence: string | null;
  model: string | null;
  promptVersion: string | null;
  classifiedAt: string | null;
  firstSeenAt: string;
}

export const RUN_TYPES = ['backfill', 'daily', 'skeleton'] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const RUN_STATUSES = ['running', 'completed', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface Run {
  id: string;
  type: RunType;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  stats: Record<string, unknown>;
}

/** Aggregated per-company view backing the dashboard (R1, R4, R5). */
export interface CompanyStatus {
  companyId: string;
  name: string;
  slug: string;
  lastMentionedAt: string | null;
  daysSinceLastMention: number | null;
  bucket: StatusBucket;
  mentionsInWindow: number;
  positive: number;
  negative: number;
  neutral: number;
}
