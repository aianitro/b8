// Reading an invitation out of `/login`'s URL fragment (P7-41a2) — the invitee's end of the link
// `invitationLink.ts` builds.
//
// A SEPARATE MODULE FROM THE LINK BUILDER for one reason: this is the half that needs the contract.
// What counts as a well-formed code is whatever `invitationCode` in `packages/contracts/auth.ts`
// accepts — the same schema the server applies to the header — and restating "22 or more base64url
// characters" by hand here would be a second definition of one rule, free to drift. Only the login
// page imports this, so the validation library lands in that page's bundle and not in the shell's.

import { invitationCode } from '@b8/contracts/auth';
import { INVITE_FRAGMENT_KEY } from './invitationLink';

/**
 * What a fragment says about an invitation.
 *
 *   `none`       — no `invite` key at all. Ordinary `/login`, exactly as before this step.
 *   `invalid`    — an `invite` key is there but its value is not a code the contract accepts, or
 *                  there are two of them. The page refuses, and sends nothing.
 *   `invitation` — exactly one well-formed code.
 *
 * THREE STATES, NOT TWO, because "present but unreadable" must never collapse into either of the
 * others. Read as `none`, a mangled link silently becomes the ordinary page and the invitee is told
 * registration is closed, which is true and useless. Read as a code, the page sends a partial secret
 * to the server. Neither is what the person holding a broken link needs to hear.
 */
export type InvitationFragment =
  | { kind: 'none' }
  | { kind: 'invalid' }
  | { kind: 'invitation'; code: string };

/**
 * Read `location.hash` (with or without its leading `#`).
 *
 * SPLIT BY HAND, NOT WITH `URLSearchParams`, because that class decodes: it turns `+` into a space
 * and `%2B` into `+`, so a damaged code would be "repaired" into a different string before the
 * contract ever saw it. The value is handed to the schema byte for byte, and a code containing `%`,
 * `+`, `/`, `=` or a space is refused as the server would refuse it.
 *
 * A key is matched whole, so `#invitee` and `#section` are not invitations. A bare `#invite` with no
 * `=` is: the key is there, the value is empty, and an empty value is not a code.
 */
export function readInvitationFragment(hash: string): InvitationFragment {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment === '') return { kind: 'none' };

  const values: string[] = [];
  for (const pair of fragment.split('&')) {
    const equals = pair.indexOf('=');
    const key = equals === -1 ? pair : pair.slice(0, equals);
    if (key === INVITE_FRAGMENT_KEY) values.push(equals === -1 ? '' : pair.slice(equals + 1));
  }

  if (values.length === 0) return { kind: 'none' };
  // Two codes in one link is not a choice this page can make: either could be the damaged one.
  if (values.length > 1) return { kind: 'invalid' };
  const candidate = values[0];
  return invitationCode.safeParse(candidate).success ? { kind: 'invitation', code: candidate } : { kind: 'invalid' };
}
