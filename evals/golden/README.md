# Deriving the golden figures

Every `expect_amounts` value in `questions.json` is a constant, derived once by SQL against a
frozen seed database and checked in. **It is not computed at run time.** If the expected value
were produced by calling the same query the agent's tool calls, a bug in that query would move
both sides together and the eval would pass while the app was wrong — the failure this harness
exists to catch, reintroduced one level down.

## Rebuilding the frozen database

From the repo root. The `DATABASE_URL` override is what keeps this off the real database —
`seed-demo.mjs` truncates every table it touches and there is no default-yes path.

```sh
psql -d postgres -c 'DROP DATABASE IF EXISTS b8_evals;' -c 'CREATE DATABASE b8_evals;'
DATABASE_URL="postgresql://$(whoami)@localhost:5432/b8_evals" npx node-pg-migrate up
DATABASE_URL="postgresql://$(whoami)@localhost:5432/b8_evals" \
  node apps/web/scripts/seed-demo.mjs --yes-wipe-my-database
```

## Two more steps the harness needs

After seeding, the injection fixtures and a credential for minting a token:

```sh
psql -d b8_evals -f evals/golden/injection.sql
# The token minter refuses when no passkey is enrolled, and a fresh database has none:
psql -d b8_evals -c "INSERT INTO webauthn_credentials (credential_id, public_key, sign_count, enrolled_via) \
  VALUES ('evals-fixture-credential','\\x00'::bytea,0,'bootstrap') ON CONFLICT DO NOTHING;"
```

**Never run the repo's integration suite against this database** — it truncates transactions and
budget categories and deletes every figure below. See `../README.md`.

## Why every question is pinned to a completed month

`seed-demo.mjs` generates data for the **elapsed** part of the current year, so any
year-to-date figure changes on the first of every month. A past month's figures do not.

That is a claim about a pseudo-random generator, so it was measured rather than assumed. A copy
of the seed script with `TODAY` forced to 31 July was run into a second database, and Jan–June
compared against a seed made in September:

```sh
sed 's/^const TODAY = new Date();/const TODAY = new Date(new Date().getFullYear(), 6, 31, 12);/' \
  apps/web/scripts/seed-demo.mjs > apps/web/scripts/.seed-july-probe.mjs
# ...seed a second database with it, then:
Q="SELECT EXTRACT(MONTH FROM date)::int m, mapped_category, SUM(amount)::numeric(12,2)
   FROM transactions WHERE EXTRACT(MONTH FROM date)<=6 GROUP BY 1,2 ORDER BY 1,2;"
diff <(psql -d b8_evals -t -A -F'|' -c "$Q") <(psql -d b8_evals_july -t -A -F'|' -c "$Q")
```

**Identical across 118 category-months.** So a fixture pinned to a completed month is stable
whenever the harness is run; one pinned to YTD is not, and `budget-summary-overspend` asserts
routing only for exactly that reason.

## The derivation queries

Monthly category totals — the source for `groceries-june`, `dining-march`, `utilities-june`,
`transport-june`, `dining-march-vs-june`, `travel-march-offcycle`:

```sql
SELECT mapped_category,
       SUM(amount) FILTER (WHERE EXTRACT(MONTH FROM date)=3) AS mar,
       SUM(amount) FILTER (WHERE EXTRACT(MONTH FROM date)=6) AS jun
FROM transactions
WHERE amount > 0 AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
GROUP BY 1 ORDER BY 1;
```

`amount > 0` is spending; income is stored negative. This is written from the domain rule rather
than copied from `runTool`, so the two are independent statements of the same thing.

Top merchants — the source for `top-dining-merchant-h1`:

```sql
SELECT COALESCE(merchant_name, name) AS merchant, COUNT(*) n, SUM(amount)::numeric(12,2) total
FROM transactions
WHERE amount > 0 AND mapped_category = 'Dining Out'
  AND date BETWEEN '2026-01-01' AND '2026-06-30'
GROUP BY 1 ORDER BY total DESC LIMIT 5;
```

Largest May expense — the source for `large-may-transaction`:

```sql
SELECT date::text, amount, COALESCE(merchant_name, name) merchant, mapped_category
FROM transactions
WHERE amount > 500 AND date BETWEEN '2026-05-01' AND '2026-05-31'
ORDER BY amount DESC;
```

## Figures as derived

| Question | Figure | Source |
|---|---|---|
| `groceries-june` | 1040.40 | Groceries, June |
| `dining-march` | 548.63 | Dining Out, March |
| `dining-march-vs-june` | 548.63 / 474.12 | Dining Out, March and June |
| `utilities-june` | 450.00 | Utilities, June — four fixed debits, exact |
| `transport-june` | 676.01 | Transport, June |
| `travel-march-offcycle` | 1438.73 | Travel, March — budgeted only in June/August |
| `top-dining-merchant-h1` | 747.38 | Copper Kettle, 13 transactions, H1 |
| `large-may-transaction` | 4000.00 | Meridian Invest Transfer, 2026-05-05 |

## One inconsistency these fixtures pin rather than fix

`get_transactions` does not exclude transfers, while the system prompt states that transfers are
not spending. So the largest May "expense" the tool can see is a $4,000 transfer to a brokerage.
`large-may-transaction` asserts today's behaviour deliberately. If that is fixed, this fixture
should fail — that is the point of it — and the expected figure becomes 3839.07 (Summit Roofing).
