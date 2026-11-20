# NITS — P8-42a-loyalty-model-page-import

Follow-ups from REVIEW-1 (ACCEPT_WITH_NITS). Recorded, not absorbed. N1 and N3 are queued as the follow-up task
`P8-42a2-loyalty-nits` because the owner is about to run the import and edit numbers on the page.

- **N1 — an empty save erases a stored member number.** `components/LoyaltyMembershipLine.tsx:77-83` with
  `LoyaltyInlineText.tsx` (`startEmpty`): tapping the mask opens an empty editor; Save without typing sends
  `PATCH {memberNumber: null}`. A re-import does not restore it (existing memberships are never updated).
  Fix: an empty save on that field is a no-op; clearing is a separate, explicit control.
- **N2 — the import's stated repair path does not exist in the UI.** `scripts/import-loyalty.ts:27-28` says "add
  the alias on /travel", but the alias editor appears only on cards, and a catalog program with no membership has
  no card. A member's user link is not editable on the page; a member with no membership is not visible.
  Fix: an alias editor reachable from the catalog, a members list, or correct the comment.
- **N3 — `--as-of` has no upper bound in the import.** A typo year far in the future makes imported readings
  current ahead of every typed reading. Fix: refuse `--as-of` later than Postgres `CURRENT_DATE + 1`, exit 2.
- **N4 — the import's catch discards every diagnostic.** Print the SQLSTATE/errno code only (never detail or
  message) on stderr.
- **N5 — an alias containing a comma cannot round-trip** through the comma-joined alias editor
  (`LoyaltyProgramCard.tsx:63-66`).
- **N6 — no explicit `Cache-Control: no-store` on the S6 full-number response.** No concrete leak path found
  (client `no-store`, service worker skips `/api/`); no global header exists (`grep -i cache-control` over
  `proxy.ts` and `next.config.*` → no hits).
