'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface Props {
  title: string;
  /** Shown next to the title while collapsed — the one-line version of what's inside. */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

// Children are rendered by the server and passed through, so a server component's output can
// sit inside this client-side toggle without the child itself becoming a client component.
export default function CollapsibleSection({ title, summary, defaultOpen = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center justify-between gap-3 w-full px-6 py-3 text-left"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
          {!open && summary && <span className="text-xs text-slate-400 truncate">· {summary}</span>}
        </span>
        <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}
