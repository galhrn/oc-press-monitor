/**
 * Deterministic pre-filter (task P3.6, assumption A3, section 4.3 layer 3).
 *
 * This is the cheapest layer of the disambiguation defence and, after the 2026-08-02 live
 * run, the most important one. Google News does not honour our boolean query semantics -
 * a live search for `"Peak" AND ("decision intelligence" OR "supply chain")` returned five
 * articles, none about Peak. So the pre-filter does not merely *check* the provider's work,
 * it **re-applies our query client-side**, which is the only place those semantics are
 * guaranteed to hold for every provider.
 *
 * Two properties matter as much as the filtering itself:
 *
 *   1. **Nothing is silently dropped.** Every rejection carries a machine-readable reason
 *      and the exact term that caused it, so precision can be measured rather than asserted
 *      (section 4.3 layer 5). These land in `mentions.rejection_reason`.
 *   2. **Matching is whitespace-sensitive.** Several human-approved negatives discriminate
 *      purely by spacing - `Launchpad` excludes "launch pad", `Greenlight` excludes
 *      "green light", `Wayup` excludes "way up". Normalising whitespace before matching
 *      would make those three reject 100% of their own companies' coverage.
 *
 * What it deliberately does NOT do is judge meaning. A yacht called "Kando 85" contains the
 * whole word "Kando" and will pass; that is the LLM relevance gate's job (AD-06). The
 * pre-filter exists to make that call cheap, not to replace it.
 */
import { containsPhrase, parseQuery } from './query-match.js';
import type { RawArticle } from './provider.js';

/**
 * Structural subset of a registry record. Declared here rather than imported so the
 * collector does not depend on the registry package; `CompanyRecord` satisfies it as-is.
 */
export interface PreFilterCompany {
  id: string;
  name: string;
  aliases: readonly string[];
  negativeKeywords: readonly string[];
  /** The built query. Its OR-groups are re-applied here (see the header). */
  query: string;
  /**
   * Where the query came from. Only `human-approved` qualifiers are enforced as a hard
   * filter - see `enforceQualifiers` below for the measurement behind that.
   */
  querySource?: string;
}

