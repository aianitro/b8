# REVIEW-1 — P6-40d-enriched-display

verdict: ACCEPT_WITH_NITS (conditional on H9) — 24 hypotheses. Refuted, among others: every
scheme/whitespace/backslash/userinfo/IDN path to a non-https `src`; raw input returned instead of the
normalised href; a second render path; onError retry loops; 'use client' boundary; grid placement on
phone and sm+; overflow at 390px; SELECTs gaining plaid_raw/joins/ordering; flows posting the row back;
detail-line garbage and date shifts; a vacuous wiring test; website shown. Findings: H9 (lazy +
mount-time heuristic, could mark below-the-fold logos dead — engine-dependent), wiring test checks only
`src`, #8 exit status non-discriminating, Transactions mark placement (accepted). scope_violations: [].
