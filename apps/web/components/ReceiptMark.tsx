import { ReceiptText } from 'lucide-react';

/**
 * The mark after a row's name saying a receipt photo is attached. Inline, so it follows the name
 * wherever it wraps or truncates; muted, because it is a fact about the row and not a warning.
 * Opening the row's detail sheet shows the photo.
 */
export default function ReceiptMark() {
  return (
    <ReceiptText
      size={13}
      role="img"
      aria-label="Receipt attached"
      className="inline-block align-[-2px] ml-1.5 text-slate-400 shrink-0"
    >
      <title>Receipt attached</title>
    </ReceiptText>
  );
}
