/**
 * How much of the annual plan has been spent, as a track.
 *
 * Clamped at 100% so an overspend fills the bar rather than overflowing its container — and turns
 * red, because past the line the bar has stopped measuring progress and started reporting a state.
 * An unclamped width is how a 130% figure silently pushes the card's own border out.
 *
 * Guards a zero budget: with nothing planned there is no proportion to draw, and `spent / 0` is
 * `Infinity`, which becomes a `width: Infinity%` the browser resolves to the full width — a full
 * red bar on a household that has simply not set a budget yet.
 */
export default function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  if (budget <= 0) return null;
  const ratio = spent / budget;
  const over = ratio > 1;
  return (
    <div className="w-full bg-slate-100 rounded-full h-1.5" title={`${Math.round(ratio * 100)}% of the annual plan`}>
      <div
        className={`h-1.5 rounded-full ${over ? 'bg-red-500' : 'bg-blue-500'}`}
        style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
      />
    </div>
  );
}
