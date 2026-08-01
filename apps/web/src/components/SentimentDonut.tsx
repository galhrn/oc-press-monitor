/**
 * The sentiment donut, isolated so Recharts can be code-split.
 *
 * Recharts is by far the heaviest thing the dashboard imports - it was roughly two thirds of
 * the bundle. It is also the one piece of the page that is not needed to read the page: the
 * KPI numbers, the grid and the drill-down all render without it. Splitting it moves ~450 kB
 * out of the critical path for a chart that occupies a third of one card.
 *
 * This module is the only place Recharts is imported. Anything else that pulls it in
 * statically would defeat the split silently, so it stays deliberately small.
 */
import type { JSX } from 'react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Sentiment } from '@oc/api/contract';
import { SENTIMENT_COLOR, compactNumber } from '@/lib/format';

export interface DonutSlice {
  name: string;
  key: Sentiment;
  value: number;
}

export default function SentimentDonut({ slices }: { slices: DonutSlice[] }): JSX.Element {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div className="h-48" role="img" aria-label={`Sentiment across ${total} mentions`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={70}
            paddingAngle={2}
            strokeWidth={0}
            animationDuration={450}
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
            formatter={(value) => <span className="text-xs text-slate-600">{String(value)}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
