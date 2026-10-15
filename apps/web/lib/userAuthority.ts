// Who may invite a user or remove one — the one asymmetry between two otherwise equal peers.
//
// A PURE FUNCTION, beside `registrationGate.ts` and for its reasons: both `POST /auth/invitations`
// and `POST /auth/users/[id]/revoke` must apply the same rule, and one predicate is what stops them
// becoming two nearly-identical `if`s that drift. It is also the only form in which the rule can be
// stated over every combination of kind, scope and owner flag without a database.
//
// THREE PROPERTIES, ALL REQUIRED, and each one refuses a caller the other two would admit:
//
//   THE OWNER. The owner's decision at G0: inviting and removing are the owner's alone. The second
//   user is a full peer over the ledger and has no say over who else may sign in.
//
//   A BROWSER SESSION. Not a personal token, even the owner's and even full-scope. A token is
//   minted over SSH for a script; a script that could mint invitations could create a permanent
//   second principal that outlives the token's revocation — the argument `sessionMayEnrol` makes
//   about enrolling a passkey, applied to the larger act of creating a person.
//
//   FULL SCOPE. Implied by "browser" today (the schema allows `read` only on personal tokens), and
//   checked anyway, so this does not start passing a read-only browser session if that constraint
//   ever moves.
//
// WHAT IT IS NOT: a lookup. Whether the session's user is the owner is a fact the caller reads from
// `users.is_owner`; this function decides what that fact permits.

import type { EnrolCandidate } from './registrationGate';

export function sessionMayAdminister(session: EnrolCandidate | null, isOwner: boolean): boolean {
  if (!session) return false;
  return isOwner && session.kind === 'browser' && session.scope === 'full';
}
