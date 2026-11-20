-- Up Migration
-- Loyalty: household members, a public program catalog with its aliases, memberships, append-only
-- balance observations and instruments (ROADMAP.md §5 Phase 8 step 42a;
-- plan/tasks/P8-42a-loyalty-model-page-import/SPEC.md and CONTRACT.md; design in
-- plan/LOYALTY-ROADMAP.md §5).
--
-- ─── WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
--
-- Six new tables, a catalog seed, and nothing else. No existing table is altered. Loyalty is a
-- domain of its own beside the ledger, the way properties are: accounts, account_valuations and
-- net worth never read these tables, and no figure here is ever summed into money or given a
-- cents-per-point value. The one reference to the ledger is loyalty_memberships.card_account_id,
-- reserved for step 42b and always NULL until then.
--
-- NO "CURRENT" COLUMN ANYWHERE. A membership's current balance is DERIVED on every read from
-- loyalty_observations: the row with the greatest as_of, ties broken by greatest recorded_at, then
-- greatest id, through the shared reducer in apps/web/lib/domain/observations.ts. It is never the
-- newest row by arrival — a re-forwarded old statement or an older import must not roll a balance
-- back — and it is never stored, because a stored copy is a second answer that can go stale
-- silently. A membership with no observation has no current balance: NULL, rendered "—", never 0.
--
-- COLUMNS RESERVED FOR LATER STEPS DO NOT EXIST YET (SPEC.md Open question 4): no sender domains,
-- no expiry rule, no mailbox address, no qualifying figures, no source reference, no confirmation
-- code. Each is added forward, by its own step, when something writes it.
--
-- NO ANNUAL-FEE COLUMN, under any name. The fee belongs to a co-branded card and arrives through
-- the ledger; step 42b derives it from transactions. Storing a typed copy here would be a second,
-- staler answer to a question the ledger already answers.
--
-- THE LABEL NORMALISATION RULE, stated once because the alias column below stores its output and
-- the import compares against it by exact equality (SPEC.md Conventions): trim; drop leading
-- characters that are not Unicode letters or digits; remove every parenthesised group (an opening
-- parenthesis through the next closing one; an unclosed opening parenthesis stays); case-fold;
-- collapse every run of whitespace, non-breaking spaces included, to one space; trim again. The
-- application owns the rule (one pure function); the CHECK on loyalty_program_aliases refuses the
-- clearest violations so a hand-written INSERT cannot store an alias that no label could ever equal.

