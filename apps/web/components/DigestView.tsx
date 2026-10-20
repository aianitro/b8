import type { Finding, FindingKind, FreshnessState, Severity } from '@b8/contracts/findings';
import type { DigestItem, FindingsDigest } from '@/lib/domain/findingsDigest';

// The findings digest, laid out (ROADMAP.md §5 Phase 5 step 36). A server component with no state:
// the page is read-only, and nothing here needs the browser.
//
// IT COMPOSES NO SENTENCE. The headline, the coverage statement and each item's dating statement are
// written by `composeDigest`, which is where the rules about them are tested (a recent success on a
// failing feed never reads as working; an empty digest is a neutral count, never a verdict). This file
// only places them, so there is no second wording to drift from the first. The short labels below —
// a kind's name, a figure's name — are captions, not statements.
//
// MONEY IS SHOWN EXACTLY AS THE FINDING CARRIES IT: the contract's two-decimal string, with its
// producer's sign, no currency symbol and no grouping (SPEC.md Q7). This departs from the design
// system's `Intl.NumberFormat` rule on purpose: formatting would mean turning the string back into a
// float, which can round it and would bring sign placement into this file. A negative figure keeps its
// leading minus because nothing here touches it.
//
// SLATE, AS THE PAGES AROUND IT. The design system's tables say `gray-*`; the dashboard and the
// accounts screens this sits beside are `slate-*`, and two greys on one screen read as a bug. Severity
// is the only colour: red for the one critical kind (money being lost now), amber for warnings, slate
// for notices — the callout palette the design system gives warnings.

/** The caption for each kind. Keyed by the contract's kinds, so a new kind is a type error here. */
const KIND_LABELS: Record<FindingKind, string> = {
  'overdraft-open': 'Open overdraft',
  'overdraft-forecast': 'Projected overdraft',
  'budget-breach': 'Over budget',
  'balance-drift': 'Balance drift',
  'feed-degraded': 'Bank feed degraded',
  'sync-stale': 'Sync overdue',
  'job-overdue': 'Daily job overdue',
  'cash-uncounted': 'Cash not counted',
  'valuation-stale': 'Valuation overdue',
  'budget-underspend': 'Chronic underspend',
};

/** Colour by severity. Keyed by the contract's severities, so the value itself is never restated. */
const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'border-red-200 bg-red-50 text-red-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  notice: 'border-slate-200 bg-slate-50 text-slate-600',
};

/** The tallies, captioned by what each state means rather than by a word a reader could take as health. */
const TALLY_LABELS: Record<FreshnessState, string> = {
  fresh: 'Dated, within interval',
  stale: 'Dated, past interval',
  never: 'Never observed',
  undated: 'Cannot be dated',
};

/** The money strings a kind carries, by name, verbatim. Kinds with no money carry none. */
function figuresOf(f: Finding): [string, string][] {
  switch (f.kind) {
    case 'budget-breach':
    case 'budget-underspend':
      return [['Budgeted', f.budgeted], ['Actual', f.actual], ['Variance', f.variance]];
    case 'balance-drift':
      return [['Ledger', f.ledgerBalance], ['Bank', f.expectedBalance], ['Drift', f.drift]];
    case 'cash-uncounted':
      return [['Balance', f.balance]];
    case 'overdraft-open':
      return [['Balance', f.balance], ['Cushion', f.cushion]];
    case 'overdraft-forecast':
      return [['Projected low', f.low], ['Cushion', f.cushion], ['Low on', f.lowOn]];
    default:
      return [];
  }
}

/** What period a finding is about, as the calendar text it carries. */
function periodOf(f: Finding): string {
  switch (f.period.type) {
    case 'month': return f.period.month;
    case 'months': return f.period.months.join(', ');
    case 'asOf': return f.period.date;
  }
}

function Item({ item }: { item: DigestItem }) {
  const f = item.finding;
  const figures = figuresOf(f);
  return (
    <li className="border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${SEVERITY_TONE[f.severity]}`}>{f.severity}</span>
        <span className="text-sm font-semibold text-slate-900">{KIND_LABELS[f.kind]}</span>
        <span className="text-sm text-slate-600 break-words min-w-0">{f.subject.name}</span>
        <span className="text-xs text-slate-400 ml-auto">{periodOf(f)}</span>
      </div>
      <p className="text-sm text-slate-700">{item.dating.statement}</p>
      {figures.length > 0 && (
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {figures.map(([label, value]) => (
            <div key={label} className="flex gap-1">
              <dt className="text-slate-400">{label}</dt>
              <dd className="font-mono text-slate-700">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export default function DigestView({ digest }: { digest: FindingsDigest }) {
  const missing = digest.coverage.notEvaluated.length > 0;
  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Digest</h1>
        <p className="text-xs text-slate-400 mt-1">As of {digest.period.date}</p>
        <p className="text-sm text-slate-700 mt-2">{digest.statement}</p>
      </div>

      <div className={`rounded-lg border p-4 mb-6 text-sm ${missing ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
        {digest.coverage.statement}
      </div>

      {digest.items.length > 0 && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
            {(Object.keys(TALLY_LABELS) as FreshnessState[]).map((state) => (
              <div key={state} className="border border-slate-200 rounded-lg p-3">
                <p className="text-xs text-slate-400">{TALLY_LABELS[state]}</p>
                <p className="text-lg font-semibold text-slate-900">{digest.dating[state]}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mb-6">Inputs that cannot be dated: {digest.dating.undatedInputs}</p>
          <ol className="space-y-3">
            {digest.items.map((item, i) => <Item key={i} item={item} />)}
          </ol>
        </>
      )}
    </div>
  );
}
