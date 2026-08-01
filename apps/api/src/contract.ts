/**
 * The API contract (task P6.1, requirement R18).
 *
 * Declared once, in zod, and imported by **both** sides: the server validates every response
 * against these schemas before sending, and the React app imports the inferred types rather
 * than re-declaring its own. A dashboard whose types are hand-copied from the server drifts
 * the first time a field is renamed, and the drift shows up as `undefined` in the browser
 * instead of as a compile error.
 */
import { z } from 'zod';
// Imported from the *types* module, not the `@oc/core` barrel. The barrel pulls in
// node:crypto, node:sqlite and dotenv, and this file is bundled into the browser - the
// dashboard should ship three string tuples, not the storage kernel.
import { AMBIGUITY_TIERS, SENTIMENTS, STATUS_BUCKETS } from '@oc/core/types';

export const SentimentSchema = z.enum(SENTIMENTS);
export const StatusBucketSchema = z.enum(STATUS_BUCKETS);
export const AmbiguitySchema = z.enum(AMBIGUITY_TIERS);

export const SentimentCountsSchema = z.object({
  positive: z.number().int().nonnegative(),
  negative: z.number().int().nonnegative(),
  neutral: z.number().int().nonnegative(),
});

export const CompanySummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  sector: z.string().nullable(),
  /** Drives the pipeline-tier filter in the UI. */
  ambiguity: AmbiguitySchema,
  status: StatusBucketSchema,
  /** Pre-rendered by the server so "3 days ago" is computed in exactly one place. */
  statusText: z.string(),
  lastMentionedAt: z.string().nullable(),
  daysSinceLastMention: z.number().int().nullable(),
  mentionsInWindow: z.number().int().nonnegative(),
  sentiment: SentimentCountsSchema,
});

export const MentionSchema = z.object({
  id: z.string(),
  articleId: z.string(),
  title: z.string(),
  url: z.string(),
  source: z.string().nullable(),
  publishedAt: z.string().nullable(),
  sentiment: SentimentSchema.nullable(),
  confidence: z.number().nullable(),
  /** The model's own one-line justification, shown in the drill-down. */
  rationale: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});

export const CompaniesResponseSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  companies: z.array(CompanySummarySchema),
});

export const CompanyDetailResponseSchema = z.object({
  company: CompanySummarySchema,
  mentions: z.array(MentionSchema),
});

export const SummaryResponseSchema = z.object({
  generatedAt: z.string(),
  windowDays: z.number().int().positive(),
  totals: z.object({
    companies: z.number().int(),
    mentions: z.number().int(),
    withCoverage: z.number().int(),
    withoutCoverage: z.number().int(),
  }),
  sentiment: SentimentCountsSchema,
  companiesByStatus: z.record(StatusBucketSchema, z.number().int()),
  mentionsByMonth: z.array(z.object({ month: z.string(), count: z.number().int() })),
  /** Null until a run has finished; the UI shows a "never run" state rather than zeros. */
  lastRun: z
    .object({
      id: z.string(),
      startedAt: z.string(),
      finishedAt: z.string().nullable(),
      status: z.string(),
    })
    .nullable(),
});

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  companies: z.number().int(),
  mentions: z.number().int(),
  /** True while a backfill is still running, so the UI can say the data is partial. */
  runInProgress: z.boolean(),
});

export type Sentiment = z.infer<typeof SentimentSchema>;
export type StatusBucket = z.infer<typeof StatusBucketSchema>;
export type Ambiguity = z.infer<typeof AmbiguitySchema>;
export type SentimentCounts = z.infer<typeof SentimentCountsSchema>;
export type CompanySummary = z.infer<typeof CompanySummarySchema>;
export type Mention = z.infer<typeof MentionSchema>;
export type CompaniesResponse = z.infer<typeof CompaniesResponseSchema>;
export type CompanyDetailResponse = z.infer<typeof CompanyDetailResponseSchema>;
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** Shape of every error the API emits, so the client has one branch to handle. */
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
