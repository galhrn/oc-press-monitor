/**
 * Company grid and control bar (tasks P6.4, P6.7, requirements R1, R4, R5).
 *
 * **`useDeferredValue`, not a debounce.** Typing updates the input immediately and lets React
 * re-render the 258-row list at a lower priority, so the field never lags behind the keyboard.
 * A debounce buys the same smoothness by making results arrive *late*; this keeps them merely
 * *behind*, and React discards superseded work on its own.
 *
 * **Sorted by activity, not alphabetically.** A press monitor is opened to answer "what
 * happened lately", and 258 rows sorted A-Z buries that under whichever companies start with
 * an A. Companies with coverage come first, most recently mentioned at the top; quiet ones
 * settle at the bottom in name order. They are still present and still one scroll away -
 * demoted, never hidden.
 *
 * **`NO_COVERAGE` is styled as an answer, not an absence.** It is the only bucket rendered as
 * a dashed outline rather than a filled chip, and the company still occupies a row. R5 makes
 * it a first-class state, the coverage audit found it is usually genuinely true, and a company
 * that silently vanished from the list would be the one bug a reviewer could never see.
 */
import { useDeferredValue, useMemo, useState, type CSSProperties, type JSX } from 'react';
import { ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import type { CompaniesResponse, CompanySummary, StatusBucket } from '@oc/api/contract';
import { RowSkeleton } from '@/components/Skeleton';
import { NoResults } from '@/components/StateViews';
import { STATUS_LABEL, STATUS_ORDER, STATUS_STYLE } from '@/lib/format';
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  type Filters,
  type QueryLike,
  type SentimentFilter,
  type TierFilter,
} from '@/lib/types';

const TIERS: ReadonlyArray<{ value: TierFilter; label: string }> = [
  { value: 'all', label: 'All tiers' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const SENTIMENT_OPTIONS: ReadonlyArray<{ value: SentimentFilter; label: string }> = [
  { value: 'all', label: 'Any sentiment' },
  { value: 'positive', label: 'Has positive' },
  { value: 'negative', label: 'Has negative' },
  { value: 'neutral', label: 'Has neutral' },
];

/**
 * Recency first, then volume, then name. `lastMentionedAt` is null exactly when there is no
 * coverage, which is what sends those rows to the bottom without a special case.
 */
function byActivity(a: CompanySummary, b: CompanySummary): number {
  const aDate = a.lastMentionedAt;
  const bDate = b.lastMentionedAt;
  if (aDate !== bDate) {
    if (aDate === null) return 1;
    if (bDate === null) return -1;
    return bDate.localeCompare(aDate);
  }
  if (a.mentionsInWindow !== b.mentionsInWindow) return b.mentionsInWindow - a.mentionsInWindow;
  return a.name.localeCompare(b.name);
}

function matches(company: CompanySummary, filters: Filters, search: string): boolean {
  if (search !== '') {
    const haystack = `${company.name} ${company.sector ?? ''}`.toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  if (filters.statuses.size > 0 && !filters.statuses.has(company.status)) return false;
  if (filters.sentiment !== 'all' && company.sentiment[filters.sentiment] === 0) return false;
  if (filters.tier !== 'all' && company.ambiguity !== filters.tier) return false;
  return true;
}

function StatusChip({ status, text }: { status: StatusBucket; text: string }): JSX.Element {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
      title={text}
    >
      {status === 'NO_COVERAGE' ? 'No coverage' : text}
    </span>
  );
}

function SentimentBar({ company }: { company: CompanySummary }): JSX.Element {
  const { positive, negative, neutral } = company.sentiment;
  const total = positive + negative + neutral;
  if (total === 0) return <span className="text-xs text-slate-300">—</span>;

  return (
    <span
      className="flex items-center gap-1.5"
      title={`${positive} positive · ${neutral} neutral · ${negative} negative`}
    >
      <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
        {positive > 0 && (
          <span className="bg-emerald-500" style={{ width: `${(positive / total) * 100}%` }} />
        )}
        {neutral > 0 && (
          <span className="bg-slate-300" style={{ width: `${(neutral / total) * 100}%` }} />
        )}
        {negative > 0 && (
          <span className="bg-rose-500" style={{ width: `${(negative / total) * 100}%` }} />
        )}
      </span>
      <span className="tabular w-8 text-right text-xs text-slate-500">{total}</span>
    </span>
  );
}

export function CompanyGrid({
  query,
  onSelect,
}: {
  query: QueryLike<CompaniesResponse>;
  onSelect: (slug: string) => void;
}): JSX.Element {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const isStale = deferredSearch !== filters.search;

  const companies = query.data?.companies;
  const visible = useMemo(() => {
    if (companies === undefined) return [];
    const needle = deferredSearch.trim().toLowerCase();
    return companies.filter((c) => matches(c, filters, needle)).sort(byActivity);
  }, [companies, filters, deferredSearch]);

  const toggleStatus = (status: StatusBucket): void => {
    setFilters((prev) => {
      const next = new Set(prev.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return { ...prev, statuses: next };
    });
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
        <div className="relative min-w-56 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            placeholder="Search company or sector…"
            aria-label="Search companies"
            className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
          />
        </div>

        <select
          value={filters.sentiment}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, sentiment: e.target.value as SentimentFilter }))
          }
          aria-label="Filter by sentiment"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none"
        >
          {SENTIMENT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <select
          value={filters.tier}
          onChange={(e) => setFilters((prev) => ({ ...prev, tier: e.target.value as TierFilter }))}
          aria-label="Filter by ambiguity tier"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:outline-none"
        >
          {TIERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
          >
            <X className="size-3.5" aria-hidden />
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <SlidersHorizontal className="size-3.5 text-slate-400" aria-hidden />
        {STATUS_ORDER.map((status) => {
          const active = filters.statuses.has(status);
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              aria-pressed={active}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {STATUS_LABEL[status]}
            </button>
          );
        })}
        <span className="tabular ml-auto text-xs text-slate-500">
          {query.data ? `${visible.length} of ${query.data.total}` : ''}
        </span>
      </div>

      {query.data === undefined ? (
        <div aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <NoResults query={filters.search} />
      ) : (
        <ul className={isStale ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          {visible.map((company, index) => (
            // Capped so the last row of a 258-item list is not waiting a quarter of a second;
            // the stagger is there to suggest order, not to be watched.
            <li key={company.id} style={{ '--row-index': Math.min(index, 12) } as CSSProperties}>
              <button
                type="button"
                onClick={() => onSelect(company.slug)}
                className="row-enter flex w-full items-center gap-4 border-b border-slate-100 px-4 py-3 text-left transition-[background-color,box-shadow,transform] duration-150 hover:z-10 hover:bg-white hover:shadow-[0_1px_12px_-2px_rgb(15_23_42_/_0.12)] focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-sky-500"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {company.name}
                  </span>
                  <span className="block truncate text-xs text-slate-400">
                    {company.sector ?? 'Sector unknown'}
                  </span>
                </span>

                <span className="hidden sm:block">
                  <SentimentBar company={company} />
                </span>

                <StatusChip status={company.status} text={company.statusText} />
                <ChevronRight className="size-4 shrink-0 text-slate-300" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
