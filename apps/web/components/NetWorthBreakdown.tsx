'use client';

import { useState } from 'react';
import Link from 'next/link';
import { roundCents } from '@/lib/budgetMath';

export interface BreakdownLine {
  kind: 'account' | 'property';
  id: string;
  name: string;
  href: string;
  value: number;
}

export interface BreakdownComponent {
  key: string;
  label: string;
  accent: string;
  amount: number;
  lines: BreakdownLine[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const signed = (n: number) => (n < 0 ? `−${fmt(Math.abs(n))}` : fmt(n));

const isZero = (n: number) => roundCents(n) === 0;

// A $0 line is usually a paid-off account, a linked-but-not-yet-valued one, or a closed card
// still sitting around — real, but rarely what someone opening this page wants to scan past to
// find the balances that actually move the total. Hidden by default, one click to bring back;
// nothing is ever dropped from the underlying sum, only from this list's default view.
export default function NetWorthBreakdown({ components }: { components: BreakdownComponent[] }) {
  const [showZero, setShowZero] = useState(false);

  const hiddenCount = components.reduce(
    (sum, c) => sum + c.lines.filter((l) => isZero(l.value)).length,
    0
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">What makes it up</h2>
      <div className="space-y-5">
        {components.map((c) => {
          if (c.lines.length === 0) return null;
          const visible = (showZero ? c.lines : c.lines.filter((l) => !isZero(l.value)))
            .slice()
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
          if (visible.length === 0) return null;

          return (
            <div key={c.key}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${c.accent}`} />
                  <span className="text-xs font-semibold text-slate-700">{c.label}</span>
                </span>
                <span className="text-xs font-mono font-semibold text-slate-700">{signed(c.amount)}</span>
              </div>
              <ul className="divide-y divide-slate-50">
                {visible.map((l) => (
                  <li key={`${l.kind}-${l.id}`} className="flex items-center justify-between py-1.5 text-xs">
                    <Link href={l.href} className="text-slate-500 hover:text-slate-800 truncate transition-colors">
                      {l.name}
                      {l.kind === 'property' && <span className="text-slate-300 ml-1.5">property</span>}
                    </Link>
                    <span className={`font-mono shrink-0 ${l.value < 0 ? 'text-red-500' : 'text-slate-600'}`}>
                      {signed(l.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {hiddenCount > 0 && (
        <button
          onClick={() => setShowZero((v) => !v)}
          className="text-[11px] text-slate-400 hover:text-slate-600 mt-4 pt-3 border-t border-slate-100 w-full text-left transition-colors"
        >
          {showZero
            ? 'Hide $0 balances'
            : `Show ${hiddenCount} with $0 balance`}
        </button>
      )}
    </div>
  );
}
