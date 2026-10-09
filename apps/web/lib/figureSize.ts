/**
 * The phone-size class for a money figure in a card a third of a 390px screen wide.
 *
 * `text-base` fits up to nine characters ("$512,911" or "−$21,700") in that width; a seven-figure
 * balance does not, and wrapping it mid-number reads as two figures. So the size steps down by
 * length instead. Shared by the accounts and net-worth summary cards, which sit in the same
 * three-across grid and must size their figures alike.
 */
export function figureSize(value: string): string {
  if (value.length <= 9) return 'text-base';
  if (value.length <= 10) return 'text-sm';
  return 'text-[13px]';
}
