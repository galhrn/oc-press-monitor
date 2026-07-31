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
 *
 * Model output passes through `sanitizeEnrichment` before it is allowed to influence
 * tier 2 at all; an enrichment that does not survive that filter demotes the row to
 * tier 3 rather than being recorded as an enrichment that contributed nothing.
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

/** Lowercased, punctuation-free form used for all identity comparisons. */
const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Registrable label of a host: `https://www.opeven.com/x` -> `opeven`. */
const domainLabel = (d: string): string =>
  squash(
    d
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      ?.split('.')[0] ?? '',
  );

/** True when two strings are plausibly spellings of the same name (`Cerebras Systems` / `Cerebras`). */
const sameName = (candidate: string, name: string): boolean => {
  const a = squash(candidate);
  const b = squash(name);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
};

const PLACEHOLDER_SECTORS = new Set(['', 'null', 'undefined', 'unknown', 'n/a', 'na', 'none']);

const dedupe = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  return values.filter((v) => {
    const k = squash(v);
    if (k.length === 0 || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Filters an Ollama enrichment down to what it is safe to persist (AD-21: enrichment is
 * advisory, never authoritative). Measured against `llama3.2:3b`, the failure modes are
 * not random noise - they are systematic, and each rule below exists because the model
 * actually produced the example next to it:
 *
 *   known: false      -> the whole record is dropped. A model that cannot name the company
 *                        is guessing about everything else too ("Maolac" -> Vietnamese banking).
 *   unrelated alias   -> dropped. Stripe came back with the alias "PayPal"; searching a
 *                        competitor's name is worse than having no alias at all.
 *   self-negation     -> dropped. OncoHost came back with the negative keyword "oncohost",
 *                        which would make the pre-filter reject every genuine article.
 *   unrelated domain  -> dropped. OpenEvidence came back as "opeven.com", which is nobody.
 *   "null" as prose   -> dropped. The model writes the string "null" into `sector`.
 *
 * Returns `null` when nothing trustworthy survives, so the caller falls back to the
 * reviewed triage rather than recording an empty enrichment as if it were a source.
 */
export function sanitizeEnrichment(name: string, raw: Enrichment): Enrichment | null {
  if (!raw.known) return null;

  const aliases = dedupe(raw.aliases.map((a) => a.trim())).filter(
    (a) => sameName(a, name) && squash(a) !== squash(name),
  );

  const sectorRaw = raw.sector.trim();
  const sector = PLACEHOLDER_SECTORS.has(sectorRaw.toLowerCase()) ? '' : sectorRaw;

  const domain =
    raw.domain && sameName(domainLabel(raw.domain), name) ? raw.domain.trim().toLowerCase() : null;

  // A negative keyword contained *in* the company name would filter out real coverage.
  // The test is deliberately one-directional: "Peak District" is a legitimate negative
  // for "Peak", while "together" is not one for "Together AI".
  const owned = [squash(name), ...aliases.map(squash)];
  const negativeKeywords = dedupe(raw.negativeKeywords.map((k) => k.trim())).filter(
    (k) => !owned.some((o) => o.includes(squash(k))),
  );

  return { ...raw, aliases, sector, domain, negativeKeywords };
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
    const supplied = enrichments.get(name);
    const enrichment = supplied ? (sanitizeEnrichment(name, supplied) ?? undefined) : undefined;

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
