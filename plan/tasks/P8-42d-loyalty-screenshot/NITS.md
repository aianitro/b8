# P8-42d — nits (from REVIEW-1)

- **N1:** `T42d-U4`'s household-canary loop cannot fail (the reader takes no household data). Reword or move the check
  to a route-level capture at the SDK seam.
- **N2:** a database failure in `screenshotTargetOf` makes the read route answer a generic 500; wrap it like
  `appendObservation` does (`fromPgError`).
- **N3:** the due SQL restates the coverage statement's "newest settled read" and the reducer order; share one SQL
  fragment between the coverage and due subqueries.
- **N4:** the read route buffers the whole body before the size bound (as receipts does) and has no per-caller
  throttle on a paid call.
- **N5:** the capture form says "Nothing could be read" when only the balance is missing.
- **N6:** H16(g) re-checks a filtered subset of H15's expected text.
- **Stated by the spec:** expiries and instruments read from a screenshot are shown, not stored (D7; 42e/42g).
- **Environment:** `apps/web/.next/` holds iCloud "<name> 2.json" copies of build output.
