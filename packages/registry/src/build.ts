/**
 * Registry construction (P2.5, P2.7).
 *
 * Three inputs, one output, with a strict precedence order:
 *
 *   1. human-approved query from the triage   (the 57 CRITICAL/HIGH names)
 *   2. query built from the Ollama enrichment (everything else the model knows)
 *   3. the triage's generated query           (unreviewed MEDIUM/LOW names)
 *   4. bare exact-phrase fallback             (nothing else available)
 *
 * The winning source is recorded on every row as `querySource`. Only tier 1 is labelled
 * `human-approved`: a row is not signed off merely because it came from the same file as
 * rows that were. Overstating provenance would defeat the point of tracking it.
 */
import { companyId, slugify, type AmbiguityTier, type VolumeTier } from '@oc/core';
import type { CompanyRecord, Enrichment, TriageEntry } from './schema.js';

export interface SeedCompany {
  index: number;
  name: string;
}

/** Parses `ourcrowd_companies.txt`: one company per line, optionally numbered. */
export function parseSeedList(text: string): SeedCompany[] {
  const seen = new Set<string>();
  const out: SeedCompany[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const name = trimmed.replace(/^\d+[.)\t ]\s*/, '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ index: out.length + 1, name });
  }
  return out;
}

const quote = (s: string): string => `"${s.replace(/"/g, '')}"`;

/** Builds a query from enrichment output: exact name plus a small disjunction of context. */
export function buildQueryFromEnrichment(name: string, enrichment: Enrichment): string {
  const terms = enrichment.contextTerms
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4);
  if (enrichment.ambiguity === 'low' || terms.length === 0) return quote(name);
  return `${quote(name)} AND (${terms.map(quote).join(' OR ')})`;
}

const TIER_MAP: Record<TriageEntry['tier'], AmbiguityTier> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const splitNegatives = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim().replace(/^"|"$/g, ''))
    .filter((s) => s.length > 0 && s !== '—');

export interface BuildOptions {
  seed: readonly SeedCompany[];
  triage: readonly TriageEntry[];
  enrichments?: ReadonlyMap<string, Enrichment>;
  model?: string;
  now?: () => string;
}

export function buildRegistry({
  seed,
  triage,
  enrichments = new Map(),
  model = null as unknown as string,
  now = () => new Date().toISOString(),
}: BuildOptions): CompanyRecord[] {
  const byName = new Map(triage.map((t) => [t.name.toLowerCase(), t]));

  return seed.map(({ name }) => {
    const t = byName.get(name.toLowerCase());
    const enrichment = enrichments.get(name);

    // A human signed off on the query for every CRITICAL and HIGH name (P2.4).
    const humanApproved = t !== undefined && (t.tier === 'CRITICAL' || t.tier === 'HIGH');

    let query: string;
    let querySource: CompanyRecord['querySource'];
    if (humanApproved) {
      query = t.query;
      querySource = 'human-approved';
    } else if (enrichment) {
      query = buildQueryFromEnrichment(name, enrichment);
      querySource = 'llm-enriched';
    } else if (t) {
      query = t.query;
      querySource = 'triage-default';
    } else {
      query = quote(name);
      querySource = 'fallback';
    }

    const ambiguity: AmbiguityTier = t ? TIER_MAP[t.tier] : (enrichment?.ambiguity ?? 'low');
    const volume: VolumeTier = t?.volume === 'HIGH' ? 'high' : 'normal';

    const negatives = new Set<string>([
      ...(t ? splitNegatives(t.neg) : []),
      ...(enrichment?.negativeKeywords ?? []),
    ]);

    const sector =
      enrichment?.known && enrichment.sector
        ? enrichment.sector
        : t && t.sector && !t.sector.startsWith('TBD')
          ? t.sector
          : null;

    return {
      id: companyId(name),
      name,
      slug: slugify(name),
      aliases: enrichment?.aliases ?? [],
      domain: enrichment?.domain ?? null,
      sector,
      ambiguity,
      volume,
      query,
      negativeKeywords: [...negatives],
      querySource,
      enrichedBy: enrichment ? model : null,
      enrichedAt: enrichment ? now() : null,
    };
  });
}

export interface RegistrySummary {
  total: number;
  bySource: Record<CompanyRecord['querySource'], number>;
  byAmbiguity: Record<AmbiguityTier, number>;
  highVolume: number;
  withSector: number;
}

export function summarise(records: readonly CompanyRecord[]): RegistrySummary {
  const summary: RegistrySummary = {
    total: records.length,
    bySource: { 'human-approved': 0, 'llm-enriched': 0, 'triage-default': 0, fallback: 0 },
    byAmbiguity: { critical: 0, high: 0, medium: 0, low: 0 },
    highVolume: 0,
    withSector: 0,
  };
  for (const r of records) {
    summary.bySource[r.querySource] += 1;
    summary.byAmbiguity[r.ambiguity] += 1;
    if (r.volume === 'high') summary.highVolume += 1;
    if (r.sector) summary.withSector += 1;
  }
  return summary;
}
