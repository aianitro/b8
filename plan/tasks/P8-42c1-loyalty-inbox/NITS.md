# P8-42c1 — accepted nits (follow-up)

- **N1 (REVIEW-1 NIT 4): an address edit racing a poll can leave a message `unmatched`.** `collect` loads the routing
  once, at the start of the poll. If a member PATCH adds an address and commits while a poll is running, its
  `reattributeInbox` only sees the rows already committed. A message for that address that the poll stores afterwards
  keeps the stale `unmatched`, until the next address edit. Fix: run `reattributeInbox` at the end of each locked poll
  (it is cheap and idempotent), or make the PATCH take the poll's advisory lock.
- **N2: re-downloading mail with no Message-ID.** A message without a Message-ID, including an unreadable one, is
  downloaded again on each poll (bounded at the size cap) while it is in the retention window, and counted once (A3.4).
  If this costs too much, key it on the envelope before the download.
- **N3: the adapter's own close bound has no test.** Only the poller's bound, which is the one that frees the lock, is
  exercised. OQ13 covers the real IMAP path.
- **N4: `npm audit --omit=dev` reports 5 high and 1 critical, all from packages already in HEAD's lockfile.** The new
  dependencies add none. This is a separate dependency-upgrade task.
