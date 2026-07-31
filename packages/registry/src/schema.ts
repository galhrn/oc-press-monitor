import { z } from 'zod';
import { AMBIGUITY_TIERS, VOLUME_TIERS } from '@oc/core';

/** What the Ollama enrichment step is allowed to return (prompts/enrich-company.v1.md). */
export const EnrichmentSchema = z.object({
  known: z.boolean(),
  sector: z.string().max(80),
  aliases: z.array(z.string().max(120)).max(5),
  domain: z.string().max(120).nullable(),
  ambiguity: z.enum(AMBIGUITY_TIERS),
  contextTerms: z.array(z.string().max(60)).max(5),
  negativeKeywords: z.array(z.string().max(60)).max(5),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

/**
 * The same shape as a JSON Schema, for Ollama's `format` parameter. Written out rather
 * than generated so that what constrains the model is reviewable in one glance.
 */
export const ENRICHMENT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    known: { type: 'boolean' },
    sector: { type: 'string' },
    aliases: { type: 'array', items: { type: 'string' } },
    domain: { type: ['string', 'null'] },
    ambiguity: { type: 'string', enum: [...AMBIGUITY_TIERS] },
    contextTerms: { type: 'array', items: { type: 'string' } },
    negativeKeywords: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'known',
    'sector',
    'aliases',
    'domain',
    'ambiguity',
    'contextTerms',
    'negativeKeywords',
  ],
};

/** One row of the human-reviewed triage (task P2.4). */
export const TriageEntrySchema = z.object({
  idx: z.number().int().positive(),
  name: z.string().min(1),
  tier: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']),
  volume: z.enum(['HIGH', 'NORMAL']),
  reason: z.string(),
  query: z.string().min(1),
  neg: z.string(),
  sector: z.string(),
});
export type TriageEntry = z.infer<typeof TriageEntrySchema>;
export const TriageFileSchema = z.array(TriageEntrySchema);

/** A committed registry record - this is what `data/companies.json` contains. */
export const CompanyRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  aliases: z.array(z.string()),
  domain: z.string().nullable(),
  sector: z.string().nullable(),
  ambiguity: z.enum(AMBIGUITY_TIERS),
  volume: z.enum(VOLUME_TIERS),
  query: z.string(),
  negativeKeywords: z.array(z.string()),
  /**
   * Where `query` came from. Makes the provenance of every row auditable.
   *   human-approved - one of the 57 CRITICAL/HIGH names a human reviewed and signed off
   *   llm-enriched   - built from local-Ollama enrichment output
   *   triage-default - the triage's generated query for an unreviewed MEDIUM/LOW name
   *   fallback       - bare exact phrase; no triage entry and no enrichment
   */
  querySource: z.enum(['human-approved', 'llm-enriched', 'triage-default', 'fallback']),
  enrichedBy: z.string().nullable(),
  enrichedAt: z.string().nullable(),
});
export type CompanyRecord = z.infer<typeof CompanyRecordSchema>;
export const CompanyRegistrySchema = z.array(CompanyRecordSchema);
