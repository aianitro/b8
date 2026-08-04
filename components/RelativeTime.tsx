'use client';

import { useEffect, useState } from 'react';

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function labelFor(iso: string | null): string {
  return iso ? relative(iso) : 'Never synced';
}

export default function RelativeTime({ iso }: { iso: string | null }) {
  const [label, setLabel] = useState(() => labelFor(iso));

  // Adjusted during render (not an effect) when `iso` itself changes, so a re-sync is reflected
  // immediately; the effect below is only the minute-tick subscription for the same `iso`.
  const [prevIso, setPrevIso] = useState(iso);
  if (iso !== prevIso) {
    setPrevIso(iso);
    setLabel(labelFor(iso));
  }

  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setLabel(relative(iso)), 60000);
    return () => clearInterval(id);
  }, [iso]);

  return <span className="text-xs text-gray-400">{label}</span>;
}
