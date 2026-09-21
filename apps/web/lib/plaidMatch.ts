// The pure matching core of account reconciliation, extracted from plaidReconcile.ts so it
// can be unit tested without Plaid or a database (ROADMAP.md §2: keep the tricky predicates
// DB-free and testable — the same pattern SCMPulse used for its permission matrix).
//
// This decides *what* should be remapped. plaidReconcile.ts owns the I/O: fetching live
// accounts, and applying the remaps/backfills this returns.

export interface DbAccountRow {
  id: string;
  name: string;
  mask: string | null;
  subtype: string | null;
  persistent_account_id: string | null;
}

export interface LiveAccount {
  account_id: string;
  name: string;
  mask?: string | null;
  subtype?: string | null;
  persistent_account_id?: string | null;
}

export type MatchStrategy =
  | 'persistent_account_id'
  | 'mask'
  | 'name'
  | 'fuzzy-name'
  | 'elimination';

export interface Remap {
  oldId: string;
  newId: string;
  name: string;
  matchedBy: MatchStrategy;
  mask: string | null;
  persistentAccountId: string | null;
}

/** An already-matching account whose stored identifiers drifted and should be refreshed. */
export interface Backfill {
  id: string;
  mask: string | null;
  persistentAccountId: string | null;
}

export interface MatchResult {
  remapped: Remap[];
  backfills: Backfill[];
  unmatchedLive: { id: string; name: string; mask: string | null }[];
  unmatchedDb: { id: string; name: string; mask: string | null }[];
}

export function matchAccounts(liveAccounts: LiveAccount[], dbAccounts: DbAccountRow[]): MatchResult {
  const claimedDbIds = new Set<string>();
  const remapped: Remap[] = [];
  const backfills: Backfill[] = [];
  let pending: LiveAccount[] = [];

  // Pass 0: ids that still match outright. Nothing to remap, but stored identifiers may have
  // drifted — collect those so future reconciliation has stronger signals to match on.
  for (const a of liveAccounts) {
    const existing = dbAccounts.find((d) => d.id === a.account_id);
    if (!existing) {
      pending.push(a);
      continue;
    }
    claimedDbIds.add(existing.id);
    if (
      existing.mask !== (a.mask ?? null) ||
      existing.persistent_account_id !== (a.persistent_account_id ?? null)
    ) {
      backfills.push({
        id: existing.id,
        mask: a.mask ?? null,
        persistentAccountId: a.persistent_account_id ?? null,
      });
    }
  }

  const candidates = () => dbAccounts.filter((d) => !claimedDbIds.has(d.id));

  const runPass = (strategy: MatchStrategy, find: (a: LiveAccount) => DbAccountRow | undefined) => {
    const remaining: LiveAccount[] = [];
    for (const a of pending) {
      const match = find(a);
      if (match) {
        claimedDbIds.add(match.id);
        remapped.push({
          oldId: match.id,
          newId: a.account_id,
          name: match.name,
          matchedBy: strategy,
          mask: a.mask ?? null,
          persistentAccountId: a.persistent_account_id ?? null,
        });
      } else {
        remaining.push(a);
      }
    }
    pending = remaining;
  };

  // Pass 1: persistent_account_id — Plaid's purpose-built stable identifier.
  runPass('persistent_account_id', (a) =>
    a.persistent_account_id
      ? candidates().find((d) => d.persistent_account_id === a.persistent_account_id)
      : undefined
  );

  // Pass 2: mask + subtype — survives account renames.
  runPass('mask', (a) =>
    a.mask
      ? candidates().find((d) => d.mask === a.mask && d.subtype === (a.subtype ?? null))
      : undefined
  );

  // Pass 3: exact name match — the original heuristic, kept as a fallback.
  runPass('name', (a) => candidates().find((d) => d.name === a.name));

  // Pass 4: fuzzy name — catches user renames like "Trust Myrtle Beach" -> "Trust Myrtle
  // Beach (1503)" where one name contains the other, same type.
  runPass('fuzzy-name', (a) => {
    const liveName = a.name.toLowerCase();
    return candidates().find((d) => {
      if (d.subtype !== (a.subtype ?? null) && d.subtype !== null) return false;
      const dbName = d.name.toLowerCase();
      return dbName.includes(liveName) || liveName.includes(dbName);
    });
  });

  // Pass 5: elimination — if exactly one candidate remains on each side, they must be the
  // same account under a name AND mask that both changed. Anything less certain (0 or 2+
  // remaining) is left unmatched rather than risk merging the wrong accounts.
  const leftoverDb = candidates();
  if (pending.length === 1 && leftoverDb.length === 1) {
    const [a] = pending;
    const [match] = leftoverDb;
    claimedDbIds.add(match.id);
    remapped.push({
      oldId: match.id,
      newId: a.account_id,
      name: match.name,
      matchedBy: 'elimination',
      mask: a.mask ?? null,
      persistentAccountId: a.persistent_account_id ?? null,
    });
    pending = [];
  }

  return {
    remapped,
    backfills,
    unmatchedLive: pending.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask ?? null })),
    unmatchedDb: candidates().map((d) => ({ id: d.id, name: d.name, mask: d.mask })),
  };
}
