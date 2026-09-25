'use client';

import { useRef, useState } from 'react';
import { GripVertical, FileText } from 'lucide-react';
import AccountNameEdit from './AccountNameEdit';
import AccountTypeEdit from './AccountTypeEdit';
import AccountBankEdit from './AccountBankEdit';
import AccountTrackingToggle from './AccountTrackingToggle';
import AccountLandscapeToggle from './AccountLandscapeToggle';
import AccountValuationModeToggle from './AccountValuationModeToggle';
import AccountValuationEdit from './AccountValuationEdit';
import AccountDeleteButton from './AccountDeleteButton';
import RelativeTime from './RelativeTime';
import type { Account } from '@b8/contracts/types';

type Section = 'operational' | 'capital';

// One grid shared by the header and every row, so the columns actually line up. The row was
// previously a flex with justify-between: cells sized themselves per row, nothing aligned
// vertically, and the whole thing overflowed once a fifth control was added. Fixed tracks for
// the controls plus a single minmax(0,1fr) for the name is what keeps that from recurring —
// minmax(0,...) rather than 1fr because a bare 1fr floors at min-content and refuses to shrink.
/**
 * A CARD ON A PHONE, THE EIGHT-COLUMN ROW FROM `sm:` UP.
 *
 * The desktop tracks come to 464px of fixed width plus 84px of gaps — 548px before the name
 * column is given anything — inside a card 361px wide on an iPhone 15 Pro. The `1fr` name
 * collapsed to nothing and the rest ran off the right edge, where the wrapper's `overflow-hidden`
 * clipped it. That is why the page measured as fitting while the Balance-from select was visibly
 * cut in half: a scrollbar reports an overflow, a clip hides one. Same fault as the dashboard's
 * budget bar had, found the same way — by looking at it.
 *
 * Below `sm:` it is three columns: the landscape stripe, everything that reads left, and the
 * control that reads right. Each cell is placed explicitly, because implicit flow would put eight
 * cells on eight lines.
 */
const ROW_GRID = 'grid grid-cols-[4px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 items-center '
  + 'sm:grid-cols-[14px_4px_minmax(0,1fr)_112px_44px_150px_116px_24px] sm:gap-3';

interface Props {
  operational: Account[];
  capital: Account[];
  txnCounts: Record<string, number>;
  /** Latest valuation per account id; absent means never valued. */
  valuations: Record<string, number>;
}

export default function AccountsList({ operational, capital, txnCounts, valuations }: Props) {
  const [operationalOrder, setOperationalOrder] = useState<Account[]>(operational);
  const [capitalOrder, setCapitalOrder] = useState<Account[]>(capital);
  const [dragOver, setDragOver] = useState<string | null>(null); // account id

  const dragRef = useRef<{ section: Section; id: string } | null>(null);

  // Any other edit (rename, bank, tracking, landscape) refreshes the server page — resync so
  // those changes (and any landscape move in/out of a group) show up here too. Adjusted during
  // render (React's documented pattern for "state derived from a prop that can also be locally
  // reordered") rather than in an effect, so a prop change takes effect in the same render pass.
  const [prevOperational, setPrevOperational] = useState(operational);
  if (operational !== prevOperational) {
    setPrevOperational(operational);
    setOperationalOrder(operational);
  }
  const [prevCapital, setPrevCapital] = useState(capital);
  if (capital !== prevCapital) {
    setPrevCapital(capital);
    setCapitalOrder(capital);
  }

  function onDragStart(section: Section, id: string) {
    dragRef.current = { section, id };
  }

  function onDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    setDragOver(id);
  }

  function onDrop(section: Section, targetId: string) {
    const drag = dragRef.current;
    if (!drag || drag.section !== section || drag.id === targetId) {
      setDragOver(null);
      return;
    }

    const setOrder = section === 'operational' ? setOperationalOrder : setCapitalOrder;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.findIndex((a) => a.id === drag.id);
      const toIdx   = next.findIndex((a) => a.id === targetId);
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);

      const items = next.map((a, i) => ({ id: a.id, sort_order: i }));
      fetch('/api/v1/accounts/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });

      return next;
    });

    setDragOver(null);
    dragRef.current = null;
  }

  function onDragEnd() {
    setDragOver(null);
    dragRef.current = null;
  }

  return (
    <>
      <Group
        title="Operational" items={operationalOrder} section="operational" dragOver={dragOver} txnCounts={txnCounts} valuations={valuations}
        onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
      />
      <Group
        title="Capital" items={capitalOrder} section="capital" dragOver={dragOver} txnCounts={txnCounts} valuations={valuations}
        onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}
      />
    </>
  );
}

