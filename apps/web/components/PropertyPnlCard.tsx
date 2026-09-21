import { Info } from 'lucide-react';
import type { PropertyPnl } from '@/lib/domain/propertyPnl';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const signed = (n: number) => (n >= 0 ? fmt(n) : `−${fmt(Math.abs(n))}`);
const tone = (n: number) => (n >= 0 ? 'text-emerald-600' : 'text-red-600');

function Row({ label, amount, muted }: { label: string; amount: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className={muted ? 'text-slate-400' : 'text-slate-600'}>{label}</span>
      <span className="font-mono text-slate-700">{fmt(amount)}</span>
    </div>
  );
}

function Total({ label, amount, hint }: { label: string; amount: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-t border-slate-100">
      <span className="text-xs font-semibold text-slate-700">
        {label}
        {hint && <span className="block text-[10px] font-normal text-slate-400">{hint}</span>}
      </span>
      <span className={`font-mono text-sm font-semibold ${tone(amount)}`}>{signed(amount)}</span>
    </div>
  );
}

export default function PropertyPnlCard({ pnl, year }: { pnl: PropertyPnl; year: number }) {
  const nothing = pnl.income.length === 0 && pnl.operatingExpenses.length === 0 && pnl.debtService === 0;

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Profit &amp; loss</h2>
        <span className="text-[10px] text-slate-400">{year}</span>
      </div>

      {nothing ? (
        <p className="text-xs text-slate-400 italic">
          No transactions attributed yet. Link this property&apos;s accounts to populate the P&amp;L.
        </p>
      ) : (
        <>
          {pnl.income.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Income</p>
              {pnl.income.map((l) => <Row key={l.label} label={l.label} amount={l.amount} />)}
            </div>
          )}

          {pnl.operatingExpenses.length > 0 && (
            <div className="mb-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 mb-1">Operating expenses</p>
              {pnl.operatingExpenses.map((l) => <Row key={l.label} label={l.label} amount={l.amount} />)}
            </div>
          )}

          <Total label="Net operating income" amount={pnl.netOperatingIncome} hint="before financing" />

          {pnl.debtService !== 0 && (
            <div className="pt-1">
              <Row label="Debt service" amount={pnl.debtService} muted />
            </div>
          )}

          <Total label="Cash flow" amount={pnl.cashFlow} hint="what actually hit the bank" />

          {pnl.appreciation !== null && (
            <div className="pt-1">
              <Row label="Appreciation" amount={pnl.appreciation} muted />
            </div>
          )}

          {pnl.totalReturn !== null && (
            <Total label="Total return" amount={pnl.totalReturn} hint="cash flow + appreciation" />
          )}

          {/* A property can be cash-flow negative while earning a real return. Showing only one
              of those numbers misrepresents it — so when the other can't be completed, say why
              rather than letting the reader assume total return is whole. */}
          {!pnl.principalPaydownKnown && pnl.debtService !== 0 && (
            <p className="flex items-start gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 mt-3">
              <Info size={11} className="shrink-0 mt-px" />
              <span>
                Total return excludes principal paydown, so it understates. Part of each mortgage
                payment above builds equity rather than being an expense — separating it needs the
                loan&apos;s rate and term.
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