export const REJECTION_REASONS = [
  'blocked-domain',
  'no-name-match',
  'negative-keyword',
  'missing-qualifier',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface PreFilterVerdict {
  keep: boolean;
  reason: RejectionReason | null;
  /** The term that decided it - the alias that matched, or the keyword that rejected. */
  evidence: string | null;
}

/**
 * Domains that publish no first-party reporting. Kept deliberately short and evidence-based
 * rather than speculative: a blocklist is a precision tool, and every entry it cannot
 * justify is recall thrown away. Callers can extend it per run.
 */
export const DEFAULT_BLOCKED_DOMAINS: readonly string[] = [
  'newswav.com',
  'biggo.com',
  'finance.biggo.com',
];

export interface PreFilterOptions {
  blockedDomains?: readonly string[];
  /** Injectable so a run can widen the text later if A6's body extraction is built. */
  textOf?: (article: RawArticle) => string;
  /**
   * Decides whether a company's qualifier groups are enforced as a hard filter.
   *
   * The default trusts only human-vetted queries, and that is a measured decision rather
   * than a cautious-sounding one. Measured on live Google News data, 2026-08-02:
   *
   *   - `Morphisec`, whose qualifiers the model invented ("Endpoint Security" OR
   *     "Threat Detection" OR "AI-Powered"), kept **0 of 10** articles. Requiring any of
   *     those inside a ten-word headline is not a filter, it is a guarantee of silence.
   *   - The qualifiers written by a human for `Peak` and `Shield` removed 14 items, almost
   *     all of them genuine noise.
   *
   * Since P3.3 established that neither provider returns a snippet, every qualifier is
   * being tested against a headline alone - far less text than whoever wrote it assumed.
   * Enforcing model-invented terms under those conditions also contradicts AD-26, which
   * already settled that model output is advisory and never authoritative.
   */
  enforceQualifiers?: (company: PreFilterCompany) => boolean;
}

const defaultEnforceQualifiers = (company: PreFilterCompany): boolean =>
  company.querySource === undefined || company.querySource === 'human-approved';

const defaultTextOf = (article: RawArticle): string =>
  `${article.title} ${article.snippet ?? ''}`.trim();

/** Host of the article URL, falling back to the provider-reported source name. */
export function articleDomain(article: RawArticle): string | null {
  try {
    return new URL(article.url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return (
      article.sourceName
        ?.trim()
        .toLowerCase()
        .replace(/^www\./, '') ?? null
    );
  }
}

const isBlocked = (domain: string | null, blocked: readonly string[]): string | null => {
  if (domain === null) return null;
  for (const entry of blocked) {
    const e = entry.trim().toLowerCase();
    if (e && (domain === e || domain.endsWith(`.${e}`))) return e;
  }
  return null;
};

/**
 * Applies the layers in ascending cost order. The order is also the diagnostic order: a
 * `no-name-match` rejection means the provider ignored the query, while a
 * `missing-qualifier` rejection means it honoured the name but not the disambiguation -
 * two different provider bugs, distinguishable in the run manifest.
 */
export function preFilter(
  article: RawArticle,
  company: PreFilterCompany,
  options: PreFilterOptions = {},
): PreFilterVerdict {
  const text = (options.textOf ?? defaultTextOf)(article);
  const blocked = options.blockedDomains ?? DEFAULT_BLOCKED_DOMAINS;

  const blockedBy = isBlocked(articleDomain(article), blocked);
  if (blockedBy !== null) return { keep: false, reason: 'blocked-domain', evidence: blockedBy };

  // The company must be named as a whole word. "Peakhurst" is not "Peak".
  const nameHit = [company.name, ...company.aliases].find((n) => containsPhrase(text, n));
  if (nameHit === undefined) return { keep: false, reason: 'no-name-match', evidence: null };

  // Literal, whitespace-sensitive. "launch pad" must not be collapsed onto "Launchpad".
  const negativeHit = company.negativeKeywords.find((k) => containsPhrase(text, k));
  if (negativeHit !== undefined) {
    return { keep: false, reason: 'negative-keyword', evidence: negativeHit };
  }

  // Re-apply the qualifier groups from our own query. This is what a provider that treats
  // `AND (...)` as a suggestion cannot be trusted to have done. Only for vetted queries.
  if ((options.enforceQualifiers ?? defaultEnforceQualifiers)(company)) {
    for (const group of parseQuery(company.query).groups) {
      if (!group.some((term) => containsPhrase(text, term))) {
        return { keep: false, reason: 'missing-qualifier', evidence: group.join(' OR ') };
      }
    }
  }

  return { keep: true, reason: null, evidence: nameHit };
}

export interface PreFilterResult {
  kept: RawArticle[];
  rejected: Array<{ article: RawArticle; reason: RejectionReason; evidence: string | null }>;
  /** Counts per reason, for the run manifest and the README precision table (R9). */
  stats: Record<RejectionReason | 'kept', number>;
}

export function preFilterAll(
  articles: readonly RawArticle[],
  company: PreFilterCompany,
  options: PreFilterOptions = {},
): PreFilterResult {
  const result: PreFilterResult = {
    kept: [],
    rejected: [],
    stats: {
      kept: 0,
      'blocked-domain': 0,
      'no-name-match': 0,
      'negative-keyword': 0,
      'missing-qualifier': 0,
    },
  };

  for (const article of articles) {
    const verdict = preFilter(article, company, options);
    if (verdict.keep || verdict.reason === null) {
      result.kept.push(article);
      result.stats.kept += 1;
    } else {
      result.rejected.push({ article, reason: verdict.reason, evidence: verdict.evidence });
      result.stats[verdict.reason] += 1;
    }
  }

  return result;
}
