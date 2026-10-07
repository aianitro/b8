-- P6-40d preview seed. FABRICATED ONLY: one made-up checking account and ten made-up rows, for the
-- browser evidence in SPEC.md. Load into the scratch database only, never b8_finance:
--
--   psql -d b8_p640d_preview -v ON_ERROR_STOP=1 -f plan/tasks/P6-40d-enriched-display/preview-seed.sql
--
-- Then run the app against it (DATABASE_URL=postgres:///b8_p640d_preview) and open
-- /accounts/p640d-demo-checking and /transactions.
--
-- Re-runnable: it deletes its own rows first. Dates are relative to CURRENT_DATE so every row is
-- in this year's statement and inside its first ten (run it after the first week of January).
--
-- Logo hosts: the "loads" row points at a long-lived public favicon over https, because the
-- check needs a real https image; the "dead" row uses the reserved .invalid TLD, which never
-- resolves (RFC 6761). Amounts are small round numbers and mean nothing.

BEGIN;

DELETE FROM transactions WHERE account_id = 'p640d-demo-checking';
DELETE FROM account_balances WHERE account_id = 'p640d-demo-checking';
DELETE FROM accounts WHERE id = 'p640d-demo-checking';

INSERT INTO accounts (id, name, type, subtype, landscape, bank, mask, track_transactions)
VALUES ('p640d-demo-checking', 'Demo Checking', 'depository', 'checking', 'operational', 'Demo Bank', '0000', TRUE);

INSERT INTO account_balances (account_id, year, beginning_balance)
VALUES ('p640d-demo-checking', EXTRACT(YEAR FROM CURRENT_DATE)::int, 100);

INSERT INTO budget_categories (name, landscape, annual_budget)
VALUES ('Demo Coffee', 'operational', 0)
ON CONFLICT DO NOTHING;

INSERT INTO transactions
  (plaid_transaction_id, account_id, date, amount, name, merchant_name, mapped_category, hidden,
   logo_url, authorized_date, location_city, location_region)
VALUES
  -- 1. logo that loads; authorized the day before posting; city and region.
  ('p640d-1', 'p640d-demo-checking', CURRENT_DATE - 1, 5, 'DEMO LOADS 001', 'Demo Loads Cafe', 'Demo Coffee', FALSE,
   'https://www.google.com/favicon.ico', CURRENT_DATE - 2, 'Portland', 'OR'),
  -- 2. logo on a dead host: must fall back to the placeholder, no broken-image icon.
  ('p640d-2', 'p640d-demo-checking', CURRENT_DATE - 2, 6, 'DEMO DEAD 002', 'Dead Host Bakery', NULL, FALSE,
   'https://logo.invalid/dead.png', NULL, NULL, NULL),
  -- 3. no logo at all: placeholder tile with "N".
  ('p640d-3', 'p640d-demo-checking', CURRENT_DATE - 3, 7, 'DEMO NOLOGO 003', 'No Logo Market', NULL, FALSE,
   NULL, NULL, NULL, NULL),
  -- 4. hostile logo: no <img> may exist for this row, no request may be made.
  ('p640d-4', 'p640d-demo-checking', CURRENT_DATE - 4, 8, 'DEMO HOSTILE 004', 'Hostile Logo Shop', NULL, FALSE,
   'javascript:alert(1)', NULL, NULL, NULL),
  -- 5. authorized date equal to posted, no location: no detail line at all.
  ('p640d-5', 'p640d-demo-checking', CURRENT_DATE - 5, 9, 'DEMO SAMEDAY 005', 'Same Day Diner', NULL, FALSE,
   NULL, CURRENT_DATE - 5, NULL, NULL),
  -- 6. city only: detail line is just the city, no comma.
  ('p640d-6', 'p640d-demo-checking', CURRENT_DATE - 6, 3, 'DEMO CITY 006', 'City Only Books', NULL, FALSE,
   NULL, NULL, 'Springfield', NULL),
  -- 7. long merchant name and long city: must truncate / wrap, never push the amount off-screen.
  ('p640d-7', 'p640d-demo-checking', CURRENT_DATE - 7, 4, 'DEMO LONG 007',
   'The Extraordinarily Long Named Neighbourhood Hardware And Garden Supply Emporium', NULL, FALSE,
   NULL, CURRENT_DATE - 9, 'Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch', 'WA'),
  -- 8. hidden row with a logo and a detail line: keeps 40% opacity on /transactions.
  ('p640d-8', 'p640d-demo-checking', CURRENT_DATE - 8, 2, 'DEMO HIDDEN 008', 'Hidden Demo Kiosk', NULL, TRUE,
   'https://www.google.com/favicon.ico', CURRENT_DATE - 10, 'Salem', 'OR'),
  -- 9. income row (negative amount), region only, padded whitespace in the stored text.
  ('p640d-9', 'p640d-demo-checking', CURRENT_DATE - 9, -20, 'DEMO REFUND 009', 'Demo Refunds', NULL, FALSE,
   '  ', NULL, '   ', ' OR '),
  -- 10. http logo (mixed content): refused, placeholder.
  ('p640d-10', 'p640d-demo-checking', CURRENT_DATE - 10, 1, 'DEMO HTTP 010', 'Plain Http Deli', NULL, FALSE,
   'http://example.com/l.png', NULL, NULL, NULL);

COMMIT;
