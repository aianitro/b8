# P8-42c3 — nits (from REVIEW-1 to REVIEW-3)

- **N1:** SPEC.md command #13 checks that the oracle names the fixture dir with `-ge 0`, so it is always true. Drop it
  in a follow-up spec, or make it a real check. It is orchestrator-owned and not load-bearing. (REVIEW-1 N2,
  REVIEW-3 N1)
- **N2 (stated residual):** the text sent can be shorter than `maxChars`. This happens when the scrub shortens the
  bounded text a lot, or when the bound drops a trailing word. A mail whose first 21k characters hold no whitespace is
  recorded as `empty_message`. (A2, A3)
- **N3 (environment):** the gate run saw a one-off `T42b2-I7` (gifts) flake in the implementer's cycle-2 run. It did
  not recur in three orchestrator runs. Whether it depends on time of day is UNCONFIRMED.
