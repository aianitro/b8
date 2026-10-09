'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import ConfirmDeleteTransaction from './ConfirmDeleteTransaction';
import SwipeReveal from './SwipeReveal';

/**
 * A statement row that deletes: swipe left on a phone, a trash button from `sm` up.
 *
 * NEITHER DELETES ON ITS OWN. The swipe only uncovers a Delete button and the trash button only
 * opens the dialog; both end at the same "Delete transaction?" confirmation the Transactions table
 * uses. The gesture itself lives in `SwipeReveal`, shared with the accounts list.
 */
export default function SwipeDeleteRow({ transactionId, description, className, children }: {
  transactionId: number;
  description: string;
  /** The row's own grid classes; the desktop delete button is appended as its last cell. */
  className: string;
  children: React.ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <SwipeReveal
      as="li"
      rowKey={`transaction:${transactionId}`}
      actionLabel="Delete"
      onAction={() => setConfirming(true)}
      className={className}
      after={confirming && (
        <ConfirmDeleteTransaction
          transactionId={transactionId}
          description={description}
          onClose={() => setConfirming(false)}
        />
      )}
    >
      {children}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Delete transaction"
        aria-label={`Delete ${description}`}
        className="hidden sm:flex items-center justify-center w-8 h-8 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        <Trash2 size={15} />
      </button>
    </SwipeReveal>
  );
}
