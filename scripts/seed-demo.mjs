// Demo seed — ENTIRELY FABRICATED data, for regenerating docs/screenshots.
//
// No real balances, banks, merchants, or addresses. Street and city names are invented and the
// postal codes are deliberately invalid, so nothing produced here can be mistaken for a real
// location. This exists so the screenshots in the README can be refreshed after a UI change
// without anyone having to point a camera at their actual finances.
//
// ⚠️  THIS DESTROYS THE TARGET DATABASE. It truncates every domain table before writing. Back up
//     first (`pg_dump -Fc -d <db> -f backup.dump`) and restore afterwards:
//
//       npm run seed:demo -- --yes-wipe-my-database
//
//     The flag is required and there is no default-yes path: the DATABASE_URL in .env.local is
//     normally the real database, so an unguarded run of this file is a data-loss event.

import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CONFIRM_FLAG = '--yes-wipe-my-database';

// An explicit DATABASE_URL in the environment wins over .env.local, so this can be pointed at a
// scratch database without editing the file that normally holds the real one.
function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const match = readFileSync(join(repoRoot, '.env.local'), 'utf8').match(/^DATABASE_URL=(.*)$/m);
  if (!match) {
    console.error('No DATABASE_URL in the environment or .env.local');
    process.exit(1);
  }
  return match[1].trim();
}

const DATABASE_URL = resolveDatabaseUrl();

