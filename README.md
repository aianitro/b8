# b8

A personal finance app I built for my own household budgeting — bank sync via Plaid, envelope-style category budgets, and a chat assistant for asking questions about spending.

Built as a hobby project to get hands-on with a production-grade Plaid integration, an LLM tool-use agent loop, and a from-scratch (no ORM) Postgres data layer, alongside my main portfolio work (ZIA API Explorer, public MCP servers).

## Features

- **Bank sync** — Plaid Link to connect accounts, incremental sync via `transactionsSync` with a cursor, pending-transaction handling to avoid duplicate postings, and a daily scheduled sync
- **Budgets** — per-category annual budgets with an optional month-by-month allocation schedule (for categories that aren't evenly spread across the year), status thresholds, and a monthly grid view
- **Transactions** — search/filter by amount range, account, and category; auto-categorization rules mapping Plaid categories to budget categories; manual duplication/editing for corrections; CSV import for accounts Plaid can't reach
- **Accounts** — drag-and-drop ordering, editable type/balance, relinking after a Plaid reconnect (accounts are matched back to their transaction history by `persistent_account_id`/mask rather than treated as new)
- **Insights & balances** — top merchants, monthly spending trends, per-account/category running balances
- **Chat assistant** — an Anthropic-powered agent with read-only tools (budget summary, monthly spending, top merchants, transaction lookup) for asking natural-language questions about your own data

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- PostgreSQL via raw `pg` — no ORM, hand-written parameterized SQL
- Plaid API (production)
- Anthropic SDK (tool-use agent loop)
- Tailwind CSS

## Running locally

This is a single-user, self-hosted app — it expects to be run for one person's own accounts, not deployed as a multi-tenant service.

1. `npm install`
2. Create a Postgres database (with the `pgvector` extension available — see `db/schema.sql`'s note on building it from source against Postgres 16 on Homebrew)
3. Copy `.env.local.example` to `.env.local` and fill in your own Plaid, database, and Anthropic API credentials
4. `npm run migrate:up` — applies `migrations/` via `node-pg-migrate`, reading `DATABASE_URL` from the environment (`db/schema.sql` is kept as a human-readable reference of the same schema; the migrations are the source of truth)
5. `npm run dev`

The dev/start scripts bind to `127.0.0.1` only.

## Running via Docker

An alternative to the steps above — app + Postgres (with `pgvector`) in containers, no local Postgres install needed:

1. Copy `.env.local.example` to `.env.local`, fill in your credentials, and also set `POSTGRES_PASSWORD` (used only by the `db` container)
2. `npm run docker:up` — builds the app image, starts Postgres, runs migrations, then starts the app on `127.0.0.1:3000`
3. `npm run docker:down` to stop

Ports are published to `127.0.0.1` only, matching the dev/start scripts' own localhost-only binding.

## Note on data

This repo contains only application code and schema — no real account data, transactions, or credentials. All of that lives in a local Postgres database and a gitignored `.env.local`, neither of which is part of this repository.
