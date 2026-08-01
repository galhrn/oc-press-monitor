/**
 * Application shell (task P6.3).
 *
 * Owns three things and delegates everything else: the page frame, the "which company is
 * open" selection, and the run-in-progress banner. Data lives in the query hooks; filtering
 * lives in the control bar; rendering lives in the grid and the drawer.
 *
 * The run banner exists because of how this project actually gets demoed. A backfill takes
 * hours, so the dashboard is routinely opened against a half-filled database - and a page
 * showing "243 companies with no coverage" while a run is still going is telling the truth
 * about the database and a lie about the portfolio. Saying which one you are looking at costs
 * a line of UI and removes the only genuinely misleading state this screen has.
 */
import { useState } from 'react';
import { Activity, Database, RefreshCw } from 'lucide-react';
import { CompanyGrid } from '@/components/CompanyGrid';
import { CompanyDrawer } from '@/components/CompanyDrawer';
import { SummaryBanner } from '@/components/SummaryBanner';
import { useCompanies, useHealth, useSummary } from '@/hooks/queries';
import { ErrorState } from '@/components/StateViews';
import { toMessage } from '@/lib/api';
import type { JSX } from 'react';

export function App(): JSX.Element {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const health = useHealth();
  const runInProgress = health.data?.runInProgress === true;
  const companies = useCompanies(runInProgress);
  const summary = useSummary(runInProgress);

  // The first failure of either query is what the page reports.
  const failure: unknown = companies.error ?? summary.error ?? null;

  return (
    <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            Press Monitor - Gal Aharon
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Portfolio press coverage over the last {summary.data?.windowDays ?? 90} days, classified
            by a locally hosted model.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Database className="size-4" aria-hidden />
          <span className="tabular">
            {summary.data ? `${summary.data.totals.companies} companies` : '—'}
          </span>
          <button
            type="button"
            onClick={() => {
              void companies.refetch();
              void summary.refetch();
            }}
            className="ml-2 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Refresh data"
          >
            <RefreshCw
              className={`size-3.5 ${companies.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
            Refresh
          </button>
        </div>
      </header>

      {runInProgress && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <Activity className="size-4 animate-pulse" aria-hidden />
          <span>
            A collection run is still in progress — these numbers are partial and refresh
            automatically.
          </span>
        </div>
      )}

      {failure != null ? (
        <ErrorState
          message={toMessage(failure)}
          onRetry={() => {
            void companies.refetch();
            void summary.refetch();
          }}
        />
      ) : (
        <>
          <SummaryBanner query={summary} />
          <CompanyGrid query={companies} onSelect={setSelectedSlug} />
        </>
      )}

      <CompanyDrawer slug={selectedSlug} onClose={() => setSelectedSlug(null)} />

      <footer className="mt-auto pt-4 text-xs text-slate-400">
        Sentiment is judged toward the company from an investor’s perspective. Classification
        quality is measured against a 60-item gold set — see the README for the confusion matrix and
        its limitations.
      </footer>
    </div>
  );
}