-- ─── household_members: a person who can hold a membership ───────────────────────────────────
--
-- A b8 user is a member; not every member is a user. A member with no user_id has no access to
-- anything and nothing identifies a caller by a member id: access is decided by the session, and
-- both b8 users are peers who see and edit every membership. This is the one table that carries a
-- person's name, and the name lives only in the database.
CREATE TABLE household_members (
  id            SERIAL PRIMARY KEY,
  -- Stored trimmed (the application trims; the CHECK refuses an untrimmed value, so a comparison
  -- has no trim to forget). \x0B is vertical tab, as a hex escape because E-strings have no \v.
  -- Unique ignoring case (the index below): the import resolves a member by the last word or words
  -- of a sheet label, case-folded, and two members whose names differ only in case could never be
  -- told apart.
  display_name  TEXT NOT NULL
                  CONSTRAINT household_members_display_name_trimmed CHECK (
                    display_name = btrim(display_name, E' \t\n\r\f\x0B')
                    AND char_length(display_name) BETWEEN 1 AND 100),
  -- NULL = this person is not a b8 user (knowledge, not "unknown": linking is an act only this app
  -- performs). UNIQUE: one member per user, so "the member who is this user" is a single row.
  -- No ON DELETE action: users rows are never deleted (1792300000000).
  user_id       INTEGER UNIQUE REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX household_members_display_name_ci ON household_members (lower(display_name));

-- ─── loyalty_programs: the catalog ───────────────────────────────────────────────────────────
--
-- Public facts about programs, seeded below and extended from /travel. The import never creates a
-- program. Deliberately wider than any one household, so the seed does not describe one.
CREATE TABLE loyalty_programs (
  id            SERIAL PRIMARY KEY,
  -- The display name. Not the matching key: the import matches labels against aliases only, and
  -- the program's own normalised name is stored as one of them.
  name          TEXT NOT NULL
                  CONSTRAINT loyalty_programs_name_trimmed CHECK (
                    name = btrim(name, E' \t\n\r\f\x0B')
                    AND char_length(name) BETWEEN 1 AND 200),
  --   airline · hotel · card_currency (a bank's transferable points) · travel_cash (a travel
  --   agency's stored cash) · car (a car maker's points) · other.
  -- A new kind is an additive change; every consumer keeps a default branch.
  kind          TEXT NOT NULL
                  CONSTRAINT loyalty_programs_kind_check
                    CHECK (kind IN ('airline', 'hotel', 'card_currency', 'travel_cash', 'car', 'other')),
  -- The unit a balance takes when its source does not say otherwise (an import cell without a
  -- dollar sign). A DEFAULT ONLY: each observation carries its own unit, because one program can
  -- hold both points and a cash credit.
  default_unit  TEXT NOT NULL
                  CONSTRAINT loyalty_programs_default_unit_check
                    CHECK (default_unit IN ('points', 'miles', 'nights', 'usd')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── loyalty_program_aliases: the names a program is known by ────────────────────────────────
--
-- WHY THIS IS DATA AND NOT LOGIC. A sheet label like "<brand> airlines" cannot equal one canonical
-- program name, and fuzzy, prefix or substring matching is forbidden (a near match is a silent
-- mis-attribution). So the tolerated spellings are rows the owner can see and fix through the
-- program PATCH route, and the matcher stays exact equality.
--
-- UNIQUE (alias) ACROSS THE WHOLE TABLE, not per program: an alias that named two programs would
-- make a label resolve to whichever row a query happened to return first. The import still treats
-- more than one match as a refusal rather than trusting this constraint alone.
--
-- Stored ALREADY NORMALISED. The CHECK refuses what the rule above can never produce: surrounding
-- or doubled spaces, tabs, line breaks and non-breaking spaces, upper case, and a closed
-- parenthesised group. It cannot see the leading-symbol rule, which is Unicode-class work left to
-- the one application function. At most 200 characters, counted in characters.
CREATE TABLE loyalty_program_aliases (
  id          SERIAL PRIMARY KEY,
  -- CASCADE: an alias means nothing without its program. (No route deletes a program; this keeps a
  -- hand-run delete of a fabricated test program from needing a second statement.)
  program_id  INTEGER NOT NULL REFERENCES loyalty_programs(id) ON DELETE CASCADE,
  alias       TEXT NOT NULL
                CONSTRAINT loyalty_program_aliases_alias_key UNIQUE
                CONSTRAINT loyalty_program_aliases_normalised CHECK (
                  char_length(alias) BETWEEN 1 AND 200
                  AND alias = btrim(alias)
                  AND alias = lower(alias)
                  AND position('  ' IN alias) = 0
                  AND alias !~ '[\t\n\r\f\v ]'
                  AND alias !~ '\(.*\)')
);

CREATE INDEX loyalty_program_aliases_program ON loyalty_program_aliases (program_id);

-- ─── loyalty_memberships: one member in one program ──────────────────────────────────────────
CREATE TABLE loyalty_memberships (
  id               SERIAL PRIMARY KEY,
  -- No ON DELETE action on either: no route deletes a member or a program, and a cascade would
  -- silently take a balance history with it.
  member_id        INTEGER NOT NULL REFERENCES household_members(id),
  program_id       INTEGER NOT NULL REFERENCES loyalty_programs(id),
  -- THE FULL MEMBER NUMBER, stored trimmed, emitted MASKED on every response, page and log line
  -- except the one copy route (SPEC.md S6, browser sessions only). An identifier rather than a
  -- secret, but one that enables social engineering, so it never reaches a log, an error body, a
  -- push or the import's output. NULL = no number known; never stored as '' and never as a
  -- placeholder like '-' (the import reads a '-' cell as empty). At most 64 characters.
  member_number    TEXT
                     CONSTRAINT loyalty_memberships_member_number_trimmed CHECK (
                       member_number IS NULL
                       OR (member_number = btrim(member_number, E' \t\n\r\f\x0B')
                           AND char_length(member_number) BETWEEN 1 AND 64)),
  -- The elite tier as the program names it, free text. NULL = not known (not "no status").
  tier             TEXT
                     CONSTRAINT loyalty_memberships_tier_trimmed CHECK (
                       tier IS NULL
                       OR (tier = btrim(tier, E' \t\n\r\f\x0B')
                           AND char_length(tier) BETWEEN 1 AND 100)),
  -- RESERVED FOR STEP 42b and always NULL in 42a: no route, form or import path sets or emits it.
  -- The co-branded card account that earns into this membership. SET NULL on delete because the
  -- membership outlives a closed card; ON UPDATE CASCADE like every accounts(id) reference, because
  -- reconciliation remaps a reissued Plaid account_id in place. Nothing in accounts changes because
  -- of this column, and no net-worth query reads it.
  card_account_id  TEXT REFERENCES accounts(id) ON UPDATE CASCADE ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One membership per member and program. A duplicate is the route's 409, never a 500, including
  -- when two POSTs race: the constraint, not a prior SELECT, decides.
  CONSTRAINT loyalty_memberships_member_program_key UNIQUE (member_id, program_id)
);

CREATE INDEX loyalty_memberships_program ON loyalty_memberships (program_id);

-- ─── loyalty_observations: append-only balance readings ──────────────────────────────────────
--
-- APPEND-ONLY. No route, store or script updates or deletes a row here. A correction is a new,
-- newer observation; an edited balance on /travel is a new row with source 'typed'. The current
-- balance is derived (see the top of this file), so the history is never rewritten to change it.
--
-- BALANCE: unconstrained NUMERIC, never float, and ONE SPELLING PER VALUE, enforced here:
--   * non-negative — zero is a real reading, distinct from no reading; a negative is refused.
--     A 'usd' balance is a stored credit, never a liability, and is never negated.
--   * fewer than 13 integer digits (also refuses NaN and infinity, which sort above every number).
--   * scale by unit: 'points', 'miles' and 'nights' are whole numbers stored at SCALE 0, and 'usd'
--     is money stored at SCALE EXACTLY 2. No typmod on the column, because a NUMERIC(14,2) would
--     store a points balance as a two-decimal value; the per-unit scale CHECK states the scale
--     instead. So balance::text is already the canonical emitted form — no decimal point for a
--     whole unit, exactly two decimals for usd — and nothing downstream reformats or rounds it.
--     A writer inserts the canonical text the shared balance parser returns; a usd value with one
--     decimal, or a whole-unit value written with a decimal point, is refused here rather than
--     silently rescaled. Comparisons are NUMERIC equality in SQL, never a JS number.
CREATE TABLE loyalty_observations (
  id             SERIAL PRIMARY KEY,
  -- No ON DELETE action: history is never deleted.
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id),
  -- The calendar date the reading is true for, with no time zone. Required: a reading with no date
  -- cannot be ordered against the others. Routes refuse an as_of more than one day after
  -- Postgres's CURRENT_DATE (not a CHECK: CURRENT_DATE is not immutable, and a CHECK that later
  -- rows can fail on a restore is a trap).
  as_of          DATE NOT NULL,
  balance        NUMERIC NOT NULL
                   CONSTRAINT loyalty_observations_balance_range CHECK (balance >= 0 AND balance < 1e12),
  -- The unit belongs to the balance, not the program.
  unit           TEXT NOT NULL
                   CONSTRAINT loyalty_observations_unit_check
                     CHECK (unit IN ('points', 'miles', 'nights', 'usd')),
  --   typed      — entered on /travel. The ONLY source a request body may carry.
  --   import     — the one-time spreadsheet import script.
  --   email      — reserved for the loyalty inbox (42c).
  --   screenshot — reserved for screenshot share (42d).
  -- No DEFAULT: every writer knows its source and must say it.
  source         TEXT NOT NULL
                   CONSTRAINT loyalty_observations_source_check
                     CHECK (source IN ('typed', 'import', 'email', 'screenshot')),
  -- When the row arrived. The SECOND key of the newest-wins order (after as_of), never the first.
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_observations_unit_scale CHECK (
    (unit = 'usd' AND scale(balance) = 2)
    OR (unit <> 'usd' AND scale(balance) = 0))
);

-- Serves the newest-wins read per membership, in the order the reducer applies.
CREATE INDEX loyalty_observations_newest
  ON loyalty_observations (membership_id, as_of DESC, recorded_at DESC, id DESC);

-- At most one IMPORTED reading per membership and date. The import is idempotent (a second run with
-- the same balance finds the row and writes nothing) and refuses a different balance for the same
-- membership and date as a conflict; this index makes that hold under any interleaving rather than
-- only when the script's own check runs first. Typed readings are not limited: a person may enter
-- two corrections on one day, and recorded_at orders them.
CREATE UNIQUE INDEX loyalty_observations_one_import_per_day
  ON loyalty_observations (membership_id, as_of) WHERE source = 'import';

-- ─── loyalty_instruments: certificates, companion fares, travel credits ──────────────────────
--
-- Things a program or a co-branded card issues that are used once and expire. Every date may be
-- NULL, meaning unknown — an imported bonus has none — and a NULL expiry sorts LAST on the page,
-- never first as "expiring now". used_on NULL means "not known to be used".
CREATE TABLE loyalty_instruments (
  id             SERIAL PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES loyalty_memberships(id),
  kind           TEXT NOT NULL
                   CONSTRAINT loyalty_instruments_kind_check
                     CHECK (kind IN ('free_night', 'companion_fare', 'travel_credit', 'other')),
  -- What it is, in the issuer's words. Not blank, at most 200 characters (an import bonus cell
  -- longer than that refuses its row as a value error rather than being cut).
  description    TEXT NOT NULL
                   CONSTRAINT loyalty_instruments_description_length CHECK (
                     char_length(btrim(description, E' \t\n\r\f\x0B')) >= 1
                     AND char_length(description) <= 200),
  issued_on      DATE,
  expires_on     DATE,
  used_on        DATE,
  --   typed  — created on /travel.
  --   import — created by the import from an issued, unused annual bonus.
  source         TEXT NOT NULL
                   CONSTRAINT loyalty_instruments_source_check CHECK (source IN ('typed', 'import')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT loyalty_instruments_expires_not_before_issued
    CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on),
  CONSTRAINT loyalty_instruments_used_not_before_issued
    CHECK (issued_on IS NULL OR used_on IS NULL OR used_on >= issued_on)
);

