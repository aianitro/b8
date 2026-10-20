// The digest of findings, composed but not delivered (ROADMAP.md §5 Phase 5 step 36).
//
// WHY THIS EXISTS. Steps 34 and 35 produce one list of findings, each with a severity and a freshness.
// A list is not yet something a person can read: it has no order a reader would choose, no sentence
// saying how old each finding's evidence is, and no statement of which checks never ran. This module
// is the one place those are decided and worded. The page at `/digest` lays out what this returns and
// composes nothing of its own, so the sentences cannot drift between two screens.
//
// NOT THE DAILY EMAIL. `digest.ts` and `../digestRead.ts` beside this file are the email digest
// (`DigestData`); they are unrelated, not imported and not reused. The names here say "findings
// digest" so the two are never confused (SPEC.md "Names this spec fixes").
//
// THREE THINGS THE WORDING MUST NEVER DO, and why each is a rule rather than a style:
//
//   1. Present freshness as health. A feed that is failing right now can have a last success from an
//      hour ago, so its freshness is `fresh` while the feed is broken. For the three kinds whose very
//      existence is the failure (a degraded feed, a stale sync, an overdue job) a date says only when
//      the thing last worked, and the sentence says so; the words a reader would take as "working"
//      are never used for them, and the failing feed with a recent success carries a coded caveat.
//   2. Present "not evaluated" as clean. A source that was not supplied is named. An empty list is
//      reported as a neutral count of the sources that ran and reported nothing, never as a verdict
//      that all is well; the positive statement with a figure behind it is step 37's, not this one's.
//   3. Say anything about money. Every figure stays in the carried finding as the contract's
//      two-decimal string with its producer's sign. No sentence here contains an amount, so no
//      sentence can round one, drop its sign or disagree with the dashboard about it.
//
// IT JUDGES NOTHING. Severity, confidence, freshness and which findings exist are all decided
// upstream and copied here. This module imports no threshold and writes no severity: it reports the
// age a finding already carries and reorders only its own view of the list. A digest that re-judged
// ages would be a second implementation of step 35.
//
// PURE. No clock, no database, no randomness, no time-zone dependence: the period is an argument and
// every count is read off the input. Inputs are never written; every returned finding is a copy.

import {
  AsOfPeriodSchema,
  FindingKindSchema,
  FreshnessStateSchema,
  SeveritySchema,
  type Finding,
  type FindingKind,
  type FreshnessBasis,
  type FreshnessState,
  type Period,
} from '@b8/contracts/findings';
import { FINDING_SOURCES, type FindingSource } from './findings';

// ─── The shapes ────────────────────────────────────────────────────────────────────────────────
//
// Plain TypeScript, deliberately not a contract (SPEC.md "Contracts touched"). The digest is built
// and consumed inside one server process; it is never parsed from or serialised across a boundary.
// A later step that serves it to a client owns turning it into a schema.

/** One calendar day, in exactly the contract's as-of period shape: no new calendar type. */
export type DigestPeriod = Extract<Period, { type: 'asOf' }>;

/**
 * Which sources were never asked. Exactly what `assembleFindings` returns beside its list, because
 * that is the one thing a list of findings cannot say about itself. (The roadmap calls this third
 * parameter "freshness"; each finding already carries its own, so repeating it would invite a second
 * judgement of it. SPEC.md open question Q1.)
 */
export interface DigestCoverage {
  notEvaluated: readonly FindingSource[];
}

/**
 * The one combination where a finding's freshness reads better than the finding: a feed that is
 * failing now, whose last success is recent enough to be `fresh`. Coded, so a renderer or a later
 * step can act on it without parsing a sentence; `null` for every other combination.
 */
export type DigestCaveat = 'recent-success-feed-still-failing' | null;

/** How old one item's evidence is: the finding's own freshness, copied and never upgraded. */
export interface DigestItemDating {
  state: FreshnessState;
  basis: FreshnessBasis;
  ageDays: number | null;
  undatedInputs: number;
  caveat: DigestCaveat;
  statement: string;
}

