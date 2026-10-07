/**
 * Today as `YYYY-MM-DD` on this device's calendar.
 *
 * NOT `new Date().toISOString().slice(0, 10)`. That is today in UTC, which for anyone west of
 * Greenwich is already tomorrow every evening — from 5pm in Los Angeles. A cash move recorded that
 * way on 2026-10-06 was dated the 7th, and the account page, which counts rows up to today, left it
 * out of both wallets' balances until midnight.
 */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
