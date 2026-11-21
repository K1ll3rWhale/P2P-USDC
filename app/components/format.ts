// Presentation-only helpers. Pure string handling (no floats), so amounts are never rounded or altered.

/** Summary amounts: at least 2 decimals; extra digits are kept (up to 6) only when they are not zero. */
export function fmtAmount(s: string): string {
  const [whole, frac = ''] = s.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return `${whole}.${trimmed.length > 2 ? trimmed : trimmed.padEnd(2, '0')}`;
}

/** Fees: up to 6 decimals, trailing zeros trimmed (but never fewer than 2 decimals). */
export function fmtFee(s: string): string {
  return fmtAmount(s);
}

/** "in 3 days", "in 5 hours", "in 20 minutes", or "expired". Whole units, rounded down (minutes at least 1). */
export function timeLeft(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return 'expired';
  const mins = Math.floor(ms / 60_000);
  if (mins >= 2 * 24 * 60) return `in ${Math.floor(mins / (24 * 60))} days`;
  if (mins >= 24 * 60) return 'in 1 day';
  if (mins >= 120) return `in ${Math.floor(mins / 60)} hours`;
  if (mins >= 60) return 'in 1 hour';
  return `in ${Math.max(1, mins)} minute${mins > 1 ? 's' : ''}`;
}

export const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19) + ' UTC';

/** Exact USDC decimal string (up to 6 places) to base units. Returns null for anything that is not a plain amount. */
export function toRaw(s: string): bigint | null {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}

/** Base units to a plain decimal string with trailing zeros trimmed ("1.25", "3"). */
export function fromRaw(n: bigint): string {
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}