export interface DigestItem {
  /** The input finding, deep-equal to it and never the same object. */
  finding: Finding;
  dating: DigestItemDating;
}

/**
 * `findings` when there is at least one item; `incomplete` when there are none and some source was
 * not evaluated; `none-reported` when there are none and every source was. Nothing else, and none of
 * the three means "all is well".
 */
export type DigestStatus = 'findings' | 'incomplete' | 'none-reported';

/** Counts of items by freshness state, and of undatable inputs. Counts of things, not figures. */
export type DigestDating = Record<FreshnessState, number> & { undatedInputs: number };

export interface FindingsDigest {
  period: DigestPeriod;
  status: DigestStatus;
  items: DigestItem[];
  dating: DigestDating;
  coverage: {
    /** In `FINDING_SOURCES` order. With `notEvaluated`, exactly the sources, none repeated. */
    evaluated: FindingSource[];
    notEvaluated: FindingSource[];
    statement: string;
  };
  /** The headline sentence. */
  statement: string;
}

// ─── The reader's order ────────────────────────────────────────────────────────────────────────

/**
 * Within one severity, the order a reader meets the kinds (SPEC.md Q3, the owner's choice): money at
 * risk first, then figures that may be wrong, then the feeds and jobs that explain them, then
 * reminders. A projected overdraft therefore precedes a "never synced" warning, which the
 * assembler's source order does not do (P5-34 N4).
 *
 * Severity always wins first: this list never lifts a notice above a warning. The assembler's own
 * order is untouched; this is only the digest's view of it.
 */
const READER_ORDER: readonly FindingKind[] = [
  'overdraft-open',
  'overdraft-forecast',
  'budget-breach',
  'balance-drift',
  'feed-degraded',
  'sync-stale',
  'job-overdue',
  'cash-uncounted',
  'valuation-stale',
  'budget-underspend',
];

/**
 * The kinds whose existence is the failure: a feed degraded, a sync overdue, the job overdue. For
 * these a date says only when the thing last worked, and never that it works now.
 */
const FAILURE_KINDS: ReadonlySet<FindingKind> = new Set<FindingKind>(['feed-degraded', 'sync-stale', 'job-overdue']);

/**
 * Severity rank read from the contract's own list (worst first), not restated: reordering it there is
 * the one change that reorders it here, and this module writes no severity of its own.
 */
const severityRank = (f: Finding) => SeveritySchema.options.indexOf(f.severity);
const kindRank = (f: Finding) => READER_ORDER.indexOf(f.kind);

// ─── The words ─────────────────────────────────────────────────────────────────────────────────

/**
 * What each basis is, in plain words, as a noun phrase that reads after "last" and after "a". The
 * basis names the worst input's kind (contract `FreshnessBasisSchema`); `none` only ever appears with
 * `undated`, where it means nothing the finding rests on has a usable record.
 */
export const BASIS_WORDS: Record<FreshnessBasis, string> = {
  sync: 'successful sync',
  feed: 'successful bank feed refresh',
  valuation: 'valuation',
  'cash-count': 'cash count',
  'job-run': 'scheduled run of the daily job',
  'overdraft-sighting': 'balance reading below the cushion',
  'overdraft-projection': 'overdraft projection',
  none: 'recorded input',
};

/**
 * Each source in plain words. Each label contains the source's own name, so a reader who knows the
 * code's vocabulary and one who does not both find it.
 */
