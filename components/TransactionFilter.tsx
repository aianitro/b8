'use client';

import { useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

type AccountOption = { id: string; name: string; landscape: string };

interface Props {
  total: number;
  uncategorized: number;
  accounts: AccountOption[];
  activeAccount: string | null;
}

export default function TransactionFilter({ total, uncategorized, accounts, activeAccount }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const activeFilter = params.get('filter');
  const searchValue = params.get('search') ?? '';
  const dateFromValue = params.get('dateFrom') ?? '';
  const dateToValue = params.get('dateTo') ?? '';
  const amountMinValue = params.get('amountMin') ?? '';
  const amountMaxValue = params.get('amountMax') ?? '';
  const hasDateRange = Boolean(dateFromValue || dateToValue);
  const hasAmountRange = Boolean(amountMinValue || amountMaxValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountMinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amountMaxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function nav(updates: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    p.delete('link');
    for (const [k, v] of Object.entries(updates)) {
      if (v) p.set(k, v); else p.delete(k);
    }
    router.push(`/transactions?${p.toString()}`);
  }

  function handleSearch(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => nav({ search: value || null }), 400);
  }

  function handleAmountMin(value: string) {
    if (amountMinDebounceRef.current) clearTimeout(amountMinDebounceRef.current);
    amountMinDebounceRef.current = setTimeout(() => nav({ amountMin: value || null }), 400);
  }

  function handleAmountMax(value: string) {
    if (amountMaxDebounceRef.current) clearTimeout(amountMaxDebounceRef.current);
    amountMaxDebounceRef.current = setTimeout(() => nav({ amountMax: value || null }), 400);
  }

  return (
    <div className="flex items-center gap-2 mb-5 flex-wrap">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search merchant or amount…"
          defaultValue={searchValue}
          onChange={(e) => handleSearch(e.target.value)}
          className="pl-8 pr-7 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 w-48"
        />
        {searchValue && (
          <button
            onClick={() => {
              if (inputRef.current) inputRef.current.value = '';
              nav({ search: null });
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Date range */}
      <div className="relative flex items-center gap-1">
        <input
          type="date"
          defaultValue={dateFromValue}
          onChange={(e) => nav({ dateFrom: e.target.value || null })}
          className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        <span className="text-slate-300 text-xs">–</span>
        <input
          type="date"
          defaultValue={dateToValue}
          onChange={(e) => nav({ dateTo: e.target.value || null })}
          className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
        {hasDateRange && (
          <button
            onClick={() => nav({ dateFrom: null, dateTo: null })}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            title="Clear date range"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Amount range */}
      <div className="relative flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Min $"
          defaultValue={amountMinValue}
          onChange={(e) => handleAmountMin(e.target.value)}
          className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 w-20"
        />
        <span className="text-slate-300 text-xs">–</span>
        <input
          type="number"
          inputMode="decimal"
          placeholder="Max $"
          defaultValue={amountMaxValue}
          onChange={(e) => handleAmountMax(e.target.value)}
          className="py-1.5 px-2 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10 w-20"
        />
        {hasAmountRange && (
          <button
            onClick={() => nav({ amountMin: null, amountMax: null })}
            className="text-slate-400 hover:text-slate-600 transition-colors"
            title="Clear amount range"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      <button
        onClick={() => nav({ filter: null })}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          !activeFilter
            ? 'bg-slate-900 text-white'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        All <span className="ml-1 text-xs opacity-60">{total.toLocaleString()}</span>
      </button>
      <button
        onClick={() => nav({ filter: activeFilter === 'uncategorized' ? null : 'uncategorized' })}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          activeFilter === 'uncategorized'
            ? 'bg-amber-500 text-white'
            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
        }`}
      >
        Uncategorized <span className="ml-1 text-xs opacity-70">{uncategorized}</span>
      </button>

      <div className="w-px h-5 bg-slate-200 mx-1" />

      <select
        value={activeAccount ?? ''}
        onChange={(e) => nav({ account: e.target.value || null })}
        className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      >
        <option value="">All accounts</option>
        {(['operational', 'capital'] as const).map((ls) => {
          const group = accounts.filter((a) => a.landscape === ls);
          if (group.length === 0) return null;
          return (
            <optgroup key={ls} label={ls.charAt(0).toUpperCase() + ls.slice(1)}>
              {group.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
