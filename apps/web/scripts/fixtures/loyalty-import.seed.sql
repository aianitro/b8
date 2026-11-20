-- P8-42a fixture: the household and catalog the loyalty import fixtures resolve against.
-- Every name is fabricated and carries the canary prefix ZQ42A. Run against a scratch database
-- that is migrated to head and whose loyalty member and membership tables are empty.
-- Aliases are stored already normalised (lower case, single spaces), as the alias CHECK requires.

INSERT INTO household_members (display_name) VALUES ('ZQ42AAnna'), ('ZQ42ABob'), ('ZQ42ACarl');

INSERT INTO loyalty_programs (name, kind, default_unit) VALUES
  ('ZQ42A Skybrand Air', 'airline', 'miles'),
  ('ZQ42A Stayco Hotels', 'hotel', 'points'),
  ('ZQ42A Cardpay Points', 'card_currency', 'points'),
  ('ZQ42A Tripcash', 'travel_cash', 'usd'),
  ('ZQ42A Carbrand Rewards', 'car', 'points'),
  ('ZQ42A Wingline Airways', 'airline', 'miles');

INSERT INTO loyalty_program_aliases (program_id, alias)
SELECT (SELECT p.id FROM loyalty_programs p WHERE p.name = a.program), a.alias
FROM (VALUES
  ('ZQ42A Skybrand Air', 'zq42a skybrand'),
  ('ZQ42A Skybrand Air', 'zq42a skybrand airlines'),
  ('ZQ42A Skybrand Air', 'zq42a skybrand air'),
  ('ZQ42A Stayco Hotels', 'zq42a stayco'),
  ('ZQ42A Stayco Hotels', 'zq42a stayco hotels'),
  ('ZQ42A Stayco Hotels', 'zq42a stayco rewards'),
  ('ZQ42A Cardpay Points', 'zq42a cardpay points'),
  ('ZQ42A Cardpay Points', 'zq42a cardpay'),
  ('ZQ42A Tripcash', 'zq42a tripcash'),
  ('ZQ42A Carbrand Rewards', 'zq42a carbrand rewards'),
  ('ZQ42A Carbrand Rewards', 'zq42a carbrand'),
  ('ZQ42A Wingline Airways', 'zq42a wingline'),
  ('ZQ42A Wingline Airways', 'zq42a wingline airways')
) AS a(program, alias);