export const SOURCE_LABELS: Record<FindingSource, string> = {
  adherence: 'budget adherence',
  drift: 'balance drift',
  feed: 'bank feed',
  sync: 'sync status',
  job: 'daily job',
  wallets: 'cash wallets',
  valuations: 'valuations',
  overdrafts: 'open overdrafts',
  forecasts: 'overdraft forecasts',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const article = (noun: string) => (/^[aeiou]/i.test(noun) ? 'An' : 'A');

/**
 * The sentence saying how old one item's evidence is.
 *
 * `fresh` and `stale` give the age in whole days, as the finding carries it, with the basis named.
 * `never` says "never". `undated` says it cannot be dated. Any undatable input is counted aloud
 * whatever the state, so a `stale` finding that also rests on something undatable says both. A null
 * age is never printed as zero days: an incoherent freshness (fresh with no age) throws instead.
 */
function datingStatement(f: Finding, caveat: DigestCaveat): string {
  const fr = f.freshness;
  const words = BASIS_WORDS[fr.basis];
  let sentence: string;
  if (fr.state === 'fresh' || fr.state === 'stale') {
    if (fr.ageDays === null) {
      throw new RangeError(`composeDigest: a ${fr.state} ${f.kind} finding has no age; its freshness is incoherent`);
    }
    const age = plural(fr.ageDays, 'day', 'days');
    if (caveat === 'recent-success-feed-still-failing') {
      sentence = `The feed is still failing. Its last ${words} was ${age} ago; that dates when it last worked, and the failure is current.`;
    } else if (FAILURE_KINDS.has(f.kind)) {
      sentence = `Its last ${words} was ${age} ago; that dates when it last worked, and the finding still stands.`;
    } else if (fr.state === 'stale') {
      sentence = `Its oldest input is the last ${words}, ${age} ago, older than that source is expected to be.`;
    } else {
      sentence = `Its oldest input is the last ${words}, ${age} ago.`;
    }
  } else if (fr.state === 'never') {
    sentence = `${article(words)} ${words} has never been recorded.`;
  } else {
    sentence = fr.basis === 'none'
      ? 'This cannot be dated: nothing it rests on has a usable record of when it was last true.'
      : `This cannot be dated: there is no usable record of the last ${words}.`;
  }
  if (fr.undatedInputs > 0) {
    sentence += ` ${plural(fr.undatedInputs, 'input', 'inputs')} behind it cannot be dated.`;
  }
  return sentence;
}

function caveatOf(f: Finding): DigestCaveat {
  return f.kind === 'feed-degraded' && f.state === 'failing' && f.freshness.state === 'fresh'
    ? 'recent-success-feed-still-failing'
    : null;
}

const listOf = (sources: readonly FindingSource[]) => sources.map((s) => SOURCE_LABELS[s]).join(', ');

function coverageStatement(evaluated: readonly FindingSource[], notEvaluated: readonly FindingSource[]): string {
  const total = FINDING_SOURCES.length;
  if (notEvaluated.length === 0) return `${evaluated.length} of ${total} sources were evaluated: ${listOf(evaluated)}.`;
  const missing = `Not evaluated: ${listOf(notEvaluated)}.`;
  if (evaluated.length === 0) return `No source was evaluated. ${missing}`;
  return `${evaluated.length} of ${total} sources were evaluated. ${missing}`;
}

function headline(status: DigestStatus, items: number, evaluated: number, notEvaluated: number): string {
  const total = FINDING_SOURCES.length;
  switch (status) {
    case 'findings': {
      const head = `${plural(items, 'finding', 'findings')} reported by ${evaluated} of ${total} sources.`;
      return notEvaluated === 0
        ? head
        : `${head} ${plural(notEvaluated, 'source was', 'sources were')} not evaluated, so the list may be incomplete.`;
    }
    case 'incomplete':
      return evaluated === 0
        ? `No source was evaluated: ${notEvaluated} of ${total} sources were not evaluated, so there are no findings to list.`
        : `The ${plural(evaluated, 'source', 'sources')} evaluated reported no findings, but ${notEvaluated} of ${total} were not evaluated, so this is incomplete.`;
    case 'none-reported':
      return `${evaluated} of ${total} sources were evaluated and none of them reported a finding.`;
  }
}

// ─── The function ──────────────────────────────────────────────────────────────────────────────

/**
 * The digest of `findings` for one day.
 *
 * Throws `RangeError` when the period is not a real `YYYY-MM-DD` date (checked by the contract's own
 * as-of period schema, so this module has no second idea of a calendar), when an as-of finding is
 * dated another day (one day's findings are never captioned with another's date), when a
 * not-evaluated source is not one of the known sources, or when a finding's freshness is incoherent.
 * Findings about a month or a set of months are not compared with the period.
 *
 * ONE ITEM PER FINDING. Nothing is dropped, added, merged or de-duplicated: two findings of one kind
 * about one subject name stay two, and a feed finding and a sync finding about one bank stay two.
 *
 * ORDER: severity first, then `READER_ORDER`, then input position. All three keys are explicit, so
 * the result depends on the input order only among findings of the same severity and kind, and does
 * not lean on `Array.prototype.sort` stability.
 */
export function composeDigest(
  findings: readonly Finding[],
  period: DigestPeriod,
  coverage: DigestCoverage,
): FindingsDigest {
  if (!AsOfPeriodSchema.safeParse(period).success) {
    throw new RangeError(`composeDigest: the period must be an as-of period with a real YYYY-MM-DD date, got ${JSON.stringify(period)}`);
  }
  for (const f of findings) {
    if (f.period.type === 'asOf' && f.period.date !== period.date) {
      throw new RangeError(`composeDigest: a ${f.kind} finding is dated ${f.period.date}, the digest is for ${period.date}`);
    }
  }
  for (const s of coverage.notEvaluated) {
    if (!(FINDING_SOURCES as readonly string[]).includes(s)) {
      throw new RangeError(`composeDigest: unknown source ${JSON.stringify(s)} in notEvaluated`);
    }
  }

  // Canonical order and each source once, whatever order or repetition the caller passed.
  const notEvaluated = FINDING_SOURCES.filter((s) => coverage.notEvaluated.includes(s));
  const evaluated = FINDING_SOURCES.filter((s) => !coverage.notEvaluated.includes(s));

  const ranked = findings.map((finding, position) => ({ finding, position }));
  ranked.sort((a, b) =>
    severityRank(a.finding) - severityRank(b.finding)
    || kindRank(a.finding) - kindRank(b.finding)
    || a.position - b.position);

  const items: DigestItem[] = ranked.map(({ finding }) => {
    const caveat = caveatOf(finding);
    const fr = finding.freshness;
    return {
      // A deep copy: the caller's finding can be frozen, and mutating either side must not reach
      // the other.
      finding: structuredClone(finding),
      dating: {
        state: fr.state,
        basis: fr.basis,
        ageDays: fr.ageDays,
        undatedInputs: fr.undatedInputs,
        caveat,
        statement: datingStatement(finding, caveat),
      },
    };
  });

  // Each item counts once, in its own state's tally and nowhere else.
  const tallies = Object.fromEntries(FreshnessStateSchema.options.map((s) => [s, 0])) as Record<FreshnessState, number>;
  let undatedInputs = 0;
  for (const item of items) {
    tallies[item.dating.state] += 1;
    undatedInputs += item.dating.undatedInputs;
  }

  const status: DigestStatus = items.length > 0 ? 'findings' : notEvaluated.length > 0 ? 'incomplete' : 'none-reported';

  return {
    period: { type: 'asOf', date: period.date },
    status,
    items,
    dating: { ...tallies, undatedInputs },
    coverage: { evaluated, notEvaluated, statement: coverageStatement(evaluated, notEvaluated) },
    statement: headline(status, items.length, evaluated.length, notEvaluated.length),
  };
}

/**
 * The kinds in the reader's order, for a test or a renderer that wants to group by kind without
 * restating the list. Checked against the contract's kinds at load: a kind added there without a
 * place here throws rather than sorting to the front with rank -1.
 */
export const DIGEST_KIND_ORDER: readonly FindingKind[] = READER_ORDER;
if (FindingKindSchema.options.some((k) => !READER_ORDER.includes(k)) || READER_ORDER.length !== FindingKindSchema.options.length) {
  throw new RangeError('findingsDigest: READER_ORDER must list every finding kind exactly once');
}