CREATE INDEX loyalty_instruments_membership ON loyalty_instruments (membership_id);

-- At most one IMPORTED instrument per membership: the import creates at most one per sheet row and
-- skips a membership that already has one, so a second run creates none. As with observations, the
-- index makes that hold under any interleaving. Typed instruments are not limited.
CREATE UNIQUE INDEX loyalty_instruments_one_import
  ON loyalty_instruments (membership_id) WHERE source = 'import';

-- ─── The catalog seed ────────────────────────────────────────────────────────────────────────
--
-- Program names and aliases only: public facts about how each program is named, never anything
-- about a household (LOYALTY-ROADMAP.md §7). Wider than any one household on purpose. Each program
-- carries its own normalised name; airlines and hotels also carry the brand alone and the brand
-- with the generic word that applies, including the "<brand> airlines" form for carriers whose legal
-- name is "Air Lines"; and recent rebrands keep their former names, so an older label still
-- resolves. A card currency carries the names of its flagship cards.
--
-- Default units: hotels, card currencies and car makers count points; travel-agency cash is usd;
-- an airline counts miles unless its own currency is points or Avios (recorded as points).
--
-- Two judgement calls, recorded so they are not mistaken for oversights:
--   * Alaska Airlines' Mileage Plan became Atmos Rewards in 2025; its former names are aliases of
--     Atmos Rewards. HawaiianMiles was folded into the same program, but stays its own catalog
--     entry here: a sheet that still lists both carriers for one person would otherwise collapse
--     two rows into one (member, program) pair and refuse the second as a duplicate. The owner can
--     move the aliases with the program PATCH route.
--   * "avios" is not an alias of any program: British Airways, Iberia, Qatar Airways and Aer
--     Lingus all use that currency, so it names no single program.

