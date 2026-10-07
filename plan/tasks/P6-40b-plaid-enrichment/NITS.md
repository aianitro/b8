# NITS — P6-40b-plaid-enrichment (follow-ups, not absorbed)

**N1 (REVIEW-1) — fixed in cycle 1.** `as Required<Transaction>` replaced with a declared type;
TS2741 proven on a removed key.

**N2 (REVIEW-2) — `storableJson` builds `out` as `{}` and assigns `out[k] = v`.** An own
`__proto__` key from a parsed response would set the prototype (or be ignored) instead of being
copied, dropping a key the G3 amendment says must be kept. Unreachable with Plaid's fixed ASCII
schema. Fix when next touched: `Object.create(null)` or `Object.defineProperty`.

**Rulings recorded (REVIEW-2):** a key collision after sanitising is unreachable (fixed ASCII keys) —
accepted untested; an all-U+0000 string is stored as U+FFFD, not NULL — conforms ("Plaid sent
something here" is preserved; NULL means "Plaid did not say").
