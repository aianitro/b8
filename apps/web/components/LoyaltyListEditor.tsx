'use client';

// Loyalty (P8-42c1) — the editor for a short list typed as one line of comma-separated entries: a
// program's sender domains, a member's forwarding addresses. The aliases editor in
// `LoyaltyProgramCard` is the pattern: the whole list is shown, edited and saved as ONE replacement,
// which the route applies atomically, so a refused entry (a shared mail provider, an address another
// member holds) leaves the stored list exactly as it was and the form open with the server's message.
//
// The control is a labelled button rather than the value itself, because an empty list has nothing
// to tap and the label says what the list is for. Entries are sent as typed (trimmed); the server
// normalises and validates them and never echoes one back in an error.

import { useState } from 'react';

export default function LoyaltyListEditor({
  label, values, onSave,
}: {
  /** The button's text, also the input's accessible name. */
  label: string;
  values: string[];
  /** Performs the write; null on success, or the server's message. */
  onSave: (entries: string[]) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(values.join(', '));
    setError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const message = await onSave(draft.split(',').map((x) => x.trim()).filter((x) => x !== ''));
    setSaving(false);
    if (message === null) setEditing(false);
    else setError(message);
  }

  if (!editing) {
    return (
      <button type="button" onClick={open} className="min-h-8 px-2 -mx-2 text-xs text-gray-500 hover:text-gray-900">
        {label}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="mt-1 flex flex-wrap items-center gap-2">
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={label}
        placeholder="Separate entries with commas"
        autoFocus
        className="min-w-0 flex-1 border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm"
      />
      <button type="submit" disabled={saving} className="min-h-8 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={saving} className="min-h-8 px-2 py-1.5 text-sm text-gray-500 disabled:opacity-50">
        Cancel
      </button>
      {error && <p className="basis-full text-red-500 text-sm">{error}</p>}
    </form>
  );
}