INSERT INTO loyalty_programs (name, kind, default_unit) VALUES
  -- Airlines, United States
  ('Atmos Rewards',                       'airline', 'points'),
  ('AAdvantage',                          'airline', 'miles'),
  ('Delta SkyMiles',                      'airline', 'miles'),
  ('United MileagePlus',                  'airline', 'miles'),
  ('Southwest Rapid Rewards',             'airline', 'points'),
  ('JetBlue TrueBlue',                    'airline', 'points'),
  ('HawaiianMiles',                       'airline', 'miles'),
  ('Frontier Miles',                      'airline', 'miles'),
  ('Spirit Free Spirit',                  'airline', 'points'),
  ('Sun Country Rewards',                 'airline', 'points'),
  -- Airlines, international
  ('Emirates Skywards',                   'airline', 'miles'),
  ('Miles & More',                        'airline', 'miles'),
  ('Miles&Smiles',                        'airline', 'miles'),
  ('Iberia Club',                         'airline', 'points'),
  ('ITA Airways Volare',                  'airline', 'points'),
  ('British Airways Club',                'airline', 'points'),
  ('Flying Blue',                         'airline', 'miles'),
  ('Qatar Airways Privilege Club',        'airline', 'points'),
  ('Singapore Airlines KrisFlyer',        'airline', 'miles'),
  ('Aeroplan',                            'airline', 'points'),
  ('Virgin Atlantic Flying Club',         'airline', 'points'),
  ('Cathay',                              'airline', 'miles'),
  ('ANA Mileage Club',                    'airline', 'miles'),
  ('Etihad Guest',                        'airline', 'miles'),
  ('LifeMiles',                           'airline', 'miles'),
  ('Aer Lingus AerClub',                  'airline', 'points'),
  ('JAL Mileage Bank',                    'airline', 'miles'),
  ('Korean Air SKYPASS',                  'airline', 'miles'),
  ('Qantas Frequent Flyer',               'airline', 'points'),
  ('Copa ConnectMiles',                   'airline', 'miles'),
  -- Hotels
  ('Marriott Bonvoy',                     'hotel', 'points'),
  ('Hilton Honors',                       'hotel', 'points'),
  ('World of Hyatt',                      'hotel', 'points'),
  ('IHG One Rewards',                     'hotel', 'points'),
  ('Best Western Rewards',                'hotel', 'points'),
  ('Wyndham Rewards',                     'hotel', 'points'),
  ('Choice Privileges',                   'hotel', 'points'),
  ('ALL Accor',                           'hotel', 'points'),
  ('Radisson Rewards',                    'hotel', 'points'),
  ('Sonesta Travel Pass',                 'hotel', 'points'),
  ('GHA DISCOVERY',                       'hotel', 'points'),
  -- Card currencies
  ('Chase Ultimate Rewards',              'card_currency', 'points'),
  ('American Express Membership Rewards', 'card_currency', 'points'),
  ('Citi ThankYou Rewards',               'card_currency', 'points'),
  ('Capital One Miles',                   'card_currency', 'points'),
  ('Bilt Rewards',                        'card_currency', 'points'),
  ('Wells Fargo Rewards',                 'card_currency', 'points'),
  -- Travel-agency cash
  ('One Key',                             'travel_cash', 'usd'),
  -- Car makers
  ('Ford Rewards',                        'car', 'points'),
  ('GM Rewards',                          'car', 'points'),
  ('Toyota Rewards',                      'car', 'points');

