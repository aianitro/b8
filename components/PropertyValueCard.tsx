'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import PropertyValueChart, { type PropertyValuePoint } from './charts/PropertyValueChart';
import PropertyValuationHistory, { type ValuationRow } from './PropertyValuationHistory';

interface Props {
  propertyId: number;
  chartData: PropertyValuePoint[];
  rows: ValuationRow[];
}

// Folds the old standalone "Valuations" card into the chart it feeds. They were always the same
// subject — one drawing the series, the other editing it — and splitting them meant a permanent
// card whose usual state is "nothing to do here": values get entered a few times a year.
//
// The recorded-readings list comes along rather than being dropped, because it carries the only
// way to remove a mistyped value, and a fat-fingered entry is exactly what makes the chart above
// look wrong.
export default function PropertyValueCard({ propertyId, chartData, rows }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-baseline gap-2 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Value over time</p>
          {rows.length > 0 && (
            <span className="text-[10px] text-slate-400 shrink-0">
              · {rows.length} reading{rows.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700 transition-colors shrink-0"
        >
          {open ? <><X size={11} /> Close</> : <><Plus size={11} /> Add value</>}
        </button>
      </div>

      <PropertyValueChart data={chartData} />

      {open && (
        <div className="mt-5 pt-5 border-t border-slate-100">
          <PropertyValuationHistory propertyId={propertyId} rows={rows} />
        </div>
      )}
    </div>
  );
}
