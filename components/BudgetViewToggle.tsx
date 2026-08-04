'use client';

import { useRouter } from 'next/navigation';

interface Props {
  current: 'annual' | 'monthly';
  landscape: 'operational' | 'capital';
}

export default function BudgetViewToggle({ current, landscape }: Props) {
  const router = useRouter();

  return (
    <div className="flex items-center bg-slate-100 rounded-xl p-1 gap-0.5">
      {(['annual', 'monthly'] as const).map((v) => (
        <button
          key={v}
          onClick={() => {
            document.cookie = `budgetView=${v};path=/;max-age=31536000`;
            router.push(`/budget?landscape=${landscape}&view=${v}`);
          }}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize ${
            current === v
              ? 'bg-white text-slate-800 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
