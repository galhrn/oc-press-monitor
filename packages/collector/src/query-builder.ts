/**
 * Per-company query strategy (task P3.4, assumption A3, section 4.3 layer 2).
 *
 * The registry already stores a `query` per company — the human-approved one for the 57
 * triaged names, otherwise one built from enrichment. This module decides what to actually
 * *send*, which is not always the same string.
 *
 * **The rule, and the measurement behind it.** The query and the pre-filter must apply the
 * same qualifier policy. Measured against live Google News on 2026-08-02, breaking that
 * symmetry loses coverage in both directions:
 *
 *   | company   | provenance     | qualified | bare |
 *   |-----------|----------------|-----------|------|
 *   | Kando     | triage-default | 0 kept    | 5    |
 *   | Morphisec | llm-enriched   | 1 kept    | 3    |
 *   | Peak      | human-approved | 6 kept    | 0    |
 *   | Shield    | human-approved | 2 kept    | 0    |
 *
 * Sending qualifiers the filter will not enforce narrows the fetch to nothing useful;
 * enforcing qualifiers the query never asked for drops everything that comes back. So the
 * builder asks `shouldEnforceQualifiers` — the same predicate the pre-filter uses (AD-29) —
 * and the two can never drift apart.
 *
 * What this module deliberately does not do is invent new terms. Every qualifier it emits
 * was either written by a human during the P2.4 triage or produced by the registry build;
 * a query builder that improvises its own disambiguation would be untraceable.
 */
import { hasDisambiguation } from './query-match.js';
import { shouldEnforceQualifiers, type PreFilterCompany } from './pre-filter.js';

/** How a provider treats boolean syntax. Drives nothing yet; see the note in `QueryPlan`. */
export const QUERY_DIALECTS = ['boolean', 'loose'] as const;
export type QueryDialect = (typeof QUERY_DIALECTS)[number];

export const QUERY_STRATEGIES = ['override', 'qualified', 'exact-phrase'] as const;
export type QueryStrategy = (typeof QUERY_STRATEGIES)[number];

export interface QueryPlan {
  companyId: string;
  /** The string to send to the provider. */
  query: string;
  strategy: QueryStrategy;
  /** True when OR-group qualifiers survived into the sent query. */
  qualified: boolean;
  /**
   * Why this strategy was chosen. Stored on the run manifest so a surprising result set can
   * be explained without re-deriving the decision.
   */
  rationale: string;
}

export interface QueryBuilderOptions {
  /** Overrides the shared AD-29 predicate. Tests and experiments only. */
  enforceQualifiers?: (company: PreFilterCompany) => boolean;
  /**
   * Reserved for a provider that honours boolean syntax. GDELT does; Google News does not.
   * Currently informational only: we emit one query for both, because the pre-filter
   * re-applies the semantics client-side regardless (P3.6), and GDELT has been unreachable
   * since 2026-08-02 so any provider-specific tuning would be unmeasured guesswork.
   */
  dialect?: QueryDialect;
}

const quote = (s: string): string => `"${s.replace(/"/g, '')}"`;

/**
 * An explicit override is anything a human wrote that is not simply the quoted name — that
 * is the P2.7 `queryOverride` reaching the collector intact.
 */
const isOverride = (company: PreFilterCompany): boolean =>
  company.querySource === 'human-approved' && company.query.trim() !== quote(company.name);

export function buildSearchQuery(
  company: PreFilterCompany,
  options: QueryBuilderOptions = {},
): QueryPlan {
  const enforce = options.enforceQualifiers ?? shouldEnforceQualifiers;
  // "More than a single phrase" - covers OR-lists of name variants as well as AND-qualifiers.
  const hasQualifiers = hasDisambiguation(company.query);

  if (hasQualifiers && enforce(company)) {
    return {
      companyId: company.id,
      query: company.query,
      strategy: isOverride(company) ? 'override' : 'qualified',
      qualified: true,
      rationale: 'qualifiers are human-approved, so the pre-filter will enforce them',
    };
  }

  if (hasQualifiers) {
    // The qualifiers exist but nobody vetted them. Sending them measurably starves the
    // fetch (Kando 0 of 25, Morphisec 10 of 25) for filtering the pre-filter will not do.
    return {
      companyId: company.id,
      query: quote(company.name),
      strategy: 'exact-phrase',
      qualified: false,
      rationale: 'qualifiers are model-generated and unenforced, so they are not sent',
    };
  }

  return {
    companyId: company.id,
    query: company.query.trim() || quote(company.name),
    strategy: 'exact-phrase',
    qualified: false,
    rationale: 'distinctive name; the exact phrase is sufficient',
  };
}

export interface QueryPlanSummary {
  total: number;
  byStrategy: Record<QueryStrategy, number>;
  qualified: number;
}

/** Plans every company in one pass, so a run can log what it is about to ask for. */
export function planQueries(
  companies: readonly PreFilterCompany[],
  options: QueryBuilderOptions = {},
): { plans: QueryPlan[]; summary: QueryPlanSummary } {
  const plans = companies.map((c) => buildSearchQuery(c, options));
  const summary: QueryPlanSummary = {
    total: plans.length,
    byStrategy: { override: 0, qualified: 0, 'exact-phrase': 0 },
    qualified: 0,
  };
  for (const plan of plans) {
    summary.byStrategy[plan.strategy] += 1;
    if (plan.qualified) summary.qualified += 1;
  }
  return { plans, summary };
}
