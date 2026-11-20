# NITS — P8-42a2-loyalty-nits

From REVIEW-1 (ACCEPT_WITH_NITS). Both are test-strength gaps; the shipped code is correct for both.

- **N1 — U2 detects a call to the null handler only from the "Remove number" element** (`lib/loyaltyNits.test.ts:342-351`).
  A Keep changed to `onClick={() => removeNumber()}` would erase a number on Remove → Keep and still pass every
  acceptance command. Fix: extend the call-through check to every JSX `on…` handler other than Confirm's; add a
  fabricated `keepClick` violation.
- **N2 — U2 does not prove Confirm appears only after the first tap** (`lib/loyaltyNits.test.ts:336-352`). A Confirm
  rendered beside Remove, always visible, would pass. Fix: assert Confirm sits in the `whenTrue` branch of the
  conditional whose `whenFalse` branch holds Remove.
