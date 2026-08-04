'use client';

import { useRouter } from 'next/navigation';
import type { Landscape } from '@/shared/types';

interface Props {
  current: Landscape;
  view: 'annual' | 'monthly';
}

export default function BudgetTabsToggle({ current, view }: Props) {
  const router = useRouter();

  return (
    <div className="flex border-b border-slate-200 mb-8 -mt-2">
      {(['operational', 'capital'] as const).map((ls) => (
        <button
          key={ls}
          onClick={() => {
            document.cookie = `budgetLandscape=${ls};path=/;max-age=31536000`;
            router.push(`/budget?landscape=${ls}&view=${view}`);
            router.refresh();
          }}
          className={`px-5 py-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
            current === ls
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-400 hover:text-slate-600'
          }`}
        >
          {ls}
        </button>
      ))}
    </div>
  );
}
