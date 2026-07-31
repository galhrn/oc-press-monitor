/**
 * "Current mention status" (R4, R5).
 *
 * Deliberately pure and dependency-free: freshness bucketing is the one piece of
 * business logic in this project whose boundary conditions a reviewer will check,
 * so it must be trivially unit-testable (task P5.3).
 */
import type { StatusBucket } from './types.js';

export const BUCKET_THRESHOLDS_DAYS = { FRESH: 7, RECENT: 30, STALE: 90 } as const;

const MS_PER_DAY = 86_400_000;

/** Whole days elapsed between a publication date and `now`. Future dates clamp to 0. */
export function daysSince(publishedAt: string | null, now: Date = new Date()): number | null {
  if (!publishedAt) return null;
  const then = new Date(publishedAt);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY));
}

/**
 * A company with no coverage is a first-class state, not an absent row - the task
 * document calls this out explicitly ("no coverage found").
 */
export function bucketFor(days: number | null): StatusBucket {
  if (days === null) return 'NO_COVERAGE';
  if (days <= BUCKET_THRESHOLDS_DAYS.FRESH) return 'FRESH';
  if (days <= BUCKET_THRESHOLDS_DAYS.RECENT) return 'RECENT';
  if (days <= BUCKET_THRESHOLDS_DAYS.STALE) return 'STALE';
  return 'DORMANT';
}

/** Human phrasing used by both the CLI and the dashboard ("last mentioned 3 days ago"). */
export function describeStatus(days: number | null): string {
  if (days === null) return 'no coverage found';
  if (days === 0) return 'mentioned today';
  if (days === 1) return 'last mentioned yesterday';
  return `last mentioned ${days} days ago`;
}
