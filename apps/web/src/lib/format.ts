/**
 * Presentation helpers.
 *
 * Note what is *not* here: "last mentioned 3 days ago". That string is produced server-side by
 * `describeStatus` and arrives as `statusText`, so the CLI, the JSON exports and the dashboard
 * cannot drift into three different phrasings of the same fact.
 */
import type { Sentiment, StatusBucket } from '@oc/api/contract';

export const STATUS_ORDER: readonly StatusBucket[] = [
  'FRESH',
  'RECENT',
  'STALE',
  'DORMANT',
  'NO_COVERAGE',
];

export const STATUS_LABEL: Record<StatusBucket, string> = {
  FRESH: 'Fresh (≤7d)',
  RECENT: 'Recent (≤30d)',
  STALE: 'Stale (≤90d)',
  DORMANT: 'Dormant (>90d)',
  NO_COVERAGE: 'No coverage',
};

/**
 * `NO_COVERAGE` is deliberately the only bucket rendered as a dashed outline rather than a
 * filled chip. R5 makes it a first-class state, and the coverage audit found it is frequently
 * the truth rather than a gap - it should read as an answer, not as a missing value.
 */
export const STATUS_STYLE: Record<StatusBucket, string> = {
  FRESH: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
  RECENT: 'bg-sky-100 text-sky-800 ring-1 ring-sky-200',
  STALE: 'bg-amber-100 text-amber-800 ring-1 ring-amber-200',
  DORMANT: 'bg-slate-200 text-slate-700 ring-1 ring-slate-300',
  NO_COVERAGE: 'bg-transparent text-slate-500 ring-1 ring-dashed ring-slate-300',
};

export const SENTIMENT_STYLE: Record<Sentiment, string> = {
  positive: 'bg-emerald-100 text-emerald-800',
  negative: 'bg-rose-100 text-rose-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export const SENTIMENT_COLOR: Record<Sentiment, string> = {
  positive: '#059669',
  negative: '#e11d48',
  neutral: '#94a3b8',
};

export const formatDate = (iso: string | null): string =>
  iso === null
    ? '—'
    : new Date(iso).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });

export const compactNumber = (n: number): string => new Intl.NumberFormat().format(n);
