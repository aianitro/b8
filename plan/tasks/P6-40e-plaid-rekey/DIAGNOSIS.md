# Diagnosis before specifying P6-40e (orchestrator, 2026-10-07) — read-only, counts and months only

Run against the home server's database and live Plaid (`/transactions/sync` from no cursor, not persisted).

- Plaid items: 5; tokened accounts: 16 (ordinals only below).
- Stored Plaid-sourced rows whose id is absent from Plaid's current history **and** for which a Plaid
  transaction with the same account, date and amount exists under an id not stored locally: **524**.
  - By account: acct10 213, acct11 88, acct8 69, acct4 49, acct5 38, acct12 29, acct16 19, acct2 13,
    acct1 5. All but acct5 belong to item 1; acct5 belongs to item 2.
  - Transaction dates: 2026-04 … 2026-08. Row `created_at`: 2026-06 … 2026-08. **None created after
    August** — consistent with the item(s) being re-linked around end of August, after which Plaid's ids
    for history changed and sync never re-keyed the stored rows.
  - Candidate has the same `name` as the stored row: 523; differs: 0 (one row's candidate list was
    empty after excluding stored ids at the time of this count).
  - Rows with more than one candidate (identical same-day, same-amount purchases): **16** — ambiguous.
- Also from P6-40c's run: 7 Plaid transactions match CSV-imported rows (`csv_` ids) — owner decision:
  **excluded** from re-keying (they stay CSV rows).
- `sync_log` returned no rows grouped by month (empty or differently shaped) — not usable for dating.
- `apps/web/app/api/v1/plaid/exchange-token/route.ts` resets `accounts.cursor` to NULL when the access
  token changes (comment lines ~62–71, ~101–104), which would normally make sync re-deliver full history
  as `added` and let `matchReissuedTransactions` re-key. **Why that did not happen for these rows is the
  open root-cause question** — git history before 2026-09-21 is reachable only through the pre-workspace
  paths (the P1-10a move to `apps/web`).

## Root-cause facts gathered at G0 (orchestrator, read-only, counts and months only)
- Per item (ordinal): item 1 — 10 accounts, 0 NULL cursors, 1 distinct cursor, last sync 2026-10, first account 2026-06; item 2 — 3 accounts, 0 NULL, 1 distinct; items 3–5 — 1 account each, 0 NULL, 1 distinct. **No item has mixed or NULL cursors today** (H-d not active on real data now).
- Plaid-sourced rows created per day since 2026-08-15: a steady trickle every few days through 2026-10-07 (largest single day 38). **No burst of re-delivered history** — a token change through exchange-token resets the cursor to NULL, which would re-deliver full history as `added` and show as a spike; there is none.
- `matchReissuedTransactions` introduced 2026-08-10 (`e7d787b`, "Re-identify reissued transactions instead of duplicating history"); exchange-token's cursor reset on token change dates from 2026-08-11 (`898a845`). Both precede the end-of-August window, so "the matcher did not exist yet" (H-e, deploy-ordering) is not supported by history.
- Reading: consistent with **H-a** (Plaid changed ids on the same item, sync stayed incremental and never saw them as re-delivered history) — to be proven or refuted by RC-01..RC-03 and the implementer's evidence, not assumed.
