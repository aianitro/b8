'use client';

// The owner's "invite someone" control, at the foot of the sidebar and of the phone drawer
// (P7-41a2). Typing a name mints an invitation through `POST /api/v1/auth/invitations` and shows the
// link that carries the code — once.
//
// SHOWN ONCE MEANS HELD ONLY HERE. The code lives in this component's state while the panel is open
// and nowhere else: not in storage, not in a cookie, not in the URL, not in a log. "Done" clears it;
// so does leaving the page, because the sidebar remounts this component per pathname, and closing
// the drawer, because the drawer unmounts. There is no endpoint that reads a code back, so a lost
// one is replaced by minting another — the panel cannot re-display what it has dropped.
//
// RENDERED FOR THE OWNER ONLY, and that is a courtesy, not the gate. `Sidebar.tsx` decides with
// `mayInvite` (strictly `isOwner === true`), and the server refuses anybody else's POST whatever
// this shows.
//
// THE SIDEBAR'S PALETTE, not the app's slate. This renders on the cyan-700 brand ground, where the
// legible inks are white and cyan-100 only (uiux-promax: 4.5:1 at this size), so the panel speaks
// in those and in white washes. The one surface that is not the ground is the text field, which is
// white with slate ink because it is an input, not chrome.
//
// NO VALIDATION LIBRARY: the created body is checked structurally (`createdInvitation`), for the
// reason `Sidebar.tsx` gives about the shell bundle.

import { useRef, useState } from 'react';
import { UserPlus } from 'lucide-react';
import type { InvitationCreateRequest, InvitationCreated } from '@b8/contracts/auth';
import { createdInvitation, invitationLink } from '@/lib/invitationLink';

/** The server's `expiresAt`, as a date and time in the owner's locale. Formatted, never recomputed. */
function formatExpiry(expiresAt: string): string {
  const at = new Date(expiresAt);
  return Number.isNaN(at.getTime())
    ? expiresAt
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

/** The error text out of a refused create, or a plain fallback — never raw JSON. */
function refusal(body: unknown): string {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : 'The invitation could not be created. Try again.';
}

export default function InviteControl() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<InvitationCreated | null>(null);
  const [copied, setCopied] = useState(false);
  // A REF AS WELL AS `busy`, because a double click can land twice before React re-renders the
  // disabled button. Two mints would leave the first code orphaned with no panel to show it.
  const inFlight = useRef(false);

  function dismiss() {
    setCreated(null);
    setName('');
    setError(null);
    setCopied(false);
    setOpen(false);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current || name.length === 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const request: InvitationCreateRequest = { displayName: name };
      const response = await fetch('/api/v1/auth/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => null);
      const invitation = response.ok ? createdInvitation(body) : null;
      // No link unless the whole body is there: a half-formed link is worse than none.
      if (invitation) setCreated(invitation);
      else setError(refusal(body));
    } catch {
      setError('The invitation could not be created. Check the connection and try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // No clipboard (a non-secure origin, or permission refused): the field is selectable by hand.
      setCopied(false);
    }
  }

  if (!open) {
    return (
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-invite-control
          className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-cyan-100 hover:text-white hover:bg-white/10 transition-colors"
        >
          <UserPlus size={16} className="shrink-0" />
          Invite someone
        </button>
      </div>
    );
  }

  const link = created ? invitationLink(window.location.origin, created.code) : null;

  return (
    <div data-invite-control data-invite-panel className="mx-3 mt-3 rounded-lg bg-white/10 p-3 text-xs text-cyan-100">
      {link && created ? (
        <>
          <p className="font-medium text-white">Send this link to {name}. It is shown only once.</p>
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Invitation link"
            data-invite-link
            className="mt-2 w-full rounded bg-white px-2 py-1.5 text-xs text-slate-900"
          />
          <p className="mt-2">
            Works once, until <time dateTime={created.expiresAt} className="text-white">{formatExpiry(created.expiresAt)}</time>.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => copy(link)} className="flex-1 rounded bg-white px-2 py-1.5 font-medium text-cyan-700 hover:bg-cyan-50">
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" onClick={dismiss} data-invite-done className="flex-1 rounded px-2 py-1.5 font-medium text-white hover:bg-white/10">
              Done
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={create}>
          <label className="block font-medium text-white" htmlFor="invite-name">Who are you inviting?</label>
          <input
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            autoComplete="off"
            placeholder="Their name"
            // 16px on a phone, because iOS zooms the page on focus into any field set smaller.
            className="mt-2 w-full rounded bg-white px-2 py-1.5 text-base md:text-sm text-slate-900"
          />
          {error && <p role="alert" className="mt-2 rounded bg-white/15 px-2 py-1.5 text-white">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={busy || name.length === 0}
              data-invite-submit
              className="flex-1 rounded bg-white px-2 py-1.5 font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create link'}
            </button>
            <button type="button" onClick={dismiss} disabled={busy} className="flex-1 rounded px-2 py-1.5 font-medium text-white hover:bg-white/10 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
