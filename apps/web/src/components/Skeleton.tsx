/** Loading placeholders. Shaped like the content they replace, so nothing jumps on arrival. */
import type { JSX } from 'react';
export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
}

export function KpiSkeleton(): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-20" />
    </div>
  );
}

export function RowSkeleton(): JSX.Element {
  return (
    <div className="flex items-center gap-4 border-b border-slate-100 px-4 py-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="ml-auto h-6 w-28" />
      <Skeleton className="h-4 w-12" />
    </div>
  );
}

/**
 * Placeholder for the lazily-loaded chart. Matches the donut's footprint exactly, so the card
 * does not resize when Recharts finishes downloading.
 */
export function ChartSkeleton(): JSX.Element {
  return (
    <div
      className="flex h-48 items-center justify-center"
      aria-busy="true"
      aria-label="Loading chart"
    >
      <div className="size-[140px] animate-pulse rounded-full border-[25px] border-slate-200" />
    </div>
  );
}
