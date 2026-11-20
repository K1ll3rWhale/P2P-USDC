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

export const utc = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19) + ' UTC';