// Name only — never print the URL, it carries credentials.
const dbName = decodeURIComponent(new URL(DATABASE_URL).pathname.replace(/^\//, ''));

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error(
    `Refusing to run.\n\n` +
    `  This truncates every table in "${dbName}" and replaces it with fabricated demo data.\n` +
    `  Back it up first:  pg_dump -Fc -d ${dbName} -f backup.dump\n\n` +
    `  Then re-run with:  npm run seed:demo -- ${CONFIRM_FLAG}\n`
  );
  process.exit(1);
}

console.log(`Wiping and seeding "${dbName}" with fabricated demo data…`);

const db = new pg.Client({ connectionString: DATABASE_URL });

// ---------------------------------------------------------------- deterministic randomness
let seed = 20260811;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;

// Everything below is anchored to the day this runs, not to a fixed date. A seed pinned to the
// month it was written produces a dashboard whose "Today" card is empty and whose current-month
// column is in the past — which looks like a bug in the app rather than in the data.
const TODAY = new Date();
TODAY.setHours(23, 59, 59, 999);
const YEAR = TODAY.getFullYear();
const monthsElapsed = TODAY.getMonth() + 1;

const d = (y, m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const ts = (y, m, day) => `${d(y, m, day)} 09:00:00-07`;
const notFuture = (y, m, day) => new Date(y, m - 1, day, 12) <= TODAY;

// ---------------------------------------------------------------- properties
const properties = [
  { id: 1, nickname: 'Alder Ridge',   address: '118 Alder Ridge Rd, Brookvale, CA 94000', type: 'primary', purchase_price: 720000, purchase_date: `${YEAR - 7}-04-12`, cost_basis: 748000 },
  { id: 2, nickname: 'Kestrel Court', address: '27 Kestrel Ct, Brookvale, CA 94000',      type: 'rental',  purchase_price: 385000, purchase_date: `${YEAR - 5}-08-03`, cost_basis: 402000 },
  { id: 3, nickname: 'Sandpiper Bay', address: '8 Sandpiper Way, Windmere, NC 28000',     type: 'rental',  purchase_price: 298000, purchase_date: `${YEAR - 3}-02-17`, cost_basis: 311500 },
];

// Half-yearly appraisals over the trailing ~3 years, gently trending up — enough points that the
// value chart reads as a series rather than a couple of dots.
const APPRAISAL_MONTHS = [1, 7];
const propertyValueRange = { 1: [812000, 918000], 2: [412000, 469000], 3: [315000, 352000] };

const valueSeries = {};
for (const [pid, [from, to]] of Object.entries(propertyValueRange)) {
  const points = [];
  for (let y = YEAR - 2; y <= YEAR; y++) for (const m of APPRAISAL_MONTHS) {
    if (notFuture(y, m, 15)) points.push([y, m]);
  }
  valueSeries[pid] = points.map(([y, m], i) => {
    const t = points.length === 1 ? 1 : i / (points.length - 1);
    return [y, m, Math.round((from + (to - from) * t) / 100) * 100];
  });
}

const propertyValuations = [];
for (const [pid, rows] of Object.entries(valueSeries)) {
  for (const [y, m, v] of rows) propertyValuations.push([Number(pid), v, 'manual', ts(y, m, 15)]);
}

// ---------------------------------------------------------------- accounts
// access_token is a fake placeholder so the Sync Health card renders; grouped per "bank" the way
// a real Plaid Item would be. Nothing here is a credential.
const A = (o) => ({ landscape: 'operational', valuation_mode: 'ledger', is_liability: false, property_id: null, track_transactions: true, mask: null, ...o });

const accounts = [
  A({ id: 'demo_chk_main',   name: 'Everyday Checking',      type: 'depository', subtype: 'checking',    bank: 'Brookvale Bank',        mask: '4417', token: 'demo-item-brookvale', sort: 1 }),
  A({ id: 'demo_chk_joint',  name: 'Household Checking',     type: 'depository', subtype: 'checking',    bank: 'Brookvale Bank',        mask: '9082', token: 'demo-item-brookvale', sort: 2 }),
  A({ id: 'demo_sav_ef',     name: 'Emergency Fund',         type: 'depository', subtype: 'savings',     bank: 'Brookvale Bank',        mask: '3310', token: 'demo-item-brookvale', sort: 3 }),
  A({ id: 'demo_cc_every',   name: 'Everyday Card',          type: 'credit',     subtype: 'credit card', bank: 'Cobalt Card',           mask: '1128', token: 'demo-item-cobalt',    sort: 4 }),
  A({ id: 'demo_cc_travel',  name: 'Travel Rewards Card',    type: 'credit',     subtype: 'credit card', bank: 'Cobalt Card',           mask: '7754', token: 'demo-item-cobalt',    sort: 5 }),

  A({ id: 'demo_sav_capex',  name: 'Capital Reserve',        type: 'depository', subtype: 'savings',     bank: 'Brookvale Bank',        mask: '6621', token: 'demo-item-brookvale', sort: 6, landscape: 'capital' }),

  A({ id: 'demo_brokerage',  name: 'Taxable Brokerage',      type: 'investment', subtype: 'brokerage',   bank: 'Meridian Invest',       mask: '2043', token: 'demo-item-meridian',  sort: 7,  landscape: 'capital', valuation_mode: 'valuation', track_transactions: false }),
  A({ id: 'demo_401k',       name: 'Workplace 401(k)',       type: 'investment', subtype: '401k',        bank: 'Northfield Retirement', mask: '8890', token: 'demo-item-northfield',sort: 8,  landscape: 'capital', valuation_mode: 'valuation', track_transactions: false }),
  A({ id: 'demo_roth',       name: 'Roth IRA',               type: 'investment', subtype: 'ira',         bank: 'Meridian Invest',       mask: '5567', token: 'demo-item-meridian',  sort: 9,  landscape: 'capital', valuation_mode: 'valuation', track_transactions: false }),
  A({ id: 'demo_hsa',        name: 'Health Savings',         type: 'investment', subtype: 'hsa',         bank: 'Northfield Retirement', mask: '2214', token: 'demo-item-northfield',sort: 10, landscape: 'capital', valuation_mode: 'valuation', track_transactions: false }),

  A({ id: 'demo_mtg_alder',  name: 'Alder Ridge Mortgage',   type: 'loan', subtype: 'mortgage', bank: 'Harborline Home Loans', mask: '0071', token: 'demo-item-harborline', sort: 11, landscape: 'capital', valuation_mode: 'valuation', is_liability: true, property_id: 1, track_transactions: false }),
  A({ id: 'demo_mtg_kest',   name: 'Kestrel Court Mortgage', type: 'loan', subtype: 'mortgage', bank: 'Harborline Home Loans', mask: '0198', token: 'demo-item-harborline', sort: 12, landscape: 'capital', valuation_mode: 'valuation', is_liability: true, property_id: 2, track_transactions: false }),
  A({ id: 'demo_mtg_sand',   name: 'Sandpiper Bay Mortgage', type: 'loan', subtype: 'mortgage', bank: 'Harborline Home Loans', mask: '0264', token: 'demo-item-harborline', sort: 13, landscape: 'capital', valuation_mode: 'valuation', is_liability: true, property_id: 3, track_transactions: false }),
  A({ id: 'demo_auto',       name: 'Auto Loan',              type: 'loan', subtype: 'auto',     bank: 'Cobalt Card',           mask: '3392', token: 'demo-item-cobalt',     sort: 14, landscape: 'capital', valuation_mode: 'valuation', is_liability: true, track_transactions: false }),

  A({ id: 'demo_op_kest',    name: 'Kestrel Court Operating', type: 'depository', subtype: 'checking', bank: 'Brookvale Bank', mask: '4402', token: 'demo-item-brookvale', sort: 15, property_id: 2 }),
  A({ id: 'demo_op_sand',    name: 'Sandpiper Bay Operating', type: 'depository', subtype: 'checking', bank: 'Brookvale Bank', mask: '4488', token: 'demo-item-brookvale', sort: 16, property_id: 3 }),
];

// Opening balances for ledger accounts (Jan 1 of the current year). Credit cards open
// negative — money owed.
const beginning = {
  demo_chk_main: 12480, demo_chk_joint: 6240, demo_sav_ef: 42600, demo_cc_every: -1840,
  demo_cc_travel: -620, demo_sav_capex: 58200, demo_op_kest: 7350, demo_op_sand: 5120,
};

// Valuation-mode accounts: one reading per elapsed month of the current year, so net worth
// trends instead of jumping. Liabilities are stored as a POSITIVE amount owed; the sign is
// derived in domain/netWorth.ts.
//
// [startOfYear, today, wobble]. Markets do not climb in a clean line, so investment accounts get
// a deterministic wobble that dips in some months; loans amortise monotonically and get none.
const valuationRange = {
  demo_brokerage: [128400, 147800, 0.035],
  demo_401k:      [214300, 238700, 0.025],
  demo_roth:      [ 62100,  69900, 0.030],
  demo_hsa:       [ 11240,  12360, 0],
  demo_mtg_alder: [452800, 447600, 0],
  demo_mtg_kest:  [241600, 237700, 0],
  demo_mtg_sand:  [216900, 213200, 0],
  demo_auto:      [ 24800,  21700, 0],
};

const valuationSeries = Object.fromEntries(
  Object.entries(valuationRange).map(([id, [from, to, wobble]]) => [
    id,
    Array.from({ length: monthsElapsed }, (_, i) => {
      const t = monthsElapsed === 1 ? 1 : i / (monthsElapsed - 1);
      // sin over the elapsed span, zero at both ends so start and end stay exactly as declared
      const swing = wobble * (to - from) * Math.sin(t * Math.PI * 2.5) * (1 - t);
      return Math.round((from + (to - from) * t + swing) / 100) * 100;
    }),
  ])
);

// ---------------------------------------------------------------- budget categories
const categories = [
  { name: 'Salary',            annual: 186000, landscape: 'operational', income: true },
  { name: 'Rental Income',     annual:  62400, landscape: 'operational', income: true },
  { name: 'Groceries',         annual:  14400, landscape: 'operational' },
  { name: 'Dining Out',        annual:   6000, landscape: 'operational' },
  { name: 'Utilities',         annual:   5400, landscape: 'operational' },
  { name: 'Transport',         annual:   4800, landscape: 'operational' },
  { name: 'Insurance',         annual:   7200, landscape: 'operational' },
  { name: 'Healthcare',        annual:   3600, landscape: 'operational' },
  { name: 'Subscriptions',     annual:   1800, landscape: 'operational' },
  { name: 'Home Maintenance',  annual:   6000, landscape: 'operational' },
  { name: 'Childcare',         annual:  12000, landscape: 'operational' },
  { name: 'Travel',            annual:   8400, landscape: 'operational' },
  { name: 'Shopping',          annual:   7200, landscape: 'operational' },
  { name: 'Pets',              annual:   2400, landscape: 'operational' },
  { name: 'Property Tax',      annual:  14400, landscape: 'operational' },
  { name: 'Property Repairs',  annual:   7200, landscape: 'operational' },
  { name: 'Property Mgmt',     annual:   6000, landscape: 'operational' },
  { name: 'Home Improvement',  annual:  24000, landscape: 'capital' },
  { name: 'Investments',       annual:  48000, landscape: 'capital' },
  { name: 'Mortgage Payment',  annual:      0, landscape: 'capital', exclude: true },
  { name: 'Transfers',         annual:      0, landscape: 'operational', exclude: true },
];

// ---------------------------------------------------------------- transactions
// Sign convention (Plaid's, which this app keeps): POSITIVE = money out, NEGATIVE = money in.
const merchants = {
  Groceries:        ['Northwind Market', 'Green Basket Grocers', 'Harborline Foods'],
  'Dining Out':     ['Blue Heron Cafe', 'Copper Kettle', 'Saffron & Sage', 'Tidewater Diner', 'Rye & Ember'],
  Transport:        ['Meridian Fuel', 'Brookvale Transit', 'Axle & Co Service'],
  Healthcare:       ['Elmwood Family Health', 'Vista Pharmacy'],
  'Home Maintenance': ['Redbarn Hardware', 'Alder Lawn Care', 'Summit Roofing'],
  Travel:           ['Skyline Air', 'Wanderlodge Hotels', 'Coastline Rentals'],
  Shopping:         ['Fernway Outfitters', 'Paper & Pine', 'Quarry Home Goods', 'Lantern & Loom'],
  Pets:             ['Whisker & Paw Vet', 'Barkside Supply'],
  'Home Improvement': ['Summit Roofing', 'Brookvale Cabinetry', 'Ironwood Flooring'],
  'Property Repairs': ['Tidewater Plumbing', 'Ironwood Flooring', 'Cape Electric'],
};

const txns = [];
let tid = 1;
// Anything dated past today is dropped rather than clamped onto the 11th — clamping piled the
// whole of August onto one day, which made the "Today" card read as a $4.7k spending spree.
const add = (account_id, date, amount, merchant, category) => {
  if (new Date(date + 'T12:00:00') > TODAY) return;
  txns.push([`demo-txn-${tid++}`, account_id, date, amount, merchant, category]);
};

const lastDay = (m) => new Date(YEAR, m, 0).getDate();
const cap = (m, day) => Math.min(day, lastDay(m));

for (let m = 1; m <= monthsElapsed; m++) {
  const md = (day) => d(YEAR, m, cap(m, day));

  // Income
  add('demo_chk_main', md(15), -7750, 'Vantage Systems Payroll', 'Salary');
  if (m < 8) add('demo_chk_main', md(lastDay(m)), -7750, 'Vantage Systems Payroll', 'Salary');
  add('demo_op_kest', md(3), -2850, 'Kestrel Court Rent', 'Rental Income');
  add('demo_op_sand', md(3), -2350, 'Sandpiper Bay Rent', 'Rental Income');

  // Fixed monthly
  add('demo_chk_joint', md(6),  145.20, 'Pinecrest Power',    'Utilities');
  add('demo_chk_joint', md(8),   61.80, 'Clearbrook Water',   'Utilities');
  add('demo_chk_joint', md(12), 118.00, 'Cobalt Wireless',    'Utilities');
  add('demo_chk_joint', md(12), 125.00, 'Fiberline Internet', 'Utilities');
  add('demo_chk_joint', md(4),  600.00, 'Stonebridge Insurance', 'Insurance');
  add('demo_chk_joint', md(2), 1000.00, 'Little Lantern Preschool', 'Childcare');
  add('demo_cc_every',  md(9),   18.99, 'Streamline Media',   'Subscriptions');
  add('demo_cc_every',  md(11),  59.99, 'Cloudkeep Storage',  'Subscriptions');
  add('demo_cc_every',  md(19),  14.00, 'Novel Press',        'Subscriptions');
  add('demo_cc_every',  md(23),  57.02, 'Atlas Fitness',      'Subscriptions');
  add('demo_chk_main',  md(5), 4000.00, 'Meridian Invest Transfer', 'Investments');

  // Variable
  for (let i = 0; i < 6; i++) add('demo_cc_every', md(2 + i * 4), between(78, 235), pick(merchants.Groceries), 'Groceries');
  for (let i = 0; i < 8; i++) add('demo_cc_every', md(1 + i * 3), between(16, 96), pick(merchants['Dining Out']), 'Dining Out');
  for (let i = 0; i < 3; i++) add('demo_cc_every', md(4 + i * 9), between(42, 78), 'Meridian Fuel', 'Transport');
  add('demo_chk_joint', md(7), 95.00, 'Brookvale Transit', 'Transport');
  if (m % 3 === 0) add('demo_cc_every', md(21), between(180, 420), 'Axle & Co Service', 'Transport');
  for (let i = 0; i < 2; i++) add('demo_cc_every', md(10 + i * 12), between(45, 260), pick(merchants.Healthcare), 'Healthcare');
  for (let i = 0; i < 5; i++) add('demo_cc_travel', md(3 + i * 5), between(24, 190), pick(merchants.Shopping), 'Shopping');
  add('demo_cc_every', md(16), between(60, 320), pick(merchants.Pets), 'Pets');
  add('demo_cc_every', md(13), between(120, 780), pick(merchants['Home Maintenance']), 'Home Maintenance');

  // Trips in Mar, Jun, Aug
  if (m === 3 || m === 6 || m === 8) {
    add('demo_cc_travel', md(14), between(420, 890), 'Skyline Air', 'Travel');
    add('demo_cc_travel', md(16), between(310, 640), 'Wanderlodge Hotels', 'Travel');
  }

  // Capital projects, a few times a year
  if (m === 2 || m === 5 || m === 7) add('demo_sav_capex', md(18), between(2800, 6400), pick(merchants['Home Improvement']), 'Home Improvement');

  // Household Checking pays the shared fixed costs but has no income of its own, so it is topped
  // up from the main account each month — without this it drifts steadily negative, which is a
  // seeding artefact rather than anything the app is showing wrong.
  add('demo_chk_main',  md(1), 2400.00, 'Transfer to Household Checking', 'Transfers');
  add('demo_chk_joint', md(1), -2400.00, 'Transfer from Everyday Checking', 'Transfers');

  // Card payoffs — excluded transfers, so they net the cards down without touching the budget.
  // Paired amounts must match on both sides or the two ledgers disagree.
  const everyPay = between(2400, 3100);
  add('demo_cc_every',  md(20), -everyPay, 'Cobalt Card Payment', 'Transfers');
  add('demo_chk_main',  md(20),  everyPay, 'Cobalt Card Payment', 'Transfers');
  const travelPay = between(500, 1200);
  add('demo_cc_travel', md(22), -travelPay, 'Cobalt Card Payment', 'Transfers');
  add('demo_chk_main',  md(22),  travelPay, 'Cobalt Card Payment', 'Transfers');

  // Rental operating costs + debt service (debt service sits on the mortgage account itself, which
  // is how the property P&L tells financing apart from operating expense).
  add('demo_op_kest', md(10),  620.00, 'Brookvale County Tax',  'Property Tax');
  add('demo_op_kest', md(14),  285.00, 'Harbor Property Mgmt',  'Property Mgmt');
  if (m % 2 === 0) add('demo_op_kest', md(17), between(180, 720), pick(merchants['Property Repairs']), 'Property Repairs');
  // Payments on a LOAN account are negative: from the loan's perspective they reduce what is
  // owed. lib/domain/propertyPnl.ts negates them back, so seeding them positive made a year of
  // mortgage payments read as income and the rental look cash-flow positive when it isn't.
  add('demo_mtg_kest', md(1), -1642.00, 'Harborline Home Loans', 'Mortgage Payment');

  add('demo_op_sand', md(10),  480.00, 'Windmere County Tax',   'Property Tax');
  add('demo_op_sand', md(14),  215.00, 'Cape Coast Management', 'Property Mgmt');
  if (m % 2 === 1) add('demo_op_sand', md(19), between(150, 610), pick(merchants['Property Repairs']), 'Property Repairs');
  add('demo_mtg_sand', md(1), -1385.00, 'Harborline Home Loans', 'Mortgage Payment');

  add('demo_mtg_alder', md(1), -2870.00, 'Harborline Home Loans', 'Mortgage Payment');
  add('demo_auto',      md(6), -545.00, 'Cobalt Auto Finance',   'Mortgage Payment');
}

// ---------------------------------------------------------------- write
async function main() {
  await db.connect();
  await db.query('BEGIN');

  await db.query(`TRUNCATE transactions, transfer_groups, account_valuations, property_valuations,
                           account_balances, category_balances, net_worth_snapshots, sync_log,
                           budget_categories, category_rules, accounts, properties, budget_settings
                  RESTART IDENTITY CASCADE`);

  for (const p of properties) {
    await db.query(
      `INSERT INTO properties (id, nickname, address, type, purchase_price, purchase_date, cost_basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.id, p.nickname, p.address, p.type, p.purchase_price, p.purchase_date, p.cost_basis]
    );
  }
  await db.query(`SELECT setval('properties_id_seq', (SELECT MAX(id) FROM properties))`);

  for (const [pid, value, source, valuedAt] of propertyValuations) {
    await db.query(
      'INSERT INTO property_valuations (property_id, value, source, valued_at) VALUES ($1,$2,$3,$4)',
      [pid, value, source, valuedAt]
    );
  }

  for (const a of accounts) {
    await db.query(
      `INSERT INTO accounts (id, name, type, subtype, access_token, last_synced_at, landscape,
                             track_transactions, bank, mask, sort_order, valuation_mode,
                             is_liability, property_id)
       VALUES ($1,$2,$3,$4,$5, NOW() - INTERVAL '4 hours', $6,$7,$8,$9,$10,$11,$12,$13)`,
      [a.id, a.name, a.type, a.subtype, a.token, a.landscape, a.track_transactions,
       a.bank, a.mask, a.sort, a.valuation_mode, a.is_liability, a.property_id]
    );
  }

  for (const [id, bal] of Object.entries(beginning)) {
    await db.query('INSERT INTO account_balances (account_id, year, beginning_balance) VALUES ($1,$2,$3)', [id, YEAR, bal]);
  }

  // Mortgage balances for the two prior years, quarterly. Without these the property value chart
  // can only draw an equity line where BOTH a property valuation and a mortgage reading exist,
  // so the older half of the x-axis showed market value alone while the legend promised two
  // series that were not there.
  const perQuarter = { demo_mtg_alder: 2100, demo_mtg_kest: 1650, demo_mtg_sand: 1500 };
  for (const [id, step] of Object.entries(perQuarter)) {
    const startOfYear = valuationSeries[id][0];
    let quartersBack = 8; // eight quarters from January two years ago to January this year
    for (let y = YEAR - 2; y <= YEAR - 1; y++) {
      for (const m of [1, 4, 7, 10]) {
        await db.query(
          'INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ($1,$2,$3,$4)',
          [id, startOfYear + step * quartersBack, 'plaid_balance', ts(y, m, 15)]
        );
        quartersBack--;
      }
    }
  }

  for (const [id, series] of Object.entries(valuationSeries)) {
    for (let i = 0; i < series.length; i++) {
      // Prior months are stamped at month end; the current month's reading is stamped today, so
      // the newest valuation is never dated in the future.
      const isCurrentMonth = i === series.length - 1;
      const day = isCurrentMonth ? TODAY.getDate() : Math.min(28, lastDay(i + 1));
      await db.query(
        'INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ($1,$2,$3,$4)',
        [id, series[i], 'plaid_balance', ts(YEAR, i + 1, day)]
      );
    }
  }

  for (let i = 0; i < categories.length; i++) {
    const c = categories[i];
    await db.query(
      `INSERT INTO budget_categories (name, annual_budget, landscape, exclude_from_budget, is_income, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [c.name, c.annual, c.landscape, c.exclude ?? false, c.income ?? false, i]
    );
  }

  for (const [pid, aid, date, amount, merchant, category] of txns) {
    await db.query(
      `INSERT INTO transactions (plaid_transaction_id, account_id, date, amount, merchant_name, name, mapped_category, rule_applied)
       VALUES ($1,$2,$3,$4,$5,$5,$6, TRUE)`,
      [pid, aid, date, amount, merchant, category]
    );
  }

  await db.query('INSERT INTO budget_settings (year, beginning_balance, landscape) VALUES ($1,$2,$3), ($1,$4,$5)',
    [YEAR, 60700, 'operational', 58200, 'capital']);

  // Plaid-reported balances for the ledger accounts, set to exactly what the ledger computes —
  // a correctly reconciled book, so the drift alert stays silent instead of shouting in a demo.
  const ledger = await db.query(`
    SELECT a.id, a.type,
           COALESCE(b.beginning_balance, 0)
             + COALESCE((SELECT COALESCE(ABS(SUM(t.amount) FILTER (WHERE t.amount < 0)), 0)
                                - COALESCE(SUM(t.amount) FILTER (WHERE t.amount > 0), 0)
                           FROM transactions t WHERE t.account_id = a.id AND EXTRACT(YEAR FROM t.date) = $1), 0) AS balance
      FROM accounts a
      LEFT JOIN account_balances b ON b.account_id = a.id AND b.year = $1
     WHERE a.valuation_mode = 'ledger'`, [YEAR]);
  for (const r of ledger.rows) {
    const owedPositive = r.type === 'credit' || r.type === 'loan';
    await db.query(
      'INSERT INTO account_valuations (account_id, value, source, valued_at) VALUES ($1,$2,$3, NOW())',
      [r.id, owedPositive ? -Number(r.balance) : Number(r.balance), 'plaid_balance']
    );
  }

  // Sync log across the last 30 days: two runs a day, one bad day.
  for (let i = 29; i >= 0; i--) {
    for (const phase of ['plain', 'force']) {
      await db.query(
        `INSERT INTO sync_log (ran_at, trigger, phase, synced, unmatched, errors)
         VALUES (NOW() - ($1 || ' days')::interval + ($2 || ' hours')::interval, 'schedule', $3, $4, 0, $5)`,
        [i, phase === 'plain' ? 6 : 18, phase, 16, i === 12 && phase === 'plain' ? 1 : 0]
      );
    }
  }

  // Monthly net-worth snapshots, computed with the same composition rule as
  // lib/domain/netWorth.ts so the history chart's last point equals the hero figure exactly.
  for (let m = 1; m <= monthsElapsed; m++) {
    const asOf = m === monthsElapsed ? TODAY : new Date(YEAR, m, 0);
    const val = (id) => valuationSeries[id][m - 1];

    let operational = 0, capitalFinancial = 0;
    for (const a of accounts) {
      if (a.valuation_mode === 'valuation') {
        if (a.is_liability) continue;
        capitalFinancial += val(a.id);
        continue;
      }
      let bal = beginning[a.id] ?? 0;
      for (const [, aid, date, amount] of txns) {
        if (aid === a.id && new Date(date + 'T12:00:00') <= asOf) bal += -amount;
      }
      if (a.landscape === 'operational') operational += bal; else capitalFinancial += bal;
    }

    let propertyTotal = 0;
    for (const [pid, rows] of Object.entries(valueSeries)) {
      let latest = null;
      for (const [y, mm, v] of rows) if (new Date(y, mm - 1, 15) <= asOf) latest = v;
      if (latest !== null) propertyTotal += latest;
    }
    const linkedMortgages = accounts
      .filter((a) => a.is_liability && a.property_id !== null)
      .reduce((s, a) => s + val(a.id), 0);
    const realEstateEquity = propertyTotal - linkedMortgages;

    const liabilities = -accounts
      .filter((a) => a.is_liability && a.property_id === null)
      .reduce((s, a) => s + val(a.id), 0);

    const r2 = (n) => Math.round(n * 100) / 100;
    await db.query(
      `INSERT INTO net_worth_snapshots (snapshot_date, operational, capital_financial, real_estate_equity, liabilities, total)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [d(YEAR, m, m === monthsElapsed ? TODAY.getDate() : lastDay(m)), r2(operational), r2(capitalFinancial),
       r2(realEstateEquity), r2(liabilities), r2(operational + capitalFinancial + realEstateEquity + liabilities)]
    );
  }

  await db.query('COMMIT');

  console.log(`seeded: ${accounts.length} accounts, ${properties.length} properties, ${txns.length} transactions`);
  await db.end();
}

main().catch(async (e) => { console.error(e.message); try { await db.query('ROLLBACK'); } catch {} process.exit(1); });
