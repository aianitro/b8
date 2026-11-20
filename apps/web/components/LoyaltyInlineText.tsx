'use client';

// Loyalty (P8-42a) — click-to-edit for one text field on /travel (a name, a tier, a member number,
// a description, a date). Shows the value, or a muted placeholder when there is none; a tap opens a
// one-line form whose Save hands the text to `onSave`, which performs the write and returns null on
// success or the server's message. A blank save means "clear it" where the field allows that.
//
// THE CURRENT VALUE IS WHAT THE PAGE WAS GIVEN. For a member number that is the MASK: the editor
// starts EMPTY rather than pre-filled with bullets, so saving never writes the mask back as if it
// were the number (`startEmpty`).

import { useState } from 'react';

export default function LoyaltyInlineText({
  value, placeholder, label, onSave, startEmpty = false, type = 'text', mono = false,
}: {
  value: string | null;
  placeholder: string;
  label: string;
  onSave: (text: string) => Promise<string | null>;
  startEmpty?: boolean;
  type?: 'text' | 'date';
  mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setDraft(startEmpty ? '' : value ?? '');
    setError(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const message = await onSave(draft);
    setSaving(false);
    if (message === null) setEditing(false);
    else setError(message);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        aria-label={`Edit ${label}`}
        className={`text-left min-h-8 rounded px-1 -mx-1 hover:bg-gray-100 ${mono && value !== null ? 'font-mono' : ''} ${value === null ? 'text-gray-400' : ''}`}
      >
        {value ?? placeholder}
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-2">
      <input
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={label}
        autoFocus
        className="min-w-0 flex-1 border border-gray-200 rounded px-2 py-1.5 text-base sm:text-sm"
      />
      <button type="submit" disabled={saving} className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm disabled:opacity-50">
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} disabled={saving} className="px-2 py-1.5 text-sm text-gray-500 disabled:opacity-50">
        Cancel
      </button>
      {error && <p className="basis-full text-red-500 text-sm">{error}</p>}
    </form>
  );
}