-- Resolved by exact program name through a scalar subquery, NOT a join: a misspelt program name
-- yields NULL, and program_id NOT NULL fails the migration loudly instead of dropping the alias.
INSERT INTO loyalty_program_aliases (program_id, alias)
SELECT (SELECT p.id FROM loyalty_programs p WHERE p.name = a.program), a.alias
FROM (VALUES
  ('Atmos Rewards', 'atmos rewards'),
  ('Atmos Rewards', 'atmos'),
  ('Atmos Rewards', 'alaska airlines'),
  ('Atmos Rewards', 'alaska'),
  ('Atmos Rewards', 'alaska air'),
  ('Atmos Rewards', 'mileage plan'),
  ('Atmos Rewards', 'alaska mileage plan'),
  ('Atmos Rewards', 'alaska airlines mileage plan'),

  ('AAdvantage', 'aadvantage'),
  ('AAdvantage', 'american airlines'),
  ('AAdvantage', 'american'),
  ('AAdvantage', 'american aadvantage'),
  ('AAdvantage', 'american airlines aadvantage'),

  ('Delta SkyMiles', 'delta skymiles'),
  ('Delta SkyMiles', 'delta'),
  ('Delta SkyMiles', 'delta air lines'),
  ('Delta SkyMiles', 'delta airlines'),
  ('Delta SkyMiles', 'skymiles'),

  ('United MileagePlus', 'united mileageplus'),
  ('United MileagePlus', 'united'),
  ('United MileagePlus', 'united airlines'),
  ('United MileagePlus', 'mileageplus'),
  ('United MileagePlus', 'mileage plus'),
  ('United MileagePlus', 'united mileage plus'),

  ('Southwest Rapid Rewards', 'southwest rapid rewards'),
  ('Southwest Rapid Rewards', 'southwest'),
  ('Southwest Rapid Rewards', 'southwest airlines'),
  ('Southwest Rapid Rewards', 'rapid rewards'),

  ('JetBlue TrueBlue', 'jetblue trueblue'),
  ('JetBlue TrueBlue', 'jetblue'),
  ('JetBlue TrueBlue', 'jetblue airways'),
  ('JetBlue TrueBlue', 'jetblue airlines'),
  ('JetBlue TrueBlue', 'jet blue'),
  ('JetBlue TrueBlue', 'trueblue'),

  ('HawaiianMiles', 'hawaiianmiles'),
  ('HawaiianMiles', 'hawaiian'),
  ('HawaiianMiles', 'hawaiian airlines'),
  ('HawaiianMiles', 'hawaiian miles'),

  ('Frontier Miles', 'frontier miles'),
  ('Frontier Miles', 'frontier'),
  ('Frontier Miles', 'frontier airlines'),

  ('Spirit Free Spirit', 'spirit free spirit'),
  ('Spirit Free Spirit', 'spirit'),
  ('Spirit Free Spirit', 'spirit airlines'),
  ('Spirit Free Spirit', 'free spirit'),

  ('Sun Country Rewards', 'sun country rewards'),
  ('Sun Country Rewards', 'sun country'),
  ('Sun Country Rewards', 'sun country airlines'),

  ('Emirates Skywards', 'emirates skywards'),
  ('Emirates Skywards', 'emirates'),
  ('Emirates Skywards', 'emirates airline'),
  ('Emirates Skywards', 'emirates airlines'),
  ('Emirates Skywards', 'skywards'),

  ('Miles & More', 'miles & more'),
  ('Miles & More', 'miles and more'),
  ('Miles & More', 'lufthansa'),
  ('Miles & More', 'lufthansa airlines'),
  ('Miles & More', 'lufthansa miles & more'),
  ('Miles & More', 'lufthansa group'),
  ('Miles & More', 'swiss'),
  ('Miles & More', 'austrian airlines'),

  ('Miles&Smiles', 'miles&smiles'),
  ('Miles&Smiles', 'miles & smiles'),
  ('Miles&Smiles', 'turkish airlines'),
  ('Miles&Smiles', 'turkish'),
  ('Miles&Smiles', 'turkish airlines miles&smiles'),
  ('Miles&Smiles', 'turkish airlines miles & smiles'),

  ('Iberia Club', 'iberia club'),
  ('Iberia Club', 'iberia'),
  ('Iberia Club', 'iberia plus'),
  ('Iberia Club', 'iberia airlines'),

  ('ITA Airways Volare', 'ita airways volare'),
  ('ITA Airways Volare', 'ita airways'),
  ('ITA Airways Volare', 'ita'),
  ('ITA Airways Volare', 'volare'),

  ('British Airways Club', 'british airways club'),
  ('British Airways Club', 'the british airways club'),
  ('British Airways Club', 'british airways'),
  ('British Airways Club', 'ba'),
  ('British Airways Club', 'british airways executive club'),
  ('British Airways Club', 'executive club'),

  ('Flying Blue', 'flying blue'),
  ('Flying Blue', 'air france'),
  ('Flying Blue', 'klm'),
  ('Flying Blue', 'air france-klm'),
  ('Flying Blue', 'air france klm'),
  ('Flying Blue', 'air france flying blue'),
  ('Flying Blue', 'klm flying blue'),

  ('Qatar Airways Privilege Club', 'qatar airways privilege club'),
  ('Qatar Airways Privilege Club', 'qatar airways'),
  ('Qatar Airways Privilege Club', 'qatar'),
  ('Qatar Airways Privilege Club', 'privilege club'),
  ('Qatar Airways Privilege Club', 'qatar privilege club'),

  ('Singapore Airlines KrisFlyer', 'singapore airlines krisflyer'),
  ('Singapore Airlines KrisFlyer', 'singapore airlines'),
  ('Singapore Airlines KrisFlyer', 'singapore'),
  ('Singapore Airlines KrisFlyer', 'krisflyer'),

  ('Aeroplan', 'aeroplan'),
  ('Aeroplan', 'air canada'),
  ('Aeroplan', 'air canada aeroplan'),

  ('Virgin Atlantic Flying Club', 'virgin atlantic flying club'),
  ('Virgin Atlantic Flying Club', 'virgin atlantic'),
  ('Virgin Atlantic Flying Club', 'virgin atlantic airways'),
  ('Virgin Atlantic Flying Club', 'flying club'),

  ('Cathay', 'cathay'),
  ('Cathay', 'cathay pacific'),
  ('Cathay', 'cathay pacific airways'),
  ('Cathay', 'asia miles'),
  ('Cathay', 'cathay asia miles'),

  ('ANA Mileage Club', 'ana mileage club'),
  ('ANA Mileage Club', 'ana'),
  ('ANA Mileage Club', 'all nippon airways'),

  ('Etihad Guest', 'etihad guest'),
  ('Etihad Guest', 'etihad'),
  ('Etihad Guest', 'etihad airways'),

  ('LifeMiles', 'lifemiles'),
  ('LifeMiles', 'avianca'),
  ('LifeMiles', 'avianca airlines'),
  ('LifeMiles', 'avianca lifemiles'),

  ('Aer Lingus AerClub', 'aer lingus aerclub'),
  ('Aer Lingus AerClub', 'aer lingus'),
  ('Aer Lingus AerClub', 'aerclub'),

  ('JAL Mileage Bank', 'jal mileage bank'),
  ('JAL Mileage Bank', 'jal'),
  ('JAL Mileage Bank', 'japan airlines'),

  ('Korean Air SKYPASS', 'korean air skypass'),
  ('Korean Air SKYPASS', 'korean air'),
  ('Korean Air SKYPASS', 'korean airlines'),
  ('Korean Air SKYPASS', 'skypass'),

  ('Qantas Frequent Flyer', 'qantas frequent flyer'),
  ('Qantas Frequent Flyer', 'qantas'),
  ('Qantas Frequent Flyer', 'qantas airways'),

  ('Copa ConnectMiles', 'copa connectmiles'),
  ('Copa ConnectMiles', 'copa'),
  ('Copa ConnectMiles', 'copa airlines'),
  ('Copa ConnectMiles', 'connectmiles'),

  ('Marriott Bonvoy', 'marriott bonvoy'),
  ('Marriott Bonvoy', 'marriott'),
  ('Marriott Bonvoy', 'marriott hotels'),
  ('Marriott Bonvoy', 'bonvoy'),
  ('Marriott Bonvoy', 'marriott rewards'),

  ('Hilton Honors', 'hilton honors'),
  ('Hilton Honors', 'hilton'),
  ('Hilton Honors', 'hilton hotels'),
  ('Hilton Honors', 'hhonors'),

  ('World of Hyatt', 'world of hyatt'),
  ('World of Hyatt', 'hyatt'),
  ('World of Hyatt', 'hyatt hotels'),

  ('IHG One Rewards', 'ihg one rewards'),
  ('IHG One Rewards', 'ihg'),
  ('IHG One Rewards', 'ihg hotels'),
  ('IHG One Rewards', 'ihg rewards'),
  ('IHG One Rewards', 'holiday inn'),
  ('IHG One Rewards', 'intercontinental'),

  ('Best Western Rewards', 'best western rewards'),
  ('Best Western Rewards', 'best western'),
  ('Best Western Rewards', 'best western hotels'),

  ('Wyndham Rewards', 'wyndham rewards'),
  ('Wyndham Rewards', 'wyndham'),
  ('Wyndham Rewards', 'wyndham hotels'),

  ('Choice Privileges', 'choice privileges'),
  ('Choice Privileges', 'choice'),
  ('Choice Privileges', 'choice hotels'),

  ('ALL Accor', 'all accor'),
  ('ALL Accor', 'accor'),
  ('ALL Accor', 'accor hotels'),
  ('ALL Accor', 'accor live limitless'),
  ('ALL Accor', 'all - accor live limitless'),

  ('Radisson Rewards', 'radisson rewards'),
  ('Radisson Rewards', 'radisson'),
  ('Radisson Rewards', 'radisson hotels'),

  ('Sonesta Travel Pass', 'sonesta travel pass'),
  ('Sonesta Travel Pass', 'sonesta'),
  ('Sonesta Travel Pass', 'sonesta hotels'),

  ('GHA DISCOVERY', 'gha discovery'),
  ('GHA DISCOVERY', 'gha'),

  ('Chase Ultimate Rewards', 'chase ultimate rewards'),
  ('Chase Ultimate Rewards', 'ultimate rewards'),
  ('Chase Ultimate Rewards', 'chase'),
  ('Chase Ultimate Rewards', 'sapphire'),
  ('Chase Ultimate Rewards', 'chase sapphire'),
  ('Chase Ultimate Rewards', 'sapphire preferred'),
  ('Chase Ultimate Rewards', 'sapphire reserve'),
  ('Chase Ultimate Rewards', 'chase sapphire preferred'),
  ('Chase Ultimate Rewards', 'chase sapphire reserve'),

  ('American Express Membership Rewards', 'american express membership rewards'),
  ('American Express Membership Rewards', 'membership rewards'),
  ('American Express Membership Rewards', 'american express'),
  ('American Express Membership Rewards', 'amex'),
  ('American Express Membership Rewards', 'amex membership rewards'),
  ('American Express Membership Rewards', 'amex platinum'),
  ('American Express Membership Rewards', 'amex gold'),

  ('Citi ThankYou Rewards', 'citi thankyou rewards'),
  ('Citi ThankYou Rewards', 'citi thankyou'),
  ('Citi ThankYou Rewards', 'citi'),
  ('Citi ThankYou Rewards', 'thankyou'),
  ('Citi ThankYou Rewards', 'thankyou rewards'),
  ('Citi ThankYou Rewards', 'citi strata premier'),

  ('Capital One Miles', 'capital one miles'),
  ('Capital One Miles', 'capital one'),
  ('Capital One Miles', 'venture x'),
  ('Capital One Miles', 'capital one venture'),
  ('Capital One Miles', 'capital one venture x'),

  ('Bilt Rewards', 'bilt rewards'),
  ('Bilt Rewards', 'bilt'),
  ('Bilt Rewards', 'bilt mastercard'),

  ('Wells Fargo Rewards', 'wells fargo rewards'),
  ('Wells Fargo Rewards', 'wells fargo'),
  ('Wells Fargo Rewards', 'wells fargo autograph'),

  ('One Key', 'one key'),
  ('One Key', 'onekey'),
  ('One Key', 'onekeycash'),
  ('One Key', 'one key cash'),
  ('One Key', 'expedia'),
  ('One Key', 'expedia one key'),
  ('One Key', 'hotels.com'),
  ('One Key', 'vrbo'),

  ('Ford Rewards', 'ford rewards'),
  ('Ford Rewards', 'ford'),
  ('Ford Rewards', 'fordpass rewards'),
  ('Ford Rewards', 'fordpass'),

  ('GM Rewards', 'gm rewards'),
  ('GM Rewards', 'gm'),
  ('GM Rewards', 'my gm rewards'),
  ('GM Rewards', 'general motors'),

  ('Toyota Rewards', 'toyota rewards'),
  ('Toyota Rewards', 'toyota')
) AS a(program, alias);

