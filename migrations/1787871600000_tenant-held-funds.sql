-- Up Migration

-- Money a rental holds that arrived from its tenant. Two kinds, deliberately in ONE table with a
-- discriminator rather than two sibling tables: they are the same observation motif (per-property,
-- manually entered, positive magnitude, newest-wins) and differ only in how the app treats them.
-- Putting the difference in a column lets the schema state it, right here, next to the thing it
-- describes; splitting them across two tables would leave "which of these reduces net worth?"
-- answered nowhere in the schema and only implicitly in whichever query read which table. A third
-- kind (pet deposit, prepaid HOA) is then a one-line CHECK change rather than a fourth table.
--
--   'security_deposit' — refundable, owed back to the tenant at move-out, and a genuine liability.
--                        The cash sits in the property's trust checking account and is already
--                        counted there at full value, so net worth subtracts it exactly once, in
--                        the `liabilities` component (lib/domain/netWorth.ts). It counts whether
--                        or not the property has a current valuation — deliberately unlike a
--                        linked mortgage, which is netted *against* a property's value and is
--                        therefore dropped along with an unvalued property to avoid a naked debt.
--                        A deposit is netted against nothing; it is owed in full either way.
--   'last_month_rent'  — NOT a liability here, and that omission is a recorded decision rather
--                        than an oversight. Under accrual accounting it would be unearned
--                        revenue; this app is cash-basis throughout (computePropertyPnl sums
--                        transactions), so the payment was already recognized as rent income on
--                        the day it landed. Booking it as a liability now would make the
--                        net-worth statement and the P&L disagree about the same dollar. It is
--                        recorded and shown because "you are holding $X of tenant money" is true
--                        of it too; it contributes to no net-worth component and emits no
--                        contribution line.
--
-- Append-only, same as account_valuations/property_valuations: there is no "current amount"
-- column, so a changed holding is a new row and the history survives. "Currently held" is the
-- newest row per (property_id, kind), reduced through latestValueByKey (lib/domain/observations.ts)
-- rather than last-row-wins — none of the queries that feed it carry an ORDER BY to rely on.
-- No row for a property means the amount is UNKNOWN and renders "—"; a row whose value is 0 is a
-- real reading (a waived deposit, a last month's rent fully applied and not yet re-collected) and
-- renders $0. Nothing may collapse the first case into the second.
--
-- No `source` column, unlike the two valuation tables: those carry one because a Zillow-shaped API
-- is a named, plausible future observer of a property's market value. Nothing outside this app can
-- observe a security deposit, so a column with exactly one permitted value would be ceremony.
CREATE TABLE property_tenant_funds (
  id          SERIAL PRIMARY KEY,
  property_id INT NOT NULL REFERENCES properties(id) ON UPDATE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('security_deposit', 'last_month_rent')),
  -- Named value/valued_at, not amount/recorded_at: this is the third series in the app with the
  -- shape latestValueByKey() reduces, and the other two spell these two fields exactly so. A third
  -- spelling would make the shared reducer look like a coincidence rather than a rule.
  -- Always a positive magnitude; the sign is derived at use (`liabilities -= value`), never stored.
  -- The CHECK has no counterpart on account_valuations/property_valuations, where "always
  -- positive" is only a comment. It is enforced here because this is the one series whose sign is
  -- flipped on read: a negative row would turn an obligation into an asset and *raise* net worth,
  -- with nothing downstream looking wrong.
  value       NUMERIC(14, 2) NOT NULL CHECK (value >= 0),
  valued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_property_tenant_funds_property_id
  ON property_tenant_funds(property_id, kind, valued_at DESC);

-- Marks the boundary between two definitions of `liabilities` (and therefore of `total`).
--
-- P0-09a folded tenant security deposits (property_tenant_funds) into the liabilities component.
-- Rows written before that date mean "unlinked valuation-mode liability accounts"; rows written
-- after mean "…plus security deposits held." Same column, same type, different meaning — BUILD.md
-- §9.2's breaking class, and the one that renders perfectly while being false.
--
-- §9.2's stated remedy is a new field name rather than a redefinition. That remedy is not used
-- here, for a reason worth recording rather than inferring:
--
--   * Nothing reads `liabilities` from this table. app/net-worth/page.tsx selects snapshot_date,
--     operational, capital_financial, real_estate_equity, total; app/dashboard/page.tsx selects
--     snapshot_date, total. A `liabilities_v2` would put a boundary marker on a series no surface
--     plots, and leave the discontinuity that IS plotted — in `total` — unmarked.
--   * `total` is where the break actually lands, and it must not be renamed. It is the headline
--     figure on two pages and the basis of the dashboard's since-first-snapshot delta. Its meaning
--     also has not changed: "net worth on this date, as truthfully as the app could then state
--     it." Every future truthfulness fix would otherwise demand a total_v3, total_v4, and the
--     scheme collapses.
--   * A decomposition column is strictly more useful than a rename. Any post-cutover row converts
--     exactly back to the old definition (`liabilities - liabilities_security_deposits`), so a
--     consumer can plot either definition consistently across the whole history. A rename yields
--     two half-series with no bridge in either direction.
--
-- NULL on pre-cutover rows is the marker AND the honest value: it means "this row predates deposit
-- modelling," not "no deposits were held that day." Deposits were held; they had not been recorded
-- yet, and the figure is unrecoverable. 0 would assert something false, so no backfill is done.
-- Signed exactly as it lands in `liabilities` (i.e. <= 0) — every column in this row is signed as
-- it contributes, and mixing a magnitude in among them is the sign trap this repo has shipped once.
--
-- Load-bearing consequence for whoever writes the snapshot: every INSERT *and* the ON CONFLICT DO
-- UPDATE must set this column. A post-cutover row left NULL claims to be old-definition while
-- carrying a deposit-adjusted `liabilities` — a marker that lies is worse than no marker.
ALTER TABLE net_worth_snapshots
  ADD COLUMN liabilities_security_deposits NUMERIC(14, 2);

-- Down Migration

-- DESTRUCTIVE — both statements below discard observations that cannot be recomputed from
-- anything else in the database. property_tenant_funds is the sole record of what a tenant is
-- owed, and liabilities_security_deposits is the only thing distinguishing a post-cutover
-- snapshot row from a pre-cutover one. Back both up before running this against any database
-- holding real rows (BUILD.md §9.3 — CSV first, always):
--
--   \copy (SELECT * FROM property_tenant_funds ORDER BY id)
--     TO 'backup-property_tenant_funds.csv' CSV HEADER
--   \copy (SELECT snapshot_date, liabilities, liabilities_security_deposits
--            FROM net_worth_snapshots
--           WHERE liabilities_security_deposits IS NOT NULL ORDER BY snapshot_date)
--     TO 'backup-net_worth_snapshots-deposits.csv' CSV HEADER
--
-- Note what the second backup does NOT let you undo: dropping the column leaves the surviving
-- post-cutover `liabilities` and `total` values silently under the new definition with no marker
-- saying so, which is exactly the state this migration existed to prevent. Re-applying the up
-- migration restores the column as NULL for those rows, not as its former value — the CSV is the
-- only path back, and it has to be restored by hand.

ALTER TABLE net_worth_snapshots DROP COLUMN IF EXISTS liabilities_security_deposits;
DROP INDEX IF EXISTS idx_property_tenant_funds_property_id;
DROP TABLE IF EXISTS property_tenant_funds;
