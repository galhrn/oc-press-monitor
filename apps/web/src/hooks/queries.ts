/**
 * Data-fetching hooks (task P6.3).
 *
 * Every network call in the app goes through one of these. Components never call `fetch` or
 * `useQuery` directly, so caching policy, retry behaviour and query keys live in one file
 * instead of being re-decided at each call site.
 *
 * The polling is deliberate and temporary-by-design: a backfill takes hours, and
 * `runInProgress` from `/health` lets the dashboard refresh itself while data lands and then
 * stop once the run finishes.
 */
import { useQuery } from '@tanstack/react-query';
import { api, ApiRequestError } from '@/lib/api';

export const queryKeys = {
  health: ['health'] as const,
  companies: ['companies'] as const,
  company: (slug: string) => ['company', slug] as const,
  summary: ['summary'] as const,
};

/** A contract break will not fix itself on retry; a flaky network might. */
const retry = (failureCount: number, error: unknown): boolean => {
  if (error instanceof ApiRequestError && error.code === 'E_CONTRACT') return false;
  return failureCount < 2;
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: (query) => (query.state.data?.runInProgress ? 15_000 : false),
    retry,
  });
}

export function useCompanies(pollWhileRunning: boolean) {
  return useQuery({
    queryKey: queryKeys.companies,
    queryFn: ({ signal }) => api.companies(signal),
    // 258 rows is small; the cost of a refetch is trivial next to showing stale counts.
    staleTime: 10_000,
    refetchInterval: pollWhileRunning ? 30_000 : false,
    retry,
  });
}

export function useSummary(pollWhileRunning: boolean) {
  return useQuery({
    queryKey: queryKeys.summary,
    queryFn: ({ signal }) => api.summary(signal),
    staleTime: 10_000,
    refetchInterval: pollWhileRunning ? 30_000 : false,
    retry,
  });
}

/** Fetches on demand: the drill-down only loads when a company is actually opened. */
export function useCompanyDetail(slug: string | null) {
  return useQuery({
    queryKey: queryKeys.company(slug ?? ''),
    queryFn: ({ signal }) => api.company(slug as string, signal),
    enabled: slug !== null,
    staleTime: 30_000,
    retry,
  });
}
