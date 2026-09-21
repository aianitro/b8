'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// A minimal trend line for KPI cards — no axes, no tooltip, no legend, just the shape. Every
// number on the dashboard's KPI cards was a flat point-in-time value with zero trend context,
// despite the underlying series already being fetched for the charts further down the page.
export default function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const points = data.map((value, i) => ({ i, value }));

  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={color}
          fillOpacity={0.12}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