-- The seed checks itself, so a later edit that breaks a promise of SPEC.md (Q1, C1, C11) fails the
-- migration instead of shipping: the per-kind minimums, every program's own lower-cased name among
-- its aliases (none of these names has a parenthesis or a leading symbol, so lower case is its
-- normalised form), at least two aliases for every airline, hotel and card currency, and enough
-- aliases overall.
DO $$
BEGIN
  IF (SELECT count(*) FROM loyalty_programs) < 40
     OR (SELECT count(*) FROM loyalty_programs WHERE kind = 'airline') < 20
     OR (SELECT count(*) FROM loyalty_programs WHERE kind = 'hotel') < 10
     OR (SELECT count(*) FROM loyalty_programs WHERE kind = 'card_currency') < 5
     OR (SELECT count(*) FROM loyalty_programs WHERE kind = 'travel_cash') < 1
     OR (SELECT count(*) FROM loyalty_programs WHERE kind = 'car') < 3 THEN
    RAISE EXCEPTION 'loyalty catalog seed is below the per-kind minimums';
  END IF;
  IF EXISTS (SELECT 1 FROM loyalty_programs p
              WHERE NOT EXISTS (SELECT 1 FROM loyalty_program_aliases a
                                 WHERE a.program_id = p.id AND a.alias = lower(p.name))) THEN
    RAISE EXCEPTION 'a seeded loyalty program lacks its own normalised name as an alias';
  END IF;
  IF EXISTS (SELECT 1 FROM loyalty_programs p
              WHERE p.kind IN ('airline', 'hotel', 'card_currency')
                AND (SELECT count(*) FROM loyalty_program_aliases a WHERE a.program_id = p.id) < 2) THEN
    RAISE EXCEPTION 'a seeded airline, hotel or card currency has fewer than two aliases';
  END IF;
  IF (SELECT count(*) FROM loyalty_program_aliases) < greatest(75, (SELECT count(*) FROM loyalty_programs) + 35) THEN
    RAISE EXCEPTION 'loyalty alias seed is below its minimum';
  END IF;