function Group({
  title, items, section, dragOver, txnCounts, valuations, onDragStart, onDragOver, onDrop, onDragEnd,
}: {
  title: string;
  items: Account[];
  section: Section;
  dragOver: string | null;
  txnCounts: Record<string, number>;
  valuations: Record<string, number>;
  onDragStart: (section: Section, id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDrop: (section: Section, targetId: string) => void;
  onDragEnd: () => void;
}) {
  if (items.length === 0) return null;
  const accent = section === 'operational' ? 'bg-blue-500' : 'bg-violet-500';
  return (
    <div className="mb-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{title}</h2>
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Column headers: with five controls per row, the compact ones (an eye, two short
            selects) only read unambiguously once the column is named. */}
        <div className={`${ROW_GRID} hidden sm:grid px-6 py-2 bg-slate-50/60 border-b border-slate-100`}>
          <span />
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Account</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 text-right">Value</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400 text-center">Track</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Balance from</span>
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Landscape</span>
          <span />
        </div>
        {items.map((a, i) => {
          const isDragOver = dragOver === a.id;
          return (
            <div
              key={a.id}
              draggable
              onDragStart={() => onDragStart(section, a.id)}
              onDragOver={(e) => onDragOver(e, a.id)}
              onDrop={() => onDrop(section, a.id)}
              onDragEnd={onDragEnd}
              className={`${ROW_GRID} px-4 py-3 sm:px-6 cursor-grab active:cursor-grabbing transition-colors ${
                i < items.length - 1 ? 'border-b border-slate-50' : ''
              } hover:bg-slate-50/50 ${isDragOver ? 'border-t-2 border-t-blue-400' : ''}`}
            >
              <GripVertical size={14} className="hidden sm:block text-slate-300" />
              {/* The stripe runs the height of the card on a phone rather than sitting beside one
                  line of it — it is the only thing saying which book this account is in. */}
              <div className={`w-1 self-stretch min-h-8 rounded-full col-start-1 row-span-3 sm:col-auto sm:row-auto sm:row-span-1 sm:h-8 sm:self-auto ${accent}`} />

              {/* min-w-0 lets this cell shrink, but every child must then truncate or clip on
                  its own — without that the text overflowed its box and painted over the
                  controls to its right, which is what made the row look broken. */}
              <div className="min-w-0 col-start-2 row-start-1 sm:col-auto sm:row-auto">
                {/* WRAPS. `min-w-0` lets this cell shrink but does nothing for children that
                    refuse to: the type and `manual` chips are `shrink-0` by design, so at 361px
                    they walked straight out of the column and off the card, and the valuation
                    figure in the next column was painted on top of them. A second line inside the
                    cell is the only place for them to go. Above `sm:` the column is 362px and
                    this never wraps. */}
                <div className="flex flex-wrap items-center gap-2 mb-0.5 min-w-0">
                  <AccountNameEdit accountId={a.id} current={a.name} />
                  <AccountTypeEdit accountId={a.id} type={a.type} subtype={a.subtype} />
                  {a.is_manual && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium shrink-0">
                      manual
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 min-w-0 text-xs text-slate-400">
                  <AccountBankEdit accountId={a.id} current={a.bank} />
                  {(txnCounts[a.id] ?? 0) > 0 && (
                    <>
                      <span className="shrink-0">·</span>
                      {/* draggable={false} so grabbing a link doesn't hijack the row's own drag */}
                      <a
                        href={`/transactions?account=${a.id}`}
                        draggable={false}
                        className="shrink-0 font-mono hover:text-slate-600 transition-colors"
                      >
                        {(txnCounts[a.id] ?? 0).toLocaleString()} txns
                      </a>
                      <span className="shrink-0">·</span>
                      <a
                        href={`/accounts/${a.id}`}
                        draggable={false}
                        className="shrink-0 inline-flex items-center gap-0.5 hover:text-slate-600 transition-colors"
                      >
                        <FileText size={11} />
                        statement
                      </a>
                    </>
                  )}
                  {!a.is_manual && (
                    <>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0"><RelativeTime iso={a.last_synced_at} /></span>
                    </>
                  )}
                </div>
              </div>

              {/* Fixed-width cell rather than a conditional element, so the numbers line up
                  down the column even though only valuation-mode accounts have one. */}
              <div className="text-right col-start-3 row-start-1 self-start sm:col-auto sm:row-auto sm:self-auto">
                {a.valuation_mode === 'valuation' ? (
                  <AccountValuationEdit
                    accountId={a.id}
                    current={valuations[a.id] ?? null}
                    isLiability={a.is_liability}
                  />
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </div>

              {/* Each wrapped so it can be PLACED on the phone grid — these four are components
                  and carry no className of their own. On a desktop the wrapper is the grid item
                  the component used to be, in the same track, which changes nothing there. */}
              <div className="col-start-3 row-start-2 justify-self-end sm:col-auto sm:row-auto sm:justify-self-auto">
                <AccountTrackingToggle accountId={a.id} current={a.track_transactions} />
              </div>
              <div className="col-start-2 row-start-2 min-w-0 sm:col-auto sm:row-auto">
                <AccountValuationModeToggle accountId={a.id} mode={a.valuation_mode} isLiability={a.is_liability} />
              </div>
              <div className="col-start-2 row-start-3 min-w-0 sm:col-auto sm:row-auto">
                <AccountLandscapeToggle accountId={a.id} current={a.landscape} />
              </div>
              <div className="col-start-3 row-start-3 justify-self-end sm:col-auto sm:row-auto sm:justify-self-auto">
                <AccountDeleteButton accountId={a.id} accountName={a.name} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
