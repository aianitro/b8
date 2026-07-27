'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { Plus } from 'lucide-react';

export default function PlaidLinkButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/plaid/create-link-token', { method: 'POST' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setLinkToken(res.data.link_token);
        else setError('Could not initialize Plaid');
      })
      .catch(() => setError('Could not initialize Plaid'));
  }, []);

  const onPlaidSuccess = useCallback(
    async (publicToken: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/plaid/exchange-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ public_token: publicToken }),
        });
        const data = await res.json();
        if (data.success) router.refresh();
        else setError('Failed to link account');
      } catch {
        setError('Failed to link account');
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  const { open, ready } = usePlaidLink({ token: linkToken ?? '', onSuccess: (t) => onPlaidSuccess(t) });

  if (error) return <p className="text-red-500 text-xs">{error}</p>;

  return (
    <button
      onClick={() => open()}
      disabled={!ready || loading}
      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors"
    >
      {loading
        ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
        : <Plus size={15} />
      }
      {loading ? 'Linking…' : 'Connect'}
    </button>
  );
}