END
$$;

-- Down Migration
-- Drops the six tables and nothing else; no existing table was touched, so nothing is restored.
-- Indexes, constraints and the seeded catalog and aliases go with their tables.
--
-- NOT LOSSLESS. Every household member, membership, observation, instrument, typed edit and alias
-- edit made while this was live is discarded; only the imported rows can be rebuilt (re-create the
-- members, then re-run the idempotent import). Back up first (SPEC.md Rollback, BUILD.md §9.3):
--
--   \copy (SELECT * FROM household_members ORDER BY id) TO 'backup-household_members.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_programs ORDER BY id) TO 'backup-loyalty_programs.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_program_aliases ORDER BY id) TO 'backup-loyalty_program_aliases.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_memberships ORDER BY id) TO 'backup-loyalty_memberships.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_observations ORDER BY id) TO 'backup-loyalty_observations.csv' CSV HEADER
--   \copy (SELECT * FROM loyalty_instruments ORDER BY id) TO 'backup-loyalty_instruments.csv' CSV HEADER
--
-- Revert the application code before running this, so nothing queries a missing table. Children
-- first, so no foreign key blocks a drop.

DROP TABLE loyalty_instruments;
DROP TABLE loyalty_observations;
DROP TABLE loyalty_memberships;
DROP TABLE loyalty_program_aliases;
DROP TABLE loyalty_programs;
DROP TABLE household_members;
