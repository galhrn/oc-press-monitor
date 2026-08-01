/**
 * Company drill-down (tasks P6.6, P6.7, requirements R3, R5).
 *
 * A slide-over rather than a route: the grid is the thing being scanned, and losing scroll
 * position to open one company would make comparing several of them tedious.
 *
 * Every headline links to its source and **opens in a new tab with `rel="noopener noreferrer"`**.
 * That is R3's requirement met, and the `rel` is not decoration: without `noopener` the opened
 * page gets a handle on `window.opener` and can navigate this tab somewhere else.
 *
 * The model's own `rationale` is shown next to each label. A sentiment badge with no reasoning
 * asks the reader to trust a 3B model on faith; the one-line justification is what lets them
 * disagree with it - which matters more here than usual, because the bake-off put this
 * configuration at 0.52 combined macro-F1 rather than something you would take on trust.
 */
import { useCallback, useEffect, useState, type JSX } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import type { Mention } from '@oc/api/contract';
import { useCompanyDetail } from '@/hooks/queries';
import { ErrorState, NoMentions } from '@/components/StateViews';
import { SENTIMENT_STYLE, STATUS_STYLE, formatDate } from '@/lib/format';
import { toMessage } from '@/lib/api';

function SentimentBadge({ sentiment }: { sentiment: Mention['sentiment'] }): JSX.Element {
  if (sentiment === null) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
        unclassified
      </span>
    );
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${SENTIMENT_STYLE[sentiment]}`}
    >
      {sentiment}
    </span>
  );
}

function MentionRow({ mention }: { mention: Mention }): JSX.Element {
  return (
    <li className="border-b border-slate-100 px-5 py-4 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={mention.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-start gap-1.5 text-sm font-medium text-slate-900 hover:text-sky-700"
          >
            <span className="underline-offset-2 group-hover:underline">{mention.title}</span>
            <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
          </a>
          <p className="mt-1 text-xs text-slate-500">
            {mention.source ?? 'Unknown source'} · {formatDate(mention.publishedAt)}
          </p>
          {mention.rationale !== null && mention.rationale !== '' && (
            <p className="mt-2 text-xs italic text-slate-500">“{mention.rationale}”</p>
          )}
        </div>
        <SentimentBadge sentiment={mention.sentiment} />
      </div>
    </li>
  );
}

export function CompanyDrawer({
  slug,
  onClose,
}: {
  slug: string | null;
  onClose: () => void;
}): JSX.Element | null {
  const detail = useCompanyDetail(slug);
  const [closing, setClosing] = useState(false);

  /**
   * Closing runs the exit animation first, then unmounts. Without this the panel vanishes
   * mid-gesture, which reads as a glitch rather than as a dismissal - the one place where
   * skipping the animation would be more noticeable than having it.
   */
  const dismiss = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, 180);
  }, [onClose]);

  // Escape closes it. A slide-over dismissable only by mouse is one keyboard users get stuck in.
  useEffect(() => {
    if (slug === null) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slug, dismiss]);

  // The page behind must not scroll while a modal surface is open.
  useEffect(() => {
    if (slug === null) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [slug]);

  if (slug === null) return null;

  const company = detail.data?.company;
  const mentions = detail.data?.mentions ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close details"
        onClick={dismiss}
        className={`absolute inset-0 bg-slate-900/25 backdrop-blur-[2px] ${
          closing ? 'backdrop-out' : 'backdrop-in'
        }`}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={company ? `${company.name} press coverage` : 'Company details'}
        className={`relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl ${
          closing ? 'drawer-out' : 'drawer-in'
        }`}
      >
        <header className="flex items-start gap-3 border-b border-slate-200 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold text-slate-900">
              {company?.name ?? 'Loading…'}
            </h2>
            <p className="mt-0.5 truncate text-sm text-slate-500">{company?.sector ?? ' '}</p>
            {company && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[company.status]}`}
                >
                  {company.statusText}
                </span>
                <span className="tabular text-xs text-slate-500">
                  {company.mentionsInWindow} in window
                </span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <X className="size-5" aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {detail.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading mentions…
            </div>
          ) : detail.error ? (
            <div className="p-5">
              <ErrorState message={toMessage(detail.error)} onRetry={() => void detail.refetch()} />
            </div>
          ) : mentions.length === 0 ? (
            <NoMentions statusText={company?.statusText ?? 'no coverage found'} />
          ) : (
            <ul>
              {mentions.map((mention) => (
                <MentionRow key={mention.id} mention={mention} />
              ))}
            </ul>
          )}
        </div>

        {mentions.length > 0 && (
          <footer className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">
            Labels produced by {mentions[0]?.model ?? 'the local model'} ·{' '}
            {mentions[0]?.promptVersion ?? 'prompt version unknown'}
          </footer>
        )}
      </aside>
    </div>
  );
}
