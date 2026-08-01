import { AlertTriangle, Inbox, SearchX } from 'lucide-react';

/**
 * Empty and error states.
 *
 * Kept as first-class components rather than inline ternaries because they are the states a
 * reviewer is most likely to hit: an API that is not running, a filter that matches nothing,
 * and a portfolio where most companies genuinely have no press.
 */
import type { JSX } from 'react';
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-rose-600" aria-hidden />
      <p className="max-w-md text-sm text-rose-800">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function NoResults({ query }: { query: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <SearchX className="size-6 text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-700">No companies match your filters</p>
      {query && <p className="text-sm text-slate-500">Nothing found for “{query}”.</p>}
    </div>
  );
}

export function NoMentions({ statusText }: { statusText: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox className="size-6 text-slate-400" aria-hidden />
      <p className="text-sm font-medium text-slate-700">No press in this window</p>
      {/* Says why, rather than showing an empty list: "no coverage found" is an answer. */}
      <p className="text-sm text-slate-500">{statusText}</p>
    </div>
  );
}
