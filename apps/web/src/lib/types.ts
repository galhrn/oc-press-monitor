/**
 * UI-side types.
 *
 * `QueryLike` deliberately narrows TanStack's very large `UseQueryResult` down to the three
 * fields a presentational component actually needs. Components then depend on a shape, not on
 * a library - which keeps them trivially testable with a plain object and stops a TanStack
 * version bump from rippling through the component tree.
 */
import type { Ambiguity, Sentiment, StatusBucket } from '@oc/api/contract';

export interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  isFetching: boolean;
}

/** `all` is a real member rather than `null`, so every filter narrows the same way. */
export type SentimentFilter = 'all' | Sentiment;
export type TierFilter = 'all' | Ambiguity;

export interface Filters {
  search: string;
  statuses: ReadonlySet<StatusBucket>;
  sentiment: SentimentFilter;
  tier: TierFilter;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  statuses: new Set<StatusBucket>(),
  sentiment: 'all',
  tier: 'all',
};

export const hasActiveFilters = (f: Filters): boolean =>
  f.search.trim() !== '' || f.statuses.size > 0 || f.sentiment !== 'all' || f.tier !== 'all';
