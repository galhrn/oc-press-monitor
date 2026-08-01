/**
 * Portfolio KPIs and the sentiment split (task P6.5, requirement R1).
 *
 * Two deliberate choices.
 *
 * **"No coverage" is a headline number, not a leftover.** It sits beside the mention count
 * rather than being implied by subtraction, because for this portfolio it is frequently the
 * true answer - OncoHost's most recent press anywhere is months old - and a dashboard that
 * only counts what it found is reporting on its own reach rather than on the portfolio.
 *
 * **The chart is a donut, not a pie.** Three categories with one dominant slice is exactly
 * where a pie stops being readable, and the hole gives the total somewhere to live.
 */
import type { JSX } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { EyeOff, FileText, PieChart as PieIcon, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { SummaryResponse } from '@oc/api/contract';
import { KpiSkeleton, Skeleton } from '@/components/Skeleton';
import { SENTIMENT_COLOR, compactNumber } from '@/lib/format';
import type { QueryLike } from '@/lib/types';

type Tone = 'default' | 'positive' | 'negative' | 'muted';

const TONE: Record<Tone, string> = {
  default: 'text-slate-900',
  positive: 'text-emerald-700',
  negative: 'text-rose-700',
  muted: 'text-slate-500',
};

function Kpi({
  label,
  value,
  icon,
  tone = 'default',
  hint,
}: {
  label: string;
  value: number;
  icon: JSX.Element;
  tone?: Tone;
  hint?: string;
}): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <p className={`tabular mt-2 text-3xl font-semibold ${TONE[tone]}`}>{compactNumber(value)}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function SummaryBanner({ query }: { query: QueryLike<SummaryResponse> }): JSX.Element {
  if (query.data === undefined) {
    return (
      <section aria-busy="true" className="grid gap-4 lg:grid-cols-3">
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
          <KpiSkeleton />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-4 h-40 w-full" />
        </div>
      </section>
    );
  }

  const { totals, sentiment } = query.data;
  const slices = (
    [
      { name: 'Positive', key: 'positive', value: sentiment.positive },
      { name: 'Neutral', key: 'neutral', value: sentiment.neutral },
      { name: 'Negative', key: 'negative', value: sentiment.negative },
    ] as const
  ).filter((slice) => slice.value > 0);

  const classified = sentiment.positive + sentiment.negative + sentiment.neutral;

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
        <Kpi
          label="Mentions in window"
          value={totals.mentions}
          icon={<FileText className="size-3.5" aria-hidden />}
          hint={`across ${totals.withCoverage} companies`}
        />
        <Kpi
          label="No coverage"
          value={totals.withoutCoverage}
          icon={<EyeOff className="size-3.5" aria-hidden />}
          tone="muted"
          hint="companies with no press in the window"
        />
        <Kpi
          label="Positive"
          value={sentiment.positive}
          icon={<ThumbsUp className="size-3.5" aria-hidden />}
          tone="positive"
        />
        <Kpi
          label="Negative"
          value={sentiment.negative}
          icon={<ThumbsDown className="size-3.5" aria-hidden />}
          tone="negative"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
          <PieIcon className="size-3.5" aria-hidden />
          Sentiment distribution
        </h2>

        {classified === 0 ? (
          <p className="py-16 text-center text-sm text-slate-400">Nothing classified yet.</p>
        ) : (
          <div className="h-48" role="img" aria-label={`Sentiment across ${classified} mentions`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[...slices]}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={70}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.key} fill={SENTIMENT_COLOR[slice.key]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [compactNumber(Number(value ?? 0)), String(name)]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12 }}
                />
                <Legend
                  verticalAlign="bottom"
                  height={24}
                  iconType="circle"
                  formatter={(value) => (
                    <span className="text-xs text-slate-600">{String(value)}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}
