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

export default function RelativeTime({ iso }: { iso: string | null }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!iso) { setLabel('Never synced'); return; }
    setLabel(relative(iso));
    const id = setInterval(() => setLabel(relative(iso)), 60000);
    return () => clearInterval(id);
  }, [iso]);

  return <span className="text-xs text-gray-400">{label ?? ''}</span>;
}
