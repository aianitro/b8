'use client';

import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import PropertyEditForm from './PropertyEditForm';
import type { Property } from '@/shared/types';

// The edit form used to occupy a permanent "Details" card taking up half the page width, to
// hold fields (purchase price, cost basis, purchase date) that are set once and then almost
// never touched. It lives behind a pencil now, next to the name and address it edits — the
// same click-the-thing-you-want-to-change affordance the accounts list already uses.
//
// A modal rather than an inline panel because the trigger sits inside the header's flex row
// while the form is far too tall to open there; fixed positioning means the two don't have to
// be neighbours in the DOM.
export default function PropertyEditModal({ property }: { property: Property }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Edit property details"
        aria-label="Edit property details"
        className="text-slate-300 hover:text-slate-600 transition-colors shrink-0"
      >
        <Pencil size={13} />
      </button>

      {open && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Property details</h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={16} />
              </button>
            </div>
            <div className="p-6">
              {/* Closes on a successful save; the form keeps its own dirty-state guard and
                  cross-field validation, so cancelling simply discards. */}
              <PropertyEditForm property={property} onSaved={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
